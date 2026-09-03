import type { PoolClient } from "pg";

/**
 * Readability filtering for Ask's supporting-record links (Wave 6C §8).
 *
 * WHAT WAS WRONG. `logAnswer` stores the deep links an answer stood on, and its
 * comment recorded the assumption they were built on:
 *
 *   "record_hrefs are deep links, which disclose nothing on their own and
 *    re-resolve under the reader's authorisation."
 *
 * Half of that is true and half of it is the defect. Nothing IS disclosed — RLS
 * refuses the record and the route returns 404, which a Wave 6C crawl confirmed
 * on a real cross-tenant href. But the product had still put an actionable
 * navigation target in front of an operator who cannot resolve it, and had
 * delegated the refusal to the browser round-trip. A governed product does not
 * offer a door it knows is locked and let the lock do the explaining.
 *
 * WHAT THIS DOES. Given the caller's own RLS-scoped connection, it keeps only
 * the hrefs whose target row is actually readable by that caller. The check uses
 * the SAME authorization the resolve would: a `select` as `app_rw` with the
 * org GUC set returns no row for a record this tenant may not see, so the answer
 * here is authoritative rather than a second, weaker guess at the policy.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not label, count, or otherwise
 * acknowledge the entries it drops. Saying "1 record withheld" would disclose
 * the existence of a record whose existence is itself outside the reader's
 * authorized view — the thing §8 forbids. Unreadable links are simply absent.
 *
 * Non-record links (room routes like `/pipeline?stage=closed_won`) are not
 * record references at all and pass through untouched.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Routes that name a single tenant-scoped record, and the table that decides
 * whether this caller may read it. Only tables under RLS belong here — the
 * point is to ask the policy, not to re-implement it.
 */
const RECORD_ROUTES: { pattern: RegExp; table: string }[] = [
  { pattern: new RegExp(`^/pursuits/(${UUID})`, "i"), table: "pursuits" },
  { pattern: new RegExp(`^/accounts/(${UUID})`, "i"), table: "companies" },
  { pattern: new RegExp(`^/partners/(${UUID})`, "i"), table: "partners" },
  { pattern: new RegExp(`^/goals/(${UUID})`, "i"), table: "goals" },
  { pattern: new RegExp(`^/campaigns/(${UUID})`, "i"), table: "campaigns" },
  { pattern: new RegExp(`^/joint/(${UUID})`, "i"), table: "joint_pursuits" },
];

export interface RecordRef { table: string; id: string }

/** The record a deep link names, or null when it names a room rather than a record. */
export function parseRecordRef(href: string): RecordRef | null {
  for (const r of RECORD_ROUTES) {
    const m = r.pattern.exec(href);
    if (m) return { table: r.table, id: m[1] };
  }
  return null;
}

/**
 * Keep only the hrefs this caller can actually resolve.
 *
 * `db` MUST be the caller's own scoped connection (the one `withTenant` hands
 * out): the whole guarantee rests on the query running under the same role and
 * `app.org_id` the page itself reads with.
 */
export async function filterReadableRecordHrefs(db: PoolClient, hrefs: string[]): Promise<string[]> {
  if (hrefs.length === 0) return [];
  const kept: string[] = [];
  // Small n by construction — an answer stands on a handful of records, and the
  // alternative (one grouped query per table) trades clarity for nothing here.
  for (const href of hrefs) {
    const ref = parseRecordRef(href);
    if (!ref) { kept.push(href); continue; }   // a room link, not a record reference
    try {
      const { rows } = await db.query<{ ok: boolean }>(
        `select exists (select 1 from ${ref.table} where id = $1) as ok`, [ref.id],
      );
      if (rows[0]?.ok) kept.push(href);
    } catch {
      // An unreadable table is not a licence to emit the link. Fail closed.
    }
  }
  return kept;
}
