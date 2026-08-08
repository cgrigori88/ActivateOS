import { extractDomain, nameSimilarity, normalizeCompanyName } from "./normalize";

export interface CompanyCandidate {
  id: string;
  normalizedName: string;
  primaryDomain: string | null;
  country?: string | null;
}

export interface CompanyInput {
  name: string;
  domain?: string | null;
  country?: string | null;
}

export type ResolutionMethod =
  | "exact_domain"
  | "normalized_name_geo"
  | "normalized_name"
  | "fuzzy_name";

export interface Resolution {
  companyId: string;
  method: ResolutionMethod;
  confidence: number;
}

const FUZZY_THRESHOLD = 0.8;

/**
 * Matching hierarchy (PROJECT_BRIEF §5): exact domain → normalized name +
 * geography → normalized name → fuzzy. Returns null when no candidate clears
 * the bar — the caller creates a new company (or queues LLM-assisted
 * disambiguation when multiple fuzzy candidates tie).
 */
export function resolveCompany(
  input: CompanyInput,
  candidates: CompanyCandidate[],
): Resolution | null {
  const domain = input.domain ? extractDomain(input.domain) : null;
  if (domain) {
    const hit = candidates.find((c) => c.primaryDomain === domain);
    if (hit) return { companyId: hit.id, method: "exact_domain", confidence: 0.99 };
  }

  const normalized = normalizeCompanyName(input.name);
  if (normalized) {
    const nameHits = candidates.filter((c) => c.normalizedName === normalized);
    if (nameHits.length === 1) {
      const hit = nameHits[0];
      const geoMatch =
        input.country && hit.country
          ? input.country.toLowerCase() === hit.country.toLowerCase()
          : false;
      return {
        companyId: hit.id,
        method: geoMatch ? "normalized_name_geo" : "normalized_name",
        confidence: geoMatch ? 0.95 : 0.85,
      };
    }
  }

  let best: { candidate: CompanyCandidate; score: number } | null = null;
  for (const c of candidates) {
    const score = nameSimilarity(input.name, c.normalizedName);
    if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) {
      best = { candidate: c, score };
    }
  }
  if (best) {
    return {
      companyId: best.candidate.id,
      method: "fuzzy_name",
      confidence: Math.min(0.8, best.score),
    };
  }
  return null;
}
