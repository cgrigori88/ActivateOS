import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Static guard (D-G5-1): every capped (`limit`) or `distinct on` query that feeds Today's divergences
 * or the renewal projection's list attribution must end its ORDER BY in a unique key. Without one,
 * PostgreSQL may return tied rows in any order, and the order legitimately changes with the query
 * plan — which is exactly what happened when the hosted runtime moved from the owner to app_rw
 * (H1B Gate 5): same rows, different order, so a capped Today and a renewal list label changed.
 *
 * The database twin — tie fixtures, five planner variations, two heap layouts, owner vs app_rw exact
 * ordered equality and an old-SQL negative control — is scripts/ordering-determinism-verify.ts.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const sqlBlocks = (s: string) =>
  [...s.matchAll(/`([^`]*\bselect\b[^`]*)`/gi)].map((m) => m[1].replace(/\s+/g, " ").trim());
const orderByOf = (sql: string) => /\border by (.+?)(?: limit \d+)?$/i.exec(sql)?.[1]?.trim() ?? null;
const endsInUniqueKey = (order: string) => /\b[a-z_]+\.id(?: (?:asc|desc))?$/i.test(order);

const divergence = sqlBlocks(src("src/lib/context/divergence.ts"));
const projection = sqlBlocks(src("src/lib/lifecycle/projection.ts"));

test("divergence.ts: every capped or DISTINCT ON query ends its ORDER BY in a unique key", () => {
  const capped = divergence.filter((q) => /\blimit\b|\bdistinct on\b/i.test(q));
  assert.ok(capped.length >= 6, `expected the six divergence rules, found ${capped.length}`);
  for (const q of capped) {
    const order = orderByOf(q);
    assert.ok(order, `no ORDER BY: ${q.slice(0, 120)}`);
    assert.ok(endsInUniqueKey(order!), `ORDER BY does not end in a unique id: "${order}"`);
  }
});

test("divergence.ts: 'stage vs engagement' orders by updated_at, then id (the D-G5-1 Today defect)", () => {
  const q = divergence.find((s) => s.includes("o.stage in ('proposal', 'negotiation')"));
  assert.ok(q, "stage-vs-engagement query not found");
  assert.equal(orderByOf(q!), "o.updated_at asc, o.id asc");
  assert.match(q!, /limit 5$/, "the cap is unchanged");
});

test("divergence.ts: pre-existing ranking keys are preserved; only tie-breakers are appended", () => {
  const stale = divergence.find((s) => s.includes("o.updated_at < now() - interval '21 days'"));
  assert.equal(orderByOf(stale!), "o.updated_at asc, o.id asc");
  const renewal = divergence.find((s) => s.includes("renewal_window") || s.includes("f.predicate_key in"));
  assert.equal(orderByOf(renewal!), "f.company_id, coalesce(f.date_value, f.valid_from) asc, f.id asc");
  const crm = divergence.find((s) => s.includes("from crm_snapshots s"));
  assert.equal(orderByOf(crm!), "s.company_id, lower(s.opportunity_name), s.reported_at desc, s.id desc, o.id asc");
});

test("pipeline/page.tsx: stakeholders render in a total order ending in the stakeholder primary key (D-G8-1)", () => {
  const pipeline = sqlBlocks(src("src/app/pipeline/page.tsx"));
  const q = pipeline.find((s) => s.includes("from stakeholders s join contacts ct"));
  assert.ok(q, "pipeline stakeholder query not found");
  // stakeholders' primary key is (opportunity_id, contact_id): both must be ordered, contact_id last.
  assert.equal(orderByOf(q!), "s.opportunity_id, coalesce(ct.name, ct.email), s.contact_id");
  assert.doesNotMatch(q!, /\blimit\b/i, "no cap was introduced");
});

test("projection.ts: list attribution breaks created_at ties by name, then id (the D-G5-1 Pipeline defect)", () => {
  const lists = projection.filter((q) => q.includes("distinct on (pm.company_id)"));
  assert.equal(lists.length, 2, "both list-attribution queries (scoped and unscoped)");
  for (const q of lists) assert.equal(orderByOf(q), "pm.company_id, ap.created_at, ap.name, ap.id");
});

/* ── D-G8-2A: the remaining category-C sites on the certified surface ──────────────────────────────
 * Same rule as above, applied to the read paths where ordering decides membership under a cap, a
 * first/latest/best pick, a value shown, or a visible priority. `orderByOf` anchors on the FIRST
 * `order by`, so nested queries are asserted against their clause text directly.                  */

test("today/overview.ts: the Today feeders, both DISTINCT ON picks and recent activity are total", () => {
  const q = sqlBlocks(src("src/lib/today/overview.ts"));
  const find = (needle: string) => q.find((s) => s.includes(needle));
  assert.equal(orderByOf(find("where m.status = 'draft'")!), "m.id");
  assert.equal(orderByOf(find("where m.status = 'approved'")!), "m.id");
  assert.equal(orderByOf(find("from contradictions ct")!), "c.legal_name, c.id");
  assert.equal(orderByOf(find("c.next_refresh_at is not null")!), "c.legal_name, c.id");
  assert.equal(orderByOf(find("from account_digests d")!), "d.company_id, d.created_at desc, d.id desc");
  assert.equal(orderByOf(find("distinct on (p.company_id) p.company_id, p.score")!), "p.company_id, p.computed_at desc, p.id desc");
  assert.equal(orderByOf(find("from outcome_events e")!), "e.occurred_at desc, e.id desc");
});

