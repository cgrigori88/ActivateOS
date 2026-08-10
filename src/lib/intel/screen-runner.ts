import type pg from "pg";
import { mapSignals } from "../agents/taxonomy-mapper";
import { scoreOrg } from "../scoring/score";
import { enqueueDeepResearch, screenCompany } from "./screen";
import { withPipelineLock } from "./pipeline-lock";
import { applyPdlFirmographics } from "./providers/pdl";

/**
 * Screening sweep (§21, §34): the front of the autonomous loop. Re-runs the
 * cheap SCREEN across an org's portfolio on a cadence — picking up new hiring,
 * news, tech, and infra signals — then re-maps, re-scores, and enqueues deep
 * research for accounts that now cross an escalation gate. That keeps
 * `research_jobs` filled, which the research runner drains. Screening → gate →
 * research → re-score, with no human in the loop.
 *
 * Cheap by construction: content-hash change detection means unchanged sources
 * cost nothing (no re-fetch downstream, no LLM), so a daily sweep spends only
 * where something actually moved.
 */

const DEFAULT_TARGET = "infrastructure-automation";

export interface SweepSummary {
  screened: number;
  evidenceCreated: number;
  enqueued: number;
  locked?: boolean;
  accounts: { company: string; evidence: number }[];
}

/** The company's most recently scored solution, or the sweep default. */
async function targetSlugFor(db: pg.PoolClient, companyId: string, fallback: string): Promise<string> {
  const { rows } = await db.query<{ slug: string }>(
    `select n.slug from propensity_scores p
       join taxonomy_nodes n on n.id = p.taxonomy_node_id
     where p.company_id = $1 order by p.computed_at desc limit 1`,
    [companyId],
  );
  return rows[0]?.slug ?? fallback;
}

/** Screen one org's portfolio. NOT locked — call runScreeningSweepLocked. */
export async function runScreeningSweep(
  db: pg.PoolClient,
  orgId: string,
  opts: { limit?: number; targetSlug?: string; useLLM?: boolean } = {},
): Promise<SweepSummary> {
  const limit = opts.limit ?? 25;
  const sweepSlug = opts.targetSlug ?? DEFAULT_TARGET;
  const useLLM = opts.useLLM ?? Boolean(process.env.ANTHROPIC_API_KEY);
  const summary: SweepSummary = { screened: 0, evidenceCreated: 0, enqueued: 0, accounts: [] };

  // Portfolio = accounts this org already tracks (scored or has evidence),
  // hot tiers first so a capped run spends budget where propensity is highest.
  const { rows: companies } = await db.query<{ id: string; legal_name: string; primary_domain: string | null }>(
    `select c.id, c.legal_name, c.primary_domain
       from companies c
      where exists (select 1 from propensity_scores p where p.company_id = c.id and p.org_id = $1)
         or exists (select 1 from evidence e where e.company_id = c.id and e.org_id = $1)
         or exists (select 1 from partner_accounts pa where pa.company_id = c.id and pa.org_id = $1)
      order by array_position(array['very_high','high','medium','low'], coalesce(c.refresh_tier, 'low')),
               c.legal_name
      limit $2`,
    [orgId, limit],
  );

  for (const c of companies) {
    const targetSlug = await targetSlugFor(db, c.id, sweepSlug);
    // PDL firmographics from a prior sweep both enrich the entity and tell us
    // whether SEC applies this pass (first ever sweep: no ticker yet → SEC is
    // deferred to deep research, which reads the ticker PDL writes here).
    const { isPublic } = await applyPdlFirmographics(db, c.id).catch(() => ({ isPublic: false }));

    let evidence = 0;
    try {
      const results = await screenCompany(
        db,
        { orgId, companyId: c.id, companyName: c.legal_name, domain: c.primary_domain },
        { targetSlug, isPublicCompany: isPublic },
      );
      evidence = Object.values(results).reduce((n, r) => n + r.evidenceCreated, 0);
    } catch {
      /* one account failing never aborts the sweep */
    }
    summary.screened++;
    summary.evidenceCreated += evidence;
    summary.accounts.push({ company: c.legal_name, evidence });
  }

  if (companies.length > 0) {
    await mapSignals(db, orgId, { useLLM });
    await scoreOrg(db, orgId, sweepSlug);
    const { enqueued } = await enqueueDeepResearch(db, orgId);
    summary.enqueued = enqueued;
  }

  return summary;
}

/** Screen one org's portfolio under the shared pipeline lock. */
export async function runScreeningSweepLocked(
  db: pg.PoolClient,
  orgId: string,
  opts: { limit?: number; targetSlug?: string; useLLM?: boolean } = {},
): Promise<SweepSummary> {
  const outcome = await withPipelineLock(db, () => runScreeningSweep(db, orgId, opts));
  if (outcome.locked) return { screened: 0, evidenceCreated: 0, enqueued: 0, locked: true, accounts: [] };
  return { ...outcome.result, locked: false };
}

export interface AllOrgsSweepSummary {
  orgs: number;
  screened: number;
  evidenceCreated: number;
  enqueued: number;
  locked: boolean;
  byOrg: { org: string; summary: SweepSummary }[];
}

/**
 * Sweep every organization (or one named org), each under the shared lock.
 * Shared by the CLI and the Railway worker so scheduled and manual sweeps run
 * identical logic.
 */
export async function runScreeningSweepAllOrgs(
  db: pg.PoolClient,
  opts: { orgName?: string; limit?: number; targetSlug?: string; useLLM?: boolean } = {},
): Promise<AllOrgsSweepSummary> {
  const { rows: orgs } = opts.orgName
    ? await db.query<{ id: string; name: string }>(`select id, name from organizations where name = $1`, [opts.orgName])
    : await db.query<{ id: string; name: string }>(`select id, name from organizations order by name`);

  const out: AllOrgsSweepSummary = {
    orgs: 0, screened: 0, evidenceCreated: 0, enqueued: 0, locked: false, byOrg: [],
  };
  for (const org of orgs) {
    const summary = await runScreeningSweepLocked(db, org.id, {
      limit: opts.limit, targetSlug: opts.targetSlug, useLLM: opts.useLLM,
    });
    if (summary.locked) {
      out.locked = true; // another pipeline run is active — stop this pass
      break;
    }
    out.orgs++;
    out.screened += summary.screened;
    out.evidenceCreated += summary.evidenceCreated;
    out.enqueued += summary.enqueued;
    out.byOrg.push({ org: org.name, summary });
  }
  return out;
}
