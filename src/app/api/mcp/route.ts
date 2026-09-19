import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/db/client";
import { rateLimited } from "@/lib/security/rate-limit";
import { MCP_TOOLS, resolveKey } from "@/lib/agents/mcp-tools";
import { GOVERNED_MCP_TOOLS } from "@/lib/agents/mcp-governed";
import { decideToolScope } from "@/lib/agents/ask-scope";

/**
 * The authorized company set for an MCP key. API keys are org-scoped and carry no ecosystem
 * narrowing, so this is `null` (no narrowing) — stated as a named function rather than a bare
 * literal so the day a scoped key exists, there is exactly one place to change.
 */
const keyScopeCompanyIds = (): string[] | null => null;
import { withTenantOrg } from "@/lib/db/tenant";
import { dispatchSkill, type Actor } from "@/lib/pursuits/federation/skills";

/** A resolved MCP key's scope maps to a governed Actor role (R1-G1). */
type ResolvedKey = { orgId: string; keyId: string; scope: string };
function keyRole(scope: string): Actor["role"] { return scope === "read" ? "viewer" : "operator"; }

/**
 * SLICE 14 — TOOL SCOPE, ENFORCED AT THE TRANSPORT.
 *
 * A tool requiring `operator` is neither advertised to nor callable by a read-scoped key. Before
 * this, the only barrier was `dispatchSkill`'s role rank: it correctly refused the EFFECT, but the
 * call was still accepted, dispatched and recorded as a rejected attempt — so a read key could
 * produce durable audit state by naming a write tool. Refusing here means the dispatch never
 * happens. `dispatchSkill`'s own check remains untouched as defense in depth.
 */
const toolScope = (t: { scope?: "read" | "operator"; write?: boolean }): "read" | "operator" =>
  t.scope ?? (t.write ? "operator" : "read");
const scopeAllows = (keyScope: string, need: "read" | "operator"): boolean =>
  need === "read" || keyScope !== "read";

/**
 * What this key may see. Governed P7 tools first: `pipeline_summary` is now the canonical answer and
 * the legacy opportunity implementation has been renamed, so no two advertised tools claim the same
 * business concept.
 */
function visibleTools(keyScope: string) {
  const governed = GOVERNED_MCP_TOOLS
    .filter((t) => scopeAllows(keyScope, t.scope))
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  const legacy = MCP_TOOLS
    .filter((t) => scopeAllows(keyScope, toolScope(t)))
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  return [...governed, ...legacy];
}

export const dynamic = "force-dynamic";

/**
 * BYO-bot MCP surface (task #76): a minimal Model Context Protocol server
 * over streamable HTTP. Any personal agent that speaks MCP (Claude, Grok
 * Bot, Copilot, …) can be pointed here with a tenant API key and query THIS
 * tenant — under the platform's enforcement, not the agent's goodwill:
 * every tool is org-scoped by the key, reads mirror the tenant's own
 * screens, and the single write tool produces drafts behind the existing
 * approval gates.
 *
 * Stateless server: JSON-RPC 2.0 request/response over POST, no SSE stream
 * (GET returns 405, which the spec permits for servers that don't push).
 */

interface RpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

const PROTOCOL_VERSION = "2025-06-18";

function rpcResult(id: number | string | null, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}
function rpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

