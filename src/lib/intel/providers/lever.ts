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
 * Lever job-board provider (DIRECTIVE P0-B). Public postings API, no auth.
 * Maps into the SAME HiringSnapshot model as Greenhouse — zero duplicated
 * downstream logic.
 */

const API = "https://api.lever.co/v0/postings";

interface LeverJob {
  id: string;
  text: string; // title
  createdAt?: number;
  hostedUrl?: string;
  categories?: { team?: string; location?: string; department?: string };
}

function toPosting(j: LeverJob): JobPosting {
  return {
    externalId: `lv-${j.id}`,
    title: j.text,
    department: j.categories?.department ?? j.categories?.team ?? null,
    location: j.categories?.location ?? null,
    url: j.hostedUrl ?? null,
    publishedAt: j.createdAt ? new Date(j.createdAt) : null,
  };
}

function snapshotFromPayload(payload: unknown, observedAt: Date): HiringSnapshot {
  const p = payload as { jobs?: LeverJob[] };
  return { jobs: (p.jobs ?? []).map(toPosting), observedAt };
}

function slugCandidates(target: IntelligenceTarget): string[] {
  const out = new Set<string>();
  if (target.handles?.lever) out.add(target.handles.lever);
  if (target.domain) out.add(target.domain.split(".")[0].toLowerCase());
  out.add(target.companyName.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return [...out].filter(Boolean);
}

export class LeverProvider implements IntelligenceProvider {
  providerId = "lever";
  providerType = "HIRING" as const;
  costClass = "FREE" as const;
  sourceTrustPrior = 0.85;
  sourceKind = "first_party" as const;
  supportedFamilies = ["HIRING" as const, "ORGANIZATIONAL_CHANGE" as const];

  async discover(target: IntelligenceTarget): Promise<Record<string, string> | null> {
    for (const slug of slugCandidates(target)) {
      const res = await fetch(`${API}/${slug}?mode=json&limit=1`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const body = (await res.json()) as unknown[];
        if (Array.isArray(body)) return { lever: slug };
      }
    }
    return null;
  }

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    const slug = target.handles?.lever;
    if (!slug) return [];
    const res = await fetch(`${API}/${slug}?mode=json`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`lever ${slug}: HTTP ${res.status}`);
    const body = (await res.json()) as LeverJob[];
    if (!Array.isArray(body)) return [];
    const jobs = body.map((j) => ({
      id: j.id,
      text: j.text,
      createdAt: j.createdAt,
      hostedUrl: j.hostedUrl,
      categories: j.categories,
    }));
    const fingerprint = jobs.map((j) => `${j.id}:${j.text}`).sort().join("|");
    return [
      {
        sourceUrl: `${API}/${slug}`,
        payload: { slug, jobs },
        contentHash: contentHash(fingerprint),
      },
    ];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    history: { payload: unknown; observedAt: Date }[],
    target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const now = new Date();
    const snap = snapshotFromPayload(current[0].payload, now);
    const past = history.map((h) => snapshotFromPayload(h.payload, h.observedAt));
    const features = computeHiringFeatures(snap, past, now);
    const slug = (current[0].payload as { slug?: string }).slug;
    return hiringEvidence(features, target.companyName, slug ? `https://jobs.lever.co/${slug}` : null);
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const res = await fetch(`${API}/lever?mode=json&limit=1`, {
        signal: AbortSignal.timeout(8_000),
      });
      return { ok: res.ok, detail: `postings API HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
