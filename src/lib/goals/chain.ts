import type { PoolClient, Pool } from "pg";

/**
 * The Goal → Motion → Pursuit → Pipeline chain (Wave 3 §2/§6).
 *
 * One place that walks the relationships the domain ALREADY has, so Goals,
 * Motions and Pipeline cannot each derive the spine slightly differently and
 * disagree about it on screen. This is a read model over existing foreign keys.
 * It defines no new domain concept, writes nothing, and computes no score.
 *
 * The relationships it walks, and their honesty:
 *
 *   goals ← revenue_motions.goal_id       DIRECT. A motion states its goal.
 *   revenue_motions ← opportunities.motion_id
 *                                          DIRECT. An opportunity states the
 *                                          motion that produced it. This is the
 *                                          Motion → Pipeline edge.
 *   revenue_motions.company_id = pursuits.account_id
 *                                          NOT direct — it is an ACCOUNT-level
 *                                          coincidence, not a claim that this
 *                                          motion created that pursuit. It is
 *                                          reported as "pursuits on the same
 *                                          account" and never as provenance.
 *                                          `revenue_motions.pursuit_id` is the
 *                                          real edge and is preferred whenever
 *                                          it is set.
 *
 * Two money figures live here and they are NOT the same measure. Wave 2 already
 * had to label this on the Goals page and the labelling is preserved:
 *   - `motionValueUsd` is motion-level (sum of estimated_value_usd on the linked
 *     motions) and is what goal progress is computed from.
 *   - `openPipelineUsd` is opportunity-level (sum of open opportunity amounts
 *     reached through motion_id).
 * They are different objects and will differ. Nothing here reconciles them; the
 * rooms state the distinction where both appear.
 */

export interface ChainMotion {
  id: string;
  account: string;
  companyId: string;
  status: string;
  outcome: string | null;
  /** Motion-level estimate. Goal progress is computed from these. */
  valueUsd: number;
  /** Opportunities reached via opportunities.motion_id. */
  oppCount: number;
  openPipelineUsd: number;
  /** Pursuits on this motion's account. Account-level, never claimed as provenance. */
  pursuitId: string | null;
}

export interface GoalChain {
  goalId: string;
  motions: ChainMotion[];
  motionValueUsd: number;
  openPipelineUsd: number;
  oppCount: number;
  /** Motions carrying no opportunity yet — the falloff between play and revenue. */
  motionsWithoutPipeline: number;
}

type Db = Pool | PoolClient;

export async function goalChain(db: Db, goalId: string): Promise<GoalChain> {
  const { rows } = await db.query<{
    id: string;
    account: string;
    company_id: string;
    status: string;
    outcome: string | null;
    value_usd: string | null;
    opp_count: string;
    open_pipeline: string;
    pursuit_id: string | null;
  }>(
    `select m.id,
            c.legal_name as account,
            m.company_id,
            m.status,
            m.outcome,
            m.estimated_value_usd as value_usd,
            (select count(*) from opportunities o where o.motion_id = m.id) as opp_count,
            (select coalesce(sum(o.amount_usd), 0) from opportunities o
              where o.motion_id = m.id and o.stage not like 'closed%') as open_pipeline,
            -- the real edge when it exists, else the account-level one, which the
            -- caller must present as "on this account" and never as provenance
            coalesce(m.pursuit_id,
                     (select p.id from pursuits p where p.account_id = m.company_id
                       order by p.current_priority_score desc nulls last limit 1)) as pursuit_id
       from revenue_motions m
       join companies c on c.id = m.company_id
      where m.goal_id = $1
      order by m.estimated_value_usd desc nulls last, c.legal_name`,
    [goalId],
  );

  const motions: ChainMotion[] = rows.map((r) => ({
    id: r.id,
    account: r.account,
    companyId: r.company_id,
    status: r.status,
    outcome: r.outcome,
    valueUsd: Number(r.value_usd ?? 0),
    oppCount: Number(r.opp_count),
    openPipelineUsd: Number(r.open_pipeline),
    pursuitId: r.pursuit_id,
  }));

  return {
    goalId,
    motions,
    motionValueUsd: motions.reduce((s, m) => s + m.valueUsd, 0),
    openPipelineUsd: motions.reduce((s, m) => s + m.openPipelineUsd, 0),
    oppCount: motions.reduce((s, m) => s + m.oppCount, 0),
    motionsWithoutPipeline: motions.filter((m) => m.oppCount === 0).length,
  };
}

/**
 * What is standing between this goal and its target, stated as conditions rather
 * than left for the reader to infer from rows (§4/§8).
 *
 * Every blocker below is read off state the system already records. Nothing is
 * scored, ranked or invented — a blocker either holds or it does not.
 */
export interface GoalBlocker {
  label: string;
  detail: string;
  /** Where the reader goes to act on it. Always a route that exists. */
  href: string;
  usd?: number;
}

export function goalBlockers(chain: GoalChain): GoalBlocker[] {
  const out: GoalBlocker[] = [];

  const drafts = chain.motions.filter((m) => m.status === "draft");
  if (drafts.length > 0) {
    out.push({
      label: `${drafts.length} motion${drafts.length === 1 ? "" : "s"} awaiting approval`,
      detail: "A drafted motion contributes nothing until a person approves it.",
      href: "/motions",
      usd: drafts.reduce((s, m) => s + m.valueUsd, 0),
    });
  }

  const noPipeline = chain.motions.filter((m) => m.status !== "draft" && m.oppCount === 0);
  if (noPipeline.length > 0) {
    out.push({
      label: `${noPipeline.length} active motion${noPipeline.length === 1 ? "" : "s"} with no opportunity yet`,
      detail: "The play is running but has produced nothing the pipeline can count.",
      href: "/motions",
      usd: noPipeline.reduce((s, m) => s + m.valueUsd, 0),
    });
  }

  return out;
}
