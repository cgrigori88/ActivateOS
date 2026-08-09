/**
 * Plane 1, stage [1]: deterministic evidence checks (docs/QUALITY_AND_LEARNING.md).
 * Pure functions — no I/O — so they are cheap, testable, and run on every item.
 */

export interface CheckResult {
  check: string;
  passed: boolean;
  severity: "hard" | "soft";
  detail?: string;
}

export interface EvidenceDraft {
  claim: string;
  rawExcerpt?: string | null;
  observedAt: Date;
  extractionConfidence: number;
  companyId?: string | null;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "for", "to", "is", "are",
  "was", "were", "with", "by", "at", "its", "their", "has", "have", "had",
]);

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Heuristic support check: enough of the claim's content words must appear in
 * the excerpt. This is the cheap first line; the model cross-check (stage [2])
 * is the semantic one. No excerpt at all is a soft failure — first-party data
 * (customer CSV) legitimately has claim == excerpt.
 */
export function claimSupportedByExcerpt(claim: string, excerpt: string | null | undefined): CheckResult {
  if (!excerpt || !excerpt.trim()) {
    return { check: "excerpt_support", passed: false, severity: "soft", detail: "no excerpt provided" };
  }
  const claimTokens = contentTokens(claim);
  if (claimTokens.length === 0) {
    return { check: "excerpt_support", passed: false, severity: "hard", detail: "claim has no content" };
  }
  const excerptTokens = new Set(contentTokens(excerpt));
  const hits = claimTokens.filter((t) => excerptTokens.has(t)).length;
  const coverage = hits / claimTokens.length;
  return {
    check: "excerpt_support",
    passed: coverage >= 0.4,
    severity: coverage < 0.15 ? "hard" : "soft",
    detail: `coverage=${coverage.toFixed(2)}`,
  };
}

export function claimWellFormed(claim: string): CheckResult {
  const trimmed = claim.trim();
  const ok = trimmed.length >= 15 && trimmed.length <= 600;
  return {
    check: "claim_well_formed",
    passed: ok,
    severity: "hard",
    detail: ok ? undefined : `length=${trimmed.length}`,
  };
}

export function datePlausible(observedAt: Date, now: Date = new Date()): CheckResult {
  const ageMs = now.getTime() - observedAt.getTime();
  const tenYears = 10 * 365 * 24 * 3600 * 1000;
  const oneDayFuture = -24 * 3600 * 1000;
  const ok = ageMs >= oneDayFuture && ageMs <= tenYears;
  return { check: "date_plausible", passed: ok, severity: "hard" };
}

export function entityResolved(companyId: string | null | undefined): CheckResult {
  return {
    check: "entity_resolved",
    passed: Boolean(companyId),
    severity: "hard",
    detail: companyId ? undefined : "no resolved company",
  };
}

export function confidenceSane(extractionConfidence: number): CheckResult {
  const ok = extractionConfidence > 0 && extractionConfidence <= 1;
  return { check: "confidence_sane", passed: ok, severity: "hard" };
}

export function runDeterministicChecks(draft: EvidenceDraft): CheckResult[] {
  return [
    claimWellFormed(draft.claim),
    datePlausible(draft.observedAt),
    entityResolved(draft.companyId),
    confidenceSane(draft.extractionConfidence),
    claimSupportedByExcerpt(draft.claim, draft.rawExcerpt),
  ];
}

/** Normalized fingerprint so independent sources making the same claim corroborate. */
export function claimFingerprint(companyId: string, claim: string): string {
  const tokens = contentTokens(claim).sort();
  return `${companyId}:${tokens.join("-")}`;
}
