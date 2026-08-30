import type { PoolClient } from "pg";
import { loadPredicates, loadPolicies } from "./predicates";
import { normalizeObject, createCandidateFromSignal } from "./candidates";
import { upsertFact } from "./model";
import { attachEvidence, attachSignal, summarizeSupport, linkContradiction } from "./associations";
import { computeFactConfidence } from "./confidence";
import { factFreshness } from "./freshness";
import { recordChange } from "../pursuits/ledger";
import type { NormalizedObject, FactSubject } from "./identity";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Deterministic Fact promotion gate (Workstream B, §5/§11/§12/§33). The authoritative
 * boundary: a candidate becomes durable truth ONLY by passing a predicate-aware policy.
 * The LLM never crosses this line — extraction confidence is one bounded input, nothing
 * more. Outcomes: PROMOTED (auto), REVIEW (human adjudication), REJECTED (governance/weak).
 */

export type PromotionOutcome = "PROMOTED" | "REVIEW" | "REJECTED";
export interface PromotionResult { outcome: PromotionOutcome; candidateId: string; factId?: string; reason: string; confidence?: number; }

interface CandidateRow {
  id: string; org_id: string; company_id: string | null; subject_scope: string; subject_ref: string | null;
  subject_label: string; predicate_key: string | null; predicate_resolved: boolean; object_type: string;
  object_value: Record<string, unknown>; fact_value_key: string | null; source_evidence_id: string | null;
  source_signal_id: string | null; quoted_excerpt: string | null; extraction_confidence: string | null;
  data_environment: DataEnvironment; is_simulated: boolean; status: string;
}

async function reject(db: PoolClient, c: CandidateRow, reason: string): Promise<PromotionResult> {
  await db.query(`update fact_candidates set status = 'REJECTED', rejection_reason = $2, updated_at = now() where id = $1`, [c.id, reason]);
  await db.query(
    `insert into fact_reviews (org_id, candidate_id, system_recommendation, reason) values ($1,$2,'REJECT',$3)`,
    [c.org_id, c.id, reason],
  );
  return { outcome: "REJECTED", candidateId: c.id, reason };
}

async function review(db: PoolClient, c: CandidateRow, reason: string, proposedConfidence: number): Promise<PromotionResult> {
  await db.query(`update fact_candidates set status = 'REVIEW_REQUIRED', updated_at = now() where id = $1`, [c.id]);
  if (c.source_evidence_id) {
    await db.query(
      `insert into review_queue (org_id, evidence_id, reason, notes) values ($1,$2,'high_impact',$3)`,
      [c.org_id, c.source_evidence_id, `Fact review: ${reason}`],
    );
  }
  await db.query(
    `insert into fact_reviews (org_id, candidate_id, system_recommendation, proposed_confidence, reason)
     values ($1,$2,'REVIEW',$3,$4)`,
    [c.org_id, c.id, proposedConfidence, reason],
  );
  return { outcome: "REVIEW", candidateId: c.id, reason, confidence: proposedConfidence };
}

/**
 * Evaluate + execute the gate for one candidate. Idempotent for terminal candidates.
 * `opts.force` (used only by human-review ACCEPT, §34) bypasses the SOFT gates and provenance
 * governance — a human is asserting the fact — but the HARD guards (resolved predicate, source
 * span, backing evidence) still hold, and provenance is recorded as HUMAN_ASSERTED.
 */
