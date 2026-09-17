/**
 * CFR-1.2 — the comparison rule, as pure functions.
 *
 * WHY THIS FILE EXISTS SEPARATELY. The crawler needs a network, a deployment and two live logins;
 * the RULE it applies does not. Keeping normalization and classification here makes the part that
 * decides PASS/FAIL unit-testable without any of that, so the instrument that certifies the product
 * is itself certified.
 *
 * THE RULE. Two renders of the same room are the same evidence when they differ only in values the
 * clock necessarily moves. Everything else — status, line count, ordering, wording, scope,
 * disclosure, counts, data — is a real difference and fails the gate.
 */

/**
 * Clock phrases are masked to `⌚` before comparison. CHARACTER-FOR-CHARACTER the expression used by
 * the accepted P2/P45 crawls: changing it would silently redefine what "byte-identical" has meant
 * across every prior acceptance record.
 */
export const TIMEISH =
  /\b\d+\s*(?:s|sec|secs|m|min|mins|h|hr|hrs|d|w|mo|y)\s+ago\b|\bjust now\b|\b\d+\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?)\s+ago\b|\bin \d+\s*(?:s|m|h|d|minutes?|hours?|days?)\b|\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?|\b20\d\d-\d\d-\d\dT[\d:.]+Z?/g;

/** Rendered text, scripts and styles stripped, whitespace collapsed, clock phrases masked. */
export function normalizeLines(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((l) => l.replace(TIMEISH, "⌚"));
}

/**
 * Pertinence differentials are clock-derived: they are computed from ages and momentum, so two
 * renders fifteen hours apart legitimately differ in the third decimal while every word around them
 * stays identical. Masking them is what lets the classifier say "only the clock moved" and mean it.
 * A Δ that changes while an accompanying WORD also changes is not clock-derived — the mask is
 * applied to both sides and the remaining text must still match exactly.
 */
export const DELTA = /\(Δ \d\.\d{3}\)/g;
export const maskDeltas = (line: string): string => line.replace(DELTA, "(Δ)");

export interface RoomRender { status: number; lines: string[] }
export type DiffKind = "IDENTICAL" | "CLOCK_DERIVED" | "NON_CLOCK" | "STATUS" | "LINE_COUNT" | "MISSING";

export interface RoomDiff {
  room: string;
  kind: DiffKind;
  changedLines: number;
  nonClockLines: number;
  detail: string;
}

/** Classify one room's two renders. Only IDENTICAL and CLOCK_DERIVED are permitted by CFR-1.2. */
export function classifyRoom(room: string, a: RoomRender | undefined, b: RoomRender | undefined): RoomDiff {
  if (!a || !b) return { room, kind: "MISSING", changedLines: 0, nonClockLines: 0, detail: !a ? "absent from baseline" : "absent from subject" };
  if (a.status !== b.status) return { room, kind: "STATUS", changedLines: 0, nonClockLines: 0, detail: `${a.status} → ${b.status}` };
  if (a.lines.length !== b.lines.length) return { room, kind: "LINE_COUNT", changedLines: 0, nonClockLines: 0, detail: `${a.lines.length} → ${b.lines.length} lines` };
  let changed = 0, nonClock = 0;
  for (let i = 0; i < a.lines.length; i++) {
    if (a.lines[i] === b.lines[i]) continue;
    changed++;
    if (maskDeltas(a.lines[i]) !== maskDeltas(b.lines[i])) nonClock++;
  }
  if (changed === 0) return { room, kind: "IDENTICAL", changedLines: 0, nonClockLines: 0, detail: `${a.lines.length} lines` };
  return {
    room,
    kind: nonClock === 0 ? "CLOCK_DERIVED" : "NON_CLOCK",
    changedLines: changed,
    nonClockLines: nonClock,
    detail: `${changed} changed line(s), ${nonClock} non-clock`,
  };
}

export interface Verdict { pass: boolean; identical: number; clockDerived: number; offending: RoomDiff[] }

/** CFR-1.2 passes when every room is IDENTICAL or CLOCK_DERIVED — nothing else. */
export function verdictFor(diffs: RoomDiff[]): Verdict {
  const offending = diffs.filter((d) => d.kind !== "IDENTICAL" && d.kind !== "CLOCK_DERIVED");
  return {
    pass: offending.length === 0,
    identical: diffs.filter((d) => d.kind === "IDENTICAL").length,
    clockDerived: diffs.filter((d) => d.kind === "CLOCK_DERIVED").length,
    offending,
  };
}

/**
 * A response is the anonymous/sign-in representation, not authenticated content.
 *
 * WHY THIS IS NOT "status === 303". A sign-in POST answers 303 whether it authenticated or was
 * REFUSED BY THE THROTTLE — the refusal redirects to `/login?error=…` with no session cookie. A
 * crawl that trusted the status alone would then walk every room unauthenticated and report a
 * cheerful, meaningless PASS. That happened during the P6-IG gate; hence this predicate and the
 * cookie check beside it.
 */
export function looksUnauthenticated(status: number, location: string | null, lines: string[]): boolean {
  if (status === 307 || status === 302) return (location ?? "").startsWith("/login");
  const text = lines.join(" ");
  return /Sign in|Identity isn't configured|Email and password are required/i.test(text) && !/All ecosystems/.test(text);
}

/** Secrets must never reach a log, a file or a console. */
export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-connection-string>");
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("<redacted>");
  return out;
}
