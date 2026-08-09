import { getPool } from "../src/db/client";
import { composeCampaign } from "../src/lib/agents/campaign-composer";

/** Usage: npm run compose-campaign -- <motion-id> */
async function main() {
  const motionId = process.argv[2];
  if (!motionId) {
    console.error("usage: npm run compose-campaign -- <motion-id>");
    process.exit(1);
  }
  const pool = getPool();
  const db = await pool.connect();
  try {
    const { campaignId, draft } = await composeCampaign(db, motionId);
    console.log(`Campaign ${campaignId}: "${draft.campaign_name}" (4 assets)\n`);
    console.log(`--- Outreach email\nSubject: ${draft.outreach_email.subject}\n\n${draft.outreach_email.body}\n`);
    console.log(`--- Discovery questions`);
    draft.discovery_questions.forEach((q, i) => console.log(`${i + 1}. ${q}`));
    console.log(`\n--- Seller playbook (first 400 chars)\n${draft.seller_playbook.slice(0, 400)}...`);
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
