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

test("projection.ts: list attribution breaks created_at ties by name, then id (the D-G5-1 Pipeline defect)", () => {
  const lists = projection.filter((q) => q.includes("distinct on (pm.company_id)"));
  assert.equal(lists.length, 2, "both list-attribution queries (scoped and unscoped)");
  for (const q of lists) assert.equal(orderByOf(q), "pm.company_id, ap.created_at, ap.name, ap.id");
});
