/**
 * Canonical domain normalization (BuiltWith correction + general hygiene).
 * Providers that key on a web domain must receive ONLY the bare registrable
 * host — never a scheme, path, query string, port, or email address. When a
 * clean domain cannot be derived, return null so the caller SKIPs rather than
 * guessing (SKIP_NO_DOMAIN).
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;

  // Email → its domain part.
  if (s.includes("@")) s = s.slice(s.lastIndexOf("@") + 1);

  // Strip scheme.
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  // Strip path, query, fragment.
  s = s.split("/")[0].split("?")[0].split("#")[0];
  // Strip port and credentials.
  s = s.split(":")[0].replace(/^.*@/, "");
  // Strip a leading www.
  s = s.replace(/^www\./, "");
  // Trailing dot (FQDN form).
  s = s.replace(/\.$/, "");

  // Must be a plausible registrable domain: label(s) + a TLD of 2+ letters.
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(s)) {
    return null;
  }
  return s;
}
