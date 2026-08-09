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
 * GDELT corporate-event radar (DIRECTIVE P0-E). GDELT indexes global news in
 * near-real time and is FREE — an excellent cheap DISCOVERY layer for
 * corporate events (launches, partnerships, acquisitions, expansions,
 * leadership changes). It is a RADAR, not a witness: a single GDELT article
 * is a candidate, never confirmation. Its source-trust prior is deliberately
 * LOW so a lone GDELT mention is quarantined by the quality gate and only
 * promoted to verified when an independent source — the company's own
 * newsroom, an SEC filing, or a Tavily investigation of an escalated account
 * — corroborates the same claim (§26). This keeps the flow: cheap candidate →
 * relevance classify → corroborate → evidence, and stops noisy press from
 * ever inflating propensity on its own.
 */

const DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc";
const MAX_RECORDS = 25;
const TIMESPAN = "3months";

// Event-term OR-group keeps the query focused on corporate events, not the
// long tail of tutorials/stock-chatter that merely mention the company.
const EVENT_TERMS = [
  "acquires", "acquisition", "merger", "partnership", "partners",
  "launches", "unveils", "expansion", "expands", "opens",
  "appoints", "names", "funding", "raises", "invests",
];

interface GdeltArticle {
  url: string;
  title: string;
  domain: string;
  seendate: string; // YYYYMMDDTHHMMSSZ
  language: string;
  sourcecountry: string;
}

