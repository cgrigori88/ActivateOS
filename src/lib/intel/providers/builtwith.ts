import { loadProductMap, matchProductToNode } from "../../agents/taxonomy-mapper";
import { normalizeDomain } from "../domain";
import { contentHash } from "../pipeline";
import type {
  EvidenceCandidate,
  IntelligenceProvider,
  IntelligenceTarget,
  ProviderHealth,
  RawObservationInput,
} from "../provider";

/**
 * BuiltWith, split into three capabilities (per the BuiltWith correction):
 *
 *   builtwith_free   — FREE API, SCREEN stage, ENABLED. Baseline web-
 *                      technographic CATEGORY/GROUP observations. NOT the
 *                      detailed technology inventory.
 *   builtwith_domain — Domain API, DEEP stage, disabled until credits exist.
 *   builtwith_change — Change API, DEEP/MONITOR stage, disabled until credits.
 *
 * JSON only. LOOKUP is always the normalized canonical domain of the
 * resolved account — never guessed, never a URL/path/email. No canonical
 * domain → SKIP_NO_DOMAIN.
 */

const FREE_API = "https://api.builtwith.com/free1/api.json";
const DOMAIN_API = "https://api.builtwith.com/v23/api.json";
const CHANGE_API = "https://api.builtwith.com/change1/api.json";

function apiKey(): string | null {
  return process.env.BUILTWITH_API_KEY ?? null;
}
/** Credit-gated capabilities enable only when this flag is explicitly set. */
function creditsEnabled(): boolean {
  return process.env.BUILTWITH_CREDITS === "true";
}
function firstError(body: { Errors?: { Message?: string }[] }): string | null {
  return body.Errors?.[0]?.Message ?? null;
}

// ── Free API ───────────────────────────────────────────────────────────────

interface FreeCategory { name?: string; live?: number; latest?: number }
interface FreeGroup { name?: string; live?: number; latest?: number; categories?: FreeCategory[] }
interface FreeResponse { domain?: string; groups?: FreeGroup[]; Errors?: { Message?: string }[] }

/** Groups whose live categories carry commercial-technology relevance. */
const RELEVANT_GROUPS = new Set([
  "hosting", "framework", "operations", "cdn", "cdns", "Web Server", "Server", "ns", "mx",
]);

export interface FreeCategoryObservation {
  group: string;
  category: string;
  live: number;
  latestMs: number | null;
}

/**
 * Free-API CATEGORY names → ontology nodes. The free tier reports category
 * presence, not specific products, so this is a deliberately conservative
 * category-level map — only categories with clear commercial-technology
 * meaning; ambiguous ones (analytics, marketing, generic hosting) are left
 * unmapped rather than guessed.
 */
const CATEGORY_NODE: { pattern: RegExp; node: string }[] = [
  { pattern: /^kubernetes$|container|orchestration/i, node: "kubernetes" },
  { pattern: /cloud paas|cloud platform|cloud hosting/i, node: "public-cloud" },
  { pattern: /\bai platform\b|ml platform|llm tooling|ai development framework|ml framework|vector store/i, node: "ai-platforms" },
  { pattern: /devops|infrastructure$|build management|version control/i, node: "infrastructure-automation" },
  { pattern: /data orchestration|data lakehouse|data streaming|data processing/i, node: "analytics" },
  { pattern: /database$/i, node: "databases" },
  { pattern: /monitoring|observability/i, node: "monitoring" },
  { pattern: /^security$|web security|email gateway|secure email/i, node: "security" },
  { pattern: /operating system/i, node: "operating-systems" },
];

function categoryToNode(category: string): string | null {
  for (const { pattern, node } of CATEGORY_NODE) if (pattern.test(category)) return node;
  return null;
}

/** Live categories in commercially relevant groups, with recency. Pure. */
export function relevantCategories(body: FreeResponse): FreeCategoryObservation[] {
  const out: FreeCategoryObservation[] = [];
  for (const g of body.groups ?? []) {
    if (!g.name || !RELEVANT_GROUPS.has(g.name)) continue;
    for (const c of g.categories ?? []) {
      if (!c.name || (c.live ?? 0) <= 0) continue;
      out.push({ group: g.name, category: c.name, live: c.live ?? 0, latestMs: c.latest ?? null });
    }
  }
  return out;
}

export class BuiltWithFreeProvider implements IntelligenceProvider {
  providerId = "builtwith_free";
  providerType = "TECHNOGRAPHIC" as const;
  costClass = "FREE" as const;
  sourceTrustPrior = 0.65; // category counts, not a product inventory
  sourceKind = "external" as const;
  supportedFamilies = ["TECHNOLOGY" as const];
  minRefreshHours = 24 * 14;

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    const key = apiKey();
    const domain = normalizeDomain(target.domain);
    if (!key || !domain) return []; // SKIP_NO_DOMAIN — never guess

