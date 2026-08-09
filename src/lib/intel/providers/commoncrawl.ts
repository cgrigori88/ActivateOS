import { contentHash } from "../pipeline";
import { normalizeDomain } from "../domain";
import type {
  EvidenceCandidate,
  IntelligenceProvider,
  IntelligenceTarget,
  ProviderHealth,
  RawObservationInput,
} from "../provider";

/**
 * Common Crawl historical company-change intelligence (DIRECTIVE P2-A).
 *
 * Common Crawl is a free, open web archive. Its CDX index lets us look at a
 * company's indexed URL surface across crawls MONTHS apart — retroactively,
 * without our ever having monitored the site before. That is its unique value:
 * our first-party website monitor can only see change from the moment WE start
 * watching; Common Crawl reveals change that already happened.
 *
 * Deep-tier and selective. It is a corroboration/timing source, not a primary
 * intent driver: appearance of a strategically-meaningful site section between
 * an older and a recent crawl is a historical change clue, emitted at moderate
 * confidence so a single Common Crawl observation corroborates rather than
 * dictates (§26).
 */

const COLLINFO = "https://index.commoncrawl.org/collinfo.json";
const CDX_TIMEOUT = 20_000;
const CDX_LIMIT = 400; // rows per crawl — enough to see the section surface
const OLDER_OFFSET = 24; // ~12 months of biweekly crawls back

// Strategically-meaningful first-path segments. A section APPEARING over time
// is the signal; most are corroboration-only, a few map to a real initiative.
const STRATEGIC_SEGMENTS: Record<string, { label: string; signal?: string }> = {
  ai: { label: "an AI section", signal: "AI_INITIATIVE" },
  cloud: { label: "a cloud section", signal: "CLOUD_MIGRATION" },
  security: { label: "a security section", signal: "CYBERSECURITY_INITIATIVE" },
  partners: { label: "a partners section", signal: "PARTNERSHIP" },
  partner: { label: "a partner section", signal: "PARTNERSHIP" },
  careers: { label: "a careers section" },
  jobs: { label: "a jobs section" },
  platform: { label: "a platform section" },
  enterprise: { label: "an enterprise section" },
  pricing: { label: "a pricing section" },
  developers: { label: "a developers section" },
  developer: { label: "a developer section" },
  solutions: { label: "a solutions section" },
  integrations: { label: "an integrations section" },
};

/** First path segment of a URL, lowercased; null for root/asset/junk. */
export function pathPrefix(rawUrl: string): string | null {
  let path: string;
  try {
    path = new URL(rawUrl).pathname;
  } catch {
    return null;
  }
  const seg = path.split("/").filter(Boolean)[0];
  if (!seg) return null;
  const s = seg.toLowerCase();
  // Ignore asset/localisation noise so a section surface stays meaningful.
  if (/\.(js|css|png|jpe?g|svg|gif|ico|woff2?|xml|txt|pdf|json)$/.test(s)) return null;
  return s;
}

/** Distinct strategic segments present in a set of captured URLs. Pure. */
export function strategicSegments(urls: string[]): Set<string> {
  const out = new Set<string>();
  for (const u of urls) {
    const seg = pathPrefix(u);
    if (seg && seg in STRATEGIC_SEGMENTS) out.add(seg);
  }
  return out;
}

/** Strategic sections present in the recent crawl but absent in the older one. */
export function addedSections(recent: Set<string> | string[], older: Set<string> | string[]): string[] {
  const r = recent instanceof Set ? recent : new Set(recent);
  const o = older instanceof Set ? older : new Set(older);
  return [...r].filter((s) => !o.has(s)).sort();
}

interface CrawlCapture {
  crawl: string;
  paths: string[];
  count: number;
}
interface CommonCrawlPayload {
  domain: string;
  recent: CrawlCapture;
  older: CrawlCapture;
}

interface Collinfo {
  id: string;
  "cdx-api": string;
}

const UA = "PursuitOS/1.0 (commercial-intelligence research)";

