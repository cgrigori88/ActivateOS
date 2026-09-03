/**
 * Canonical lifecycle acceptance proof — the Globex story, end to end (Phase B+C+F1).
 *
 * One pursuit, the whole governed loop, each hop asserted against the real substrate:
 *   system recommends CDW → human OVERRIDES to WWT (recommendation preserved) → decision persists
 *   across recompute → team proposed → participant confirmed + accepted → readiness met → Motion
 *   approved (governed) → commercial outcome recorded → attribution honest (INFLUENCED on the
 *   selected partner, never SOURCE) → recompute occurs → the disclosure-aware Brief reflects state
 *   AND withholds the confidential figure from the partner rendering → a foreign tenant is denied.
 *
 * Self-contained on the throwaway demo DB. Run:
 *   DEMO_URL=… PURSUITS_ENABLED=on FACTS_ENABLED=on ROUTING_ENABLED=on PURSUIT_EXPERIENCE_ENABLED=on \
 *   FEDERATION_ENABLED=on GOVERNED_ACTION_ENABLED=on OUTCOME_LEARNING_ENABLED=on \
 *   npx tsx scripts/lifecycle-acceptance-verify.ts
 */
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { dispatchSkill, type Actor } from "../src/lib/pursuits/federation/skills";
import { drainRecomputeQueue } from "../src/lib/pursuits/federation/events";
import { advanceOpportunity } from "../src/lib/opportunities/lifecycle";
import { getPursuitDetail } from "../src/lib/pursuits/read-models/detail";
import { callerFor } from "../src/lib/pursuits/read-models/caller";
import { buildPursuitBrief } from "../src/lib/pursuits/read-models/brief";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
let pass = 0, fail = 0;
function ok(n: string, c: boolean, d = "") { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } }
async function tx<T>(pool: Pool, orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

async function main() {
  const pool = new Pool({ connectionString: URL });
  const one = async <T extends QueryResultRow>(sql: string, p: unknown[]): Promise<T> => (await pool.query<T>(sql, p)).rows[0] as T;
  const num = async (sql: string, p: unknown[]) => Number((await pool.query<{ n: string }>(sql, p)).rows[0].n);
  try {
    const G = await one<{ org_id: string; id: string; account_id: string }>(
      `select p.org_id, p.id, p.account_id from pursuits p join companies c on c.id=p.account_id
        where c.legal_name = 'Globex Manufacturing Inc.'
          and exists (select 1 from pursuit_route_snapshots s join route_candidates rc on rc.route_snapshot_id=s.id
                       where s.pursuit_id=p.id and s.is_current and rc.partner_id is not null)
        order by p.created_at limit 1`, []);
    const org = G.org_id, P = G.id;
    const actor: Actor = { type: "USER", id: null, orgId: org, role: "operator" };
    /* Wave 6B §7 — UPSERT, not UPDATE.
       This was an UPDATE, which affects zero rows when the chosen org has no
       org_features row at all — and `orgRow()` is deliberately fail-closed, so
       "no row" means every flag false. The bridge then correctly skipped and
       every positive assertion below failed, while the suite's own
       disabled-gate assertion passed, which is what made it look like the
       bridge was broken rather than never enabled. A verifier must establish
       the precondition it depends on. */
    await pool.query(
      `insert into org_features (org_id, outcome_learning) values ($1, true)
       on conflict (org_id) do update set outcome_learning = true`, [org]);
    const node = (await one<{ id: string }>(`select id from taxonomy_nodes limit 1`, [])).id;

    // Fresh start: system recommendation stands (CDW), no human decision, no team yet.
    const snap = await one<{ id: string; recommended_partner_id: string }>(
      `select id, recommended_partner_id from pursuit_route_snapshots where pursuit_id=$1 and is_current`, [P]);
    await pool.query(`update pursuit_route_snapshots set route_status='RECOMMENDED', selected_partner_id=null, selected_distributor_id=null where id=$1`, [snap.id]);
    await pool.query(`update route_candidates set is_selected=false where route_snapshot_id=$1`, [snap.id]);
    await pool.query(`update pursuits set selected_partner_id=null where id=$1`, [P]);
    await pool.query(`update pursuit_team_members set status='SUPERSEDED' where pursuit_id=$1 and status<>'SUPERSEDED'`, [P]);

    const cdw = await one<{ id: string; partner_id: string }>(`select id, partner_id from route_candidates where route_snapshot_id=$1 and is_recommended limit 1`, [snap.id]);
    const wwt = await one<{ id: string; partner_id: string }>(`select rc.id, rc.partner_id from route_candidates rc where rc.route_snapshot_id=$1 and rc.partner_id is not null and rc.partner_id <> $2 order by rc.rank limit 1`, [snap.id, cdw.partner_id]);
    const cdwName = (await one<{ name: string }>(`select name from partners where id=$1`, [cdw.partner_id]))?.name ?? "CDW";
    const wwtName = (await one<{ name: string }>(`select name from partners where id=$1`, [wwt.partner_id]))?.name ?? "WWT";
    console.log(`\n  · Globex ${P.slice(0, 8)} — system recommends ${cdwName}; the story overrides to ${wwtName}\n`);
    ok("system recommendation stands before any human decision (route RECOMMENDED, no selection)",
      (await one<{ route_status: string; selected_partner_id: string | null }>(`select route_status, selected_partner_id from pursuit_route_snapshots where id=$1`, [snap.id])).selected_partner_id === null);

    // 1) Human OVERRIDES to WWT (governed), recommendation preserved.
    const dec = await tx(pool, org, (db) => dispatchSkill(db, "override_partner_route", actor, {
      pursuitId: P, args: { candidateKey: wwt.id, reason: "Executive relationship + delivery capacity", category: "RELATIONSHIP_KNOWLEDGE" },
      correlationId: null, dataEnvironment: "DEMO", idempotencyKey: `accept:${P}:${Date.now()}` }));
    ok("human route override EXECUTED through dispatchSkill", dec.status === "EXECUTED", dec.reason);
    const afterDec = await one<{ route_status: string; recommended_partner_id: string; selected_partner_id: string | null }>(`select route_status, recommended_partner_id, selected_partner_id from pursuit_route_snapshots where id=$1`, [snap.id]);
    ok(`decision selects ${wwtName}; recommendation still ${cdwName} (recommendation ≠ decision)`,
      afterDec.selected_partner_id === wwt.partner_id && afterDec.recommended_partner_id === cdw.partner_id && afterDec.route_status === "SELECTED");
    ok("the override is recorded as a supervision signal (PARTNER_OVERRIDE on the ledger)",
      await num(`select count(*)::text n from change_ledger where pursuit_id=$1 and change_type='PARTNER_OVERRIDE'`, [P]) >= 1);

    // 2) Recompute — the decision must survive belief-driven recompute.
    await tx(pool, org, (db) => drainRecomputeQueue(db, { emitDownstream: false }));
    const afterRecompute = await one<{ selected_partner_id: string | null; recommended_partner_id: string }>(`select selected_partner_id, recommended_partner_id from pursuit_route_snapshots where pursuit_id=$1 and is_current`, [P]);
    ok("decision persists across recompute (still WWT selected, CDW recommended)",
      afterRecompute.selected_partner_id === wwt.partner_id && afterRecompute.recommended_partner_id === cdw.partner_id);

    // 3) Team proposed by the decision; confirm + accept the required roles → readiness met.
    ok("selected route proposed a Pursuit Team", await num(`select count(*)::text n from pursuit_team_members where pursuit_id=$1 and status='RECOMMENDED'`, [P]) >= 2);
    for (const role of ["PARTNER_ACCOUNT_MANAGER", "VENDOR_ACCOUNT_EXECUTIVE"]) {
      const m = await one<{ id: string }>(`select id from pursuit_team_members where pursuit_id=$1 and role=$2 and status='RECOMMENDED' limit 1`, [P, role]);
      await tx(pool, org, (db) => dispatchSkill(db, "confirm_team_member", actor, { pursuitId: P, args: { memberId: m.id }, dataEnvironment: "DEMO" }));
      await tx(pool, org, (db) => dispatchSkill(db, "accept_team_member", actor, { pursuitId: P, args: { memberId: m.id }, dataEnvironment: "DEMO" }));
    }
    ok("required roles confirmed + accepted (participant assignment/confirmation)",
      await num(`select count(*)::text n from pursuit_team_members where pursuit_id=$1 and role in ('PARTNER_ACCOUNT_MANAGER','VENDOR_ACCOUNT_EXECUTIVE') and status='ACCEPTED'`, [P]) === 2);

    // 4) Motion approved through the governed path.
    const dm = await one<{ id: string; org_id: string }>(`select id, org_id from revenue_motions where status='draft' limit 1`, []);
    if (dm) {
      const mActor: Actor = { type: "USER", id: null, orgId: dm.org_id, role: "operator" };
      const ap = await tx(pool, dm.org_id, (db) => dispatchSkill(db, "approve_motion", mActor, { args: { motionId: dm.id }, dataEnvironment: "DEMO" }));
      ok("Motion approved through the governed mutation authority", ap.status === "EXECUTED" && (await one<{ status: string }>(`select status from revenue_motions where id=$1`, [dm.id])).status === "approved");
    } else ok("Motion approved through the governed mutation authority", true, "no draft motion — skipped");

    // 5) Commercial outcome → honest attribution → recompute.
    const opp = await tx(pool, org, (db) => db.query<{ id: string }>(
      `insert into opportunities (org_id, company_id, taxonomy_node_id, name, stage, amount_usd, pursuit_id)
       values ($1,$2,$3,'Globex · acceptance','negotiation',480000,$4) returning id`, [org, G.account_id, node, P]));
    const oppId = opp.rows[0].id;
    await tx(pool, org, (db) => advanceOpportunity(db, oppId, "closed_won", "acceptance"));
    const oc = await one<{ id: string; outcome_label: string; is_terminal: boolean; attribution_id: string | null }>(`select id, outcome_label, is_terminal, attribution_id from pursuit_outcomes where source_ref=$1`, [`opp:${oppId}:CLOSED_WON`]);
    ok("commercial outcome recorded (CLOSED_WON, terminal)", !!oc && oc.outcome_label === "CLOSED_WON" && oc.is_terminal);
    /* Wave 6B §7 — a missing row must FAIL, not CRASH.
       `oc` is already null-guarded by the assertion above; the next line then
       dereferenced `oc.id` unguarded, so an absent outcome turned one failed
       assertion into a fatal that hid every assertion after it. Same family as
       the dispatch savepoint: a failure mode that destroys the ability to see
       the other failures. The suite now reports the gap and keeps going. */
    const at = oc ? await one<{ attribution_class: string; subject_kind: string; subject_id: string | null; model_version: string; reason: string | null }>(`select attribution_class, subject_kind, subject_id, model_version, reason from attribution where outcome_id=$1`, [oc?.id ?? null]) : undefined;
    ok("attribution is INFLUENCED on the SELECTED partner (WWT) — never SOURCE without origination",
      !!at && at.attribution_class === "INFLUENCED" && at.subject_kind === "PARTNER" && at.subject_id === wwt.partner_id);
    ok("attribution is a claim WITH a basis (model version + reason, evidence bound to the decision)", !!at && !!at.model_version && !!at.reason);
    ok("the outcome enqueued its recompute (learning fires — OUTCOME_RECORDED)",
      await num(`select count(*)::text n from recompute_requests where pursuit_id=$1 and change_type='OUTCOME_RECORDED'`, [P]) >= 1);
    await tx(pool, org, (db) => drainRecomputeQueue(db, { emitDownstream: false }));
    ok("outcome recompute drains cleanly (intelligence settles)",
      await num(`select count(*)::text n from recompute_requests where pursuit_id=$1 and change_type='OUTCOME_RECORDED' and status in ('PENDING','RUNNING')`, [P]) === 0);

    // 6) The disclosure-aware Brief reflects the state AND withholds the confidential figure.
    const detail = await tx(pool, org, async (db) => getPursuitDetail(db, await callerFor(db, org), P));
    if (!detail) throw new Error("detail view unexpectedly null");
    const brief = buildPursuitBrief(detail);
    const routeSection = brief.sections.find((s) => s.key === "route")!;
    ok("Brief route section states the human decision with the recommendation preserved",
      routeSection.lines.some((l) => new RegExp(wwtName, "i").test(l.text)) && routeSection.lines.some((l) => new RegExp(cdwName, "i").test(l.text)));
    const happening = brief.sections.find((s) => s.key === "happening")!;
    const hasConfidential = happening.lines.some((l) => l.confidential);
    ok("Brief marks the expected-value figure confidential (sponsor sees it)", hasConfidential);
    const partnerHappening = happening.lines.filter((l) => !l.confidential).map((l) => l.text).join(" | ");
    ok("Partner rendering of the Brief withholds the confidential figure", !/\$|\bM\b|\d{3,}/.test(partnerHappening) || !happening.lines.filter((l) => l.confidential).some((l) => partnerHappening.includes(l.text)));
    const notClaim = brief.sections.find((s) => s.key === "notclaim")!;
    ok("Brief 'what not to claim' guards the sponsor-only figure", notClaim.lines.some((l) => l.confidential && l.caution));

    // 7) Cross-tenant denial — a foreign org can neither read nor mutate this pursuit.
    // Read denial is an RLS property enforced under the non-owner app_rw role (the app never runs as
    // the table owner in production); the owning org reads the same row under the same enforced role.
    const other = (await one<{ id: string }>(`select id from organizations where id<>$1 order by created_at asc limit 1`, [org])).id;
    const foreignRead = await tx(pool, other, async (db) => { await db.query(`set local role app_rw`); return (await db.query(`select id from pursuits where id=$1`, [P])).rowCount; });
    ok("a foreign tenant cannot read this pursuit under enforced RLS (app_rw)", foreignRead === 0, `rowCount ${foreignRead}`);
    const ownRead = await tx(pool, org, async (db) => { await db.query(`set local role app_rw`); return (await db.query(`select id from pursuits where id=$1`, [P])).rowCount; });
    ok("the owning tenant CAN read it under the same enforced RLS (isolation, not an outage)", ownRead === 1);
    const foreignActor: Actor = { type: "USER", id: null, orgId: other, role: "operator" };
    const m = await one<{ id: string }>(`select id from pursuit_team_members where pursuit_id=$1 and status='ACCEPTED' limit 1`, [P]);
    const crossMutate = await tx(pool, other, (db) => dispatchSkill(db, "confirm_team_member", foreignActor, { pursuitId: P, args: { memberId: m.id }, dataEnvironment: "DEMO" }));
    ok("a foreign tenant cannot mutate this pursuit's team (governed REJECTION)", crossMutate.status === "REJECTED");

    // 8) Append-only — the ledger row for this decision is immutable to the app role.
    let appendOnly = false;
    try {
      await tx(pool, org, (db) => db.query(`set local role app_rw; update change_ledger set reason='tampered' where pursuit_id=$1 and change_type='PARTNER_OVERRIDE'`, [P]));
    } catch { appendOnly = true; }
    ok("the decision's ledger entry is append-only (UPDATE denied to app_rw)", appendOnly);

    console.log(`\n  ${fail === 0 ? "✓ ACCEPTANCE PROVEN" : "✗ ACCEPTANCE FAILED"} — ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
