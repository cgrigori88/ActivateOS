import assert from "node:assert/strict";
import { test } from "node:test";
import { compareTimelineEvents, type TimelineEvent } from "../src/lib/context/timeline";

/**
 * D-G8-2A, defect class "non-total / inconsistent comparator". The deal timeline used to order with
 *   (a, b) => (a.at < b.at ? 1 : -1)
 * which never returns 0: for two events at the same instant it claims BOTH that a follows b and that
 * b follows a. Array.prototype.sort with an inconsistent comparator has implementation-defined output,
 * so the rendered timeline — cut to `limit` — could differ between runs on identical data.
 *
 * The replacement keeps the business order (newest first) and appends stable tie-breakers on fields the
 * event already carries, ending in a key combination that is unique unless two events are identical in
 * every rendered field (in which case their order is unobservable).
 */

const ev = (over: Partial<TimelineEvent> = {}): TimelineEvent => ({
  at: "2026-09-15T12:00:00.000Z",
  kind: "evidence",
  title: "t",
  detail: null,
  source: "s",
  href: null,
  ...over,
});

const sign = (n: number) => (n === 0 ? 0 : n > 0 ? 1 : -1);
/** Negation that keeps 0 as 0: `-0` is a distinct value under assert.equal's Object.is semantics. */
const neg = (n: number) => (n === 0 ? 0 : -n);
/** The pre-fix comparator, kept here as the negative control for this defect class. */
const OLD = (a: TimelineEvent, b: TimelineEvent) => (a.at < b.at ? 1 : -1);

test("negative control: the old comparator is inconsistent on equal timestamps", () => {
  const a = ev({ title: "A" }), b = ev({ title: "B" });
  assert.equal(OLD(a, b), -1);
  assert.equal(OLD(b, a), -1); // both "before" the other — not a total order
  assert.notEqual(sign(OLD(a, b)), -sign(OLD(b, a)));
});

test("compareTimelineEvents: newest first is preserved", () => {
  const older = ev({ at: "2026-09-14T12:00:00.000Z" }), newer = ev({ at: "2026-09-15T12:00:00.000Z" });
  assert.equal(sign(compareTimelineEvents(newer, older)), -1);
  assert.equal(sign(compareTimelineEvents(older, newer)), 1);
});

test("compareTimelineEvents: antisymmetric for every non-equal pair", () => {
  const events = [
    ev({ at: "2026-09-15T12:00:00.000Z", kind: "evidence", title: "A", source: "x" }),
    ev({ at: "2026-09-15T12:00:00.000Z", kind: "evidence", title: "B", source: "x" }),
    ev({ at: "2026-09-15T12:00:00.000Z", kind: "send", title: "A", source: "x" }),
    ev({ at: "2026-09-15T12:00:00.000Z", kind: "evidence", title: "A", source: "y" }),
    ev({ at: "2026-09-15T12:00:00.000Z", kind: "evidence", title: "A", source: "x", detail: "d" }),
    ev({ at: "2026-09-15T12:00:00.000Z", kind: "evidence", title: "A", source: "x", href: "/h" }),
    ev({ at: "2026-09-14T12:00:00.000Z", kind: "evidence", title: "A", source: "x" }),
  ];
  for (const a of events) {
    for (const b of events) {
      const ab = sign(compareTimelineEvents(a, b));
      assert.equal(ab, neg(sign(compareTimelineEvents(b, a))), `antisymmetry: ${JSON.stringify([a, b])}`);
      assert.equal(ab === 0, JSON.stringify(a) === JSON.stringify(b), `0 only for identical events: ${JSON.stringify([a, b])}`);
    }
  }
});

test("compareTimelineEvents: transitive, and a stable total order on tied timestamps", () => {
  const mk = (title: string, kind: TimelineEvent["kind"]) => ev({ title, kind });
  const shuffled = [mk("C", "send"), mk("A", "send"), mk("B", "evidence"), mk("A", "evidence"), mk("C", "evidence")];
  const once = [...shuffled].sort(compareTimelineEvents);
  const twice = [...shuffled].reverse().sort(compareTimelineEvents);
  assert.deepEqual(once.map((e) => `${e.kind}:${e.title}`), twice.map((e) => `${e.kind}:${e.title}`));
  for (const a of shuffled) for (const b of shuffled) for (const c of shuffled) {
    if (compareTimelineEvents(a, b) <= 0 && compareTimelineEvents(b, c) <= 0) {
      assert.ok(compareTimelineEvents(a, c) <= 0, "transitivity");
    }
  }
});
