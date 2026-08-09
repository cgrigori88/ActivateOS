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
 * Censys Platform provider (DIRECTIVE P2-B + Censys integration
 * requirements): OPTIONAL specialized provider on the CURRENT Platform API
 * (v3 asset lookup — NOT the legacy Search API, NOT global scanning/bulk
 * harvesting). Runs only in deep/manual stages, and only when BOTH:
 *   (a) the target solution is in a relevant category (security, network,
 *       cloud, infrastructure software) — isCensysRelevant(); AND
 *   (b) the account has a known public asset (resolvable domain).
 *
 * Hard rules honored here:
 *  - lookup of KNOWN IPs only — never search/scan;
 *  - findings phrased as internet-facing observations;
 *  - NEVER "customer uses X internally", NEVER vulnerability/exposure claims,
 *    NEVER private-architecture inference;
 *  - conservative confidence; location stays in the raw payload.
 */

const API = "https://api.platform.censys.io/v3/global/asset/host";
const DOH = "https://cloudflare-dns.com/dns-query";
const MAX_IPS = 2; // specialized + metered: tiny footprint

/**
 * Category-relevance gate (integration requirement): Censys is justified
 * only for cybersecurity / networking / cloud / infrastructure-software
 * pursuits. Anchored on the taxonomy subtree the target node belongs to.
 */
const CENSYS_RELEVANT_SLUGS = new Set([
  "infrastructure", "compute", "storage", "networking", "virtualization",
  "operating-systems", "containers", "kubernetes", "container-management",
  "automation", "infrastructure-automation", "network-automation",
  "security-automation", "configuration-management",
  "cloud", "public-cloud", "hybrid-cloud", "cloud-management",
  "security", "iam", "siem", "endpoint-security", "vulnerability-management",
]);

export function isCensysRelevant(targetSlug: string): boolean {
  return CENSYS_RELEVANT_SLUGS.has(targetSlug);
}

interface CensysCert {
  parsed?: { issuer_dn?: string; subject_dn?: string };
  names?: string[];
}
interface CensysService {
  port?: number;
  protocol?: string;
  transport_protocol?: string;
  software?: { product?: string; vendor?: string }[];
  cert?: CensysCert;
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

const CLOUD_AS = /amazon|aws|google|microsoft|azure|cloudflare|akamai|fastly|oracle|digitalocean|linode|ovh|hetzner/i;

/** CA org from an issuer DN, e.g. "…, O=Let's Encrypt, …" → "Let's Encrypt". */
export function certIssuerOrg(cert: CensysCert | undefined): string | null {
  const dn = cert?.parsed?.issuer_dn;
  if (!dn) return null;
  const m = dn.match(/(?:^|,)\s*O=([^,]+)/);
  return m ? m[1].trim() : null;
}

export function summarizeHost(host: CensysHost): {
  serviceCount: number;
  protocols: string[];
  software: string[];
  certIssuers: string[];
  cloudProvider: string | null;
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
  const certIssuers = [
    ...new Set(services.map((s) => certIssuerOrg(s.cert)).filter((i): i is string => Boolean(i))),
  ].sort();
  const asName = host.autonomous_system?.name ?? "";
  const cloudProvider = CLOUD_AS.test(asName) ? asName : null;
  return { serviceCount: host.service_count ?? services.length, protocols, software, certIssuers, cloudProvider };
}

/** Distinct-service fingerprint set for change detection (port+protocol). */
function serviceSet(snap: CensysSnapshot): Set<string> {
  const out = new Set<string>();
  for (const h of snap.hosts) {
    for (const s of h.services ?? []) {
      if (s.port && s.protocol && s.protocol !== "UNKNOWN") out.add(`${s.port}/${s.protocol}`);
    }
  }
  return out;
}

/** Material posture change between snapshots (§ PUBLIC_INFRASTRUCTURE_CHANGE). */
export function detectInfraChange(prev: CensysSnapshot, curr: CensysSnapshot): string | null {
  const before = serviceSet(prev);
  const after = serviceSet(curr);
  if (before.size === 0 || after.size === 0) return null;
  const added = [...after].filter((s) => !before.has(s));
  const removed = [...before].filter((s) => !after.has(s));
  if (added.length === 0 && removed.length === 0) return null;
  const parts: string[] = [];
  if (added.length) parts.push(`new: ${added.join(", ")}`);
  if (removed.length) parts.push(`gone: ${removed.join(", ")}`);
  return `Internet-facing service posture for ${curr.domain} changed (${parts.join("; ")})`;
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
    // Category gate (integration requirement): only run for infra-relevant
    // pursuits. targetSlug rides in on handles from the deep-research caller.
    const slug = target.handles?.targetSlug;
    if (slug && !isCensysRelevant(slug)) return [];

    // KNOWN public asset only — resolve the account's own domain, never search.
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
        return `${h.ip}:${s.serviceCount}:${s.protocols.join(",")}:${s.software.join(",")}:${s.certIssuers.join(",")}`;
      })
      .sort()
      .join("|");
    return [{ payload: snapshot, contentHash: contentHash(`censys:${fingerprint}`) }];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    history: { payload: unknown; observedAt: Date }[],
    _target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const snap = current[0].payload as CensysSnapshot;
    const productMap = loadProductMap();
    const out: EvidenceCandidate[] = [];

    for (const host of snap.hosts) {
      const s = summarizeHost(host);
      if (s.serviceCount === 0) continue;

      // Internet-facing posture — observation, never internal-use inference.
      out.push({
        claim:
          `Censys observes ${s.serviceCount} internet-facing service(s) on ${snap.domain}'s ` +
          `public host ${host.ip}` +
          (s.protocols.length ? ` (protocols: ${s.protocols.join(", ")})` : ""),
        confidence: 0.75,
        firstParty: false,
        suggestedSignalType: "INTERNET_FACING_INFRASTRUCTURE_EVIDENCE",
      });

      // Cloud-hosted public asset.
      if (s.cloudProvider) {
        out.push({
          claim: `${snap.domain}'s public host ${host.ip} is served from ${s.cloudProvider} cloud infrastructure`,
          confidence: 0.7,
          firstParty: false,
          suggestedSignalType: "CLOUD_INFRASTRUCTURE_EVIDENCE",
        });
      }

      // Certificate infrastructure — issuer, phrased as a public-cert fact.
      for (const issuer of s.certIssuers) {
        out.push({
          claim: `${snap.domain}'s internet-facing service on ${host.ip} presents a public TLS certificate issued by ${issuer}`,
          confidence: 0.7,
          firstParty: false,
          suggestedSignalType: "CERTIFICATE_INFRASTRUCTURE_EVIDENCE",
        });
      }

      // Ontology-mapped software products only — a detected public service.
      for (const product of s.software) {
        const node = matchProductToNode(product, productMap);
        if (!node) continue;
        out.push({
          claim: `Censys detects ${product} serving internet-facing traffic for ${snap.domain}`,
          confidence: 0.7,
          firstParty: false,
          suggestedSignalType: "PUBLIC_SERVICE_DETECTED",
          suggestedNodeSlug: node,
        });
      }
    }

    // Posture change vs the prior snapshot.
    const prev = history[0]?.payload as CensysSnapshot | undefined;
    if (prev) {
      const change = detectInfraChange(prev, snap);
      if (change) {
        out.push({
          claim: change,
          confidence: 0.75,
          firstParty: false,
          suggestedSignalType: "PUBLIC_INFRASTRUCTURE_CHANGE",
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