/** Parse GDELT's compact seendate (YYYYMMDDTHHMMSSZ) into a Date, or null. */
export function parseSeendate(s: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}Z`);
}

export type EventType =
  | "NEW_PRODUCT"
  | "PARTNERSHIP"
  | "M_AND_A"
  | "GEOGRAPHIC_EXPANSION"
  | "NEW_FACILITY"
  | "NEW_TECHNOLOGY_LEADERSHIP";

interface EventPattern {
  type: EventType;
  phrase: string;
  re: RegExp;
}

// Deterministic first-pass classification on the headline. Ordered: the most
// specific patterns win (a "new data center" is a facility, not a plain
// expansion). Pure and fully testable.
const EVENT_PATTERNS: EventPattern[] = [
  { type: "M_AND_A", phrase: "is involved in M&A activity", re: /\b(acquires?|acquisition|acquired|to acquire|merger|merges? with|buys|buyout|takeover)\b/i },
  { type: "NEW_FACILITY", phrase: "is opening a new facility", re: /\b(data ?center|facility|campus|headquarters|office)\b.*\b(open|opens|opening|new|build|builds)\b|\b(open|opens|opening|new|build|builds)\b.*\b(data ?center|facility|campus|headquarters|office)\b/i },
  { type: "NEW_TECHNOLOGY_LEADERSHIP", phrase: "has a leadership change", re: /\b(appoints?|names?|hires?|promotes?)\b.*\b(ceo|cto|cio|ciso|chief|president|vp|head of|svp)\b/i },
  { type: "PARTNERSHIP", phrase: "announced a partnership", re: /\b(partners?|partnership|teams? up|collaborat\w*|joins? forces|alliance|integrat\w* with)\b/i },
  { type: "NEW_PRODUCT", phrase: "launched a product or initiative", re: /\b(launches?|unveils?|introduces?|releases?|debuts?|rolls? out|announces?)\b/i },
  { type: "GEOGRAPHIC_EXPANSION", phrase: "is expanding", re: /\b(expands?|expansion|grows? into|enters? the .* market)\b/i },
];

/**
 * Deterministic radar classification: does this headline describe a corporate
 * event about the target company? Requires the company name in the title (so
 * we don't attribute a partner's or competitor's event) AND an event pattern.
 */
export function classifyEvent(title: string, companyName: string): { type: EventType; phrase: string } | null {
  const t = title.toLowerCase();
  // The company must be the subject, not an incidental mention. Match on the
  // first significant token of the name (e.g. "MongoDB", "Palo Alto").
  const head = companyName.trim().split(/\s+/)[0]?.toLowerCase();
  if (!head || head.length < 3 || !t.includes(head)) return null;
  for (const p of EVENT_PATTERNS) {
    if (p.re.test(title)) return { type: p.type, phrase: p.phrase };
  }
  return null;
}

// Optional cheap-LLM confirmation over the deterministic survivors — filters
// residual noise (a headline that matched a verb but is not really a corporate
// event) in ONE batched call. Falls back to the deterministic result when no
// model key is configured, so the provider always works.
const confirmSchema = z.object({
  events: z.array(
    z.object({
      index: z.number().int().describe("0-based index of the candidate headline"),
      is_corporate_event: z.boolean(),
      event_type: z.enum([
        "NEW_PRODUCT", "PARTNERSHIP", "M_AND_A",
        "GEOGRAPHIC_EXPANSION", "NEW_FACILITY", "NEW_TECHNOLOGY_LEADERSHIP",
      ]),
    }),
  ),
});

const PHRASE: Record<EventType, string> = {
  NEW_PRODUCT: "launched a product or initiative",
  PARTNERSHIP: "announced a partnership",
  M_AND_A: "is involved in M&A activity",
  GEOGRAPHIC_EXPANSION: "is expanding",
  NEW_FACILITY: "is opening a new facility",
  NEW_TECHNOLOGY_LEADERSHIP: "has a leadership change",
};

export class GdeltProvider implements IntelligenceProvider {
  providerId = "gdelt";
  providerType = "PUBLIC_NEWS" as const;
  costClass = "FREE" as const;
  // RADAR trust: deliberately low. A lone GDELT article is a candidate; the
  // quality gate quarantines it until a higher-trust source corroborates.
  sourceTrustPrior = 0.4;
  sourceKind = "external" as const;
  supportedFamilies = ["BUSINESS_TRIGGER" as const, "STRATEGIC_CHANGE" as const, "ORGANIZATIONAL_CHANGE" as const];
  minRefreshHours = 24; // daily is plenty; also respects GDELT's rate limits

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    if (!target.companyName) return [];
    const query = `"${target.companyName}" (${EVENT_TERMS.join(" OR ")})`;
    const url =
      `${DOC_API}?query=${encodeURIComponent(query)}` +
      `&mode=artlist&format=json&maxrecords=${MAX_RECORDS}&timespan=${TIMESPAN}&sort=datedesc`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": "PursuitOS/1.0 (commercial-intelligence research)" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return []; // network/timeout — absence, never a fabricated event
    }
    if (!res.ok) return [];
    const body = await res.text();
    // GDELT returns a plain-text throttle/notice instead of JSON when busy or
    // when a query is rejected. Treat any non-JSON body as "skipped".
    if (!body.trimStart().startsWith("{")) return [];
    let parsed: { articles?: GdeltArticle[] };
    try {
      parsed = JSON.parse(body) as { articles?: GdeltArticle[] };
    } catch {
      return [];
    }
    const articles = parsed.articles ?? [];
    // One observation per article, keyed by URL — new articles are new
    // observations; a re-seen article hashes the same and is deduped away.
    return articles
      .filter((a) => a.url && a.title)
      .map((a) => ({
        externalRecordId: a.url,
        sourceUrl: a.url,
        sourcePublishedAt: parseSeendate(a.seendate),
        payload: {
          url: a.url,
          title: a.title,
          domain: a.domain,
          seendate: a.seendate,
          sourcecountry: a.sourcecountry,
        },
        contentHash: contentHash(`gdelt:${a.url}`),
      }));
  }

  async normalize(
    current: { payload: unknown; isNew: boolean }[],
    _history: { payload: unknown; observedAt: Date }[],
    target: IntelligenceTarget,
  ): Promise<EvidenceCandidate[]> {
    // Deterministic first pass over genuinely new articles only.
    const candidates = current
      .filter((c) => c.isNew)
      .map((c) => c.payload as { url: string; title: string; domain: string; seendate: string })
      .map((a) => ({ a, cls: classifyEvent(a.title, target.companyName) }))
      .filter((x): x is { a: typeof x.a; cls: { type: EventType; phrase: string } } => x.cls !== null);
    if (candidates.length === 0) return [];

    // Optional cheap-LLM confirmation to prune residual noise, batched into one
    // call. Any failure or missing key → keep the deterministic classification.
    let confirmed = candidates.map((c) => ({ ...c, ok: true }));
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const list = candidates.map((c, i) => `${i}: ${c.a.title}`).join("\n");
        const out = await completeStructured({
          tier: "cheap",
          system:
            "You are filtering news headlines. For each, decide whether it reports a REAL corporate " +
            `event about ${target.companyName} (a product/initiative launch, partnership, acquisition/merger, ` +
            "geographic/market expansion, new facility, or executive leadership change) — as opposed to " +
            "stock commentary, opinion, tutorials, or a mention where the company is not the actor. " +
            "Return one entry per index with is_corporate_event and the best event_type.",
          user: `Headlines:\n${list}`,
          schema: confirmSchema,
          maxTokens: 1024,
        });
        const verdict = new Map(out.events.map((e) => [e.index, e]));
        confirmed = candidates.map((c, i) => {
          const v = verdict.get(i);
          if (!v) return { ...c, ok: true };
          return {
            a: c.a,
            cls: v.is_corporate_event ? { type: v.event_type as EventType, phrase: PHRASE[v.event_type as EventType] } : c.cls,
            ok: v.is_corporate_event,
          };
        });
      } catch {
        /* keep deterministic */
      }
    }

    return confirmed
      .filter((c) => c.ok)
      .map((c) => ({
        claim: `News coverage indicates ${target.companyName} ${c.cls.phrase}: "${c.a.title}" (${c.a.domain})`,
        excerpt: c.a.title,
        sourceUrl: c.a.url,
        confidence: 0.45, // radar-grade; corroboration raises effective confidence
        firstParty: false,
        publishedAt: parseSeendate(c.a.seendate),
        suggestedSignalType: c.cls.type,
      }));
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const res = await fetch(
        `${DOC_API}?query=Microsoft&mode=artlist&format=json&maxrecords=1&timespan=1week`,
        { headers: { "User-Agent": "PursuitOS/1.0" }, signal: AbortSignal.timeout(10_000) },
      );
      const body = await res.text();
      const ok = body.trimStart().startsWith("{");
      return { ok, detail: ok ? "GDELT Doc 2.0 reachable" : "GDELT throttled/unavailable" };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