    const res = await fetch(`${FREE_API}?KEY=${key}&LOOKUP=${encodeURIComponent(domain)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`builtwith_free HTTP ${res.status}`);
    const body = (await res.json()) as FreeResponse;
    const err = firstError(body);
    if (err) throw new Error(`builtwith_free: ${err}`);

    const cats = relevantCategories(body);
    const fingerprint = cats.map((c) => `${c.group}/${c.category}:${c.live}`).sort().join("|");
    return [
      {
        sourceUrl: `https://builtwith.com/${domain}`,
        payload: { domain, categories: cats },
        contentHash: contentHash(`bwfree:${fingerprint}`),
      },
    ];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    _history: { payload: unknown; observedAt: Date }[],
    _target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const p = current[0].payload as { domain: string; categories: FreeCategoryObservation[] };
    const productMap = loadProductMap();
    const out: EvidenceCandidate[] = [];
    const seenNodes = new Set<string>();

    for (const c of p.categories) {
      // Map the CATEGORY name to the ontology — category-level map first,
      // then the product map as a fallback. Conservative; unmapped = skipped.
      const node = categoryToNode(c.category) ?? matchProductToNode(c.category, productMap);
      if (!node || seenNodes.has(node)) continue;
      seenNodes.add(node);
      const recency = c.latestMs ? ` (last observed ${new Date(c.latestMs).toISOString().slice(0, 10)})` : "";
      out.push({
        // Explicitly a category observation, NOT a product-install claim.
        claim:
          `BuiltWith's free category profile for ${p.domain} shows active ${c.category} ` +
          `web technology${recency}`,
        sourceUrl: `https://builtwith.com/${p.domain}`,
        confidence: 0.6,
        firstParty: false,
        suggestedSignalType: "TECH_INSTALLED",
        suggestedNodeSlug: node,
      });
    }
    return out;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const key = apiKey();
    if (!key) return { ok: false, detail: "BUILTWITH_API_KEY not set" };
    try {
      const res = await fetch(`${FREE_API}?KEY=${key}&LOOKUP=hotelscombined.com`, {
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as FreeResponse;
      const err = firstError(body);
      return err ? { ok: false, detail: err } : { ok: res.ok, detail: `free API HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ── Domain API (deep, credit-gated) ──────────────────────────────────────────

interface BwTechnology { Name?: string }
interface BwDomainResponse {
  Errors?: { Message?: string }[];
  Results?: { Result?: { Paths?: { Technologies?: BwTechnology[] }[] } }[];
}

export function extractTechnologies(body: BwDomainResponse): BwTechnology[] {
  const out: BwTechnology[] = [];
  for (const r of body.Results ?? []) {
    for (const p of r.Result?.Paths ?? []) {
      for (const t of p.Technologies ?? []) if (t.Name) out.push(t);
    }
  }
  return out;
}

export class BuiltWithDomainProvider implements IntelligenceProvider {
  providerId = "builtwith_domain";
  providerType = "TECHNOGRAPHIC" as const;
  costClass = "LOW_COST" as const;
  sourceTrustPrior = 0.75;
  sourceKind = "external" as const;
  supportedFamilies = ["TECHNOLOGY" as const];
  allowedForScreening = false; // deep-stage full technology inventory
  minRefreshHours = 24 * 30;
  get disabledReason(): string | undefined {
    return creditsEnabled() ? undefined : "DISABLED_NO_CREDITS";
  }

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    const key = apiKey();
    const domain = normalizeDomain(target.domain);
    if (!key || !domain) return [];
    const res = await fetch(`${DOMAIN_API}?KEY=${key}&LOOKUP=${encodeURIComponent(domain)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`builtwith_domain HTTP ${res.status}`);
    const body = (await res.json()) as BwDomainResponse;
    const err = firstError(body);
    if (err) throw new Error(`builtwith_domain: ${err}`);
    const techs = extractTechnologies(body);
    return [
      {
        sourceUrl: `https://builtwith.com/${domain}`,
        payload: { domain, technologies: techs },
        contentHash: contentHash(`bwdomain:${techs.map((t) => t.Name).sort().join("|")}`),
        costUsd: 0.01,
      },
    ];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    _history: { payload: unknown; observedAt: Date }[],
    _target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const p = current[0].payload as { domain: string; technologies: BwTechnology[] };
    const productMap = loadProductMap();
    const out: EvidenceCandidate[] = [];
    for (const t of p.technologies) {
      const node = matchProductToNode(t.Name ?? "", productMap);
      if (!node) continue;
      out.push({
        claim: `BuiltWith detects ${t.Name} on ${p.domain}'s public web presence`,
        sourceUrl: `https://builtwith.com/${p.domain}`,
        confidence: 0.75,
        firstParty: false,
        suggestedSignalType: "TECH_INSTALLED",
        suggestedNodeSlug: node,
      });
    }
    return out;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return creditsEnabled()
      ? { ok: Boolean(apiKey()), detail: apiKey() ? "credits enabled" : "no key" }
      : { ok: false, detail: "DISABLED_NO_CREDITS" };
  }
}

// ── Change API (deep/monitor, credit-gated) ──────────────────────────────────

interface BwChange { Technology?: string; Name?: string; Type?: string; Date?: string }
interface BwChangeResponse {
  Errors?: { Message?: string }[];
  Changes?: BwChange[];
  Groups?: { Changes?: BwChange[] }[];
}

export function extractChanges(body: BwChangeResponse): { name: string; type: "added" | "removed"; date: string | null }[] {
  const raw = [...(body.Changes ?? []), ...(body.Groups ?? []).flatMap((g) => g.Changes ?? [])];
  const out: { name: string; type: "added" | "removed"; date: string | null }[] = [];
  for (const c of raw) {
    const name = c.Technology ?? c.Name;
    const type = (c.Type ?? "").toLowerCase();
    if (!name) continue;
    if (type.startsWith("add")) out.push({ name, type: "added", date: c.Date ?? null });
    else if (type.startsWith("remov")) out.push({ name, type: "removed", date: c.Date ?? null });
  }
  return out;
}

export class BuiltWithChangeProvider implements IntelligenceProvider {
  providerId = "builtwith_change";
  providerType = "TECHNOGRAPHIC" as const;
  costClass = "LOW_COST" as const;
  sourceTrustPrior = 0.7;
  sourceKind = "external" as const;
  supportedFamilies = ["TECHNOLOGY" as const, "TECHNOLOGY_CHANGE" as const];
  allowedForScreening = false; // deep/monitor
  minRefreshHours = 24 * 14;
  get disabledReason(): string | undefined {
    return creditsEnabled() ? undefined : "DISABLED_NO_CREDITS";
  }

  private since(): string {
    return process.env.BUILTWITH_SINCE ?? "last month";
  }

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    const key = apiKey();
    const domain = normalizeDomain(target.domain);
    if (!key || !domain) return [];
    const res = await fetch(
      `${CHANGE_API}?KEY=${key}&LOOKUP=${encodeURIComponent(domain)}&SINCE=${encodeURIComponent(this.since())}`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) throw new Error(`builtwith_change HTTP ${res.status}`);
    const body = (await res.json()) as BwChangeResponse;
    const err = firstError(body);
    if (err) throw new Error(`builtwith_change: ${err}`);
    const changes = extractChanges(body);
    return [
      {
        sourceUrl: `https://builtwith.com/${domain}`,
        payload: { domain, changes },
        contentHash: contentHash(`bwchange:${changes.map((c) => `${c.type}:${c.name}:${c.date}`).sort().join("|")}`),
        costUsd: 0.01,
      },
    ];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    _history: { payload: unknown; observedAt: Date }[],
    target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const p = current[0].payload as {
      domain: string;
      changes: { name: string; type: "added" | "removed"; date: string | null }[];
    };
    const productMap = loadProductMap();
    const out: EvidenceCandidate[] = [];
    for (const c of p.changes) {
      const node = matchProductToNode(c.name, productMap);
      out.push({
        claim:
          `BuiltWith detected ${c.name} was ${c.type === "added" ? "added to" : "removed from"} ` +
          `${p.domain}'s public web stack${c.date ? ` around ${c.date}` : ""}`,
        sourceUrl: `https://builtwith.com/${p.domain}`,
        confidence: 0.7,
        firstParty: false,
        suggestedSignalType: c.type === "added" ? "TECHNOLOGY_ADDED" : "TECH_REMOVED",
        suggestedNodeSlug: node ?? undefined,
      });
    }
    if (p.changes.length >= 5) {
      out.push({
        claim: `${target.companyName}'s public web stack changed substantially (${p.changes.length} technology changes in the period)`,
        sourceUrl: `https://builtwith.com/${p.domain}`,
        confidence: 0.7,
        firstParty: false,
        suggestedSignalType: "TECHNOLOGY_STACK_CHANGE",
      });
    }
    return out;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return creditsEnabled()
      ? { ok: Boolean(apiKey()), detail: apiKey() ? "credits enabled" : "no key" }
      : { ok: false, detail: "DISABLED_NO_CREDITS" };
  }
}
