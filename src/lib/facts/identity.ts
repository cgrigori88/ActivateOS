import { createHash } from "node:crypto";

/**
 * Deterministic Fact identity (Workstream B, §8). Identity is split into two keys so that
 * time-varying propositions can update cleanly:
 *
 *   fact_identity_key — the semantic SLOT: org × subject × predicate. Two facts sharing an
 *     identity key are competing values for the same slot (renewal_date = May 15 vs June 1)
 *     and drive supersession, NOT duplication.
 *   fact_value_key    — the slot PLUS the normalized object value. Identical values collapse
 *     (idempotent promotion); different values are distinct rows in the same slot.
 *
 * Both keys are computed from readable component strings before hashing, so identity is
 * auditable; the hash keeps the stored key fixed-width and index-friendly.
 */

export type ValueType =
  | "STRING" | "NUMBER" | "BOOLEAN" | "DATE" | "DATETIME" | "ENUM"
  | "ENTITY_REF" | "MONEY" | "PERCENTAGE" | "RANGE" | "JSON";

export interface NormalizedObject {
  objectType: ValueType;
  objectValue: Record<string, unknown>;
  dateValue?: Date | null;
  numberValue?: number | null;
  textValue?: string | null;
  booleanValue?: boolean | null;
  entityRef?: string | null;
  moneyAmount?: number | null;
  moneyCurrency?: string | null;
}

export interface FactSubject {
  subjectScope: string;   // COMPANY|ACCOUNT|PRODUCT|TECHNOLOGY|PARTNER|SELLER|CONTACT|OPPORTUNITY|PURSUIT|RELATIONSHIP
  subjectRef?: string | null;
  subjectLabel: string;
}

/** Stable subject token: prefer the entity ref; fall back to a normalized label. */
function subjectToken(s: FactSubject): string {
  if (s.subjectRef) return `${s.subjectScope}:${s.subjectRef}`;
  return `${s.subjectScope}:${s.subjectLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

/** Canonical scalar form of the normalized object, for the value key. */
function objectToken(o: NormalizedObject): string {
  switch (o.objectType) {
    case "ENTITY_REF": return `ref:${o.entityRef ?? ""}`;
    case "DATE":
    case "DATETIME": return `date:${o.dateValue ? o.dateValue.toISOString().slice(0, o.objectType === "DATE" ? 10 : 19) : ""}`;
    case "NUMBER":
    case "PERCENTAGE": return `num:${o.numberValue ?? ""}`;
    case "MONEY": return `money:${o.moneyCurrency ?? ""}:${o.moneyAmount ?? ""}`;
    case "BOOLEAN": return `bool:${o.booleanValue ?? ""}`;
    case "STRING":
    case "ENUM": return `str:${(o.textValue ?? "").trim().toLowerCase()}`;
    default: return `json:${stableJson(o.objectValue)}`;
  }
}

function stableJson(v: Record<string, unknown>): string {
  return JSON.stringify(v, Object.keys(v).sort());
}

export function factIdentityKey(orgId: string, subject: FactSubject, predicateKey: string): string {
  const parts = [orgId, subjectToken(subject), predicateKey.toLowerCase()];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

export function factValueKey(orgId: string, subject: FactSubject, predicateKey: string, object: NormalizedObject): string {
  const parts = [orgId, subjectToken(subject), predicateKey.toLowerCase(), objectToken(object)];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}
