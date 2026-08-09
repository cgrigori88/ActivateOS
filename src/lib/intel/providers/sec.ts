import { z } from "zod";
import { completeStructured } from "../../ai/client";
import { filingText, filingUrl, lookupCIK, recentFilings } from "../../research/edgar";
import { contentHash } from "../pipeline";
import type {
  EvidenceCandidate,
  IntelligenceProvider,
  IntelligenceTarget,
  ProviderHealth,
  RawObservationInput,
} from "../provider";

/**
 * SEC EDGAR strategic-signal provider (DIRECTIVE §4, §23). High-trust
 * primary-source evidence for public companies. Staged processing to keep
 * cost down: fetch discovers filings and does DETERMINISTIC keyword section
 * identification (no LLM); normalize sends only the relevant windows to a
 * CHEAP model for structured signal extraction. Whole 100–300pp filings
 * never reach a frontier model.
 */

// Concept keywords → the section windows worth extracting (§4, §23).
const SECTION_KEYWORDS = [
  "artificial intelligence", "\\bai\\b", "machine learning",
  "cloud migration", "cloud", "infrastructure moderniz", "modernization",
  "automation", "cybersecurity", "digital transformation", "data moderniz",
  "cost reduction", "operating efficiency", "productivity", "restructuring",
  "margin expansion", "capital investment", "capex",
  "acquisition", "merger", "divestiture", "expansion", "new facility",
  "layoff", "workforce reduction", "budget", "impairment", "headcount",
];
const KEYWORD_RE = new RegExp(`(${SECTION_KEYWORDS.join("|")})`, "gi");
const WINDOW = 600; // chars of context around a keyword hit
const MAX_WINDOWS = 8; // cap the LLM payload — cost control
const MAX_FILINGS = 2;

/** Deterministic: pull context windows around concept keywords. Pure. */
export function relevantSections(text: string): string[] {
  const hits: { start: number; end: number }[] = [];
  for (const m of text.matchAll(KEYWORD_RE)) {
    const i = m.index ?? 0;
    hits.push({ start: Math.max(0, i - WINDOW / 2), end: Math.min(text.length, i + WINDOW / 2) });
  }
  // Merge overlapping windows so we don't send the same span twice.
  hits.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && h.start <= last.end) last.end = Math.max(last.end, h.end);
    else merged.push({ ...h });
  }
  return merged.slice(0, MAX_WINDOWS).map((w) => text.slice(w.start, w.end).trim());
}

const secSchema = z.object({
  signals: z.array(
    z.object({
      claim: z.string().describe("One specific factual assertion the filing makes about the company"),
      excerpt: z.string().describe("Verbatim quote from the filing text supporting the claim"),
      category: z.enum([
        "strategic_initiative", "economic_initiative", "corporate_change", "negative_business",
      ]),
      signal_type: z.enum([
        "AI_INITIATIVE", "CLOUD_MIGRATION", "INFRA_MODERNIZATION", "CYBERSECURITY_INITIATIVE",
        "COST_REDUCTION", "M_AND_A", "DATACENTER_EXPANSION", "RESTRUCTURING",
        "LAYOFFS", "BUDGET_REDUCTION", "PROJECT_DELAYED",
      ]),
    }),
  ),
});

// Map the extractor's enum to registered signal types (RESTRUCTURING → negative).
const SIGNAL_ALIAS: Record<string, string> = {
  RESTRUCTURING: "BUDGET_REDUCTION",
  DATACENTER_EXPANSION: "DATACENTER_EXPANSION",
};

interface SecPayload {
  form: string;
  filingDate: string;
  url: string;
  sections: string[];
}

export class SecProvider implements IntelligenceProvider {
  providerId = "sec_edgar";
  providerType = "PUBLIC_COMPANY" as const;
  costClass = "LOW_COST" as const; // uses cheap-tier LLM on small windows
  sourceTrustPrior = 0.9; // primary-source regulatory filings
  sourceKind = "external" as const;
  supportedFamilies = ["STRATEGIC_CHANGE" as const, "BUSINESS_TRIGGER" as const, "NEGATIVE_BUSINESS" as const];
  minRefreshHours = 24 * 14; // filings are infrequent; check biweekly

  async discover(target: IntelligenceTarget): Promise<Record<string, string> | null> {
    const hit = await lookupCIK(target.companyName);
    return hit ? { cik: hit.cik } : null;
  }

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    const cik = target.handles?.cik;
    if (!cik) return []; // not a public company / no filings — absence, not error

    const filings = await recentFilings(cik, ["8-K", "10-K", "10-Q"], MAX_FILINGS);
    const out: RawObservationInput[] = [];
    for (const f of filings) {
      const text = await filingText(cik, f);
      const sections = relevantSections(text); // deterministic, no LLM
      if (sections.length === 0) continue; // nothing commercially relevant
      const payload: SecPayload = {
        form: f.form,
        filingDate: f.filingDate,
        url: filingUrl(cik, f),
        sections,
      };
      out.push({
        externalRecordId: f.accessionNumber,
        sourceUrl: payload.url,
        sourcePublishedAt: new Date(f.filingDate),
        payload,
        contentHash: contentHash(`sec:${f.accessionNumber}`),
      });
    }
    return out;
  }

  async normalize(
    current: { payload: unknown; isNew: boolean }[],
    _history: { payload: unknown; observedAt: Date }[],
    target: IntelligenceTarget,
  ): Promise<EvidenceCandidate[]> {
    const out: EvidenceCandidate[] = [];
    for (const obs of current) {
      if (!obs.isNew) continue;
      const p = obs.payload as SecPayload;
      // Only the relevant windows go to the model — never the whole filing.
      const context = p.sections.join("\n---\n").slice(0, 12_000);
      let extracted;
      try {
        extracted = await completeStructured({
          tier: "cheap",
          system:
            "You extract commercial signals from excerpts of a public company's SEC filing. " +
            "Extract only specific, filing-supported assertions about strategic initiatives, " +
            "economic initiatives, corporate changes, or negative business developments. " +
            "Quote the supporting excerpt verbatim. If nothing commercially relevant, return an empty list.",
          user: `Company: ${target.companyName}\nForm: ${p.form} (${p.filingDate})\n\nExcerpts:\n${context}`,
          schema: secSchema,
          maxTokens: 2048,
        });
      } catch {
        continue; // extraction failure on one filing never aborts the run
      }
      for (const s of extracted.signals) {
        out.push({
          claim: s.claim,
          excerpt: s.excerpt,
          sourceUrl: p.url,
          confidence: 0.9,
          firstParty: false,
          publishedAt: new Date(p.filingDate),
          suggestedSignalType: SIGNAL_ALIAS[s.signal_type] ?? s.signal_type,
        });
      }
    }
    return out;
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const hit = await lookupCIK("Microsoft");
      return { ok: Boolean(hit), detail: hit ? "EDGAR ticker index reachable" : "no CIK match" };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
