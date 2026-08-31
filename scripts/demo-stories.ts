/**
 * Canonical Design-Partner demo world (Phase 3a). Builds 4 deep hero narratives + 6
 * supporting records on top of scripts/demo-db.ts, from ONE canonical object set per
 * account so a commercial fact never changes between rooms. Everything is DEMO/is_simulated.
 *
 * Boot sequence:  npx tsx scripts/demo-db.ts && npx tsx scripts/demo-stories.ts
 *
 * Reconciliation (single source of truth → every room):
 *   companies → Accounts/Pursuits/Pipeline/Mapping/Partners/Today
 *   propensity_scores(+dims) → Accounts/Today/Pursuit band
 *   pursuits(+why_now) → Pursuits/Pursuit Detail/Today
 *   pursuit_route_snapshots → Pursuit Detail route / Accounts "through whom" / Partners influence
 *   opportunities(pursuit_id) → Pipeline == Accounts open-opps == Today disagreement (same row)
 *   partner_capabilities/_relationships → route intelligence / Partners / Mapping
 *   account_populations/_members → Mapping overlap / Accounts partner
 *   participants/grants/contributions → Pursuit Detail federation / disclosure / Partners joint
 *   revenue_motions/motion_actions → Queue
 *   pursuit_outcomes/attribution/change_ledger → Insights / Pipeline / Today activity
 *
 * Each layer is defensive: a failing layer logs and does not abort the rest.
 */
import { Pool, type PoolClient } from "pg";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { recomputeRoute } from "../src/lib/routing/route-model";
import { selectPartnerRoute } from "../src/lib/routing/override";
import { assembleTeam } from "../src/lib/routing/team";
import { addParticipant, acceptParticipation } from "../src/lib/pursuits/federation/participation";
import { proposeGrant, acceptGrant } from "../src/lib/pursuits/federation/grants";
import { recordContribution } from "../src/lib/pursuits/federation/contributions";
import { recordOutcome, recordAttribution } from "../src/lib/pursuits/federation/outcomes";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const pool = new Pool({ connectionString: URL, max: 1 });
const log = (m: string) => console.log("[demo-stories] " + m);

async function tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
async function layer(name: string, fn: () => Promise<void>) {
  try { await fn(); log("✓ " + name); } catch (e) { log("✗ " + name + " — " + (e as Error).message); }
}

// --- Canonical account spec. Each row drives every room consistently. ---
type Band = "very_high" | "high" | "medium" | "low";
interface Acct {
  name: string; industry: string; score: number; band: Band;
  timing: number | null;               // null = UNKNOWN (preserved, not manufactured)
  prio: number; prop: number; ev: number; evw: number;
  pursuitType: string; use: string; problem: string;
  opp: { name: string; stage: string; amt: number; silentDays?: number };
  route?: "CDW" | "WWT";               // recommended partner (route intelligence)
  override?: "CDW" | "WWT";            // human selection ≠ recommendation
  rels?: Array<{ p: "CDW" | "WWT"; strength: number; tenure: number }>;
  hero?: string;                       // hero tag
}

