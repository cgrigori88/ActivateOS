import { Pool, type PoolClient } from "pg";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { transitionPursuit, IllegalPursuitTransition } from "../src/lib/pursuits/lifecycle";
import { writeScoreSnapshot } from "../src/lib/pursuits/scoring";
import { linkContext } from "../src/lib/pursuits/context-links";
import { recordOverride } from "../src/lib/pursuits/overrides";
import { backfillOrg } from "../src/lib/pursuits/reparent";
import { pursuitsEnabled } from "../src/lib/pursuits/flags";

/**
 * Workstream A Phase 4 — BLIND VERIFICATION harness (§41 step 14 / §43 checklist).
 *
 * Exercises the REAL Pursuit domain services against a fresh database seeded with two
 * tenants, running every mutation as the non-owner `app_rw` role with the app.org_id
 * GUC set — exactly as production scopes it — so RLS is genuinely under test, not
 * bypassed. Superuser is used ONLY to seed global/reference rows.
 *
 *   DATABASE_URL_VERIFY=postgresql://postgres@localhost:5433/wsa_verify \
 *     npx tsx scripts/pursuit-verify.ts
 *
 * Exit 0 iff every assertion in the §43 Definition-of-Done checklist passes.
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres@localhost:5433/wsa_verify";
const pool = new Pool({ connectionString: CONN });

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

/** Run fn as the app: non-owner app_rw role + org GUC, inside one transaction. */
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role app_rw");
    await c.query("select set_config('app.org_id', $1, true)", [orgId]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; }
  finally { c.release(); }
}

/** Run fn as owner (superuser, RLS bypassed) — seeding only. */
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; }
  finally { c.release(); }
}

interface Seed {
  orgA: string; orgB: string;
  companyA: string; companyB: string;
  product: string; taxonomy: string;
  partner1: string; partner2: string; seller1: string; sellerB: string;
  scoreVersion: string;
}

