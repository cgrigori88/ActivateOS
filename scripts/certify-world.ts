import { execFileSync } from "node:child_process";
import { SUITES } from "./verify-classes";
import { diffFingerprints, fingerprintWorld, type WorldFingerprint } from "./world-fingerprint";

/**
 * Certification integrity gate (H1A).
 *
 * THE RULE. Certifying the canonical world must not change it. The whole verifier battery runs,
 * and the world afterwards must be identical — every table, every row — to the world before.
 *
 * WHY THIS EXISTS. The battery only ever proved that each suite PASSED. Nothing proved that the
 * world it passed against was still the certified one afterwards. `team-motion-verify` once
 * committed a route selection and team invites/accepts onto the Globex hero; the manifest digest
 * did not notice (it counts no route or team table) and a later suite failed for a reason that had
 * nothing to do with its own code.
 *
 * HOW.
 *   1. Fingerprint the whole world (scripts/world-fingerprint.ts: every table's rows + content hash).
 *   2. Run every suite through verify-run.ts, one at a time: SEEDED suites against the target world,
 *      FRESH / EITHER suites on the disposable databases verify-run provisions (they must not touch
 *      the target either — the gate proves that too).
 *   3. Fingerprint again AFTER EACH SUITE, so any drift is attributed to the suite that caused it.
 *   4. Fail on ANY drift, naming the suite and the tables.
 *
 * Point it at a disposable COPY of the canonical world when auditing an unknown battery, so a
 * mutating suite cannot damage the real one:
 *
 *   CERT_URL=postgres://…/pursuit_cert ADMIN_URL=postgres://…/postgres npx tsx scripts/certify-world.ts
 *   … --runs 2      run the whole battery twice; the second run must end where the first began
 *   … --suite name  one suite only
 */

const CERT_URL = process.env.CERT_URL ?? process.env.SEEDED_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo";
const ADMIN_URL = process.env.ADMIN_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
const runs = Number(process.argv[process.argv.indexOf("--runs") + 1]) > 0 && process.argv.includes("--runs")
  ? Number(process.argv[process.argv.indexOf("--runs") + 1]) : 1;
const only = process.argv.includes("--suite") ? process.argv[process.argv.indexOf("--suite") + 1] : null;

interface SuiteOutcome { run: number; suite: string; cls: string; verdict: string; drift: string[] }

function runOne(name: string): string {
  let out = "";
  try {
    out = execFileSync("npx", ["tsx", "scripts/verify-run.ts", "--suite", name], {
      encoding: "utf8", timeout: 900_000,
      env: { ...process.env, SEEDED_URL: CERT_URL, ADMIN_URL, OUTREACH_AUTOSEND: "", RESEND_API_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    out = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
  }
  const line = out.split("\n").find((l) => l.startsWith(name.padEnd(22)) || l.startsWith(`${name} `));
  return (line ?? out.split("\n").find((l) => /TOTAL:/.test(l)) ?? "no result line").replace(/\s+/g, " ").trim();
}

async function main(): Promise<void> {
  const suites = SUITES.filter((s) => s.cls !== "DEPLOYMENT_ONLY" && (!only || s.name === only));
  console.log(`[certify-world] target ${CERT_URL.replace(/:[^:@/]*@/, ":***@")} · ${suites.length} suites × ${runs} run(s)`);
  const start = await fingerprintWorld(CERT_URL);
  console.log(`  start digest ${start.digest}`);
  const outcomes: SuiteOutcome[] = [];
  const runDigests: string[] = [];
  let prev: WorldFingerprint = start;
  for (let run = 1; run <= runs; run++) {
    for (const s of suites) {
      const verdict = runOne(s.name);
      const now = await fingerprintWorld(CERT_URL);
      const drift = diffFingerprints(prev, now).map((d) => `${d.table} ${d.before}→${d.after}`);
      outcomes.push({ run, suite: s.name, cls: s.cls, verdict, drift });
      console.log(`  run ${run} · ${s.name.padEnd(22)} ${s.cls.padEnd(7)} ${drift.length ? `DRIFT (${drift.join(", ")})` : "no drift"} · ${verdict.replace(s.name, "").trim()}`);
      prev = now;
    }
    runDigests.push(prev.digest);
    console.log(`  end of run ${run}: digest ${prev.digest}`);
  }
  const total = diffFingerprints(start, prev);
  const drifting = outcomes.filter((o) => o.drift.length);
  const failing = outcomes.filter((o) => /FATAL|[1-9]\d* failed/.test(o.verdict));
  console.log(`\nCERTIFICATION INTEGRITY: ${total.length === 0 && drifting.length === 0 ? "PASS" : "FAIL"} — start ${start.digest}, ${runDigests.map((d, i) => `after run ${i + 1} ${d}`).join(", ")}`);
  if (drifting.length) for (const o of drifting) console.log(`  drift: run ${o.run} ${o.suite} → ${o.drift.join(", ")}`);
  console.log(`SUITE VERDICTS: ${outcomes.length - failing.length} clean, ${failing.length} with failures`);
  for (const o of failing) console.log(`  ✗ run ${o.run} ${o.suite}: ${o.verdict}`);
  process.exit(total.length || drifting.length ? 1 : failing.length ? 2 : 0);
}

main().catch((e) => { console.error("[certify-world] fatal:", e); process.exit(1); });
