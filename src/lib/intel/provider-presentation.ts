import type { ProviderHealthRow } from "./provider-health";

/**
 * Provider presentation (Wave 5 §6/§10) — the business face of the intelligence
 * registry.
 *
 * The Provider Health room rendered the registry's own identifiers as its primary
 * column: `pdl_company`, `sec_edgar`, `http_fingerprint`, `common_crawl`. Those
 * are code keys. It also printed raw enum constants (`FIRMOGRAPHIC`, `LOW_COST`,
 * `PUBLIC_COMPANY`) and raw failure codes (`DISABLED_NO_CREDITS`) to an operator
 * whose actual question is "can I trust what this system knows right now?".
 *
 * This module is presentation only. It renames nothing in the registry, changes
 * no provider behaviour, and calls no integration. It maps identifiers to names
 * an operator recognises, and derives §10's health vocabulary from fields the
 * health loader already returns.
 */

/* ── Names ──────────────────────────────────────────────────────────────────
   Where a provider is a named third party, the name is the vendor's. Where it
   is something PursuitOS does itself, the name says what it does. Anything not
   listed falls back to a de-slugged form of its own id, so a newly registered
   provider degrades to "Common Crawl" rather than disappearing. */
const PROVIDER_NAMES: Record<string, string> = {
  pdl_company: "People Data Labs — companies",
  pdl_people: "People Data Labs — people",
  sec_edgar: "SEC EDGAR filings",
  greenhouse: "Greenhouse job postings",
  lever: "Lever job postings",
  careers: "Careers pages",
  website: "Company website",
  github: "GitHub activity",
  dns: "DNS records",
  http_fingerprint: "Website technology fingerprint",
  builtwith_free: "BuiltWith — categories",
  builtwith_domain: "BuiltWith — full inventory",
  builtwith_change: "BuiltWith — technology changes",
  wappalyzer: "Wappalyzer",
  gdelt: "GDELT news radar",
  ipinfo: "IP intelligence",
  tavily: "Tavily research",
  censys: "Censys infrastructure",
  common_crawl: "Common Crawl archive",
};