const ACCTS: Acct[] = [
  // ---- Hero B: Umbrella — late-stage silent (systems disagree) ----
  { name: "Umbrella Health Systems", industry: "Healthcare", score: 88, band: "very_high", timing: 66,
    prio: 84, prop: 79, ev: 74, evw: 1180000, pursuitType: "MODERNIZATION", use: "virtualization exit",
    problem: "Renewal-driven hypervisor migration across 9 hospitals",
    opp: { name: "Datacenter exit — phase 1", stage: "proposal", amt: 920000, silentDays: 34 },
    route: "CDW", rels: [{ p: "CDW", strength: 86, tenure: 30 }, { p: "WWT", strength: 61, tenure: 12 }], hero: "B · systems-disagree" },
  // ---- Hero C: Stark — strong propensity, UNKNOWN timing (preserved) ----
  { name: "Stark Industries LLC", industry: "Aerospace & Defense", score: 81, band: "very_high", timing: null,
    prio: 78, prop: 80, ev: 70, evw: 1450000, pursuitType: "MODERNIZATION", use: "platform modernization",
    problem: "Sovereign workloads leaving legacy virtualization — no verified renewal date yet",
    opp: { name: "Sovereign landing zone", stage: "business_validation", amt: 1450000 },
    route: "WWT", rels: [{ p: "WWT", strength: 82, tenure: 26 }, { p: "CDW", strength: 58, tenure: 10 }], hero: "C · preserved-unknown" },
  // ---- Hero D: Cyberdyne — multi-partner overlap (channel thesis) ----
  { name: "Cyberdyne Systems", industry: "Robotics & AI", score: 79, band: "high", timing: 62,
    prio: 76, prop: 74, ev: 66, evw: 1120000, pursuitType: "MODERNIZATION", use: "platform modernization",
    problem: "Control-plane modernization; two resellers both credibly positioned",
    opp: { name: "Control-plane modernization", stage: "qualification", amt: 1120000 },
    route: "CDW", rels: [{ p: "CDW", strength: 77, tenure: 20 }, { p: "WWT", strength: 74, tenure: 18 }], hero: "D · multi-partner" },
  // ---- Six supporting ----
  { name: "Wayne Enterprises", industry: "Manufacturing", score: 74, band: "high", timing: 55,
    prio: 71, prop: 66, ev: 58, evw: 620000, pursuitType: "MODERNIZATION", use: "virtualization exit",
    problem: "Direct team and channel both claim the account",
    opp: { name: "VMware alternative pilot", stage: "discovery", amt: 380000 },
    route: "CDW", rels: [{ p: "CDW", strength: 70, tenure: 16 }, { p: "WWT", strength: 68, tenure: 15 }] },
  { name: "Acme Robotics", industry: "Industrial Automation", score: 68, band: "high", timing: 52,
    prio: 66, prop: 63, ev: 55, evw: 540000, pursuitType: "MODERNIZATION", use: "platform modernization",
    problem: "Competitive displacement of the incumbent control plane",
    opp: { name: "Incumbent displacement", stage: "qualification", amt: 540000 },
    route: "WWT", rels: [{ p: "WWT", strength: 72, tenure: 22 }] },
  { name: "Initech Financial (expansion)", industry: "Financial Services", score: 77, band: "high", timing: 63,
    prio: 75, prop: 72, ev: 66, evw: 990000, pursuitType: "EXPANSION", use: "resilience modernization",
    problem: "Regulatory DR posture upgrade — co-sell influenced win",
    opp: { name: "DR site build-out", stage: "closed_won", amt: 350000 },
    route: "CDW", rels: [{ p: "CDW", strength: 80, tenure: 28 }] },
  { name: "Tyrell Corp", industry: "Biotech", score: 49, band: "low", timing: 38,
    prio: 47, prop: 45, ev: 40, evw: 0, pursuitType: "NET_NEW", use: "greenfield platform",
    problem: "Evaluated, chose to defer — no decision this cycle",
    opp: { name: "Greenfield platform eval", stage: "closed_lost", amt: 300000 } },
  { name: "Hooli Cloud", industry: "Technology", score: 69, band: "high", timing: 60,
    prio: 67, prop: 70, ev: 55, evw: 710000, pursuitType: "EXPANSION", use: "ai platform",
    problem: "Renewal window with a dormant late-stage deal",
    opp: { name: "Kubernetes managed services", stage: "negotiation", amt: 710000, silentDays: 26 },
    route: "WWT", rels: [{ p: "WWT", strength: 69, tenure: 14 }] },
  { name: "Soylent Foods Co.", industry: "Consumer Goods", score: 57, band: "medium", timing: 41,
    prio: 55, prop: 52, ev: 44, evw: 210000, pursuitType: "NET_NEW", use: "edge modernization",
    problem: "Early-stage nurture; partner-led expansion candidate",
    opp: { name: "Edge compute refresh", stage: "discovery", amt: 210000 },
    route: "CDW", rels: [{ p: "CDW", strength: 60, tenure: 9 }] },
];

