import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { CERTIFICATION_SUBJECT_KINDS, type CertificationSubjectKind } from "../src/lib/pursuits/lineage";

/**
 * Populate `certification_exclusions` from the checked-in manifest.
 *
 *   npx tsx scripts/certification-exclusion-activate.ts                 # dry run (the default)
 *   npx tsx scripts/certification-exclusion-activate.ts --apply         # write
 *
 * ── THIS SCRIPT CONTAINS NO IDENTIFICATION LOGIC, AND THAT IS ITS ENTIRE POINT ──────────────────
 *
 * It cannot decide that something is certification activity. It reads exact ids from
 * `docs/pilot/certification-exclusion-manifest.json`, which was enumerated once from the database
 * and reviewed. There is no timestamp window here, no "runs near this deployment", no fixture-name
 * pattern and no row-count heuristic — the four methods that would make the result unauditable.
 * Re-run it against the same database and it writes the same rows or none.
 *
 * ── IT NEVER TOUCHES A SOURCE ROW ───────────────────────────────────────────────────────────────
 *
 * The mislabelled rows keep their historical `data_environment` forever. Rewriting them would
 * destroy the evidence that the mislabelling happened, and `change_ledger` could not be rewritten
 * anyway: app_rw holds INSERT and SELECT on it and nothing else. Exclusion is recorded BESIDE
 * history, never in place of it.
 *
 * ── WHY `on conflict do nothing` IS SAFE HERE ───────────────────────────────────────────────────
 *
 * `certification_exclusions` is append-only (app_rw=ar): there is no UPDATE to race with, so a
 * second run genuinely is a no-op rather than a silent overwrite. The report distinguishes rows
 * written from rows already present, so "0 written" on a second run is legible rather than alarming.
 */

interface Subject {
  orgId: string;
  subjectKind: CertificationSubjectKind;
  subjectId: string;
  gateLabel: string;
  reason: string;
}

const MANIFEST = new URL("../docs/pilot/certification-exclusion-manifest.json", import.meta.url);
const APPLY = process.argv.includes("--apply");

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { subjects: Subject[]; counts: Record<string, number> };
  const subjects = manifest.subjects;

  // The manifest is an input, so it is validated like one. A kind the schema would refuse is caught
  // here rather than half-way through the insert loop.
  const bad = subjects.filter((s) => !CERTIFICATION_SUBJECT_KINDS.includes(s.subjectKind));
  if (bad.length) {
    console.error(`manifest names ${bad.length} unknown subject kind(s): ${[...new Set(bad.map((b) => b.subjectKind))].join(", ")}`);
    process.exit(2);
  }
  if (subjects.length !== manifest.counts.TOTAL) {
    console.error(`manifest is inconsistent: ${subjects.length} subjects, counts.TOTAL = ${manifest.counts.TOTAL}`);
    process.exit(2);
  }

  const url = process.env.TARGET_URL;
  if (!url) { console.error("TARGET_URL must be set to the database to populate."); process.exit(2); }

  const pool = new Pool({ connectionString: url });
  const db = await pool.connect();
  let written = 0, already = 0;
  try {
    await db.query("begin");
    for (const s of subjects) {
      // The tenant GUC is set per subject: the manifest spans more than one org, and a single
      // session-wide value would silently fail RLS for the others if this ever runs as app_rw.
      await db.query(`select set_config('app.org_id', $1, true)`, [s.orgId]);
      const r = await db.query(
        `insert into certification_exclusions (org_id, subject_kind, subject_id, reason, gate_label)
         values ($1,$2,$3,$4,$5)
         on conflict (org_id, subject_kind, subject_id) do nothing`,
        [s.orgId, s.subjectKind, s.subjectId, s.reason, s.gateLabel]);
      if (r.rowCount) written++; else already++;
    }
    if (APPLY) { await db.query("commit"); } else { await db.query("rollback"); }
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    db.release();
  }

  console.log(`[certification-exclusion] ${APPLY ? "APPLIED" : "DRY RUN (rolled back)"}`);
  console.log(`  subjects in manifest : ${subjects.length}`);
  console.log(`  rows written         : ${written}`);
  console.log(`  already present      : ${already}`);
  for (const [k, v] of Object.entries(manifest.counts)) if (k !== "TOTAL") console.log(`    ${k.padEnd(28)} ${v}`);
  await pool.end();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
