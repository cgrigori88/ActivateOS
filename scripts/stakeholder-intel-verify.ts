/**
 * Stakeholder Intelligence acceptance verification (Intelligence Wave P1C §5/§19).
 *
 * Proves against the live demo world:
 *  - role assertion runs ONLY through dispatchSkill (invocations recorded; the direct CRUD path
 *    is a DATABASE error, not a convention);
 *  - assertion history is append-only and preserved across supersedes;
 *  - verified / inferred / unverified stay distinct (and UNVERIFIED ≠ MISSING);
 *  - a job title alone can never establish a buying role; agents may propose, never verify;
 *  - pre-opportunity coverage is honestly NOT ESTABLISHED (UNKNOWN), never synthesized;
 *  - warm paths require relationship evidence — overlap/ownership alone is not a path, and
 *    UNKNOWN remains a valid answer;
 *  - stakeholder coverage renders through the shared constraint language and joins the Motion
 *    funnel as a NON-GATING overlay (funnel reconciliation unchanged);
 *  - Today surfaces only the material gap, with a grounded (or honestly UNKNOWN) path;
 *  - the Brief consumes the same canonical projection, buying-side lines confidential by default;
 *  - Sponsor↔Partner disclosure: stakeholder identity is absent from partner-facing payloads
 *    server-side; cross-tenant read is denied by RLS; cross-tenant assertion is REJECTED;
 *  - scope narrowing works; ⌘K answers from assertion-state truth and says UNKNOWN, never a guess.
 *
 *   DEMO_URL=… npx tsx scripts/stakeholder-intel-verify.ts
 */
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";
import { getStakeholderCoverage, getWarmPaths, bestWarmPath, stakeholderConstraint } from "../src/lib/stakeholders/coverage";
import { getMotionFunnels, aggregateConstraints, accountsAtStage } from "../src/lib/motions/funnel";
import { getTodayQueue } from "../src/lib/pursuits/read-models/today";
import { getPursuitDetail } from "../src/lib/pursuits/read-models/detail";
import { buildPursuitBrief } from "../src/lib/pursuits/read-models/brief";
import { getPursuitFederation } from "../src/lib/pursuits/federation/read-models";
import { resolveExplain, parseStakeholderShowMe, resolveStakeholderShowMe } from "../src/lib/search/query";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: URL });
let pass = 0, fail = 0;
function ok(n: string, c: boolean, d = "") { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } }

async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; }
  finally { c.release(); }
}

async function expectError(fn: () => Promise<unknown>, re: RegExp): Promise<{ threw: boolean; matched: boolean; msg: string }> {
  try { await fn(); return { threw: false, matched: false, msg: "" }; }
  catch (e) { const msg = (e as Error).message; return { threw: true, matched: re.test(msg), msg }; }
}

