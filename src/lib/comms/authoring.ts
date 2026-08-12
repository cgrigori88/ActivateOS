import type pg from "pg";
import { renderBrandedEmail, type EmailBrand } from "./templates";

/**
 * Manual campaign authoring (Phase 9B.1). Everything the composer needs to
 * build and edit a sequence by hand — resolve the org brand, build the account
 * snapshot, render a touch to branded HTML, and create/edit/delete touches.
 * Shared with the AI generator so hand-authored and generated touches render
 * identically.
 */

export interface TouchFields {
  name: string;
  subject: string;
  preheader?: string | null;
  headline?: string | null;
  body: string; // paragraphs separated by blank lines
  highlights?: string[];
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  sendOffsetDays?: number;
  /** Optional seller HTML — replaces the structured body, keeps the brand shell. */
  customHtml?: string | null;
  /** Per-recipient layer: token-templated angle resolved per account on send. */
  accountAngle?: string | null;
}

export async function resolveBrand(
  db: pg.PoolClient,
  orgId: string | null,
): Promise<{ brand: EmailBrand; brandId: string | null }> {
  const { rows } = await db.query<{
    id: string;
    wordmark: string;
    primary_color: string;
    accent_color: string;
    footer_html: string | null;
    address_line: string | null;
    unsubscribe_url: string | null;
  }>(
    `select id, wordmark, primary_color, accent_color, footer_html, address_line, unsubscribe_url
     from brand_profiles where org_id is not distinct from $1
     order by is_default desc, created_at asc limit 1`,
    [orgId],
  );
  const b = rows[0];
  return {
    brandId: b?.id ?? null,
    brand: {
      wordmark: b?.wordmark ?? "PursuitOS",
      primaryColor: b?.primary_color ?? "#1d4ed8",
      accentColor: b?.accent_color ?? "#0f172a",
      footerHtml: b?.footer_html ?? null,
      addressLine: b?.address_line ?? null,
      unsubscribeUrl: b?.unsubscribe_url ?? null,
    },
  };
}

export async function companySnapshot(
  db: pg.PoolClient,
  companyId: string,
): Promise<{ label: string; value: string }[]> {
  const { rows } = await db.query<{ industry: string | null; employee_count: number | null; primary_domain: string | null }>(
    `select industry, employee_count, primary_domain from companies where id = $1`,
    [companyId],
  );
  const c = rows[0];
  const snap: { label: string; value: string }[] = [];
  if (c?.industry) snap.push({ label: "Industry", value: c.industry });
  if (c?.employee_count) snap.push({ label: "Headcount", value: `~${Number(c.employee_count).toLocaleString()}` });
  if (c?.primary_domain) snap.push({ label: "Domain", value: c.primary_domain });
  return snap.slice(0, 3);
}

