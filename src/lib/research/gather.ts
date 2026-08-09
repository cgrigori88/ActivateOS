import type { ResearchDocument } from "../agents/extractor";
import { filingText, filingUrl, lookupCIK, recentFilings } from "./edgar";
import { researchQueries, tavilyAvailable, tavilySearch } from "./tavily";

/**
 * Gather live research documents for one company: SEC EDGAR (free, public
 * companies) plus Tavily web search when a key is configured. Shared by the
 * on-demand research script and the refresh runner — same sources, same
 * limits, so refresh runs cost the same as manual ones.
 */
export async function gatherLiveDocs(
  companyLegalName: string,
  solutionHint: string,
  log: (msg: string) => void = console.log,
): Promise<ResearchDocument[]> {
  const docs: ResearchDocument[] = [];

  try {
    const hit = await lookupCIK(companyLegalName);
    if (hit) {
      log(`EDGAR match: ${hit.title} (CIK ${hit.cik})`);
      for (const filing of await recentFilings(hit.cik, ["8-K", "10-K"], 2)) {
        docs.push({
          sourceType: "sec_filing",
          sourceUrl: filingUrl(hit.cik, filing),
          text: (await filingText(hit.cik, filing)).slice(0, 60000),
          observedAt: new Date(filing.filingDate),
        });
      }
    } else {
      log("EDGAR: no public-company match (private companies have no filings)");
    }
  } catch (err) {
    log(`EDGAR unavailable: ${err instanceof Error ? err.message : err}`);
  }

  if (tavilyAvailable()) {
    for (const query of researchQueries(companyLegalName, solutionHint)) {
      for (const r of await tavilySearch(query, 3)) {
        docs.push({ sourceType: "web_search", sourceUrl: r.url, text: r.content.slice(0, 24000) });
      }
    }
  } else {
    log("Tavily skipped (set TAVILY_API_KEY to enable web research)");
  }

  return docs;
}
