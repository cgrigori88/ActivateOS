import type { Pool, PoolClient } from "pg";
import { audit } from "./partnerships";

type Db = Pool | PoolClient;

/**
 * Blind overlap (task #72, Phase A). The platform answers "how much do our
 * books overlap?" as a neutral broker, on a disclosure ladder:
 *
 *   counts → bands → named
 *
 * Rules, enforced here and nowhere else:
 *  - a rung can only be requested once the previous rung is approved;
 *  - the requester's request IS their consent — the OTHER org must approve;
 *  - results are computed once, at approval, and stored symmetric: both sides
 *    read the identical payload (viewer-relative framing happens at render);
 *  - every request and decision lands in BOTH orgs' audit ledgers.
 *
 * An org's "book" = distinct companies in its own approved populations
 * (partner_id null — its lists, not its lenses on partners' books).
 */

export const OVERLAP_LEVELS = ["counts", "bands", "named"] as const;
export type OverlapLevel = (typeof OVERLAP_LEVELS)[number];

export const LEVEL_LABEL: Record<OverlapLevel, string> = {
  counts: "Overlap count",
  bands: "Category & industry mix",
  named: "Named accounts",
};

export const LEVEL_EXPLAIN: Record<OverlapLevel, string> = {
  counts: "Just one number: how many accounts appear in both books.",
  bands: "How the overlap splits by each side's list categories and by industry — still no account names.",
  named: "Which accounts they are — each one is already in your book; this reveals only that the partner has it too, and how each side categorizes it.",
};

const NAMED_CAP = 500;

export interface CountsResults {
  overlap: number;
}
export interface BandsResults {
  overlap: number;
  /** overlap accounts per list category, keyed by org id — render viewer-relative */
  categories: Record<string, Record<string, number>>;
  industries: { industry: string; count: number }[];
}
export interface NamedResults {
  overlap: number;
  truncated: boolean;
  accounts: {
    company_id: string;
    name: string;
    industry: string | null;
    /** each side's list categories for this account, keyed by org id */
    cats: Record<string, string[]>;
  }[];
}

interface PartnershipRow {
  id: string;
  initiator_org_id: string;
  counterpart_org_id: string | null;
  status: string;
}

async function loadPartnership(db: Db, partnershipId: string): Promise<PartnershipRow> {
  const { rows } = await db.query<PartnershipRow>(
    `select id, initiator_org_id, counterpart_org_id, status from partnerships where id = $1`,
    [partnershipId],
  );
  if (!rows[0]) throw new Error("Partnership not found.");
  return rows[0];
}

function memberOrgs(p: PartnershipRow): string[] {
  return [p.initiator_org_id, p.counterpart_org_id].filter(Boolean) as string[];
}

function otherOrg(p: PartnershipRow, orgId: string): string {
  const other = memberOrgs(p).find((o) => o !== orgId);
  if (!other) throw new Error("Partnership has no counterpart yet.");
  return other;
}

/** The org's own book: distinct companies in its approved, non-lens lists. */
const BOOK_SQL = `
  select distinct pm.company_id, ap.category
  from population_members pm
  join account_populations ap on ap.id = pm.population_id
  where ap.org_id = $ORG and ap.status = 'approved' and ap.partner_id is null`;

