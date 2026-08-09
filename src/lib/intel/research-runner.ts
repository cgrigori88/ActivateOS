import type pg from "pg";
import { mapSignals } from "../agents/taxonomy-mapper";
import { scoreOrg } from "../scoring/score";
import { deepResearchCompany } from "./screen";
import { withPipelineLock } from "./pipeline-lock";
import { applyPdlFirmographics } from "./providers/pdl";

/**
 * Research-trigger loop (§12, §21). `enqueueDeepResearch` writes research_jobs
 * when an account crosses an escalation gate; THIS drains them: for each
 * pending job it runs deep research on the company, re-maps and re-scores, and
 * marks the job done — turning escalation from a manual step into an autonomous
 * pipeline. Single-pass and bounded (run it on a schedule); every job records
 * its outcome so the queue is auditable.
 */

const DEFAULT_TARGET = "infrastructure-automation";

export interface ResearchRunSummary {
  processed: number;
  done: number;
  failed: number;
  /** true when a run was skipped because another run held the global lock */
  locked?: boolean;
  jobs: { companyId: string; company: string; reason: string; status: "done" | "failed"; detail: string }[];
}

/**
 * Run the queue under the shared pipeline lock. If another heavy run (a
 * research drain OR a screening sweep) holds it, this returns immediately with
 * `locked: true` instead of piling on. This is the entry point cron and the API
 * trigger should call — job-level `for update skip locked` keeps individual jobs
 * safe, but the lock keeps whole RUNS from overlapping and racing on scoreOrg.
 */
export async function runPendingResearchLocked(
  db: pg.PoolClient,
  opts: { limit?: number; orgId?: string; useLLM?: boolean } = {},
): Promise<ResearchRunSummary> {
  const outcome = await withPipelineLock(db, () => runPendingResearch(db, opts));
  if (outcome.locked) return { processed: 0, done: 0, failed: 0, locked: true, jobs: [] };
  return { ...outcome.result, locked: false };
}

/** The company's most recently scored solution, or the default motion. */
async function targetSlugFor(db: pg.PoolClient, companyId: string): Promise<string> {
  const { rows } = await db.query<{ slug: string }>(
    `select n.slug from propensity_scores p
       join taxonomy_nodes n on n.id = p.taxonomy_node_id
     where p.company_id = $1 order by p.computed_at desc limit 1`,
    [companyId],
  );
  return rows[0]?.slug ?? DEFAULT_TARGET;
}

export async function runPendingResearch(
  db: pg.PoolClient,
  opts: { limit?: number; orgId?: string; useLLM?: boolean } = {},
): Promise<ResearchRunSummary> {
  const limit = opts.limit ?? 10;
  const useLLM = opts.useLLM ?? Boolean(process.env.ANTHROPIC_API_KEY);
  const summary: ResearchRunSummary = { processed: 0, done: 0, failed: 0, jobs: [] };

  // Claim pending jobs atomically so concurrent runners don't double-process.
  const { rows: jobs } = await db.query<{
    id: string;
    org_id: string | null;
    company_id: string;
    reason: string;
  }>(
    `update research_jobs set status = 'running', started_at = now()
     where id in (
       select id from research_jobs
       where status = 'pending' ${opts.orgId ? "and org_id = $2" : ""}
       order by priority desc, created_at asc
       limit $1
       for update skip locked
     )
     returning id, org_id, company_id, reason`,
    opts.orgId ? [limit, opts.orgId] : [limit],
  );

  for (const job of jobs) {
    summary.processed++;
    const { rows: companyRows } = await db.query<{ legal_name: string; primary_domain: string | null }>(
      `select legal_name, primary_domain from companies where id = $1`,
      [job.company_id],
    );
    const company = companyRows[0];
    try {
      if (!company) throw new Error("company not found");
      const targetSlug = await targetSlugFor(db, job.company_id);
      // A PDL ticker (when pdl_company has run) opens the SEC gate for deep SEC.
      const { isPublic } = await applyPdlFirmographics(db, job.company_id).catch(() => ({ isPublic: false }));

      const deep = await deepResearchCompany(
        db,
        {
          orgId: job.org_id,
          companyId: job.company_id,
          companyName: company.legal_name,
          domain: company.primary_domain,
        },
        targetSlug,
        { researchTriggered: true, isPublicCompany: isPublic },
      );

      if (job.org_id) {
        await mapSignals(db, job.org_id, { useLLM });
        await scoreOrg(db, job.org_id, targetSlug);
      }

      const detail =
        Object.entries(deep)
          .filter(([, r]) => r.evidenceCreated > 0)
          .map(([id, r]) => `${id}:+${r.evidenceCreated}`)
          .join(" ") || "no new evidence";
      await db.query(
        `update research_jobs set status = 'done', finished_at = now(), detail = $2 where id = $1`,
        [job.id, detail.slice(0, 500)],
      );
      summary.done++;
      summary.jobs.push({
        companyId: job.company_id,
        company: company.legal_name,
        reason: job.reason,
        status: "done",
        detail,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await db.query(
        `update research_jobs set status = 'failed', finished_at = now(), detail = $2 where id = $1`,
        [job.id, detail.slice(0, 500)],
      );
      summary.failed++;
      summary.jobs.push({
        companyId: job.company_id,
        company: company?.legal_name ?? job.company_id,
        reason: job.reason,
        status: "failed",
        detail,
      });
    }
  }

  return summary;
}
