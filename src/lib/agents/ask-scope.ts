import type { Pool, PoolClient } from "pg";
import type { McpToolDef } from "./mcp-tools";

/**
 * Ask scope guard (P2C-0 §2). Closes the invariant gap the P2 design audit found: `askTheRecord`
 * honored the authenticated principal and RLS, but NOT the persistent ecosystem scope that every
 * other surface honors — so a narrowed operator could ask the LLM a question and receive answers
 * drawn from the whole book.
 *
 * The fix is applied at the TOOL BOUNDARY, before any payload becomes model-visible context. That
 * ordering matters: filtering the final answer would still have placed out-of-scope (and possibly
 * confidential) records into the model's context window. Nothing out of scope is ever serialized.
 *
 * Rules, all narrowing-only:
 *   · scope ALL (companyIds === null)  → unchanged behavior; every read tool runs as before.
 *   · a narrowing scope is active:
 *       ACCOUNT_ADDRESSED tools (they take an `account` argument) resolve that account first and
 *       are REFUSED when it falls outside the authorized set — a refusal, never a silent empty.
 *       ORG_WIDE tools are REFUSED, because their aggregates are computed over the full book and
 *       would leak out-of-scope magnitude into the context.
 *   · a refusal is an explicit, honest payload the model can relay ("outside the active scope"),
 *     never fabricated data and never a widened read.
 *
 * The guard can only ever REMOVE reach. There is no path here that grants a tool access it would
 * not otherwise have, and RLS remains authoritative underneath regardless.
 */

/** Tools addressed at a single named account — scopeable by resolving that account. */
const ACCOUNT_ADDRESSED = new Set(["account_brief", "deal_context", "partner_context", "overlap_status"]);

export interface ScopeDecision {
  allowed: boolean;
  /** The payload to return instead, when refused. */
  refusal?: { scoped_out: true; reason: string };
}

/**
 * Decide whether one tool call may run under the active scope, resolving any account argument
 * against the authorized company set.
 */
export async function decideToolScope(
  pool: Pool | PoolClient, orgId: string, tool: McpToolDef,
  args: Record<string, unknown>, companyIds: string[] | null,
): Promise<ScopeDecision> {
  // No narrowing in effect — the surface behaves exactly as it did before P2C-0.
  if (companyIds == null) return { allowed: true };

  // An empty authorized set is a valid "nothing in scope": every tool is refused.
  if (companyIds.length === 0) {
    return { allowed: false, refusal: { scoped_out: true, reason: "The active ecosystem scope contains no accounts." } };
  }

  if (ACCOUNT_ADDRESSED.has(tool.name)) {
    const account = String(args.account ?? args.partner ?? "").trim();
    if (!account) {
      return { allowed: false, refusal: { scoped_out: true, reason: "This tool needs a named account while an ecosystem scope is active." } };
    }
    // Resolve WITHIN the authorized set first. Account names are not unique, and a global
    // shortest-match can bind "Globex" to a look-alike the operator cannot see and then refuse the
    // one they can — a scope check that fails closed on the wrong record is still a wrong answer.
    // This cannot widen access: the in-scope lookup is a strict subset of `companyIds`, which is
    // itself the already-authorized set. Only when nothing in scope matches do we resolve globally,
    // and that path can only ever produce a refusal.
    const inScope = await pool.query<{ id: string }>(
      `select id from companies where legal_name ilike $1 and id = any($2)
        order by length(legal_name) limit 1`, [`%${account}%`, companyIds]);
    if (inScope.rows[0]) return { allowed: true };

    const { rows } = await pool.query<{ id: string }>(
      `select id from companies where legal_name ilike $1 order by length(legal_name) limit 1`, [`%${account}%`]);
    // An unresolvable name is not a scope violation — let the tool answer "no such account".
    if (!rows[0]) return { allowed: true };
    if (!companyIds.includes(rows[0].id)) {
      return {
        allowed: false,
        refusal: { scoped_out: true, reason: `"${account}" is outside the active ecosystem scope, so it was not read.` },
      };
    }
    return { allowed: true };
  }

  // Everything else aggregates across the book. Under a narrowing scope those totals would be
  // wrong AND would carry out-of-scope magnitude into the context — so they do not run.
  return {
    allowed: false,
    refusal: {
      scoped_out: true,
      reason: `${tool.name} reports across the whole book; an ecosystem scope is active, so it was not called. Ask about a specific account, or clear the scope.`,
    },
  };
}

/** A one-line statement of the active scope, prepended to the system prompt so the model says so. */
export function scopeSystemNote(companyIds: string[] | null): string {
  if (companyIds == null) return "";
  if (companyIds.length === 0) {
    return "\nSCOPE: the operator's active ecosystem scope contains no accounts. Answer that nothing is in scope.";
  }
  return `\nSCOPE: an ecosystem scope is active, narrowing this answer to ${companyIds.length} account(s). ` +
    `Some tools will refuse with {"scoped_out":true} — relay that honestly as "outside the current scope"; never guess what they would have returned.`;
}
