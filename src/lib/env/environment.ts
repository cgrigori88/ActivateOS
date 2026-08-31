/**
 * Environment identity — the one place that answers "which PursuitOS is this?".
 *
 * The three-environment topology (public site / production app / private demo)
 * runs ONE codebase in THREE operational worlds. Everything that must behave
 * differently between them reads from here rather than sniffing hostnames or
 * re-deriving intent from a scatter of unrelated variables.
 *
 * Two independent sources of truth, deliberately:
 *
 *   PURSUITOS_ENV        what the DEPLOYMENT claims to be. Cheap, synchronous,
 *                        available at render time — but it is just a string an
 *                        operator typed, so it can be wrong.
 *   environment_identity what the DATABASE says it is (migration 0102). A row
 *                        that travels WITH the data, so a connection string
 *                        pasted into the wrong project is caught by the data
 *                        it reached, not by the label someone attached to it.
 *
 * Destructive tooling must trust the second, never the first — see `db-identity.ts`.
 */

export type SiteMode = "public" | "app" | "demo" | "local";

const MODES: readonly SiteMode[] = ["public", "app", "demo", "local"];

/**
 * The deployment's declared identity.
 *
 * Unset resolves to "local", which is correct for a developer machine and safe
 * everywhere else: "local" is never treated as production (so nothing gains
 * production trust by omission) and never treated as demo (so nothing gains
 * permission to reseed by omission). An unrecognised value is NOT silently
 * coerced — a typo'd `PURSUITOS_ENV=prod` must not read as "app".
 */
export function siteMode(): SiteMode {
  const raw = process.env.PURSUITOS_ENV?.trim().toLowerCase();
  if (!raw) return "local";
  if ((MODES as readonly string[]).includes(raw)) return raw as SiteMode;
  throw new Error(
    `PURSUITOS_ENV is "${raw}", which is not one of ${MODES.join(" | ")}. ` +
      `Refusing to guess which environment this is.`,
  );
}

/** The public marketing site: no app routes, no database, no tenant data. */
export function isPublicSite(): boolean {
  return siteMode() === "public";
}

/** The real multi-tenant application serving actual customers. */
export function isProductionApp(): boolean {
  return siteMode() === "app";
}

/** The private synthetic demo. Reset/reseed is permitted only here. */
export function isDemo(): boolean {
  return siteMode() === "demo";
}

/**
 * Human-readable label for operator surfaces. Never used for a decision —
 * decisions use the predicates above so a label change cannot alter behaviour.
 */
export function environmentLabel(): string {
  switch (siteMode()) {
    case "public": return "Public site";
    case "app": return "Production app";
    case "demo": return "Private demo";
    case "local": return "Local development";
  }
}

/**
 * Non-secret identity of the database this process is pointed at, derived from
 * DATABASE_URL. Safe to render on an operator surface: it deliberately carries
 * NO credentials — the Supabase project ref (which is not a secret; it is in
 * every public API URL) and the host, and nothing else.
 *
 * Returns null rather than throwing: a fingerprint surface that 500s when the
 * database is misconfigured is exactly the surface you cannot use to diagnose
 * a misconfigured database.
 */
export function databaseIdentity(): { projectRef: string | null; host: string | null } {
  const url = process.env.DATABASE_URL;
  if (!url) return { projectRef: null, host: null };
  try {
    const parsed = new URL(url);
    // Supabase encodes the project ref two ways depending on pooled vs direct:
    //   pooled: user is `postgres.<ref>`, host is a regional pooler
    //   direct: host is `db.<ref>.supabase.co`
    const fromUser = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(parsed.username))?.[1];
    const fromHost = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname)?.[1];
    return { projectRef: fromUser ?? fromHost ?? null, host: parsed.hostname || null };
  } catch {
    return { projectRef: null, host: null };
  }
}

/**
 * Build provenance. On Vercel these are injected at build time; locally they
 * are absent and the caller shows "unknown" rather than inventing a value.
 *
 * `commit` is why this module exists: identifying a running deployment should
 * be one request, not a forensic diff of compiled CSS against git history.
 */
export function buildInfo(): {
  commit: string | null;
  ref: string | null;
  deploymentId: string | null;
  vercelEnv: string | null;
  builtAt: string | null;
} {
  return {
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.PURSUITOS_COMMIT_SHA ?? null,
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    // Baked at build time by next.config.ts so it reflects the BUILD, not the
    // moment this function happened to run.
    builtAt: process.env.PURSUITOS_BUILT_AT ?? null,
  };
}

/**
 * Whether external sending is armed. Centralised so every surface reports the
 * same answer, and fail-closed: anything other than the exact string "on" is off.
 *
 * The public site can never send, regardless of configuration — there is no
 * tenant on whose behalf it could act.
 */
export function externalSendingArmed(): boolean {
  if (isPublicSite()) return false;
  return process.env.OUTREACH_AUTOSEND === "on";
}
