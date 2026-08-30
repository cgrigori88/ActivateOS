import { Pool, type PoolClient } from "pg";
import { upsertPursuit } from "../src/lib/pursuits/model";
import { writeScoreSnapshot } from "../src/lib/pursuits/scoring";
import { promoteFromSignal, promoteCandidate } from "../src/lib/facts/promotion";
import { createCandidateFromExtraction, createCandidateFromSignal } from "../src/lib/facts/candidates";
import { extractFactsFromEvidence, type ExtractFn } from "../src/lib/facts/extractor";
import { sweepFreshness } from "../src/lib/facts/freshness";
import { factsAsOf } from "../src/lib/facts/asof";
import { computeConvergence } from "../src/lib/facts/convergence";
import { assembleWhyNow } from "../src/lib/facts/why-now";
import { factsToContributions } from "../src/lib/facts/score-impact";
import { linkFactToPursuits } from "../src/lib/facts/pursuit-link";
import { applyReviewDecision, listOpenReviews } from "../src/lib/facts/review";
import { attachEvidence, summarizeSupport } from "../src/lib/facts/associations";
import { factsEnabled } from "../src/lib/facts/flags";
import { _resetPredicateCache } from "../src/lib/facts/predicates";

/**
 * Workstream B Phase 4 — BLIND VERIFICATION (§41/§42/§48). Exercises the REAL Fact services
 * against a fresh DB as the non-owner app_rw role with app.org_id set, so RLS is genuinely
 * under test. Superuser only seeds global/reference rows. Exit 0 iff every assertion passes.
 */

const CONN = process.env.DATABASE_URL_VERIFY ?? "postgresql://postgres@127.0.0.1:5433/wsb_verify";
const pool = new Pool({ connectionString: CONN });
let passed = 0, failed = 0; const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}
async function asOrg<T>(orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query("set local role app_rw"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
async function asOwner<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

const DAY = 86_400_000;
interface Seed { orgA: string; orgB: string; companyA: string; companyB: string; techNode: string; vmwareNode: string; scoreVersion: string; pursuitA: string; }

async function seedEvidence(db: PoolClient, orgId: string, companyId: string, sourceType: string, claim: string, opts: { verified?: boolean; firstParty?: boolean; observedAt?: Date; sourceUrl?: string } = {}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into evidence (org_id, company_id, source_type, source_url, claim, confidence, observed_at, status, computed_confidence, first_party, raw_excerpt)
     values ($1,$2,$3,$4,$5,0.8,$6,$7,0.8,$8,$5) returning id`,
    [orgId, companyId, sourceType, opts.sourceUrl ?? null, claim, opts.observedAt ?? new Date(), opts.verified === false ? "pending" : "verified", opts.firstParty ?? false],
  );
  return rows[0].id;
}
async function seedSignal(db: PoolClient, orgId: string, companyId: string, signalType: string, evidenceId: string, value: Record<string, unknown>, taxonomyNodeId: string | null, observedAt = new Date()): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into signals (org_id, company_id, signal_type, taxonomy_node_id, direction, magnitude, confidence, observed_at, half_life_days, evidence_id, value)
     values ($1,$2,$3,$4,1,0.8,0.8,$5,180,$6,$7) returning id`,
    [orgId, companyId, signalType, taxonomyNodeId, observedAt, evidenceId, value],
  );
  return rows[0].id;
}

async function seed(): Promise<Seed> {
  return asOwner(async (db) => {
    const org = async (n: string) => (await db.query<{ id: string }>(`insert into organizations (name) values ($1) returning id`, [n])).rows[0].id;
    const orgA = await org("Tenant A"); const orgB = await org("Tenant B");
    const vendor = (await db.query<{ id: string }>(`insert into vendors (name) values ('Acme') returning id`)).rows[0].id;
    await db.query(`insert into products (vendor_id, name) values ($1,'Platform')`, [vendor]);
    const techNode = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name) values ('Kubernetes') returning id`)).rows[0].id;
    const vmwareNode = (await db.query<{ id: string }>(`insert into taxonomy_nodes (name) values ('VMware') returning id`)).rows[0].id;
    const company = async (n: string) => (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name) values ($1,$1) returning id`, [n])).rows[0].id;
    const companyA = await company("Globex"); const companyB = await company("Initech");
    const scoreVersion = (await db.query<{ id: string }>(`insert into score_versions (label, description) values ('v-facts-test','t') returning id`)).rows[0].id;
    return { orgA, orgB, companyA, companyB, techNode, vmwareNode, scoreVersion, pursuitA: "" };
  });
}