export async function bookSize(db: Db, orgId: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(distinct pm.company_id) as n
     from population_members pm
     join account_populations ap on ap.id = pm.population_id
     where ap.org_id = $1 and ap.status = 'approved' and ap.partner_id is null`,
    [orgId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Broker computation — deliberate cross-tenant read in system context (like
 * grant sync). Only rung-appropriate aggregates leave this function. */
async function computeOverlap(
  db: Db,
  p: PartnershipRow,
  level: OverlapLevel,
): Promise<CountsResults | BandsResults | NamedResults> {
  const [orgA, orgB] = memberOrgs(p);
  const a = BOOK_SQL.replace("$ORG", "$1");
  const b = BOOK_SQL.replace("$ORG", "$2");

  const { rows: countRows } = await db.query<{ n: string }>(
    `with a_book as (${a}), b_book as (${b})
     select count(*) as n from (select distinct company_id from a_book) x
     join (select distinct company_id from b_book) y using (company_id)`,
    [orgA, orgB],
  );
  const overlap = Number(countRows[0]?.n ?? 0);
  if (level === "counts") return { overlap };

  if (level === "bands") {
    const { rows: catRows } = await db.query<{ org_id: string; category: string; n: string }>(
      `with a_book as (${a}), b_book as (${b}),
       shared as (select distinct company_id from a_book intersect select distinct company_id from b_book)
       select $1 as org_id, ab.category, count(distinct ab.company_id) as n
       from a_book ab join shared s on s.company_id = ab.company_id group by ab.category
       union all
       select $2 as org_id, bb.category, count(distinct bb.company_id) as n
       from b_book bb join shared s on s.company_id = bb.company_id group by bb.category`,
      [orgA, orgB],
    );
    const categories: BandsResults["categories"] = { [orgA]: {}, [orgB]: {} };
    for (const r of catRows) categories[r.org_id][r.category] = Number(r.n);

    const { rows: indRows } = await db.query<{ industry: string | null; n: string }>(
      `with a_book as (${a}), b_book as (${b}),
       shared as (select distinct company_id from a_book intersect select distinct company_id from b_book)
       select c.industry, count(*) as n from shared s join companies c on c.id = s.company_id
       group by c.industry order by count(*) desc limit 8`,
      [orgA, orgB],
    );
    return {
      overlap,
      categories,
      industries: indRows.map((r) => ({ industry: r.industry ?? "unknown", count: Number(r.n) })),
    };
  }

  const { rows: namedRows } = await db.query<{
    company_id: string;
    name: string;
    industry: string | null;
    a_cats: string[];
    b_cats: string[];
  }>(
    `with a_book as (${a}), b_book as (${b}),
     shared as (select distinct company_id from a_book intersect select distinct company_id from b_book)
     select s.company_id, c.legal_name as name, c.industry,
            (select array_agg(distinct ab.category) from a_book ab where ab.company_id = s.company_id) as a_cats,
            (select array_agg(distinct bb.category) from b_book bb where bb.company_id = s.company_id) as b_cats
     from shared s join companies c on c.id = s.company_id
     order by c.legal_name limit ${NAMED_CAP + 1}`,
    [orgA, orgB],
  );
  const truncated = namedRows.length > NAMED_CAP;
  return {
    overlap,
    truncated,
    accounts: namedRows.slice(0, NAMED_CAP).map((r) => ({
      company_id: r.company_id,
      name: r.name,
      industry: r.industry,
      cats: { [orgA]: r.a_cats ?? [], [orgB]: r.b_cats ?? [] },
    })),
  };
}

// ── Ladder actions ───────────────────────────────────────────────────────────

export async function requestOverlapProbe(
  db: Db,
  orgId: string,
  partnershipId: string,
  level: OverlapLevel,
): Promise<void> {
  const p = await loadPartnership(db, partnershipId);
  if (!memberOrgs(p).includes(orgId)) throw new Error("Your organization is not part of this partnership.");
  if (p.status !== "active") throw new Error("Overlap probes need an active partnership.");
  if (!OVERLAP_LEVELS.includes(level)) throw new Error("Unknown disclosure level.");

  // Ladder: previous rung must be approved.
  const idx = OVERLAP_LEVELS.indexOf(level);
  if (idx > 0) {
    const prev = OVERLAP_LEVELS[idx - 1];
    const { rows } = await db.query(
      `select 1 from overlap_probes where partnership_id = $1 and level = $2 and status = 'approved'`,
      [partnershipId, prev],
    );
    if (rows.length === 0) throw new Error(`"${LEVEL_LABEL[level]}" unlocks after "${LEVEL_LABEL[prev]}" is approved.`);
  }

  // No duplicate open/approved probe for this rung.
  const { rows: existing } = await db.query(
    `select 1 from overlap_probes where partnership_id = $1 and level = $2 and status in ('requested', 'approved')`,
    [partnershipId, level],
  );
  if (existing.length > 0) throw new Error(`A "${LEVEL_LABEL[level]}" probe is already requested or approved.`);

  await db.query(
    `insert into overlap_probes (partnership_id, requested_by_org, level) values ($1, $2, $3)`,
    [partnershipId, orgId, level],
  );
  for (const org of memberOrgs(p)) {
    await audit(db, org, "overlap.requested", { level, by: orgId === org ? "us" : "counterpart" }, partnershipId);
  }
}

export async function decideOverlapProbe(
  db: Db,
  orgId: string,
  probeId: string,
  approve: boolean,
): Promise<void> {
  const { rows } = await db.query<{
    id: string;
    partnership_id: string;
    requested_by_org: string;
    level: OverlapLevel;
    status: string;
  }>(`select id, partnership_id, requested_by_org, level, status from overlap_probes where id = $1`, [probeId]);
  const probe = rows[0];
  if (!probe) throw new Error("Probe not found.");
  if (probe.status !== "requested") throw new Error(`This probe is already ${probe.status}.`);

  const p = await loadPartnership(db, probe.partnership_id);
  if (!memberOrgs(p).includes(orgId)) throw new Error("Your organization is not part of this partnership.");
  // The requester consented by requesting — only the counterpart can decide.
  if (probe.requested_by_org === orgId) throw new Error("The requesting side can't approve its own probe.");

  if (!approve) {
    await db.query(`update overlap_probes set status = 'declined', decided_at = now() where id = $1`, [probeId]);
    for (const org of memberOrgs(p)) {
      await audit(db, org, "overlap.declined", { level: probe.level, by: orgId === org ? "us" : "counterpart" }, p.id);
    }
    return;
  }

  const results = await computeOverlap(db, p, probe.level);
  await db.query(
    `update overlap_probes set status = 'approved', decided_at = now(), computed_at = now(), results = $2
     where id = $1`,
    [probeId, JSON.stringify(results)],
  );
  for (const org of memberOrgs(p)) {
    await audit(db, org, "overlap.approved", { level: probe.level, by: orgId === org ? "us" : "counterpart" }, p.id);
  }
}

// ── Read model for the Admin ladder card ────────────────────────────────────

export type RungState =
  | { state: "locked" }
  | { state: "available" }
  | { state: "requested_by_us"; probeId: string; requestedAt: string }
  | { state: "awaiting_you"; probeId: string; requestedAt: string }
  | { state: "declined"; decidedAt: string }
  | { state: "approved"; probeId: string; decidedAt: string; results: CountsResults | BandsResults | NamedResults };

export interface OverlapLadder {
  partnershipId: string;
  otherOrgId: string;
  rungs: Record<OverlapLevel, RungState>;
}

export async function overlapLadder(db: Db, orgId: string, partnershipId: string): Promise<OverlapLadder> {
  const p = await loadPartnership(db, partnershipId);
  const { rows: probes } = await db.query<{
    id: string;
    requested_by_org: string;
    level: OverlapLevel;
    status: string;
    decided_at: Date | null;
    created_at: Date;
    results: CountsResults | BandsResults | NamedResults | null;
  }>(
    `select id, requested_by_org, level, status, decided_at, created_at, results
     from overlap_probes where partnership_id = $1 order by created_at desc`,
    [partnershipId],
  );

  const rungs = {} as Record<OverlapLevel, RungState>;
  let prevApproved = true; // counts has no prerequisite
  for (const level of OVERLAP_LEVELS) {
    // newest probe wins per rung (a declined rung can be re-requested)
    const probe = probes.find((x) => x.level === level);
    if (probe?.status === "approved" && probe.results) {
      rungs[level] = {
        state: "approved",
        probeId: probe.id,
        decidedAt: probe.decided_at ? new Date(probe.decided_at).toISOString().slice(0, 10) : "",
        results: probe.results,
      };
      prevApproved = true;
      continue;
    }
    if (probe?.status === "requested") {
      const requestedAt = new Date(probe.created_at).toISOString().slice(0, 10);
      rungs[level] =
        probe.requested_by_org === orgId
          ? { state: "requested_by_us", probeId: probe.id, requestedAt }
          : { state: "awaiting_you", probeId: probe.id, requestedAt };
      prevApproved = false;
      continue;
    }
    if (!prevApproved) {
      rungs[level] = { state: "locked" };
      continue;
    }
    if (probe?.status === "declined") {
      rungs[level] = {
        state: "declined",
        decidedAt: probe.decided_at ? new Date(probe.decided_at).toISOString().slice(0, 10) : "",
      };
      prevApproved = false;
      continue;
    }
    rungs[level] = { state: "available" };
    prevApproved = false;
  }
  return { partnershipId, otherOrgId: otherOrg(p, orgId), rungs };
}
