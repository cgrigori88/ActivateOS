import type { PoolClient } from "pg";
import { factIdentityKey, factValueKey, type FactSubject, type NormalizedObject, type ValueType } from "./identity";
import { loadPredicates, predicateForSignalType } from "./predicates";
import { recordChange } from "../pursuits/ledger";
import type { DataEnvironment } from "../pursuits/lineage";

/**
 * Fact candidate creation (Workstream B, §5/§27/§29/§30). Candidates are the pre-promotion
 * boundary — NEVER durable truth. Two entry points: deterministic (signal → predicate via
 * the registry) and agent-extracted (LLM → structured proposition, source-span-mandatory).
 * An unresolved predicate is kept but flagged (predicate_resolved=false) so the gate can
 * refuse to promote it (§29). A candidate with no source span is refused outright (§30/§31).
 */

/** Normalize a raw object payload into the typed envelope for a predicate's object_type. */
export function normalizeObject(objectType: ValueType, raw: unknown): NormalizedObject {
  const base: NormalizedObject = { objectType, objectValue: {} };
  switch (objectType) {
    case "DATE":
    case "DATETIME": {
      const d = raw instanceof Date ? raw : new Date(String(raw));
      if (isNaN(d.getTime())) throw new Error(`normalizeObject: invalid date "${String(raw)}"`);
      return { ...base, dateValue: d, objectValue: { iso: d.toISOString() } };
    }
    case "ENTITY_REF": {
      const ref = String(raw);
      return { ...base, entityRef: ref, objectValue: { ref } };
    }
    case "NUMBER":
    case "PERCENTAGE": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`normalizeObject: invalid number "${String(raw)}"`);
      return { ...base, numberValue: n, objectValue: { n } };
    }
    case "MONEY": {
      const o = (raw ?? {}) as { amount?: number; currency?: string };
      return { ...base, moneyAmount: o.amount ?? null, moneyCurrency: o.currency ?? "USD", objectValue: { amount: o.amount ?? null, currency: o.currency ?? "USD" } };
    }
    case "BOOLEAN":
      return { ...base, booleanValue: Boolean(raw), objectValue: { b: Boolean(raw) } };
    case "STRING":
    case "ENUM":
    default: {
      const t = typeof raw === "string" ? raw : JSON.stringify(raw);
      return { ...base, textValue: t, objectValue: { text: t } };
    }
  }
}

async function companyLabel(db: PoolClient, companyId: string | null): Promise<string> {
  if (!companyId) return "unknown";
  const { rows } = await db.query<{ legal_name: string | null; normalized_name: string | null }>(
    `select legal_name, normalized_name from companies where id = $1`, [companyId],
  );
  return rows[0]?.legal_name ?? rows[0]?.normalized_name ?? "unknown";
}

export interface CandidateResult { id: string; predicateResolved: boolean; }

/** Deterministic: promote a typed signal into a Fact candidate via the predicate registry. */
export async function createCandidateFromSignal(
  db: PoolClient, orgId: string, signalId: string, env: DataEnvironment = "PRODUCTION",
): Promise<CandidateResult | null> {
  const { rows: srows } = await db.query<{
    id: string; company_id: string; signal_type: string; taxonomy_node_id: string | null; confidence: string;
    observed_at: Date; evidence_id: string; value: Record<string, unknown> | null;
  }>(
    `select id, company_id, signal_type, taxonomy_node_id, confidence, observed_at, evidence_id, value
       from signals where id = $1`, [signalId],
  );
  const s = srows[0];
  if (!s) return null;
  const pred = await predicateForSignalType(db, s.signal_type);
  const label = await companyLabel(db, s.company_id);
  const subject: FactSubject = { subjectScope: "COMPANY", subjectRef: s.company_id, subjectLabel: label };

  let object: NormalizedObject;
  if (pred) {
    const v = s.value ?? {};
    let raw: unknown;
    if (pred.objectType === "DATE" || pred.objectType === "DATETIME") raw = (v as { event_date?: string }).event_date ?? null;
    else if (pred.objectType === "ENTITY_REF") raw = s.taxonomy_node_id ?? (v as { ref?: string }).ref ?? s.signal_type;
    else if (pred.objectType === "NUMBER" || pred.objectType === "PERCENTAGE") raw = (v as { count?: number; value?: number }).count ?? (v as { value?: number }).value ?? 1;
    else raw = (v as { text?: string }).text ?? s.signal_type;
    try { object = normalizeObject(pred.objectType, raw); }
    catch { object = normalizeObject("STRING", s.signal_type); }
  } else {
    object = normalizeObject("STRING", s.signal_type);
  }

  // Source span from the backing evidence (deterministic path: the whole verified excerpt).
  const { rows: erows } = await db.query<{ raw_excerpt: string | null; claim: string; source_url: string | null }>(
    `select raw_excerpt, claim, source_url from evidence where id = $1`, [s.evidence_id],
  );
  const excerpt = erows[0]?.raw_excerpt ?? erows[0]?.claim ?? "";

  const predicateKey = pred?.key ?? null;
  const identityKey = predicateKey ? factIdentityKey(orgId, subject, predicateKey) : null;
  const valueKey = predicateKey ? factValueKey(orgId, subject, predicateKey, object) : null;

  const { rows } = await db.query<{ id: string }>(
    `insert into fact_candidates (
       org_id, company_id, subject_scope, subject_ref, subject_label, predicate_key, predicate_resolved,
       object_type, object_value, fact_identity_key, fact_value_key, source_evidence_id, source_signal_id,
       source_span_start, source_span_end, quoted_excerpt, source_location, extraction_confidence,
       extraction_reason, extracted_by, extracted_via, status, data_environment
     ) values ($1,$2,'COMPANY',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,$13,$14,$15,$16,$17,'deterministic','SIGNAL_MAP','PENDING',$18)
     returning id`,
    [orgId, s.company_id, s.company_id, label, predicateKey, !!pred, object.objectType, object.objectValue,
     identityKey, valueKey, s.evidence_id, s.id, excerpt.length, excerpt.slice(0, 2000), erows[0]?.source_url ?? null,
     Number(s.confidence), `Deterministic signal map: ${s.signal_type}`, env],
  );
  return { id: rows[0].id, predicateResolved: !!pred };
}

