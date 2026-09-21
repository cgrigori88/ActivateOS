import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * THE ATTENTION TOKEN — evidence context, minted at render, redeemed at selection.
 *
 * ── THE PROBLEM IT SOLVES ───────────────────────────────────────────────────────────────────────
 *
 * The observation we want to keep is "the user deliberately selected this pursuit for work from
 * this rendered surface, where these were the displayed ranking facts". Two constraints pull
 * against each other:
 *
 *   · rendering a page MUST NOT write evidence (D-HIST-1: `pipeline_snapshots` written from a page
 *     render, "history accrues just by looking" — the defect `6f3e65d` closed and the reason
 *     `97e975f0` could not be reconstructed);
 *   · but by the time the user clicks, the ranking may have moved, and recomputing it would record
 *     a state the user never saw.
 *
 * So the server computes the facts during the read, signs them, and writes nothing. The browser
 * carries the token and can present it back — but it cannot author it. Redemption persists exactly
 * what was rendered.
 *
 * ── WHAT THE SIGNATURE IS AND IS NOT ────────────────────────────────────────────────────────────
 *
 * THE TOKEN IS NOT AUTHORITY. It confers no capability, permits no action and identifies no
 * privilege. Redemption still resolves the caller's identity and membership independently and
 * re-checks that the token was minted for THAT user, THAT organization and THAT subject. A stolen
 * token lets its holder write an attention row about a pursuit they already had to be authorized to
 * see — and nothing else.
 *
 * ── NO TTL, DELIBERATELY ────────────────────────────────────────────────────────────────────────
 *
 * The gap between render and selection is DATA, not an error: a person who leaves a tab open for an
 * hour and then acts still acted on what they saw. An expiry would be simplification dressed as
 * security, and since the token grants nothing, nothing is bought by shortening its life. Both
 * timestamps are stored and the gap is legible.
 *
 * ── REPLAY IS IDEMPOTENT, NOT REFUSED ───────────────────────────────────────────────────────────
 *
 * The nonce is unique per (org, token), and the observation table carries a unique index on it. The
 * same token presented twice writes one row. A freshly rendered surface mints a new nonce, so a
 * later deliberate selection is a NEW observation even if the ranking has not moved — which is
 * correct: it is a second act, not a duplicate of the first.
 */

export interface AttentionFacts {
  orgId: string;
  /** The authenticated user the surface was rendered for. Null in a session without identity. */
  userId: string | null;
  pursuitId: string;
  /** Which ranked surface, and which generation of it. */
  surfaceId: "today" | "pipeline";
  surfaceVersion: string;
  /** How the surface was ordered when it was rendered. `/pipeline` has two modes; Today has one. */
  sortMode: string;
  filters: Record<string, unknown>;
  /** Top-K in force at render, or null when the whole set was shown. */
  displayLimit: number | null;
  /** THE P2 FACT: the canonical portfolio rank the card displayed. */
  p2Rank: number;
  comparisonSetSize: number;
  withheldCount: number;
  /**
   * THE SURFACE FACT: where the card actually sat. NULL where the surface exposes no meaningful
   * ordinal — recorded as absent rather than fabricated, because a made-up position is worse than
   * an acknowledged gap.
   */
  surfaceOrdinal: number | null;
  score: number;
  band: string;
  components: { key: string | null; contribution: number | null }[];
  algorithmVersion: string;
  snapshotFingerprint: string;
  scope: string;
  dataEnvironment: string;
  renderedAt: string;
  nonce: string;
}

const VERSION = "v1";

/**
 * The signing key.
 *
 * It is a server secret, and the token is only ever verified by the same deployment that minted it,
 * so the service-role key is reused rather than adding another secret to operate. If it is absent —
 * local development with no identity configured — a per-process key is generated instead: tokens
 * stay unforgeable within the process, and they simply do not verify across a restart, which is the
 * correct failure for a dev environment and refuses nothing in production.
 */
let ephemeral: string | null = null;
function signingKey(): string {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (k) return k;
  ephemeral ??= randomUUID() + randomUUID();
  return ephemeral;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

/** Mint a token for one card on one rendered surface. Writes nothing. */
export function mintAttentionToken(facts: Omit<AttentionFacts, "nonce" | "renderedAt"> & Partial<Pick<AttentionFacts, "nonce" | "renderedAt">>): string {
  const full: AttentionFacts = {
    ...facts,
    nonce: facts.nonce ?? randomUUID(),
    renderedAt: facts.renderedAt ?? new Date().toISOString(),
  };
  const body = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  return `${VERSION}.${body}.${sign(`${VERSION}.${body}`)}`;
}

/**
 * Verify and decode. Returns null for anything that is not a token this server minted — a tampered
 * body, a wrong signature, a different version, or garbage.
 *
 * The comparison is constant-time. The payload is parsed only AFTER the signature verifies, so a
 * forged body is never interpreted, not even to be rejected on its contents.
 */
export function readAttentionToken(token: string | null | undefined): AttentionFacts | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const expected = sign(`${parts[0]}.${parts[1]}`);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as AttentionFacts;
  } catch {
    return null;
  }
}
