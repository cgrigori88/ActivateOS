import type pg from "pg";
import { meddpiccFor, meddpiccScore, ELEMENTS } from "./meddpicc";

/**
 * Opportunity lifecycle (BLUEPRINT Phase 6) — same discipline as motions:
 * whitelisted stage transitions, every move logged, closed stages terminal.
 * Weighted pipeline value uses stage probabilities that are DECLARED, not
 * learned — Phase 8 replaces them with calibrated ones.
 */

export const STAGES = [
  "discovery",
  "qualification",
  "business_validation",
  "proposal",
  "negotiation",
] as const;

export type OpenStage = (typeof STAGES)[number];
export type Stage = OpenStage | "closed_won" | "closed_lost";

/** Declared v1 win probabilities per stage (calibrated in Phase 8). */
export const STAGE_PROBABILITY: Record<Stage, number> = {
  discovery: 0.1,
  qualification: 0.2,
  business_validation: 0.4,
  proposal: 0.6,
  negotiation: 0.75,
  closed_won: 1,
  closed_lost: 0,
};

/**
 * Allowed moves: one step back (deals regress), any forward step (deals can
 * skip), close from anywhere. Closed stages are terminal.
 */
export function canAdvance(from: Stage, to: Stage): boolean {
  if (from === to) return false;
  if (from === "closed_won" || from === "closed_lost") return false;
  if (to === "closed_won" || to === "closed_lost") return true;
  const fromIdx = STAGES.indexOf(from as OpenStage);
  const toIdx = STAGES.indexOf(to as OpenStage);
  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx > fromIdx || toIdx === fromIdx - 1;
}

export interface PipelineRow {
  stage: Stage;
  amountUsd: number | null;
  /** effective stage weight for this deal (per-partner override, 0036); falls back to the declared v1 curve */
  probability?: number;
}

/** Weighted pipeline value across open opportunities. */
export function weightedPipelineValue(rows: PipelineRow[]): number {
  return Math.round(
    rows
      .filter((r) => r.stage !== "closed_won" && r.stage !== "closed_lost")
      .reduce((sum, r) => sum + (r.amountUsd ?? 0) * (r.probability ?? STAGE_PROBABILITY[r.stage]), 0),
  );
}

export interface StakeholderRow {
  role: string;
  sentiment: string;
}

/**
 * Coverage gaps — the deal-risk checklist: no economic buyer, no champion,
 * no technical buyer, or an unmitigated blocker. Order = severity.
 */
export function stakeholderGaps(stakeholders: StakeholderRow[]): string[] {
  const roles = new Set(stakeholders.map((s) => s.role));
  const gaps: string[] = [];
  if (!roles.has("economic_buyer")) gaps.push("no economic buyer identified");
  if (!roles.has("champion")) gaps.push("no champion");
  if (!roles.has("technical_buyer")) gaps.push("no technical buyer");
  if (stakeholders.some((s) => s.role === "blocker" && s.sentiment !== "positive")) {
    gaps.push("active blocker");
  }
  return gaps;
}

export async function advanceOpportunity(
  db: pg.PoolClient,
  opportunityId: string,
  to: Stage,
  note?: string,
): Promise<void> {
  const { rows } = await db.query<{
    org_id: string | null;
    company_id: string;
    motion_id: string | null;
    stage: Stage;
  }>(`select org_id, company_id, motion_id, stage from opportunities where id = $1`, [
    opportunityId,
  ]);
  if (rows.length === 0) throw new Error(`opportunity not found: ${opportunityId}`);
  const opp = rows[0];
  if (!canAdvance(opp.stage, to)) {
    throw new Error(`illegal stage transition: ${opp.stage} → ${to}`);
  }

  const closing = to === "closed_won" || to === "closed_lost";
  await db.query(
    `update opportunities set stage = $2, updated_at = now()
       ${closing ? ", closed_at = now()" : ""} where id = $1`,
    [opportunityId, to],
  );
  await db.query(
    `insert into opportunity_stage_transitions (opportunity_id, from_stage, to_stage, note)
     values ($1, $2, $3, $4)`,
    [opportunityId, opp.stage, to, note ?? null],
  );

  // On close, snapshot the MEDDPICC qualification into the outcome event: the
  // labeled example (element strengths + score) banked against won/lost. This
  // is the training signal — which qualification shapes actually convert.
  let meddpicc: Record<string, string> | undefined;
  let meddpiccScoreAtClose: number | undefined;
  if (closing) {
    const m = (await meddpiccFor(db, [opportunityId])).get(opportunityId);
    if (m) {
      meddpicc = Object.fromEntries(ELEMENTS.map((e) => [e.key, m[e.key].status]));
      meddpiccScoreAtClose = meddpiccScore(m);
    }
  }
  await db.query(
    `insert into outcome_events (org_id, motion_id, company_id, event_type, payload)
     values ($1, $2, $3, $4, $5)`,
    [
      opp.org_id,
      opp.motion_id,
      opp.company_id,
      closing ? (to === "closed_won" ? "CLOSED_WON" : "CLOSED_LOST") : "OPPORTUNITY_ADVANCED",
      JSON.stringify({ opportunityId, from: opp.stage, to, note: note ?? null, meddpicc, meddpiccScore: meddpiccScoreAtClose }),
    ],
  );
}

