import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "../src/db/client";

/**
 * Seed the partner ecosystem from knowledge/ecosystem/demo-partners.json.
 * Idempotent: partners are matched by (org, name) and refreshed in place.
 *
 * Usage: npm run seed-partners -- [org-name]
 */
interface PartnerSeed {
  name: string;
  partner_type: string;
  capacity?: number;
  industries: string[];
  countries: string[];
  capabilities: { node: string; strength: number; certified: boolean }[];
  relationships: { company: string; strength: number; tenure_months: number }[];
  sellers: {
    name: string;
    territory: string;
    accounts: { company: string; strength: number }[];
  }[];
}

async function main() {
  const orgName = process.argv[2] ?? "Design Partner Demo";
  const seed = JSON.parse(
    readFileSync(join(process.cwd(), "knowledge", "ecosystem", "demo-partners.json"), "utf8"),
  ) as { partners: PartnerSeed[] };

  const pool = getPool();
  const db = await pool.connect();
  try {
    const { rows: orgs } = await db.query<{ id: string }>(
      `select id from organizations where name = $1`,
      [orgName],
    );
    if (orgs.length === 0) throw new Error(`organization not found: ${orgName}`);
    const orgId = orgs[0].id;

    const { rows: nodes } = await db.query<{ id: string; slug: string }>(
      `select id, slug from taxonomy_nodes`,
    );
    const nodeBySlug = new Map(nodes.map((n) => [n.slug, n.id]));

    const companyId = async (name: string): Promise<string> => {
      const { rows } = await db.query<{ id: string }>(
        `select id from companies where legal_name = $1`,
        [name],
      );
      if (rows.length === 0) throw new Error(`company not found: ${name}`);
      return rows[0].id;
    };

    for (const p of seed.partners) {
      const { rows: existing } = await db.query<{ id: string }>(
        `select id from partners where org_id = $1 and name = $2`,
        [orgId, p.name],
      );
      let partnerId: string;
      if (existing.length > 0) {
        partnerId = existing[0].id;
        await db.query(
          `update partners set partner_type = $2, industries = $3, countries = $4, capacity = $5
           where id = $1`,
          [partnerId, p.partner_type, p.industries, p.countries, p.capacity ?? null],
        );
      } else {
        const { rows } = await db.query<{ id: string }>(
          `insert into partners (org_id, name, partner_type, industries, countries, capacity)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [orgId, p.name, p.partner_type, p.industries, p.countries, p.capacity ?? null],
        );
        partnerId = rows[0].id;
      }

      for (const cap of p.capabilities) {
        const nodeId = nodeBySlug.get(cap.node);
        if (!nodeId) throw new Error(`unknown taxonomy node: ${cap.node}`);
        await db.query(
          `insert into partner_capabilities (partner_id, taxonomy_node_id, strength, certified)
           values ($1, $2, $3, $4)
           on conflict (partner_id, taxonomy_node_id)
           do update set strength = excluded.strength, certified = excluded.certified`,
          [partnerId, nodeId, cap.strength, cap.certified],
        );
      }

      for (const rel of p.relationships) {
        await db.query(
          `insert into partner_relationships (partner_id, company_id, strength, tenure_months)
           values ($1, $2, $3, $4)
           on conflict (partner_id, company_id)
           do update set strength = excluded.strength, tenure_months = excluded.tenure_months`,
          [partnerId, await companyId(rel.company), rel.strength, rel.tenure_months],
        );
      }

      for (const seller of p.sellers) {
        const { rows: sellerRows } = await db.query<{ id: string }>(
          `select id from sellers where org_id = $1 and partner_id = $2 and name = $3`,
          [orgId, partnerId, seller.name],
        );
        let sellerId: string;
        if (sellerRows.length > 0) {
          sellerId = sellerRows[0].id;
          await db.query(`update sellers set territory = $2 where id = $1`, [
            sellerId,
            seller.territory,
          ]);
        } else {
          const { rows } = await db.query<{ id: string }>(
            `insert into sellers (org_id, partner_id, name, territory)
             values ($1, $2, $3, $4) returning id`,
            [orgId, partnerId, seller.name, seller.territory],
          );
          sellerId = rows[0].id;
        }
        for (const acct of seller.accounts) {
          await db.query(
            `insert into seller_account_relationships (seller_id, company_id, strength)
             values ($1, $2, $3)
             on conflict (seller_id, company_id) do update set strength = excluded.strength`,
            [sellerId, await companyId(acct.company), acct.strength],
          );
        }
      }
      console.log(
        `${p.name}: ${p.capabilities.length} capabilities, ` +
          `${p.relationships.length} account relationships, ${p.sellers.length} sellers`,
      );
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
