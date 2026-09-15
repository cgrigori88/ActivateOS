import { getPool } from "../src/db/client";
import { approveMotion, rejectMotion, EDITABLE_FIELDS, type EditableField } from "../src/lib/motions/approve";

/**
 * Motion approval CLI (the human gate).
 *
 * Usage:
 *   npm run motion -- list
 *   npm run motion -- approve <motion-id> --org <org-id> [--thesis "..."] [--cta "..."] ...
 *   npm run motion -- reject <motion-id> --org <org-id> [note]
 *
 * Field overrides on approve are recorded as human-edit diffs on the agent
 * run — they feed the learning loop. The operator names the org they act for
 * (--org, or MOTION_ORG_ID); approve/reject refuse a motion outside that org.
 */
async function main() {
  const argv = process.argv.slice(2);
  const orgAt = argv.indexOf("--org");
  const orgId = orgAt !== -1 ? argv[orgAt + 1] : process.env.MOTION_ORG_ID;
  if (orgAt !== -1) argv.splice(orgAt, 2);
  const [command, ...rest] = argv;
  const requireOrg = (): string => {
    if (!orgId) throw new Error("approve/reject need the acting org: --org <org-id> (or MOTION_ORG_ID)");
    return orgId;
  };
  const pool = getPool();
  const db = await pool.connect();
  try {
    if (command === "list") {
      const { rows } = await db.query(
        `select m.id, m.status, m.confidence, c.legal_name, n.slug, m.created_at::date as created
         from revenue_motions m
         join companies c on c.id = m.company_id
         join taxonomy_nodes n on n.id = m.taxonomy_node_id
         order by m.created_at desc limit 20`,
      );
      for (const m of rows) {
        console.log(`[${m.id}] ${m.status.toUpperCase().padEnd(9)} ${m.legal_name} — ${m.slug} (${m.confidence}, ${m.created})`);
      }
      if (rows.length === 0) console.log("no motions");
    } else if (command === "approve") {
      const id = rest[0];
      if (!id) throw new Error("usage: motion approve <id> [--field value ...]");
      const edits: Partial<Record<EditableField, string>> = {};
      for (const field of EDITABLE_FIELDS) {
        const i = rest.indexOf(`--${field}`);
        if (i !== -1 && rest[i + 1]) edits[field] = rest[i + 1];
      }
      const { edited } = await approveMotion(db, requireOrg(), id, edits);
      console.log(`motion ${id} APPROVED${edited ? " (with edits — diff recorded for learning)" : ""}`);
    } else if (command === "reject") {
      const [id, ...noteParts] = rest;
      if (!id) throw new Error("usage: motion reject <id> [note]");
      await rejectMotion(db, requireOrg(), id, noteParts.join(" ") || undefined);
      console.log(`motion ${id} rejected`);
    } else {
      console.error("usage: npm run motion -- list | approve <id> [--field value] | reject <id> [note]");
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
