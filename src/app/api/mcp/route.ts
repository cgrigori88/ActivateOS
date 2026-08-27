import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/db/client";
import { rateLimited } from "@/lib/security/rate-limit";
import { MCP_TOOLS, resolveKey } from "@/lib/agents/mcp-tools";
import { withTenantOrg } from "@/lib/db/tenant";

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

async function handleMessage(msg: RpcRequest, orgId: string): Promise<Record<string, unknown> | null> {
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
      return rpcResult(id, {
        tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = MCP_TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      try {
        // RISK-1: scope the tool's queries to the key's org via the GUC (org
        // comes from the API key, not a web session — hence withTenantOrg).
        const result = await withTenantOrg(orgId, (db) =>
          tool.run(db, orgId, (msg.params?.arguments as Record<string, unknown>) ?? {}),
        );
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
  // RISK-1 cutover note: resolveKey reads api_keys (an org-scoped table) to find
  // the key's org BEFORE any org is known — the same chicken-and-egg solved for
  // users by resolve_user_org(). Before DATABASE_URL points at app_rw, this
  // lookup needs a SECURITY DEFINER key resolver (or a dedicated owner auth
  // connection); on the owner connection today it works unchanged.
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
    const res = await handleMessage(msg, key.orgId);
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