async function main() {
  const db = (await pool.connect()) as PoolClient;
  const one = async <T extends QueryResultRow>(sql: string, p: unknown[] = []): Promise<T> => (await db.query<T>(sql, p)).rows[0] as T;
  try {
    const org = (await one<{ org_id: string }>(`select org_id from revenue_motions limit 1`)).org_id;
    const user: Actor = { type: "USER", id: null, orgId: org, role: "operator" };
    const agent: Actor = { type: "AGENT", id: null, orgId: org, role: "operator" };
    const caller = { orgId: org, canSeeInternal: true, canSeeTransactionDetail: true };

    const hero = await one<{ pursuit_id: string; opportunity_id: string; account_id: string }>(
      `select pu.id pursuit_id, o.id opportunity_id, pu.account_id
         from pursuits pu join companies c on c.id = pu.account_id
         join opportunities o on o.pursuit_id = pu.id and o.org_id = $1
        where pu.org_id = $1 and c.legal_name ilike '%Globex%' and pu.status not in ('WON','LOST','DISQUALIFIED')
        order by (o.stage not like 'closed%') desc, pu.expected_value_weighted desc nulls last limit 1`, [org]);
    const globexPursuit = hero.pursuit_id, globexOpp = hero.opportunity_id, globexCo = hero.account_id;
    const starkCo = (await one<{ id: string }>(`select id from companies where legal_name ilike '%stark%' limit 1`)).id;
    const sarah = (await one<{ id: string }>(`select id from contacts where email='sarah.kim@globex.example'`)).id;
    const dana = (await one<{ id: string }>(`select id from contacts where email='dana.whitfield@globex.example'`)).id;

    // ---- 1. Governance: the ONLY path is dispatchSkill ------------------------------------------
    const inv = await one<{ n: string }>(`select count(*)::text n from governed_action_invocations where org_id=$1 and skill_id='assert_stakeholder_role' and status='EXECUTED'`, [org]);
    ok("role assertions ran through dispatchSkill (EXECUTED invocations recorded)", Number(inv.n) >= 5, inv.n);

    await db.query("begin");
    const upd = await expectError(() => db.query(`update stakeholders set role='economic_buyer' where opportunity_id=$1 and contact_id=$2`, [globexOpp, sarah]), /governed assert_stakeholder_role/);
    await db.query("rollback");
    ok("direct role UPDATE is a DB error (no alternate authoritative path — 0097 trigger)", upd.threw && upd.matched, upd.msg);

    await db.query("begin");
    const ins = await expectError(() => db.query(`insert into stakeholders (opportunity_id, contact_id, role, assertion_state) values ($1,$2,'champion','verified')`, [globexOpp, dana]), /governed assert_stakeholder_role/);
    await db.query("rollback");
    ok("direct INSERT above unverified is a DB error", ins.threw && ins.matched, ins.msg);

    await db.query("begin");
    let seedOk = true;
    try { await db.query(`insert into stakeholders (opportunity_id, contact_id) values ($1,$2) on conflict do nothing`, [globexOpp, dana]); } catch { seedOk = false; }
    await db.query("rollback");
    ok("unverified seeding (the existing creation path) still works", seedOk);

    // ---- 2. History: append-only, supersede-preserving ------------------------------------------
    const hist = (await db.query<{ before_state: { assertion_state?: string } | null; after_state: { assertion_state?: string } | null }>(
      `select before_state, after_state from change_ledger
        where pursuit_id=$1 and change_type='STAKEHOLDER_ROLE_ASSERTED' and entity_id=$2 order by recorded_at asc`, [globexPursuit, sarah])).rows;
    ok("assertion history preserved: champion inferred → verified, both visible", hist.length >= 2
      && hist.some((h) => h.before_state == null && h.after_state?.assertion_state === "inferred")
      && hist.some((h) => h.before_state?.assertion_state === "inferred" && h.after_state?.assertion_state === "verified"));
    const denied = await asOrg(org, async (c) => expectError(() => c.query(`update change_ledger set reason='x' where change_type='STAKEHOLDER_ROLE_ASSERTED'`), /permission denied/));
    ok("assertion history is append-only under app_rw (0094)", denied.threw && denied.matched, denied.msg);

    // ---- 3. The three states stay distinct ------------------------------------------------------
    const cov = (await getStakeholderCoverage(db, org, globexPursuit))!;
    const role = (k: string) => cov.roles.find((r) => r.role === k)!;
    ok("verified stays verified (champion, technical buyer)", role("champion").state === "VERIFIED" && role("technical_buyer").state === "VERIFIED");
    ok("missing role derived correctly (economic buyer MISSING)", role("economic_buyer").state === "MISSING" && cov.missingRoles.includes("economic_buyer"));
    ok("inferred proposal stays inferred (influencer, agent-proposed)", cov.others.some((o) => o.role === "influencer" && o.state === "INFERRED"));
    const umb = await one<{ pursuit_id: string }>(
      `select pu.id pursuit_id from pursuits pu join companies c on c.id = pu.account_id
        where pu.org_id=$1 and c.legal_name ilike '%Umbrella%' and exists (select 1 from opportunities o where o.pursuit_id=pu.id) limit 1`, [org]);
    const umbCov = (await getStakeholderCoverage(db, org, umb.pursuit_id))!;
    ok("UNVERIFIED ≠ MISSING (Umbrella's title-based economic-buyer proposal)", umbCov.roles.find((r) => r.role === "economic_buyer")!.state === "UNVERIFIED");

    // ---- 4. Title is never authority; agents never verify ---------------------------------------
    await db.query("begin");
    const titleVerified = await dispatchSkill(db, "assert_stakeholder_role", user, { pursuitId: globexPursuit,
      args: { opportunityId: globexOpp, contactId: dana, role: "economic_buyer", assertionState: "verified", source: "test", evidence: "VP Infrastructure", basis: ["title"] } });
    const titleInferred = await dispatchSkill(db, "assert_stakeholder_role", user, { pursuitId: globexPursuit,
      args: { opportunityId: globexOpp, contactId: dana, role: "economic_buyer", assertionState: "inferred", source: "test", basis: ["title"] } });
    const agentVerify = await dispatchSkill(db, "assert_stakeholder_role", agent, { pursuitId: globexPursuit,
      args: { opportunityId: globexOpp, contactId: dana, role: "economic_buyer", assertionState: "verified", source: "ai:test", evidence: "x", basis: ["customer_confirmation"] } });
    const agentPropose = await dispatchSkill(db, "assert_stakeholder_role", agent, { pursuitId: globexPursuit,
      args: { opportunityId: globexOpp, contactId: dana, role: "influencer", assertionState: "inferred", source: "ai:test", evidence: "attended", basis: ["meeting_attendance"] } });
    await db.query("rollback");
    ok("title alone cannot establish a verified role", titleVerified.status === "FAILED" && /title/i.test(titleVerified.reason ?? ""), titleVerified.reason);
    ok("title alone cannot even establish an inferred role", titleInferred.status === "FAILED" && /title/i.test(titleInferred.reason ?? ""));
    ok("an AGENT may not assert verified (verification is human)", agentVerify.status === "FAILED" && /human/i.test(agentVerify.reason ?? ""), agentVerify.reason);
    ok("an AGENT may propose inferred (governed, recorded)", agentPropose.status === "EXECUTED");

    // ---- 5. Pre-opportunity honesty -------------------------------------------------------------
    const preOpp = await one<{ id: string }>(
      `select pu.id from pursuits pu where pu.org_id=$1 and not exists (select 1 from opportunities o where o.pursuit_id=pu.id) limit 1`, [org]);
    if (preOpp) {
      const pc = (await getStakeholderCoverage(db, org, preOpp.id))!;
      ok("pre-opportunity coverage is NOT ESTABLISHED (UNKNOWN, stated — no PK relaxation)", !pc.established && /not established/i.test(pc.notEstablishedReason ?? ""));
    } else ok("pre-opportunity coverage is NOT ESTABLISHED", false, "no pre-opportunity pursuit found");

    // ---- 6. Warm paths: evidence-tiered, never manufactured -------------------------------------
    const gPaths = await getWarmPaths(db, org, globexCo);
    ok("seller relationship evidence yields an ACCOUNT-LEVEL path, stated as such",
      gPaths.some((p) => p.tier === "SELLER_ACCOUNT" && /account-level relationship, not a claim about a specific person/.test(p.text)));
    ok("no person-level path is invented (no accepted intro ⇒ no PERSON_VERIFIED)", !gPaths.some((p) => p.tier === "PERSON_VERIFIED"));
    const sPaths = await getWarmPaths(db, org, starkCo);
    ok("account overlap alone does NOT create a warm path (Stark: overlap-only statements)",
      sPaths.length > 0 && sPaths.every((p) => p.tier === "ACCOUNT_OVERLAP") && sPaths.every((p) => /overlap alone is not a warm path/.test(p.text)));
    await db.query("begin");
    const lonely = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name) values ('No Path Co P1C','no path co p1c') returning id`)).rows[0];
    const nPaths = await getWarmPaths(db, org, lonely.id);
    await db.query("rollback");
    ok("no evidence at all ⇒ UNKNOWN (a valid answer, never filled in)", nPaths.length === 1 && nPaths[0].tier === "UNKNOWN" && bestWarmPath(nPaths).tier === "UNKNOWN");
    // The next-step copy may name a partner ONLY on a real relationship tier. On an overlap-only
    // account, naming the overlapping partner would be the forbidden "they own it, so they know
    // the buyer" inference — the panel must route to discovery instead.
    const starkBest = bestWarmPath(sPaths);
    ok("overlap-only accounts never yield a 'validate through <partner>' instruction",
      starkBest.tier === "ACCOUNT_OVERLAP" && !["PERSON_VERIFIED", "SELLER_ACCOUNT"].includes(starkBest.tier));

    // ---- 7. Constraint language + Motion overlay (non-gating; reconciliation intact) ------------
    const cView = stakeholderConstraint(cov)!;
    ok("coverage renders through the shared constraint language (blocked-by / why / exposure / what-changes-it)",
      cView != null && /Economic buyer/.test(cView.blockedBy) && cView.exposureUsd === cov.expectedValue
      && (cView.action?.deepLink ?? "").includes("#stakeholders") && cView.severity === "SOFT");
    const funnels = await getMotionFunnels(db, org);
    const f = funnels.find((x) => aggregateConstraints(x).overlays.some((r) => r.family === "STAKEHOLDER_GAP")) ?? funnels[0];
    const agg = aggregateConstraints(f);
    ok("STAKEHOLDER_GAP aggregates as an informational overlay (never a gating row)",
      agg.overlays.some((r) => r.family === "STAKEHOLDER_GAP" && r.count >= 1) && !agg.rows.some((r) => r.family === "STAKEHOLDER_GAP"));
    ok("overlay drill-in resolves exactly its members",
      accountsAtStage(f, "family:STAKEHOLDER_GAP").length === (agg.overlays.find((r) => r.family === "STAKEHOLDER_GAP")?.count ?? -1));
    ok("Motion constraints still reconcile: gating rows sum to not-ready accounts with a primary blocker",
      agg.rows.reduce((s, r) => s + r.count, 0) === f.accounts.filter((a) => a.cohort !== "ready" && a.constraints.some((c) => c.gating)).length);
    // Verified-only + non-gating: a verified economic buyer clears the overlay but never changes readiness.
    const readyBefore = f.cohorts.ready;
    await db.query("begin");
    const vr = await dispatchSkill(db, "assert_stakeholder_role", user, { pursuitId: globexPursuit,
      args: { opportunityId: globexOpp, contactId: dana, role: "economic_buyer", assertionState: "verified", source: "test", evidence: "confirmed for test", basis: ["customer_confirmation"] }, dataEnvironment: "DEMO" });
    const f2 = (await getMotionFunnels(db, org)).find((x) => x.hypothesis.taxonomyNodeId === f.hypothesis.taxonomyNodeId)!;
    const gapGone = !accountsAtStage(f2, "family:STAKEHOLDER_GAP").some((a) => a.pursuitId === globexPursuit);
    const readyAfter = f2.cohorts.ready;
    await db.query("rollback");
    ok("the gap is verified-only: a governed verified assertion clears it", vr.status === "EXECUTED" && gapGone);
    ok("coverage NEVER gates: the execution-ready cohort is unchanged by the assertion", readyAfter === readyBefore);

    // ---- 8. Today: material gaps only, grounded path or honest UNKNOWN --------------------------
    const today = await getTodayQueue(db, caller);
    const item = today.items.find((i) => i.type === "STAKEHOLDER_GAP" && i.pursuitId === globexPursuit);
    ok("Today surfaces the material gap (high-value pursuit lacks a verified economic buyer)",
      item != null && /lacks a verified economic buyer/.test(item.title) && item.deepLink.includes("#stakeholders"));
    ok("the Today item's path claim is grounded (named seller) or honestly UNKNOWN — never from overlap",
      item != null && (/Strongest known path: .*seller .*\(account-level relationship\)/.test(item.reason) || /no warm path is known — UNKNOWN/.test(item.reason)));
    let floorHolds = true;
    for (const it of today.items.filter((i) => i.type === "STAKEHOLDER_GAP")) {
      const ev = (await one<{ ev: string | null }>(`select expected_value_weighted ev from pursuits where id=$1`, [it.pursuitId!])).ev;
      if (Number(ev ?? 0) < 500_000) floorHolds = false;
    }
    ok("below-floor pursuits do not flood Today (materiality floor holds)", floorHolds);

    // ---- 9. Brief: canonical projection, buying-side confidential by default --------------------
    const detail = (await getPursuitDetail(db, caller, globexPursuit))!;
    const brief = buildPursuitBrief(detail);
    const who = brief.sections.find((s) => s.key === "who")!;
    const shLines = who.lines.filter((l) => /champion|economic buyer|technical buyer/i.test(l.text));
    ok("Brief WHO MATTERS carries the canonical stakeholder projection", shLines.length >= 3 && shLines.some((l) => /Sarah Kim/.test(l.text)));
    ok("buying-side stakeholder lines are confidential by default (withheld from the partner rendering)", shLines.every((l) => l.confidential === true));
    ok("Brief WHAT TO ASK is driven by the coverage gap", brief.sections.find((s) => s.key === "ask")!.lines.some((l) => /economic approval/i.test(l.text)));
    ok("Brief WHAT NOT TO CLAIM guards the unverified authority",
      brief.sections.find((s) => s.key === "notclaim")!.lines.some((l) => /economic buyer has not been identified|has not been verified/i.test(l.text) && l.caution));
    ok("Brief WHAT NEXT names the grounded path (or UNKNOWN), sponsor-only",
      brief.sections.find((s) => s.key === "next")!.lines.some((l) => /Verify the economic buyer — best known path/.test(l.text) && l.confidential));

    // ---- 10. Disclosure & tenancy ---------------------------------------------------------------
    const fed = await getPursuitFederation(db, org, globexPursuit);
    ok("partner-facing federation payload carries NO stakeholder identity (server-side absence)",
      !JSON.stringify(fed ?? {}).match(/Sarah Kim|Mike Rivera|Dana Whitfield|Priya Shah|economic_buyer/));
    const foreign = await one<{ id: string }>(`select id from organizations where id <> $1 limit 1`, [org]);
    if (foreign) {
      const visible = await asOrg(org, async (c) => Number((await c.query<{ n: string }>(`select count(*)::text n from stakeholders where opportunity_id=$1`, [globexOpp])).rows[0].n));
      const cross = await asOrg(foreign.id, async (c) => Number((await c.query<{ n: string }>(`select count(*)::text n from stakeholders where opportunity_id=$1`, [globexOpp])).rows[0].n));
      ok("RLS: the owning org reads its stakeholders; a foreign tenant reads ZERO rows", visible >= 3 && cross === 0, `own=${visible} foreign=${cross}`);
      await db.query("begin");
      const crossAssert = await dispatchSkill(db, "assert_stakeholder_role", { type: "USER", id: null, orgId: foreign.id, role: "operator" }, {
        args: { opportunityId: globexOpp, contactId: dana, role: "champion", assertionState: "unverified", source: "attack" } });
      await db.query("rollback");
      ok("cross-tenant role assertion is REJECTED (audited precheck)", crossAssert.status === "REJECTED" && /not found in this org/.test(crossAssert.reason ?? ""), crossAssert.reason);
    } else { ok("RLS cross-tenant checks", false, "no second org present"); }

    // ---- 11. Scope narrowing + ⌘K ---------------------------------------------------------------
    const parsed = parseStakeholderShowMe("which high-value pursuits lack an economic buyer")!;
    ok("SHOW ME parses the role and does not mistake 'high-value' for a partner", parsed.role === "economic_buyer" && parsed.partner === null);
    const all = await resolveStakeholderShowMe(db, org, parsed, null);
    const none = await resolveStakeholderShowMe(db, org, parsed, []);
    const onlyGlobex = await resolveStakeholderShowMe(db, org, parsed, [globexCo]);
    ok("SHOW ME resolves coverage gaps (full set includes Globex)", all.hits.some((h) => /Globex/.test(h.label)));
    ok("scope narrows and never widens (empty ⇒ zero; single-account ⇒ that account only)",
      none.hits.length === 0 && onlyGlobex.hits.length >= 1 && onlyGlobex.hits.every((h) => /Globex/.test(h.label)));
    const exG = await resolveExplain(db, "Who is the economic buyer for Globex?", org);
    ok("⌘K: 'who is the economic buyer' answers UNKNOWN — never a probable person",
      "lines" in exG && exG.lines.some((l) => /UNKNOWN — no verified economic buyer exists/.test(l.value)));
    const exU = await resolveExplain(db, "Who is the economic buyer for Umbrella?", org);
    ok("⌘K: a title-based proposal is labeled a proposal, and the answer stays UNKNOWN",
      "lines" in exU && exU.lines.some((l) => /UNKNOWN/.test(l.value)) && exU.lines.some((l) => /Proposal \(unverified\)/i.test(l.label)));
    const exC = await resolveExplain(db, "Why is stakeholder coverage blocking Globex?", org);
    ok("⌘K: coverage decomposition grounds in assertion states + best known path",
      "lines" in exC && exC.lines.some((l) => /economic buyer/i.test(l.label) && /MISSING/.test(l.value)) && exC.lines.some((l) => /Best known path/.test(l.label)));
  } finally {
    db.release();
    await pool.end();
  }
  console.log(`\n  ${fail === 0 ? "✓ STAKEHOLDER INTELLIGENCE VERIFIED" : "✗ FAILURES"} — ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
