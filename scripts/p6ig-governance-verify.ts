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

const grant = async (db: PoolClient, w: World, o: Record<string, unknown>) =>
  String((await db.query(
    `insert into context_grants (pursuit_id,from_org_id,to_org_id,grant_kind,information_classes,purpose,purpose_code,scope,status,retention_class,expires_at,onward_sharing_allowed,delegation_allowed)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'accepted',$9,$10,$11,$12) returning id`,
    [o.pursuitId === null ? null : w.pursuit, o.from ?? w.A, o.to ?? w.B, o.kind ?? "DATA",
     o.classes ?? ["economic_value"], "fixture", o.purposeCode ?? "VALUE_CASE", JSON.stringify(o.scope ?? {}),
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
  check("2: four CHECK constraints were added (purpose/classes/retention/completeness)",
    await n(`select count(*)::text n from pg_constraint where conrelid='context_grants'::regclass and conname in
      ('context_grants_purpose_code_check','context_grants_information_classes_check','context_grants_retention_class_check','context_grants_machine_governed_complete')`) === 4);
  check("3: can_see_pursuit is still SECURITY DEFINER with a pinned search_path, and none was added",
    await n(`select count(*)::text n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
      where ns.nspname='public' and p.proname='can_see_pursuit' and p.prosecdef and array_to_string(p.proconfig,',') like '%search_path%'`) === 1);
  check("4: can_see_pursuit now enforces the effective window",
    (await db.query<{ src: string }>(`select prosrc src from pg_proc where proname='can_see_pursuit'`)).rows[0].src.includes("effective_to"));
  check("5: the two legacy grants survive with purpose_code NULL and ZERO derivation authority",
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
  check("6: purpose_code on an ACTION grant → REJECTED", (await rejects("action", "grant_kind,purpose_code,information_classes,retention_class,expires_at", `'ACTION','VALUE_CASE',array['economic_value'],'RETAINED',now()+interval '1 day'`)).includes(M));
  const R = /machine_governed_complete|information_classes_check/;
  check("7: purpose_code with NULL information classes → REJECTED", R.test(await rejects("nullcls", "purpose_code,retention_class,expires_at", `'VALUE_CASE','RETAINED',now()+interval '1 day'`)));
  check("8: purpose_code with EMPTY information classes → REJECTED", R.test(await rejects("emptycls", "purpose_code,information_classes,retention_class,expires_at", `'VALUE_CASE',array[]::text[],'RETAINED',now()+interval '1 day'`)));
  check("9: purpose_code with NULL retention → REJECTED", (await rejects("nullret", "purpose_code,information_classes", `'VALUE_CASE',array['economic_value']`)).includes(M));
  check("10: EPHEMERAL without expires_at → REJECTED", (await rejects("eph", "purpose_code,information_classes,retention_class", `'VALUE_CASE',array['economic_value'],'EPHEMERAL'`)).includes(M));
  check("11: RETAINED without expires_at → REJECTED", (await rejects("ret", "purpose_code,information_classes,retention_class", `'VALUE_CASE',array['economic_value'],'RETAINED'`)).includes(M));
  check("12: unknown purpose code → REJECTED", (await rejects("badp", "purpose_code,information_classes,retention_class", `'WHATEVER',array['economic_value'],'PURSUIT_LIFETIME'`)).includes("purpose_code_check"));
  check("13: unknown information class → REJECTED", (await rejects("badc", "purpose_code,information_classes,retention_class", `'VALUE_CASE',array['nonsense'],'PURSUIT_LIFETIME'`)).includes("information_classes_check"));
  const badr = await rejects("badr", "purpose_code,information_classes,retention_class", `'VALUE_CASE',array['economic_value'],'FOREVER'`);
  check("14: unknown retention value → REJECTED", /retention_class_check|machine_governed_complete/.test(badr), badr.split("\n")[0].slice(0, 70));
  await rwc.query("savepoint ok");
  let nullPursuit = "";
  try { await rwc.query(`insert into context_grants (pursuit_id,from_org_id,to_org_id,purpose,purpose_code,information_classes,retention_class,expires_at)
    values (null,'${w.A}','${w.B}','x','VALUE_CASE',array['economic_value'],'RETAINED',now()+interval '1 day')`); await rwc.query("release savepoint ok"); }
  catch (e) { nullPursuit = (e as Error).message; await rwc.query("rollback to savepoint ok"); }
  check("15: machine-governed grant with NULL pursuit → REJECTED (this is what makes scope {} unambiguous)", nullPursuit.includes(M));
  await rwc.query("savepoint leg");
  let legacyOk = true;
  try { await rwc.query(`insert into context_grants (pursuit_id,from_org_id,to_org_id,purpose) values ('${w.pursuit}','${w.A}','${w.B}','legacy free text')`); await rwc.query("release savepoint leg"); }
  catch { legacyOk = false; await rwc.query("rollback to savepoint leg"); }
  check("16: a LEGACY grant (purpose_code NULL) is still accepted — no backfill is forced", legacyOk);
  await rwc.query("savepoint dual");
  let dualOk = true;
  try { await rwc.query(`insert into context_grants (pursuit_id,from_org_id,to_org_id,purpose,information_classes)
    values ('${w.pursuit}','${w.A}','${w.B}','legacy audience-style',array['PARTICIPANT_SHARED'])`); await rwc.query("release savepoint dual"); }
  catch { dualOk = false; await rwc.query("rollback to savepoint dual"); }
  check("16b: a legacy grant may still carry an AUDIENCE-style class — the pre-existing dual meaning of information_classes is tolerated, and the vocabulary binds only machine-governed grants", dualOk);
  await rwc.query("rollback");
  rwc.release();

  // ══ 3. GOVERNED USE vs DERIVATION ════════════════════════════════════════════════════════════
  check("17: DERIVATION_PURPOSES excludes CO_SELL_CONTEXT_DISPLAY",
    DERIVATION_PURPOSES.has("VALUE_CASE") && DERIVATION_PURPOSES.has("ROUTE_EVALUATION")
    && DERIVATION_PURPOSES.has("CONFLICT_DETECTION") && !DERIVATION_PURPOSES.has("CO_SELL_CONTEXT_DISPLAY"));
  const gValue = await (async () => { const c = await owner.connect(); const id = await grant(c, w, {}); c.release(); return id; })();
  // LIVE evaluation: null pins nothing, so each decision reads the database's own instant.
  const asOf = null;
  const derive = (org: string, kind: string, purpose: string) =>
    withTenantOrg(org, (d) => mayDerive(d, org, { inputKind: kind, sourceOrgId: w.A, pursuitId: w.pursuit }, purpose, asOf));
  check("18: derivation ALLOWED under a machine-governed, purpose-matched, class-covered live grant",
    (await derive(w.B, "economic_fact", "VALUE_CASE")).allow === true, gValue.slice(0, 8));
  check("19: WRONG PURPOSE denied — a ROUTE_EVALUATION operation cannot use a VALUE_CASE grant",
    (await derive(w.B, "economic_fact", "ROUTE_EVALUATION")).allow === false);
  check("20: WRONG INFORMATION CLASS denied — the grant covers economic_value only",
    (await derive(w.B, "stakeholder_role", "VALUE_CASE")).allow === false);
  check("21: CO_SELL_CONTEXT_DISPLAY is not a derivation purpose, so it can never authorize derivation",
    (await derive(w.B, "economic_fact", "CO_SELL_CONTEXT_DISPLAY")).allow === false);
  check("22: an unmapped input kind denies — no wildcard, no OTHER class",
    (await derive(w.B, "mystery_input", "VALUE_CASE")).allow === false && INPUT_CLASS_REGISTRY["mystery_input"] === undefined);
  check("23: an organization derives from its OWN information without a grant",
    (await derive(w.A, "economic_fact", "VALUE_CASE")).allow === true);
  check("24: a NON-PARTICIPANT is denied outright", (await derive(w.C, "economic_fact", "VALUE_CASE")).allow === false);

  // ══ 4. LEGACY, EXPIRY, REVOCATION ════════════════════════════════════════════════════════════
  const oc = await owner.connect();
  const gLegacy = String((await oc.query(`insert into context_grants (pursuit_id,from_org_id,to_org_id,purpose,information_classes,status)
    values ($1,$2,$3,'co-sell context sharing',array['economic_value'],'accepted') returning id`, [w.pursuit, w.A, w.C])).rows[0].id);
  check("25: a LEGACY grant (purpose_code NULL) confers NO derivation authority, however complete it looks",
    (await withTenantOrg(w.C, (d) => mayDerive(d, w.C, { inputKind: "economic_fact", sourceOrgId: w.A, pursuitId: w.pursuit }, "VALUE_CASE", asOf))).allow === false, gLegacy.slice(0, 8));
  await oc.query(`update context_grants set status='revoked', revoked_at=now() where id=$1`, [gValue]);
  check("26: REVOKED grant → derivation denied immediately", (await derive(w.B, "economic_fact", "VALUE_CASE")).allow === false);
  await oc.query(`update context_grants set status='accepted', revoked_at=null, retention_class='RETAINED', expires_at=now() - interval '1 minute' where id=$1`, [gValue]);
  check("27: EXPIRED grant → derivation denied (RETAINED storage does not extend derivation)",
    (await derive(w.B, "economic_fact", "VALUE_CASE")).allow === false);
  await oc.query(`update context_grants set retention_class='PURSUIT_LIFETIME', expires_at=null where id=$1`, [gValue]);
  check("28: restored grant derives again", (await derive(w.B, "economic_fact", "VALUE_CASE")).allow === true);
  await oc.query(`update pursuits set status='WON' where id=$1`, [w.pursuit]);
  check("29: PURSUIT_LIFETIME ends when the pursuit becomes terminal — the EARLIEST bound applies",
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
  check("30: BEFORE effective_from → denied at RLS and in the read model", w30.rls === false && w30.viewer === false, both(w30));
  await setWindow("now() - interval '1 second'", "null");
  const w31 = await observe();
  check("31: at/after effective_from → allowed at both layers", w31.rls === true && w31.viewer === true, both(w31));
  await setWindow("now() - interval '1 day'", "now() + interval '1 hour'");
  const w32 = await observe();
  check("32: immediately before effective_to → allowed at both layers", w32.rls === true && w32.viewer === true, both(w32));
  await setWindow("now() - interval '1 day'", "now()");
  const w33 = await observe();
  check("33: exactly at effective_to → DENIED (the predicate is strictly >)", w33.rls === false && w33.viewer === false, both(w33));
  await setWindow("now() - interval '1 day'", "null", "LEFT");
  const w34 = await observe();
  check("34: LEFT → denied regardless of dates", w34.rls === false && w34.viewer === false, both(w34));
  await setWindow("now() - interval '1 day'", "null", "REVOKED");
  const w35 = await observe();
  check("35: REVOKED → denied regardless of dates", w35.rls === false && w35.viewer === false, both(w35));
  await setWindow("now() - interval '1 day'", "null", "ACTIVE");
  check("36: the governance clock is the DB transaction timestamp, not an application wall clock",
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
  let boundaryDenied = 0;
  for (let i = 0; i < 25; i++) {
    await setWindow("now() - interval '1 day'", "now()");
    const o = await observe();
    if (o.rls === false && o.viewer === false) boundaryDenied++;
  }
  check("37: the effective_to boundary is DETERMINISTIC — 25 back-to-back evaluations all deny",
    boundaryDenied === 25, `${boundaryDenied}/25 denied at both layers`);
  await setWindow("now() - interval '1 day'", "null", "ACTIVE");

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
  check("38: a governance instant LOSES PRECISION crossing into JavaScript — it is an observable, never a comparison instant",
    lossy === 50, `${lossy}/50 round-trips truncated (ms Date vs µs timestamptz)`);

  // Source guard: no live governance predicate may compare against an instant carried by JavaScript.
  const govSrc = ["grants", "derivation", "contributions"]
    .map((f) => readFileSync(`src/lib/pursuits/federation/${f}.ts`, "utf8")).join("\n");
  const boundParam = /(effective_from|effective_to|expires_at|valid_until)\s*(is null or \1)?\s*[<>]=?\s*\$\d/;
  check("39: every live window predicate compares in SQL — no JavaScript instant, no application wall clock",
    !boundParam.test(govSrc) && !/\?\?\s*new Date\(\)/.test(govSrc)
      && (govSrc.match(/coalesce\(\$\d+::timestamptz, transaction_timestamp\(\)\)/g) ?? []).length >= 6,
    `${(govSrc.match(/coalesce\(\$\d+::timestamptz, transaction_timestamp\(\)\)/g) ?? []).length} SQL-side instants`);

  // ══ 6. DELEGATION AND ONWARD SHARING ═════════════════════════════════════════════════════════
  await oc.query(`update context_grants set delegation_allowed=true, onward_sharing_allowed=false where id=$1`, [gValue]);
  check("40: DELEGATION is fail-closed — the boolean grants nothing without authority lineage", mayDelegate().allow === false);
  check("41: PURSUIT-LEVEL onward sharing of another org's data is unsupported", mayGrantOnwardAtPursuitLevel().allow === false);
  check("42: OBJECT-LEVEL onward with onward_sharing_allowed=false → HARD DENIAL",
    (await withTenantOrg(w.B, (d) => mayShareOnward(d, w.B, w.A, w.pursuit, asOf))).allow === false);
  await oc.query(`update context_grants set onward_sharing_allowed=true where id=$1`, [gValue]);
  const onward = await withTenantOrg(w.B, (d) => mayShareOnward(d, w.B, w.A, w.pursuit, asOf));
  check("43: onward=true removes ONLY that prohibition", onward.allow === true && /still qualify independently/.test(onward.reason));
  check("44: …and C still gains nothing — it is neither owner nor participant",
    resolveDisclosure({ ownerOrgId: w.A, audience: "PARTICIPANT_SHARED", value: "secret" } as Disclosable<string>,
      { orgId: w.C, isSponsor: false, isParticipant: false, allowlistGrantedFor: new Set() }).visibility === "SUPPRESSED");
  check("45: the sharer may always share what it owns", (await withTenantOrg(w.A, (d) => mayShareOnward(d, w.A, w.A, w.pursuit, asOf))).allow === true);

  // ══ 7. DISCLOSURE LADDER PRESERVED (pre-existing behaviour must not regress) ══════════════════
  const viewer = { orgId: w.B, isSponsor: false, isParticipant: true, allowlistGrantedFor: new Set<string>() };
  const item = (audience: string, extra: Record<string, unknown> = {}) =>
    ({ ownerOrgId: w.A, audience, value: "exact", ...extra }) as Disclosable<string>;
  check("46: PARTICIPANT_SHARED → EXACT", resolveDisclosure(item("PARTICIPANT_SHARED"), viewer).visibility === "EXACT");
  check("47: GENERALIZED → GENERALIZED", resolveDisclosure(item("GENERALIZED", { generalized: "g" }), viewer).visibility === "GENERALIZED");
  check("48: AGGREGATED → AGGREGATED", resolveDisclosure(item("AGGREGATED", { aggregate: "a" }), viewer).visibility === "AGGREGATED");
  check("49: ORG_PRIVATE → SUPPRESSED, and the exact value never appears",
    (() => { const r = resolveDisclosure(item("ORG_PRIVATE"), viewer); return r.visibility === "SUPPRESSED" && r.value === null; })());

  // ══ 8. ZERO SAFE-DECLASSIFICATION TRANSFORMS ═════════════════════════════════════════════════
  check("50: P6-IG ships ZERO safe-declassification transforms", SAFE_DECLASSIFICATION_TRANSFORMS.size === 0);
  check("51: all-authorized inputs → RECIPIENT_DERIVED", derivedDisposition([true, true]) === "RECIPIENT_DERIVED");
  check("52: ANY hidden input → NOT_DISCLOSABLE (DECLASSIFIED is structurally present but unreachable)",
    derivedDisposition([true, false]) === "NOT_DISCLOSABLE" && derivedDisposition([false], "CONFLICT_EXISTS") === "NOT_DISCLOSABLE");
  check("53: an unknown transform → NOT_DISCLOSABLE", derivedDisposition([false], "anything") === "NOT_DISCLOSABLE");

  // ══ 9. COUNT / EXISTENCE POLICY ══════════════════════════════════════════════════════════════
  check("54: the floor is 5, declared as PRODUCT POLICY — not anonymity, not differential privacy",
    CROSS_ORG_COUNT_FLOOR === 5 && /product policy/i.test(readFileSync("src/lib/pursuits/federation/derivation.ts", "utf8"))
    && /NOT anonymity and NOT differential privacy/i.test(readFileSync("src/lib/pursuits/federation/derivation.ts", "utf8")));
  check("55: a count of 1 is SUPPRESSED", mayRenderWithheldCount(1, true, false) === false);
  check("56: a count below the floor is SUPPRESSED", mayRenderWithheldCount(4, true, false) === false);
  check("57: at or above the floor renders", mayRenderWithheldCount(5, true, false) === true);
  check("58: no aggregate follows from suppressed rows — existence must be independently disclosable",
    mayRenderWithheldCount(50, false, false) === false);
  check("59: DIFFERENCING negative control — recipient-variable filtering suppresses any count",
    mayRenderWithheldCount(50, true, true) === false);

  // ══ 10. RAW-ROW FIREWALL — structural, not "nothing calls it today" ══════════════════════════
  const contribSrc = readFileSync("src/lib/pursuits/federation/contributions.ts", "utf8");
  check("60: the raw readers are renamed `unsafe_` and marked owner/verifier-only",
    contribSrc.includes("export async function unsafe_contributionsForPursuit")
    && contribSrc.includes("export async function unsafe_liveContributionsForPursuit")
    && /OWNER\/VERIFIER ONLY/.test(contribSrc));
  check("61: no un-prefixed raw reader remains exported",
    !/export async function contributionsForPursuit|export async function liveContributionsForPursuit/.test(contribSrc));
  const appFiles = (await import("node:child_process")).execSync("grep -rl 'unsafe_' src/app 2>/dev/null || true").toString().trim();
  check("62: SOURCE GUARD — no recipient-facing path under src/app references an unsafe_ reader", appFiles === "", appFiles || "none");
  check("63: the recipient-safe path applies the disclosure ladder",
    readFileSync("src/lib/pursuits/federation/read-models.ts", "utf8").includes("applyDisclosure"));

  // ══ 11. CACHE / REVOCATION ═══════════════════════════════════════════════════════════════════
  const cfg = readFileSync("next.config.mjs", "utf8");
  check("64: recipient-specific projections are non-shared and non-storable", /"Cache-Control", value: "private, no-store"/.test(cfg));
  check("65: Vary: Cookie is set, and both credential dimensions are cookie-based", /"Vary", value: "Cookie"/.test(cfg));
  check("66: force-dynamic is retained on every page",
    (await import("node:child_process")).execSync("grep -rl 'export const dynamic = \"force-dynamic\"' src/app | wc -l").toString().trim() !== "0");

  // ══ 12. NO PERSISTENCE, NO AUDIT ON PASSIVE READ ═════════════════════════════════════════════
  const derivSrc = readFileSync("src/lib/pursuits/federation/derivation.ts", "utf8");
  check("67: EPHEMERAL is provable — P6-IG persists NOTHING (no insert/update in the governance modules)",
    !/insert into|update /i.test(derivSrc));
  const ledgerBefore = Number((await oc.query<{ n: string }>(`select count(*)::text n from change_ledger`)).rows[0].n);
  await derive(w.B, "economic_fact", "VALUE_CASE");
  await withTenantOrg(w.B, (d) => buildFederationViewer(d, w.B, w.pursuit));
  const ledgerAfter = Number((await oc.query<{ n: string }>(`select count(*)::text n from change_ledger`)).rows[0].n);
  check("68: a PASSIVE READ appends no audit row — no read-driven growth, no traffic-analysis channel",
    ledgerBefore === ledgerAfter, `${ledgerBefore} → ${ledgerAfter}`);
  check("69: DISCLOSURE_REFUSED was not added to the ledger vocabulary",
    !(await oc.query<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conname='change_ledger_change_type_check'`)).rows[0].d.includes("DISCLOSURE_REFUSED"));

  oc.release(); db.release();
  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed${failed ? `: ${failures.join(" | ")}` : ""}`);
  await owner.end(); await rw.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.log(`[p6ig-governance-verify] fatal: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