async function handleMessage(msg: RpcRequest, key: ResolvedKey): Promise<Record<string, unknown> | null> {
  const orgId = key.orgId;
  const id = msg.id ?? null;
  // Notifications (no id) get no response.
  if (msg.id === undefined) return null;

  switch (msg.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion:
          typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "PursuitOS", version: "1.0.0" },
        instructions:
          "Tenant-scoped tools for partner-led revenue. Reads mirror the tenant's own screens; the only write tool creates DRAFTS behind human approval gates. Cross-tenant data appears only where both partners already consented (overlap results, joint rooms).",
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: visibleTools(key.scope) });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");

      // ── GOVERNED P7 READ TOOLS ────────────────────────────────────────────────────────────────
      // They receive NO database handle — only the credential's organization — so this branch
      // cannot reach SQL, dispatchSkill or P45 even by mistake.
      const governed = GOVERNED_MCP_TOOLS.find((t) => t.name === name);
      if (governed) {
        try {
          const result = await governed.run(orgId);
          return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false });
        } catch {
          // Never leak compiler detail, DB posture, SQL or a stack to an external caller.
          return rpcResult(id, { content: [{ type: "text", text: JSON.stringify({ status: "FAILED" }, null, 2) }], isError: true });
        }
      }

      const tool = MCP_TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      // SCOPE IS CHECKED BEFORE ANYTHING ELSE HAPPENS — before dispatch, before a governed actor is
      // built, before any attempt is recorded. Naming a tool a key may not hold is simply refused.
      if (!scopeAllows(key.scope, toolScope(tool))) {
        return rpcError(id, -32602, `Unknown tool: ${name}`);
      }
      const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
      try {
        // RISK-1: scope the tool's queries to the key's org via the GUC (org
        // comes from the API key, not a web session — hence withTenantOrg).
        // R1-G1: a WRITE tool is never run inline — it is dispatched through the
        // governed boundary (actor eligibility + permission + effect class +
        // idempotency + audited invocation). There is no ungoverned MCP write path.
        if (tool.write && tool.skillId) {
          const actor: Actor = { type: "AGENT", id: key.keyId, orgId, role: keyRole(key.scope) };
          const idem = typeof args.idempotencyKey === "string" ? args.idempotencyKey : null;
          const disp = await withTenantOrg(orgId, (db) =>
            dispatchSkill(db, tool.skillId!, actor, { args, idempotencyKey: idem, dataEnvironment: "PRODUCTION" }));
          const ok = disp.status === "EXECUTED" || disp.status === "EXECUTING";
          const payload = ok ? (disp.result ?? { status: disp.status }) : { status: disp.status, reason: disp.reason };
          return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: !ok });
        }
        // P2C-1: the ecosystem-scope guard built in P2C-0 now lives HERE, at the one remaining
        // boundary where raw tool payloads reach an external model. PursuitOS's own Ask surface no
        // longer calls tools at all — its model never sees a record — so this is the tool boundary
        // that still needs guarding. An MCP API key carries no ecosystem scope today, so `null`
        // makes the guard a pass-through; it is wired at the boundary rather than at the eventual
        // caller so a scoped key cannot be introduced without the check already standing.
        const result = await withTenantOrg(orgId, async (db) => {
          const decision = await decideToolScope(db, orgId, tool, args, keyScopeCompanyIds());
          // D-G8-4C: ambiguity fails closed, and is reported as ITS OWN outcome. Returning the
          // scope refusal here would tell the caller the account is outside their scope, which is a
          // different — and false — statement.
          if (!decision.allowed) return decision.ambiguous ?? decision.refusal;
          return tool.run(db, orgId, args);
        });
        return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false });
      } catch (err) {
        return rpcResult(id, {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(`mcp:${ip}`, 120, 60_000)) {
    return NextResponse.json(rpcError(null, -32000, "Rate limited"), { status: 429 });
  }

  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  // RISK-1: resolveKey finds the key's org BEFORE any org is known — the same
  // chicken-and-egg solved for users by resolve_user_org(). It now calls the
  // SECURITY DEFINER resolve_api_key() (migration 0062), so it works under
  // app_rw (which cannot read api_keys itself) as well as on the owner pool.
  const key = await resolveKey(getPool(), bearer);
  if (!key) {
    return NextResponse.json(rpcError(null, -32000, "Invalid or revoked API key"), {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }
  if (rateLimited(`mcp-key:${key.keyId}`, 60, 60_000)) {
    return NextResponse.json(rpcError(null, -32000, "Rate limited"), { status: 429 });
  }
  // SLICE 14 — AN ORGANIZATION-LEVEL BOUND, not only a per-key one. Keys are org-scoped and an
  // organization may hold several, so a per-key ceiling multiplies with the number of credentials
  // issued; the governed P7 read is the expensive path and should not be trivially multiplied that
  // way. Deliberately looser than the per-key bound: it is a ceiling for the tenant, not a second
  // per-caller limit. The limiter's own honestly-stated weakness still applies — counters are
  // per-instance (see rate-limit.ts), so this narrows abuse rather than eliminating it.
  if (rateLimited(`mcp-org:${key.orgId}`, 240, 60_000)) {
    return NextResponse.json(rpcError(null, -32000, "Rate limited"), { status: 429 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  const messages = Array.isArray(payload) ? payload : [payload];
  const responses: Record<string, unknown>[] = [];
  for (const raw of messages) {
    const msg = raw as RpcRequest;
    if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      responses.push(rpcError((msg?.id as number) ?? null, -32600, "Invalid request"));
      continue;
    }
    const res = await handleMessage(msg, key);
    if (res) responses.push(res);
  }

  if (responses.length === 0) return new NextResponse(null, { status: 202 });
  const body = Array.isArray(payload) ? responses : responses[0];
  return NextResponse.json(body);
}

export function GET(): NextResponse {
  // No server-push stream — stateless request/response only.
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
