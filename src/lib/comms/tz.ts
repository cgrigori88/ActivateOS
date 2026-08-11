/**
 * Timezone-aware scheduling (Phase 9B.3). Sellers schedule in a real local
 * time (Pacific/Mountain/Central/Eastern), and each touch fires at that wall
 * time on its offset day — DST-correct, with no third-party date library.
 */

export const TZ_OPTIONS: { value: string; label: string }[] = [
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "UTC", label: "UTC" },
];

const VALID = new Set(TZ_OPTIONS.map((t) => t.value));
export function normalizeTz(tz: string | null | undefined): string {
  return tz && VALID.has(tz) ? tz : "America/New_York";
}

/** Minutes that `tz` is offset from UTC at the given instant (handles DST). */
function tzOffsetMinutes(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
  // hour can format as 24 for midnight in some engines.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUTC = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return (asUTC - at.getTime()) / 60000;
}

/** Interpret `YYYY-MM-DD` + `HH:MM` as wall time in `tz`; return the UTC instant. */
export function zonedToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = (timeStr || "09:00").split(":").map(Number);
  const zone = normalizeTz(tz);
  const utcGuess = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  // Correct by the offset in effect at that guessed instant (one refinement
  // pass is enough away from the rare DST-transition minute).
  const offset = tzOffsetMinutes(zone, new Date(utcGuess));
  return new Date(utcGuess - offset * 60000);
}

/** Add `n` calendar days to a `YYYY-MM-DD` string, returning `YYYY-MM-DD`. */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Short label for a UTC instant shown in the campaign's send zone. */
export function formatInTz(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeTz(tz),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}
