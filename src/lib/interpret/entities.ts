import type { PoolClient } from "pg";
import { getIntent, type Slots } from "@/lib/search/registry";

/**
 * Canonical entity resolution (P2C-1 §5). The interpreter proposes an entity as the STRING the
 * user typed; resolving that string to a real record happens here, afterwards, and inside the
 * authorized set — never globally first with a filter applied to the result.
 *
 * That ordering is the whole point. Resolving globally and then checking authorisation binds the
 * name to whichever record the database happened to rank first, which may be one the operator
 * cannot see; the operator is then refused access to the record they CAN see, and told it does not
 * exist. A scope check that fails closed on the wrong record is still a wrong answer. This is the
 * same rule the P2C-0 ask-scope guard reached, applied to the interpreter's entity slots.
 *
 * Three honest outcomes and no fourth:
 *   RESOLVED   exactly one authorized match — the CANONICAL name replaces the typed string.
 *   AMBIGUOUS  several authorized matches — their names are returned so the operator can choose.
 *              A model must never break this tie, and neither may we: "Acme" matching two real
 *              customers is a question, not a ranking problem.
 *   UNKNOWN    no authorized match — which is deliberately NOT distinguished from "does not
 *              exist", because distinguishing them would confirm the existence of a record outside
 *              the operator's scope.
 */

export type EntityKind = "account" | "partner";

export type EntityResolution =
  | { kind: "RESOLVED"; id: string; label: string }
  | { kind: "AMBIGUOUS"; labels: string[] }
  | { kind: "UNKNOWN" };

/** Accounts the org can actually reach — the same reachability rule the palette's entity search uses. */
const ACCOUNT_SQL = `
  select c.id, c.legal_name label from companies c
   where c.legal_name ilike $2
     and ($4::boolean is false or c.id = any($3))
     and (
       exists (select 1 from pursuits p where p.account_id = c.id and p.org_id = $1)
       or exists (select 1 from revenue_motions m where m.company_id = c.id and m.org_id = $1)
       or exists (select 1 from campaigns ca where ca.company_id = c.id and ca.org_id = $1)
       or exists (select 1 from population_members pm
                    join account_populations ap on ap.id = pm.population_id
                   where pm.company_id = c.id and ap.org_id = $1)
     )
   order by (lower(c.legal_name) = lower($5)) desc, length(c.legal_name) asc
   limit 6`;

// Partners are org-owned, not account-scoped: the ecosystem scope narrows which ACCOUNTS are
// readable, never which of the org's own partners exist. Narrowing them here would invent a
// restriction no other surface applies.
const PARTNER_SQL = `
  select p.id, p.name label from partners p
   where p.org_id = $1 and p.name ilike $2
   order by (lower(p.name) = lower($3)) desc, length(p.name) asc
   limit 6`;

export async function resolveEntity(
  db: PoolClient, orgId: string, kind: EntityKind, typed: string, companyIds: string[] | null,
): Promise<EntityResolution> {
  const text = typed.trim();
  if (text.length < 2) return { kind: "UNKNOWN" };
  const scoped = companyIds != null;
  // An empty authorized set is a valid "nothing in scope" — not a reason to widen the lookup.
  if (kind === "account" && scoped && companyIds!.length === 0) return { kind: "UNKNOWN" };

  const pat = `%${text.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const { rows } = kind === "account"
    ? await db.query<{ id: string; label: string }>(ACCOUNT_SQL, [orgId, pat, companyIds ?? [], scoped, text])
    : await db.query<{ id: string; label: string }>(PARTNER_SQL, [orgId, pat, text]);

  if (rows.length === 0) return { kind: "UNKNOWN" };
  // An EXACT (case-insensitive) name wins outright — that is not a tie, it is a precise answer.
  const exact = rows.filter((r) => r.label.toLowerCase() === text.toLowerCase());
  if (exact.length === 1) return { kind: "RESOLVED", id: exact[0].id, label: exact[0].label };
  if (rows.length === 1) return { kind: "RESOLVED", id: rows[0].id, label: rows[0].label };
  return { kind: "AMBIGUOUS", labels: rows.map((r) => r.label) };
}

export type SlotResolution =
  | { ok: true; slots: Slots }
  | { ok: false; outcome: "AMBIGUOUS"; note: string }
  | { ok: false; outcome: "UNKNOWN"; note: string };

/**
 * Resolve every entity-typed slot on an intent, replacing the typed string with the canonical
 * record name. Scalar slots pass through untouched.
 *
 * The canonical name — not an id — is what moves forward, because the resolvers this feeds take
 * account and partner NAMES and perform their own canonical lookup. Substituting the exact stored
 * name makes that downstream lookup land on the intended record instead of on a prefix collision.
 * Passing ids end-to-end would be tighter still and is recorded as debt in the P2C-1 artifact.
 */
export async function resolveEntitySlots(
  db: PoolClient, orgId: string, intentKey: string, slots: Slots, companyIds: string[] | null,
): Promise<SlotResolution> {
  const def = getIntent(intentKey);
  if (!def) return { ok: false, outcome: "UNKNOWN", note: `Unsupported: unknown intent ${intentKey}.` };

  const out: Slots = { ...slots };
  for (const [name, value] of Object.entries(slots)) {
    const spec = def.slots?.[name];
    if (!spec || (spec.type !== "account" && spec.type !== "partner")) continue;
    if (typeof value !== "string" || value.trim() === "") continue;

    const res = await resolveEntity(db, orgId, spec.type, value, companyIds);
    if (res.kind === "AMBIGUOUS") {
      return {
        ok: false, outcome: "AMBIGUOUS",
        note: `"${value}" matches ${res.labels.length} ${spec.type}s you can see — ${res.labels.join(", ")}. Which one?`,
      };
    }
    if (res.kind === "UNKNOWN") {
      return {
        ok: false, outcome: "UNKNOWN",
        note: `No ${spec.type} matching "${value}" is readable in the current scope.`,
      };
    }
    out[name] = res.label;
  }
  return { ok: true, slots: out };
}
