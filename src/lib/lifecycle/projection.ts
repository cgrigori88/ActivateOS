import type { Pool, PoolClient } from "pg";
import {
  loadLifecycleFacts, eventsForAccount, primaryLifecycleEvent,
  type LifecycleState, type LifecycleEvent,
} from "./state";

/**
 * The renewal-radar compatibility projection (P2A §5).
 *
 * BEFORE: five surfaces (Pipeline radar, the partner review sheet, the account timeline, the
 * account-digest routine, and the divergence detector) each read
 * `population_members.attributes->>'renewal_date'` with their own SQL, their own window, and their
 * own casting. That is five independent interpretations of one commercial fact — and none of them
 * could see a customer-confirmed date, a contradiction, or an inferred window.
 *
 * AFTER: the canonical fact graph is the single renewal truth. The import attribute is an INPUT to
 * it (promoted by `lifecycle/bridge.ts`, one-way, provenance and uncertainty preserved), never a
 * parallel display source. This module is the ONE place that reduces a derived `LifecycleEvent`
 * down to the flat {date, phrase} shape those legacy surfaces render.
 *
 * It is deliberately a PROJECTION, not a second model:
 *   • one-way — nothing here writes, and no surface may re-derive state from raw columns;
 *   • lossless about uncertainty — a window never becomes a day, and a conflict never picks a side;
 *   • it exposes `state`, so a caller that wants to say more than "due X" can.
 *
 * DEBT (documented, not hidden): `attributes.renewal_date` remains the ingest landing spot, so the
 * bridge must run for imported renewals to appear. The permanent fix is ingest writing canonical
 * facts directly — out of scope here, recorded in the P2A artifact.
 */

export interface RenewalProjectionRow {
  companyId: string;
  legalName: string;
  state: LifecycleState;
  /** Ordering/urgency clock: the verified day, the NEAR edge of a window, or the SOONEST
   *  competing date under a conflict. It orders the list; it is never printed bare. */
  clockDate: string;                  // YYYY-MM-DD
  daysOut: number;
  /** True only for VERIFIED_DATE — the one state where naming a specific day is honest. */
  precise: boolean;
  /** Safe to print anywhere: "due 2026-03-04", "expected 2026-02-10 → 2026-03-28",
   *  "contradicted — 2026-02-10 vs 2026-03-24". Never a bare day for an unverified state. */
  phrase: string;
  windowTo: string | null;
  competing: string[];
  /** The lifecycle predicate this came from ("Renewal", "Contract expiry", …). */
  label: string;
  /** The approved list the account sits ON, when it sits on one. This is MEMBERSHIP, not the
   *  date's source — a surface must never render it as "renewal from <list>" unless the date
   *  actually came from that list, which only the bridged import path does. */
  listName: string | null;
  /** Where the date itself came from, in plain words ("customer declared", "vendor signal,
   *  unverified"). This is the honest attribution to print beside a date. */
  sourceNote: string;
  event: LifecycleEvent;
}

const DAY = 86_400_000;
const day = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null);

/** The clock date for an event, or null when the event has nothing to put on a calendar. */
function clockOf(e: LifecycleEvent): string | null {
  if (e.state === "CONFLICTING_DATE") {
    const days = e.competing.map((c) => day(c.date)).filter((d): d is string => !!d).sort();
    return days[0] ?? null;
  }
  return day(e.date) ?? day(e.window?.from ?? null) ?? day(e.window?.to ?? null);
}

const PROVENANCE_WORD: Record<string, string> = {
  FIRST_PARTY: "first-party record",
  SECOND_PARTY: "partner-reported",
  THIRD_PARTY_VERIFIED: "third-party, verified",
  THIRD_PARTY_UNVERIFIED: "third-party, unverified",
  INFERRED: "inferred",
  CUSTOMER_DECLARED: "customer declared",
  HUMAN_ASSERTED: "asserted by a person",
};

/** The date's own provenance — never the list the account happens to sit on. */
function sourceNoteOf(e: LifecycleEvent): string {
  if (e.state === "CONFLICTING_DATE" && e.competing.length > 0) {
    const words = [...new Set(e.competing.map((c) => PROVENANCE_WORD[c.provenanceClass] ?? "unknown source"))];
    return words.join(" vs ");
  }
  const live = e.facts.filter((f) => f.supersededBy == null && f.status !== "SUPERSEDED" && f.status !== "REJECTED");
  const best = [...live].sort((a, b) => b.confidence - a.confidence)[0];
  return best ? (PROVENANCE_WORD[best.provenanceClass] ?? "unknown source") : "unknown source";
}

