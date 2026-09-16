import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Static guard (D-G8-3): every site that PERSISTS a choice — or renders one from a persisted
 * sequence — must decide it from canonical inputs and existing business semantics, never from
 * PostgreSQL encounter order, planner choice or heap layout.
 *
 * The three classes covered here:
 *   D-G8-3A  the campaign composer's authored asset sequence is persisted (campaign_assets.position)
 *            and read back by it, with id only as the final uniqueness key;
 *   D-G8-3B  the settlement function exposes the opportunity's own id and orders totally;
 *   D-G8-3D  the scoped persisted-selection sites append a stable final unique key while keeping
 *            every existing primary business key first.
 *
 * The database twin — planted ties, reversed insertion order, five planner variations, two heap
 * layouts, owner vs app_rw, and round-trip persistence — is scripts/persisted-determinism-verify.ts.
 *
 * D-G8-3C is deliberately NOT here: it was reclassified to D-G8-4D (campaign seed selection
 * semantics), because when population members tie on score — and especially when none is scored —
 * no existing business rule picks a winner, and inventing one is a product decision.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const sqlBlocks = (s: string) =>
  [...s.matchAll(/`([^`]*\bselect\b[^`]*)`/gi)].map((m) => m[1].replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim());
const orderByOf = (sql: string) => /\border by (.+?)(?: limit \d+)?$/i.exec(sql)?.[1]?.trim() ?? null;
/** A final key is acceptable only if it is a primary key column, never a label standing in for one. */
const endsInUniqueKey = (order: string) => /\b(?:[a-z_]+\.)?id(?: (?:asc|desc))?$/i.test(order);

// ── D-G8-3A — the composer's authored sequence is persisted and read back ────────────────────────

test("D-G8-3A: the composer persists an explicit position for every asset", () => {
  const s = src("src/lib/agents/campaign-composer.ts");
  assert.match(s, /insert into campaign_assets \(campaign_id, asset_type, title, content, position\)/,
    "the composer must write `position` explicitly");
  assert.match(s, /for \(const \[position, a\] of assets\.entries\(\)\)/,
    "position must come from the authored array index, not from a counter that could drift");
});

test("D-G8-3A: both readers order by the persisted sequence, with id only as the tie-breaker", () => {
  for (const p of ["src/app/briefs/[motionId]/page.tsx", "src/app/accounts/[id]/page.tsx"]) {
    const q = sqlBlocks(src(p)).find((s) => /from campaign_assets a/i.test(s));
    assert.ok(q, `${p}: campaign_assets query not found`);
    const order = orderByOf(q!);
    assert.equal(order, "a.position asc nulls last, a.id", `${p}: unexpected ORDER BY "${order}"`);
  }
});

test("D-G8-3A: no reader still orders campaign assets by created_at alone", () => {
  for (const p of ["src/app/briefs/[motionId]/page.tsx", "src/app/accounts/[id]/page.tsx"]) {
    const q = sqlBlocks(src(p)).find((s) => /from campaign_assets a/i.test(s))!;
    assert.doesNotMatch(q, /order by a\.created_at\s*$/i, `${p}: still ordering by created_at alone`);
  }
});

// ── D-G8-3B — settlement identity and total order ────────────────────────────────────────────────

test("D-G8-3B: the settlement function returns opportunity_id and orders totally", () => {
  const m = src("supabase/migrations/0107_dg83b_settlement_opportunity_identity.sql");
  assert.match(m, /registered boolean,\s*\n\s*opportunity_id uuid\)/,
    "opportunity_id must be the LAST returned column");
  assert.match(m, /order by o\.updated_at desc, o\.id;/,
    "the business order (updated_at desc) must be preserved with o.id appended");
  // The DROP discards the security posture; the migration must restore all of it.
  assert.match(m, /drop function public\.partnership_settlement_rows\(uuid\);/);
  assert.doesNotMatch(m, /drop function[^;]*cascade/i, "no CASCADE");
  assert.match(m, /language plpgsql stable security definer set search_path to pg_catalog, public, pg_temp/);
  assert.match(m, /revoke all on function public\.partnership_settlement_rows\(uuid\) from public;/);
  assert.match(m, /grant execute on function public\.partnership_settlement_rows\(uuid\) to app_rw;/);
  for (const r of ["anon", "authenticated", "service_role", "app_rw"]) assert.match(m, new RegExp(`'${r}'`));
});

test("D-G8-3B: the read model carries opportunityId as the stable identity", () => {
  const s = src("src/lib/partnerships/settlement.ts");
  assert.match(s, /opportunityId: string;/, "SettlementEntry must carry opportunityId");
  assert.match(s, /select org_id, company_id, legal_name, stage, amount_usd, updated_at, registered, opportunity_id/);
  assert.match(s, /opportunityId: r\.opportunity_id,/);
});

// ── D-G8-3D — the scoped persisted-selection sites ───────────────────────────────────────────────

