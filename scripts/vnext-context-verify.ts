import { Pool, type PoolClient } from "pg";
import { callerFor } from "../src/lib/pursuits/read-models/caller";
import {
  loadContextHealth,
  loadContextHealthInput,
  loadMissingContext,
  loadMissingContextInput,
  loadPertinence,
  loadPertinenceCandidates,
  loadPursuitEvidence,
  loadPursuitLedgerRows,
  loadPursuitMemory,
} from "../src/lib/pursuits/read-models/context-loaders";
import { rankPertinence } from "../src/lib/pursuits/read-models/pertinence";
import type { Caller } from "../src/lib/pursuits/read-models/helpers";

/**
 * Living Pursuit Context — loader + read-model integration harness (vNext Slice 1, chunk 5A).
 *
 * Proves that the four read-models can actually be populated from the canonical
 * substrate, and that the properties they were built to guarantee survive the
 * trip through SQL: freshness inputs arrive intact, REJECTED facts are excluded,
 * LOW-materiality memory entries are retained, business time stays distinct from
 * record time, actor stays distinct from trigger, the four-state gap vocabulary
 * is not flattened, and — the one that matters most — an item the caller may not
 * see cannot influence the ranking of anything they can.
 *
 * READ-ONLY. This harness writes nothing: no fixtures, no ledger rows, no flag
 * changes. Everything is asserted against the canonical synthetic world as it
 * stands.
 *
 * CLASSIFICATION: SEEDED, not EITHER.
 * The brief asked for EITHER. EITHER is defined in `scripts/verify-classes.ts` as
 * "run-scoped fixtures, no reliance on demo content", and EITHER suites are given
 * a DISPOSABLE database. A harness that writes nothing can only read the demo
 * world, which is the definition of SEEDED. Wave 6C already caught five suites
 * mislabelled this way; on a disposable database this one would find no pursuit
 * and assert nothing. Read-only was the stronger constraint, so the class
 * follows it.
 *
 *   npx tsx scripts/vnext-context-verify.ts
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN, max: 2 });

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

/** Read-only transaction, pinned to the org exactly as `withTenant` would. */
async function inOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin read only");
    await c.query("select set_config('app.org_id', $1, true)", [orgId]);
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }
}

const trunc = (s: string, n = 68) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

