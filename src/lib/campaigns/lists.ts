import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/**
 * Campaign ↔ target-list plumbing (#54). A campaign's reach is the union of the
 * accounts in every linked list (account_populations) plus its legacy seed
 * account. Each account carries a live personalization snapshot (top-fit
 * solution, latest verified signal, engagement) that powers the per-recipient
 * "account angle" layer of a touch.
 */

export interface CampaignAccount {
  companyId: string;
  legalName: string;
  domain: string | null;
  industry: string | null;
  solution: string | null;
  score: number | null;
  trigger: string | null;
  engagement: number | null;
  sources: string;
}

export interface LinkedList {
  populationId: string;
  name: string;
  category: string;
  partnerName: string | null;
  members: number;
}

export interface AttachableList extends LinkedList {
  avgScore: number | null;
  overlap: number; // members already in the campaign's reach
  suggested: boolean;
  reason: string;
}

/** Merge variables resolved from an account's real data, for the angle layer. */
export interface MergeVars {
  account: string;
  industry: string;
  solution: string;
  trigger: string;
  domain: string;
}

export const ANGLE_TOKENS: { token: string; label: string }[] = [
  { token: "{{account}}", label: "Account name" },
  { token: "{{industry}}", label: "Industry" },
  { token: "{{solution}}", label: "Top-fit solution" },
  { token: "{{trigger}}", label: "Latest verified signal" },
  { token: "{{domain}}", label: "Domain" },
];

/** The scalable default angle — works before any AI/editing, purely templated. */
export const DEFAULT_ANGLE =
  "For {{account}}, the {{trigger}} is exactly why teams in {{industry}} are prioritizing {{solution}} right now.";

const short = (s: string | null, n = 120): string =>
  !s ? "" : s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

export async function mergeAccountData(db: Db, companyId: string): Promise<MergeVars> {
  const { rows } = await db.query<{
    legal_name: string;
    primary_domain: string | null;
    industry: string | null;
    solution: string | null;
    trigger: string | null;
  }>(
    `select c.legal_name, c.primary_domain, c.industry,
            (select n.name from propensity_scores p join taxonomy_nodes n on n.id = p.taxonomy_node_id
              where p.company_id = c.id order by p.score desc nulls last, p.computed_at desc limit 1) as solution,
            (select e.claim from evidence e
              where e.company_id = c.id and e.status = 'verified'
              order by e.computed_confidence desc nulls last, e.observed_at desc limit 1) as trigger
     from companies c where c.id = $1`,
    [companyId],
  );
  const r = rows[0];
  return {
    account: r?.legal_name ?? "this account",
    industry: r?.industry ?? "your sector",
    solution: r?.solution ?? "this initiative",
    trigger: short(r?.trigger ?? null) || "recent shift we're seeing",
    domain: r?.primary_domain ?? "",
  };
}