export function renderTouch(
  brand: EmailBrand,
  touchNo: number,
  f: TouchFields,
  opts?: { snapshot?: { label: string; value: string }[]; signoff?: string | null },
): { html: string; text: string } {
  return renderBrandedEmail(brand, {
    preheader: f.preheader,
    eyebrow: `Touch ${touchNo}`,
    headline: f.headline,
    paragraphs: (f.body ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    highlights: f.highlights,
    snapshot: f.customHtml ? undefined : opts?.snapshot,
    ctaLabel: f.ctaLabel,
    ctaUrl: f.ctaUrl ?? null,
    signoff: opts?.signoff ?? null,
    customHtml: f.customHtml ?? null,
  });
}

export async function createBlankCampaign(
  db: pg.PoolClient,
  args: { orgId: string | null; companyId: string; name: string; senderName?: string | null; objective?: string | null },
): Promise<{ campaignId: string }> {
  const { brandId } = await resolveBrand(db, args.orgId);
  const { rows } = await db.query<{ id: string }>(
    `insert into campaigns (org_id, company_id, name, status, brand_id, objective, sender_name)
     values ($1, $2, $3, 'draft', $4, $5, $6) returning id`,
    [args.orgId, args.companyId, args.name, brandId, args.objective ?? null, args.senderName ?? null],
  );
  return { campaignId: rows[0].id };
}

async function campaignContext(
  db: pg.PoolClient,
  campaignId: string,
): Promise<{ orgId: string | null; companyId: string; senderName: string | null }> {
  const { rows } = await db.query<{ org_id: string | null; company_id: string | null; sender_name: string | null; m_company: string | null; seller_name: string | null }>(
    `select ca.org_id, ca.company_id, ca.sender_name, m.company_id as m_company, s.name as seller_name
     from campaigns ca
     left join revenue_motions m on m.id = ca.motion_id
     left join sellers s on s.id = m.partner_seller_id
     where ca.id = $1`,
    [campaignId],
  );
  if (rows.length === 0) throw new Error("campaign not found");
  const r = rows[0];
  const companyId = r.company_id ?? r.m_company;
  if (!companyId) throw new Error("campaign has no account");
  return { orgId: r.org_id, companyId, senderName: r.sender_name ?? r.seller_name };
}

/** Add a new touch (auto touch_no) or edit an existing one; re-renders HTML. */
export async function upsertTouch(
  db: pg.PoolClient,
  args: { campaignId: string; touchId?: string; fields: TouchFields },
): Promise<{ touchId: string }> {
  const ctx = await campaignContext(db, args.campaignId);
  const { brand } = await resolveBrand(db, ctx.orgId);
  const f = args.fields;

  let touchNo: number;
  if (args.touchId) {
    const { rows } = await db.query<{ touch_no: number; status: string }>(
      `select touch_no, status from campaign_touches where id = $1 and campaign_id = $2`,
      [args.touchId, args.campaignId],
    );
    if (rows.length === 0) throw new Error("touch not found");
    if (rows[0].status === "sent") throw new Error("a sent touch cannot be edited");
    touchNo = rows[0].touch_no;
  } else {
    const { rows } = await db.query<{ next: number }>(
      `select coalesce(max(touch_no), 0) + 1 as next from campaign_touches where campaign_id = $1`,
      [args.campaignId],
    );
    touchNo = rows[0].next;
  }

  const snapshot = touchNo === 1 ? await companySnapshot(db, ctx.companyId) : undefined;
  const { html, text } = renderTouch(brand, touchNo, f, { snapshot, signoff: ctx.senderName });
  const offset = Number.isFinite(f.sendOffsetDays) ? Number(f.sendOffsetDays) : 0;

  if (args.touchId) {
    await db.query(
      `update campaign_touches set name=$2, subject=$3, preheader=$4, headline=$5, body=$6,
         highlights=$7, cta_label=$8, cta_url=$9, html_body=$10, text_body=$11, send_offset_days=$12,
         custom_html=$13, account_angle=$14, status = case when status = 'rejected' then 'draft' else status end
       where id = $1`,
      [args.touchId, f.name, f.subject, f.preheader ?? null, f.headline ?? null, f.body ?? "",
       f.highlights ?? [], f.ctaLabel ?? null, f.ctaUrl ?? null, html, text, offset, f.customHtml ?? null, f.accountAngle ?? null],
    );
    return { touchId: args.touchId };
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into campaign_touches
       (campaign_id, touch_no, name, subject, preheader, headline, body, highlights,
        cta_label, cta_url, html_body, text_body, send_offset_days, custom_html, account_angle, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft') returning id`,
    [args.campaignId, touchNo, f.name, f.subject, f.preheader ?? null, f.headline ?? null, f.body ?? "",
     f.highlights ?? [], f.ctaLabel ?? null, f.ctaUrl ?? null, html, text, offset, f.customHtml ?? null, f.accountAngle ?? null],
  );
  return { touchId: rows[0].id };
}

export async function deleteTouch(db: pg.PoolClient, touchId: string): Promise<void> {
  await db.query(`delete from campaign_touches where id = $1 and status <> 'sent'`, [touchId]);
}
