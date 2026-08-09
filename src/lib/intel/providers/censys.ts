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
 * Censys Platform provider (DIRECTIVE P2-B): OPTIONAL specialized provider,
 * EXCLUDED from universal screening — it runs only in deep/manual stages for
 * campaigns where internet-facing infrastructure is materially relevant
 * (security, cloud, networking, infrastructure).
 *
 * Hard rules honored here:
 *  - findings are PUBLIC_INFRASTRUCTURE_EVIDENCE about internet-facing
 *    services, phrased as observations;
 *  - NEVER claims about private customer architecture;
 *  - NEVER vulnerability or security-posture claims;
 *  - location data stays in the raw payload, never in evidence.
 */

const API = "https://api.platform.censys.io/v3/global/asset/host";
const DOH = "https://cloudflare-dns.com/dns-query";
const MAX_IPS = 2; // specialized + metered: tiny footprint

interface CensysService {
  port?: number;
  protocol?: string;
  transport_protocol?: string;
  software?: { product?: string; vendor?: string }[];
}
interface CensysHost {
  ip?: string;
  autonomous_system?: { asn?: number; name?: string };
  services?: CensysService[];
  service_count?: number;
}

export interface CensysSnapshot {
  domain: string;
  hosts: CensysHost[];
}

export function summarizeHost(host: CensysHost): {
  serviceCount: number;
  protocols: string[];
  software: string[];
} {
  const services = host.services ?? [];
  const protocols = [
    ...new Set(services.map((s) => s.protocol).filter((p): p is string => Boolean(p) && p !== "UNKNOWN")),
  ].sort();
  const software = [
    ...new Set(
      services.flatMap((s) => (s.software ?? []).map((sw) => sw.product).filter(Boolean) as string[]),
    ),
  ].sort();
  return { serviceCount: host.service_count ?? services.length, protocols, software };
}

async function resolveA(domain: string): Promise<string[]> {
  const res = await fetch(`${DOH}?name=${encodeURIComponent(domain)}&type=A`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { Answer?: { type: number; data: string }[] };
  return (body.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
}

export class CensysProvider implements IntelligenceProvider {
  providerId = "censys";
  providerType = "NETWORK" as const;
  costClass = "LOW_COST" as const;
  sourceTrustPrior = 0.8;
  sourceKind = "external" as const;
  supportedFamilies = ["TECHNOLOGY" as const];
  allowedForScreening = false; // §P2-B: never in universal account scoring
  minRefreshHours = 24 * 30; // specialized monthly cadence

  private pat(): string | null {
    return process.env.CENSYS_PAT ?? null;
  }
  private headers(): Record<string, string> {
    const h: Record<string, string> = { Authorization: `Bearer ${this.pat()}` };
    const org = process.env.CENSYS_ORG_ID;
    if (org && !org.startsWith("<")) h["X-Organization-ID"] = org;
    return h;
  }

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    if (!this.pat() || !target.domain) return [];
    const ips = (await resolveA(target.domain)).slice(0, MAX_IPS);
    if (ips.length === 0) return [];

    const hosts: CensysHost[] = [];
    for (const ip of ips) {
      const res = await fetch(`${API}/${ip}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`censys HTTP ${res.status} for ${ip}`);
      const body = (await res.json()) as { result?: { resource?: CensysHost } };
      const host = body.result?.resource;
      if (host) {
        hosts.push({
          ip: host.ip,
          autonomous_system: host.autonomous_system,
          services: host.services,
          service_count: host.service_count,
        });
      }
    }

    const snapshot: CensysSnapshot = { domain: target.domain, hosts };
    const fingerprint = hosts
      .map((h) => {
        const s = summarizeHost(h);
        return `${h.ip}:${s.serviceCount}:${s.protocols.join(",")}:${s.software.join(",")}`;
      })
      .sort()
      .join("|");
    return [{ payload: snapshot, contentHash: contentHash(`censys:${fingerprint}`) }];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    _history: { payload: unknown; observedAt: Date }[],
    _target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const snap = current[0].payload as CensysSnapshot;
    const productMap = loadProductMap();
    const out: EvidenceCandidate[] = [];

    for (const host of snap.hosts) {
      const s = summarizeHost(host);
      if (s.serviceCount === 0) continue;
      out.push({
        claim:
          `Censys observes ${s.serviceCount} internet-facing service(s) on ${snap.domain}'s ` +
          `public host ${host.ip}` +
          (s.protocols.length ? ` (protocols: ${s.protocols.join(", ")})` : ""),
        confidence: 0.75,
        firstParty: false,
        suggestedSignalType: "PUBLIC_INFRASTRUCTURE_EVIDENCE",
      });
      // Ontology-mapped software products only — commercial relevance filter.
      for (const product of s.software) {
        const node = matchProductToNode(product, productMap);
        if (!node) continue;
        out.push({
          claim: `Censys observes ${product} serving internet-facing traffic for ${snap.domain}`,
          confidence: 0.7,
          firstParty: false,
          suggestedSignalType: "PUBLIC_INFRASTRUCTURE_EVIDENCE",
          suggestedNodeSlug: node,
        });
      }
    }
    return out;
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.pat()) return { ok: false, detail: "CENSYS_PAT not set" };
    try {
      const res = await fetch(`${API}/8.8.8.8`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: res.ok, detail: `platform API HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
