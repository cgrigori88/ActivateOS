/**
 * Synthetic MEDDPICC enrichment for the Design Partner Demonstration Environment.
 *
 * Populates the EXISTING demo opportunities with realistic MEDDPICC assessments (and a small set of
 * historical closed deals) so the Pipeline "avg qualification / MEDDPICC health" bento and the
 * "AI learned signal · qualification vs outcome" card demonstrate the machinery — NOT fake accuracy.
 *
 * Discipline (matches the enrichment brief):
 *  - existing data structures only (opportunity_meddpicc, opportunities, outcome_events); no new
 *    score or domain primitive;
 *  - DEMO/synthetic provenance stays explicit (org is DEMO; historical rows are clearly labeled);
 *  - UNKNOWN is preserved — every deal keeps genuinely-unknown elements (decision/paper process,
 *    and Stark's criteria) rather than being force-filled into false certainty;
 *  - won-vs-lost is a MODEST, NOISY gap with overlap (a strong deal that still lost, a mediocre deal
 *    that still won), never a clean separator — the point is the learning loop, not perfect AI;
 *  - the sample stays small on purpose (4 won / 4 lost) so Insights' "early sample" honesty holds;
 *  - re-runnable (idempotent): historical rows and prior demo MEDDPICC are cleared first.
 */
import { Pool } from "pg";
import { ELEMENTS, type ElementKey, type Status } from "../src/lib/opportunities/meddpicc";

const URL = process.env.DEMO_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";

/** Deterministic status vector hitting ~targetScore (0-100) while preserving `keepUnknown` elements. */
function statuses(targetScore: number, keepUnknown: ElementKey[], seed: number): Record<ElementKey, Status> {
  const out = {} as Record<ElementKey, Status>;
  for (const e of ELEMENTS) out[e.key] = keepUnknown.includes(e.key) ? "unknown" : "gap";
  let pts = Math.round((targetScore / 100) * 16); // 0..16
  // Order the fillable elements by a stable rotation so different opps concentrate strength differently.
  const fillable = ELEMENTS.map((e) => e.key).filter((k) => !keepUnknown.includes(k));
  const rot = fillable.slice(seed % fillable.length).concat(fillable.slice(0, seed % fillable.length));
  // First pass: gap→weak. Second pass: weak→strong. Stop when points are spent.
  for (let pass = 0; pass < 2 && pts > 0; pass++) {
    for (const k of rot) {
      if (pts <= 0) break;
      if (pass === 0 && out[k] === "gap") { out[k] = "weak"; pts--; }
      else if (pass === 1 && out[k] === "weak") { out[k] = "strong"; pts--; }
    }
  }
  return out;
}

async function setMeddpicc(pool: Pool, oppId: string, vec: Record<ElementKey, Status>) {
  let i = 0;
  for (const e of ELEMENTS) {
    // Provenance mix: some human-set, some AI-assisted drafts (source is explicit either way).
    const source = i % 3 === 0 ? "ai_assist" : "human";
    await pool.query(
      `insert into opportunity_meddpicc (opportunity_id, element, status, notes, source, updated_by, updated_at)
       values ($1,$2,$3,$4,$5,$6, now())
       on conflict (opportunity_id, element) do update
         set status=excluded.status, notes=excluded.notes, source=excluded.source, updated_by=excluded.updated_by, updated_at=now()`,
      [oppId, e.key, vec[e.key], null, source, source === "ai_assist" ? "ai" : "demo"],
    );
    i++;
  }
}