/**
 * Fetch text with a small retry. Common Crawl's index is known-flaky and
 * frequently returns transient 503 "upstream reset" responses; a couple of
 * spaced retries turn most of those into a success without hammering it.
 */
async function fetchTextResilient(url: string, attempts = 3): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(CDX_TIMEOUT) });
      if (res.ok) return await res.text();
      if (res.status !== 503 && res.status !== 502 && res.status !== 429) return null; // hard failure — don't retry
    } catch {
      /* network/timeout — retry */
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const body = await fetchTextResilient(url);
  if (!body) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

/** Query one CDX endpoint for a domain's captured URLs (JSON-lines). */
async function cdxUrls(cdxApi: string, domain: string): Promise<string[]> {
  const url = `${cdxApi}?url=${encodeURIComponent(domain)}/*&output=json&fl=url,timestamp,status&limit=${CDX_LIMIT}`;
  const body = await fetchTextResilient(url);
  if (!body) return [];
  const urls: string[] = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const row = JSON.parse(t) as { url?: string; status?: string };
      // Skip redirect/error captures — a 3xx/4xx isn't a real section page.
      if (row.url && (!row.status || /^2/.test(row.status))) urls.push(row.url);
    } catch {
      /* skip malformed line */
    }
  }
  return urls;
}

export class CommonCrawlProvider implements IntelligenceProvider {
  providerId = "common_crawl";
  providerType = "CORPORATE_EVENT" as const;
  costClass = "FREE" as const; // open archive, but heavy — deep-tier only
  sourceTrustPrior = 0.5; // inferred from crawl coverage, not authoritative
  sourceKind = "external" as const;
  supportedFamilies = ["STRATEGIC_CHANGE" as const, "BUSINESS_TRIGGER" as const];
  allowedForScreening = false; // deep/manual only — never the cheap screen
  minRefreshHours = 24 * 30; // crawls are ~monthly; history changes slowly

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    const domain = normalizeDomain(target.domain);
    if (!domain) return [];

    const collections = await fetchJson<Collinfo[]>(COLLINFO);
    if (!collections || collections.length < 2) return [];
    const recent = collections[0];
    const older = collections[Math.min(OLDER_OFFSET, collections.length - 1)];
    if (recent.id === older.id) return [];

    const [recentUrls, olderUrls] = await Promise.all([
      cdxUrls(recent["cdx-api"], domain),
      cdxUrls(older["cdx-api"], domain),
    ]);
    // Both empty = the archive has nothing on this domain — absence, not error.
    if (recentUrls.length === 0 && olderUrls.length === 0) return [];

    const payload: CommonCrawlPayload = {
      domain,
      recent: { crawl: recent.id, paths: [...strategicSegments(recentUrls)], count: recentUrls.length },
      older: { crawl: older.id, paths: [...strategicSegments(olderUrls)], count: olderUrls.length },
    };
    return [
      {
        sourceUrl: `https://index.commoncrawl.org/`,
        payload,
        contentHash: contentHash(
          `cc:${domain}:${recent.id}:${older.id}:${payload.recent.paths.sort().join(",")}`,
        ),
      },
    ];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    _history: { payload: unknown; observedAt: Date }[],
    target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const p = current[0].payload as CommonCrawlPayload;
    const added = addedSections(p.recent.paths, p.older.paths);
    return added.map((seg) => {
      const meta = STRATEGIC_SEGMENTS[seg];
      return {
        claim:
          `Common Crawl history shows ${target.companyName} added ${meta.label} ` +
          `(present in crawl ${p.recent.crawl}, absent in ${p.older.crawl})`,
        sourceUrl: `https://index.commoncrawl.org/`,
        confidence: 0.55, // historical inference — corroborates, doesn't dictate
        firstParty: false,
        suggestedSignalType: meta.signal, // undefined for corroboration-only segments
      };
    });
  }

  async healthCheck(): Promise<ProviderHealth> {
    const c = await fetchJson<Collinfo[]>(COLLINFO);
    return c && c.length > 0
      ? { ok: true, detail: `Common Crawl index reachable (${c.length} crawls)` }
      : { ok: false, detail: "Common Crawl collinfo unreachable" };
  }
}
