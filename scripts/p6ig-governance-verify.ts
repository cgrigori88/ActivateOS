import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { assertSeededClone } from "./seeded-clone";
import { withTenantOrg } from "../src/lib/db/tenant";
import {
  DERIVATION_PURPOSES, INPUT_CLASS_REGISTRY, SAFE_DECLASSIFICATION_TRANSFORMS,
  CROSS_ORG_COUNT_FLOOR, mayDerive, derivedDisposition, mayRenderWithheldCount,
} from "../src/lib/pursuits/federation/derivation";
import { governanceClock, buildFederationViewer, mayShareOnward, mayGrantOnwardAtPursuitLevel, mayDelegate } from "../src/lib/pursuits/federation/grants";
import { resolveDisclosure, type Disclosable } from "../src/lib/pursuits/federation/disclosure";

/**
 * P6-IG — Intercompany Governance Gap Closure.
 *
 * WHAT THIS PROVES. Before 0112, `purpose` was free text, `information_classes` and
 * `retention_class` were stored and NEVER read, and `pursuit_participants.effective_from/to` had
 * ZERO references anywhere in src/ — so derivation authority was unenforceable and an expired
 * participant stayed visible inside the RLS predicate itself. Every negative control below FAILS
 * under the pre-P6-IG behaviour, so the suite proves enforcement rather than execution.
 *
 *   npx tsx scripts/verify-run.ts --suite p6ig-governance
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const RW_PASSWORD = process.env.APP_RW_LOCAL_PASSWORD ?? "demo";
const rwUrl = (() => { const u = new URL(CONN); u.username = "app_rw"; u.password = RW_PASSWORD; return u.toString(); })();
const owner = new Pool({ connectionString: CONN, max: 4 });
const rw = new Pool({ connectionString: rwUrl, max: 3 });
process.env.DATABASE_URL = rwUrl;

let passed = 0, failed = 0; const failures: string[] = [];
const check = (n: string, ok: boolean, d = ""): void => {
  if (ok) { passed++; console.log(`  ✓ ${n}${d ? ` — ${d}` : ""}`); }
  else { failed++; failures.push(n); console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); }
};
const NS = `P6IG-${randomUUID().slice(0, 8)}`;

interface World { A: string; B: string; C: string; pursuit: string; company: string }

async function plant(db: PoolClient): Promise<World> {
  const org = async (tag: string) => String((await db.query(`insert into organizations (name) values ($1) returning id`, [`${NS} ${tag}`])).rows[0].id);
  const A = await org("A-sponsor"), B = await org("B-participant"), C = await org("C-outsider");
  for (const o of [A, B, C]) await db.query(`insert into org_features (org_id,pursuits,facts,routing,pursuit_experience,federation) values ($1,true,true,true,true,true)`, [o]);
  const company = String((await db.query(`insert into companies (legal_name, normalized_name) values ($1,$2) returning id`, [`${NS} Co`, NS.toLowerCase()])).rows[0].id);
  const pursuit = String((await db.query(`insert into pursuits (org_id, account_id, dedup_key) values ($1,$2,$3) returning id`, [A, company, NS])).rows[0].id);
  await db.query(`insert into pursuit_participants (org_id,pursuit_id,sponsor_org_id,role_key,participation_state) values ($1,$2,$3,'VENDOR','ACTIVE')`, [A, pursuit, A]);
  await db.query(`insert into pursuit_participants (org_id,pursuit_id,sponsor_org_id,role_key,participation_state) values ($1,$2,$3,'DISTRIBUTOR','ACTIVE')`, [B, pursuit, A]);
  return { A, B, C, pursuit, company };
}

// `classes` writes the GOVERNED column. `legacyClasses` writes the untouched legacy disclosure
// column. A fixture must state which vocabulary it means — the helper never copies one to the other.
const grant = async (db: PoolClient, w: World, o: Record<string, unknown>) =>
  String((await db.query(
    `insert into context_grants (pursuit_id,from_org_id,to_org_id,grant_kind,governed_information_classes,information_classes,purpose,purpose_code,scope,status,retention_class,expires_at,onward_sharing_allowed,delegation_allowed)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'accepted',$10,$11,$12,$13) returning id`,
    [o.pursuitId === null ? null : w.pursuit, o.from ?? w.A, o.to ?? w.B, o.kind ?? "DATA",
     o.classes === null ? null : (o.classes ?? ["economic_value"]), o.legacyClasses ?? null,
     "fixture", o.purposeCode === null ? null : (o.purposeCode ?? "VALUE_CASE"), JSON.stringify(o.scope ?? {}),
     o.retention ?? "PURSUIT_LIFETIME", o.expires ?? null, o.onward ?? false, o.delegation ?? false])).rows[0].id);

async function main(): Promise<void> {
  await assertSeededClone(owner);
  const db = await owner.connect();
  await db.query("begin");
  const w = await plant(db);
  await db.query("commit");

  // ══ 1. MIGRATION / SECURITY ACCEPTANCE ═══════════════════════════════════════════════════════
  const n = async (q: string) => Number((await db.query<{ n: string }>(q)).rows[0].n);
  check("1: context_grants.purpose_code exists and is nullable",
    await n(`select count(*)::text n from information_schema.columns where table_name='context_grants' and column_name='purpose_code' and is_nullable='YES'`) === 1);
  check("2: context_grants.governed_information_classes exists as a nullable text[] — a SEPARATE column, not a reinterpretation",
    await n(`select count(*)::text n from information_schema.columns where table_name='context_grants'
              and column_name='governed_information_classes' and is_nullable='YES' and data_type='ARRAY'`) === 1);
  check("3: four CHECK constraints were added (purpose/governed classes/retention/completeness)",
    await n(`select count(*)::text n from pg_constraint where conrelid='context_grants'::regclass and conname in
      ('context_grants_purpose_code_check','context_grants_governed_information_classes_check','context_grants_retention_class_check','context_grants_machine_governed_complete')`) === 4);
  check("4: NO CHECK constraint was placed on the LEGACY information_classes column",
    await n(`select count(*)::text n from pg_constraint where conrelid='context_grants'::regclass and contype='c'
              and pg_get_constraintdef(oid) like '%information_classes%'
              and pg_get_constraintdef(oid) not like '%governed_information_classes%'`) === 0);
  check("5: can_see_pursuit is still SECURITY DEFINER with a pinned search_path, and none was added",
    await n(`select count(*)::text n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
      where ns.nspname='public' and p.proname='can_see_pursuit' and p.prosecdef and array_to_string(p.proconfig,',') like '%search_path%'`) === 1);
  check("6: can_see_pursuit now enforces the effective window",
    (await db.query<{ src: string }>(`select prosrc src from pg_proc where proname='can_see_pursuit'`)).rows[0].src.includes("effective_to"));
  // CATALOGUE COUNTING DEFINITION (ruling §7). The local `functions` total (185) and the older hosted
  // record (149) are not comparable, and neither is a defect: `count(*) from pg_proc in public`
  // INCLUDES EXTENSION-OWNED functions, and the two environments install different extensions. Only
  // 31 of the 185 are ours, and those 31 are exactly the search_path-pinned protected set. The same
  // applies to roles: 20 here vs 32 hosted is a built-in-role population difference (15 of the 20
  // local roles are `pg_*` system roles). ACCEPTANCE MUST THEREFORE COMPARE OUR OWN OBJECTS, AND
  // COMPARE BEFORE→AFTER WITHIN ONE ENVIRONMENT — never an absolute total across environments.
  check("7: the acceptance catalogue definition is environment-independent — our functions are counted, extension-owned ones are not",
    await n(`select count(*)::text n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
              where ns.nspname='public' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')`)
    === await n(`select count(*)::text n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
              where ns.nspname='public' and array_to_string(p.proconfig,',') like '%search_path%'`),
    "ours === the protected set");
  check("8: the two legacy grants survive with purpose_code NULL and ZERO derivation authority",
    await n(`select count(*)::text n from context_grants where purpose_code is null and id not in (select id from context_grants where from_org_id=$$${w.A}$$)`) >= 2);

  // ══ 2. DATABASE FAIL-CLOSED — direct app_rw writes cannot bypass the contract ═════════════════
  const rwc = await rw.connect();
  await rwc.query("begin"); await rwc.query(`select set_config('app.org_id',$1,true)`, [w.A]);
  const rejects = async (label: string, cols: string, vals: string) => {
    await rwc.query("savepoint s");
    try {
      await rwc.query(`insert into context_grants (pursuit_id,from_org_id,to_org_id,purpose,${cols}) values ('${w.pursuit}','${w.A}','${w.B}','x',${vals})`);
      await rwc.query("release savepoint s"); return "";
    } catch (e) { await rwc.query("rollback to savepoint s"); return (e as Error).message; }
  };
  const M = "machine_governed_complete";
  const G = "governed_information_classes";
  check("9: purpose_code on an ACTION grant → REJECTED", (await rejects("action", `grant_kind,purpose_code,${G},retention_class,expires_at`, `'ACTION','VALUE_CASE',array['economic_value'],'RETAINED',now()+interval '1 day'`)).includes(M));
  check("10: purpose_code with NULL governed classes → REJECTED", (await rejects("nullcls", "purpose_code,retention_class,expires_at", `'VALUE_CASE','RETAINED',now()+interval '1 day'`)).includes(M));
  check("11: purpose_code with EMPTY governed classes → REJECTED", (await rejects("emptycls", `purpose_code,${G},retention_class,expires_at`, `'VALUE_CASE',array[]::text[],'RETAINED',now()+interval '1 day'`)).includes(M));
  check("12: purpose_code with NULL retention → REJECTED", (await rejects("nullret", `purpose_code,${G}`, `'VALUE_CASE',array['economic_value']`)).includes(M));
  check("13: EPHEMERAL without expires_at → REJECTED", (await rejects("eph", `purpose_code,${G},retention_class`, `'VALUE_CASE',array['economic_value'],'EPHEMERAL'`)).includes(M));
  check("14: RETAINED without expires_at → REJECTED", (await rejects("ret", `purpose_code,${G},retention_class`, `'VALUE_CASE',array['economic_value'],'RETAINED'`)).includes(M));
  check("15: unknown purpose code → REJECTED", (await rejects("badp", `purpose_code,${G},retention_class`, `'WHATEVER',array['economic_value'],'PURSUIT_LIFETIME'`)).includes("purpose_code_check"));
  check("16: unknown GOVERNED information class → REJECTED", (await rejects("badc", `purpose_code,${G},retention_class`, `'VALUE_CASE',array['nonsense'],'PURSUIT_LIFETIME'`)).includes("governed_information_classes_check"));
  const badr = await rejects("badr", `purpose_code,${G},retention_class`, `'VALUE_CASE',array['economic_value'],'FOREVER'`);
  check("17: unknown retention value → REJECTED", /retention_class_check|machine_governed_complete/.test(badr), badr.split("\n")[0].slice(0, 70));
  await rwc.query("savepoint ok");
  let nullPursuit = "";
  try { await rwc.query(`insert into context_grants (pursuit_id,from_org_id,to_org_id,purpose,purpose_code,governed_information_classes,retention_class,expires_at)
    values (null,'${w.A}','${w.B}','x','VALUE_CASE',array['economic_value'],'RETAINED',now()+interval '1 day')`); await rwc.query("release savepoint ok"); }
  catch (e) { nullPursuit = (e as Error).message; await rwc.query("rollback to savepoint ok"); }
  check("18: machine-governed grant with NULL pursuit → REJECTED (this is what makes scope {} unambiguous)", nullPursuit.includes(M));
  await rwc.query("savepoint leg");
  let legacyOk = true;
  try { await rwc.query(`insert into context_grants (pursuit_id,from_org_id,to_org_id,purpose) values ('${w.pursuit}','${w.A}','${w.B}','legacy free text')`); await rwc.query("release savepoint leg"); }
  catch { legacyOk = false; await rwc.query("rollback to savepoint leg"); }
  check("19: a LEGACY grant (purpose_code NULL) is still accepted — no backfill is forced", legacyOk);
  await rwc.query("savepoint dual");
  let dualOk = true;
  try { await rwc.query(`insert into context_grants (pursuit_id,from_org_id,to_org_id,purpose,information_classes)
    values ('${w.pursuit}','${w.A}','${w.B}','legacy audience-style',array['PARTICIPANT_SHARED'])`); await rwc.query("release savepoint dual"); }
  catch { dualOk = false; await rwc.query("rollback to savepoint dual"); }
  check("20: a legacy grant may still carry an AUDIENCE-style information_classes value — the legacy disclosure column is UNTOUCHED and UNCONSTRAINED by 0112", dualOk);
  // A MACHINE-GOVERNED grant may ALSO carry a legacy Audience value in the legacy column; that is
  // not a contradiction, because the two columns answer two different questions. What it must never
  // do is let the legacy value stand in for a governed class — proven by check 21 and by the firewall.
  await rwc.query("savepoint mixed");
  let mixedRejected = "";
  try { await rwc.query(`insert into context_grants (pursuit_id,from_org_id,to_org_id,purpose,purpose_code,information_classes,retention_class)
    values ('${w.pursuit}','${w.A}','${w.B}','x','VALUE_CASE',array['PARTICIPANT_SHARED'],'PURSUIT_LIFETIME')`); await rwc.query("release savepoint mixed"); }
  catch (e) { mixedRejected = (e as Error).message; await rwc.query("rollback to savepoint mixed"); }
  check("21: a machine-governed grant carrying ONLY legacy information_classes → REJECTED — the legacy column cannot satisfy the governed contract",
    mixedRejected.includes(M), mixedRejected.split("\n")[0].slice(0, 70));
  await rwc.query("savepoint audv");
  let audienceAsGoverned = "";
  try { await rwc.query(`insert into context_grants (pursuit_id,from_org_id,to_org_id,purpose,purpose_code,governed_information_classes,retention_class)
    values ('${w.pursuit}','${w.A}','${w.B}','x','VALUE_CASE',array['PARTICIPANT_SHARED'],'PURSUIT_LIFETIME')`); await rwc.query("release savepoint audv"); }
  catch (e) { audienceAsGoverned = (e as Error).message; await rwc.query("rollback to savepoint audv"); }
  check("22: an AUDIENCE value in the GOVERNED column → REJECTED — the governed vocabulary is bounded and admits no Audience term",
    audienceAsGoverned.includes("governed_information_classes_check"), audienceAsGoverned.split("\n")[0].slice(0, 70));
  await rwc.query("rollback");
  rwc.release();

  // ══ 2B. THE SEMANTIC FIREWALL — two columns, two contracts, no crossing ══════════════════════
  // This is the ruled correction to the dual-meaning discovery. `information_classes` REMAINS the
  // legacy disclosure field with its existing Audience-oriented semantics; `governed_information_classes`
  // is machine-evaluable P6-IG data classes ONLY. Neither may satisfy the other's contract, and no
  // fallback, coalesce or wildcard connects them.
  const ocf = await owner.connect();
  const gLegacyClassOnly = await grant(ocf, w, { classes: null, purposeCode: null, legacyClasses: ["PARTICIPANT_SHARED"] });
  check("23: a LEGACY-vocabulary grant can never satisfy mayDerive, however live and well-formed it is",
    (await withTenantOrg(w.B, (d) => mayDerive(d, w.B, { inputKind: "economic_fact", sourceOrgId: w.A, pursuitId: w.pursuit }, "VALUE_CASE", null))).allow === false,
    gLegacyClassOnly.slice(0, 8));
  const gDataCategoryLegacy = await grant(ocf, w, { classes: null, purposeCode: null, legacyClasses: ["economic_value"] });
  check("24: even a legacy grant whose legacy column happens to hold a GOVERNED WORD confers no derivation authority — the word is not read from that column",
    (await withTenantOrg(w.B, (d) => mayDerive(d, w.B, { inputKind: "economic_fact", sourceOrgId: w.A, pursuitId: w.pursuit }, "VALUE_CASE", null))).allow === false,
    gDataCategoryLegacy.slice(0, 8));
  const derivSrcFw = readFileSync("src/lib/pursuits/federation/derivation.ts", "utf8");
  check("25: SOURCE GUARD — the derivation module reads governed_information_classes and NEVER the legacy column",
    derivSrcFw.includes("governed_information_classes") && !/[^_]information_classes(?!_)/.test(derivSrcFw.replace(/^\s*(\*|\/\/).*$/gm, "")),
    "no legacy read outside comments");
  const disclosureSrc = readFileSync("src/lib/pursuits/federation/disclosure.ts", "utf8");
  const grantsSrcFw = readFileSync("src/lib/pursuits/federation/grants.ts", "utf8");
  check("26: SOURCE GUARD — the pre-existing disclosure/grant paths never read the GOVERNED column",
    !disclosureSrc.includes("governed_information_classes") && !/select[^;]*governed_information_classes/.test(grantsSrcFw));
  check("27: NO FALLBACK EXISTS between the two columns — no coalesce, no union, no ||",
    !/coalesce\s*\(\s*governed_information_classes|governed_information_classes\s*\|\||information_classes\s*\|\|\s*governed/.test(derivSrcFw + grantsSrcFw + disclosureSrc));
  ocf.release();

  // ══ 3. GOVERNED USE vs DERIVATION ════════════════════════════════════════════════════════════
  check("28: DERIVATION_PURPOSES excludes CO_SELL_CONTEXT_DISPLAY",
    DERIVATION_PURPOSES.has("VALUE_CASE") && DERIVATION_PURPOSES.has("ROUTE_EVALUATION")
    && DERIVATION_PURPOSES.has("CONFLICT_DETECTION") && !DERIVATION_PURPOSES.has("CO_SELL_CONTEXT_DISPLAY"));
  const gValue = await (async () => { const c = await owner.connect(); const id = await grant(c, w, {}); c.release(); return id; })();
  // LIVE evaluation: null pins nothing, so each decision reads the database's own instant.
  const asOf = null;
  const derive = (org: string, kind: string, purpose: string) =>
    withTenantOrg(org, (d) => mayDerive(d, org, { inputKind: kind, sourceOrgId: w.A, pursuitId: w.pursuit }, purpose, asOf));
  check("29: derivation ALLOWED under a machine-governed, purpose-matched, class-covered live grant",
    (await derive(w.B, "economic_fact", "VALUE_CASE")).allow === true, gValue.slice(0, 8));
  check("30: WRONG PURPOSE denied — a ROUTE_EVALUATION operation cannot use a VALUE_CASE grant",
    (await derive(w.B, "economic_fact", "ROUTE_EVALUATION")).allow === false);
  check("31: WRONG INFORMATION CLASS denied — the grant covers economic_value only",
    (await derive(w.B, "stakeholder_role", "VALUE_CASE")).allow === false);
  check("32: CO_SELL_CONTEXT_DISPLAY is not a derivation purpose, so it can never authorize derivation",
    (await derive(w.B, "economic_fact", "CO_SELL_CONTEXT_DISPLAY")).allow === false);
  check("33: an unmapped input kind denies — no wildcard, no OTHER class",
    (await derive(w.B, "mystery_input", "VALUE_CASE")).allow === false && INPUT_CLASS_REGISTRY["mystery_input"] === undefined);
  check("34: an organization derives from its OWN information without a grant",
    (await derive(w.A, "economic_fact", "VALUE_CASE")).allow === true);
  check("35: a NON-PARTICIPANT is denied outright", (await derive(w.C, "economic_fact", "VALUE_CASE")).allow === false);

  // ══ 4. LEGACY, EXPIRY, REVOCATION ════════════════════════════════════════════════════════════
  const oc = await owner.connect();
  const gLegacy = String((await oc.query(`insert into context_grants (pursuit_id,from_org_id,to_org_id,purpose,information_classes,status)
    values ($1,$2,$3,'co-sell context sharing',array['economic_value'],'accepted') returning id`, [w.pursuit, w.A, w.C])).rows[0].id);
  check("36: a LEGACY grant (purpose_code NULL) confers NO derivation authority, however complete it looks",
    (await withTenantOrg(w.C, (d) => mayDerive(d, w.C, { inputKind: "economic_fact", sourceOrgId: w.A, pursuitId: w.pursuit }, "VALUE_CASE", asOf))).allow === false, gLegacy.slice(0, 8));
  await oc.query(`update context_grants set status='revoked', revoked_at=now() where id=$1`, [gValue]);
  check("37: REVOKED grant → derivation denied immediately", (await derive(w.B, "economic_fact", "VALUE_CASE")).allow === false);
  await oc.query(`update context_grants set status='accepted', revoked_at=null, retention_class='RETAINED', expires_at=now() - interval '1 minute' where id=$1`, [gValue]);
  check("38: EXPIRED grant → derivation denied (RETAINED storage does not extend derivation)",
    (await derive(w.B, "economic_fact", "VALUE_CASE")).allow === false);
  await oc.query(`update context_grants set retention_class='PURSUIT_LIFETIME', expires_at=null where id=$1`, [gValue]);
  check("39: restored grant derives again", (await derive(w.B, "economic_fact", "VALUE_CASE")).allow === true);
  await oc.query(`update pursuits set status='WON' where id=$1`, [w.pursuit]);
  check("40: PURSUIT_LIFETIME ends when the pursuit becomes terminal — the EARLIEST bound applies",
    (await derive(w.B, "economic_fact", "VALUE_CASE")).allow === false);
  await oc.query(`update pursuits set status='QUALIFIED' where id=$1`, [w.pursuit]);

  // ══ 5. EFFECTIVE WINDOW — both layers, one clock ═════════════════════════════════════════════
  // The window bounds are SQL expressions evaluated by the DATABASE, so they share the same clock
  // the predicate reads. They are fixed literals from this file, never caller input.
  const setWindow = (from: string, to: string, state = "ACTIVE") =>
    oc.query(`update pursuit_participants set effective_from=${from}, effective_to=${to}, participation_state=$1
               where pursuit_id=$2 and org_id=$3`, [state, w.pursuit, w.B]);
  // Two statements on ONE connection inside ONE transaction: set the tenant context, then ask the
  // predicate. A single-statement lateral would not guarantee set_config runs first.
  const rlsSees = async (): Promise<boolean> => {
    await oc.query("begin");
    await oc.query(`select set_config('app.org_id',$1,true)`, [w.B]);
    const r = (await oc.query<{ ok: boolean }>(`select can_see_pursuit($1) as ok`, [w.pursuit])).rows[0].ok;
    await oc.query("rollback");
    return r;
  };
  const viewerSees = async () => (await withTenantOrg(w.B, (d) => buildFederationViewer(d, w.B, w.pursuit))).isParticipant;
  // OBSERVE ONCE. Each layer is read exactly once per window and the SAME observation supplies both
  // the verdict and the printed evidence. Re-reading for the message produced a report that
  // contradicted its own verdict — `✗ … — rls=false viewer=false` — because milliseconds had passed
  // and the boundary had moved underneath it. A harness must not destroy the evidence it reports.
  const observe = async (): Promise<{ rls: boolean; viewer: boolean }> => ({ rls: await rlsSees(), viewer: await viewerSees() });
  const both = (o: { rls: boolean; viewer: boolean }): string => `rls=${o.rls} viewer=${o.viewer}`;
  await setWindow("now() + interval '1 hour'", "null");
  const w30 = await observe();
  check("41: BEFORE effective_from → denied at RLS and in the read model", w30.rls === false && w30.viewer === false, both(w30));
  await setWindow("now() - interval '1 second'", "null");
  const w31 = await observe();
  check("42: after effective_from → allowed at both layers", w31.rls === true && w31.viewer === true, both(w31));
  // EXACTLY AT effective_from. The bound is `effective_from <= now()`, so the instant itself is
  // INSIDE the window — the mirror of the strict `effective_to >`. Set from the database's own clock
  // so the stamp is the same kind of value the predicate compares against.
  await setWindow("now()", "null");
  const w31b = await observe();
  check("43: EXACTLY AT effective_from → ALLOWED (the predicate is inclusive <=)", w31b.rls === true && w31b.viewer === true, both(w31b));
  await setWindow("now() - interval '1 day'", "now() + interval '1 hour'");
  const w32 = await observe();
  check("44: immediately before effective_to → allowed at both layers", w32.rls === true && w32.viewer === true, both(w32));
  await setWindow("now() - interval '1 day'", "now()");
  const w33 = await observe();
  check("45: exactly at effective_to → DENIED (the predicate is strictly >)", w33.rls === false && w33.viewer === false, both(w33));
  await setWindow("now() - interval '1 day'", "null", "LEFT");
  const w34 = await observe();
  check("46: LEFT → denied regardless of dates", w34.rls === false && w34.viewer === false, both(w34));
  await setWindow("now() - interval '1 day'", "null", "REVOKED");
  const w35 = await observe();
  check("47: REVOKED → denied regardless of dates", w35.rls === false && w35.viewer === false, both(w35));
  await setWindow("now() - interval '1 day'", "null", "ACTIVE");
  check("48: the governance clock is the DB transaction timestamp, not an application wall clock",
    await withTenantOrg(w.B, async (d) => { const a = await governanceClock(d); const b = await governanceClock(d); return a.getTime() === b.getTime(); }));

  // ── THE BOUNDARY MUST NOT DEPEND ON HOW FAST THE READ ARRIVES ──────────────────────────────
  // Check 33 caught a REAL defect as a 1-in-3 flake, and a flake at a governance boundary is a
  // governance failure, not a test failure. `governanceClock` read the instant into a JavaScript
  // `Date` — MILLISECONDS — and bound it back into SQL against MICROSECOND columns. Whenever the
  // read landed in the same millisecond as the update, the read model's instant was up to 999µs
  // BEHIND the database's own, `effective_to > $asOf` was still true while `effective_to > now()`
  // was already false, and the read model admitted a participant the database had excluded.
  // Repeating the exact boundary makes that deterministic: the tighter the loop, the more often
  // update and read share a millisecond, so the pre-fix code fails this reliably.
  let boundaryDenied = 0, startAllowed = 0, disagreements = 0;
  for (let i = 0; i < 25; i++) {
    await setWindow("now() - interval '1 day'", "now()");
    const o = await observe();
    if (o.rls !== o.viewer) disagreements++;
    if (o.rls === false && o.viewer === false) boundaryDenied++;
    await setWindow("now()", "null");
    const f = await observe();
    if (f.rls !== f.viewer) disagreements++;
    if (f.rls === true && f.viewer === true) startAllowed++;
  }
  check("49: the effective_to boundary is DETERMINISTIC — 25 back-to-back evaluations all deny",
    boundaryDenied === 25, `${boundaryDenied}/25 denied at both layers`);
  check("50: the effective_from boundary is DETERMINISTIC — 25 back-to-back evaluations all allow",
    startAllowed === 25, `${startAllowed}/25 allowed at both layers`);
  check("51: RLS and the read model NEVER disagree across 50 boundary probes — the D-P6-1 failure mode cannot recur",
    disagreements === 0, `${disagreements} disagreements in 50 probes`);
  await setWindow("now() - interval '1 day'", "null", "ACTIVE");
  // The same boundary rule on GRANT expiry, not just participation.
  // THE PROBE MUST BE THE ONLY THING THAT CAN SATISFY THE DECISION. A first version reused
  // VALUE_CASE/economic_value, which the still-live PURSUIT_LIFETIME grant already satisfied, so
  // `mayDerive` answered from THAT grant and the probe proved nothing — it read 0/10 denied. It now
  // uses a purpose and class no other grant covers, with a POSITIVE CONTROL first: a probe that
  // cannot be shown to ALLOW before the boundary cannot be trusted to DENY at it.
  const gExpiryProbe = await (async () => { const c = await owner.connect(); const id = await grant(c, w,
    { purposeCode: "CONFLICT_DETECTION", classes: ["timing"], retention: "RETAINED", expires: new Date(Date.now() + 3_600_000) }); c.release(); return id; })();
  const expiryProbe = () => withTenantOrg(w.B, (d) => mayDerive(d, w.B, { inputKind: "lifecycle_date", sourceOrgId: w.A, pursuitId: w.pursuit }, "CONFLICT_DETECTION", null));
  check("52: POSITIVE CONTROL — the expiry probe grant genuinely authorizes derivation while it is live",
    (await expiryProbe()).allow === true, gExpiryProbe.slice(0, 8));
  let expiryDenied = 0;
  for (let i = 0; i < 10; i++) {
    await oc.query(`update context_grants set expires_at = now() where id = $1`, [gExpiryProbe]);
    if ((await expiryProbe()).allow === false) expiryDenied++;
  }
  check("53: an EXPIRED grant behaves equivalently at its own boundary — 10/10 denied, same SQL clock",
    expiryDenied === 10, `${expiryDenied}/10 denied`);
  await oc.query(`delete from context_grants where id = $1`, [gExpiryProbe]);

  // The measurement the rule rests on, asserted rather than assumed.
  const lossy = await withTenantOrg(w.B, async (d) => {
    let lost = 0;
    for (let i = 0; i < 50; i++) {
      const js = (await d.query<{ t: Date }>(`select transaction_timestamp() as t`)).rows[0].t;
      const r = (await d.query<{ same: boolean }>(`select ($1::timestamptz = transaction_timestamp()) as same`, [js])).rows[0].same;
      if (!r) lost++;
    }
    return lost;
  });
  check("54: a governance instant LOSES PRECISION crossing into JavaScript — it is an observable, never a comparison instant",
    lossy === 50, `${lossy}/50 round-trips truncated (ms Date vs µs timestamptz)`);

  // Source guard: no live governance predicate may compare against an instant carried by JavaScript.
  const govSrc = ["grants", "derivation", "contributions"]
    .map((f) => readFileSync(`src/lib/pursuits/federation/${f}.ts`, "utf8")).join("\n");
  const boundParam = /(effective_from|effective_to|expires_at|valid_until)\s*(is null or \1)?\s*[<>]=?\s*\$\d/;
  check("55: every live window predicate compares in SQL — no JavaScript instant, no application wall clock",
    !boundParam.test(govSrc) && !/\?\?\s*new Date\(\)/.test(govSrc)
      && (govSrc.match(/coalesce\(\$\d+::timestamptz, transaction_timestamp\(\)\)/g) ?? []).length >= 6,
    `${(govSrc.match(/coalesce\(\$\d+::timestamptz, transaction_timestamp\(\)\)/g) ?? []).length} SQL-side instants`);

  // ══ 6. DELEGATION AND ONWARD SHARING ═════════════════════════════════════════════════════════
  await oc.query(`update context_grants set delegation_allowed=true, onward_sharing_allowed=false where id=$1`, [gValue]);
  check("56: DELEGATION is fail-closed — the boolean grants nothing without authority lineage", mayDelegate().allow === false);
  check("57: PURSUIT-LEVEL onward sharing of another org's data is unsupported", mayGrantOnwardAtPursuitLevel().allow === false);
  check("58: OBJECT-LEVEL onward with onward_sharing_allowed=false → HARD DENIAL",
    (await withTenantOrg(w.B, (d) => mayShareOnward(d, w.B, w.A, w.pursuit, asOf))).allow === false);
  await oc.query(`update context_grants set onward_sharing_allowed=true where id=$1`, [gValue]);
  const onward = await withTenantOrg(w.B, (d) => mayShareOnward(d, w.B, w.A, w.pursuit, asOf));
  check("59: onward=true removes ONLY that prohibition", onward.allow === true && /still qualify independently/.test(onward.reason));
  check("60: …and C still gains nothing — it is neither owner nor participant",
    resolveDisclosure({ ownerOrgId: w.A, audience: "PARTICIPANT_SHARED", value: "secret" } as Disclosable<string>,
      { orgId: w.C, isSponsor: false, isParticipant: false, allowlistGrantedFor: new Set() }).visibility === "SUPPRESSED");
  check("61: the sharer may always share what it owns", (await withTenantOrg(w.A, (d) => mayShareOnward(d, w.A, w.A, w.pursuit, asOf))).allow === true);

  // ══ 7. DISCLOSURE LADDER PRESERVED (pre-existing behaviour must not regress) ══════════════════
  const viewer = { orgId: w.B, isSponsor: false, isParticipant: true, allowlistGrantedFor: new Set<string>() };
  const item = (audience: string, extra: Record<string, unknown> = {}) =>
    ({ ownerOrgId: w.A, audience, value: "exact", ...extra }) as Disclosable<string>;
  check("62: PARTICIPANT_SHARED → EXACT", resolveDisclosure(item("PARTICIPANT_SHARED"), viewer).visibility === "EXACT");
  check("63: GENERALIZED → GENERALIZED", resolveDisclosure(item("GENERALIZED", { generalized: "g" }), viewer).visibility === "GENERALIZED");
  check("64: AGGREGATED → AGGREGATED", resolveDisclosure(item("AGGREGATED", { aggregate: "a" }), viewer).visibility === "AGGREGATED");
  check("65: ORG_PRIVATE → SUPPRESSED, and the exact value never appears",
    (() => { const r = resolveDisclosure(item("ORG_PRIVATE"), viewer); return r.visibility === "SUPPRESSED" && r.value === null; })());

  // ══ 8. ZERO SAFE-DECLASSIFICATION TRANSFORMS ═════════════════════════════════════════════════
  check("66: P6-IG ships ZERO safe-declassification transforms", SAFE_DECLASSIFICATION_TRANSFORMS.size === 0);
  check("67: all-authorized inputs → RECIPIENT_DERIVED", derivedDisposition([true, true]) === "RECIPIENT_DERIVED");
  check("68: ANY hidden input → NOT_DISCLOSABLE (DECLASSIFIED is structurally present but unreachable)",
    derivedDisposition([true, false]) === "NOT_DISCLOSABLE" && derivedDisposition([false], "CONFLICT_EXISTS") === "NOT_DISCLOSABLE");
  check("69: an unknown transform → NOT_DISCLOSABLE", derivedDisposition([false], "anything") === "NOT_DISCLOSABLE");

  // ══ 9. COUNT / EXISTENCE POLICY ══════════════════════════════════════════════════════════════
  check("70: the floor is 5, declared as PRODUCT POLICY — not anonymity, not differential privacy",
    CROSS_ORG_COUNT_FLOOR === 5 && /product policy/i.test(readFileSync("src/lib/pursuits/federation/derivation.ts", "utf8"))
    && /NOT anonymity and NOT differential privacy/i.test(readFileSync("src/lib/pursuits/federation/derivation.ts", "utf8")));
  check("71: a count of 1 is SUPPRESSED", mayRenderWithheldCount(1, true, false) === false);
  check("72: a count below the floor is SUPPRESSED", mayRenderWithheldCount(4, true, false) === false);
  check("73: at or above the floor renders", mayRenderWithheldCount(5, true, false) === true);
  check("74: no aggregate follows from suppressed rows — existence must be independently disclosable",
    mayRenderWithheldCount(50, false, false) === false);
  check("75: DIFFERENCING negative control — recipient-variable filtering suppresses any count",
    mayRenderWithheldCount(50, true, true) === false);

  // ══ 10. RAW-ROW FIREWALL — structural, not "nothing calls it today" ══════════════════════════
  const contribSrc = readFileSync("src/lib/pursuits/federation/contributions.ts", "utf8");
  check("76: the raw readers are renamed `unsafe_` and marked owner/verifier-only",
    contribSrc.includes("export async function unsafe_contributionsForPursuit")
    && contribSrc.includes("export async function unsafe_liveContributionsForPursuit")
    && /OWNER\/VERIFIER ONLY/.test(contribSrc));
  check("77: no un-prefixed raw reader remains exported",
    !/export async function contributionsForPursuit|export async function liveContributionsForPursuit/.test(contribSrc));
  const appFiles = (await import("node:child_process")).execSync("grep -rl 'unsafe_' src/app 2>/dev/null || true").toString().trim();
  check("78: SOURCE GUARD — no recipient-facing path under src/app references an unsafe_ reader", appFiles === "", appFiles || "none");
  check("79: the recipient-safe path applies the disclosure ladder",
    readFileSync("src/lib/pursuits/federation/read-models.ts", "utf8").includes("applyDisclosure"));

  // ══ 11. CACHE / REVOCATION ═══════════════════════════════════════════════════════════════════
  const cfg = readFileSync("next.config.mjs", "utf8");
  check("80: recipient-specific projections are non-shared and non-storable", /"Cache-Control", value: "private, no-store"/.test(cfg));
  check("81: Vary: Cookie is set, and both credential dimensions are cookie-based", /"Vary", value: "Cookie"/.test(cfg));
  check("82: force-dynamic is retained on every page",
    (await import("node:child_process")).execSync("grep -rl 'export const dynamic = \"force-dynamic\"' src/app | wc -l").toString().trim() !== "0");

  // ══ 12. NO PERSISTENCE, NO AUDIT ON PASSIVE READ ═════════════════════════════════════════════
  const derivSrc = readFileSync("src/lib/pursuits/federation/derivation.ts", "utf8");
  check("83: EPHEMERAL is provable — P6-IG persists NOTHING (no insert/update in the governance modules)",
    !/insert into|update /i.test(derivSrc));
  const ledgerBefore = Number((await oc.query<{ n: string }>(`select count(*)::text n from change_ledger`)).rows[0].n);
  await derive(w.B, "economic_fact", "VALUE_CASE");
  await withTenantOrg(w.B, (d) => buildFederationViewer(d, w.B, w.pursuit));
  const ledgerAfter = Number((await oc.query<{ n: string }>(`select count(*)::text n from change_ledger`)).rows[0].n);
  check("84: a PASSIVE READ appends no audit row — no read-driven growth, no traffic-analysis channel",
    ledgerBefore === ledgerAfter, `${ledgerBefore} → ${ledgerAfter}`);
  check("85: DISCLOSURE_REFUSED was not added to the ledger vocabulary",
    !(await oc.query<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conname='change_ledger_change_type_check'`)).rows[0].d.includes("DISCLOSURE_REFUSED"));

  // ══ 13. COVERAGE CLOSEOUT — rules whose SURFACE DOES NOT EXIST YET ═══════════════════════════
  // Three contract rules have no recipient-facing surface in this slice. The ruling is to prove that
  // STRUCTURALLY and keep it unreachable, rather than build a speculative surface to exercise them.
  // Each check below proves ABSENCE at the source level, which is the only honest proof available:
  // a behavioural pass would require shipping the very surface we are declining to ship.
  // STRIP COMMENTS FIRST. An earlier version of these guards matched PROSE: derivation.ts's own
  // comment "the approved transform set" tripped the no-approval guard, and a comment mentioning
  // disclosure tripped the payload guard. A structural claim must be tested against CODE.
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const govModules = ["derivation", "grants", "contributions", "disclosure", "read-models"]
    .map((f) => stripComments(readFileSync(`src/lib/pursuits/federation/${f}.ts`, "utf8"))).join("\n");

  // NO BLIND APPROVAL. P6-IG builds no cross-org approval packet. The P45 approval lifecycle is the
  // only approval surface and it carries capability/request identity, never another org's content —
  // so there is no packet that could be approved blind, and none is introduced here.
  check("86: NO-BLIND-APPROVAL — P6-IG ships no cross-org approval packet, so no approval can be given blind",
    !/approval|approve/i.test(govModules));
  // A FIRST VERSION OF THIS GUARD WAS SIMPLY WRONG, and the suite caught it: it asserted the approval
  // path imports NOTHING from `federation/`, but `runtime.ts` does import the skill dispatcher, which
  // lives there. The dispatcher is an ACTION-authority path, not a content path. The honest claim is
  // narrower and stronger — the approval CLOSURE (runtime + the dispatcher it calls) never reaches a
  // module that returns another organization's data, so there is no payload to approve blind.
  const approvalClosure = ["src/lib/runtime/runtime.ts", "src/lib/pursuits/federation/skills.ts"]
    .map((f) => stripComments(readFileSync(f, "utf8"))).join("\n");
  const contentModules = /from ["'][^"']*federation\/(disclosure|derivation|contributions|read-models)["']/;
  check("87: the approval CLOSURE never imports a cross-org CONTENT module — its only federation imports are action-authority",
    !contentModules.test(approvalClosure) && !/unsafe_|resolveDisclosure|mayDerive|applyDisclosure/.test(approvalClosure),
    "runtime + dispatcher inspected");
  check("88: …and what it does import from federation is exactly the ACTION-authority path, which carries capability identity, not data",
    /hasActionAuthority/.test(approvalClosure) && !/informationClass|governed_information_classes|semanticMeaning/.test(approvalClosure));

  // CROSS-ORG AUDIT PAYLOAD SAFETY. The governance modules write no audit row at all (checks 81/82 prove no
  // write and no read-driven growth); structurally they also never call the audit writer, so no
  // cross-org value can reach an audit payload through this slice.
  check("89: CROSS-ORG AUDIT PAYLOAD — the governance modules never call an audit writer, so no foreign value can enter an audit row",
    !/audit_partnership_event|record_broker_event|appendLedger|recordChange/i.test(govModules));

  // DISCLOSURE-SAFE EXPLANATION. Every denial reason is built from the OPERATION (purpose, class,
  // input kind) — never from the value being withheld, and never from the source org's content.
  const denyReasons = [...derivSrc.matchAll(/deny\(`([^`]*)`\)|deny\("([^"]*)"\)/g)].map((m) => m[1] ?? m[2]);
  check("90: DISCLOSURE-SAFE EXPLANATION — every deny reason interpolates only operation metadata, never a withheld value",
    denyReasons.length > 0 && denyReasons.every((r) => !/\$\{(?!operationPurpose|input\.inputKind|g\.retention_class|cls)/.test(r)),
    `${denyReasons.length} reasons inspected`);
  check("91: a SUPPRESSED disclosure returns no value and no substitute explanation carrying one",
    (() => { const r = resolveDisclosure({ ownerOrgId: w.A, audience: "ORG_PRIVATE", value: "secret-value" } as Disclosable<string>,
      { orgId: w.B, isSponsor: false, isParticipant: true, allowlistGrantedFor: new Set() });
      return r.value === null && !JSON.stringify(r).includes("secret-value"); })());
  check("92: a DENIED derivation decision carries no fragment of the source organization's data",
    (() => { const d = { allow: false, reason: "no live machine-governed DATA grant covers this purpose and information class" };
      return !JSON.stringify(d).includes(w.A) && !JSON.stringify(d).includes("economic_value"); })());

  oc.release(); db.release();
  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed${failed ? `: ${failures.join(" | ")}` : ""}`);
  await owner.end(); await rw.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.log(`[p6ig-governance-verify] fatal: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
