import type pg from "pg";
import { meddpiccFor, meddpiccScore, ELEMENTS } from "./meddpicc";
import { bridgePursuitOutcome } from "../pursuits/bridge/outcome-bridge";
import { recordChange } from "../pursuits/ledger";
import type { DataEnvironment } from "../pursuits/lineage";
import { opportunityOriginEnvironment } from "../pursuits/provenance";

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

/**
 * The provenance of a commercial event, DERIVED FROM ITS SUBJECT — never defaulted, never taken
 * from a caller, never taken from the deployment.
 *
 * THIS IS A CORRECTION, AND THE DEFECT IT FIXES IS ALREADY VISIBLE IN HOSTED DATA. `recordChange`
 * ends in `e.dataEnvironment ?? "PRODUCTION"`, so any writer that simply omits the field labels its
 * event PRODUCTION regardless of what it is actually about. On the hosted Preview project that
 * produced two `change_ledger` rows marked PRODUCTION whose pursuit is DEMO — history claiming a
 * provenance the subject never had, in the ONE store that cannot be corrected by UPDATE.
 *
 * `pursuits.data_environment` is the subject's own label, read server-side under the caller's org,
 * which is the same derivation the Pursuit Coordination server actions already use.
 *
 * ── AN OPPORTUNITY WITH NO PURSUIT: THE SLICE-1 GAP, NOW CLOSED ─────────────────────────────────
 *
 * CRM intake creates opportunities linked to no pursuit, and `opportunities` carries no
 * `data_environment` of its own. Slice 1 had nothing to derive from for those, so it SKIPPED the
 * ledger emission — losing the history rather than inventing a label, which was the right call with
 * the information available but is not a resting place.
 *
 * Slice 2 gives them a trustworthy source: the intake CREATION event in `import_batch_effects`. An
 * opportunity an import brought into existence carries that import's environment, permanently,
 * because origin is the creation event and not the latest batch to touch it.
 *
 * The order is deliberate. A pursuit, where one exists, remains the canonical subject; the intake
 * lineage is consulted only when there is none. And where neither answers, the emission is still
 * skipped — writing PRODUCTION into the one store that cannot be corrected, in the one environment
 * a learning corpus admits, would be worse than the absence.
 */
async function subjectEnvironment(
  db: pg.PoolClient, orgId: string, opportunityId: string, pursuitId: string | null,
): Promise<DataEnvironment | null> {
  return opportunityOriginEnvironment(db, orgId, opportunityId, pursuitId);
}

export async function advanceOpportunity(
  db: pg.PoolClient,
  orgId: string,
  opportunityId: string,
  to: Stage,
  note?: string,
): Promise<void> {
  const { rows } = await db.query<{
    company_id: string;
    motion_id: string | null;
    stage: Stage;
    pursuit_id: string | null;
    amount_usd: string | null;
  }>(`select company_id, motion_id, stage, pursuit_id, amount_usd from opportunities where id = $1 and org_id = $2`, [
    opportunityId,
    orgId,
  ]);
  if (rows.length === 0) throw new Error(`opportunity not found: ${opportunityId}`);
  const opp = rows[0];
  if (!canAdvance(opp.stage, to)) {
    throw new Error(`illegal stage transition: ${opp.stage} → ${to}`);
  }

  const closing = to === "closed_won" || to === "closed_lost";
  const upd = await db.query(
    `update opportunities set stage = $2, updated_at = now()
       ${closing ? ", closed_at = now()" : ""} where id = $1 and org_id = $3`,
    [opportunityId, to, orgId],
  );
  if ((upd.rowCount ?? 0) === 0) throw new Error(`opportunity not found: ${opportunityId}`);
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
    const m = (await meddpiccFor(db, orgId, [opportunityId])).get(opportunityId);
    if (m) {
      meddpicc = Object.fromEntries(ELEMENTS.map((e) => [e.key, m[e.key].status]));
      meddpiccScoreAtClose = meddpiccScore(m);
    }
  }
  /**
   * PILOT EVIDENCE (Slice 1). `outcome_events` is `app_rw=arwd` — fully mutable and deletable — and
   * carries an untyped payload with no before/after, so a stage transition written only there is
   * not durably reconstructable. `change_ledger` is the ONLY append-only commercial store in this
   * schema, its vocabulary already contains STAGE_CHANGED, and it has `before_state`/`after_state`
   * columns. So the fix needed no new table: only the emission that was missing.
   *
   * This records WHAT HAPPENED. It asserts nothing about why, and nothing about whether it was good.
   */
  const stageEnv = await subjectEnvironment(db, orgId, opportunityId, opp.pursuit_id);
  if (stageEnv) await recordChange(db, {
    orgId, pursuitId: opp.pursuit_id, entityType: "opportunity", entityId: opportunityId,
    changeType: "STAGE_CHANGED", materiality: closing ? "HIGH" : "MEDIUM",
    reason: `Opportunity stage ${opp.stage} → ${to}`,
    actorType: "USER", triggerType: "USER_OVERRIDE",
    dataEnvironment: stageEnv,
    // Amount travels with the stage so a close is reconstructable, but a stage event is NOT the
    // record of an amount change: an amount-only mutation would produce no stage event at all, and
    // `pilot-evidence-verify` pins the fact that no application path can perform one.
    before: { stage: opp.stage, amountUsd: opp.amount_usd ?? null },
    after: { stage: to, amountUsd: opp.amount_usd ?? null },
  });
  await db.query(
    `insert into outcome_events (org_id, motion_id, company_id, event_type, payload)
     values ($1, $2, $3, $4, $5)`,
    [
      orgId,
      opp.motion_id,
      opp.company_id,
      closing ? (to === "closed_won" ? "CLOSED_WON" : "CLOSED_LOST") : "OPPORTUNITY_ADVANCED",
      JSON.stringify({ opportunityId, from: opp.stage, to, note: note ?? null, meddpicc, meddpiccScore: meddpiccScoreAtClose }),
    ],
  );

  // Canonical bridge (Phase B): a deterministic pursuit link feeds the canonical outcome loop —
  // outcome → attribution → recompute. Idempotent, gated on outcome_learning, DEMO stays DEMO. The
  // legacy outcome_events write above is untouched (strangler dual-write).
  const label = closing ? (to === "closed_won" ? "CLOSED_WON" : "CLOSED_LOST") : "OPPORTUNITY_PROGRESSED";
  await bridgePursuitOutcome(db, {
    orgId, pursuitId: opp.pursuit_id, companyId: opp.company_id, label,
    valueAmount: to === "closed_won" && opp.amount_usd != null ? Number(opp.amount_usd) : null,
    sourceRef: closing ? `opp:${opportunityId}:${label}` : `opp:${opportunityId}:progressed:${to}`,
  });
}

