import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { writeConvergenceSnapshot } from "./convergence";
import { recordChange } from "../pursuits/ledger";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Structured Why Now (Workstream B, §21/§22/§23/§43/§44). Why Now is an OUTPUT of the
 * Fact/Signal graph, never a freeform blob — every element points at a real fact/signal/
 * convergence id and is reconstructable. Missing components are left null and NOT fabricated
 * (§43). recommended_immediate_action is a candidate at the boundary with Workstream E (§44);
 * partner_route_relevance is a scaffold completed in Workstream C (§45). A material change
 * writes a new versioned snapshot and emits WHY_NOW_CHANGED; an unchanged recompute is inert.
 */

export interface WhyNow {
  version: 1;
  generated_at: string;
  as_of: string;
  business_trigger: { fact_id: string; predicate: string; label: string; confidence: number } | null;
  technology_condition: { fact_id: string; predicate: string; label: string; confidence: number } | null;
  timing_anchor: { fact_id: string; predicate: string; date: string | null; label: string } | null;
  partner_route_relevance: { fact_id: string; reason: string } | null;
  signal_convergence: { independent_family_count: number; families: string[]; source_diversity: number; supporting_fact_ids: string[] };
  contradictory_evidence: { fact_id: string; basis: string; status: string }[];
  recommended_immediate_action: { kind: string; label: string; ref?: string } | null;
  contributing_fact_ids: string[];
  contributing_signal_ids: string[];
}

interface LinkedFact {
  id: string; predicate_key: string; relevance_type: string | null; confidence: number;
  subject_label: string; object_value: Record<string, unknown>; date_value: Date | null; family: string | null;
}

export interface AssembleResult { snapshotId: string | null; seq: number | null; whyNow: WhyNow; changed: boolean; }

