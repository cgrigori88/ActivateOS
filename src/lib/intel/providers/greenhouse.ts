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
 * Greenhouse job-board provider (DIRECTIVE P0-A). Public boards API, no
 * auth, free. Each fetch stores ONE snapshot observation (all current
 * postings); identical snapshots dedupe by content hash, and velocity
 * features come from snapshot history.
 */

const API = "https://boards-api.greenhouse.io/v1/boards";

function slugCandidates(target: IntelligenceTarget): string[] {
  const out = new Set<string>();
  if (target.handles?.greenhouse) out.add(target.handles.greenhouse);
  if (target.domain) out.add(target.domain.split(".")[0].toLowerCase());
  const name = target.companyName.toLowerCase().replace(/\b(inc|llc|corp|ltd|financial|systems)\b\.?/g, "").trim();
  out.add(name.replace(/[^a-z0-9]/g, ""));
  out.add(name.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""));
  return [...out].filter(Boolean);
}

interface GhJob {
  id: number;
  title: string;
  updated_at?: string;
  first_published?: string;
  absolute_url?: string;
  location?: { name?: string };
  departments?: { name?: string }[];
}

function toPosting(j: GhJob): JobPosting {
  return {
    externalId: `gh-${j.id}`,
    title: j.title,
    department: j.departments?.[0]?.name ?? null,
    location: j.location?.name ?? null,
    url: j.absolute_url ?? null,
    publishedAt: j.first_published ? new Date(j.first_published) : null,
  };
}

function snapshotFromPayload(payload: unknown, observedAt: Date): HiringSnapshot {
  const p = payload as { jobs?: GhJob[] };
  return {
    jobs: (p.jobs ?? []).map((j) => ({
      ...toPosting(j),
      publishedAt: toPosting(j).publishedAt,
    })),
    observedAt,
  };
}

export class GreenhouseProvider implements IntelligenceProvider {
  providerId = "greenhouse";
  providerType = "HIRING" as const;
  costClass = "FREE" as const;
  sourceTrustPrior = 0.85;
  sourceKind = "first_party" as const;
  supportedFamilies = ["HIRING" as const, "ORGANIZATIONAL_CHANGE" as const];

  async discover(target: IntelligenceTarget): Promise<Record<string, string> | null> {
    for (const slug of slugCandidates(target)) {
      const res = await fetch(`${API}/${slug}/jobs`, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) return { greenhouse: slug };
    }
    return null;
  }

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    const board = target.handles?.greenhouse;
    if (!board) return []; // no board found — absence of data, not an error
    const res = await fetch(`${API}/${board}/jobs`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`greenhouse ${board}: HTTP ${res.status}`);
    const body = (await res.json()) as { jobs?: GhJob[] };
    const jobs = (body.jobs ?? []).map((j) => ({
      id: j.id,
      title: j.title,
      updated_at: j.updated_at,
      first_published: j.first_published,
      absolute_url: j.absolute_url,
      location: j.location,
      departments: j.departments,
    }));
    const fingerprint = jobs.map((j) => `${j.id}:${j.title}`).sort().join("|");
    return [
      {
        sourceUrl: `${API}/${board}/jobs`,
        payload: { board, jobs },
        contentHash: contentHash(fingerprint),
      },
    ];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    history: { payload: unknown; observedAt: Date }[],
    target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    // Unchanged snapshot (nothing new) = stop; no re-derived evidence.
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const now = new Date();
    const snap = snapshotFromPayload(current[0].payload, now);
    const past = history.map((h) => snapshotFromPayload(h.payload, h.observedAt));
    const features = computeHiringFeatures(snap, past, now);
    const board = (current[0].payload as { board?: string }).board;
    return hiringEvidence(
      features,
      target.companyName,
      board ? `https://boards.greenhouse.io/${board}` : null,
    );
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const res = await fetch(`${API}/greenhouse/jobs`, { signal: AbortSignal.timeout(8_000) });
      return { ok: res.ok, detail: `boards API HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