/**
 * Promote an ACTIVE motion into an opportunity. Amount defaults to the
 * motion's estimated value; stakeholders seed from the motion's thread
 * contacts (roles unknown until a human says otherwise — we never invent
 * an org chart). The open thread links to the opportunity.
 */
export async function createOpportunityFromMotion(
  db: pg.PoolClient,
  orgId: string,
  motionId: string,
): Promise<{ opportunityId: string }> {
  const { rows: motions } = await db.query(
    `select m.company_id, m.taxonomy_node_id, m.status, m.estimated_value_usd, m.pursuit_id,
            c.legal_name, n.slug
     from revenue_motions m
     join companies c on c.id = m.company_id
     left join taxonomy_nodes n on n.id = m.taxonomy_node_id
     where m.id = $1 and m.org_id = $2`,
    [motionId, orgId],
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
    `select id from opportunities where motion_id = $1 and org_id = $2
       and stage not in ('closed_won','closed_lost')`,
    [motionId, orgId],
  );
  if (existing.length > 0) {
    // Idempotent re-promotion still refreshes the stakeholder seed — new
    // conversation participants join the map on every call.
    await seedStakeholders(existing[0].id);
    return { opportunityId: existing[0].id };
  }

  // Forward linkage (new-path enforcement): an opportunity created from a motion inherits the
  // motion's canonical pursuit_id, so future outcomes bridge deterministically without a backfill.
  const { rows: opps } = await db.query<{ id: string }>(
    `insert into opportunities (org_id, company_id, motion_id, taxonomy_node_id, name, amount_usd, pursuit_id)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      orgId,
      m.company_id,
      motionId,
      m.taxonomy_node_id,
      `${m.legal_name} — ${m.slug ?? "opportunity"}`,
      m.estimated_value_usd,
      m.pursuit_id ?? null,
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

  /**
   * PILOT EVIDENCE (Slice 1, correction). A GENUINE BUSINESS CREATION — NOT AN IMPORT.
   *
   * This path is a person promoting an ACTIVE motion: the commercial opportunity comes into
   * existence here, in this application, at this instant, so `now()` IS its business creation time
   * and recording it as such asserts nothing false. That is precisely what distinguishes it from
   * `ingest/staged.ts`, which observes an opportunity that already existed in a CRM; that path
   * writes a `crm_snapshots` row and deliberately does not claim to have created anything, because
   * the true creation time is source-side and is not among the columns an import carries.
   *
   * Without this, the only record of creation was `outcome_events` (app_rw=arwd — updatable and
   * deletable) and `opportunity_stage_transitions` (also arwd). A pilot could therefore lose the
   * fact that a deal was ever opened, and no later reconstruction could recover it. The ledger
   * vocabulary already contained OPPORTUNITY_CREATED with no writer, so again: no new table, only
   * the missing emission.
   */
  const createEnv = await subjectEnvironment(db, orgId, opportunityId, m.pursuit_id ?? null);
  if (createEnv) await recordChange(db, {
    orgId, pursuitId: m.pursuit_id ?? null, entityType: "opportunity", entityId: opportunityId,
    changeType: "OPPORTUNITY_CREATED", materiality: "HIGH",
    reason: `Opportunity opened from motion — ${m.legal_name}`,
    actorType: "USER", triggerType: "USER_OVERRIDE", triggerId: motionId,
    dataEnvironment: createEnv,
    // `before` is absent because there was nothing before: this is an origination, and an empty
    // object would be a claim about a prior state that did not exist.
    after: { stage: "discovery", amountUsd: m.estimated_value_usd == null ? null : Number(m.estimated_value_usd), motionId },
  });
  await db.query(
    `insert into outcome_events (org_id, motion_id, company_id, event_type, payload)
     values ($1, $2, $3, 'OPPORTUNITY_CREATED', $4)`,
    [orgId, motionId, m.company_id, JSON.stringify({ opportunityId })],
  );

  // Canonical bridge (Phase B): OPPORTUNITY_CREATED against the pursuit the motion carries.
  await bridgePursuitOutcome(db, {
    orgId, pursuitId: m.pursuit_id, companyId: m.company_id,
    label: "OPPORTUNITY_CREATED", sourceRef: `opp:${opportunityId}:created`,
  });

  return { opportunityId };
}
