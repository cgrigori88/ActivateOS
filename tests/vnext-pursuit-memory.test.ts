import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPursuitMemory, type LedgerRow } from "../src/lib/pursuits/read-models/memory";
import type { Caller } from "../src/lib/pursuits/read-models/helpers";

/**
 * Pursuit Memory (vNext Slice 1, chunk 2).
 *
 * The properties that make this a memory rather than a second attention feed:
 * business time drives the order, record time survives alongside it, LOW
 * materiality is retained, actor stays distinct from trigger, machine provenance
 * travels with machine-authored entries, the caller's disclosure capability is
 * honoured server-side, and the canonical ledger rows are never mutated.
 */

const T = (iso: string) => new Date(iso);

const FULL: Caller = { orgId: "org-1", canSeeInternal: true, canSeeTransactionDetail: true };
const GUEST: Caller = { orgId: "org-2", canSeeInternal: false, canSeeTransactionDetail: false };

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: over.id ?? "e-1",
    pursuitId: "p-1",
    entityType: "pursuit",
    entityId: "p-1",
    changeType: "SCORE_CHANGED",
    beforeState: { score: 60 },
    afterState: { score: 74 },
    materiality: "MEDIUM",
    reason: "Priority moved on new evidence",
    actorType: "SYSTEM",
    actorId: null,
    triggerType: "FACT_PROMOTED",
    triggerId: "f-9",
    modelVersion: null,
    agentRunId: null,
    dataEnvironment: "DEMO",
    occurredAt: T("2026-09-01T10:00:00Z"),
    recordedAt: T("2026-09-01T10:00:00Z"),
    ...over,
  };
}

// --- ordering ---------------------------------------------------------------

test("memory: orders by occurred_at (business time), not recorded_at", () => {
  // Deliberately adversarial: recorded_at order is the REVERSE of what happened.
  const rows = [
    row({ id: "late-record", occurredAt: T("2026-09-01T00:00:00Z"), recordedAt: T("2026-09-09T00:00:00Z") }),
    row({ id: "prompt-record", occurredAt: T("2026-09-05T00:00:00Z"), recordedAt: T("2026-09-05T00:00:00Z") }),
  ];
  const v = buildPursuitMemory("p-1", rows, FULL);
  assert.deepEqual(v.entries.map((e) => e.id), ["late-record", "prompt-record"],
    "the event that happened first must come first, however late it was recorded");
});

test("memory: newest-first still orders by business time", () => {
  const rows = [
    row({ id: "a", occurredAt: T("2026-09-01T00:00:00Z") }),
    row({ id: "b", occurredAt: T("2026-09-05T00:00:00Z") }),
  ];
  assert.deepEqual(buildPursuitMemory("p-1", rows, FULL, { order: "newest" }).entries.map((e) => e.id), ["b", "a"]);
});

test("memory: ties break deterministically, so a limit is reproducible", () => {
  const at = T("2026-09-01T00:00:00Z");
  const rows = [row({ id: "z", occurredAt: at }), row({ id: "a", occurredAt: at }), row({ id: "m", occurredAt: at })];
  const first = buildPursuitMemory("p-1", rows, FULL, { limit: 2 });
  const again = buildPursuitMemory("p-1", [...rows].reverse(), FULL, { limit: 2 });
  assert.deepEqual(first.entries.map((e) => e.id), ["a", "m"]);
  assert.deepEqual(again.entries.map((e) => e.id), first.entries.map((e) => e.id));
});

// --- business time vs record time -------------------------------------------

test("memory: record time is preserved alongside business time, with the lag named", () => {
  const v = buildPursuitMemory("p-1", [
    row({ occurredAt: T("2026-09-01T00:00:00Z"), recordedAt: T("2026-09-05T00:00:00Z") }),
  ], FULL);
  const e = v.entries[0];
  assert.equal(e.occurredAt, "2026-09-01T00:00:00.000Z");
  assert.equal(e.recordedAt, "2026-09-05T00:00:00.000Z");
  assert.equal(e.recordLagHours, 96);
  assert.equal(e.recordedLate, true);
  assert.equal(v.hasLateRecords, true);
});

