/**
 * Human-decision persistence across belief-driven ROUTE recompute (Part A correction).
 *
 * Canonical invariant: a recompute may change the RECOMMENDATION; it may NOT erase or overwrite an
 * authorized human DECISION. Verifies the exact acceptance sequence (partner names are demo-specific
 * — the demo's routes are CDW / WWT / Direct; the mechanism is partner-agnostic):
 *   1 recommended=CDW, selected=WWT (governed override)
 *   2 a belief-driven ROUTE recompute now recommends a DIFFERENT route
 *   3 selected remains WWT
 *   4 recommendation history shows CDW → <new>
 *   5 the human decision remains WWT
 *   6 the read model reflects the divergence honestly
 *   7 only a subsequent governed selection can change WWT (a plain recompute cannot)
 *
 * Run: DEMO_URL=… npx tsx scripts/route-persistence-verify.ts
 */
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { dispatchSkill } from "../src/lib/pursuits/federation/skills";
import { getRouteComparison } from "../src/lib/pursuits/read-models/route";
import { recomputeRoute, persistRoute } from "../src/lib/routing/route-model";
import { generateRouteCandidates } from "../src/lib/routing/candidates";
import type { Caller } from "../src/lib/pursuits/read-models/helpers";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = "") { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); } }
const internal = (orgId: string): Caller => ({ orgId, canSeeInternal: true, canSeeTransactionDetail: true });

