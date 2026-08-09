import type pg from "pg";
import {
  claimFingerprint,
  runDeterministicChecks,
  type CheckResult,
  type EvidenceDraft,
} from "./checks";
import { computeConfidence, QUARANTINE_FLOOR, VERIFY_THRESHOLD } from "./confidence";
import { auditSampleRate } from "./trust";

/**
 * Verification orchestrator (Plane 1 + Plane 2 enqueueing).
 *
 * Stage [2] (model cross-check) is pluggable: pass a checker to enable it.
 * Without one (e.g. first-party CSV data where claim == excerpt), the
 * deterministic checks + trust + corroboration still gate every item.
 */

export type CrossChecker = (claim: string, excerpt: string) => Promise<{
  supported: boolean;
  confidence: number;
}>;

export interface VerifyOptions {
  crossCheck?: CrossChecker;
  highImpact?: boolean;
  random?: () => number; // injectable for tests
}

export interface VerifyOutcome {
  status: "verified" | "quarantined" | "rejected";
  computedConfidence: number;
  checks: CheckResult[];
  reviewReason: "sample" | "high_impact" | "checker_disagreement" | "contradiction" | null;
}

export interface StoredEvidence extends EvidenceDraft {
  id: string;
  orgId: string | null;
  companyId: string;
  sourceName: string;
  /** 'supports' (default) asserts the claim; 'refutes' disputes it. */
  stance?: "supports" | "refutes";
}

export async function verifyEvidence(
  db: pg.PoolClient,
  evidence: StoredEvidence,
  opts: VerifyOptions = {},
): Promise<VerifyOutcome> {
  const random = opts.random ?? Math.random;
  const checks = runDeterministicChecks(evidence);
  const hardFail = checks.some((c) => !c.passed && c.severity === "hard");

  // Source trust (auto-registers unknown sources at default trust).
  const { rows: sourceRows } = await db.query<{
    id: string;
    trust_score: number;
    audit_sample_rate: number;
  }>(
    `insert into signal_sources (name, kind)
     values ($1, 'external')
     on conflict (name) do update set name = excluded.name
     returning id, trust_score, audit_sample_rate`,
    [evidence.sourceName],
  );
  const source = sourceRows[0];

  // Stage [2]: model cross-check, when available.
  let checkerDisagreed = false;
  let crossCheckConfidence: number | null = null;
  if (!hardFail && opts.crossCheck && evidence.rawExcerpt) {
    const verdict = await opts.crossCheck(evidence.claim, evidence.rawExcerpt);
    checks.push({
      check: "model_cross_check",
      passed: verdict.supported,
      severity: "soft",
      detail: `checker_confidence=${verdict.confidence.toFixed(2)}`,
    });
    checkerDisagreed = !verdict.supported;
    if (verdict.supported) crossCheckConfidence = verdict.confidence;
  }

  // Stage [3]: corroboration & contradiction via claim fingerprint —
  // independent sources only (a source repeating itself is neither). Sources
  // that take the SAME stance corroborate; the OPPOSITE stance contradicts.
  const stance = evidence.stance ?? "supports";
  const opposite = stance === "supports" ? "refutes" : "supports";
  const fingerprint = claimFingerprint(evidence.companyId, evidence.claim);
  const { rows: counts } = await db.query<{ corroborations: string; contradictions: string }>(
    `select
       count(distinct source_type) filter (where stance = $4) as corroborations,
       count(distinct source_type) filter (where stance = $5) as contradictions
     from evidence
     where claim_fingerprint = $1 and id <> $2 and source_type <> $3
       and status <> 'rejected'`,
    [fingerprint, evidence.id, evidence.sourceName, stance, opposite],
  );
  const corroborations = Number(counts[0]?.corroborations ?? 0);
  const contradictions = Number(counts[0]?.contradictions ?? 0);

  // Stage [4]: computed confidence and verdict.
  const computedConfidence = computeConfidence({
    extractionConfidence: evidence.extractionConfidence,
    sourceTrust: Number(source.trust_score),
    corroborations,
    contradictions,
    crossCheckConfidence,
  });

  let status: VerifyOutcome["status"];
  if (hardFail || computedConfidence < QUARANTINE_FLOOR) status = "rejected";
  else if (checkerDisagreed || computedConfidence < VERIFY_THRESHOLD) status = "quarantined";
  else status = "verified";

  // Plane 2: what (if anything) goes to the human review queue.
  let reviewReason: VerifyOutcome["reviewReason"] = null;
  if (status !== "rejected") {
    if (checkerDisagreed) reviewReason = "checker_disagreement";
    else if (opts.highImpact) reviewReason = "high_impact";
    else if (random() < auditSampleRate(Number(source.trust_score))) reviewReason = "sample";
  }

  await db.query(
    `update evidence
     set status = $2,
         computed_confidence = $3,
         verification = $4,
         claim_fingerprint = $5
     where id = $1`,
    [
      evidence.id,
      status,
      computedConfidence,
      JSON.stringify({ checks, corroborations, contradictions, sourceTrust: Number(source.trust_score) }),
      fingerprint,
    ],
  );

  if (reviewReason) {
    await db.query(
      `insert into review_queue (org_id, evidence_id, reason)
       values ($1, $2, $3)`,
      [evidence.orgId, evidence.id, reviewReason],
    );
  }

  return { status, computedConfidence, checks, reviewReason };
}
