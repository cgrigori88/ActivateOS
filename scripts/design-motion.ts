import { getPool } from "../src/db/client";
import { designMotion } from "../src/lib/agents/motion-designer";

/** Usage: npm run design-motion -- --org "Org" --company "Company" [--target slug] */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgName = arg("org") ?? "ActivateOS Dev";
  const companyName = arg("company");
  const targetSlug = arg("target") ?? "infrastructure-automation";
  if (!companyName) {
    console.error('usage: npm run design-motion -- --org "Org" --company "Company" [--target slug]');
    process.exit(1);
  }

  const pool = getPool();
  const db = await pool.connect();
  try {
    const { rows: orgs } = await db.query<{ id: string }>(
      `select id from organizations where name = $1`, [orgName]);
    if (orgs.length === 0) throw new Error(`organization not found: ${orgName}`);
    const { rows: companies } = await db.query<{ id: string }>(
      `select id from companies where legal_name ilike $1 limit 1`, [companyName]);
    if (companies.length === 0) throw new Error(`company not found: ${companyName}`);

    const { motionId, draft } = await designMotion(db, {
      orgId: orgs[0].id,
      companyId: companies[0].id,
      targetSlug,
    });
    console.log(`Revenue Motion ${motionId} (DRAFT — pending approval)\n`);
    console.log(`Thesis:    ${draft.thesis}\n`);
    console.log(`Trigger:   ${draft.trigger_summary}`);
    console.log(`Personas:  ${draft.primary_persona} / ${draft.secondary_persona}`);
    console.log(`CTA:       ${draft.cta}`);
    console.log(`Confidence:${draft.confidence}  Citations: ${draft.cited_evidence_ids.length}`);
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
