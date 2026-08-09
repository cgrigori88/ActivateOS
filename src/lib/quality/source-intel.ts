/**
 * Source Intelligence (BLUEPRINT): a source is judged on two axes —
 * accuracy (its evidence survives verification: trust_score, trust.ts) and
 * PREDICTIVE VALUE (its evidence powers accounts that actually score hot).
 * A source can be perfectly accurate and commercially useless; this measures
 * the difference. Pure math, no model calls.
 */

/** One evidence item's appearance in the latest score of a company × solution. */
export interface ScoredEvidenceRow {
  sourceType: string;
  evidenceId: string;
  band: string;
}

export interface SourceIntel {
  scoredEvidence: number;
  highBandEvidence: number;
  predictiveValue: number;
}

// Laplace smoothing: a source with 2-for-2 high-band hits should not outrank
// an 80-for-100 source. Prior expects 1 hit in 4 until data says otherwise.
const PRIOR_HITS = 1;
const PRIOR_N = 4;

export function computeSourceIntel(rows: ScoredEvidenceRow[]): Map<string, SourceIntel> {
  const seen = new Map<string, { scored: Set<string>; high: Set<string> }>();
  for (const r of rows) {
    const entry = seen.get(r.sourceType) ?? { scored: new Set(), high: new Set() };
    entry.scored.add(r.evidenceId);
    if (r.band === "very_high" || r.band === "high") entry.high.add(r.evidenceId);
    seen.set(r.sourceType, entry);
  }

  const out = new Map<string, SourceIntel>();
  for (const [source, { scored, high }] of seen) {
    out.set(source, {
      scoredEvidence: scored.size,
      highBandEvidence: high.size,
      predictiveValue:
        Math.round(((high.size + PRIOR_HITS) / (scored.size + PRIOR_N)) * 1000) / 1000,
    });
  }
  return out;
}
