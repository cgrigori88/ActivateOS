import { contentHash } from "../pipeline";
import type {
  EvidenceCandidate,
  IntelligenceProvider,
  IntelligenceTarget,
  ProviderHealth,
  RawObservationInput,
} from "../provider";

/**
 * GitHub engineering intelligence (DIRECTIVE P1-A). Public REST API,
 * unauthenticated (60 req/hr) or with GITHUB_TOKEN (higher limit). Runs only
 * for engineering-observable product categories — the policy layer enforces
 * that; this provider focuses on CHANGE and MOMENTUM in the company's public
 * org, never treating public activity as proof of enterprise-wide adoption.
 */

const API = "https://api.github.com";

interface GhRepo {
  name: string;
  language: string | null;
  pushed_at: string | null;
  created_at: string | null;
  archived: boolean;
  fork: boolean;
  topics?: string[];
}
interface GithubSnapshot {
  org: string;
  repos: GhRepo[];
}

// Technology-topic patterns → the momentum they evidence.
const TOPIC_PATTERNS: { pattern: RegExp; signalType: string; node?: string; label: string }[] = [
  { pattern: /kubernetes|k8s|helm|openshift|kustomize/i, signalType: "KUBERNETES_ADOPTION_SIGNAL", node: "kubernetes", label: "Kubernetes" },
  { pattern: /terraform|pulumi|cloudformation|ansible|infrastructure-as-code|\biac\b/i, signalType: "INFRA_AS_CODE_EXPANSION", node: "infrastructure-automation", label: "infrastructure-as-code" },
  { pattern: /\bml\b|machine-learning|mlops|llm|pytorch|tensorflow|langchain/i, signalType: "AI_ENGINEERING_EXPANSION", node: "ai-platforms", label: "AI/ML" },
  { pattern: /docker|containerd|cloud-native|serverless|microservices/i, signalType: "CLOUD_NATIVE_ENGINEERING_EXPANSION", node: "containers", label: "cloud-native" },
  { pattern: /automation|ci-cd|cicd|pipeline|devops|gitops/i, signalType: "AUTOMATION_ENGINEERING_ACTIVITY", node: "infrastructure-automation", label: "automation/DevOps" },
];

function repoText(r: GhRepo): string {
  return `${r.name} ${r.language ?? ""} ${(r.topics ?? []).join(" ")}`;
}

const RECENT_DAYS = 90;

export interface GithubFeatures {
  activeRepos: number;
  recentlyPushed90d: number;
  createdLast90d: number;
  byTechnology: { signalType: string; node?: string; label: string; repos: number }[];
}

/** Momentum features over the org's public repos. Pure. */
export function computeGithubFeatures(snap: GithubSnapshot, now: Date = new Date()): GithubFeatures {
  const live = snap.repos.filter((r) => !r.archived && !r.fork);
  const recentCut = now.getTime() - RECENT_DAYS * 86_400_000;
  const recentlyPushed90d = live.filter(
    (r) => r.pushed_at && new Date(r.pushed_at).getTime() >= recentCut,
  ).length;
  const createdLast90d = live.filter(
    (r) => r.created_at && new Date(r.created_at).getTime() >= recentCut,
  ).length;

  const byTechnology = TOPIC_PATTERNS.map((p) => {
    const repos = live.filter(
      (r) => p.pattern.test(repoText(r)) && r.pushed_at && new Date(r.pushed_at).getTime() >= recentCut,
    ).length;
    return { signalType: p.signalType, node: p.node, label: p.label, repos };
  }).filter((t) => t.repos > 0);

  return { activeRepos: live.length, recentlyPushed90d, createdLast90d, byTechnology };
}

const TECH_MIN_REPOS = 2; // one repo is noise; a cluster is momentum

function orgCandidates(target: IntelligenceTarget): string[] {
  const out = new Set<string>();
  if (target.handles?.github) out.add(target.handles.github);
  if (target.domain) out.add(target.domain.split(".")[0].toLowerCase());
  out.add(target.companyName.toLowerCase().replace(/[^a-z0-9]/g, ""));
  out.add(target.companyName.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, ""));
  return [...out].filter(Boolean);
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "PursuitOS-intel",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

export class GithubProvider implements IntelligenceProvider {
  providerId = "github";
  providerType = "DEVELOPER" as const;
  costClass = "FREE" as const;
  sourceTrustPrior = 0.7; // public activity ≠ enterprise adoption
  sourceKind = "external" as const;
  supportedFamilies = ["ENGINEERING_ACTIVITY" as const];

  async discover(target: IntelligenceTarget): Promise<Record<string, string> | null> {
    for (const org of orgCandidates(target)) {
      const res = await fetch(`${API}/orgs/${org}`, {
        headers: ghHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { github: org };
    }
    return null;
  }

  async fetch(target: IntelligenceTarget): Promise<RawObservationInput[]> {
    const org = target.handles?.github;
    if (!org) return [];
    const res = await fetch(`${API}/orgs/${org}/repos?per_page=100&sort=pushed`, {
      headers: ghHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return []; // no such org — absence, not error
    if (!res.ok) throw new Error(`github ${org}: HTTP ${res.status}`);
    const body = (await res.json()) as GhRepo[];
    const repos = (Array.isArray(body) ? body : []).map((r) => ({
      name: r.name,
      language: r.language ?? null,
      pushed_at: r.pushed_at ?? null,
      created_at: r.created_at ?? null,
      archived: r.archived ?? false,
      fork: r.fork ?? false,
      topics: r.topics ?? [],
    }));
    const fingerprint = repos.map((r) => `${r.name}:${r.pushed_at}`).sort().join("|");
    return [
      {
        sourceUrl: `https://github.com/${org}`,
        payload: { org, repos },
        contentHash: contentHash(`github:${fingerprint}`),
      },
    ];
  }

  normalize(
    current: { payload: unknown; isNew: boolean }[],
    _history: { payload: unknown; observedAt: Date }[],
    target: IntelligenceTarget,
  ): EvidenceCandidate[] {
    if (current.length === 0 || !current.some((c) => c.isNew)) return [];
    const snap = current[0].payload as GithubSnapshot;
    const features = computeGithubFeatures(snap);
    const out: EvidenceCandidate[] = [];

    for (const tech of features.byTechnology) {
      if (tech.repos < TECH_MIN_REPOS) continue;
      out.push({
        claim:
          `${target.companyName}'s public GitHub org shows active ${tech.label} engineering ` +
          `(${tech.repos} public repositories updated in the last 90 days)`,
        sourceUrl: `https://github.com/${snap.org}`,
        confidence: 0.7,
        firstParty: false, // public engineering activity, not an install claim
        suggestedSignalType: tech.signalType,
        suggestedNodeSlug: tech.node,
      });
    }
    return out;
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const res = await fetch(`${API}/orgs/kubernetes`, {
        headers: ghHeaders(),
        signal: AbortSignal.timeout(8_000),
      });
      return { ok: res.ok, detail: `REST API HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
}