async function seed(): Promise<Seed> {
  return asOwner(async (db) => {
    const org = async (name: string) => (await db.query<{ id: string }>(`insert into organizations (name) values ($1) returning id`, [name])).rows[0].id;
    const orgA = await org("Tenant A");
    const orgB = await org("Tenant B");
    const vendor = (await db.query<{ id: string }>(`insert into vendors (name) values ('Acme') returning id`)).rows[0].id;
    const product = (await db.query<{ id: string }>(`insert into products (vendor_id, name) values ($1,'Platform') returning id`, [vendor])).rows[0].id;
    const taxonomy = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name) values ('Cloud Migration') returning id`)).rows[0].id;
    const company = async (n: string) => (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name) values ($1,$1) returning id`, [n])).rows[0].id;
    const companyA = await company("Globex");
    const companyB = await company("Initech");
    const partner = async (o: string, n: string) => (await db.query<{ id: string }>(`insert into partners (org_id, name, capacity) values ($1,$2,10) returning id`, [o, n])).rows[0].id;
    const partner1 = await partner(orgA, "Partner One");
    const partner2 = await partner(orgA, "Partner Two");
    const seller = async (o: string, n: string) => (await db.query<{ id: string }>(`insert into sellers (org_id, name) values ($1,$2) returning id`, [o, n])).rows[0].id;
    const seller1 = await seller(orgA, "Rep A");
    const sellerB = await seller(orgB, "Rep B");
    const scoreVersion = (await db.query<{ id: string }>(`insert into score_versions (label, description) values ('v-test','test') returning id`)).rows[0].id;

    // Legacy motions for the backfill test (org A): two distinct theses + one dup-shaped.
    const mk = async (o: string, co: string, thesis: string, status: string) =>
      (await db.query<{ id: string }>(
        `insert into revenue_motions (org_id, company_id, taxonomy_node_id, product_id, partner_id, status, thesis, vendor_seller_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [o, co, taxonomy, product, partner1, status, thesis, seller1],
      )).rows[0].id;
    const m1 = await mk(orgA, companyA, "Cloud migration modernization for Globex", "approved");
    await mk(orgA, companyA, "Renewal attach on Globex platform", "draft");
    // Propensity for the seeded snapshot during backfill.
    await db.query(
      `insert into propensity_scores (org_id, company_id, taxonomy_node_id, score, band, score_version_id)
       values ($1,$2,$3,72,'high',$4)`,
      [orgA, companyA, taxonomy, scoreVersion],
    );
    // Opportunity + campaign hanging off m1 (should link to its pursuit).
    await db.query(`insert into opportunities (org_id, company_id, motion_id, name) values ($1,$2,$3,'Globex Q3')`, [orgA, companyA, m1]);
    await db.query(`insert into campaigns (org_id, motion_id, name) values ($1,$2,'Globex nurture')`, [orgA, m1]);

    return { orgA, orgB, companyA, companyB, product, taxonomy, partner1, partner2, seller1, sellerB, scoreVersion };
  });
}

async function main() {
  console.log(`[verify] connecting: ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  const s = await seed();
  console.log(`[verify] seeded orgA=${s.orgA.slice(0, 8)} orgB=${s.orgB.slice(0, 8)}\n`);

  // ---- 1. Creation ----------------------------------------------------------
  console.log("§43.1  Pursuit creation");
  const p1 = await asOrg(s.orgA, (db) => upsertPursuit(db, {
    orgId: s.orgA, accountId: s.companyA, productId: s.product, productCategoryId: s.taxonomy,
    pursuitType: "MODERNIZATION", useCase: "infra ops automation", businessProblem: "Legacy infra",
    createdByActorType: "human", createdVia: "USER_CREATED",
  }));
  check("new thesis → CREATED", p1.mode === "CREATED", `got ${p1.mode}`);

  // ---- 2. Idempotency / dedup ----------------------------------------------
  console.log("§43.13  Idempotency — same thesis does not fork");
  const p1b = await asOrg(s.orgA, (db) => upsertPursuit(db, {
    orgId: s.orgA, accountId: s.companyA, productId: s.product, productCategoryId: s.taxonomy,
    pursuitType: "MODERNIZATION", useCase: "Infra-Ops  Automation!", // different casing/spacing → same normalized token
    createdByActorType: "human", createdVia: "USER_CREATED",
  }));
  check("same thesis → MATCHED_EXISTING", p1b.mode === "MATCHED_EXISTING", `got ${p1b.mode}`);
  check("same thesis → same id", p1b.id === p1.id);
  check("dedup key stable across casing/spacing", p1b.dedupKey === p1.dedupKey);

  // ---- 3. Distinct thesis coexists (use_case discriminator) -----------------
  console.log("§43.3  Distinct thesis on same account/product/type coexists");
  const p2 = await asOrg(s.orgA, (db) => upsertPursuit(db, {
    orgId: s.orgA, accountId: s.companyA, productId: s.product, productCategoryId: s.taxonomy,
    pursuitType: "MODERNIZATION", useCase: "network automation", // genuinely different use case
    createdByActorType: "human", createdVia: "USER_CREATED",
  }));
  check("different use_case → CREATED (separate pursuit)", p2.mode === "CREATED", `got ${p2.mode}`);
  check("different use_case → different id", p2.id !== p1.id);
  check("different use_case → different dedup key", p2.dedupKey !== p1.dedupKey);

  // ---- 4. Valid lifecycle ---------------------------------------------------
  console.log("§43.4  Valid lifecycle transitions");
  const t1 = await asOrg(s.orgA, (db) => transitionPursuit(db, p1.id, "RESEARCHING", { reason: "start", actorType: "USER" }));
  check("DETECTED → RESEARCHING", t1.changed && t1.to === "RESEARCHING");
  const t2 = await asOrg(s.orgA, (db) => transitionPursuit(db, p1.id, "QUALIFIED", { reason: "qual", actorType: "USER" }));
  check("RESEARCHING → QUALIFIED", t2.changed && t2.to === "QUALIFIED");

  // ---- 5. Invalid lifecycle rejected ---------------------------------------
  console.log("§43.5  Illegal transition rejected");
  let illegalThrew = false;
  try {
    await asOrg(s.orgA, (db) => transitionPursuit(db, p2.id, "WON", { reason: "cheat" }));
  } catch (e) { illegalThrew = e instanceof IllegalPursuitTransition; }
  check("DETECTED → WON throws IllegalPursuitTransition", illegalThrew);

  // ---- 6. Reroute/retime does NOT fork -------------------------------------
  console.log("§43.6  Rerouting / retiming does not fork the pursuit");
  await asOrg(s.orgA, async (db) => {
    await db.query(`update pursuits set selected_partner_id=$2, recommended_partner_id=$3, timing_window=$4 where id=$1`,
      [p1.id, s.partner2, s.partner1, "3-6m"]);
  });
  const p1c = await asOrg(s.orgA, (db) => upsertPursuit(db, {
    orgId: s.orgA, accountId: s.companyA, productId: s.product, productCategoryId: s.taxonomy,
    pursuitType: "MODERNIZATION", useCase: "infra ops automation", createdVia: "SYSTEM_DETECTED",
  }));
  check("re-upsert after reroute/retime → MATCHED_EXISTING", p1c.mode === "MATCHED_EXISTING", `got ${p1c.mode}`);
  check("re-upsert after reroute → same id", p1c.id === p1.id);

  // ---- 7. Append-only scoring + one-current --------------------------------
  console.log("§43.7  Append-only scoring, exactly one current snapshot, history intact");
  const now = new Date();
  const snap1 = await asOrg(s.orgA, (db) => writeScoreSnapshot(db, {
    pursuitId: p1.id, scoreVersionId: s.scoreVersion, asOf: now,
    dimensions: [{ dimension: "pursuit_priority", value: 40 }, { dimension: "purchase_propensity", value: 55 }],
    contributions: [{ dimension: "purchase_propensity", featureName: "signal_x", contribution: 55, rawValue: 55, normalizedValue: 0.55, weight: 1, referenceKind: "signal", featureObservedAt: now }],
    reason: "first",
  }));
  const snap2 = await asOrg(s.orgA, (db) => writeScoreSnapshot(db, {
    pursuitId: p1.id, scoreVersionId: s.scoreVersion, asOf: new Date(now.getTime() + 1000),
    dimensions: [{ dimension: "pursuit_priority", value: 65 }, { dimension: "purchase_propensity", value: 70 }],
    contributions: [{ dimension: "purchase_propensity", featureName: "signal_x", contribution: 70, rawValue: 70, normalizedValue: 0.7, weight: 1, referenceKind: "signal", featureObservedAt: new Date(now.getTime() + 1000) }],
    reason: "second",
  }));
  check("snapshot seq increments 1 → 2", snap1.seq === 1 && snap2.seq === 2, `${snap1.seq},${snap2.seq}`);
  check("priority delta computed on 2nd snapshot", snap2.priorityDelta === 25, `got ${snap2.priorityDelta}`);
  await asOrg(s.orgA, async (db) => {
    const all = await db.query<{ n: string }>(`select count(*)::text n from pursuit_score_snapshots where pursuit_id=$1`, [p1.id]);
    check("history intact — both snapshots retained", all.rows[0].n === "2", `n=${all.rows[0].n}`);
    const cur = await db.query<{ n: string; seq: number }>(`select count(*)::text n, max(seq) seq from pursuit_score_snapshots where pursuit_id=$1 and is_current`, [p1.id]);
    check("exactly one current snapshot", cur.rows[0].n === "1", `n=${cur.rows[0].n}`);
    check("current snapshot is the latest (seq 2)", Number(cur.rows[0].seq) === 2);
    const cache = await db.query<{ current_priority_score: string | null; current_score_snapshot_id: string | null }>(
      `select current_priority_score, current_score_snapshot_id from pursuits where id=$1`, [p1.id]);
    check("cache reflects latest priority (65)", Number(cache.rows[0].current_priority_score) === 65, `got ${cache.rows[0].current_priority_score}`);
    check("cache points at current snapshot", cache.rows[0].current_score_snapshot_id === snap2.snapshotId);
    // Explainability: dimensions + contributions with feature_observed_at.
    const dims = await db.query<{ n: string }>(`select count(*)::text n from pursuit_score_dimensions where snapshot_id=$1`, [snap2.snapshotId]);
    check("explainability — dimension rows present", Number(dims.rows[0].n) >= 2, `n=${dims.rows[0].n}`);
    const contrib = await db.query<{ n: string }>(`select count(*)::text n from pursuit_score_contributions where snapshot_id=$1 and feature_observed_at is not null`, [snap2.snapshotId]);
    check("explainability — contributions carry feature_observed_at", Number(contrib.rows[0].n) >= 1, `n=${contrib.rows[0].n}`);
  });

  // ---- 8. Shared context is M:N --------------------------------------------
  console.log("§43.9  Shared context objects are many-to-many");
  const evidenceRef = crypto.randomUUID();
  await asOrg(s.orgA, async (db) => {
    await linkContext(db, "evidence", p1.id, evidenceRef, { relevanceType: "PRIMARY_TRIGGER", relevanceScore: 0.9, reason: "trigger" });
    await linkContext(db, "evidence", p2.id, evidenceRef, { relevanceType: "SUPPORTING_CONTEXT", relevanceScore: 0.4, reason: "context" });
    await linkContext(db, "evidence", p1.id, evidenceRef, { relevanceType: "PRIMARY_TRIGGER", relevanceScore: 0.95 }); // idempotent update
    const n = await db.query<{ n: string }>(`select count(*)::text n from pursuit_evidence where ref_id=$1`, [evidenceRef]);
    check("one evidence ref links to two pursuits (M:N)", n.rows[0].n === "2", `n=${n.rows[0].n}`);
    const dup = await db.query<{ n: string }>(`select count(*)::text n from pursuit_evidence where pursuit_id=$1 and ref_id=$2`, [p1.id, evidenceRef]);
    check("re-link is idempotent (no duplicate row)", dup.rows[0].n === "1", `n=${dup.rows[0].n}`);
    const meta = await db.query<{ relevance_score: string }>(`select relevance_score from pursuit_evidence where pursuit_id=$1 and ref_id=$2`, [p1.id, evidenceRef]);
    check("relevance metadata updated on re-link", Number(meta.rows[0].relevance_score) === 0.95);
  });

  // ---- 9. Change ledger (actor ≠ trigger) ----------------------------------
  console.log("§43.11  Change ledger records with actor distinct from trigger");
  await asOrg(s.orgA, async (db) => {
    const created = await db.query<{ n: string }>(`select count(*)::text n from change_ledger where pursuit_id=$1 and change_type='PURSUIT_CREATED'`, [p1.id]);
    check("PURSUIT_CREATED recorded", Number(created.rows[0].n) === 1, `n=${created.rows[0].n}`);
    const status = await db.query<{ n: string }>(`select count(*)::text n from change_ledger where pursuit_id=$1 and change_type='STATUS_CHANGED'`, [p1.id]);
    check("STATUS_CHANGED recorded (2 transitions)", Number(status.rows[0].n) === 2, `n=${status.rows[0].n}`);
    const score = await db.query<{ n: string }>(`select count(*)::text n from change_ledger where pursuit_id=$1 and change_type='SCORE_CHANGED'`, [p1.id]);
    check("SCORE_CHANGED recorded (2 snapshots)", Number(score.rows[0].n) === 2, `n=${score.rows[0].n}`);
    const cols = await db.query<{ actor_type: string; trigger_type: string | null }>(
      `select actor_type, trigger_type from change_ledger where pursuit_id=$1 and change_type='PURSUIT_CREATED' limit 1`, [p1.id]);
    check("ledger stores actor_type AND trigger_type as distinct columns", "actor_type" in cols.rows[0] && "trigger_type" in cols.rows[0]);
  });

  // ---- 10. Human override ---------------------------------------------------
  console.log("§43  Human override captured (recommendation ≠ decision)");
  await asOrg(s.orgA, async (db) => {
    await recordOverride(db, {
      orgId: s.orgA, pursuitId: p1.id, field: "partner",
      originalRecommendation: { partnerId: s.partner1 }, humanDecision: { partnerId: s.partner2 },
      beforeValue: s.partner1, afterValue: s.partner2, reason: "relationship strength", actorId: crypto.randomUUID(),
    });
    const ov = await db.query<{ n: string }>(`select count(*)::text n from pursuit_overrides where pursuit_id=$1 and field='partner'`, [p1.id]);
    check("override row written", ov.rows[0].n === "1", `n=${ov.rows[0].n}`);
    const led = await db.query<{ n: string; trigger_type: string }>(`select count(*)::text n, max(trigger_type) trigger_type from change_ledger where pursuit_id=$1 and change_type='OVERRIDE_RECORDED'`, [p1.id]);
    check("OVERRIDE_RECORDED ledger event written", Number(led.rows[0].n) === 1, `n=${led.rows[0].n}`);
    check("override trigger_type = USER_OVERRIDE", led.rows[0].trigger_type === "USER_OVERRIDE");
    const rec = await db.query<{ recommended_partner_id: string | null; selected_partner_id: string | null }>(
      `select recommended_partner_id, selected_partner_id from pursuits where id=$1`, [p1.id]);
    check("recommendation & decision columns are distinct", rec.rows[0].recommended_partner_id === s.partner1 && rec.rows[0].selected_partner_id === s.partner2);
  });

  // ---- 11. Backfill: deterministic + idempotent -----------------------------
  console.log("§43.12  Migration/backfill deterministic and idempotent");
  const b1 = await asOrg(s.orgA, (db) => backfillOrg(db, s.orgA));
  check("backfill run 1 saw 2 legacy motions", b1.motionsSeen === 2, `seen=${b1.motionsSeen}`);
  check("backfill run 1 created pursuits", b1.pursuitsCreated >= 1, `created=${b1.pursuitsCreated}`);
  check("backfill run 1 linked the opportunity", b1.opportunitiesLinked === 1, `opps=${b1.opportunitiesLinked}`);
  check("backfill run 1 linked the campaign", b1.campaignsLinked === 1, `camps=${b1.campaignsLinked}`);
  check("backfill run 1 seeded a directional snapshot", b1.snapshotsSeeded >= 1, `snaps=${b1.snapshotsSeeded}`);
  const b2 = await asOrg(s.orgA, (db) => backfillOrg(db, s.orgA));
  check("backfill run 2 creates 0 new pursuits (idempotent)", b2.pursuitsCreated === 0, `created=${b2.pursuitsCreated}`);
  check("backfill run 2 matches existing", b2.pursuitsMatched === b2.motionsSeen, `matched=${b2.pursuitsMatched}/${b2.motionsSeen}`);
  check("backfill run 2 re-links nothing (already linked)", b2.opportunitiesLinked === 0 && b2.campaignsLinked === 0);
  await asOrg(s.orgA, async (db) => {
    const migrated = await db.query<{ n: string }>(`select count(*)::text n from change_ledger where org_id=$1 and change_type='PURSUIT_MIGRATED'`, [s.orgA]);
    check("migrated pursuits carry PURSUIT_MIGRATED bootstrap (not per-field noise)", Number(migrated.rows[0].n) === b1.pursuitsCreated, `n=${migrated.rows[0].n} vs created ${b1.pursuitsCreated}`);
    const badType = await db.query<{ n: string }>(`select count(*)::text n from pursuits where org_id=$1 and created_via='MOTION_MIGRATION' and pursuit_type='NET_NEW'`, [s.orgA]);
    check("backfill never defaults legacy → NET_NEW (§24)", badType.rows[0].n === "0", `n=${badType.rows[0].n}`);
  });

  // ---- 12. Cross-tenant isolation ------------------------------------------
  console.log("§43  Cross-tenant isolation (RLS under app_rw)");
  // Give org B its own pursuit.
  const pB = await asOrg(s.orgB, (db) => upsertPursuit(db, {
    orgId: s.orgB, accountId: s.companyB, pursuitType: "NET_NEW", useCase: "greenfield", createdVia: "SYSTEM_DETECTED",
  }));
  check("org B can create its own pursuit", pB.mode === "CREATED");
  await asOrg(s.orgA, async (db) => {
    const seeB = await db.query<{ n: string }>(`select count(*)::text n from pursuits where id=$1`, [pB.id]);
    check("org A cannot SELECT org B's pursuit", seeB.rows[0].n === "0", `n=${seeB.rows[0].n}`);
    const anyB = await db.query<{ n: string }>(`select count(*)::text n from pursuits where org_id=$1`, [s.orgB]);
    check("org A sees zero rows scoped to org B", anyB.rows[0].n === "0", `n=${anyB.rows[0].n}`);
    // Ledger + child tables also isolated.
    const ledB = await db.query<{ n: string }>(`select count(*)::text n from change_ledger where org_id=$1`, [s.orgB]);
    check("org A cannot read org B's change ledger", ledB.rows[0].n === "0", `n=${ledB.rows[0].n}`);
  });
  // Write-side: org A cannot INSERT a row stamped for org B (RLS WITH CHECK).
  let crossInsertBlocked = false;
  try {
    await asOrg(s.orgA, (db) => upsertPursuit(db, {
      orgId: s.orgB, accountId: s.companyB, pursuitType: "OTHER", useCase: "smuggled", createdVia: "API",
    }));
  } catch (e) { crossInsertBlocked = /row-level security|violates/i.test((e as Error).message); }
  check("org A cannot INSERT a pursuit for org B (RLS WITH CHECK)", crossInsertBlocked);

  // ---- 13. Feature-flag rollback (code-level default) -----------------------
  console.log("§43  Feature flag default (rollback path)");
  check("PURSUITS_ENABLED defaults OFF (additive, dark by default)", !pursuitsEnabled(), `PURSUITS_ENABLED=${process.env.PURSUITS_ENABLED ?? "(unset)"}`);

  // ---- Summary --------------------------------------------------------------
  console.log(`\n[verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("[verify] fatal:", e); process.exit(2); });