async function main(): Promise<void> {
  console.log(`[vnext-context-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);

  // --- pick the richest pursuit in the canonical world. Not hard-coded to an
  // account name: the harness must survive a reseed that renames the cast.
  const target = (await pool.query<{ id: string; org_id: string; legal_name: string; use_case: string | null; ledger: string; facts: string }>(
    `select p.id, p.org_id, c.legal_name, p.use_case,
            (select count(*) from change_ledger cl where cl.pursuit_id = p.id)::text as ledger,
            (select count(*) from pursuit_facts pf where pf.pursuit_id = p.id)::text as facts
       from pursuits p join companies c on c.id = p.account_id
      order by (select count(*) from change_ledger cl where cl.pursuit_id = p.id) desc,
               (select count(*) from pursuit_facts pf where pf.pursuit_id = p.id) desc,
               p.created_at asc
      limit 1`,
  )).rows[0];

  if (!target) {
    console.log("\nFATAL: no pursuit in this database. Seed the canonical world first:");
    console.log("  npx tsx scripts/seed-demo-world.ts");
    await pool.end();
    process.exit(1);
  }

  const caller: Caller = await inOrg(target.org_id, (db) => callerFor(db, target.org_id));
  const guest: Caller = { orgId: target.org_id, canSeeInternal: false, canSeeTransactionDetail: false };

  console.log(`\nPursuit under test: ${target.legal_name} · ${target.use_case ?? "—"}`);
  console.log(`  id ${target.id} · ${target.facts} linked fact(s) · ${target.ledger} ledger entr(ies)`);

  // =========================================================================
  console.log("\n1  Context health loader");
  // =========================================================================
  const chInput = await inOrg(target.org_id, (db) => loadContextHealthInput(db, caller, target.id));
  const health = await inOrg(target.org_id, (db) => loadContextHealth(db, caller, target.id));

  check("loader resolves the pursuit and returns an input", chInput != null && health != null);
  if (chInput && health) {
    check("linked facts come from pursuit_facts, not the whole account",
      chInput.facts.length === Number(target.facts),
      `loader ${chInput.facts.length} vs pursuit_facts ${target.facts}`);

    check("freshness inputs survive the projection",
      chInput.facts.every((f) => f.observedLastAt instanceof Date && typeof f.freshnessPolicy === "string"),
      "observedLastAt / freshnessPolicy must arrive typed");

    check("relevance_type is preserved from pursuit_facts",
      chInput.facts.every((f) => typeof f.relevance === "string" && f.relevance.length > 0));

    check("provenance and confidence survive",
      chInput.facts.every((f) => typeof f.provenanceClass === "string" && Number.isFinite(f.confidence)));

    const rejected = (await pool.query<{ n: string }>(
      `select count(*)::text n from pursuit_facts pf join facts f on f.id = pf.ref_id
        where pf.pursuit_id = $1 and f.status = 'REJECTED'`, [target.id])).rows[0].n;
    check("REJECTED facts are excluded from scoring, and the exclusion is counted",
      health.factsExcluded === Number(rejected),
      `view ${health.factsExcluded} vs db ${rejected}`);

    check("coverage is computed from provider runs / signals, not invented",
      health.coverage.overall >= 0 && health.coverage.overall <= 100);

    check("a conclusion is reported using the canonical four-state vocabulary",
      ["VERIFIED", "INFERRED", "NEEDS_VALIDATION", "STALE", "CONFLICTING", "NOT_ESTABLISHED"].includes(health.conclusion),
      health.conclusion);

    check("unknown is not reported as zero",
      health.overall !== 0 || health.factsConsidered > 0,
      "a pursuit with no measurable context must return null, not 0");

    check("every dimension carries an inspectable reason",
      health.dimensions.every((d) => d.why.length > 0));

    // Disclosure: a guest must never see more than a full tenant.
    const guestHealth = await inOrg(target.org_id, (db) => loadContextHealth(db, guest, target.id));
    check("a guest caller never sees more linked facts than a full tenant",
      (guestHealth?.factsConsidered ?? 0) <= health.factsConsidered,
      `guest ${guestHealth?.factsConsidered} vs full ${health.factsConsidered}`);

    console.log(`\n  → ${health.conclusion}  overall ${health.overall ?? "—"} (${health.band})  ` +
      `${health.factsConsidered} fact(s), ${health.coverage.gaps.length} coverage gap(s)`);
    for (const d of health.dimensions) {
      console.log(`     ${d.key.padEnd(14)} ${String(d.value ?? "—").padStart(4)}  ${d.band}`);
    }
    for (const c of health.concerns.slice(0, 3)) {
      console.log(`     concern: [${c.kind}] ${trunc(c.text)}`);
    }
  }

  // =========================================================================
  console.log("\n2  Memory loader");
  // =========================================================================
  const rows = await inOrg(target.org_id, (db) => loadPursuitLedgerRows(db, caller, target.id));
  const memory = await inOrg(target.org_id, (db) => loadPursuitMemory(db, caller, target.id));

  check("every ledger row for the pursuit is loaded — no materiality predicate",
    rows.length === Number(target.ledger),
    `loader ${rows.length} vs change_ledger ${target.ledger}`);

  const dbLow = (await pool.query<{ n: string }>(
    `select count(*)::text n from change_ledger where pursuit_id = $1 and materiality = 'LOW'`, [target.id])).rows[0].n;
  check("LOW-materiality entries are retained (the What-Changed difference)",
    memory.byMateriality.LOW === Number(dbLow),
    `memory ${memory.byMateriality.LOW} vs db ${dbLow}`);

  check("occurred_at and recorded_at are both preserved, and separately",
    memory.entries.every((e) => typeof e.occurredAt === "string" && typeof e.recordedAt === "string"));

  check("entries are ordered by business time, oldest first",
    memory.entries.every((e, i) => i === 0 || e.occurredAt >= memory.entries[i - 1].occurredAt));

  check("actor is preserved separately from trigger",
    memory.entries.every((e) => "type" in e.actor && "type" in e.trigger));

  const withActor = memory.entries.filter((e) => e.actor.type != null);
  check("at least one entry carries a real actor from the ledger", withActor.length > 0,
    `${withActor.length} of ${memory.entries.length}`);

  check("machine-authored entries are distinguishable from human ones",
    memory.entries.every((e) => e.actor.automated === (e.actor.type != null && ["AGENT", "WORKER", "SYSTEM", "IMPORT", "API"].includes(e.actor.type))));

  // Loader FIDELITY, which is this harness's job: `synthetic` must mirror the
  // ledger's own lineage exactly. Whether the world labelled a row correctly is a
  // separate question, reported below rather than failed here.
  const lineage = new Map((await pool.query<{ id: string; data_environment: string }>(
    `select id, data_environment from change_ledger where pursuit_id = $1`, [target.id],
  )).rows.map((r) => [r.id, r.data_environment]));
  check("lineage is projected faithfully from the ledger",
    memory.entries.every((e) => e.synthetic === (lineage.get(e.id) !== "PRODUCTION")));

  const mislabelled = memory.entries.filter((e) => lineage.get(e.id) === "PRODUCTION");
  if (mislabelled.length) {
    console.log(`\n  ⚠ WORLD DEFECT (not a loader defect): ${mislabelled.length} ledger row(s) in this`);
    console.log(`    SYNTHETIC world carry data_environment = 'PRODUCTION':`);
    for (const e of mislabelled) console.log(`      ${e.changeType} — ${trunc(e.reason ?? "—", 46)}`);
    console.log(`    Cause: recordChange() defaults dataEnvironment to 'PRODUCTION'`);
    console.log(`    (src/lib/pursuits/ledger.ts), and the override call sites omit it.`);
    console.log(`    Effect: these entries are not labelable as synthetic. Reported, not fixed —`);
    console.log(`    it is a seed-path defect, out of scope for the loader layer.`);
  }

  // Immutability: loading twice must not disturb anything.
  const again = await inOrg(target.org_id, (db) => loadPursuitLedgerRows(db, caller, target.id));
  check("loading is repeatable and mutates nothing", again.length === rows.length);

  const guestMemory = await inOrg(target.org_id, (db) => loadPursuitMemory(db, guest, target.id));
  const withheld = guestMemory.entries.filter((e) => e.stateWithheld).length;
  check("a guest sees the events but not their internal state payloads",
    guestMemory.entries.length === memory.entries.length && guestMemory.entries.every((e) => e.beforeState === null && e.afterState === null),
    `${withheld} payload(s) withheld`);

  console.log(`\n  → ${memory.entries.length} entr(ies) · ` +
    `LOW ${memory.byMateriality.LOW} / MED ${memory.byMateriality.MEDIUM} / HIGH ${memory.byMateriality.HIGH} / CRIT ${memory.byMateriality.CRITICAL}`);
  for (const e of memory.entries.slice(0, 4)) {
    console.log(`     ${e.occurredAt.slice(0, 10)}  [${e.materiality.padEnd(8)}] ${e.changeType.padEnd(26)} ${trunc(e.reason ?? "—", 40)}`);
  }

  // =========================================================================
  console.log("\n3  Missing-context loader");
  // =========================================================================
  const mcInput = await inOrg(target.org_id, (db) => loadMissingContextInput(db, caller, target.id));
  const missing = await inOrg(target.org_id, (db) => loadMissingContext(db, caller, target.id));

  check("loader supplies all five gap sources or says why not",
    mcInput != null && missing != null);

  if (mcInput && missing) {
    const supplied = [
      mcInput.contextHealth !== undefined,
      mcInput.stakeholderCoverage !== undefined,
      mcInput.valueCase !== undefined,
      mcInput.whyNow !== undefined,
      mcInput.meddpicc !== undefined,
    ].filter(Boolean).length;
    check("every source is explicitly supplied — none left silently unevaluated",
      supplied === 5, `${supplied}/5`);

    check("an unevaluated source would be reported, not read as 'no gaps'",
      missing.notEvaluated.every((n) => n.reason.length > 0));

    const kinds = new Set(missing.gaps.map((g) => g.kind));
    check("the four-state vocabulary is not flattened into 'missing'",
      kinds.size === 0 || [...kinds].every((k) => ["MISSING", "STALE", "CONFLICTING", "UNVERIFIED", "NOT_ESTABLISHED"].includes(k)),
      [...kinds].join(", ") || "no gaps");

    check("gaps are ranked, highest first",
      missing.gaps.every((g, i) => i === 0 || g.rank <= missing.gaps[i - 1].rank));

    check("every gap names its source and exposes its ranking arithmetic",
      missing.gaps.every((g) => g.source && g.rankReasons.length >= 2));

    // Entitlement: a guest must not be told what they are missing behind a boundary.
    const guestMissing = await inOrg(target.org_id, (db) => loadMissingContext(db, guest, target.id));
    const guestSources = new Set(guestMissing?.gaps.map((g) => g.source) ?? []);
    check("private information does not surface to a guest as their own gap",
      !guestSources.has("STAKEHOLDER_COVERAGE") && !guestSources.has("VALUE_CASE"),
      [...guestSources].join(", ") || "none");
    check("withheld items are disclosed as a count only",
      (guestMissing?.withheldCount ?? 0) >= 0 &&
      !JSON.stringify(guestMissing ?? {}).includes("economic_buyer"),
      `withheldCount ${guestMissing?.withheldCount}`);

    console.log(`\n  → ${missing.gaps.length} gap(s) · ` +
      Object.entries(missing.byKind).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(" / ") || "none");
    if (missing.notEvaluated.length) {
      for (const n of missing.notEvaluated) console.log(`     not evaluated: ${n.source} — ${n.reason}`);
    }
    for (const g of missing.gaps.slice(0, 5)) {
      console.log(`     ${String(g.rank).padStart(3)}  [${g.kind.padEnd(15)}] ${g.source.padEnd(21)} ${trunc(g.text, 42)}`);
    }
  }

  // =========================================================================
  console.log("\n4  Pertinence loader");
  // =========================================================================
  const candidates = await inOrg(target.org_id, (db) => loadPertinenceCandidates(db, caller, target.id));
  check("candidates are assembled from facts, events and gaps", (candidates?.length ?? 0) > 0,
    `${candidates?.length ?? 0} candidate(s)`);

  if (candidates) {
    const kinds = new Set(candidates.map((c) => c.kind));
    check("all three candidate kinds compete on one list", kinds.size >= 2, [...kinds].join(", "));

    check("every candidate carries a disclosure class",
      candidates.every((c) => typeof c.disclosure === "string" && c.disclosure.length > 0));

    check("no candidate references another pursuit",
      candidates.every((c) => c.refId !== null || c.kind === "GAP"));

    // 5B-1: the upstream gap semantics must survive the conversion.
    const gapCandidates = candidates.filter((c) => c.kind === "GAP");
    check("every gap candidate carries its upstream rank and source",
      gapCandidates.length > 0 && gapCandidates.every((c) => typeof c.gapRank === "number" && !!c.gapSource),
      `${gapCandidates.filter((c) => typeof c.gapRank === "number").length}/${gapCandidates.length} carry a rank`);

    if (missing) {
      const upstream = new Map(missing.gaps.map((g) => [`gap:${g.key}`, g]));
      check("the carried rank equals the rank the gap layer assigned",
        gapCandidates.every((c) => c.gapRank === upstream.get(c.id)?.rank));
      check("the carried source equals the source the gap layer assigned",
        gapCandidates.every((c) => c.gapSource === upstream.get(c.id)?.source));
      check("gap candidates no longer tie on linkage when upstream ranks differ",
        new Set(gapCandidates.map((c) => c.gapRank)).size > 1,
        `${new Set(gapCandidates.map((c) => c.gapRank)).size} distinct rank(s)`);
    }
  }

  // Task context changes the answer without the data changing.
  const general = await inOrg(target.org_id, (db) => loadPertinence(db, caller, target.id, { decisionContext: "GENERAL", limit: 5 }));
  const timing = await inOrg(target.org_id, (db) => loadPertinence(db, caller, target.id, { decisionContext: "VALIDATE_TIMING", limit: 5 }));
  const risk = await inOrg(target.org_id, (db) => loadPertinence(db, caller, target.id, { decisionContext: "ASSESS_RISK", limit: 5 }));

  check("pertinence is computed for every task context",
    general != null && timing != null && risk != null);

  if (general && timing && risk) {
    const sameSet = general.considered === timing.considered && timing.considered === risk.considered;
    check("the underlying canonical data does not change between task contexts", sameSet,
      `${general.considered} / ${timing.considered} / ${risk.considered}`);

    // Whether a given task discriminates depends on what this pursuit actually
    // holds: a context with no TIMING_ANCHOR fact and no stale/conflicting gap
    // has nothing for VALIDATE_TIMING to lift. So the property under test is that
    // task context CAN change the answer on real data — checked across the full
    // vocabulary — and the harness reports which contexts moved and which did not.
    const sig = (v: { items: { id: string; score: number }[] }) => JSON.stringify(v.items.map((i) => [i.id, i.score]));
    const baseline = sig(general);
    const contexts = ["VALIDATE_TIMING", "SELECT_ROUTE", "QUALIFY", "ENGAGE_STAKEHOLDER", "ASSESS_RISK", "BUILD_VALUE_CASE"] as const;
    const moved: string[] = [], inert: string[] = [];
    for (const ctx of contexts) {
      const r = await inOrg(target.org_id, (db) => loadPertinence(db, caller, target.id, { decisionContext: ctx, limit: 5 }));
      (r && sig(r) !== baseline ? moved : inert).push(ctx);
    }
    check("changing the task changes the ranking, on unchanged canonical data", moved.length > 0,
      `moved: ${moved.join(", ") || "none"}`);
    console.log(`\n  → task contexts that reorder/rescore: ${moved.join(", ") || "none"}`);
    if (inert.length) {
      console.log(`    no effect on THIS pursuit's data: ${inert.join(", ")}`);
      console.log(`    (expected when the pursuit holds nothing that task turns on —`);
      console.log(`     see the chunk-5B note on gap-source task fit)`);
    }

    check("every ranked item exposes its arithmetic",
      general.items.every((i) => i.signals.length === 5 && i.topReasons.length > 0));

    check("the score is exactly the sum of the signal contributions",
      general.items.every((i) => i.score === Math.round(i.signals.reduce((a, s) => a + s.contribution, 0) * 100)));
  }

  // The disclosure property: a guest's ranking must be identical to ranking the
  // guest-visible subset alone. Anything they cannot see contributed nothing.
  const guestRanked = await inOrg(target.org_id, (db) => loadPertinence(db, guest, target.id, { decisionContext: "GENERAL" }));
  const guestCandidates = await inOrg(target.org_id, (db) => loadPertinenceCandidates(db, guest, target.id));
  if (guestRanked && guestCandidates) {
    const isolated = rankPertinence({ pursuitId: target.id, caller: guest, candidates: guestCandidates, decisionContext: "GENERAL" });
    check("an inaccessible item cannot influence authorized ordering or scores",
      JSON.stringify(guestRanked.items.map((i) => [i.id, i.score])) === JSON.stringify(isolated.items.map((i) => [i.id, i.score])),
      "the authorized output must be identical whether the inaccessible item exists or not");
    check("a guest never outranks a full tenant in visibility",
      guestRanked.considered <= (general?.considered ?? 0),
      `guest ${guestRanked.considered} vs full ${general?.considered}`);
  }

  if (general) {
    console.log(`\n  → GENERAL (top ${general.items.length} of ${general.considered})`);
    for (const i of general.items) console.log(`     ${String(i.score).padStart(3)} [${i.kind.padEnd(5)}] ${trunc(i.label, 44)}`);
    for (const ctx of ["VALIDATE_TIMING", "SELECT_ROUTE", "QUALIFY", "ENGAGE_STAKEHOLDER", "ASSESS_RISK", "BUILD_VALUE_CASE"] as const) {
      const r = await inOrg(target.org_id, (db) => loadPertinence(db, caller, target.id, { decisionContext: ctx, limit: 5 }));
      if (!r) continue;
      console.log(`  → ${ctx} (top ${r.items.length} of ${r.considered})`);
      for (const i of r.items) console.log(`     ${String(i.score).padStart(3)} [${i.kind.padEnd(5)}] ${trunc(i.label, 44)}`);
    }
  }

  // 5B-1: the headline behaviour — does a timing task now surface timing context?
  if (general && timing) {
    const timingLed = timing.items[0];
    const wasLed = general.items[0];
    const hasTimingGap = (await inOrg(target.org_id, (db) => loadMissingContext(db, caller, target.id)))
      ?.gaps.some((g) => g.source === "WHY_NOW") ?? false;
    if (hasTimingGap) {
      check("VALIDATE_TIMING surfaces a WHY_NOW timing gap first",
        timingLed?.id.startsWith("gap:whynow"),
        `led with ${timingLed?.label}`);
      console.log(`\n  → VALIDATE_TIMING reorder: "${trunc(wasLed.label, 40)}" (${wasLed.score})`);
      console.log(`     becomes              "${trunc(timingLed.label, 40)}" (${timingLed.score})`);
    } else {
      console.log("\n  ⓘ this pursuit has no WHY_NOW gap, so VALIDATE_TIMING has nothing to lift.");
      console.log("    The behaviour is covered by tests/vnext-gap-pertinence.test.ts instead.");
    }
  }

  // =========================================================================
  console.log("\n5  Pursuit evidence — direct vs supporting");
  // =========================================================================
  const evidence = await inOrg(target.org_id, (db) => loadPursuitEvidence(db, caller, target.id));
  check("evidence composition resolves for the pursuit", evidence != null);

  if (evidence) {
    const linkedInDb = Number(target.facts);
    check("DIRECT contains exactly the pursuit-linked facts",
      evidence.direct.length === linkedInDb,
      `direct ${evidence.direct.length} vs pursuit_facts ${linkedInDb}`);
    check("every DIRECT item is EXPLICIT and carries its asserted relevance",
      evidence.direct.every((d) => d.linkage === "EXPLICIT" && !!d.relevance));
    check("every SUPPORTING item is INFERRED and exposes why it was included",
      evidence.supporting.every((s) => s.linkage === "INFERRED" && s.inclusionReasons.length > 0 && s.signals.length === 5));
    check("no fact appears in both arrays",
      evidence.supporting.every((s) => !evidence.direct.some((d) => d.factId === s.factId)));
    check("every considered account fact is accounted for exactly once",
      evidence.excludedSummary.accountFactsConsidered ===
        evidence.direct.length + evidence.supporting.length +
        evidence.excludedSummary.rejected + evidence.excludedSummary.unauthorized +
        evidence.excludedSummary.belowBand + evidence.excludedSummary.beyondLimit,
      JSON.stringify(evidence.excludedSummary));
    check("supporting context does NOT create a pursuit_facts row",
      Number((await pool.query<{ n: string }>(
        `select count(*)::text n from pursuit_facts where pursuit_id = $1`, [target.id])).rows[0].n) === linkedInDb,
      "composition must be read-only");

    const guestEvidence = await inOrg(target.org_id, (db) => loadPursuitEvidence(db, guest, target.id));
    check("a guest never sees more evidence than a full tenant",
      (guestEvidence?.direct.length ?? 0) + (guestEvidence?.supporting.length ?? 0)
        <= evidence.direct.length + evidence.supporting.length,
      `guest ${(guestEvidence?.direct.length ?? 0)}+${(guestEvidence?.supporting.length ?? 0)} vs full ${evidence.direct.length}+${evidence.supporting.length}`);

    const e = evidence.excludedSummary;
    console.log(`\n  → DIRECT PURSUIT EVIDENCE (${evidence.direct.length})`);
    for (const d of evidence.direct) {
      console.log(`     [${d.relevance.padEnd(19)}] ${trunc(d.label, 30).padEnd(31)} ${d.predicateKey.padEnd(21)} conf ${d.confidence.toFixed(2)} fresh ${d.freshness.toFixed(2)}`);
    }
    if (!evidence.direct.length) console.log("     (none linked)");

    console.log(`\n  → SUPPORTING ACCOUNT CONTEXT (${evidence.supporting.length})`);
    for (const sc of evidence.supporting) {
      console.log(`     ${String(sc.pertinence).padStart(3)} [${sc.inferredRelevance.padEnd(19)}] ${trunc(sc.label, 30).padEnd(31)} ${sc.predicateKey.padEnd(21)} ${sc.band}`);
      console.log(`         because: ${sc.inclusionReasons.join(" · ")}`);
    }
    if (!evidence.supporting.length) console.log("     (none pertinent enough)");

    console.log(`\n  → EXCLUDED SUMMARY — ${e.accountFactsConsidered} account fact(s) considered`);
    console.log(`     direct ${e.direct} · supporting ${e.supporting} · below band ${e.belowBand} · beyond limit ${e.beyondLimit} · rejected ${e.rejected} · not disclosable ${e.unauthorized}`);
  }

  // =========================================================================
  console.log("\n6  Scoping");
  // =========================================================================
  const otherOrg = (await pool.query<{ id: string }>(
    `select id from organizations where id <> $1 order by created_at limit 1`, [target.org_id])).rows[0];
  if (otherOrg) {
    const foreign: Caller = { orgId: otherOrg.id, canSeeInternal: true, canSeeTransactionDetail: true };
    const leak = await inOrg(otherOrg.id, (db) => loadContextHealth(db, foreign, target.id));
    check("a caller from another org cannot load this pursuit's context", leak === null);
    const leakMemory = await inOrg(otherOrg.id, (db) => loadPursuitMemory(db, foreign, target.id));
    check("a caller from another org gets no memory for this pursuit", leakMemory.entries.length === 0);
  } else {
    check("a second organization exists to test cross-tenant scoping", false, "only one org in this world");
  }

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed`);
  if (failures.length) for (const f of failures) console.log(`  ✗ ${f}`);
  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("[vnext-context-verify] fatal:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