/**
 * Promote an ACTIVE motion into an opportunity. Amount defaults to the
 * motion's estimated value; stakeholders seed from the motion's thread
 * contacts (roles unknown until a human says otherwise — we never invent
 * an org chart). The open thread links to the opportunity.
 */
export async function createOpportunityFromMotion(
  db: pg.PoolClient,
  motionId: string,
): Promise<{ opportunityId: string }> {
  const { rows: motions } = await db.query(
    `select m.org_id, m.company_id, m.taxonomy_node_id, m.status, m.estimated_value_usd,
            c.legal_name, n.slug
     from revenue_motions m
     join companies c on c.id = m.company_id
     left join taxonomy_nodes n on n.id = m.taxonomy_node_id
     where m.id = $1`,
    [motionId],
  );
  if (motions.length === 0) throw new Error(`motion not found: ${motionId}`);
  const m = motions[0];
  if (m.status !== "active") {
    throw new Error(`opportunities are created from ACTIVE motions (this one is ${m.status})`);
  }
  const seedStakeholders = async (opportunityId: string) => {
    await db.query(
      `insert into stakeholders (opportunity_id, contact_id)
       select distinct $1::uuid, mp.contact_id
       from communication_threads t
       join messages msg on msg.thread_id = t.id
       join message_participants mp on mp.message_id = msg.id
       where t.motion_id = $2 and mp.contact_id is not null
       on conflict do nothing`,
      [opportunityId, motionId],
    );
  };

  const { rows: existing } = await db.query<{ id: string }>(
    `select id from opportunities where motion_id = $1
       and stage not in ('closed_won','closed_lost')`,
    [motionId],
  );
  if (existing.length > 0) {
    // Idempotent re-promotion still refreshes the stakeholder seed — new
    // conversation participants join the map on every call.
    await seedStakeholders(existing[0].id);
    return { opportunityId: existing[0].id };
  }

  const { rows: opps } = await db.query<{ id: string }>(
    `insert into opportunities (org_id, company_id, motion_id, taxonomy_node_id, name, amount_usd)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      m.org_id,
      m.company_id,
      motionId,
      m.taxonomy_node_id,
      `${m.legal_name} — ${m.slug ?? "opportunity"}`,
      m.estimated_value_usd,
    ],
  );
  const opportunityId = opps[0].id;

  await db.query(
    `insert into opportunity_stage_transitions (opportunity_id, from_stage, to_stage, note)
     values ($1, null, 'discovery', 'created from motion')`,
    [opportunityId],
  );

  // Seed stakeholders from everyone the conversation has touched.
  await seedStakeholders(opportunityId);

  await db.query(
    `update communication_threads set opportunity_id = $2
     where motion_id = $1 and status = 'open'`,
    [motionId, opportunityId],
  );

  await db.query(
    `insert into outcome_events (org_id, motion_id, company_id, event_type, payload)
     values ($1, $2, $3, 'OPPORTUNITY_CREATED', $4)`,
    [m.org_id, motionId, m.company_id, JSON.stringify({ opportunityId })],
  );

  return { opportunityId };
}
