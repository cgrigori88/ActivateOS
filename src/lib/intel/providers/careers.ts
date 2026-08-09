import { contentHash } from "../pipeline";
import { computeHiringFeatures, hiringEvidence, type HiringSnapshot, type JobPosting } from "../hiring";
import type {
  EvidenceCandidate,
  IntelligenceProvider,
  IntelligenceTarget,
  ProviderHealth,
  RawObservationInput,
} from "../provider";

/**
 * Generic careers-page monitor (DIRECTIVE P0-C). Covers companies that DON'T
 * use Greenhouse or Lever — the self-hosted / long-tail-ATS case. Extraction
 * is deterministic and free:
 *
 *   1. schema.org JobPosting JSON-LD — the SEO standard most career sites
 *      embed for Google Jobs. High precision; the primary path.
 *   2. Anchor fallback — job-detail links whose text reads like a role title.
 *
 * Normalizes into the SHARED hiring model (classifyJob / computeHiringFeatures
 * / hiringEvidence), so a self-hosted board produces exactly the same velocity
 * features and evidence as an ATS board — no duplicated downstream logic. A
 * single posting is never intent; counts and velocity over history are.
 */

const CANDIDATE_PATHS = [
  "/careers", "/careers/jobs", "/careers/openings", "/jobs", "/join-us",
  "/company/careers", "/about/careers", "/en/careers", "/careers/open-positions",
];
const TIMEOUT = 12_000;
const MAX_HTML = 800_000; // cap parse work on huge pages

// Anchor-fallback: hrefs that look like a job DETAIL page…
const JOB_HREF_RE = /\/(jobs?|careers?|positions?|openings?|opportunit\w*|vacan\w*|req)\/[\w%\-/]+/i;
// …and link text that reads like a real role title (not "Apply" / "View all").
const TITLE_HINT_RE = /\b(engineer|engineering|developer|architect|manager|director|analyst|specialist|lead|scientist|administrator|consultant|officer|designer|programmer|technician|sre|devops|vp|head)\b/i;

function abs(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function textOf(node: unknown): string | null {
  if (typeof node === "string") return node.trim() || null;
  return null;
}

/** Pull addressLocality/Region from a schema.org jobLocation (object|array). */
function jsonLdLocation(loc: unknown): string | null {
  const one = Array.isArray(loc) ? loc[0] : loc;
  if (!one || typeof one !== "object") return null;
  const addr = (one as { address?: unknown }).address;
  const a = (Array.isArray(addr) ? addr[0] : addr) as
    | { addressLocality?: string; addressRegion?: string; addressCountry?: string }
    | undefined;
  if (!a || typeof a !== "object") return null;
  return a.addressLocality ?? a.addressRegion ?? textOf(a.addressCountry) ?? null;
}

/** Recursively collect schema.org JobPosting objects from any JSON-LD value. */
function collectJobPostings(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collectJobPostings(v, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  const type = obj["@type"];
  const isJob = type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
  if (isJob) out.push(obj);
  if (obj["@graph"]) collectJobPostings(obj["@graph"], out);
  if (obj.itemListElement) collectJobPostings(obj.itemListElement, out);
  if (obj.item && typeof obj.item === "object") collectJobPostings(obj.item, out);
}

/**
 * Deterministic, dependency-free extraction of job postings from careers HTML.
 * Pure and fully testable. Prefers JSON-LD; falls back to anchor scanning.
 */
export function extractJobPostings(html: string, baseUrl: string): JobPosting[] {
  const capped = html.slice(0, MAX_HTML);
  const byId = new Map<string, JobPosting>();

  // 1) JSON-LD JobPosting blocks.
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of capped.matchAll(ldRe)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue; // one malformed block never aborts the rest
    }
    const jobs: Record<string, unknown>[] = [];
    collectJobPostings(parsed, jobs);
    for (const j of jobs) {
      const title = textOf(j.title) ?? textOf(j.name);
      if (!title) continue;
      const url = textOf(j.url) ?? (textOf((j as { sameAs?: unknown }).sameAs));
      const resolved = url ? abs(url, baseUrl) : null;
      const posted = textOf(j.datePosted);
      const publishedAt = posted ? new Date(posted) : null;
      const id = `careers-${resolved ?? title.toLowerCase().replace(/\s+/g, "-")}`;
      byId.set(id, {
        externalId: id,
        title,
        department: null,
        location: jsonLdLocation(j.jobLocation),
        url: resolved,
        publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
      });
    }
  }
  if (byId.size > 0) return [...byId.values()];

  // 2) Anchor fallback — only when no structured data exists.
  const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of capped.matchAll(aRe)) {
    const href = m[1];
    if (!JOB_HREF_RE.test(href)) continue;
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length < 6 || text.length > 90) continue;
    if (!TITLE_HINT_RE.test(text)) continue;
    const resolved = abs(href, baseUrl);
    if (!resolved) continue;
    const id = `careers-${resolved}`;
    if (!byId.has(id)) {
      byId.set(id, { externalId: id, title: text, department: null, location: null, url: resolved, publishedAt: null });
    }
  }
  return [...byId.values()];
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "PursuitOS/1.0 (commercial-intelligence research)" },
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && !ct.includes("json")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

interface CareersPayload {
  url: string;
  jobs: JobPosting[];
}

export class CareersProvider implements IntelligenceProvider {
  providerId = "careers";
  providerType = "HIRING" as const;
  costClass = "FREE" as const;
  // First-party company page, but heuristic extraction — a notch below the
  // structured ATS APIs (greenhouse/lever at 0.85).
  sourceTrustPrior = 0.8;
  sourceKind = "first_party" as const;
  supportedFamilies = ["HIRING" as const, "ORGANIZATIONAL_CHANGE" as const];

  async discover(target: IntelligenceTarget): Promise<Record<string, string> | null> {
    if (!target.domain) return null;
    const root = `https://${target.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;
    for (const path of CANDIDATE_PATHS) {
      const url = `${root}${path}`;
      const html = await fetchHtml(url);
      if (html && extractJobPostings(html, url).length > 0) return { careers: url };
    }
    return null;
  }

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    const url = target.handles?.careers;
    if (!url) return []; // no self-hosted board found — absence, not an error
    const html = await fetchHtml(url);
    if (!html) return [];
    const jobs = extractJobPostings(html, url);
    if (jobs.length === 0) return []; // page changed / no longer parseable → skip
    const fingerprint = jobs.map((j) => j.externalId + ":" + j.title).sort().join("|");
    const payload: CareersPayload = { url, jobs };
    return [{ sourceUrl: url, payload, contentHash: contentHash(`careers:${fingerprint}`) }];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    history: { payload: unknown; observedAt: Date }[],
    target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const now = new Date();
    const toSnap = (payload: unknown, observedAt: Date): HiringSnapshot => {
      const p = payload as CareersPayload;
      return {
        jobs: (p.jobs ?? []).map((j) => ({ ...j, publishedAt: j.publishedAt ? new Date(j.publishedAt) : null })),
        observedAt,
      };
    };
    const snap = toSnap(current[0].payload, now);
    const past = history.map((h) => toSnap(h.payload, h.observedAt));
    const features = computeHiringFeatures(snap, past, now);
    const url = (current[0].payload as CareersPayload).url;
    return hiringEvidence(features, target.companyName, url ?? null);
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { ok: true, detail: "generic careers extraction (JSON-LD + anchor fallback)" };
  }
}