export async function assembleWhyNow(db: PoolClient, pursuitId: string, asOf = new Date()): Promise<AssembleResult> {
  const p = await db.query<{ org_id: string; account_id: string; data_environment: DataEnvironment }>(
    `select org_id, account_id, data_environment from pursuits where id = $1`, [pursuitId],
  );
  if (!p.rows[0]) throw new Error(`pursuit ${pursuitId} not found`);
  const { org_id: orgId, account_id: companyId, data_environment: env } = p.rows[0];

  const linked = await db.query<LinkedFact>(
    `select f.id, f.predicate_key, pf.relevance_type, f.confidence, f.subject_label, f.object_value,
            f.date_value, f.family
       from pursuit_facts pf join facts f on f.id = pf.ref_id
      where pf.pursuit_id = $1 and f.status = 'CURRENT'
      order by f.confidence desc`,
    [pursuitId],
  );
  const facts = linked.rows.map((r) => ({ ...r, confidence: Number(r.confidence) }));

  const byRelevance = (t: string) => facts.filter((f) => f.relevance_type === t);
  const firstOr = <T,>(a: T[]): T | null => (a.length ? a[0] : null);

  const trig = firstOr(facts.filter((f) => f.family === "trigger" || f.relevance_type === "PRIMARY_TRIGGER"));
  const tech = firstOr(facts.filter((f) => f.predicate_key === "technology_in_use" || f.predicate_key === "migrating_from" || f.relevance_type === "SOLUTION_FIT"));
  const timing = firstOr(byRelevance("TIMING_ANCHOR"));
  const partner = firstOr(facts.filter((f) => f.predicate_key === "partner_relationship_exists" || f.relevance_type === "PARTNER_ROUTE"));

  // Convergence (independence-aware) — persisted as its own contemporaneous snapshot.
  const conv = await writeConvergenceSnapshot(db, orgId, pursuitId, companyId, 90, env);

  const contradictions = await db.query<{ fact_id_a: string; basis: string | null; status: string }>(
    `select fc.fact_id_a, fc.basis, fc.status from fact_contradictions fc
       join facts f on f.id = fc.fact_id_a where f.company_id = $1 and fc.status = 'open'`,
    [companyId],
  );

  const whyNow: WhyNow = {
    version: 1, generated_at: new Date().toISOString(), as_of: asOf.toISOString(),
    business_trigger: trig ? { fact_id: trig.id, predicate: trig.predicate_key, label: trig.subject_label, confidence: trig.confidence } : null,
    technology_condition: tech ? { fact_id: tech.id, predicate: tech.predicate_key, label: tech.subject_label, confidence: tech.confidence } : null,
    timing_anchor: timing ? { fact_id: timing.id, predicate: timing.predicate_key, date: timing.date_value ? timing.date_value.toISOString() : null, label: timing.subject_label } : null,
    partner_route_relevance: partner ? { fact_id: partner.id, reason: "partner relationship on account (routing completed in Workstream C)" } : null,
    signal_convergence: {
      independent_family_count: conv.result.independentFamilyCount,
      families: conv.result.families.map((x) => x.family),
      source_diversity: conv.result.sourceDiversity,
      supporting_fact_ids: conv.result.supportingFactIds,
    },
    contradictory_evidence: contradictions.rows.map((c) => ({ fact_id: c.fact_id_a, basis: c.basis ?? "", status: c.status })),
    recommended_immediate_action: deriveActionHint(trig, timing),
    contributing_fact_ids: facts.map((f) => f.id),
    contributing_signal_ids: [],
  };

  // Material-change detection: hash only the structural components (not timestamps).
  const material = JSON.stringify({
    bt: whyNow.business_trigger?.fact_id ?? null, tc: whyNow.technology_condition?.fact_id ?? null,
    ta: whyNow.timing_anchor?.fact_id ?? null, pr: whyNow.partner_route_relevance?.fact_id ?? null,
    conv: whyNow.signal_convergence.independent_family_count, contra: whyNow.contradictory_evidence.map((c) => c.fact_id).sort(),
    facts: whyNow.contributing_fact_ids.slice().sort(),
  });
  const hash = createHash("sha256").update(material).digest("hex").slice(0, 16);

  const cur = await db.query<{ why_now: WhyNow }>(
    `select why_now from pursuit_why_now_snapshots where pursuit_id = $1 and is_current`, [pursuitId],
  );
  const curHash = cur.rows[0] ? createHash("sha256").update(hashOf(cur.rows[0].why_now)).digest("hex").slice(0, 16) : null;
  if (curHash === hash) {
    return { snapshotId: null, seq: null, whyNow, changed: false };   // idempotent — no churn
  }

  const seqRow = await db.query<{ seq: number }>(`select coalesce(max(seq),0)+1 seq from pursuit_why_now_snapshots where pursuit_id = $1`, [pursuitId]);
  const seq = seqRow.rows[0].seq;
  await db.query(`update pursuit_why_now_snapshots set is_current = false where pursuit_id = $1 and is_current`, [pursuitId]);
  const ins = await db.query<{ id: string }>(
    `insert into pursuit_why_now_snapshots (org_id, pursuit_id, seq, is_current, as_of, why_now)
     values ($1,$2,$3,true,$4,$5) returning id`,
    [orgId, pursuitId, seq, asOf, JSON.stringify(whyNow)],
  );
  await db.query(`update pursuits set why_now = $2, updated_at = now() where id = $1`, [pursuitId, JSON.stringify(whyNow)]);
  await recordChange(db, {
    orgId, pursuitId, entityType: "pursuit", entityId: pursuitId, changeType: "WHY_NOW_CHANGED",
    materiality: "MEDIUM", reason: "Why Now recomposed from fact graph", actorType: "SYSTEM",
    triggerType: "MODEL_RECALCULATION", dataEnvironment: env, after: { seq, hash },
  });
  return { snapshotId: ins.rows[0].id, seq, whyNow, changed: true };
}

function hashOf(w: WhyNow): string {
  return JSON.stringify({
    bt: w.business_trigger?.fact_id ?? null, tc: w.technology_condition?.fact_id ?? null,
    ta: w.timing_anchor?.fact_id ?? null, pr: w.partner_route_relevance?.fact_id ?? null,
    conv: w.signal_convergence.independent_family_count, contra: (w.contradictory_evidence ?? []).map((c) => c.fact_id).sort(),
    facts: (w.contributing_fact_ids ?? []).slice().sort(),
  });
}

/** Deterministic action hint — a candidate handed to Workstream E, never authoritative (§44). */
function deriveActionHint(trig: LinkedFact | null, timing: LinkedFact | null): { kind: string; label: string; ref?: string } | null {
  if (timing) return { kind: "TIME_BOXED_OUTREACH", label: `Engage ahead of ${timing.predicate_key}`, ref: timing.id };
  if (trig) return { kind: "TRIGGER_FOLLOW_UP", label: `Act on ${trig.predicate_key}`, ref: trig.id };
  return null;
}