export async function enrichMeddpicc(pool: Pool) {
  const org = (await pool.query<{ id: string }>(`select id from organizations order by created_at asc limit 1`)).rows[0];
  if (!org) throw new Error("no org");
  const node = (await pool.query<{ id: string }>(`select id from taxonomy_nodes limit 1`)).rows[0]?.id ?? null;

  // Idempotency: clear prior historical rows + all demo MEDDPICC so re-runs are clean.
  await pool.query(`delete from opportunity_meddpicc where opportunity_id in (select id from opportunities where org_id=$1)`, [org.id]);
  await pool.query(`delete from outcome_events where org_id=$1 and payload->>'hist'='true'`, [org.id]);
  await pool.query(`delete from opportunities where org_id=$1 and name like 'Hist ·%'`, [org.id]);

  // 1) Give the two existing closed deals a closed_at (calibration + learned-signal need it).
  await pool.query(`update opportunities set closed_at = now() - interval '18 days' where org_id=$1 and stage='closed_won' and closed_at is null`, [org.id]);
  await pool.query(`update opportunities set closed_at = now() - interval '26 days' where org_id=$1 and stage='closed_lost' and closed_at is null`, [org.id]);

  // 2) MEDDPICC on every existing OPEN opp — a realistic spread. Every deal keeps ≥2 unknowns
  //    (decision/paper process are usually unknown); Stark additionally keeps criteria unknown to
  //    reconcile with its preserved-UNKNOWN timing story.
  const open = (await pool.query<{ id: string; name: string; legal: string; stage: string }>(
    `select o.id, o.name, c.legal_name legal, o.stage from opportunities o join companies c on c.id=o.company_id
      where o.org_id=$1 and o.stage not in ('closed_won','closed_lost') order by o.amount_usd desc nulls last`, [org.id])).rows;
  // Target qualification per named hero (others fall to a mid band); noisy, not uniform.
  const targetFor = (legal: string, idx: number): { score: number; keep: ElementKey[] } => {
    if (/^Globex/.test(legal)) return { score: 70, keep: ["decision_process", "paper_process"] };
    if (/^Umbrella/.test(legal)) return { score: 56, keep: ["decision_process", "paper_process", "champion"] }; // late-stage but silent → champion unknown
    if (/^Stark/.test(legal)) return { score: 42, keep: ["decision_process", "paper_process", "decision_criteria"] }; // timing UNKNOWN reconciles with thin qualification
    if (/^Cyberdyne/.test(legal)) return { score: 60, keep: ["decision_process", "paper_process"] };
    const band = [58, 52, 48, 44, 50][idx % 5];
    return { score: band, keep: ["decision_process", "paper_process"] };
  };
  for (let i = 0; i < open.length; i++) {
    const t = targetFor(open[i].legal, i);
    await setMeddpicc(pool, open[i].id, statuses(t.score, t.keep, i + 1));
  }

  // 3) The two existing closed deals: a WON that qualified reasonably, a LOST that was thin.
  const won0 = (await pool.query<{ id: string }>(`select id from opportunities where org_id=$1 and stage='closed_won' limit 1`, [org.id])).rows[0];
  const lost0 = (await pool.query<{ id: string }>(`select id from opportunities where org_id=$1 and stage='closed_lost' limit 1`, [org.id])).rows[0];
  if (won0) await setMeddpicc(pool, won0.id, statuses(69, ["paper_process"], 2));
  if (lost0) await setMeddpicc(pool, lost0.id, statuses(38, ["decision_process", "paper_process", "champion", "economic_buyer"], 4));

  // 4) A small set of HISTORICAL closed deals so won/lost averages are over a real (still small)
  //    sample — WITH overlap: a strong deal that lost, a mediocre deal that won. Not a clean line.
  // Companies this org actually touches (companies are global; org linkage is via its opportunities).
  const cos = (await pool.query<{ id: string; legal_name: string }>(
    `select distinct c.id, c.legal_name from companies c join opportunities o on o.company_id=c.id where o.org_id=$1 order by c.legal_name limit 8`, [org.id])).rows;
  const hist: { label: string; outcome: "closed_won" | "closed_lost"; score: number; keep: ElementKey[]; days: number; amt: number }[] = [
    { label: "Platform standardization", outcome: "closed_won", score: 66, keep: ["paper_process"], days: 40, amt: 540000 },
    { label: "Renewal + expansion", outcome: "closed_won", score: 52, keep: ["decision_process", "paper_process", "competition"], days: 62, amt: 280000 }, // mediocre but won (noise)
    { label: "DR modernization", outcome: "closed_won", score: 63, keep: ["decision_process"], days: 88, amt: 610000 },
    { label: "Greenfield eval (2)", outcome: "closed_lost", score: 58, keep: ["paper_process"], days: 34, amt: 320000 }, // strong but lost (noise)
    { label: "Consolidation pilot", outcome: "closed_lost", score: 41, keep: ["decision_process", "paper_process", "champion"], days: 71, amt: 240000 },
    { label: "Edge refresh eval", outcome: "closed_lost", score: 36, keep: ["decision_process", "paper_process", "economic_buyer", "champion"], days: 95, amt: 190000 },
  ];
  let h = 0;
  for (const d of hist) {
    const co = cos[h % cos.length];
    const oppId = (await pool.query<{ id: string }>(
      `insert into opportunities (org_id, company_id, taxonomy_node_id, name, stage, amount_usd, closed_at, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6, now() - ($7||' days')::interval, now() - ($7||' days')::interval - interval '90 days', now() - ($7||' days')::interval)
       returning id`,
      [org.id, co.id, node, `Hist · ${d.label}`, d.outcome, d.amt, d.days],
    )).rows[0].id;
    await setMeddpicc(pool, oppId, statuses(d.score, d.keep, h + 3));
    await pool.query(
      `insert into outcome_events (org_id, company_id, event_type, payload, occurred_at)
       values ($1,$2,$3,'{"synthetic":true,"hist":true}'::jsonb, now() - ($4||' days')::interval)`,
      [org.id, co.id, d.outcome === "closed_won" ? "CLOSED_WON" : "CLOSED_LOST", d.days],
    );
    h++;
  }

  // Report the resulting, honestly-small picture.
  const rows = (await pool.query<{ bucket: string; n: string; avg: string }>(
    `select case when stage='closed_won' then 'won' when stage='closed_lost' then 'lost' else 'open' end bucket,
            count(distinct o.id) n,
            round(avg(m.pts)) avg
       from opportunities o
       join lateral (
         select sum(case status when 'strong' then 2 when 'weak' then 1 else 0 end)::numeric / (8*2) * 100 pts
           from opportunity_meddpicc where opportunity_id=o.id
       ) m on true
      where o.org_id=$1 group by 1 order by 1`, [org.id])).rows;
  console.log("[demo-meddpicc] qualification by outcome (avg MEDDPICC health, small sample by design):");
  for (const r of rows) console.log(`  ${r.bucket.padEnd(5)} n=${r.n}  avg=${r.avg}`);
  console.log("[demo-meddpicc] done (DEMO/synthetic — provenance explicit; UNKNOWNs preserved).");
}

/** CLI entry: DEMO_URL=… npx tsx scripts/demo-meddpicc.ts */
if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new Pool({ connectionString: URL });
  console.log(`[demo-meddpicc] enriching → ${URL.replace(/:[^:@]*@/, ":***@")}`);
  enrichMeddpicc(pool)
    .then(() => pool.end())
    .catch((e) => { console.error("[demo-meddpicc] fatal:", e); pool.end(); process.exit(1); });
}
