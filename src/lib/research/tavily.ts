/**
 * Tavily search connector (free tier: 1,000 credits/month). Used to gather
 * recent public web signals (press, initiatives, hiring) for the Extractor.
 * Requires TAVILY_API_KEY; callers should skip gracefully without it.
 */

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

export function tavilyAvailable(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

export async function tavilySearch(query: string, maxResults = 5): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_raw_content: true,
      search_depth: "basic",
    }),
  });
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    results: { title: string; url: string; content: string; raw_content?: string | null }[];
  };
  return data.results.map((r) => ({
    title: r.title,
    url: r.url,
    content: r.raw_content?.trim() || r.content,
  }));
}

/** Standard research queries for one company × solution category. */
export function researchQueries(companyName: string, categoryName: string): string[] {
  return [
    `"${companyName}" infrastructure modernization OR "data center" initiative`,
    `"${companyName}" ${categoryName} hiring engineers`,
    `"${companyName}" layoffs OR "hiring freeze" OR "budget cuts"`,
  ];
}
