import { loadProductMap, matchProductToNode } from "../../agents/taxonomy-mapper";
import { contentHash } from "../pipeline";
import type {
  EvidenceCandidate,
  IntelligenceProvider,
  IntelligenceTarget,
  ProviderHealth,
  RawObservationInput,
} from "../provider";

/**
 * BuiltWith technographics (DIRECTIVE P1-B + integration requirements):
 *  - JSON exclusively; no XML/CSV.
 *  - Domain API (v23) for baseline enrichment and periodic full
 *    reconciliation; Change API (change1) for ongoing monitoring, with a
 *    CONFIGURABLE lookback (BUILTWITH_SINCE, default "last month").
 *  - Which mode runs is decided from pipeline-supplied state: no baseline
 *    observation yet → Domain API; otherwise → Change API. The pipeline's
 *    per-run bookkeeping is the "last successful refresh per domain" store.
 *  - Everything flows RawObservation → Evidence → Ontology → Signal; no
 *    BuiltWith-specific scoring anywhere.
 *  - Claims are phrased as WEB-FACING observations — never proof of private
 *    enterprise infrastructure.
 */

const DOMAIN_API = "https://api.builtwith.com/v23/api.json";
const CHANGE_API = "https://api.builtwith.com/change1/api.json";

// -- Documented response shapes (defensive: fields optional everywhere) -----

interface BwTechnology {
  Name?: string;
  Tag?: string;
  Categories?: string[];
  FirstDetected?: number;
  LastDetected?: number;
}
interface BwDomainResponse {
  Errors?: { Message?: string; Code?: number }[];
  Results?: { Result?: { Paths?: { Technologies?: BwTechnology[] }[] }; Lookup?: string }[];
}
interface BwChange {
  Technology?: string;
  Name?: string;
  Tag?: string;
  Type?: string; // "Added" | "Removed" (casing defensive)
  Date?: string;
}
interface BwChangeResponse {
  Errors?: { Message?: string; Code?: number }[];
  Lookup?: string;
  Changes?: BwChange[];
  Groups?: { Changes?: BwChange[] }[];
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

function firstError(body: { Errors?: { Message?: string }[] }): string | null {
  return body.Errors?.[0]?.Message ?? null;
}

export class BuiltWithProvider implements IntelligenceProvider {
  providerId = "builtwith";
  providerType = "TECHNOGRAPHIC" as const;
  costClass = "LOW_COST" as const;
  sourceTrustPrior = 0.75;
  sourceKind = "external" as const;
  supportedFamilies = ["TECHNOLOGY" as const, "TECHNOLOGY_CHANGE" as const];
  // Metered API — never burn a credit on the same company more than weekly.
  minRefreshHours = 24 * 7;

  private key(): string | null {
    return process.env.BUILTWITH_API_KEY ?? null;
  }
  private since(): string {
    return process.env.BUILTWITH_SINCE ?? "last month";
  }

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    const key = this.key();
    if (!key || !target.domain) return []; // unconfigured/undomained = absence, not error

    // Baseline (Domain API) until a baseline exists; Change API afterwards.
    const baseline = (target.state?.observationCount ?? 0) === 0;
    const url = baseline
      ? `${DOMAIN_API}?KEY=${key}&LOOKUP=${encodeURIComponent(target.domain)}`
      : `${CHANGE_API}?KEY=${key}&LOOKUP=${encodeURIComponent(target.domain)}&SINCE=${encodeURIComponent(this.since())}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`builtwith HTTP ${res.status}`);
    const body = (await res.json()) as BwDomainResponse & BwChangeResponse;
    const err = firstError(body);
    if (err) throw new Error(`builtwith: ${err}`);

    if (baseline) {
      const techs = extractTechnologies(body);
      const fingerprint = techs.map((t) => t.Name).sort().join("|");
      return [
        {
          sourceUrl: `https://builtwith.com/${target.domain}`,
          payload: { mode: "baseline", domain: target.domain, technologies: techs },
          contentHash: contentHash(`baseline:${fingerprint}`),
          costUsd: 0.01, // approximate per-credit cost for reporting
        },
      ];
    }
    const changes = extractChanges(body);
    const fingerprint = changes.map((c) => `${c.type}:${c.name}:${c.date}`).sort().join("|");
    return [
      {
        sourceUrl: `https://builtwith.com/${target.domain}`,
        payload: { mode: "change", domain: target.domain, since: this.since(), changes },
        contentHash: contentHash(`change:${fingerprint}`),
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
    const productMap = loadProductMap();
    const out: EvidenceCandidate[] = [];
    const payload = current[0].payload as {
      mode: string;
      domain: string;
      technologies?: BwTechnology[];
      changes?: { name: string; type: "added" | "removed"; date: string | null }[];
    };

    if (payload.mode === "baseline") {
      // Only ontology-mapped technologies become evidence — the point is
      // commercial relevance, not cataloguing every JS library (§49).
      for (const t of payload.technologies ?? []) {
        const node = matchProductToNode(t.Name ?? "", productMap);
        if (!node) continue;
        out.push({
          claim: `BuiltWith detects ${t.Name} on ${payload.domain}'s public web presence`,
          sourceUrl: `https://builtwith.com/${payload.domain}`,
          confidence: 0.75,
          firstParty: false,
          suggestedSignalType: "TECH_INSTALLED",
          suggestedNodeSlug: node,
        });
      }
      return out;
    }

    const changes = payload.changes ?? [];
    for (const c of changes) {
      const node = matchProductToNode(c.name, productMap);
      out.push({
        claim:
          `BuiltWith detected ${c.name} was ${c.type === "added" ? "added to" : "removed from"} ` +
          `${payload.domain}'s public web stack${c.date ? ` around ${c.date}` : ""}`,
        sourceUrl: `https://builtwith.com/${payload.domain}`,
        confidence: 0.7,
        firstParty: false,
        suggestedSignalType: c.type === "added" ? "TECHNOLOGY_ADDED" : "TECH_REMOVED",
        suggestedNodeSlug: node ?? undefined,
      });
    }
    // Many simultaneous movements = a stack-change event in its own right.
    if (changes.length >= 5) {
      out.push({
        claim: `${target.companyName}'s public web stack changed substantially (${changes.length} technology changes detected in the period)`,
        sourceUrl: `https://builtwith.com/${payload.domain}`,
        confidence: 0.7,
        firstParty: false,
        suggestedSignalType: "TECHNOLOGY_STACK_CHANGE",
      });
    }
    return out;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const key = this.key();
    if (!key) return { ok: false, detail: "BUILTWITH_API_KEY not set" };
    try {
      const res = await fetch(`${DOMAIN_API}?KEY=${key}&LOOKUP=builtwith.com`, {
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as BwDomainResponse;
      const err = firstError(body);
      return err ? { ok: false, detail: err } : { ok: res.ok, detail: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
