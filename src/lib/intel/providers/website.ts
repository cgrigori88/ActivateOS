import { z } from "zod";
import { completeStructured } from "../../ai/client";
import { contentHash } from "../pipeline";
import type {
  EvidenceCandidate,
  IntelligenceProvider,
  IntelligenceTarget,
  ProviderHealth,
  RawObservationInput,
} from "../provider";

/**
 * First-party website / newsroom monitor (DIRECTIVE P0-D). Fetches a small
 * set of the company's OWN strategic pages, hashes them for change
 * detection (§5: unchanged = stop), and classifies genuinely new/changed
 * content into strategic events with the cheap tier. Company-owned pages are
 * FIRST_PARTY_PUBLIC — higher source trust than secondary media.
 */

const CANDIDATE_PATHS = ["/news", "/newsroom", "/press", "/blog", "/investors", "/about", "/company"];
const TIMEOUT = 12_000;
const PER_PAGE_CHARS = 8_000;

interface PageObservation {
  url: string;
  text: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const websiteSchema = z.object({
  events: z.array(
    z.object({
      claim: z.string().describe("One specific strategic development the page states about the company"),
      excerpt: z.string().describe("Verbatim quote from the page supporting the claim"),
      signal_type: z.enum([
        "AI_INITIATIVE", "INFRA_MODERNIZATION", "CLOUD_MIGRATION", "CYBERSECURITY_INITIATIVE",
        "DATACENTER_EXPANSION", "COST_REDUCTION", "M_AND_A", "GEOGRAPHIC_EXPANSION",
        "NEW_FACILITY", "NEW_PRODUCT", "PARTNERSHIP", "EXECUTIVE_CHANGE",
      ]),
    }),
  ),
});

export class WebsiteProvider implements IntelligenceProvider {
  providerId = "website";
  providerType = "FIRST_PARTY" as const;
  costClass = "LOW_COST" as const; // cheap-tier LLM only on changed pages
  sourceTrustPrior = 0.8; // company's own statements > secondary media
  sourceKind = "first_party" as const;
  supportedFamilies = ["STRATEGIC_CHANGE" as const, "BUSINESS_TRIGGER" as const];
  minRefreshHours = 24 * 7;

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    if (!target.domain) return [];
    const out: RawObservationInput[] = [];
    for (const path of CANDIDATE_PATHS) {
      let res: Response;
      try {
        res = await fetch(`https://${target.domain}${path}`, {
          headers: { "User-Agent": "PursuitOS-intel", Accept: "text/html" },
          redirect: "follow",
          signal: AbortSignal.timeout(TIMEOUT),
        });
      } catch {
        continue;
      }
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) continue;
      const text = stripHtml(await res.text()).slice(0, PER_PAGE_CHARS);
      if (text.length < 200) continue; // empty/placeholder page
      const page: PageObservation = { url: res.url, text };
      // One observation per page; content hash makes an unchanged page a no-op.
      out.push({
        sourceUrl: res.url,
        payload: page,
        contentHash: contentHash(`web:${path}:${text}`),
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
    // Only NEW/changed pages are classified — unchanged pages never reach LLM.
    for (const obs of current) {
      if (!obs.isNew) continue;
      const page = obs.payload as PageObservation;
      let result;
      try {
        result = await completeStructured({
          tier: "cheap",
          system:
            "You extract strategic developments a company states about ITSELF on its own " +
            "website/newsroom. Only specific, page-supported facts (initiatives, expansions, " +
            "new products, partnerships, executive changes, M&A). Quote the excerpt verbatim. " +
            "Skip marketing fluff. If nothing concrete, return an empty list.",
          user: `Company: ${target.companyName}\nPage: ${page.url}\n\n${page.text}`,
          schema: websiteSchema,
          maxTokens: 1536,
        });
      } catch {
        continue;
      }
      for (const e of result.events) {
        out.push({
          claim: e.claim,
          excerpt: e.excerpt,
          sourceUrl: page.url,
          confidence: 0.85, // first-party statement
          firstParty: true,
          suggestedSignalType: e.signal_type,
        });
      }
    }
    return out;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { ok: true, detail: "first-party fetch (no external dependency)" };
  }
}