test("memory: a promptly recorded event is not flagged late", () => {
  const v = buildPursuitMemory("p-1", [row()], FULL);
  assert.equal(v.entries[0].recordLagHours, 0);
  assert.equal(v.entries[0].recordedLate, false);
  assert.equal(v.hasLateRecords, false);
});

// --- materiality: retained, never a filter ----------------------------------

test("memory: LOW-materiality events are retained — this is the What-Changed difference", () => {
  const rows = [
    row({ id: "low", materiality: "LOW", changeType: "FACT_LINKED_TO_PURSUIT", occurredAt: T("2026-09-01T00:00:00Z") }),
    row({ id: "crit", materiality: "CRITICAL", occurredAt: T("2026-09-02T00:00:00Z") }),
  ];
  const v = buildPursuitMemory("p-1", rows, FULL);
  assert.deepEqual(v.entries.map((e) => e.id), ["low", "crit"]);
  assert.equal(v.byMateriality.LOW, 1);
  assert.equal(v.byMateriality.CRITICAL, 1);
  assert.equal(v.totalAvailable, 2, "nothing was filtered out");
});

test("memory: materiality survives on every entry so a surface can still emphasise", () => {
  const v = buildPursuitMemory("p-1", [row({ materiality: "HIGH" })], FULL);
  assert.equal(v.entries[0].materiality, "HIGH");
});

// --- actor, trigger, provenance ---------------------------------------------

test("memory: actor is preserved separately from trigger", () => {
  const v = buildPursuitMemory("p-1", [
    row({ actorType: "USER", actorId: "u-1", triggerType: "USER_OVERRIDE", triggerId: "o-7" }),
  ], FULL);
  const e = v.entries[0];
  assert.deepEqual(e.actor, { type: "USER", id: "u-1", automated: false });
  assert.deepEqual(e.trigger, { type: "USER_OVERRIDE", id: "o-7" });
});

test("memory: machine-authored entries carry their model provenance", () => {
  const v = buildPursuitMemory("p-1", [
    row({ actorType: "AGENT", actorId: "a-1", modelVersion: "route-v3", agentRunId: "run-22" }),
  ], FULL);
  const e = v.entries[0];
  assert.equal(e.actor.automated, true);
  assert.equal(e.provenance.modelVersion, "route-v3");
  assert.equal(e.provenance.agentRunId, "run-22");
  assert.equal(e.provenance.modelAttributed, true);
  assert.equal(v.hasAutomatedEntries, true);
});

test("memory: a human change is never reported as model-attributed", () => {
  const v = buildPursuitMemory("p-1", [row({ actorType: "USER", modelVersion: "route-v3" })], FULL);
  assert.equal(v.entries[0].provenance.modelAttributed, false);
  assert.equal(v.hasAutomatedEntries, false);
});

test("memory: a missing actor is reported as unknown, not guessed", () => {
  const v = buildPursuitMemory("p-1", [row({ actorType: null, actorId: null })], FULL);
  assert.deepEqual(v.entries[0].actor, { type: null, id: null, automated: false });
});

test("memory: synthetic lineage is preserved", () => {
  assert.equal(buildPursuitMemory("p-1", [row({ dataEnvironment: "DEMO" })], FULL).entries[0].synthetic, true);
  assert.equal(buildPursuitMemory("p-1", [row({ dataEnvironment: "PRODUCTION" })], FULL).entries[0].synthetic, false);
});

// --- disclosure -------------------------------------------------------------

test("memory: a guest caller sees that a change happened but not its internal payload", () => {
  const v = buildPursuitMemory("p-1", [row({ beforeState: { amount: 1840000 }, afterState: { amount: 2100000 } })], GUEST);
  const e = v.entries[0];
  assert.equal(e.beforeState, null, "the figure must be absent from the payload, not hidden downstream");
  assert.equal(e.afterState, null);
  assert.equal(e.stateWithheld, true);
  // The event itself is still legitimately visible.
  assert.equal(e.changeType, "SCORE_CHANGED");
  assert.equal(e.materiality, "MEDIUM");
  assert.equal(e.actor.type, "SYSTEM");
});

