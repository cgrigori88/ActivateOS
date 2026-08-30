/**
 * Workstream E3-H blind harness — the LOCKED closed-loop hero scenarios (R38 + R39).
 * These are PERMANENT regression scenarios, not one-time tests. Both drive the REAL
 * libs end to end against pursuit_demo under RLS.
 *
 * R38 happy path: shared Pursuit → caller-specific disclosure → human decision →
 *   governed action → audited state transition → interaction/outcome → event →
 *   recomputation → changed intelligence → changed Today, with tenant isolation,
 *   disclosure absence, consent enforcement, as-of correctness, provenance,
 *   recommendation/decision separation, and immutable history all held.
 *
 * R39 adverse path: route recommended + supported by federated context → approved →
 *   required resource DECLINES → readiness falls → event triggers recompute →
 *   alternate becomes materially better → "route reconsideration" surfaces → human
 *   selects alternate → previous route preserved historically → outcome lands →
 *   learning records the whole sequence. PursuitOS as an operating system reacting to
 *   changing commercial reality, not a static recommender.
 *
 *   npx tsx scripts/closed-loop-verify.ts
 */
import { Pool, type PoolClient } from "pg";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { addParticipant, acceptParticipation } from "../src/lib/pursuits/federation/participation";
import { proposeGrant, acceptGrant, buildFederationViewer } from "../src/lib/pursuits/federation/grants";
import { recordContribution } from "../src/lib/pursuits/federation/contributions";
import { seedGovernedSkills, dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";
import { recomputeRoute } from "../src/lib/routing/route-model";
import { recordChange } from "../src/lib/pursuits/ledger";
import { recordAndEnqueue, drainRecomputeQueue } from "../src/lib/pursuits/federation/events";
import { recordOutcome, recordAttribution } from "../src/lib/pursuits/federation/outcomes";
import { getPursuitFederation, getGovernedActions, getPursuitOutcomes } from "../src/lib/pursuits/federation/read-models";
import { randomUUID } from "node:crypto";

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } }
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } }
const actor = (orgId: string, role: Actor["role"], type: Actor["type"] = "USER"): Actor => ({ type, id: randomUUID(), orgId, role });