const DIMS = (a: Acct): Record<string, number> => ({
  purchase_need: Math.min(100, a.score + 4), purchase_propensity: a.prop,
  solution_fit: Math.min(100, a.score + 2), evidence_confidence: Math.max(30, a.ev),
  corroboration: Math.max(25, a.score - 15), convergence: Math.max(20, a.score - 18),
  activation_probability: Math.max(30, a.score - 6),
  ...(a.timing !== null ? { timing: a.timing } : {}),   // omit timing dim when UNKNOWN
});

async function main() {
  log("building canonical demo world → " + URL.replace(/:[^:@/]*@/, ":***@"));
  const base = await tx(async (db) => {
    const vendor = (await db.query<{ id: string }>(`select id from organizations where name='Vertex Systems' order by created_at asc limit 1`)).rows[0]?.id;
    const distributor = (await db.query<{ id: string }>(`select id from organizations where name='TD SYNNEX (demo)' limit 1`)).rows[0]?.id;
    const node = (await db.query<{ id: string }>(`select id from taxonomy_nodes where slug='virtualization' limit 1`)).rows[0]?.id;
    const cdw = (await db.query<{ id: string }>(`select id from partners where name='CDW' and org_id=$1 limit 1`, [vendor])).rows[0]?.id;
    const wwt = (await db.query<{ id: string }>(`select id from partners where name='WWT' and org_id=$1 limit 1`, [vendor])).rows[0]?.id;
    let ver = (await db.query<{ id: string }>(`select id from score_versions limit 1`)).rows[0]?.id;
    if (!ver) ver = (await db.query<{ id: string }>(`insert into score_versions (label, description, weights) values ('demo-v1','Illustrative synthetic scoring','{}'::jsonb) returning id`)).rows[0].id;
    if (!vendor || !node || !cdw || !wwt) throw new Error("run scripts/demo-db.ts first");
    return { vendor, distributor, node, cdw, wwt, ver };
  });
  const pid = (p?: "CDW" | "WWT") => (p === "CDW" ? base.cdw : p === "WWT" ? base.wwt : null);

  if (await tx(async (db) => !!(await db.query(`select 1 from companies where legal_name='Cyberdyne Systems'`)).rowCount)) {
    log("sentinel present (Cyberdyne) — already built, no-op."); await pool.end(); return;
  }

  const built: Record<string, { companyId: string; pursuitId: string; oppId: string }> = {};

  // Layer 1 — canonical accounts: identity + score + pursuit + opportunity + partner links.
  await layer("accounts + scores + pursuits + opportunities (reconciled)", async () => {
    for (const a of ACCTS) {
      await tx(async (db) => {
        await db.query("select set_config('app.org_id',$1,true)", [base.vendor]);
        const companyId = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name, industry, country) values ($1,$1,$2,'US') returning id`, [a.name, a.industry])).rows[0].id;
        for (const claim of [`${a.name} shows a modernization initiative in category.`, a.timing !== null ? `${a.name} renewal window opening within 2 quarters.` : `${a.name} timing unverified — no renewal/contract date on file.`])
          await db.query(`insert into evidence (org_id, company_id, source_type, claim, confidence, observed_at, status, computed_confidence, first_party) values ($1,$2,'crm',$3,0.8,now(),'verified',0.8,true)`, [base.vendor, companyId, claim]);
        const scoreId = (await db.query<{ id: string }>(`insert into propensity_scores (org_id, company_id, taxonomy_node_id, score, band, score_version_id, computed_at, positive_points, negative_points) values ($1,$2,$3,$4,$5,$6, now(), 3, 1) returning id`, [base.vendor, companyId, base.node, a.score, a.band, base.ver])).rows[0].id;
        for (const [d, v] of Object.entries(DIMS(a))) await db.query(`insert into propensity_dimensions (score_id, dimension, value) values ($1,$2,$3)`, [scoreId, d, v]);
        // partner links (route intelligence + through-whom)
        for (const r of (a.rels ?? [])) await db.query(`insert into partner_relationships (partner_id, company_id, strength, tenure_months) values ($1,$2,$3,$4)`, [pid(r.p), companyId, r.strength, r.tenure]);
        // pursuit (scores; timing null when UNKNOWN)
        const p = await upsertPursuit(db, { orgId: base.vendor, accountId: companyId, productCategoryId: base.node, pursuitType: a.pursuitType as never, useCase: a.use, businessProblem: a.problem, createdVia: "SYSTEM_DETECTED", dataEnvironment: "DEMO" });
        await db.query(`update pursuits set current_priority_score=$2, current_purchase_propensity_score=$3, current_evidence_confidence_score=$4, current_timing_score=$5, expected_value_weighted=$6, expected_value_currency='USD', data_environment='DEMO',
           why_now=$7 where id=$1`, [p.id, a.prio, a.prop, a.ev, a.timing, a.evw || null,
          JSON.stringify({ version: 1, as_of: new Date().toISOString(), business_trigger: { predicate: "strategic_initiative", label: a.name }, timing_anchor: a.timing !== null ? { label: "renewal window", confidence: 0.7 } : null, signal_convergence: { independent_family_count: a.timing !== null ? 2 : 1 }, contradictory_evidence: [], evidence_gap: a.timing === null ? "A verified renewal or contract-end date would materially raise timing and priority." : null })]);
        // opportunity linked to the pursuit (Pipeline == Accounts == Today, one row)
        const oppId = (await db.query<{ id: string }>(`insert into opportunities (org_id, company_id, taxonomy_node_id, name, stage, amount_usd, next_step, expected_close_date, pursuit_id, created_at, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7, now() + interval '45 days', $8, now() - ($9 * interval '1 day'), now() - ($9 * interval '1 day')) returning id`,
          [base.vendor, companyId, base.node, a.opp.name, a.opp.stage, a.opp.amt, a.opp.stage.startsWith("closed") ? "—" : "Advance to next stage", p.id, a.opp.silentDays ?? 3])).rows[0].id;
        built[a.name] = { companyId, pursuitId: p.id, oppId };
      });
    }
  });

  // Layer 1b — reconcile the flagship (Globex) into Accounts + Pipeline (demo-db gave it a
  // pursuit + route + disclosure, but no score/opportunity). Same canonical object, every room.
  await layer("flagship Globex → Accounts + Pipeline reconciliation", async () => {
    await tx(async (db) => {
      await db.query("select set_config('app.org_id',$1,true)", [base.vendor]);
      const g = (await db.query<{ id: string; pid: string }>(`select c.id, p.id as pid from companies c join pursuits p on p.account_id=c.id where c.legal_name='Globex Manufacturing Inc.' order by p.created_at asc limit 1`)).rows[0];
      if (!g) throw new Error("Globex hero not found");
      if (!(await db.query(`select 1 from propensity_scores where company_id=$1`, [g.id])).rowCount) {
        const sid = (await db.query<{ id: string }>(`insert into propensity_scores (org_id, company_id, taxonomy_node_id, score, band, score_version_id, computed_at, positive_points, negative_points) values ($1,$2,$3,86,'very_high',$4, now(), 4, 1) returning id`, [base.vendor, g.id, base.node, base.ver])).rows[0].id;
        for (const [d, v] of Object.entries({ purchase_need: 90, purchase_propensity: 84, solution_fit: 88, evidence_confidence: 79, timing: 62, corroboration: 70, convergence: 66, activation_probability: 80 }))
          await db.query(`insert into propensity_dimensions (score_id, dimension, value) values ($1,$2,$3)`, [sid, d, v]);
      }
      if (!(await db.query(`select 1 from opportunities where company_id=$1`, [g.id])).rowCount)
        await db.query(`insert into opportunities (org_id, company_id, taxonomy_node_id, name, stage, amount_usd, next_step, expected_close_date, pursuit_id, created_at, updated_at) values ($1,$2,$3,'Legacy virtualization exit','proposal',920000,'Partner-led close via WWT', now() + interval '40 days', $4, now(), now())`, [base.vendor, g.id, base.node, g.pid]);
      // score the flagship's second pursuit (AI platform) so the portfolio has no "Unknown ×5" row
      await db.query(`update pursuits set current_priority_score=64, current_purchase_propensity_score=61, current_evidence_confidence_score=52, current_timing_score=48, expected_value_weighted=560000, expected_value_currency='USD' where account_id=$1 and id<>$2 and current_priority_score is null`, [g.id, g.pid]);
    });
  });

  // Layer 2 — route recommendation per pursuit + human override on the flagship-style accounts.
  await layer("route recommendation + human override (recommendation ≠ decision)", async () => {
    for (const a of ACCTS) {
      const b = built[a.name]; if (!b || !a.route) continue;
      await tx(async (db) => {
        await db.query("select set_config('app.org_id',$1,true)", [base.vendor]);
        await recomputeRoute(db, b.pursuitId, new Date(), "DEMO");
        await assembleTeam(db, b.pursuitId, "DEMO").catch(() => {});
        // a confidential, restricted route reason (disclosure story) on the recommended candidate
        const rc = (await db.query<{ id: string }>(`select rc.id from route_candidates rc join pursuit_route_snapshots sn on sn.id=rc.route_snapshot_id where sn.pursuit_id=$1 and sn.is_current and rc.is_recommended`, [b.pursuitId])).rows[0];
        if (rc) await db.query(`insert into route_candidate_reasons (candidate_id, org_id, reason_code, polarity, detail, disclosure_class) values ($1,$2,'RAW_SPEND',1,$3,'RESTRICTED')`, [rc.id, base.vendor, `${a.route} category spend $${(a.opp.amt * 1.4).toFixed(0)} — vendor-internal`]);
      });
      if (a.override && a.override !== a.route) await tx(async (db) => {
        await db.query("select set_config('app.org_id',$1,true)", [base.vendor]);
        await selectPartnerRoute(db, b.pursuitId, { partnerId: pid(a.override)!, actorId: crypto.randomUUID(), reason: "executive relationship", category: "EXECUTIVE_DIRECTION" });
      });
    }
  });

  // Layer 3 — Cyberdyne federation (multi-partner, cross-company thesis) + participants/grant.
  await layer("Cyberdyne multi-org participation + grant + contribution", async () => {
    const b = built["Cyberdyne Systems"]; if (!b || !base.distributor) throw new Error("cyberdyne/distributor missing");
    const { seedGovernedSkills } = await import("../src/lib/pursuits/federation/skills");
    await tx(async (db) => { await db.query("select set_config('app.org_id',$1,true)", [base.vendor]); await seedGovernedSkills(db); });
    const partId = await tx(async (db) => { await db.query("select set_config('app.org_id',$1,true)", [base.vendor]);
      await addParticipant(db, { pursuitId: b.pursuitId, orgId: base.vendor, roleKey: "VENDOR", sponsorOrgId: base.vendor, state: "ACTIVE" });
      return addParticipant(db, { pursuitId: b.pursuitId, orgId: base.distributor!, roleKey: "DISTRIBUTOR", sponsorOrgId: base.vendor }); });
    await tx(async (db) => { await db.query("select set_config('app.org_id',$1,true)", [base.distributor!]); await acceptParticipation(db, partId); });
    const g = await tx(async (db) => { await db.query("select set_config('app.org_id',$1,true)", [base.distributor!]);
      return proposeGrant(db, { pursuitId: b.pursuitId, fromOrgId: base.distributor!, toOrgId: base.vendor, grantKind: "DATA", purpose: "co-sell context", informationClasses: ["transaction_adjacency"] }); });
    await tx(async (db) => { await db.query("select set_config('app.org_id',$1,true)", [base.vendor]); await acceptGrant(db, g); });
    await tx(async (db) => { await db.query("select set_config('app.org_id',$1,true)", [base.distributor!]);
      await recordContribution(db, { pursuitId: b.pursuitId, sourceOrgId: base.distributor!, mode: "FEDERATED", dataCategory: "transaction_adjacency", semanticMeaning: "Distributor adjacency favors the CDW path over WWT", disclosureClass: "PARTICIPANT_SHARED", sensitivityClass: "CONFIDENTIAL", purpose: "co-sell", consentGrantId: g, isSimulated: true }); });
  });

  // Layer 4 — outcomes + attribution (Insights / Pipeline / Today activity).
  await layer("outcomes + attribution", async () => {
    for (const [name, label, val] of [["Initech Financial (expansion)", "CLOSED_WON", 350000], ["Umbrella Health Systems", "MEETING_BOOKED", null], ["Tyrell Corp", "CLOSED_LOST", null]] as const) {
      const b = built[name]; if (!b) continue;
      await tx(async (db) => { await db.query("select set_config('app.org_id',$1,true)", [base.vendor]);
        const oid = await recordOutcome(db, { orgId: base.vendor, pursuitId: b.pursuitId, label, valueAmount: val, occurredAt: new Date(Date.now() - 2 * 86400000), dataEnvironment: "DEMO", isSimulated: true });
        if (label === "CLOSED_WON") await recordAttribution(db, { orgId: base.vendor, pursuitId: b.pursuitId, outcomeId: oid, subjectKind: "PARTNER", subjectLabel: "CDW", attributionClass: "INFLUENCED", modelVersion: "attr-v1", evidence: { via: "co-sell adjacency" }, dataEnvironment: "DEMO", isSimulated: true }); });
    }
  });

  // Layer 5 — Queue: active motions + dated actions (awaiting / due / overdue / cross-org / done).
  await layer("Queue action set (governed, traceable to accounts)", async () => {
    const plan: Array<{ name: string; step: number; action: string; dueDays: number; status: string }> = [
      { name: "Globex Manufacturing Inc.", step: 1, action: "Approve WWT route brief before sending to partner", dueDays: 0, status: "pending" },
      { name: "Umbrella Health Systems", step: 1, action: "Intervene — late-stage deal silent 34 days; re-engage economic buyer", dueDays: 0, status: "pending" },
      { name: "Hooli Cloud", step: 1, action: "Follow up — renewal window closing, deal dormant", dueDays: -3, status: "pending" },
      { name: "Cyberdyne Systems", step: 1, action: "Awaiting distributor acceptance of shared pursuit role", dueDays: 2, status: "pending" },
      { name: "Initech Financial (expansion)", step: 1, action: "Log co-sell win and settle influence", dueDays: -1, status: "done" },
    ];
    for (const it of plan) {
      const b = built[it.name] ?? (it.name.startsWith("Globex") ? { companyId: (await tx((db) => db.query<{ id: string }>(`select id from companies where legal_name=$1 limit 1`, [it.name]).then((r) => r.rows[0]))).id, pursuitId: "", oppId: "" } : null);
      if (!b) continue;
      await tx(async (db) => {
        await db.query("select set_config('app.org_id',$1,true)", [base.vendor]);
        const partnerId = it.name === "Cyberdyne Systems" ? base.cdw : it.name.startsWith("Globex") ? base.wwt : base.cdw;
        const m = (await db.query<{ id: string }>(`insert into revenue_motions (org_id, company_id, taxonomy_node_id, partner_id, status, thesis, trigger_summary, estimated_value_usd, activated_at, created_at) values ($1,$2,$3,$4,'active',$5,$6,$7, now(), now()) returning id`,
          [base.vendor, b.companyId, base.node, partnerId, it.action, "canonical demo motion", 250000])).rows[0].id;
        await db.query(`insert into motion_actions (org_id, motion_id, step, action, due_at, status, completed_at) values ($1,$2,$3,$4, now() + ($5 * interval '1 day'), $6, $7)`,
          [base.vendor, m, it.step, it.action, it.dueDays, it.status, it.status === "done" ? new Date(Date.now() - 86400000) : null]);
      });
    }
  });

  // Layer 6 — Mapping: our list × partner lists, with the multi-partner (Cyberdyne) overlap.
  await layer("Mapping populations + overlap (canonical accounts)", async () => {
    await tx(async (db) => {
      await db.query("select set_config('app.org_id',$1,true)", [base.vendor]);
      const mk = async (name: string, category: string, partnerId: string | null) =>
        (await db.query<{ id: string }>(`insert into account_populations (org_id, partner_id, name, category, status, selected_fields) values ($1,$2,$3,$4,'approved', ARRAY[]::text[]) returning id`, [base.vendor, partnerId, name, category])).rows[0].id;
      const add = async (popId: string, names: string[]) => { for (const n of names) { const c = (await db.query<{ id: string }>(`select id from companies where legal_name=$1 limit 1`, [n])).rows[0]; if (c) await db.query(`insert into population_members (population_id, company_id, attributes) values ($1,$2,'{}'::jsonb) on conflict do nothing`, [popId, c.id]); } };
      const ours = await mk("Our modernization targets", "target", null);
      await add(ours, ACCTS.map((a) => a.name).concat(["Globex Manufacturing Inc."]));
      const cdwList = await mk("CDW customer book", "customer", base.cdw);
      await add(cdwList, ["Cyberdyne Systems", "Umbrella Health Systems", "Wayne Enterprises", "Globex Manufacturing Inc.", "Initech Financial (expansion)", "Soylent Foods Co."]);
      const wwtList = await mk("WWT customer book", "customer", base.wwt);
      await add(wwtList, ["Cyberdyne Systems", "Stark Industries LLC", "Wayne Enterprises", "Acme Robotics", "Hooli Cloud"]);
    });
  });

  // Layer 7 — Partners: partnership + book (partner_accounts) + a joint room.
  await layer("Partners book + joint room (canonical)", async () => {
    await tx(async (db) => {
      await db.query("select set_config('app.org_id',$1,true)", [base.vendor]);
      const book: Record<"CDW" | "WWT", string[]> = {
        CDW: ["Cyberdyne Systems", "Umbrella Health Systems", "Wayne Enterprises", "Globex Manufacturing Inc.", "Initech Financial (expansion)", "Soylent Foods Co."],
        WWT: ["Cyberdyne Systems", "Stark Industries LLC", "Wayne Enterprises", "Acme Robotics", "Hooli Cloud"],
      };
      for (const p of ["CDW", "WWT"] as const) for (const n of book[p]) {
        const c = (await db.query<{ id: string }>(`select id from companies where legal_name=$1 limit 1`, [n])).rows[0];
        if (c) await db.query(`insert into partner_accounts (org_id, partner_id, company_id, target_product) values ($1,$2,$3,'Infrastructure Automation') on conflict do nothing`, [base.vendor, pid(p), c.id]).catch(() => {});
      }
      // a partnership + joint room on the multi-partner account (Partners "joint rooms")
      if (base.distributor) {
        const cyb = (await db.query<{ id: string }>(`select id from companies where legal_name='Cyberdyne Systems' limit 1`)).rows[0]?.id;
        const partnership = (await db.query<{ id: string }>(`insert into partnerships (initiator_org_id, counterpart_org_id, invite_code, status, activated_at) values ($1,$2,$3,'active', now()) returning id`, [base.vendor, base.distributor, "demo-" + Math.random().toString(36).slice(2, 8)])).rows[0].id;
        if (cyb) await db.query(`insert into joint_pursuits (partnership_id, company_id, name, proposed_by_org, status) values ($1,$2,'Cyberdyne control-plane modernization',$3,'active')`, [partnership, cyb, base.vendor]);
      }
    });
  });

  log("done — 4 hero + 6 supporting, reconciled (DEMO/synthetic).");
  await pool.end();
}
main().catch((e) => { console.error("[demo-stories] fatal:", e); pool.end(); process.exit(1); });