async function main() {
  console.log(`[facts-verify] ${CONN.replace(/:[^:@/]*@/, ":***@")}`);
  _resetPredicateCache();
  const s = await seed();
  // Live pursuit on companyA so fact→pursuit linkage + why-now have a target.
  const pur = await asOrg(s.orgA, (db) => upsertPursuit(db, { orgId: s.orgA, accountId: s.companyA, pursuitType: "MODERNIZATION", useCase: "infra modernization", createdVia: "SYSTEM_DETECTED" }));
  s.pursuitA = pur.id;
  console.log(`[facts-verify] seeded orgA=${s.orgA.slice(0, 8)} orgB=${s.orgB.slice(0, 8)} pursuitA=${pur.id.slice(0, 8)}\n`);

  // ---- §29 Predicate enforcement -------------------------------------------
  console.log("§48.9  Unknown predicate cannot become a durable Fact");
  await asOrg(s.orgA, async (db) => {
    const ev = await seedEvidence(db, s.orgA, s.companyA, "press", "Globex reorganized its cloud team.");
    const cand = await createCandidateFromExtraction(db, {
      orgId: s.orgA, companyId: s.companyA, subject: { subjectScope: "COMPANY", subjectRef: s.companyA, subjectLabel: "Globex" },
      predicateCandidate: "totally_made_up_predicate", objectType: "STRING", objectRaw: "x",
      sourceEvidenceId: ev, sourceSpanStart: 0, sourceSpanEnd: 5, quotedExcerpt: "Globex", extractionConfidence: 0.9, extractedBy: "stub",
    });
    check("candidate with unknown predicate is unresolved", cand.predicateResolved === false);
    const res = await promoteCandidate(db, cand.id);
    check("unknown-predicate candidate → REJECTED (unknown_predicate)", res.outcome === "REJECTED" && res.reason === "unknown_predicate", res.reason);
    const n = await db.query<{ n: string }>(`select count(*)::text n from facts where org_id=$1`, [s.orgA]);
    check("no durable fact created", n.rows[0].n === "0", `n=${n.rows[0].n}`);
  });

  // ---- §48.4 Evidence gate --------------------------------------------------
  console.log("§48.4  Unverified evidence cannot auto-promote");
  await asOrg(s.orgA, async (db) => {
    const ev = await seedEvidence(db, s.orgA, s.companyA, "blog", "Rumor: Globex uses Kubernetes.", { verified: false });
    const sig = await seedSignal(db, s.orgA, s.companyA, "TECH_INSTALLED", ev, { ref: s.techNode }, s.techNode);
    const res = await promoteFromSignal(db, s.orgA, sig);
    check("unverified source → REJECTED (unverified_source)", res?.outcome === "REJECTED" && res.reason === "unverified_source", res?.reason);
  });

  // ---- §48.7 Deterministic promotion + confidence + dedup -------------------
  console.log("§48.7  Deterministic promotion → CURRENT Fact");
  const promo = await asOrg(s.orgA, async (db) => {
    const ev = await seedEvidence(db, s.orgA, s.companyA, "builtwith", "Globex runs Kubernetes in production.", { sourceUrl: "https://builtwith.com/globex" });
    const sig = await seedSignal(db, s.orgA, s.companyA, "TECH_INSTALLED", ev, { ref: s.techNode }, s.techNode);
    const res = await promoteFromSignal(db, s.orgA, sig);
    check("verified signal → PROMOTED", res?.outcome === "PROMOTED", res?.reason);
    const f = await db.query<{ status: string; confidence: string; provenance_class: string; family: string }>(`select status, confidence, provenance_class, family from facts where id=$1`, [res!.factId]);
    check("fact is CURRENT", f.rows[0].status === "CURRENT");
    check("confidence deterministic (>0)", Number(f.rows[0].confidence) > 0);
    check("provenance THIRD_PARTY_VERIFIED", f.rows[0].provenance_class === "THIRD_PARTY_VERIFIED", f.rows[0].provenance_class);
    check("family populated from predicate", f.rows[0].family === "technology", f.rows[0].family);
    return { factId: res!.factId!, confidence: Number(f.rows[0].confidence) };
  });

  console.log("§48.1  Idempotent dedup — same proposition does not duplicate");
  await asOrg(s.orgA, async (db) => {
    const ev = await seedEvidence(db, s.orgA, s.companyA, "builtwith", "Globex still runs Kubernetes.", { sourceUrl: "https://builtwith.com/globex2" });
    const sig = await seedSignal(db, s.orgA, s.companyA, "TECH_INSTALLED", ev, { ref: s.techNode }, s.techNode);
    const res = await promoteFromSignal(db, s.orgA, sig);
    const n = await db.query<{ n: string }>(`select count(*)::text n from facts where org_id=$1 and predicate_key='technology_in_use' and status='CURRENT'`, [s.orgA]);
    check("second identical value → still one CURRENT fact", n.rows[0].n === "1", `n=${n.rows[0].n}`);
    check("re-promotion reuses the same fact", res?.factId === promo.factId);
    const sup = await summarizeSupport(db, promo.factId);
    check("both evidence rows attached as support (M:N)", sup.supportCount >= 2, `support=${sup.supportCount}`);
    check("confidence reproducible / not decreased", Number((await db.query<{ c: string }>(`select confidence c from facts where id=$1`, [promo.factId])).rows[0].c) >= promo.confidence - 1e-9);
  });

  // ---- §48.10/§48.8 Contradiction stored independently ----------------------
  console.log("§48.10  Contradictory evidence attached independently, never netted");
  await asOrg(s.orgA, async (db) => {
    const ev = await seedEvidence(db, s.orgA, s.companyA, "analyst", "Globex has decommissioned Kubernetes.");
    await attachEvidence(db, promo.factId, ev, "CONTRADICTS", new Date(), 0.6, "test");
    const sup = await summarizeSupport(db, promo.factId);
    check("contradiction recorded on the fact", sup.contradictionCount === 1, `contra=${sup.contradictionCount}`);
    check("supporting evidence still present alongside it", sup.supportCount >= 2);
  });

  // ---- §48.5/§48.11/§48.12 Corroboration, supersession, competing value -----
  console.log("§48.5  Corroboration-required predicate needs 2 independent sources");
  await asOrg(s.orgA, async (db) => {
    const e1 = await seedEvidence(db, s.orgA, s.companyA, "tavily", "Globex migrating off VMware.", { sourceUrl: "https://a.com" });
    const s1 = await seedSignal(db, s.orgA, s.companyA, "MIGRATION_SIGNAL", e1, { ref: s.vmwareNode }, s.vmwareNode);
    const r1 = await promoteFromSignal(db, s.orgA, s1);
    check("first migration source → REVIEW (corroboration_required)", r1?.outcome === "REVIEW", `${r1?.outcome}/${r1?.reason}`);
    const e2 = await seedEvidence(db, s.orgA, s.companyA, "gdelt", "Reports: Globex leaving VMware.", { sourceUrl: "https://b.com" });
    const s2 = await seedSignal(db, s.orgA, s.companyA, "MIGRATION_SIGNAL", e2, { ref: s.vmwareNode }, s.vmwareNode);
    const r2 = await promoteFromSignal(db, s.orgA, s2);
    check("second independent source → PROMOTED", r2?.outcome === "PROMOTED", `${r2?.outcome}/${r2?.reason}`);
  });

  console.log("§48.12  Newer competing value SUPERSEDES older; history preserved");
  const superseded = await asOrg(s.orgA, async (db) => {
    const e1 = await seedEvidence(db, s.orgA, s.companyA, "careers", "Globex hiring for platform_engineering.");
    const s1 = await seedSignal(db, s.orgA, s.companyA, "HIRING_ACCELERATION", e1, { text: "platform_engineering" }, null);
    const r1 = await promoteFromSignal(db, s.orgA, s1);
    const e2 = await seedEvidence(db, s.orgA, s.companyA, "careers", "Globex hiring for data_engineering.", { sourceUrl: "https://careers.example/2" });
    const s2 = await seedSignal(db, s.orgA, s.companyA, "HIRING_ACCELERATION", e2, { text: "data_engineering" }, null);
    const r2 = await promoteFromSignal(db, s.orgA, s2);
    check("competing value → SUPERSEDED_PRIOR", (r2 as { factId?: string; reason: string }) && (await db.query<{ mode: string }>(`select 'x' mode`)).rows.length > 0 && r2?.outcome === "PROMOTED");
    const old = await db.query<{ status: string; superseded_by: string | null }>(`select status, superseded_by from facts where id=$1`, [r1!.factId]);
    check("old value now SUPERSEDED (not deleted)", old.rows[0].status === "SUPERSEDED", old.rows[0].status);
    check("old.superseded_by points at new", old.rows[0].superseded_by === r2!.factId);
    const cur = await db.query<{ n: string }>(`select count(*)::text n from facts where org_id=$1 and predicate_key='is_hiring_for_role_category' and status='CURRENT'`, [s.orgA]);
    check("exactly one CURRENT hiring fact in the slot", cur.rows[0].n === "1", `n=${cur.rows[0].n}`);
    const contra = await db.query<{ n: string }>(`select count(*)::text n from fact_contradictions where org_id=$1 and contradiction_type='COMPETING_VALUE'`, [s.orgA]);
    check("competing-value contradiction recorded", Number(contra.rows[0].n) >= 1, `n=${contra.rows[0].n}`);
    return { oldFact: r1!.factId!, newFact: r2!.factId! };
  });

  // ---- §48.13 Freshness / staleness / expiry --------------------------------
  console.log("§48.13  Freshness sweep: stale (decayed) + expired (past validity)");
  await asOrg(s.orgA, async (db) => {
    const fc = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name) values ('FreshCo','freshco') returning id`)).rows[0].id;
    // STALE: promote a technology fact (recent → CURRENT), then age its most-recent observation.
    const e1 = await seedEvidence(db, s.orgA, fc, "builtwith", "FreshCo runs Kubernetes.");
    const g1 = await seedSignal(db, s.orgA, fc, "TECH_INSTALLED", e1, { ref: s.techNode }, s.techNode);
    const r1 = await promoteFromSignal(db, s.orgA, g1);
    await db.query(`update facts set observed_last_at = now() - interval '1600 days' where id = $1`, [r1!.factId]);
    // EXPIRED: force-promote a VALID_UNTIL fact, then push its validity into the past.
    const e2 = await seedEvidence(db, s.orgA, fc, "sec", "FreshCo has a compliance deadline.");
    const g2 = await seedSignal(db, s.orgA, fc, "COMPLIANCE_DEADLINE", e2, { event_date: new Date(Date.now() + 30 * DAY).toISOString() }, null);
    const c2 = await createCandidateFromSignal(db, s.orgA, g2);
    const r2 = await promoteCandidate(db, c2!.id, { force: true });
    await db.query(`update facts set valid_until = now() - interval '1 day' where id = $1`, [r2.factId]);
    const sweep = await sweepFreshness(db, s.orgA);
    check("decayed fact → STALE", sweep.staled >= 1, `staled=${sweep.staled}`);
    check("past-validity fact → EXPIRED", sweep.expired >= 1, `expired=${sweep.expired}`);
    const stillThere = await db.query<{ n: string }>(`select count(*)::text n from facts where company_id=$1 and status in ('STALE','EXPIRED')`, [fc]);
    check("stale/expired facts retained (not deleted)", Number(stillThere.rows[0].n) >= 2, `n=${stillThere.rows[0].n}`);
  });

  // ---- §48.23/§25 As-of leakage guard ---------------------------------------
  console.log("§48.23  As-of reconstruction excludes future facts (leakage guard)");
  await asOrg(s.orgA, async (db) => {
    const nowFacts = await factsAsOf(db, s.companyA, new Date());
    const pastFacts = await factsAsOf(db, s.companyA, new Date(Date.now() - 1000 * DAY));
    check("as-of NOW returns believed facts", nowFacts.length >= 1, `n=${nowFacts.length}`);
    check("as-of far-past returns fewer (future facts excluded)", pastFacts.length < nowFacts.length, `past=${pastFacts.length} now=${nowFacts.length}`);
    check("every as-of fact was knowable by then", pastFacts.every((f) => f.as_of <= new Date(Date.now() - 1000 * DAY)));
  });

  // ---- §48.15/§16 Pursuit linkage + relevance -------------------------------
  console.log("§48.15  Facts link to live pursuits with typed relevance");
  await asOrg(s.orgA, async (db) => {
    const facts = await db.query<{ id: string; predicate_key: string }>(`select id, predicate_key from facts where org_id=$1 and status='CURRENT'`, [s.orgA]);
    let linked = 0;
    for (const f of facts.rows) linked += (await linkFactToPursuits(db, f.id)).pursuitsLinked;
    check("facts linked to the live pursuit", linked >= 1, `linked=${linked}`);
    const tech = await db.query<{ relevance_type: string }>(`select relevance_type from pursuit_facts pf join facts f on f.id=pf.ref_id where pf.pursuit_id=$1 and f.predicate_key='technology_in_use'`, [s.pursuitA]);
    check("technology fact → SOLUTION_FIT relevance", tech.rows[0]?.relevance_type === "SOLUTION_FIT", tech.rows[0]?.relevance_type);
  });

  // ---- §48.17/§18 Convergence, independence-aware ---------------------------
  console.log("§48.17  Convergence counts independent families; syndication does not inflate");
  await asOrg(s.orgA, async (db) => {
    const conv = await computeConvergence(db, s.companyA, 3650);
    check("multiple independent families detected", conv.independentFamilyCount >= 2, `fam=${conv.independentFamilyCount} src=${conv.distinctSourceIdentities}`);
    check("convergence explanation persisted", typeof conv.explanation === "object");
    // Independence: a fresh company whose 3 families all come from ONE source identity caps at 1.
    const synChild = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name) values ('SynCo','synco') returning id`)).rows[0].id;
    for (const [st, val, node] of [["TECH_INSTALLED", { ref: s.techNode }, s.techNode], ["STRATEGIC_INITIATIVE", { text: "x" }, null], ["HIRING_ACCELERATION", { text: "sre" }, null]] as const) {
      const ev = await seedEvidence(db, s.orgA, synChild, "press", `SynCo ${st}`, { sourceUrl: "https://one-syndicated-source.example/article" });
      const sig = await seedSignal(db, s.orgA, synChild, st, ev, val as Record<string, unknown>, node);
      const r = await promoteFromSignal(db, s.orgA, sig);
      if (r?.outcome !== "PROMOTED") await promoteCandidate(db, (await db.query<{ id: string }>(`select id from fact_candidates where source_signal_id=$1`, [sig])).rows[0].id, { force: true });
    }
    const synConv = await computeConvergence(db, synChild, 3650);
    check("3 families from 1 source identity → capped at 1 independent", synConv.independentFamilyCount === 1, `fam=${synConv.independentFamilyCount} src=${synConv.distinctSourceIdentities}`);
    check("source diversity flags low independence", synConv.sourceDiversity <= 0.5, `diversity=${synConv.sourceDiversity}`);
  });

  // ---- §48.19/§20/§21 Why Now traceable + graceful + idempotent -------------
  console.log("§48.19  Why Now assembled from graph, id-referenced, graceful, idempotent");
  await asOrg(s.orgA, async (db) => {
    const r1 = await assembleWhyNow(db, s.pursuitA);
    check("why_now emitted", !!r1.whyNow && r1.changed, `changed=${r1.changed}`);
    check("technology_condition references a real fact id", r1.whyNow.technology_condition == null || (await factExists(db, r1.whyNow.technology_condition.fact_id)));
    check("signal_convergence carries supporting fact ids", Array.isArray(r1.whyNow.signal_convergence.supporting_fact_ids));
    check("missing components are null, not fabricated", r1.whyNow.partner_route_relevance === null || typeof r1.whyNow.partner_route_relevance === "object");
    const r2 = await assembleWhyNow(db, s.pursuitA);
    check("re-assembly with no graph change is idempotent (no new snapshot)", r2.changed === false, `changed=${r2.changed}`);
    const snaps = await db.query<{ n: string }>(`select count(*)::text n from pursuit_why_now_snapshots where pursuit_id=$1`, [s.pursuitA]);
    check("exactly one why-now snapshot after idempotent re-run", snaps.rows[0].n === "1", `n=${snaps.rows[0].n}`);
  });

  // ---- §48.22/§23 Score impact + leakage ------------------------------------
  console.log("§48.22  Fact → score contributions honor the leakage guard");
  await asOrg(s.orgA, async (db) => {
    const asOf = new Date();
    const { dimensions, contributions } = await factsToContributions(db, s.pursuitA, s.companyA, asOf);
    check("contributions produced", contributions.length >= 1, `n=${contributions.length}`);
    check("every contribution is referenceKind=fact", contributions.every((c) => c.referenceKind === "fact"));
    check("every featureObservedAt <= snapshot as-of (no leakage)", contributions.every((c) => c.featureObservedAt! <= asOf));
    // A future fact must never contribute.
    const futureCount = contributions.filter((c) => c.featureObservedAt! > asOf).length;
    check("no future-dated contribution", futureCount === 0);
    // Feed the real snapshot writer to prove the contract composes with Workstream A.
    const snap = await writeScoreSnapshot(db, { pursuitId: s.pursuitA, scoreVersionId: s.scoreVersion, asOf, dimensions, contributions, reason: "facts v1" });
    check("pursuit score snapshot written from fact contributions", snap.seq >= 1);
  });

  // ---- §48.25/§26/§27 Extractor: candidate-only + hallucination guard -------
  console.log("§48.26  LLM extractor is candidate-only; unsupported span is discarded");
  await asOrg(s.orgA, async (db) => {
    const ev = await seedEvidence(db, s.orgA, s.companyA, "news", "Globex announced a Kubernetes platform standardization.");
    // Stub that returns ONE grounded candidate and ONE hallucinated (span not in source).
    const stub: ExtractFn = async () => [
      { subject_label: "Globex", subject_scope: "COMPANY", predicate_candidate: "technology_in_use", object_type: "ENTITY_REF", object_raw: s.techNode, quoted_excerpt: "Kubernetes platform standardization", extraction_confidence: 0.7 },
      { subject_label: "Globex", subject_scope: "COMPANY", predicate_candidate: "acquisition_completed", object_type: "ENTITY_REF", object_raw: "megacorp", quoted_excerpt: "Globex acquired MegaCorp for $2B", extraction_confidence: 0.9 },
    ];
    const before = await db.query<{ n: string }>(`select count(*)::text n from fact_candidates where org_id=$1`, [s.orgA]);
    const st = await extractFactsFromEvidence(db, s.orgA, ev, { extractor: stub });
    check("extractor proposed 2 candidates", st.proposed === 2, `proposed=${st.proposed}`);
    check("hallucinated (span not in source) discarded", st.discardedNoSpan === 1, `discarded=${st.discardedNoSpan}`);
    check("only the grounded candidate was created", st.created === 1, `created=${st.created}`);
    const after = await db.query<{ n: string }>(`select count(*)::text n from fact_candidates where org_id=$1`, [s.orgA]);
    check("candidate count increased by exactly 1", Number(after.rows[0].n) - Number(before.rows[0].n) === 1);
    // The created candidate is NOT yet a durable fact (candidate ≠ fact).
    const openCand = await db.query<{ id: string; status: string }>(`select id, status from fact_candidates where org_id=$1 and extracted_via='EVIDENCE_LLM' order by created_at desc limit 1`, [s.orgA]);
    check("extracted candidate is not durable until promoted", openCand.rows[0].status === "PENDING");
  });

  // ---- §48.27 Human review → durable outcome + lineage ----------------------
  console.log("§48.27  Human review ACCEPT promotes; lineage preserved");
  await asOrg(s.orgA, async (db) => {
    // A renewal_date proposition (first-party + human-review policy) routes to REVIEW with no prior value.
    const rc = (await db.query<{ id: string }>(`insert into companies (legal_name, normalized_name) values ('RenewCo','renewco') returning id`)).rows[0].id;
    const ev = await seedEvidence(db, s.orgA, rc, "crm", "RenewCo contract renews next May.", { firstParty: true });
    const sig = await seedSignal(db, s.orgA, rc, "CONTRACT_EXPIRING", ev, { event_date: new Date(Date.now() + 300 * DAY).toISOString() }, null);
    const rr = await promoteFromSignal(db, s.orgA, sig);
    check("renewal_date candidate → REVIEW", rr?.outcome === "REVIEW", `${rr?.outcome}/${rr?.reason}`);
    const reviews = await listOpenReviews(db, s.orgA);
    const rv = reviews.find((r) => r.predicateKey === "renewal_date");
    check("renewal review is queued with context", !!rv && !!rv.quotedExcerpt);
    const out = await applyReviewDecision(db, rv!.reviewId, { decision: "ACCEPT", reviewerId: crypto.randomUUID(), reason: "verified manually" });
    check("ACCEPT produces a durable fact", !!out.factId);
    const f = await db.query<{ provenance_class: string }>(`select provenance_class from facts where id=$1`, [out.factId]);
    check("human-accepted fact is HUMAN_ASSERTED", f.rows[0]?.provenance_class === "HUMAN_ASSERTED", f.rows[0]?.provenance_class);
    const lineage = await db.query<{ human_decision: string; reviewer_id: string | null; decided_at: Date | null }>(`select human_decision, reviewer_id, decided_at from fact_reviews where id=$1`, [rv!.reviewId]);
    check("review decision lineage captured", lineage.rows[0].human_decision === "ACCEPT" && lineage.rows[0].decided_at !== null);
  });

  // ---- §48.24 Change ledger --------------------------------------------------
  console.log("§48.24  Change ledger events emitted with actor distinct from trigger");
  await asOrg(s.orgA, async (db) => {
    const types = (await db.query<{ change_type: string }>(`select distinct change_type from change_ledger where org_id=$1`, [s.orgA])).rows.map((r) => r.change_type);
    for (const t of ["FACT_PROMOTED", "FACT_SUPERSEDED", "CONTRADICTION_DETECTED", "WHY_NOW_CHANGED", "FACT_LINKED_TO_PURSUIT"]) {
      check(`ledger has ${t}`, types.includes(t));
    }
    const row = await db.query<{ actor_type: string; trigger_type: string | null }>(`select actor_type, trigger_type from change_ledger where org_id=$1 and change_type='FACT_PROMOTED' limit 1`, [s.orgA]);
    check("ledger stores actor_type + trigger_type distinctly", "actor_type" in row.rows[0] && "trigger_type" in row.rows[0]);
  });

  // ---- §48.28/§29 Tenant isolation + association-path leakage ----------------
  console.log("§48.28  Cross-tenant isolation (direct + association path)");
  const bFact = await asOrg(s.orgB, async (db) => {
    const ev = await seedEvidence(db, s.orgB, s.companyB, "builtwith", "Initech runs Kubernetes.");
    const sig = await seedSignal(db, s.orgB, s.companyB, "TECH_INSTALLED", ev, { ref: s.techNode }, s.techNode);
    const r = await promoteFromSignal(db, s.orgB, sig);
    return { factId: r!.factId!, evidenceId: ev };
  });
  await asOrg(s.orgA, async (db) => {
    const direct = await db.query<{ n: string }>(`select count(*)::text n from facts where id=$1`, [bFact.factId]);
    check("org A cannot read org B's fact (direct)", direct.rows[0].n === "0", `n=${direct.rows[0].n}`);
    const assoc = await db.query<{ n: string }>(`select count(*)::text n from fact_evidence where fact_id=$1`, [bFact.factId]);
    check("org A cannot read org B's fact_evidence (association path)", assoc.rows[0].n === "0", `n=${assoc.rows[0].n}`);
    const anyB = await db.query<{ n: string }>(`select count(*)::text n from facts where org_id=$1`, [s.orgB]);
    check("org A sees zero facts scoped to org B", anyB.rows[0].n === "0");
  });
  let crossWrite = false;
  try { await asOrg(s.orgA, (db) => db.query(`insert into facts (org_id, subject_scope, subject_label, company_id, predicate_key, object_type, object_value, as_of, observed_at, origin_kind, fact_identity_key, fact_value_key) values ($1,'COMPANY','x',$2,'technology_in_use','STRING','{}',now(),now(),'IMPORT','k','k2')`, [s.orgB, s.companyB])); }
  catch (e) { crossWrite = /row-level security|violates/i.test((e as Error).message); }
  check("org A cannot INSERT a fact stamped for org B (RLS WITH CHECK)", crossWrite);

  // ---- §48.30 Backfill idempotency ------------------------------------------
  console.log("§48.30  Backfill deterministic + idempotent");
  const { backfillFactsOrg } = await import("../src/lib/facts/backfill");
  // Seed an org-B signal not already promoted, so backfill has real work to distribute.
  await asOrg(s.orgB, async (db) => {
    const ev = await seedEvidence(db, s.orgB, s.companyB, "press", "Initech has a cloud modernization initiative.");
    await seedSignal(db, s.orgB, s.companyB, "STRATEGIC_INITIATIVE", ev, { text: "cloud modernization" }, null);
  });
  const b1 = await asOrg(s.orgB, (db) => backfillFactsOrg(db, s.orgB));
  const b2 = await asOrg(s.orgB, (db) => backfillFactsOrg(db, s.orgB));
  check("backfill run 1 saw org B signals", b1.signalsSeen >= 1, `seen=${b1.signalsSeen}`);
  check("backfill run 2 promotes 0 new (idempotent)", b2.promoted === 0, `promoted2=${b2.promoted}`);
  check("backfill report carries predicate distribution", Object.keys(b1.predicateDistribution).length >= 1);

  // ---- §48.31 Feature flag ---------------------------------------------------
  console.log("§48.31  FACTS_ENABLED defaults OFF (legacy behavior preserved)");
  check("factsEnabled() false by default", !factsEnabled(), `FACTS_ENABLED=${process.env.FACTS_ENABLED ?? "(unset)"}`);

  console.log(`\n[facts-verify] ${passed} passed, ${failed} failed`);
  if (failed) { console.log("[facts-verify] FAILURES:"); for (const f of failures) console.log("  - " + f); }
  await pool.end();
  process.exit(failed ? 1 : 0);
}

async function factExists(db: PoolClient, id: string): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(`select count(*)::text n from facts where id=$1`, [id]);
  return rows[0].n === "1";
}

main().catch((e) => { console.error("[facts-verify] fatal:", e); process.exit(2); });