test("memory: a full-tenant caller sees the payload, and withholding is not claimed", () => {
  const v = buildPursuitMemory("p-1", [row()], FULL);
  assert.deepEqual(v.entries[0].afterState, { score: 74 });
  assert.equal(v.entries[0].stateWithheld, false);
});

test("memory: an entry with no state payload does not claim to have withheld one", () => {
  const v = buildPursuitMemory("p-1", [row({ beforeState: null, afterState: null })], GUEST);
  assert.equal(v.entries[0].stateWithheld, false);
});

// --- immutability of the canonical source -----------------------------------

test("memory: canonical ledger rows are never mutated", () => {
  const before = { score: 60 };
  const after = { score: 74 };
  const rows = [row({ beforeState: before, afterState: after })];
  const snapshot = JSON.stringify(rows);

  const v = buildPursuitMemory("p-1", rows, FULL);
  // Mutating the returned view must not reach back into the ledger row.
  (v.entries[0].afterState as Record<string, unknown>).score = 999;

  assert.equal(JSON.stringify(rows), snapshot, "the append-only source must be untouched");
  assert.equal(after.score, 74);
});

test("memory: the input array itself is not reordered in place", () => {
  const rows = [
    row({ id: "b", occurredAt: T("2026-09-05T00:00:00Z") }),
    row({ id: "a", occurredAt: T("2026-09-01T00:00:00Z") }),
  ];
  buildPursuitMemory("p-1", rows, FULL);
  assert.deepEqual(rows.map((r) => r.id), ["b", "a"]);
});

// --- scoping and windowing --------------------------------------------------

test("memory: rows belonging to another pursuit are dropped, not mixed in", () => {
  const rows = [row({ id: "mine" }), row({ id: "theirs", pursuitId: "p-2" }), row({ id: "orphan", pursuitId: null })];
  const v = buildPursuitMemory("p-1", rows, FULL);
  assert.deepEqual(v.entries.map((e) => e.id), ["mine"]);
  assert.equal(v.totalAvailable, 1);
});

test("memory: limit windows the result and reports the true total", () => {
  const rows = [
    row({ id: "a", occurredAt: T("2026-09-01T00:00:00Z") }),
    row({ id: "b", occurredAt: T("2026-09-02T00:00:00Z") }),
    row({ id: "c", occurredAt: T("2026-09-03T00:00:00Z") }),
  ];
  const v = buildPursuitMemory("p-1", rows, FULL, { limit: 2 });
  assert.deepEqual(v.entries.map((e) => e.id), ["a", "b"]);
  assert.equal(v.totalAvailable, 3, "a surface must be able to say 'showing 2 of 3'");
  assert.equal(v.firstOccurredAt, "2026-09-01T00:00:00.000Z");
  assert.equal(v.lastOccurredAt, "2026-09-03T00:00:00.000Z");
});

test("memory: an empty pursuit returns an empty memory, not an error", () => {
  const v = buildPursuitMemory("p-1", [], FULL);
  assert.deepEqual(v.entries, []);
  assert.equal(v.totalAvailable, 0);
  assert.equal(v.firstOccurredAt, null);
  assert.equal(v.lastOccurredAt, null);
  assert.equal(v.hasAutomatedEntries, false);
});

test("memory: episodes group by business-time gaps and are direction-independent", () => {
  const rows = [
    row({ id: "a", occurredAt: T("2026-09-01T00:00:00Z") }),
    row({ id: "b", occurredAt: T("2026-09-01T06:00:00Z") }),
    row({ id: "c", occurredAt: T("2026-09-20T00:00:00Z") }),
  ];
  const asc = buildPursuitMemory("p-1", rows, FULL);
  assert.deepEqual(asc.entries.map((e) => e.episodeIndex), [0, 0, 1]);
  const desc = buildPursuitMemory("p-1", rows, FULL, { order: "newest" });
  assert.deepEqual(desc.entries.map((e) => [e.id, e.episodeIndex]), [["c", 1], ["b", 0], ["a", 0]]);
});
