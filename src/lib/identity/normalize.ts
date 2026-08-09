/**
 * Company identity normalization — the foundation of the identity graph.
 * If entity resolution is wrong, every downstream model is contaminated
 * (PROJECT_BRIEF §5), so these functions are pure and unit-tested.
 */

const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "llc",
  "llp", "lp", "ltd", "limited", "plc", "gmbh", "ag", "sa", "srl", "bv",
  "nv", "oy", "ab", "as", "kk", "pty", "holdings", "holding", "group",
  "intl", "international", "technologies", "technology", "tech",
]);

/** Lowercase, strip punctuation and legal suffixes: "Acme Corp., Inc." -> "acme" */
export function normalizeCompanyName(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Strip trailing legal-suffix tokens only (keep "Company" in "Company Store").
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

/** Extract a registrable domain from a URL, email, or bare host. */
export function extractDomain(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  if (!value) return null;
  const at = value.lastIndexOf("@");
  if (at !== -1) value = value.slice(at + 1);
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // protocol
  value = value.split(/[/?#]/)[0]; // path
  value = value.split(":")[0]; // port
  value = value.replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return null;
  return value;
}

/** Token-set similarity in [0,1] used for fuzzy name matching. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeCompanyName(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeCompanyName(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.max(ta.size, tb.size);
}
