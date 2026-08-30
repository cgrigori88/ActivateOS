import type { PoolClient } from "pg";
import { upsertTouch } from "../comms/authoring";
import { requestWarmIntro } from "../partnerships/warm-intros";

/**
 * Governed-write implementations for the MCP surface (Release Gate R1-G1). These are
 * the bound handlers behind the `draft_campaign_touch` and `request_warm_intro`
 * governed skills — the SAME domain logic the MCP tools used to run inline, now
 * reachable ONLY through `dispatchSkill` (authorization → consent → effect class →
 * idempotency → audited invocation). There is no ungoverned parallel path. Each runs
 * inside an already-open tenant transaction (dispatchSkill's caller opened it), so it
 * never opens its own.
 */

export interface DraftTouchArgs { campaign?: string; name?: string; subject?: string; body?: string }

export async function draftTouchImpl(db: PoolClient, _orgId: string, args: DraftTouchArgs): Promise<unknown> {
  const q = String(args.campaign ?? "").trim();
  const { rows } = await db.query<{ id: string; name: string }>(
    `select id, name from campaigns where name ilike $1 order by created_at desc limit 1`, [`%${q}%`]);
  if (!rows[0]) return { created: false, message: `No campaign matching "${q}".` };
  await upsertTouch(db, {
    campaignId: rows[0].id,
    fields: {
      name: String(args.name ?? "Agent draft"), subject: String(args.subject ?? ""), body: String(args.body ?? ""),
      preheader: "", headline: "", highlights: [], ctaLabel: "", ctaUrl: "",
      sendOffsetDays: 0, accountAngle: "", customHtml: "", ccEmails: [],
    },
  });
  return { created: true, campaign: rows[0].name, status: "draft",
    note: "Draft only — a human approves it in the campaign room before anything can send." };
}

export interface WarmIntroArgs { partner?: string; account?: string; ask?: string }

/** Resolve the (partnership, account) a warm-intro targets, or a reason it cannot proceed. */
async function resolveWarmIntroTarget(db: PoolClient, orgId: string, args: WarmIntroArgs): Promise<
  { ok: true; partnershipId: string; companyId: string } | { ok: false; reason: string }> {
  const pq = String(args.partner ?? "").trim();
  const aq = String(args.account ?? "").trim();
  const { rows: pr } = await db.query<{ id: string }>(
    `select id from partners where org_id = $1 and name ilike $2 limit 1`, [orgId, `%${pq}%`]);
  if (!pr[0]) return { ok: false, reason: `No partner matching "${pq}".` };
  const { rows: ps } = await db.query<{ id: string }>(
    `select id from partnerships p
      where p.status = 'active'
        and ((p.initiator_org_id = $1 and p.initiator_partner_id = $2)
          or (p.counterpart_org_id = $1 and p.counterpart_partner_id = $2))
      limit 1`, [orgId, pr[0].id]);
  if (!ps[0]) return { ok: false, reason: "No active partnership with that partner." };
  const { rows: co } = await db.query<{ id: string }>(
    `select id from companies where legal_name ilike $1 limit 1`, [`%${aq}%`]);
  if (!co[0]) return { ok: false, reason: `No account matching "${aq}".` };
  return { ok: true, partnershipId: ps[0].id, companyId: co[0].id };
}

/**
 * Cross-tenant authority check for the warm-intro skill (R1-G1). The "action
 * authority" for a warm intro is the ACTIVE PARTNERSHIP + the account being on it —
 * the partnership consent fabric, not the federation context-grant model. Supplied to
 * dispatchSkill as the skill's own `authorize` hook so a legitimate warm intro is
 * governed without forcing it through the unrelated context-grant path.
 */
export async function warmIntroAuthorize(db: PoolClient, orgId: string, args: WarmIntroArgs): Promise<{ ok: boolean; reason?: string }> {
  const t = await resolveWarmIntroTarget(db, orgId, args);
  return t.ok ? { ok: true } : { ok: false, reason: t.reason };
}

export async function requestWarmIntroImpl(db: PoolClient, orgId: string, args: WarmIntroArgs): Promise<unknown> {
  const t = await resolveWarmIntroTarget(db, orgId, args);
  if (!t.ok) return { ok: false, message: t.reason };
  await requestWarmIntro(db, orgId, t.partnershipId, t.companyId, String(args.ask ?? "").slice(0, 500));
  return { ok: true, message: "Warm-intro request created — the partner decides, and their acceptance is the disclosure." };
}
