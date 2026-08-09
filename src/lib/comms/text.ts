/**
 * Text utilities for the communications pipeline — pure, tested.
 */

/**
 * Strip quoted prior conversation and signatures before the Conversation
 * Agent sees the message: the agent should read what THIS person wrote,
 * not re-extract claims from our own outbound copy.
 */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    // Common reply-header forms: "On <date>, <person> wrote:", forwarded blocks.
    if (/^On .{4,80} wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}/i.test(line.trim())) break;
    if (/^From:\s.+$/.test(line.trim()) && out.some((l) => l.trim() === "")) break;
    if (line.trimStart().startsWith(">")) continue; // quoted lines
    if (/^--\s*$/.test(line)) break; // signature delimiter
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Levenshtein distance — the seller-edit metric for the learning loop. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n];
}
