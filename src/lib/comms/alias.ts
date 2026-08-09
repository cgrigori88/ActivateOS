import { randomBytes } from "node:crypto";

/**
 * Thread aliases are MOTION-scoped, not seller-scoped (founder decision §4):
 * the alias maps to the commercial conversation — org, account, motion,
 * campaign, sellers — because one seller can carry 50 pursuits and one
 * account can run several. Format: m_<10 lowercase base32 chars>.
 */

const ALPHABET = "abcdefghjkmnpqrstvwxyz23456789"; // no 0/O/1/l/i ambiguity
const ALIAS_RE = /^m_[a-z2-9]{10}$/;

export function generateThreadAlias(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `m_${out}`;
}

export function isThreadAlias(s: string): boolean {
  return ALIAS_RE.test(s);
}

/** The inbound conversation-capture address for a thread. */
export function threadAddress(alias: string, threadsDomain: string): string {
  return `${alias}@${threadsDomain}`;
}

/**
 * Extract a thread alias from any address in a recipient list. Accepts both
 * the bare alias localpart (m_xxx@threads...) and plus-addressed forms
 * (thread+m_xxx@..., anything+m_xxx@...).
 */
export function extractThreadAlias(addresses: string[], threadsDomain: string): string | null {
  const domain = threadsDomain.toLowerCase();
  for (const raw of addresses) {
    const email = raw.toLowerCase().trim().replace(/^.*</, "").replace(/>.*$/, "");
    const at = email.lastIndexOf("@");
    if (at === -1 || email.slice(at + 1) !== domain) continue;
    const local = email.slice(0, at);
    if (isThreadAlias(local)) return local;
    const plus = local.split("+");
    if (plus.length > 1 && isThreadAlias(plus[plus.length - 1])) return plus[plus.length - 1];
  }
  return null;
}