export function providerLabel(providerId: string): string {
  return (
    PROVIDER_NAMES[providerId] ??
    providerId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/* ── What kind of evidence it produces ─────────────────────────────────────
   The registry's `providerType` is a constant like PUBLIC_COMPANY. An operator
   reads the evidence category, not the enum. */
const EVIDENCE_KIND: Record<string, string> = {
  FIRMOGRAPHIC: "Company profile",
  PUBLIC_COMPANY: "Public filings",
  HIRING: "Hiring signals",
  FIRST_PARTY: "First-party web",
  DEVELOPER: "Engineering activity",
  NETWORK: "Network & infrastructure",
  TECHNOGRAPHIC: "Technology in use",
  PUBLIC_NEWS: "News & events",
  PEOPLE: "People & roles",
  CORPORATE_EVENT: "Corporate change",
};

export function evidenceKind(providerType: string): string {
  return EVIDENCE_KIND[providerType] ?? providerType.replace(/_/g, " ").toLowerCase();
}

/* ── Health (§10) ───────────────────────────────────────────────────────────
   Six states, each meaning one thing. The brief is explicit that these must not
   collapse into "error" or a grey zero, because they call for different actions:
   a STALE feed needs a refresh, an UNAVAILABLE one needs investigation, and a
   NOT CONFIGURED one needs a decision about spend or entitlement — nobody should
   go debugging the third.

   Every state below is derived from fields the loader already returns. Nothing
   is inferred beyond what the record supports; a provider that has never run is
   said to have never run rather than being scored as healthy or broken. */
export type HealthState =
  | "healthy"
  | "degraded"
  | "stale"
  | "unavailable"
  | "not_configured"
  | "disabled"
  | "never_run";

export const HEALTH_LABEL: Record<HealthState, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  stale: "Stale",
  unavailable: "Unavailable",
  not_configured: "Not configured",
  disabled: "Disabled",
  never_run: "Not yet run",
};

/** Intent colour per state. Neutral is deliberate for the two non-fault states. */
export const HEALTH_TONE: Record<HealthState, { color: string; background: string }> = {
  healthy: { color: "var(--color-accent-verified)", background: "color-mix(in srgb, var(--color-accent-verified) 12%, transparent)" },
  degraded: { color: "var(--color-accent-attention)", background: "color-mix(in srgb, var(--color-accent-attention) 14%, transparent)" },
  stale: { color: "var(--color-timing)", background: "color-mix(in srgb, var(--color-timing) 14%, transparent)" },
  unavailable: { color: "var(--color-accent-risk)", background: "color-mix(in srgb, var(--color-accent-risk) 12%, transparent)" },
  not_configured: { color: "var(--ink-faint)", background: "var(--surface-inset)" },
  disabled: { color: "var(--ink-faint)", background: "var(--surface-inset)" },
  never_run: { color: "var(--ink-faint)", background: "var(--surface-inset)" },
};

/** One clause saying what the state means for the reader's data. */
export const HEALTH_MEANING: Record<HealthState, string> = {
  healthy: "recent runs succeeded",
  degraded: "succeeding, but with recent failures",
  stale: "last succeeded a while ago",
  unavailable: "the most recent run failed",
  not_configured: "needs an account, key or credits before it can run",
  disabled: "switched off for this workspace",
  never_run: "registered, but has not run here yet",
};

/** A feed whose last success is older than this reads as stale rather than healthy. */
const STALE_AFTER_DAYS = 14;

export function healthState(r: ProviderHealthRow, now = Date.now()): HealthState {
  // An entitlement problem is not a fault — it is a decision the operator has
  // not made yet, and it is actionable in a completely different way.
  if (r.disabledReason) {
    return /CREDIT|PLAN|KEY|ACCESS|CONFIG/i.test(r.disabledReason) ? "not_configured" : "disabled";
  }
  if (r.runs === 0) return "never_run";
  if (r.lastStatus === "failed") return "unavailable";

  const ageDays = r.lastRunAt ? (now - new Date(r.lastRunAt).getTime()) / 86_400_000 : Infinity;
  if (ageDays > STALE_AFTER_DAYS) return "stale";

  // Recent failures alongside a successful latest run: working, but not cleanly.
  if (r.recentRuns.some((s) => s === "failed")) return "degraded";
  return "healthy";
}

/** Freshness, in the reader's terms. Null when the provider has never run. */
export function freshness(r: ProviderHealthRow, now = Date.now()): string | null {
  if (!r.lastRunAt) return null;
  const days = Math.floor((now - new Date(r.lastRunAt).getTime()) / 86_400_000);
  if (days <= 0) return "refreshed today";
  if (days === 1) return "refreshed yesterday";
  if (days < 30) return `refreshed ${days} days ago`;
  const months = Math.floor(days / 30);
  return `refreshed ${months} month${months === 1 ? "" : "s"} ago`;
}

/**
 * The headline an operator needs before any table: can the inputs be trusted?
 * Counts only — no score, no composite index.
 */
export function healthSummary(rows: ProviderHealthRow[], now = Date.now()) {
  const by = new Map<HealthState, number>();
  for (const r of rows) {
    const s = healthState(r, now);
    by.set(s, (by.get(s) ?? 0) + 1);
  }
  const get = (s: HealthState) => by.get(s) ?? 0;
  return {
    by,
    healthy: get("healthy"),
    degraded: get("degraded"),
    stale: get("stale"),
    unavailable: get("unavailable"),
    notConfigured: get("not_configured"),
    disabled: get("disabled"),
    neverRun: get("never_run"),
    /** Feeds in a state that should worry someone right now. */
    needsAttention: get("degraded") + get("stale") + get("unavailable"),
  };
}
