import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { decideDerivation, mayDerive } from "../src/lib/pursuits/federation/derivation";
import { loadCohortDerivationFacts, loadCohortViewers } from "../src/lib/pursuits/federation/batch-facts";
import { METRICS } from "../src/lib/experience/registry";

/**
 * D-P6-DERIVATION-MULTIGRANT — several live grants, one decision.
 *
 * > **Multiple live qualifying derivation grants compose by UNION: each independently confers only
 * > what it permits, and a narrower sibling cannot deny by being looked at first.**
 *
 * WHAT WAS WRONG. The one-row grant loader ended `limit 1` with no `order by`. PostgreSQL therefore
 * guaranteed nothing about WHICH qualifying grant it returned, and the pick mattered — grants differ
 * in `retention_class` and in `scope.keys`. A viewer holding a broad grant and a narrow one could be
 * refused a derivation the broad grant plainly permitted, on the strength of physical row order.
 * The historical shape is kept here as a negative control, because the defect is only visible
 * against it: both loaders now `order by id` and the decision core considers EVERY qualifying grant.
 *
 * WHAT THIS SUITE HOLDS, and why it is not covered by the unit tests alone. `decideDerivation` is
 * pure and is pinned by `tests/d-s14-batched-governance.test.ts` on hand-built facts. This suite
 * proves the other half: that the two FACT LOADERS — the one-row `mayDerive` and the cohort loader
 * `loadCohortDerivationFacts` — acquire the same facts from a real database under a real `app_rw`
 * session, so that batching changed fact acquisition and not governance meaning. A shared core is
 * only worth having if both paths actually reach it with the same facts.
 *
 * FIRST-BY-ID IS DIAGNOSTIC, NOT PRECEDENCE. Both loaders order by `id` so the grant a decision
 * NAMES is deterministic and can be cited in an explanation. That is all it is: when two grants each
 * independently permit, removing the named one changes the citation and not the decision. No grant
 * outranks another.
 *
 * SAFETY. Fixtures COMMIT, so this runs only on a disposable seeded clone (SEEDED_CLONE).
 *
 *   npx tsx scripts/verify-run.ts --suite dp6-multigrant
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const owner = new Pool({ connectionString: CONN, max: 2 });
let passed = 0, failed = 0;
const failures: string[] = [];
const check = (n: string, ok: boolean, d?: unknown): void => {
  const detail = d === undefined ? "" : ` — ${JSON.stringify(d)}`;
  if (ok) { passed++; console.log(`  ✓ ${n}${detail}`); }
  else { failed++; failures.push(n); console.log(`  ✗ ${n}${detail}`); }
};
const note = (n: string, d?: unknown): void => console.log(`  · ${n}${d === undefined ? "" : ` — ${JSON.stringify(d)}`}`);
function must<T>(name: string, v: T | undefined | null): T {
  if (v !== undefined && v !== null) return v;
  failed++; failures.push(name); throw new Error(`required fixture missing: ${name}`);
}

/**
 * THE HISTORICAL SELECTOR, kept verbatim as a NEGATIVE CONTROL.
 *
 * This is the shape the one-row loader carried before the correction: the same predicate the product
 * still uses, ended by an unordered `limit 1`. It is never called by product code — it exists so the
 * defect can be reproduced rather than described, and so a regression to this shape is visible as a
 * behavioural difference and not only as a diff.
 */
const HISTORICAL_UNORDERED_LIMIT_1 = `
  select id, purpose_code, retention_class, scope
    from context_grants
   where from_org_id = $1 and to_org_id = $2 and pursuit_id = $3
     and grant_kind = 'DATA' and status = 'accepted'
     and purpose_code is not null
     and purpose_code = $4
     and governed_information_classes is not null and $5 = any(governed_information_classes)
     and (expires_at is null or expires_at > coalesce($6::timestamptz, transaction_timestamp()))
   limit 1`;

