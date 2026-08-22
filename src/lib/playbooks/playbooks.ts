import type { Pool, PoolClient } from "pg";
import { audit } from "@/lib/partnerships/partnerships";

type Db = Pool | PoolClient;

/**
 * Playbooks (task #83, GTM-OS batch slice 3).
 *
 * Partner playbook: YOUR org's private notes on how to sell WITH one partner
 * — positioning, their strengths, rules of engagement. Grounds the motion
 * designer (and through it the outreach chain) whenever that partner is on
 * the pursuit team. Never visible to the partner.
 *
 * Joint playbook: ONE body per partnership, co-edited inside the joint
 * fabric — symmetric like the pursuit ledger. Both tenants read and write
 * the identical text; every edit lands on BOTH orgs' audit ledgers; the
 * broker cites it in proposals.
 */

export interface PartnerPlaybook {
  positioning: string;
  strengths: string;
  rules: string;
  updatedAt: string | null;
}

export async function loadPartnerPlaybook(db: Db, orgId: string, partnerId: string): Promise<PartnerPlaybook | null> {
  const { rows } = await db.query<{ positioning: string | null; strengths: string | null; rules: string | null; updated_at: Date }>(
    `select positioning, strengths, rules, updated_at from partner_playbooks
     where org_id = $1 and partner_id = $2`,
    [orgId, partnerId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  if (!r.positioning?.trim() && !r.strengths?.trim() && !r.rules?.trim()) return null;
  return {
    positioning: r.positioning ?? "",
    strengths: r.strengths ?? "",
    rules: r.rules ?? "",
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString().slice(0, 10) : null,
  };
}

export async function savePartnerPlaybook(
  db: Db,
  orgId: string,
  partnerId: string,
  fields: { positioning: string; strengths: string; rules: string },
): Promise<void> {
  const { rows } = await db.query(`select 1 from partners where id = $1 and org_id = $2`, [partnerId, orgId]);
  if (rows.length === 0) throw new Error("Unknown partner for this organization.");
  const clip = (s: string) => s.trim().slice(0, 4000);
  await db.query(
    `insert into partner_playbooks (org_id, partner_id, positioning, strengths, rules, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (org_id, partner_id) do update
       set positioning = excluded.positioning, strengths = excluded.strengths,
           rules = excluded.rules, updated_at = now()`,
    [orgId, partnerId, clip(fields.positioning), clip(fields.strengths), clip(fields.rules)],
  );
}

export interface JointPlaybook {
  body: string;
  updatedByOrg: string | null;
  updatedAt: string | null;
}

async function partnershipMembers(db: Db, partnershipId: string): Promise<string[]> {
  const { rows } = await db.query<{ initiator_org_id: string; counterpart_org_id: string | null }>(
    `select initiator_org_id, counterpart_org_id from partnerships where id = $1`,
    [partnershipId],
  );
  if (!rows[0]) throw new Error("Partnership not found.");
  return [rows[0].initiator_org_id, rows[0].counterpart_org_id].filter(Boolean) as string[];
}

export async function loadJointPlaybook(db: Db, partnershipId: string): Promise<JointPlaybook | null> {
  const { rows } = await db.query<{ body: string; updated_by_org: string | null; updated_at: Date }>(
    `select body, updated_by_org, updated_at from joint_playbooks where partnership_id = $1`,
    [partnershipId],
  );
  if (!rows[0] || !rows[0].body.trim()) return null;
  return {
    body: rows[0].body,
    updatedByOrg: rows[0].updated_by_org,
    updatedAt: rows[0].updated_at ? new Date(rows[0].updated_at).toISOString().slice(0, 10) : null,
  };
}

export async function saveJointPlaybook(db: Db, orgId: string, partnershipId: string, body: string): Promise<void> {
  const members = await partnershipMembers(db, partnershipId);
  if (!members.includes(orgId)) throw new Error("Your organization is not part of this partnership.");
  const trimmed = body.trim().slice(0, 8000);
  await db.query(
    `insert into joint_playbooks (partnership_id, body, updated_by_org, updated_at)
     values ($1, $2, $3, now())
     on conflict (partnership_id) do update
       set body = excluded.body, updated_by_org = excluded.updated_by_org, updated_at = now()`,
    [partnershipId, trimmed, orgId],
  );
  for (const org of members) {
    await audit(db, org, "playbook.updated", { by: org === orgId ? "us" : "counterpart", chars: trimmed.length }, partnershipId);
  }
}