/** Resolve {{tokens}} against an account's merge vars; empty vars fall back softly. */
export function renderAngle(template: string | null, vars: MergeVars): string {
  const t = (template && template.trim()) || DEFAULT_ANGLE;
  return t
    .replace(/\{\{\s*account\s*\}\}/gi, vars.account)
    .replace(/\{\{\s*industry\s*\}\}/gi, vars.industry)
    .replace(/\{\{\s*solution\s*\}\}/gi, vars.solution)
    .replace(/\{\{\s*trigger\s*\}\}/gi, vars.trigger)
    .replace(/\{\{\s*domain\s*\}\}/gi, vars.domain)
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Accounts that roll into a campaign: union of linked lists' members + seed. */
export async function campaignAccounts(db: Db, campaignId: string): Promise<CampaignAccount[]> {
  const { rows } = await db.query<{
    id: string;
    legal_name: string;
    primary_domain: string | null;
    industry: string | null;
    solution: string | null;
    score: string | null;
    trigger: string | null;
    engagement: string | null;
    sources: string;
  }>(
    `with rows as (
       select pm.company_id, ap.name as src
       from campaign_populations cp
       join population_members pm on pm.population_id = cp.population_id
       join account_populations ap on ap.id = cp.population_id
       where cp.campaign_id = $1
       union all
       select company_id, 'campaign seed' from campaigns where id = $1 and company_id is not null
     )
     select c.id, c.legal_name, c.primary_domain, c.industry,
            string_agg(distinct r.src, ' · ') as sources,
            (select n.name from propensity_scores p join taxonomy_nodes n on n.id = p.taxonomy_node_id
              where p.company_id = c.id order by p.score desc nulls last, p.computed_at desc limit 1) as solution,
            (select round(p.score) from propensity_scores p
              where p.company_id = c.id order by p.score desc nulls last, p.computed_at desc limit 1) as score,
            (select e.claim from evidence e
              where e.company_id = c.id and e.status = 'verified'
              order by e.computed_confidence desc nulls last, e.observed_at desc limit 1) as trigger,
            (select round(es.engagement_score) from engagement_scores es
              where es.company_id = c.id and es.contact_id is null
              order by es.computed_at desc limit 1) as engagement
     from rows r join companies c on c.id = r.company_id
     group by c.id, c.legal_name, c.primary_domain, c.industry
     order by score desc nulls last, c.legal_name`,
    [campaignId],
  );
  return rows.map((r) => ({
    companyId: r.id,
    legalName: r.legal_name,
    domain: r.primary_domain,
    industry: r.industry,
    solution: r.solution,
    score: r.score == null ? null : Number(r.score),
    trigger: r.trigger,
    engagement: r.engagement == null ? null : Number(r.engagement),
    sources: r.sources,
  }));
}

export async function linkedLists(db: Db, campaignId: string): Promise<LinkedList[]> {
  const { rows } = await db.query<{
    population_id: string;
    name: string;
    category: string;
    partner_name: string | null;
    members: number;
  }>(
    `select ap.id as population_id, ap.name, ap.category, p.name as partner_name,
            (select count(*)::int from population_members m where m.population_id = ap.id) as members
     from campaign_populations cp
     join account_populations ap on ap.id = cp.population_id
     left join partners p on p.id = ap.partner_id
     where cp.campaign_id = $1
     order by ap.name`,
    [campaignId],
  );
  return rows.map((r) => ({
    populationId: r.population_id,
    name: r.name,
    category: r.category,
    partnerName: r.partner_name,
    members: Number(r.members),
  }));
}

/**
 * Approved lists not yet linked, ranked by fit so the top ones read as
 * suggestions the human can accept. Fit = average best-propensity of the list's
 * members, with overlap against the campaign's current reach surfaced. Purely
 * heuristic (no external AI needed), so it works in every environment.
 */
export async function attachableLists(db: Db, campaignId: string, orgId: string): Promise<AttachableList[]> {
  const { rows } = await db.query<{
    population_id: string;
    name: string;
    category: string;
    partner_name: string | null;
    members: number;
    avg_score: string | null;
    overlap: number;
  }>(
    `with reach as (
       select pm.company_id from campaign_populations cp
         join population_members pm on pm.population_id = cp.population_id
         where cp.campaign_id = $1
       union
       select company_id from campaigns where id = $1 and company_id is not null
     )
     select ap.id as population_id, ap.name, ap.category, p.name as partner_name,
            (select count(*)::int from population_members m where m.population_id = ap.id) as members,
            (select round(avg(best.s)) from population_members m
               cross join lateral (
                 select max(ps.score) as s from propensity_scores ps where ps.company_id = m.company_id
               ) best
             where m.population_id = ap.id and best.s is not null) as avg_score,
            (select count(*)::int from population_members m
              where m.population_id = ap.id and m.company_id in (select company_id from reach)) as overlap
     from account_populations ap
     left join partners p on p.id = ap.partner_id
     where ap.org_id = $2 and ap.status = 'approved'
       and ap.id not in (select population_id from campaign_populations where campaign_id = $1)
     order by avg_score desc nulls last, members desc`,
    [campaignId, orgId],
  );
  const mapped = rows.map((r) => {
    const avgScore = r.avg_score == null ? null : Number(r.avg_score);
    const members = Number(r.members);
    const overlap = Number(r.overlap);
    const bits = [`${members} account${members === 1 ? "" : "s"}`];
    if (avgScore != null) bits.push(`avg fit ${avgScore}`);
    if (overlap > 0) bits.push(`${overlap} already in reach`);
    return {
      populationId: r.population_id,
      name: r.name,
      category: r.category,
      partnerName: r.partner_name,
      members,
      avgScore,
      overlap,
      suggested: false,
      reason: bits.join(" · "),
    };
  });
  // Top-fit lists with fresh accounts read as the AI/heuristic suggestions.
  mapped
    .filter((l) => l.members > 0 && l.overlap < l.members)
    .slice(0, 2)
    .forEach((l) => (l.suggested = true));
  return mapped;
}

export async function linkPopulation(db: Db, campaignId: string, populationId: string, addedBy: string): Promise<void> {
  await db.query(
    `insert into campaign_populations (campaign_id, population_id, added_by)
     values ($1, $2, $3) on conflict do nothing`,
    [campaignId, populationId, addedBy],
  );
}

export async function unlinkPopulation(db: Db, campaignId: string, populationId: string): Promise<void> {
  await db.query(`delete from campaign_populations where campaign_id = $1 and population_id = $2`, [campaignId, populationId]);
}
