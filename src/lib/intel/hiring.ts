import type { EvidenceCandidate } from "./provider";

/**
 * Shared hiring-intelligence model (DIRECTIVE P0-A/B): Greenhouse and Lever
 * both normalize into THIS — no duplicated downstream logic. A single job is
 * not intent; the features are counts, velocity, and new-role detection over
 * stored history. Classification is deterministic keyword rules (free), not
 * an LLM — job titles are structured enough that tokens would be wasted.
 */

export interface JobPosting {
  externalId: string;
  title: string;
  department: string | null;
  location: string | null;
  url: string | null;
  publishedAt: Date | null;
}

export type RoleFamily =
  | "platform_engineering"
  | "automation"
  | "cloud"
  | "security"
  | "ai_infrastructure"
  | "kubernetes";

const ROLE_PATTERNS: Record<RoleFamily, RegExp> = {
  platform_engineering: /\b(platform (engineer|engineering)|internal developer platform|developer experience)\b/i,
  automation: /\b(automation|ansible|infrastructure as code|iac|terraform|sre|site reliability)\b/i,
  cloud: /\b(cloud (engineer|architect|infrastructure|operations)|aws|azure|gcp|hybrid.?cloud)\b/i,
  security: /\b(security (engineer|architect|analyst|operations)|infosec|devsecops|soc analyst)\b/i,
  ai_infrastructure: /\b(ml (infrastructure|platform|ops)|mlops|ai (infrastructure|platform)|gpu (cluster|infrastructure)|llm)\b/i,
  kubernetes: /\b(kubernetes|k8s|openshift|container platform)\b/i,
};

const LEADERSHIP = /\b(vp|vice president|head of|director|chief|cto|cio|ciso)\b/i;
const TECH_ROLE = /\b(engineer|engineering|architect|developer|infrastructure|platform|devops|sre|technology|technical|cloud|security|data|software|systems)\b/i;

export function classifyJob(title: string): {
  families: RoleFamily[];
  leadership: boolean;
  technical: boolean;
} {
  const families = (Object.keys(ROLE_PATTERNS) as RoleFamily[]).filter((f) =>
    ROLE_PATTERNS[f].test(title),
  );
  return {
    families,
    leadership: LEADERSHIP.test(title) && TECH_ROLE.test(title),
    technical: TECH_ROLE.test(title),
  };
}

export interface HiringSnapshot {
  jobs: JobPosting[];
  observedAt: Date;
}

export interface HiringFeatures {
  relevantJobsCurrent: number;
  byFamily: Record<RoleFamily, number>;
  newRelevantJobs30d: number;
  growth30d: number | null; // relative change vs snapshot ≥30d ago; null without history
  newLeadershipRoles: JobPosting[];
}

const DAY = 86_400_000;

/** Pure velocity computation over the current snapshot + history. */
export function computeHiringFeatures(
  current: HiringSnapshot,
  history: HiringSnapshot[],
  now: Date = new Date(),
): HiringFeatures {
  const classify = (jobs: JobPosting[]) =>
    jobs.filter((j) => classifyJob(j.title).families.length > 0);

  const relevantNow = classify(current.jobs);
  const byFamily = Object.fromEntries(
    (Object.keys(ROLE_PATTERNS) as RoleFamily[]).map((f) => [
      f,
      current.jobs.filter((j) => classifyJob(j.title).families.includes(f)).length,
    ]),
  ) as Record<RoleFamily, number>;

  // Jobs first seen in the trailing 30 days (by earliest observation or
  // posting date when available).
  const firstSeen = new Map<string, number>();
  for (const snap of [...history, current]) {
    for (const j of snap.jobs) {
      const t = j.publishedAt?.getTime() ?? snap.observedAt.getTime();
      const prev = firstSeen.get(j.externalId);
      if (prev == null || t < prev) firstSeen.set(j.externalId, t);
    }
  }
  const newRelevantJobs30d = relevantNow.filter(
    (j) => (firstSeen.get(j.externalId) ?? now.getTime()) >= now.getTime() - 30 * DAY,
  ).length;

  // Growth vs the newest snapshot at least 30 days old.
  const baseline = [...history]
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())
    .find((s) => now.getTime() - s.observedAt.getTime() >= 30 * DAY);
  const growth30d = baseline
    ? baseline.jobs.length === 0
      ? relevantNow.length > 0 ? 1 : 0
      : Math.round(((relevantNow.length - classify(baseline.jobs).length) / Math.max(1, classify(baseline.jobs).length)) * 100) / 100
    : null;

  const previouslySeen = new Set(history.flatMap((s) => s.jobs.map((j) => j.externalId)));
  const newLeadershipRoles = current.jobs.filter(
    (j) => classifyJob(j.title).leadership && !previouslySeen.has(j.externalId),
  );

  return {
    relevantJobsCurrent: relevantNow.length,
    byFamily,
    newRelevantJobs30d,
    growth30d,
    newLeadershipRoles,
  };
}

const FAMILY_SIGNAL: Record<RoleFamily, string> = {
  platform_engineering: "PLATFORM_ENGINEERING_EXPANSION",
  automation: "AUTOMATION_HIRING_ACCELERATION",
  cloud: "CLOUD_HIRING_ACCELERATION",
  security: "SECURITY_TEAM_EXPANSION",
  ai_infrastructure: "AI_INFRASTRUCTURE_HIRING",
  kubernetes: "KUBERNETES_HIRING",
};
const FAMILY_NODE: Partial<Record<RoleFamily, string>> = {
  automation: "infrastructure-automation",
  kubernetes: "kubernetes",
  cloud: "hybrid-cloud",
  security: "security-automation",
};

const EXPANSION_THRESHOLD = 3; // fewer relevant roles than this is noise

/**
 * Features → evidence candidates. Job boards are the company speaking about
 * itself (FIRST_PARTY_PUBLIC). Claims state observable facts — counts and
 * changes — never inferred intent.
 */
export function hiringEvidence(
  features: HiringFeatures,
  companyName: string,
  boardUrl: string | null,
): EvidenceCandidate[] {
  const out: EvidenceCandidate[] = [];
  for (const [family, count] of Object.entries(features.byFamily) as [RoleFamily, number][]) {
    if (count < EXPANSION_THRESHOLD) continue;
    const label = family.replace(/_/g, " ");
    out.push({
      claim:
        `${companyName} currently lists ${count} open ${label} roles on its job board` +
        (features.newRelevantJobs30d > 0
          ? `, ${features.newRelevantJobs30d} relevant roles added in the last 30 days`
          : ""),
      sourceUrl: boardUrl ?? undefined,
      confidence: 0.95,
      firstParty: true,
      suggestedSignalType: FAMILY_SIGNAL[family],
      suggestedNodeSlug: FAMILY_NODE[family],
    });
  }
  for (const role of features.newLeadershipRoles) {
    out.push({
      claim: `${companyName} opened a new technology-leadership position: ${role.title}`,
      sourceUrl: role.url ?? boardUrl ?? undefined,
      confidence: 0.95,
      firstParty: true,
      suggestedSignalType: "NEW_TECHNOLOGY_LEADERSHIP",
    });
  }
  return out;
}