const SRC = (rel: string): string => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
/** Every `context_grants` SELECT in a module, comment-stripped (§16A: prose must not satisfy a scan). */
const grantQueries = (rel: string): string[] =>
  [...strip(SRC(rel)).matchAll(/select[\s\S]{0,600}?from context_grants[\s\S]{0,800}?`/g)].map((m) => m[0]);

async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await owner.connect();
  try { return await fn(c); } finally { c.release(); }
}
/** A real `app_rw` session carrying tenant context — the substrate governance actually runs on. */
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await owner.connect();
  try {
    await c.query("begin");
    await c.query("set local role app_rw");
    await c.query("select set_config('app.org_id', $1, true)", [orgId]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

const def = must("the registered per-pursuit open-pipeline metric", METRICS["pursuit.open_pipeline_usd@1"]);
const PURPOSE = def.derivePurpose;
const INPUT_KIND = def.deriveInputKind;

let VIEWER = "", FOREIGN_PURSUIT = "", SOURCE_ORG = "", MERGE_TARGET = "", GOV_CLASS = "";

/** Both paths, on the same world, in the same `app_rw` transaction. */
async function bothPaths(): Promise<{
  oneRow: Awaited<ReturnType<typeof mayDerive>>;
  batched: ReturnType<typeof decideDerivation>;
  qualifying: { id: string }[];
  perGrant: { id: string; allow: boolean }[];
}> {
  const input = { inputKind: INPUT_KIND, sourceOrgId: SOURCE_ORG, pursuitId: FOREIGN_PURSUIT };
  return asOrg(VIEWER, async (db) => {
    const oneRow = await mayDerive(db, VIEWER, input, PURPOSE);
    const { rows } = await db.query<{ id: string; org_id: string; live: boolean }>(
      `select id, org_id, (status not in ('WON','LOST','DISQUALIFIED') and merged_into_pursuit_id is null) as live
         from pursuits where id = $1`, [FOREIGN_PURSUIT]);
    const subjects = rows.map((r) => ({ id: r.id, ownerOrgId: r.org_id, live: r.live }));
    const viewers = await loadCohortViewers(db, VIEWER, subjects);
    const cohort = await loadCohortDerivationFacts(db, VIEWER, subjects, { inputKind: INPUT_KIND, purpose: PURPOSE });
    const facts = cohort.derivation(FOREIGN_PURSUIT, viewers.viewer(FOREIGN_PURSUIT).isParticipant);
    const batched = decideDerivation(VIEWER, input, PURPOSE, facts);
    // What the HISTORICAL loader could have decided: the core's own verdict on each qualifying grant
    // taken alone. This is the choice set an unordered `limit 1` was free to return.
    const perGrant = facts.grants.map((g) => ({
      id: g.id,
      allow: decideDerivation(VIEWER, input, PURPOSE, { ...facts, grants: [g] }).allow,
    }));
    return { oneRow, batched, qualifying: facts.grants.map((g) => ({ id: g.id })), perGrant };
  });
}

const sameDecision = (a: Awaited<ReturnType<typeof mayDerive>>, b: ReturnType<typeof decideDerivation>): boolean =>
  a.allow === b.allow
  && (a.allow && b.allow
    ? a.grantId === b.grantId && a.retention === b.retention && a.informationClass === b.informationClass
    : !a.allow && !b.allow ? a.reason === b.reason : false);

async function main(): Promise<void> {
  await assertSeededClone(owner);
  console.log(`[dp6-multigrant-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);

  // ── FIXTURE ───────────────────────────────────────────────────────────────────────────────────
  const fixture = await asOwner(async (db) => {
    const viewer = must("an organization with open pursuits", (await db.query<{ id: string }>(
      `select p.org_id as id from pursuits p
        where p.status not in ('WON','LOST','DISQUALIFIED')
        group by p.org_id order by count(*) desc, p.org_id limit 1`)).rows[0]);
    const foreign = must("a pursuit owned by another organization", (await db.query<{ id: string; org_id: string }>(
      `select id, org_id from pursuits
        where org_id <> $1 and status not in ('WON','LOST','DISQUALIFIED')
        order by id limit 1`, [viewer.id])).rows[0]);
    const mergeTarget = must("a pursuit of the viewer's own to merge into", (await db.query<{ id: string }>(
      `select id from pursuits where org_id = $1 order by id limit 1`, [viewer.id])).rows[0]);
    // The viewer becomes an ACTIVE participant, which is what admits the foreign pursuit to its
    // cohort at all. Derivation authority is a separate question, and it is the question here.
    await db.query(
      `insert into pursuit_participants (pursuit_id, org_id, sponsor_org_id, role_key, participation_state, effective_from)
       values ($1, $2, $3, 'RESELLER', 'ACTIVE', now())`, [foreign.id, viewer.id, foreign.org_id]);
    return { viewer: viewer.id, foreign: foreign.id, sourceOrg: foreign.org_id, mergeTarget: mergeTarget.id };
  });
  VIEWER = fixture.viewer; FOREIGN_PURSUIT = fixture.foreign; SOURCE_ORG = fixture.sourceOrg; MERGE_TARGET = fixture.mergeTarget;
  const { INPUT_CLASS_REGISTRY } = await import("../src/lib/pursuits/federation/derivation");
  GOV_CLASS = must("the governed information class this input maps to", INPUT_CLASS_REGISTRY[INPUT_KIND]);
  note("fixture", { viewer: VIEWER.slice(0, 8), foreignPursuit: FOREIGN_PURSUIT.slice(0, 8), purpose: PURPOSE, inputKind: INPUT_KIND, governedClass: GOV_CLASS });

  const addGrant = (over: {
    scope?: Record<string, unknown>; retention?: string; purpose?: string;
    classes?: string[]; status?: string; expires?: Date | null;
  } = {}): Promise<string> => asOwner(async (db) => (await db.query<{ id: string }>(
    `insert into context_grants (pursuit_id, from_org_id, to_org_id, grant_kind, governed_information_classes,
                                 information_classes, purpose, purpose_code, scope, status, retention_class, expires_at)
     values ($1, $2, $3, 'DATA', $4, array[$5], 'dp6-multigrant fixture', $6, $7::jsonb, $8, $9, $10) returning id`,
    [FOREIGN_PURSUIT, SOURCE_ORG, VIEWER, over.classes ?? [GOV_CLASS], GOV_CLASS,
     over.purpose ?? PURPOSE, JSON.stringify(over.scope ?? {}), over.status ?? "accepted",
     over.retention ?? "RETAINED", over.expires === undefined ? new Date(Date.now() + 3_600_000) : over.expires])).rows[0].id);
  const clearGrants = (): Promise<unknown> => asOwner((db) =>
    db.query(`delete from context_grants where pursuit_id = $1 and to_org_id = $2`, [FOREIGN_PURSUIT, VIEWER]));
  const setMerged = (into: string | null): Promise<unknown> => asOwner((db) =>
    db.query(`update pursuits set merged_into_pursuit_id = $2 where id = $1`, [FOREIGN_PURSUIT, into]));

  // ══ 1 · THE HISTORICAL UNORDERED `limit 1`, AS A NEGATIVE CONTROL ════════════════════════════
  console.log("\n=== 1 · THE HISTORICAL SELECTOR: AN UNORDERED `limit 1` LET ROW ORDER DECIDE GOVERNANCE");
  check("1A · the control really is the historical shape: `limit 1`, and no `order by` anywhere in it",
    /limit\s+1/i.test(HISTORICAL_UNORDERED_LIMIT_1) && !/order\s+by/i.test(HISTORICAL_UNORDERED_LIMIT_1));
  // CLASSIFY, DO NOT COUNT. Three product queries read `context_grants`, and they are not the same
  // kind of read: two SELECT THE GRANTS A DECISION IS MADE FROM (they carry purpose_code and
  // retention_class — one per fact loader), and one builds the allow-listed key SET, where order
  // genuinely cannot matter because every row is folded into a set. An assertion that merely counted
  // queries, or that demanded `order by` of all three, would be asserting the wrong thing about the
  // third. What must hold of ALL of them is that none silently drops a qualifying row.
  const productQueries = [...grantQueries("lib/pursuits/federation/derivation.ts"), ...grantQueries("lib/pursuits/federation/batch-facts.ts")];
  const decisionQueries = productQueries.filter((q) => /purpose_code/.test(q) && /retention_class/.test(q));
  const setQueries = productQueries.filter((q) => !decisionQueries.includes(q));
  check("1A · the product reads context_grants in exactly three places: two decision reads, one set read",
    productQueries.length === 3 && decisionQueries.length === 2 && setQueries.length === 1,
    { total: productQueries.length, decision: decisionQueries.length, set: setQueries.length });
  check("1A · NEITHER decision read can return an arbitrary row: both order by id, neither takes a limit",
    decisionQueries.every((q) => /order by id/i.test(q) && !/\blimit\b/i.test(q)),
    decisionQueries.map((q) => ({ ordered: /order by id/i.test(q), limited: /\blimit\b/i.test(q) })));
  check("1A · and the set read takes no limit either — it folds every row into a key set, so ordering it "
    + "would be meaningless but dropping one would not",
    setQueries.every((q) => !/\blimit\b/i.test(q) && !/order\s+by/i.test(q)));

  await clearGrants();
  const narrowFirst = { narrow: await addGrant({ scope: { keys: ["timing"] } }), permitting: await addGrant({ scope: {} }) };
  const mixed = await bothPaths();
  check("1B · the fixture is genuinely multi-grant: two qualifying grants, not one", mixed.qualifying.length === 2, mixed.qualifying.length);
  check("1B · THE BITE — taken one at a time, the qualifying grants disagree: one permits, one refuses",
    mixed.perGrant.some((g) => g.allow) && mixed.perGrant.some((g) => !g.allow),
    mixed.perGrant.map((g) => ({ grant: g.id.slice(0, 8), allow: g.allow })));
  check("1B · so an unordered `limit 1` made the governed answer depend on which row the heap happened to yield",
    new Set(mixed.perGrant.map((g) => g.allow)).size === 2);
  check("1C · under the union rule the product ALLOWS: the permitting grant confers on its own",
    mixed.batched.allow === true && mixed.oneRow.allow === true);
  check("1C · and the narrow grant cannot revoke what the broad one permits", mixed.batched.allow === true);

  const controlPick = await asOrg(VIEWER, async (db) => (await db.query<{ id: string }>(
    HISTORICAL_UNORDERED_LIMIT_1, [SOURCE_ORG, VIEWER, FOREIGN_PURSUIT, PURPOSE, GOV_CLASS, null])).rows);
  check("1D · run against the same world, the historical selector returns ONE row out of the two qualifying",
    controlPick.length === 1 && mixed.qualifying.some((g) => g.id === controlPick[0].id), controlPick.length);
  const controlWouldHave = must("the control row's own verdict", mixed.perGrant.find((g) => g.id === controlPick[0].id));
  note("1D · the row it happened to return, and what the core would have decided from that row alone",
    { grant: controlPick[0].id.slice(0, 8), narrow: controlPick[0].id === narrowFirst.narrow, allow: controlWouldHave.allow });
  note("1D · WHICH row it returns is not asserted, deliberately: an unordered query guarantees nothing, so "
    + "pinning today's heap order would be pinning the defect. What is asserted is that its choice set "
    + "contains a refusal the current rule does not make.");

  // ── first-by-id is a CITATION, not a precedence rule ──────────────────────────────────────────
  console.log("\n=== 1E · FIRST-BY-ID IS DETERMINISTIC DIAGNOSTIC SELECTION, NOT PRECEDENCE");
  await clearGrants();
  const twoPermitting = [await addGrant({ scope: {} }), await addGrant({ scope: {} })].sort();
  const first = await bothPaths();
  const second = await bothPaths();
  check("1E · two independently permitting grants both qualify", first.qualifying.length === 2);
  check("1E · both paths ALLOW and both NAME the same grant", first.oneRow.allow && first.batched.allow
    && first.oneRow.allow && first.batched.allow && first.oneRow.grantId === first.batched.grantId,
    { oneRow: first.oneRow.allow ? first.oneRow.grantId.slice(0, 8) : null, batched: first.batched.allow ? first.batched.grantId.slice(0, 8) : null });
  check("1E · the named grant is the lowest id — deterministic, so an explanation can cite it",
    first.batched.allow && first.batched.grantId === twoPermitting[0], { named: first.batched.allow ? first.batched.grantId.slice(0, 8) : null, lowest: twoPermitting[0].slice(0, 8) });
  check("1E · and it is stable: the same world decided twice names the same grant",
    second.batched.allow && first.batched.allow && second.batched.grantId === first.batched.grantId);
  await asOwner((db) => db.query(`delete from context_grants where id = $1`, [twoPermitting[0]]));
  const afterRemoval = await bothPaths();
  check("1E · NOT PRECEDENCE — removing the named grant changes the citation and not the decision",
    afterRemoval.batched.allow === true && afterRemoval.batched.allow && afterRemoval.batched.grantId === twoPermitting[1],
    { stillAllowed: afterRemoval.batched.allow, nowNamed: afterRemoval.batched.allow ? afterRemoval.batched.grantId.slice(0, 8) : null });

  // ══ 2 · ONE DECISION, TWO FACT LOADERS ═══════════════════════════════════════════════════════
  console.log("\n=== 2 · MIXED GRANTS: THE ONE-ROW LOADER AND THE COHORT LOADER REACH THE SAME DECISION");
  const cases: { label: string; why: string; expect: boolean; setup: () => Promise<unknown> }[] = [
    { label: "one permitting grant only", why: "the ordinary single-grant case", expect: true,
      setup: async () => { await clearGrants(); await addGrant({ scope: {} }); } },
    { label: "one NARROWED grant only", why: "scope.keys narrows THAT grant", expect: false,
      setup: async () => { await clearGrants(); await addGrant({ scope: { keys: ["timing"] } }); } },
    { label: "narrowed + permitting", why: "UNION: the permitting grant confers on its own", expect: true,
      setup: async () => { await clearGrants(); await addGrant({ scope: { keys: ["timing"] } }); await addGrant({ scope: {} }); } },
    { label: "two narrowed grants, neither covering this input", why: "no grant permits it", expect: false,
      setup: async () => { await clearGrants(); await addGrant({ scope: { keys: ["timing"] } }); await addGrant({ scope: { keys: ["route_candidate"] } }); } },
    { label: "live RETAINED + PURSUIT_LIFETIME on a MERGED pursuit", why: "the dead grant cannot revoke the live one", expect: true,
      setup: async () => { await clearGrants(); await addGrant({ retention: "RETAINED" }); await addGrant({ retention: "PURSUIT_LIFETIME", expires: null }); await setMerged(MERGE_TARGET); } },
    { label: "PURSUIT_LIFETIME alone on a MERGED pursuit", why: "its own authority ended", expect: false,
      setup: async () => { await clearGrants(); await addGrant({ retention: "PURSUIT_LIFETIME", expires: null }); } },
    { label: "expired + live", why: "an expired grant is not qualifying; the live one is", expect: true,
      setup: async () => { await setMerged(null); await clearGrants(); await addGrant({ expires: new Date(Date.now() - 60_000) }); await addGrant({ scope: {} }); } },
    { label: "wrong purpose + right purpose", why: "purpose is matched per grant", expect: true,
      setup: async () => { await clearGrants(); await addGrant({ purpose: "CO_SELL_CONTEXT_DISPLAY" }); await addGrant({ scope: {} }); } },
    { label: "wrong class + right class", why: "class is matched per grant", expect: true,
      setup: async () => { await clearGrants(); await addGrant({ classes: ["timing"] }); await addGrant({ scope: {} }); } },
    { label: "revoked + live", why: "a revoked grant is not qualifying", expect: true,
      setup: async () => { await clearGrants(); await addGrant({ status: "revoked" }); await addGrant({ scope: {} }); } },
    { label: "no grant at all", why: "participation is not derivation authority", expect: false,
      setup: async () => { await clearGrants(); } },
  ];
  const outcomes: boolean[] = [];
  for (const c of cases) {
    await c.setup();
    const r = await bothPaths();
    console.log(`\n  ── ${c.label}  (${c.why})`);
    check("both fact loaders reach the SAME decision", sameDecision(r.oneRow, r.batched),
      { oneRow: r.oneRow.allow ? { allow: true, grant: r.oneRow.grantId.slice(0, 8), retention: r.oneRow.retention } : r.oneRow,
        batched: r.batched.allow ? { allow: true, grant: r.batched.grantId.slice(0, 8), retention: r.batched.retention } : r.batched });
    check(`the decision is ${c.expect ? "ALLOW" : "DENY"} under the union rule`, r.batched.allow === c.expect,
      { allow: r.batched.allow, qualifyingGrants: r.qualifying.length });
    outcomes.push(r.batched.allow);
  }
  check("2Z · ANTI-VACUITY — the cases produced both ALLOW and DENY, so the comparison discriminates",
    outcomes.includes(true) && outcomes.includes(false),
    { allow: outcomes.filter(Boolean).length, deny: outcomes.filter((o) => !o).length });

  await clearGrants();
  await setMerged(null);
}

main()
  .then(() => {
    console.log(`\n[dp6-multigrant-verify] ${passed} passed, ${failed} failed`);
    if (failures.length) console.log(failures.map((f) => `  - ${f}`).join("\n"));
    return owner.end();
  })
  .then(() => process.exit(failed === 0 ? 0 : 1))
  .catch(async (e) => {
    console.error("[dp6-multigrant-verify] FATAL", e);
    await owner.end().catch(() => {});
    process.exit(2);
  });
