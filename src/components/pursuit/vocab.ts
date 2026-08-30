/**
 * Presentation vocabulary (Workstream D.5 §1). Translates raw enum / database
 * vocabulary into human-readable copy AT RENDER TIME. The canonical values stay
 * intact in the read-model payload (for audit, debug, and the learning record);
 * only the displayed text is humanized. The operator never reads database state.
 */

/** Compact money from a numeric string or number: 1840000 → "$1.84M". */
export function compactMoney(v: string | number): string {
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
  if (!isFinite(n) || n === 0) return typeof v === "string" ? v : "$0";
  const abs = Math.abs(n);
  const fmt = (x: number, suffix: string) => `$${x.toFixed(x < 10 ? 2 : x < 100 ? 1 : 0).replace(/\.0+$/, "")}${suffix}`;
  if (abs >= 1e9) return fmt(n / 1e9, "B");
  if (abs >= 1e6) return fmt(n / 1e6, "M");
  if (abs >= 1e3) return fmt(n / 1e3, "k");
  return `$${Math.round(n)}`;
}

/** Enum tokens that read better hyphenated than title-cased. */
const ENUM_SPECIAL: Record<string, string> = {
  PARTNER_LED: "Partner-led", VENDOR_LED: "Vendor-led", DIRECT_LED: "Direct",
  DISTRIBUTOR_LED: "Distributor-led", DISTRIBUTOR_ASSISTED: "Distributor-assisted",
  CLOUD_MARKETPLACE: "Cloud marketplace", CO_SELL: "Co-sell", NET_NEW: "Net-new",
  SYSTEM_DETECTED: "System detected", HUMAN_ASSERTED: "Human asserted",
  EXECUTIVE_DIRECTION: "Executive direction", ACTIVE_RELATIONSHIP: "Active relationship",
};

/** Title-case a single UPPER_SNAKE enum value. */
export function titleEnum(token: string): string {
  const key = token.toUpperCase();
  if (ENUM_SPECIAL[key]) return ENUM_SPECIAL[key];
  const words = key.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Replace any embedded UPPER_SNAKE tokens inside a free string with human copy. */
export function humanizeText(text: string): string {
  return text.replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, (t) => titleEnum(t));
}

/** Specific internal route-reason phrasings; falls back to generic enum cleanup. */
export function humanizeReason(text: string): string {
  let m;
  if ((m = /^Capability (\d+) \(certified\)$/i.exec(text))) return `Certified capability (strength ${m[1]})`;
  if ((m = /^Capability (\d+)$/i.exec(text))) return `Capability strength ${m[1]}`;
  if ((m = /^ACTIVE_RELATIONSHIP \((\d+)\)$/i.exec(text))) return `Established active relationship (tenure ${m[1]})`;
  if ((m = /^([A-Z_]+) \((\d+)\)$/.exec(text))) return `${titleEnum(m[1])} (${m[2]})`;
  if ((m = /^TD spend \$?([\d,]+)\s*(?:in category)?$/i.exec(text))) return `${compactMoney(m[1])} recent category activity through TD SYNNEX`;
  return humanizeText(text);
}

/** Governed Skill id → the action a human recognizes. */
const SKILL_LABEL: Record<string, string> = {
  select_partner_route: "Approve route", override_partner_route: "Override route",
  explain_partner_route: "Explain route", review_fact: "Review evidence",
  assemble_pursuit_team: "Assign team", approve_route: "Approve route",
};
export function skillLabel(skill: string): string {
  return SKILL_LABEL[skill] ?? titleEnum(skill.toUpperCase());
}