/** file → [locator, expected ORDER BY]. The leading key of each is the PRE-EXISTING business rule. */
const SITES: [string, string, string][] = [
  ["src/lib/comms/authoring.ts", "from brand_profiles", "is_default desc, created_at asc, id"],
  ["src/lib/agents/campaign-email.ts", "from brand_profiles", "is_default desc, created_at asc, id"],
  ["src/lib/comms/send.ts", "from communication_threads", "created_at desc, id desc"],
  ["src/lib/scoring/score.ts", "from propensity_scores p", "p.computed_at desc, p.id desc"],
  ["src/lib/agents/motion-designer.ts", "from play_templates pt", "pt.version desc, pt.id"],
  ["src/lib/routines/routines.ts", "from opportunities o", "o.amount_usd desc nulls last, o.id"],
  ["src/lib/routines/routines.ts", "from account_digests d", "d.created_at desc, d.id desc"],
  ["src/lib/routines/routines.ts", "from meeting_notes", "met_at desc, id desc"],
  ["src/lib/routines/routines.ts", "from campaign_touches t", "t.sent_at desc, t.id desc"],
];

for (const [file, locator, expected] of SITES) {
  test(`D-G8-3D: ${file} (${locator}) orders "${expected}"`, () => {
    const q = sqlBlocks(src(file)).find((s) => s.includes(locator) && /\border by\b/i.test(s));
    assert.ok(q, `${file}: no ORDER BY query matching ${locator}`);
    assert.equal(orderByOf(q!), expected);
    assert.ok(endsInUniqueKey(orderByOf(q!)!), "must end in a primary-key column");
  });
}

test("D-G8-3D: motion-designer's score and team picks end in a unique key", () => {
  const blocks = sqlBlocks(src("src/lib/agents/motion-designer.ts"));
  const score = blocks.find((s) => s.includes("from propensity_scores p"))!;
  assert.equal(orderByOf(score), "p.computed_at desc, p.id desc");
  const team = blocks.find((s) => /from partner_teams|from teams t|t\.status in \('recommended','accepted'\)/.test(s))!;
  assert.ok(team, "team query not found");
  assert.equal(orderByOf(team), "t.created_at desc, t.id desc");
});

test("D-G8-3D: the routines DISTINCT ON resolves to one determinate run", () => {
  const q = sqlBlocks(src("src/lib/routines/routines.ts")).find((s) => /distinct on \(r\.id\)/i.test(s));
  assert.ok(q, "the failed-routine DISTINCT ON was not found");
  assert.match(q!, /order by r\.id, rr\.ran_at desc, rr\.id desc/);
});

test("D-G8-3D: campaign-email resolves the brand ONCE, so the rendered brand and the persisted brandId cannot diverge", () => {
  const s = src("src/lib/agents/campaign-email.ts");
  const brandQueries = sqlBlocks(s).filter((q) => /from brand_profiles/i.test(q));
  assert.equal(brandQueries.length, 1, `expected exactly one brand_profiles query, found ${brandQueries.length}`);
  assert.match(s, /Promise<\{ brand: EmailBrand; brandId: string \| null \}>/);
  assert.match(s, /const \{ brand, brandId \} = await resolveBrand\(db, args\.orgId\);/);
});

// ── scope guards ─────────────────────────────────────────────────────────────────────────────────

test("D-G8-3: the site closed under D-G8-2A stays closed and untouched", () => {
  const q = sqlBlocks(src("src/app/motions/actions.ts")).find((s) => /from propensity_scores/i.test(s))!;
  assert.match(q, /order by company_id, computed_at desc, id desc/);
  assert.match(src("src/app/motions/actions.ts"), /a\.localeCompare\(b\)/);
});

test("D-G8-4D: the campaign seed is never fabricated by name, input order or uuid", () => {
  const s = src("src/lib/campaigns/multi-vendor.ts");
  // The two forbidden fallbacks that used to decide the anchor account are gone.
  assert.doesNotMatch(s, /\?\?\s*args\.companyIds\[0\]/, "input order must not seed a campaign");
  assert.doesNotMatch(s, /order by sc\.s desc nulls last limit 1/, "the untied limit-1 pick must be gone");
  // Scope the check to the seed-selection block: `legal_name` is used legitimately elsewhere in this
  // file by the separate multi-vendor display listing.
  // Strip comments first: the block's own prose NAMES the forbidden fallbacks in order to rule
  // them out, and matching that prose would be a false positive.
  const seedBlock = s
    .slice(s.indexOf("D-G8-4D: the seed account"), s.indexOf("insert into campaigns"))
    .split("\n").map((l) => l.replace(/\/\/.*$/, "").replace(/--.*$/, "")).join("\n");
  assert.ok(seedBlock.length > 0, "seed-selection block not found");
  for (const forbidden of [/legal_name/, /order by [^\n]*name/, /created_at/, /companyIds\[/]) {
    assert.doesNotMatch(seedBlock, forbidden, `forbidden seed fallback in the seed block: ${forbidden}`);
  }
  // Unresolved is represented as a null company_id, and an explicit seed is validated.
  assert.match(s, /let seedCompanyId: string \| null = null;/);
  assert.match(s, /seedCompanyId = top\.length === 1 \? top\[0\]\.company_id : null;/,
    "a tie for top score must resolve to null, not to a row");
  assert.match(s, /the chosen seed account is not in this play's account list/);
  assert.match(s, /\[args\.orgId, seedCompanyId, args\.name\]/);
});
