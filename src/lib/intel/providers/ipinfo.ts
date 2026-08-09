import { contentHash } from "../pipeline";
import type {
  EvidenceCandidate,
  IntelligenceProvider,
  IntelligenceTarget,
  ProviderHealth,
  RawObservationInput,
} from "../provider";

/**
 * IPinfo LITE network intelligence (DIRECTIVE P1-D + integration
 * requirements): enrich the company's public web IPs with ASN/network
 * ownership. Supporting NETWORK/TECHNOLOGY evidence only — never a major
 * propensity feature, never an inference about private architecture, and
 * location data is captured in the raw payload but NEVER becomes evidence.
 * Historical snapshots make provider/infrastructure changes detectable.
 * Lite endpoint only; the enterprise ASN API is out of scope.
 */

const API = "https://api.ipinfo.io/lite";
const DOH = "https://cloudflare-dns.com/dns-query";
const MAX_IPS = 4;

export interface IpEntry {
  ip: string;
  asn: string | null;
  as_name: string | null;
  as_domain: string | null;
  country: string | null;
  continent: string | null;
}
export interface IpinfoSnapshot {
  domain: string;
  entries: IpEntry[];
}

const CLOUD_AS_DOMAINS = [
  "amazon.com", "aws.com", "google.com", "microsoft.com", "azure.com",
  "cloudflare.com", "akamai.com", "fastly.com", "oracle.com",
  "digitalocean.com", "ovh.net", "hetzner.com", "linode.com", "vultr.com",
];

export function isCloudNetwork(entry: IpEntry): boolean {
  const d = (entry.as_domain ?? "").toLowerCase();
  return CLOUD_AS_DOMAINS.some((c) => d === c || d.endsWith(`.${c}`));
}

/** Distinct networks in a snapshot, keyed by AS domain (stable across IPs). */
export function distinctNetworks(snap: IpinfoSnapshot): IpEntry[] {
  const seen = new Map<string, IpEntry>();
  for (const e of snap.entries) {
    const key = e.as_domain ?? e.asn ?? e.ip;
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.values()];
}

/** Network-change events between snapshots (as_domain set comparison). */
export function detectNetworkChanges(
  prev: IpinfoSnapshot,
  curr: IpinfoSnapshot,
): { signalType: string; claim: string }[] {
  const domains = (s: IpinfoSnapshot) =>
    [...new Set(s.entries.map((e) => e.as_domain).filter(Boolean))].sort() as string[];
  const asns = (s: IpinfoSnapshot) =>
    [...new Set(s.entries.map((e) => e.asn).filter(Boolean))].sort() as string[];

  const prevD = domains(prev), currD = domains(curr);
  if (prevD.length && currD.length && prevD.join() !== currD.join()) {
    return [
      {
        signalType: "NETWORK_PROVIDER_CHANGE",
        claim: `Public web hosting network for ${curr.domain} changed (${prevD.join("/")} → ${currD.join("/")})`,
      },
    ];
  }
  const prevA = asns(prev), currA = asns(curr);
  if (prevA.length && currA.length && prevA.join() !== currA.join()) {
    return [
      {
        signalType: "NETWORK_INFRASTRUCTURE_CHANGE",
        claim: `Network infrastructure for ${curr.domain} changed within the same provider (${prevA.join("/")} → ${currA.join("/")})`,
      },
    ];
  }
  return [];
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

export class IpinfoProvider implements IntelligenceProvider {
  providerId = "ipinfo";
  providerType = "NETWORK" as const;
  costClass = "FREE" as const;
  sourceTrustPrior = 0.8;
  sourceKind = "external" as const;
  supportedFamilies = ["TECHNOLOGY" as const, "TECHNOLOGY_CHANGE" as const];
  // Free-tier quota politeness: weekly per company is plenty for ASN data.
  minRefreshHours = 24 * 7;

  private token(): string | null {
    return process.env.IPINFO_TOKEN ?? null;
  }

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    const token = this.token();
    if (!token || !target.domain) return [];

    const ips = [
      ...new Set([...(await resolveA(target.domain)), ...(await resolveA(`www.${target.domain}`))]),
    ].slice(0, MAX_IPS);
    if (ips.length === 0) return [];

    const entries: IpEntry[] = [];
    for (const ip of ips) {
      const res = await fetch(`${API}/${ip}?token=${token}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`ipinfo HTTP ${res.status} for ${ip}`);
      const body = (await res.json()) as Partial<IpEntry>;
      entries.push({
        ip,
        asn: body.asn ?? null,
        as_name: body.as_name ?? null,
        as_domain: body.as_domain ?? null,
        country: body.country ?? null,
        continent: body.continent ?? null,
      });
    }

    const snapshot: IpinfoSnapshot = { domain: target.domain, entries };
    const fingerprint = entries.map((e) => `${e.asn}:${e.as_domain}`).sort().join("|");
    return [{ payload: snapshot, contentHash: contentHash(`ipinfo:${fingerprint}`) }];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    history: { payload: unknown; observedAt: Date }[],
    _target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const snap = current[0].payload as IpinfoSnapshot;
    const out: EvidenceCandidate[] = [];

    for (const net of distinctNetworks(snap)) {
      if (!net.as_name) continue;
      const cloud = isCloudNetwork(net);
      out.push({
        claim:
          `Public web IPs for ${snap.domain} route through ${net.as_name}` +
          `${net.asn ? ` (${net.asn})` : ""}${cloud ? ", a cloud network provider" : ""}`,
        confidence: cloud ? 0.7 : 0.65, // supporting clue, never proof
        firstParty: false,
        suggestedSignalType: cloud ? "CLOUD_NETWORK_EVIDENCE" : "NETWORK_PROVIDER_IDENTIFIED",
      });
    }

    const prev = history[0]?.payload as IpinfoSnapshot | undefined;
    if (prev) {
      for (const change of detectNetworkChanges(prev, snap)) {
        out.push({
          claim: change.claim,
          confidence: 0.8, // the change itself is directly observed
          firstParty: false,
          suggestedSignalType: change.signalType,
        });
      }
    }
    return out;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const token = this.token();
    if (!token) return { ok: false, detail: "IPINFO_TOKEN not set" };
    try {
      const res = await fetch(`${API}/8.8.8.8?token=${token}`, {
        signal: AbortSignal.timeout(8_000),
      });
      const body = (await res.json()) as { asn?: string };
      return { ok: res.ok && Boolean(body.asn), detail: `HTTP ${res.status}, asn=${body.asn ?? "none"}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