export async function promoteCandidate(db: PoolClient, candidateId: string, opts: { force?: boolean } = {}): Promise<PromotionResult> {
  const { rows } = await db.query<CandidateRow>(`select * from fact_candidates where id = $1 for update`, [candidateId]);
  const c = rows[0];
  if (!c) throw new Error(`fact_candidate ${candidateId} not found`);
  if (c.status === "PROMOTED") {
    const f = await db.query<{ id: string }>(`select promoted_fact_id id from fact_candidates where id = $1`, [candidateId]);
    return { outcome: "PROMOTED", candidateId, factId: f.rows[0]?.id, reason: "already promoted" };
  }
  if (c.status === "REJECTED") return { outcome: "REJECTED", candidateId, reason: "already rejected" };

  // §29 — unknown/unresolved predicate can never become durable truth.
  if (!c.predicate_resolved || !c.predicate_key) return reject(db, c, "unknown_predicate");
  // §30/§31 — no supporting source span → refuse.
  if (!c.source_evidence_id && !c.quoted_excerpt) return reject(db, c, "no_source_span");

  const preds = await loadPredicates(db);
  const policies = await loadPolicies(db);
  const pred = preds.get(c.predicate_key)!;
  const policy = policies.get(c.predicate_key);
  const allowedProvenance = policy?.allowedProvenance ?? pred.allowedProvenanceClasses;

  // Load the backing evidence (trust, verification, first-party, freshness anchor).
  const ev = await db.query<{ status: string; computed_confidence: string | null; confidence: string; first_party: boolean; source_type: string; observed_at: Date; expires_at: Date | null }>(
    `select status, computed_confidence, confidence, first_party, source_type, observed_at, expires_at
       from evidence where id = $1`, [c.source_evidence_id],
  );
  const e = ev.rows[0];
  if (!e) return reject(db, c, "missing_evidence");

  const firstParty = e.first_party;
  const verified = e.status === "verified";
  const provenanceClass = opts.force ? "HUMAN_ASSERTED" : firstParty ? "FIRST_PARTY" : verified ? "THIRD_PARTY_VERIFIED" : "THIRD_PARTY_UNVERIFIED";
  const provenanceAllowed = allowedProvenance.includes(provenanceClass);

  if (!opts.force) {
    // Baseline: must be verified OR first-party (§38 — do not over-promote weak legacy evidence).
    if (!verified && !firstParty) return reject(db, c, "unverified_source");
    // Governance: a disallowed provenance class cannot promote a restricted predicate (§33).
    if (!provenanceAllowed) return reject(db, c, `provenance_not_allowed:${provenanceClass}`);
  }

  // Independent corroboration among sibling candidates for the same value (§8/§19).
  const sib = await db.query<{ n: string }>(
    `select count(distinct e2.source_type)::text n
       from fact_candidates fc join evidence e2 on e2.id = fc.source_evidence_id
      where fc.org_id = $1 and fc.fact_value_key = $2`,
    [c.org_id, c.fact_value_key],
  );
  const independentSourceTypes = Math.max(1, Number(sib.rows[0]?.n ?? 1));

  // Freshness at the source's observation time.
  const halfLife = pred.defaultHalfLifeDays;
  const freshness = factFreshness({ freshnessPolicy: pred.freshnessPolicy, observedLastAt: e.observed_at, halfLifeDays: halfLife });
  const base = Number(e.computed_confidence ?? e.confidence);
  const { confidence } = computeFactConfidence({
    baseSupport: base, sourceTrust: firstParty ? 0.95 : verified ? 0.75 : 0.5,
    independentSourceTypes, independentFamilies: independentSourceTypes, contradictionCount: 0, freshness, firstParty,
  });

  const minSupport = policy?.minimumSupportCount ?? 1;
  const minTrust = policy?.minimumTrust ?? 0.55;
  const ageOk = !policy?.maximumAgeDays || (Date.now() - e.observed_at.getTime()) / 86_400_000 <= policy.maximumAgeDays;

  if (!opts.force) {
    // Soft gates → route to human review (not rejection).
    if (!ageOk) return review(db, c, "support_too_old", confidence);
    if (policy?.humanReviewRequired) return review(db, c, "policy_requires_review", confidence);
    if (policy?.firstPartyRequired && !firstParty) return review(db, c, "first_party_required", confidence);
    if (policy?.corroborationRequired && independentSourceTypes < 2) return review(db, c, "corroboration_required", confidence);
    if (independentSourceTypes < minSupport) return review(db, c, "insufficient_support", confidence);
    if (confidence < minTrust) return review(db, c, "below_min_trust", confidence);
    if (policy && !policy.autoPromoteAllowed) return review(db, c, "auto_promote_disallowed", confidence);
  }

  // ---- PROMOTE ----
  const subject: FactSubject = { subjectScope: c.subject_scope, subjectRef: c.subject_ref, subjectLabel: c.subject_label };
  const object: NormalizedObject = normalizeObject(pred.objectType, objectRaw(c));
  const isDated = pred.freshnessPolicy === "VALID_UNTIL" || pred.freshnessPolicy === "EVENT";
  const dated = object.dateValue ?? null;

  const res = await upsertFact(db, {
    orgId: c.org_id, subject, companyId: c.company_id, predicateKey: c.predicate_key, object,
    confidence, confidenceModelVersion: "v1-facts-deterministic", provenanceClass,
    originKind: c.source_signal_id ? "SIGNAL_PROMOTION" : "EVIDENCE_PROMOTION", family: pred.family,
    freshnessPolicy: pred.freshnessPolicy, halfLifeDays: halfLife, asOf: e.observed_at, observedAt: e.observed_at,
    validUntil: pred.freshnessPolicy === "VALID_UNTIL" ? dated : null, occurredAt: pred.freshnessPolicy === "EVENT" ? dated : null,
    createdByActorType: "system", createdVia: c.source_signal_id ? "SIGNAL_PROMOTION" : "EVIDENCE_PROMOTION",
    dataEnvironment: c.data_environment, isSimulated: c.is_simulated,
  });

  await attachEvidence(db, res.id, c.source_evidence_id!, "SUPPORTS", e.observed_at, base, "promotion");
  if (c.source_signal_id) await attachSignal(db, res.id, c.source_signal_id, "SUPPORTS", e.observed_at, base, "promotion");

  // Recompute confidence from the fact's full support set (corroboration now reflected).
  const sum = await summarizeSupport(db, res.id);
  const recomputed = computeFactConfidence({
    baseSupport: sum.strongestSupport, sourceTrust: sum.strongestTrust, independentSourceTypes: sum.independentSourceTypes,
    independentFamilies: sum.independentFamilies, contradictionCount: sum.contradictionCount, freshness, firstParty: sum.firstParty,
  });
  await db.query(`update facts set confidence = $2, confidence_model_version = $3, updated_at = now() where id = $1`,
    [res.id, recomputed.confidence, recomputed.modelVersion]);

  // Competing-value / temporal contradiction when a prior value was superseded (§14/§15).
  if (res.mode === "SUPERSEDED_PRIOR") {
    const prior = await db.query<{ supersedes: string | null }>(`select supersedes from facts where id = $1`, [res.id]);
    const priorId = prior.rows[0]?.supersedes;
    if (priorId && (pred.contradictionStrategy === "COMPETING_VALUE" || pred.contradictionStrategy === "TEMPORAL_CONFLICT")) {
      await linkContradiction(db, c.org_id, priorId, res.id, pred.contradictionStrategy, `New value in slot ${c.predicate_key}`, c.data_environment);
    }
  }

  await db.query(`update fact_candidates set status = 'PROMOTED', promoted_fact_id = $2, updated_at = now() where id = $1`, [c.id, res.id]);
  return { outcome: "PROMOTED", candidateId: c.id, factId: res.id, reason: `auto (${independentSourceTypes} src)`, confidence: recomputed.confidence };
}

function objectRaw(c: CandidateRow): unknown {
  const v = c.object_value ?? {};
  if ("iso" in v) return (v as { iso: string }).iso;
  if ("ref" in v) return (v as { ref: string }).ref;
  if ("n" in v) return (v as { n: number }).n;
  if ("amount" in v) return v;
  if ("b" in v) return (v as { b: boolean }).b;
  if ("text" in v) return (v as { text: string }).text;
  return v;
}

/** Convenience: signal → candidate → gate (the deterministic promotion path). */
export async function promoteFromSignal(db: PoolClient, orgId: string, signalId: string, env: DataEnvironment = "PRODUCTION"): Promise<PromotionResult | null> {
  const cand = await createCandidateFromSignal(db, orgId, signalId, env);
  if (!cand) return null;
  return promoteCandidate(db, cand.id);
}