async function tx<T>(pool: Pool, orgId: string, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("begin"); await c.query("select set_config('app.org_id',$1,true)", [orgId]); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
const partnerName = async (pool: Pool, id: string | null) => id ? ((await pool.query<{ name: string }>(`select name from partners where id=$1`, [id])).rows[0]?.name ?? id.slice(0, 8)) : "Direct";
const snapshot = async (pool: Pool, pid: string) => (await pool.query<{ recommended_partner_id: string | null; selected_partner_id: string | null; route_status: string }>(
  `select recommended_partner_id, selected_partner_id, route_status from pursuit_route_snapshots where pursuit_id=$1 and is_current`, [pid])).rows[0];

async function main() {
  const pool = new Pool({ connectionString: URL });
  try {
    // A CDW-recommended pursuit with a WWT alternative, not already decided by another run.
    const pick = (await pool.query<{ pursuit_id: string; org_id: string }>(
      `select s.pursuit_id, s.org_id from pursuit_route_snapshots s
         join route_candidates rc on rc.route_snapshot_id=s.id
         left join partners p on p.id=s.recommended_partner_id
        where s.is_current and p.name='CDW' and s.route_status='RECOMMENDED'
        group by s.pursuit_id, s.org_id having count(*)>=2 limit 1`)).rows[0]
      ?? (await pool.query<{ pursuit_id: string; org_id: string }>(
        `select s.pursuit_id, s.org_id from pursuit_route_snapshots s join route_candidates rc on rc.route_snapshot_id=s.id
           left join partners p on p.id=s.recommended_partner_id where s.is_current and p.name='CDW'
           group by s.pursuit_id, s.org_id having count(*)>=2 limit 1`)).rows[0];
    if (!pick) { console.log("no CDW-recommended pursuit available"); process.exit(1); }
    const { pursuit_id: pid, org_id: org } = pick;

    // Clean start: fresh RECOMMENDED snapshot (CDW recommended, WWT + Direct alternatives).
    await tx(pool, org, (db) => recomputeRoute(db, pid, new Date(), "DEMO"));
    const before = await tx(pool, org, (db) => getRouteComparison(db, internal(org), pid));
    const wwt = before.alternatives.find((a) => /WWT/i.test(a.label) && !a.disqualified) ?? before.alternatives.find((a) => !a.disqualified)!;
    console.log(`\n  · pursuit ${pid.slice(0, 8)} — recommended=${before.recommended?.label}, will select=${wwt.label}\n`);

    // Governed decision → select WWT (recommended stays CDW).
    await tx(pool, org, (db) => dispatchSkill(db, "override_partner_route", { type: "USER", id: null, orgId: org, role: "operator" }, {
      pursuitId: pid, args: { candidateKey: wwt.key, reason: "Exec relationship at the account", category: "RELATIONSHIP_KNOWLEDGE" }, correlationId: randomUUID() }));
    const s1 = await snapshot(pool, pid);
    ok("1. recommended=CDW, selected=WWT", (await partnerName(pool, s1.recommended_partner_id)) === "CDW" && (await partnerName(pool, s1.selected_partner_id)) === wwt.label);
    const recBeforePartner = s1.recommended_partner_id;

    // Belief-driven ROUTE recompute that re-ranks to a DIFFERENT recommendation (not WWT). Drives the
    // FIXED persistRoute directly with a real candidate set whose recommended flag moved off CDW.
    await tx(pool, org, async (db) => {
      const { ctx, candidates } = await generateRouteCandidates(db, pid, new Date());
      const selectedPartner = s1.selected_partner_id;
      const newTop = candidates.find((c) => !c.isRecommended && !c.disqualified && c.partnerId !== selectedPartner) ?? candidates.find((c) => c.partnerId !== selectedPartner)!;
      for (const c of candidates) c.isRecommended = c === newTop;
      await persistRoute(db, pid, ctx, candidates, new Date(), "DEMO");
    });
    const s2 = await snapshot(pool, pid);

    ok("2. recompute produced a NEW recommendation (moved off CDW)", s2.recommended_partner_id !== recBeforePartner, `now=${await partnerName(pool, s2.recommended_partner_id)}`);
    ok("3. selected route remains WWT after recompute", (await partnerName(pool, s2.selected_partner_id)) === wwt.label);
    ok("3b. route_status still SELECTED (decision intact)", s2.route_status === "SELECTED");
    ok("3c. the WWT candidate is is_selected on the NEW snapshot", Number((await pool.query<{ n: string }>(
      `select count(*)::text n from route_candidates rc join pursuit_route_snapshots s on s.id=rc.route_snapshot_id
        where s.pursuit_id=$1 and s.is_current and rc.is_selected and rc.partner_id=$2`, [pid, s2.selected_partner_id])).rows[0].n) === 1);

    const hist = (await pool.query<{ before_state: { recommendedPartnerId: string | null } | null; after_state: { recommendedPartnerId: string | null } | null }>(
      `select before_state, after_state from change_ledger where pursuit_id=$1 and change_type='ROUTE_RECOMMENDATION_CHANGED' order by recorded_at desc limit 1`, [pid])).rows[0];
    ok("4. recommendation history recorded CDW → new", !!hist && (await partnerName(pool, hist.before_state?.recommendedPartnerId ?? null)) === "CDW" && hist.after_state?.recommendedPartnerId !== recBeforePartner);
    ok("5. the human decision (WWT) is unchanged on the pursuit", (await partnerName(pool, (await pool.query<{ selected_partner_id: string | null }>(`select selected_partner_id from pursuits where id=$1`, [pid])).rows[0].selected_partner_id)) === wwt.label);

    const view = await tx(pool, org, (db) => getRouteComparison(db, internal(org), pid));
    ok("6. read model reflects divergence: decided, selection ≠ recommendation", view.decided && !view.selectionMatchesRecommendation && view.selected?.label === wwt.label && view.recommended?.label !== wwt.label);

    // 7. A further plain recompute must NOT change the selection; only a governed decision may.
    await tx(pool, org, (db) => recomputeRoute(db, pid, new Date(), "DEMO"));
    ok("7. a subsequent belief recompute still preserves the human decision (WWT)", (await partnerName(pool, (await snapshot(pool, pid)).selected_partner_id)) === wwt.label);
    // And a governed decision CAN change it (to the recommended route), recorded as a new decision.
    const recNow = (await snapshot(pool, pid)).recommended_partner_id;
    const recCand = (await pool.query<{ id: string }>(`select rc.id from route_candidates rc join pursuit_route_snapshots s on s.id=rc.route_snapshot_id where s.pursuit_id=$1 and s.is_current and rc.is_recommended`, [pid])).rows[0];
    await tx(pool, org, (db) => dispatchSkill(db, "select_partner_route", { type: "USER", id: null, orgId: org, role: "operator" }, { pursuitId: pid, args: { candidateKey: recCand.id }, correlationId: randomUUID() }));
    ok("7b. only a governed selection changes the decision (now matches recommendation)", (await partnerName(pool, (await snapshot(pool, pid)).selected_partner_id)) === (await partnerName(pool, recNow)));

    console.log(`\n[route-persistence-verify] ${pass} passed, ${fail} failed`);
    if (fail) process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error("[route-persistence-verify] fatal:", e); process.exit(1); });