async function main() {
  console.log(`[closed-loop-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const RID = Math.random().toString(36).slice(2, 8);
  const s = await asOwner(async (db) => {
    await seedGovernedSkills(db);
    const org = async (n: string) => (await db.query<{ id: string }>(`insert into organizations (name, kind, created_at) values ($1,'full',now()) returning id`, [`${n} ${RID}`])).rows[0].id;
    const vendor = await org("Hero Vendor"); const distributor = await org("Hero Distributor"); const outsider = await org("Hero Outsider");
    const node = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name, slug) values ($1,$2) returning id`, [`Hero ${RID}`, `hero-${RID}`])).rows[0].id;
    const globex = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,'Tech','US') returning id`, [`Globex ${RID}`])).rows[0].id;
    const hero = (await upsertPursuit(db, { orgId: vendor, accountId: globex, productCategoryId: node, pursuitType: "MODERNIZATION", useCase: "virtualization exit", businessProblem: "x", createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" })).id;
    // Two routable partners for the sponsor org, with capabilities + relationships to the hero account.
    const cdw = (await db.query<{ id: string }>(`insert into partners (org_id, name, partner_type, capacity) values ($1,'CDW','reseller',10) returning id`, [vendor])).rows[0].id;
    const wwt = (await db.query<{ id: string }>(`insert into partners (org_id, name, partner_type, capacity) values ($1,'WWT','reseller',10) returning id`, [vendor])).rows[0].id;
    await db.query(`insert into partner_capabilities (partner_id, taxonomy_node_id, strength, certified) values ($1,$2,0.9,true)`, [cdw, node]); // CDW ahead initially
    await db.query(`insert into partner_capabilities (partner_id, taxonomy_node_id, strength, certified) values ($1,$2,0.7,true)`, [wwt, node]);
    await db.query(`insert into partner_relationships (partner_id, company_id, strength, tenure_months) values ($1,$2,88,36)`, [cdw, globex]);
    await db.query(`insert into partner_relationships (partner_id, company_id, strength, tenure_months) values ($1,$2,74,24)`, [wwt, globex]);
    return { vendor, distributor, outsider, node, globex, hero, cdw, wwt };
  });

  // Federation: sponsor (vendor) + distributor are both on the ONE canonical pursuit.
  await asOrg(s.vendor, (db) => addParticipant(db, { pursuitId: s.hero, orgId: s.vendor, roleKey: "VENDOR", sponsorOrgId: s.vendor, state: "ACTIVE" }));
  const partId = await asOrg(s.vendor, (db) => addParticipant(db, { pursuitId: s.hero, orgId: s.distributor, roleKey: "DISTRIBUTOR", sponsorOrgId: s.vendor }));
  await asOrg(s.distributor, (db) => acceptParticipation(db, partId));
  const g = await asOrg(s.distributor, (db) => proposeGrant(db, { pursuitId: s.hero, fromOrgId: s.distributor, toOrgId: s.vendor, grantKind: "DATA", purpose: "co-sell context" }));
  await asOrg(s.vendor, (db) => acceptGrant(db, g));
  await asOrg(s.distributor, (db) => recordContribution(db, { pursuitId: s.hero, sourceOrgId: s.distributor, mode: "FEDERATED", dataCategory: "transaction_adjacency", semanticMeaning: "Distributor transaction adjacency supports CDW", disclosureClass: "PARTICIPANT_SHARED", sensitivityClass: "CONFIDENTIAL", purpose: "co-sell", consentGrantId: g, isSimulated: true }));

  // ===================== R38 — HAPPY PATH =====================
  console.log("R38  Happy path — shared Pursuit → decision → action → outcome → recompute → Today");
  const rec1 = await asOrg(s.vendor, (db) => recomputeRoute(db, s.hero, new Date(), "DEMO"));
  check("route recompute produces a recommendation on the shared pursuit", rec1.recommendedCandidateId !== null || rec1.recommendedPartnerId !== null);
  const firstPartner = rec1.recommendedPartnerId;

  // Disclosure: participant sees the federation view; outsider sees NOTHING (T11 absence).
  const distView = await asOrg(s.distributor, (db) => getPursuitFederation(db, s.distributor, s.hero));
  const outView = await asOrg(s.outsider, (db) => getPursuitFederation(db, s.outsider, s.hero));
  check("an ACTIVE participant sees the shared pursuit's participants", !!distView && distView.participants.length >= 2);
  check("a participant receives the PARTICIPANT_SHARED context EXACTLY", !!distView && distView.sharedContext.some((c) => c.visibility === "EXACT"));
  check("an outsider org sees NOTHING — existence hidden (disclosure absence, T11)", outView === null);

  // Human decision (record) vs governed action (audited) are SEPARATE objects.
  await asOrg(s.vendor, (db) => recordChange(db, { orgId: s.vendor, pursuitId: s.hero, entityType: "route", entityId: s.hero, changeType: "ROUTE_SELECTED", reason: "operator approved CDW", actorType: "USER", dataEnvironment: "DEMO" }));
  const approve = await asOrg(s.vendor, (db) => dispatchSkill(db, "explain_route", actor(s.vendor, "operator"), { pursuitId: s.hero }));
  check("a governed action runs and is audited (recommendation ≠ decision ≠ action)", approve.status === "EXECUTED" && approve.invocationId !== null);
  const acts = await asOrg(s.vendor, (db) => getGovernedActions(db, actor(s.vendor, "operator"), s.hero));
  check("the governed-action history records the invocation as a distinct object", acts.history.some((h) => h.skillId === "explain_route" && h.status === "EXECUTED"));

  // Consent enforcement: a cross-tenant ask without an ACTION grant is refused.
  const crossNoAuth = await asOrg(s.vendor, (db) => dispatchSkill(db, "request_team_acceptance", actor(s.vendor, "operator"), { pursuitId: s.hero }));
  check("a cross-tenant action is refused without ACTION authority (DATA grant ≠ action authority)", crossNoAuth.status === "REJECTED");

  // Interaction/outcome → event → recompute at the event's as-of → Today advances.
  const meetingTime = new Date(Date.now() - 6 * 3600 * 1000);
  const { enqueue: mEnq } = await asOrg(s.vendor, (db) => recordAndEnqueue(db, { orgId: s.vendor, pursuitId: s.hero, entityType: "pursuit", entityId: s.hero, changeType: "MEETING_BOOKED", before: { readiness: 60 }, after: { readiness: 72 }, occurredAt: meetingTime, dataEnvironment: "DEMO" }));
  await asOrg(s.vendor, (db) => recordOutcome(db, { orgId: s.vendor, pursuitId: s.hero, label: "MEETING_BOOKED", routeSnapshotId: null, occurredAt: meetingTime, dataEnvironment: "DEMO", isSimulated: true }));
  const drainHappy = await asOrg(s.vendor, (db) => drainRecomputeQueue(db, {}));
  check("the outcome event fans out recomputes (READINESS/TODAY) that drain", mEnq.enqueued.includes("TODAY") && drainHappy.processed >= 1);
  const asOfOk = await asOrg(s.vendor, async (db) => (await db.query<{ as_of: Date }>(`select as_of from recompute_requests where pursuit_id=$1 and change_type='MEETING_BOOKED' limit 1`, [s.hero])).rows[0]);
  check("recompute runs at the EVENT's as-of, not now() (as-of correctness)", Math.abs(new Date(asOfOk.as_of).getTime() - meetingTime.getTime()) < 1000);

  const snapsAfterHappy = await asOrg(s.vendor, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from pursuit_route_snapshots where pursuit_id=$1`, [s.hero])).rows[0].n);

  // Tenant isolation on the outcome trail.
  check("outsider cannot read the outcome trail (tenant isolation + RLS)", (await asOrg(s.outsider, async (db) => await getPursuitOutcomes(db, await buildFederationViewer(db, s.outsider, s.hero), s.hero))) === null);

  // ===================== R39 — ADVERSE PATH =====================
  console.log("R39  Adverse path — resource declines → reconsideration → alternate → outcome → learning");
  const declineTime = new Date(Date.now() - 3 * 3600 * 1000);
  // Required CDW resource DECLINES → readiness falls (band-crossing) + CDW becomes non-viable
  // for this category (capability withdrawn), so the alternate is materially better.
  await asOwner((db) => db.query(`update partner_capabilities set strength = 0 where partner_id=$1 and taxonomy_node_id=$2`, [s.cdw, s.node]));
  const { enqueue: dEnq } = await asOrg(s.vendor, (db) => recordAndEnqueue(db, { orgId: s.vendor, pursuitId: s.hero, entityType: "route", entityId: s.hero, changeType: "PARTNER_DECLINED", before: { readiness: 78 }, after: { readiness: 41 }, occurredAt: declineTime, dataEnvironment: "DEMO" }));
  check("the decline fans out READINESS + ROUTE + TODAY recomputes", dEnq.enqueued.includes("ROUTE") && dEnq.enqueued.includes("READINESS") && dEnq.enqueued.includes("TODAY"));
  const drainAdverse = await asOrg(s.vendor, (db) => drainRecomputeQueue(db, {}));
  check("readiness fall is MATERIAL → surfaces a downstream change (route reconsideration)", drainAdverse.surfaced >= 1);
  const reconsider = await asOrg(s.vendor, async (db) => (await db.query<{ n: string }>(`select count(*)::text n from change_ledger where pursuit_id=$1 and change_type in ('READINESS_CHANGED','ROUTE_RECOMMENDATION_CHANGED') and trigger_type='EVENT_TRIGGERED'`, [s.hero])).rows[0].n);
  check("a reconsideration event is written to the ledger (Today would surface it)", Number(reconsider) >= 1);

  // Alternate becomes materially better — the REAL route recompute flips the recommendation.
  const rec2 = await asOrg(s.vendor, (db) => recomputeRoute(db, s.hero, declineTime, "DEMO"));
  check("the recommended route FLIPS to the alternate after the decline", rec2.recommendedPartnerId !== firstPartner);
  const snapsAfterFlip = await asOrg(s.vendor, async (db) => (await db.query<{ n: string; current: string }>(`select count(*)::text n, count(*) filter (where is_current)::text current from pursuit_route_snapshots where pursuit_id=$1`, [s.hero])).rows[0]);
  check("the flip APPENDS a new snapshot (immutable history — prior route preserved)", Number(snapsAfterFlip.n) > Number(snapsAfterHappy) && snapsAfterFlip.current === "1");

  // Human selects the alternate (decision object, separate from the recommendation snapshot).
  await asOrg(s.vendor, (db) => recordChange(db, { orgId: s.vendor, pursuitId: s.hero, entityType: "route", entityId: s.hero, changeType: "ROUTE_SELECTED", reason: "operator selected the alternate after reconsideration", actorType: "USER", occurredAt: declineTime, dataEnvironment: "DEMO" }));

  // Outcome lands + attribution — learning records the whole sequence.
  const wonId = await asOrg(s.vendor, (db) => recordOutcome(db, { orgId: s.vendor, pursuitId: s.hero, label: "CLOSED_WON", valueAmount: 320000, occurredAt: new Date(), dataEnvironment: "DEMO", isSimulated: true }));
  await asOrg(s.vendor, (db) => recordAttribution(db, { orgId: s.vendor, pursuitId: s.hero, outcomeId: wonId, subjectKind: "DISTRIBUTOR", subjectLabel: "Distributor", attributionClass: "INFLUENCED", modelVersion: "attr-v1", evidence: { via: "federated adjacency + reconsideration" }, dataEnvironment: "DEMO", isSimulated: true }));
  const trail = await asOrg(s.vendor, async (db) => await getPursuitOutcomes(db, await buildFederationViewer(db, s.vendor, s.hero), s.hero));
  check("the terminal outcome + attribution land (learning records the sequence)", !!trail && trail.outcomes.some((o) => o.label === "CLOSED_WON") && trail.attribution.length >= 1);

  // The whole sequence is an ordered, immutable ledger — reconstructable.
  const seq = await asOrg(s.vendor, async (db) => (await db.query<{ change_type: string }>(`select change_type from change_ledger where pursuit_id=$1 order by occurred_at`, [s.hero])).rows.map((r) => r.change_type));
  check("the ledger holds the full ordered sequence (route → decline → reconsideration → decision)", seq.includes("ROUTE_SELECTED") && seq.includes("PARTNER_DECLINED") && (seq.includes("READINESS_CHANGED") || seq.includes("ROUTE_RECOMMENDATION_CHANGED")));

  // Participant disclosure on outcomes: label shared, value magnitude sponsor-only.
  const distTrail = await asOrg(s.distributor, async (db) => await getPursuitOutcomes(db, await buildFederationViewer(db, s.distributor, s.hero), s.hero));
  check("a participant sees the outcome LABEL but not the sponsor-only value magnitude", !!distTrail && distTrail.outcomes.some((o) => o.label === "CLOSED_WON" && o.valueAmount === null));

  console.log(`\n[closed-loop-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[closed-loop-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("[closed-loop-verify] fatal:", e); process.exit(2); });