function phraseOf(e: LifecycleEvent, clock: string): string {
  switch (e.state) {
    case "VERIFIED_DATE": return `due ${clock}`;
    case "CONFLICTING_DATE": {
      const days = [...new Set(e.competing.map((c) => day(c.date)).filter((d): d is string => !!d))].sort();
      return `contradicted — ${days.join(" vs ")}`;
    }
    case "INFERRED_WINDOW": {
      const to = day(e.window?.to ?? null);
      return to && to !== clock ? `expected ${clock} → ${to}` : `expected around ${clock}`;
    }
    case "STALE_DATE": return `last known ${clock} — no longer current`;
    default: return "timing unknown";
  }
}

export interface RenewalProjectionOptions {
  /** Forward horizon in days. Events whose clock falls outside [today, today+days] are dropped. */
  days: number;
  /** Ecosystem scope narrowing. null = the caller's whole authorized book. Never widens. */
  companyIds?: string[] | null;
  /** Restrict to accounts on this partner's approved lists (the co-sell homework view). */
  partnerId?: string | null;
  /** Restrict to accounts on ANY approved list, regardless of partner. */
  approvedListsOnly?: boolean;
  limit?: number;
}

export async function renewalProjection(
  db: Pool | PoolClient, orgId: string, opts: RenewalProjectionOptions,
): Promise<RenewalProjectionRow[]> {
  const { days, companyIds = null, partnerId = null, approvedListsOnly = false, limit = 50 } = opts;

  // Membership is a SCOPE filter (which accounts this surface is about) — never a date source.
  const listName = new Map<string, string>();
  let memberIds: string[] | null = null;
  if (partnerId || approvedListsOnly) {
    const { rows } = await db.query<{ company_id: string; name: string }>(
      `select distinct on (pm.company_id) pm.company_id, ap.name
         from population_members pm
         join account_populations ap on ap.id = pm.population_id
        where ap.org_id = $1 and ap.status = 'approved'
          and ($3::uuid is null or ap.partner_id = $3)
          and ($4::boolean is false or pm.company_id = any($2))
        order by pm.company_id, ap.created_at`,
      [orgId, companyIds ?? [], partnerId, companyIds != null]);
    memberIds = rows.map((r) => r.company_id);
    for (const r of rows) listName.set(r.company_id, r.name);
    if (memberIds.length === 0) return [];
  }

  const scope = memberIds ?? companyIds;
  // ALL of an account's lifecycle facts are loaded, not just those inside the window. Narrowing by
  // date in SQL would be faster and WRONG: a competing date sitting outside the horizon is exactly
  // what turns a VERIFIED_DATE into a CONFLICTING_DATE. The cap belongs on the output, not the input.
  const byCompany = await loadLifecycleFacts(db, orgId, scope);
  if (byCompany.size === 0) return [];

  const now = Date.now();
  const horizon = now + days * DAY;
  type Partial_ = Omit<RenewalProjectionRow, "legalName" | "listName">;
  const partials: Partial_[] = [];

  for (const [companyId, facts] of byCompany) {
    const primary = primaryLifecycleEvent(eventsForAccount(facts));
    if (!primary || primary.state === "UNKNOWN") continue;
    const clock = clockOf(primary);
    if (!clock) continue;
    const t = new Date(`${clock}T00:00:00Z`).getTime();
    if (Number.isNaN(t) || t < now - DAY || t > horizon) continue;   // forward window only
    partials.push({
      companyId,
      state: primary.state,
      clockDate: clock,
      daysOut: Math.max(0, Math.ceil((t - now) / DAY)),
      precise: primary.state === "VERIFIED_DATE",
      phrase: phraseOf(primary, clock),
      windowTo: day(primary.window?.to ?? null),
      competing: [...new Set(primary.competing.map((c) => day(c.date)).filter((d): d is string => !!d))].sort(),
      label: primary.label,
      sourceNote: sourceNoteOf(primary),
      event: primary,
    });
  }

  // Names and list attribution are resolved only for the rows that actually survive the window and
  // the cap — at book scale most accounts carry a lifecycle fact that is nowhere near the horizon.
  const ranked = partials.sort((a, b) => a.clockDate.localeCompare(b.clockDate)).slice(0, limit);
  if (ranked.length === 0) return [];
  const ids = ranked.map((r) => r.companyId);

  const { rows: names } = await db.query<{ id: string; legal_name: string }>(
    `select id, legal_name from companies where id = any($1)`, [ids]);
  const nameById = new Map(names.map((r) => [r.id, r.legal_name]));

  if (!partnerId && !approvedListsOnly) {
    const { rows } = await db.query<{ company_id: string; name: string }>(
      `select distinct on (pm.company_id) pm.company_id, ap.name
         from population_members pm
         join account_populations ap on ap.id = pm.population_id
        where ap.org_id = $1 and ap.status = 'approved' and pm.company_id = any($2)
        order by pm.company_id, ap.created_at`,
      [orgId, ids]);
    for (const r of rows) listName.set(r.company_id, r.name);
  }

  return ranked.map((r) => ({
    ...r,
    legalName: nameById.get(r.companyId) ?? "—",
    listName: listName.get(r.companyId) ?? null,
  }));
}
