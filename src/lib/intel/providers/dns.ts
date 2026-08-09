import { contentHash } from "../pipeline";
import type {
  EvidenceCandidate,
  IntelligenceProvider,
  IntelligenceTarget,
  ProviderHealth,
  RawObservationInput,
} from "../provider";

/**
 * DNS / domain intelligence (DIRECTIVE P0-F): free technographic clues via
 * DNS-over-HTTPS. Supporting evidence ONLY — an MX record suggests a mail
 * platform; it never proves enterprise-wide product adoption, and claims are
 * phrased accordingly ("DNS records indicate...", never "uses").
 * Historical snapshots make change events (mail platform change, DNS
 * provider change) detectable.
 */

const DOH = "https://cloudflare-dns.com/dns-query";
const RECORD_TYPES = ["MX", "TXT", "NS", "A", "CNAME"] as const;

export interface DnsSnapshot {
  domain: string;
  records: Record<string, string[]>;
}

/** Conservative vendor fingerprints over MX/TXT/NS values. */
const VENDOR_PATTERNS: { pattern: RegExp; vendor: string; where: string[] }[] = [
  { pattern: /protection\.outlook\.com|spf\.protection\.outlook/i, vendor: "Microsoft 365", where: ["MX", "TXT"] },
  { pattern: /aspmx.*google|googlemail\.com|_spf\.google\.com/i, vendor: "Google Workspace", where: ["MX", "TXT"] },
  { pattern: /pphosted\.com|proofpoint/i, vendor: "Proofpoint", where: ["MX"] },
  { pattern: /mimecast/i, vendor: "Mimecast", where: ["MX"] },
  { pattern: /cloudflare\.com/i, vendor: "Cloudflare", where: ["NS"] },
  { pattern: /awsdns|amazonses|amazonaws/i, vendor: "AWS", where: ["NS", "TXT", "MX"] },
  { pattern: /azure|trafficmanager\.net|windows\.net/i, vendor: "Azure", where: ["TXT", "CNAME"] },
];

export function detectVendors(snapshot: DnsSnapshot): { vendor: string; via: string }[] {
  const found = new Map<string, string>();
  for (const { pattern, vendor, where } of VENDOR_PATTERNS) {
    for (const type of where) {
      if ((snapshot.records[type] ?? []).some((v) => pattern.test(v))) {
        if (!found.has(vendor)) found.set(vendor, type);
      }
    }
  }
  return [...found].map(([vendor, via]) => ({ vendor, via }));
}

/** Change events between the previous snapshot and now. */
export function detectDnsChanges(
  prev: DnsSnapshot,
  curr: DnsSnapshot,
): { signalType: string; claim: string }[] {
  const out: { signalType: string; claim: string }[] = [];
  const mail = (s: DnsSnapshot) =>
    detectVendors(s).filter((v) => ["Microsoft 365", "Google Workspace"].includes(v.vendor)).map((v) => v.vendor);
  const gateway = (s: DnsSnapshot) =>
    detectVendors(s).filter((v) => ["Proofpoint", "Mimecast"].includes(v.vendor)).map((v) => v.vendor);
  const ns = (s: DnsSnapshot) => (s.records["NS"] ?? []).map((n) => n.toLowerCase()).sort().join(",");

  const prevMail = mail(prev), currMail = mail(curr);
  if (prevMail.join() !== currMail.join() && (prevMail.length || currMail.length)) {
    out.push({
      signalType: "MAIL_PLATFORM_CHANGE",
      claim: `DNS mail records for ${curr.domain} changed (${prevMail.join("/") || "unknown"} → ${currMail.join("/") || "unknown"})`,
    });
  }
  const prevGw = gateway(prev), currGw = gateway(curr);
  if (prevGw.join() !== currGw.join() && (prevGw.length || currGw.length)) {
    out.push({
      signalType: "SECURITY_GATEWAY_CHANGE",
      claim: `Email security gateway indicators for ${curr.domain} changed (${prevGw.join("/") || "none"} → ${currGw.join("/") || "none"})`,
    });
  }
  if (ns(prev) && ns(curr) && ns(prev) !== ns(curr)) {
    out.push({
      signalType: "DNS_PROVIDER_CHANGE",
      claim: `Authoritative DNS for ${curr.domain} moved (${ns(prev)} → ${ns(curr)})`,
    });
  }
  return out;
}

async function query(domain: string, type: string): Promise<string[]> {
  const res = await fetch(`${DOH}?name=${encodeURIComponent(domain)}&type=${type}`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { Answer?: { data: string }[] };
  return (body.Answer ?? []).map((a) => a.data);
}

export class DnsProvider implements IntelligenceProvider {
  providerId = "dns";
  providerType = "NETWORK" as const;
  costClass = "FREE" as const;
  sourceTrustPrior = 0.8;
  sourceKind = "external" as const;
  supportedFamilies = ["TECHNOLOGY" as const, "TECHNOLOGY_CHANGE" as const];

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    if (!target.domain) return [];
    const records: Record<string, string[]> = {};
    for (const type of RECORD_TYPES) {
      records[type] = await query(target.domain, type);
    }
    const snapshot: DnsSnapshot = { domain: target.domain, records };
    const fingerprint = RECORD_TYPES.map((t) => `${t}:${[...records[t]].sort().join(";")}`).join("|");
    return [{ payload: snapshot, contentHash: contentHash(fingerprint) }];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    history: { payload: unknown; observedAt: Date }[],
    target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const snap = current[0].payload as DnsSnapshot;
    const out: EvidenceCandidate[] = [];

    for (const { vendor, via } of detectVendors(snap)) {
      out.push({
        claim: `DNS ${via} records for ${snap.domain} indicate ${vendor} infrastructure`,
        confidence: 0.7, // an indicator, never proof
        firstParty: false,
        suggestedSignalType: "VENDOR_INFRA_EVIDENCE",
      });
    }

    const prev = history[0]?.payload as DnsSnapshot | undefined;
    if (prev) {
      for (const change of detectDnsChanges(prev, snap)) {
        out.push({
          claim: change.claim,
          confidence: 0.85, // the change itself is directly observed
          firstParty: false,
          suggestedSignalType: change.signalType,
        });
      }
    }
    return out;
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const answers = await query("cloudflare.com", "NS");
      return { ok: answers.length > 0, detail: `DoH resolver returned ${answers.length} records` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