test("timeline.ts: every capped feeder ends in a unique key, and the comparator is a total order", () => {
  const raw = src("src/lib/context/timeline.ts");
  const capped = sqlBlocks(raw).filter((s) => /\blimit \d+$/i.test(s));
  assert.ok(capped.length >= 9, `expected the nine capped feeders, found ${capped.length}`);
  for (const s of capped) {
    const order = orderByOf(s);
    assert.ok(order, `no ORDER BY: ${s.slice(0, 120)}`);
    assert.match(order!, /(?:^|, )(?:[a-z_]+\.)?id (?:asc|desc)$/i, `feeder does not end in a unique key: "${order}"`);
  }
  // The defect itself: a comparator that never returns 0 (D-G8-2A, class 6). Anchored on the sort CALL,
  // not the bare expression — the doc comment above the replacement quotes the old code on purpose.
  assert.doesNotMatch(raw, /\.sort\(\s*\(a, b\) => \(a\.at < b\.at \? 1 : -1\)\s*\)/, "the old non-total timeline comparator is back");
  assert.match(raw, /events\.sort\(compareTimelineEvents\)/, "the timeline must sort through the total comparator");
  assert.match(raw, /export function compareTimelineEvents/, "the total comparator must stay exported and tested");
});

test("first/latest/best picks behind the account drawer end in the row's primary key", () => {
  const intel = sqlBlocks(src("src/lib/accounts/intel.ts"));
  assert.equal(orderByOf(intel.find((s) => s.includes("from pursuits where account_id=$1"))!), "created_at asc, id asc");
  assert.equal(orderByOf(intel.find((s) => s.includes("from change_ledger where pursuit_id=$1"))!), "occurred_at desc, id desc");
  assert.equal(orderByOf(intel.find((s) => s.includes("from propensity_scores where company_id=$1"))!), "computed_at desc, id desc");
});

test("visible ranked lists end in a stable key (portfolio, pipeline book, ecosystem, coverage)", () => {
  const portfolio = sqlBlocks(src("src/lib/pursuits/read-models/portfolio.ts"));
  assert.equal(orderByOf(portfolio.find((s) => s.includes("from pursuits pu"))!),
    "pu.current_priority_score desc nulls last, c.legal_name, pu.id");

  const pipeline = sqlBlocks(src("src/app/pipeline/page.tsx"));
  assert.equal(orderByOf(pipeline.find((s) => s.includes("left join taxonomy_nodes n on n.id = o.taxonomy_node_id"))!),
    "o.updated_at desc, o.id");
  assert.equal(orderByOf(pipeline.find((s) => s.includes("from seller_account_relationships r"))!),
    "r.company_id, r.strength desc nulls last, s.name, r.seller_id");
  // Nested: the CRM tie-out's DISTINCT ON must pick one snapshot deterministically.
  assert.match(pipeline.find((s) => s.includes("from crm_snapshots where org_id = $1"))!,
    /order by company_id, lower\(opportunity_name\), reported_at desc, id desc\)/);

  const populations = sqlBlocks(src("src/lib/mapping/populations.ts"));
  assert.equal(orderByOf(populations.find((s) => s.includes("with org_cos as"))!),
    "c.legal_name, pm.company_id, p.name, p.id, ap.category");
});

test("cross-partner opportunities: the 200-row cut is a total order (D-G8-2A convergence)", () => {
  const raw = src("src/lib/mapping/insights.ts");
  // The latest-propensity pick feeds `rank`, so it needs the full key like every sibling pick.
  const q = sqlBlocks(raw).find((s) => s.includes("from partner_cov pc"));
  assert.ok(q, "crossPartnerOpportunities query not found");
  assert.match(q!, /order by computed_at desc, id desc limit 1/, "latest-score pick must end in the row key");
  assert.match(q!, /order by c\.legal_name, c\.id$/, "the feeder itself must be ordered");
  // The comparator is the decisive fix: the caller slices to 200, and rank ties are the common case.
  assert.match(raw, /b\.rank - a\.rank \|\| a\.name\.localeCompare\(b\.name\) \|\| a\.companyId\.localeCompare\(b\.companyId\)/,
    "the rank sort must be total before the 200-row cut");
});

test("group-key aggregates and the play-template pick are deterministic (D-G8-2A convergence)", () => {
  // Class 5 (encounter-order group reaching the UI): both attribution aggregates are rendered as a
  // joined "N class" string, so the group iteration order is visible text.
  const intel = sqlBlocks(src("src/lib/partners/intelligence.ts"));
  const attribution = intel.filter((s) => s.includes("from attribution a"));
  assert.equal(attribution.length, 2, `both attribution class-mix aggregates, found ${attribution.length}`);
  for (const q of attribution) {
    assert.match(q, /group by 1 order by 1$/, `group-key aggregate is not ordered: ${q.slice(0, 100)}`);
  }

  // `play_templates` is consumed by a LAST-WRITE-WINS Map keyed on taxonomy_node_id, which carries no
  // uniqueness on that table (PK id, unique (slug, version)) — two active templates can share a node.
  const plays = sqlBlocks(src("src/app/mapping/page.tsx")).find((s) => s.includes("from play_templates"));
  assert.ok(plays, "play_templates query not found");
  assert.match(plays!, /order by name, id$/, "the play shown per node must be a deterministic pick");
});

test("motions draft candidates: both the DISTINCT ON and the capped outer select are deterministic", () => {
  const q = sqlBlocks(src("src/app/motions/page.tsx")).find((s) => s.includes("from account_suppressions sl"))!;
  assert.match(q, /order by p\.company_id, p\.computed_at desc, p\.id desc/);
  assert.match(q, /\) x order by x\.score desc, x\.legal_name, x\.company_id limit 18$/);
});
