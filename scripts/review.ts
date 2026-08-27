import { getPool } from "../src/db/client";
import { resolveReview } from "../src/lib/quality/review";

/**
 * Founder review queue (Plane 2). Each verdict records the judgment,
 * bounded-updates the source's trust and sample rate, banks a golden-set
 * example, and (on 'accurate') promotes quarantined evidence to verified.
 *
 * Usage:
 *   npm run review -- list
 *   npm run review -- resolve <review-id> accurate|inaccurate|unsure [note]
 */
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const pool = getPool();
  const db = await pool.connect();
  try {
    if (command === "list") {
      const { rows } = await db.query(
        `select rq.id, rq.reason, e.source_type, e.status, e.claim, e.raw_excerpt
         from review_queue rq join evidence e on e.id = rq.evidence_id
         where rq.status = 'pending' order by rq.created_at`,
      );
      if (rows.length === 0) {
        console.log("review queue is empty");
        return;
      }
      for (const r of rows) {
        console.log(`\n[${r.id}] (${r.reason}, source=${r.source_type}, status=${r.status})`);
        console.log(`  claim:   ${r.claim}`);
        if (r.raw_excerpt && r.raw_excerpt !== r.claim) {
          console.log(`  excerpt: ${String(r.raw_excerpt).slice(0, 200)}`);
        }
      }
      console.log(`\n${rows.length} pending — resolve with: npm run review -- resolve <id> accurate|inaccurate`);
    } else if (command === "resolve") {
      const [id, verdict, ...noteParts] = rest;
      if (!id || !["accurate", "inaccurate", "unsure"].includes(verdict)) {
        console.error("usage: npm run review -- resolve <review-id> accurate|inaccurate|unsure [note]");
        process.exit(1);
      }
      // Admin CLI: resolve the review's own org so the org-scoped write matches.
      const { rows: orgRows } = await db.query<{ org_id: string }>(
        `select org_id from review_queue where id = $1`,
        [id],
      );
      if (!orgRows[0]) {
        console.error(`review ${id} not found`);
        process.exit(1);
      }
      await resolveReview(db, orgRows[0].org_id, id, verdict as "accurate" | "inaccurate" | "unsure", noteParts.join(" ") || undefined);
      const { rows } = await db.query(
        `select name, round(trust_score, 3) trust, round(audit_sample_rate, 3) rate
         from signal_sources order by name`,
      );
      console.log(`resolved ${id} as ${verdict}. Source trust now:`);
      for (const s of rows) console.log(`  ${s.name}: trust=${s.trust}, sample_rate=${s.rate}`);
    } else {
      console.error("usage: npm run review -- list | resolve <id> <verdict>");
      process.exit(1);
    }
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