export interface ExtractionCandidate {
  orgId: string;
  companyId: string | null;
  subject: FactSubject;
  predicateCandidate: string;   // proposed predicate key
  objectType: ValueType;
  objectRaw: unknown;
  sourceEvidenceId: string;
  sourceSpanStart: number;
  sourceSpanEnd: number;
  quotedExcerpt: string;
  extractionConfidence: number;
  extractionReason?: string;
  extractedBy: string;          // model id
  env?: DataEnvironment;
}

/** Agent-extracted candidate. Source span is MANDATORY (§30/§31) — no span → refused. */
export async function createCandidateFromExtraction(db: PoolClient, c: ExtractionCandidate): Promise<CandidateResult> {
  if (!c.quotedExcerpt?.trim() || !c.sourceEvidenceId) {
    throw new Error("createCandidateFromExtraction: source span + supporting evidence are mandatory (§30/§31)");
  }
  const preds = await loadPredicates(db);
  const pred = preds.get(c.predicateCandidate) ?? null;   // unknown predicate → unresolved (§29)
  const objectType = pred?.objectType ?? c.objectType;
  let object: NormalizedObject;
  try { object = normalizeObject(objectType, c.objectRaw); }
  catch { object = normalizeObject("STRING", c.objectRaw); }

  const predicateKey = pred?.key ?? null;
  const identityKey = predicateKey ? factIdentityKey(c.orgId, c.subject, predicateKey) : null;
  const valueKey = predicateKey ? factValueKey(c.orgId, c.subject, predicateKey, object) : null;

  const { rows } = await db.query<{ id: string }>(
    `insert into fact_candidates (
       org_id, company_id, subject_scope, subject_ref, subject_label, predicate_key, predicate_resolved,
       object_type, object_value, fact_identity_key, fact_value_key, source_evidence_id, source_span_start,
       source_span_end, quoted_excerpt, extraction_confidence, extraction_reason, extracted_by, extracted_via,
       status, data_environment
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'EVIDENCE_LLM','PENDING',$19)
     returning id`,
    [c.orgId, c.companyId, c.subject.subjectScope, c.subject.subjectRef ?? null, c.subject.subjectLabel,
     predicateKey, !!pred, object.objectType, object.objectValue, identityKey, valueKey, c.sourceEvidenceId,
     c.sourceSpanStart, c.sourceSpanEnd, c.quotedExcerpt.slice(0, 2000), c.extractionConfidence,
     c.extractionReason ?? null, c.extractedBy, c.env ?? "PRODUCTION"],
  );
  await recordChange(db, {
    orgId: c.orgId, pursuitId: null, entityType: "fact_candidate", entityId: rows[0].id,
    changeType: "FACT_CANDIDATE_CREATED", materiality: "LOW", reason: `Candidate extracted: ${c.predicateCandidate}`,
    actorType: "AGENT", triggerType: "INTERACTION_RECEIVED", dataEnvironment: c.env ?? "PRODUCTION",
    after: { predicateCandidate: c.predicateCandidate, resolved: !!pred },
  });
  return { id: rows[0].id, predicateResolved: !!pred };
}
