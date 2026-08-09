import { contentHash } from "../pipeline";
import type {
  EvidenceCandidate,
  IntelligenceProvider,
  IntelligenceTarget,
  ProviderHealth,
  RawObservationInput,
} from "../provider";

/**
 * HTTP technology fingerprint (DIRECTIVE P0-G): inexpensive supporting
 * technographic evidence from a single homepage fetch — response headers,
 * HTML <meta generator>, and known service-domain script references. Not a
 * commercial technographic database; conservative confidence, phrased as
 * web-facing observations only. Change detection via fingerprint hash.
 */

const TIMEOUT = 12_000;

export interface HttpFingerprint {
  domain: string;
  server: string | null;
  poweredBy: string | null;
  vendors: string[]; // detected web/CDN/cloud vendors
  generator: string | null; // <meta name="generator">
}

// Header/HTML → vendor. Deterministic and conservative.
const HEADER_VENDORS: { header: string; pattern: RegExp; vendor: string }[] = [
  { header: "server", pattern: /cloudflare/i, vendor: "Cloudflare" },
  { header: "server", pattern: /awselb|amazons3|aws/i, vendor: "AWS" },
  { header: "server", pattern: /gws|google/i, vendor: "Google" },
  { header: "server", pattern: /microsoft-iis|azure/i, vendor: "Microsoft/Azure" },
  { header: "server", pattern: /nginx/i, vendor: "nginx" },
  { header: "server", pattern: /apache/i, vendor: "Apache" },
  { header: "x-served-by", pattern: /fastly/i, vendor: "Fastly" },
  { header: "x-akamai-transformed", pattern: /.*/i, vendor: "Akamai" },
  { header: "cf-ray", pattern: /.*/i, vendor: "Cloudflare" },
  { header: "x-amz-cf-id", pattern: /.*/i, vendor: "AWS CloudFront" },
  { header: "x-vercel-id", pattern: /.*/i, vendor: "Vercel" },
  { header: "x-powered-by", pattern: /aspnet|asp\.net/i, vendor: "ASP.NET" },
  { header: "x-shopify-stage", pattern: /.*/i, vendor: "Shopify" },
];

const SCRIPT_VENDORS: { pattern: RegExp; vendor: string }[] = [
  { pattern: /cdn\.shopify\.com/i, vendor: "Shopify" },
  { pattern: /cloudfront\.net/i, vendor: "AWS CloudFront" },
  { pattern: /akamaized\.net|akamai/i, vendor: "Akamai" },
  { pattern: /googletagmanager|google-analytics/i, vendor: "Google Analytics" },
  { pattern: /hs-scripts\.com|hubspot/i, vendor: "HubSpot" },
  { pattern: /marketo|munchkin/i, vendor: "Marketo" },
  { pattern: /segment\.com|segment\.io/i, vendor: "Segment" },
];

const CLOUD_VENDORS = new Set(["AWS", "AWS CloudFront", "Cloudflare", "Microsoft/Azure", "Google", "Fastly", "Akamai", "Vercel"]);

export function fingerprintFrom(
  domain: string,
  headers: Record<string, string>,
  html: string,
): HttpFingerprint {
  const vendors = new Set<string>();
  for (const { header, pattern, vendor } of HEADER_VENDORS) {
    const v = headers[header.toLowerCase()];
    if (v && pattern.test(v)) vendors.add(vendor);
  }
  const scripts = html.match(/<script[^>]+src=["']([^"']+)["']/gi) ?? [];
  const scriptText = scripts.join(" ");
  for (const { pattern, vendor } of SCRIPT_VENDORS) {
    if (pattern.test(scriptText)) vendors.add(vendor);
  }
  const gen = html.match(/<meta\s+name=["']generator["']\s+content=["']([^"']+)["']/i);

  return {
    domain,
    server: headers["server"] ?? null,
    poweredBy: headers["x-powered-by"] ?? null,
    vendors: [...vendors].sort(),
    generator: gen ? gen[1] : null,
  };
}

export class HttpFingerprintProvider implements IntelligenceProvider {
  providerId = "http_fingerprint";
  providerType = "TECHNOGRAPHIC" as const;
  costClass = "FREE" as const;
  sourceTrustPrior = 0.7; // ambiguous public metadata — supporting only
  sourceKind = "external" as const;
  supportedFamilies = ["TECHNOLOGY" as const, "TECHNOLOGY_CHANGE" as const];

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    if (!target.domain) return [];
    let res: Response;
    try {
      res = await fetch(`https://${target.domain}`, {
        headers: { "User-Agent": "PursuitOS-intel", Accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch {
      return []; // unreachable homepage = absence, not error
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    const html = (await res.text()).slice(0, 200_000);
    const fp = fingerprintFrom(target.domain, headers, html);
    const key = `${fp.server}|${fp.poweredBy}|${fp.vendors.join(",")}|${fp.generator}`;
    return [{ payload: fp, contentHash: contentHash(`http:${key}`) }];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    history: { payload: unknown; observedAt: Date }[],
    _target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const fp = current[0].payload as HttpFingerprint;
    const out: EvidenceCandidate[] = [];

    const cloud = fp.vendors.filter((v) => CLOUD_VENDORS.has(v));
    if (cloud.length > 0) {
      out.push({
        claim: `${fp.domain}'s web front end is served via ${cloud.join(", ")} (HTTP fingerprint)`,
        confidence: 0.7,
        firstParty: false,
        suggestedSignalType: "CLOUD_WEB_INFRASTRUCTURE_EVIDENCE",
      });
    }
    for (const v of fp.vendors.filter((x) => !CLOUD_VENDORS.has(x))) {
      out.push({
        claim: `${fp.domain}'s web presence shows ${v} (HTTP fingerprint)`,
        confidence: 0.65,
        firstParty: false,
        suggestedSignalType: "VENDOR_INFRA_EVIDENCE",
      });
    }

    // Web-infrastructure change vs the prior fingerprint.
    const prev = history[0]?.payload as HttpFingerprint | undefined;
    if (prev && prev.vendors.join() !== fp.vendors.join() && (prev.vendors.length || fp.vendors.length)) {
      out.push({
        claim: `${fp.domain}'s web infrastructure fingerprint changed (${prev.vendors.join("/") || "none"} → ${fp.vendors.join("/") || "none"})`,
        confidence: 0.8,
        firstParty: false,
        suggestedSignalType: "WEB_INFRASTRUCTURE_CHANGE",
      });
    }
    return out;
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const res = await fetch("https://example.com", { signal: AbortSignal.timeout(8_000) });
      return { ok: res.ok, detail: `homepage fetch HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
