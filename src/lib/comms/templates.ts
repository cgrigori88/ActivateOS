/**
 * Branded HTML email renderer (Phase 9A). Pure and vendor-agnostic: brand
 * tokens (colors, wordmark, footer) come from a brand_profiles row, never
 * hard-coded. The output is table-based with fully inlined styles — the only
 * layout that survives Outlook, Gmail, and Apple Mail alike — and every email
 * ships a plain-text alternative built from the same content.
 *
 * The renderer takes STRUCTURED content (headline, paragraphs, highlights,
 * CTA) rather than a blob of HTML so the generator stays grounded and the
 * result stays on-brand. No account-specific facts originate here.
 */

export interface EmailBrand {
  wordmark: string;
  primaryColor: string; // hex, CTA + accents
  accentColor: string; // hex, header band
  footerHtml?: string | null;
  addressLine?: string | null;
  unsubscribeUrl?: string | null;
}

export interface EmailContent {
  preheader?: string | null; // inbox preview text, hidden in-body
  eyebrow?: string | null; // small label above the headline, e.g. "TOUCH 1"
  headline?: string | null;
  /** Body paragraphs. Plain text; rendered one <p> each. */
  paragraphs: string[];
  /** Scannable proof points rendered as a highlighted list. */
  highlights?: string[];
  /** Optional two-column account snapshot (label → value). */
  snapshot?: { label: string; value: string }[];
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  signoff?: string | null; // e.g. "Dana Whitfield"
  /** Seller-provided body HTML. When set, it replaces the structured body
   *  (paragraphs/highlights/snapshot) but keeps the branded header + footer. */
  customHtml?: string | null;
}

const DEFAULT_BRAND: EmailBrand = {
  wordmark: "PursuitOS",
  primaryColor: "#1d4ed8",
  accentColor: "#0f172a",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Guard against malformed hex so inline styles never break. */
function color(hex: string, fallback: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(hex) ? hex : fallback;
}

export function renderBrandedEmail(
  brandIn: Partial<EmailBrand>,
  content: EmailContent,
): { html: string; text: string } {
  const brand: EmailBrand = { ...DEFAULT_BRAND, ...brandIn };
  const primary = color(brand.primaryColor, DEFAULT_BRAND.primaryColor);
  const accent = color(brand.accentColor, DEFAULT_BRAND.accentColor);

  const preheader = content.preheader?.trim();
  const highlights = (content.highlights ?? []).filter((h) => h.trim());
  const snapshot = (content.snapshot ?? []).filter((s) => s.value?.trim());

  const paragraphsHtml = content.paragraphs
    .filter((p) => p.trim())
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937;">${esc(p)}</p>`,
    )
    .join("");

  const snapshotHtml =
    snapshot.length > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;">
          <tr>${snapshot
            .map(
              (s) => `<td style="padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;vertical-align:top;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;margin-bottom:2px;">${esc(s.label)}</div>
                <div style="font-size:14px;font-weight:600;color:#0f172a;">${esc(s.value)}</div>
              </td>`,
            )
            .join("")}</tr>
        </table>`
      : "";

  const highlightsHtml =
    highlights.length > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;">
          <tr><td style="padding:14px 16px;background:#f8fafc;border-left:3px solid ${primary};border-radius:0 6px 6px 0;">
            ${highlights
              .map(
                (h) =>
                  `<div style="font-size:14px;line-height:1.55;color:#334155;margin:0 0 6px;">&bull;&nbsp; ${esc(h)}</div>`,
              )
              .join("")}
          </td></tr>
        </table>`
      : "";

  const ctaHtml = content.ctaLabel
    ? content.ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
          <tr><td style="border-radius:8px;background:${primary};">
            <a href="${esc(content.ctaUrl)}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(content.ctaLabel)}</a>
          </td></tr>
        </table>`
      : `<p style="margin:8px 0 24px;font-size:15px;font-weight:600;color:${primary};">${esc(content.ctaLabel)}</p>`
    : "";

  const eyebrowHtml = content.eyebrow
    ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${primary};margin:0 0 8px;">${esc(content.eyebrow)}</div>`
    : "";

  const headlineHtml = content.headline
    ? `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">${esc(content.headline)}</h1>`
    : "";

  const signoffHtml = content.signoff
    ? `<p style="margin:20px 0 0;font-size:15px;line-height:1.6;color:#1f2937;">${esc(content.signoff)}</p>`
    : "";

  const footerBits: string[] = [];
  if (brand.footerHtml) footerBits.push(brand.footerHtml);
  if (brand.addressLine) footerBits.push(esc(brand.addressLine));
  if (brand.unsubscribeUrl)
    footerBits.push(
      `<a href="${esc(brand.unsubscribeUrl)}" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a>`,
    );

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
</head>
<body style="margin:0;padding:0;background:#eef2f6;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f6;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr><td style="background:${accent};padding:18px 28px;">
        <span style="font-size:16px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">${esc(brand.wordmark)}</span>
      </td></tr>
      <tr><td style="padding:28px 28px 8px;">
        ${eyebrowHtml}${headlineHtml}${
          content.customHtml && content.customHtml.trim()
            ? `<div style="font-size:15px;line-height:1.6;color:#1f2937;">${content.customHtml}</div>`
            : `${snapshotHtml}${paragraphsHtml}${highlightsHtml}`
        }${ctaHtml}${signoffHtml}
      </td></tr>
      <tr><td style="padding:18px 28px 24px;border-top:1px solid #f1f5f9;">
        <div style="font-size:12px;line-height:1.6;color:#94a3b8;">
          ${footerBits.join(' &nbsp;·&nbsp; ') || esc(brand.wordmark)}
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text = renderPlainText(brand, content);
  return { html, text };
}

/** Plain-text alternative — same content, no markup. */
export function renderPlainText(brand: EmailBrand, content: EmailContent): string {
  const lines: string[] = [];
  if (content.headline) lines.push(content.headline, "");
  if (content.customHtml && content.customHtml.trim()) {
    const stripped = content.customHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (stripped) lines.push(stripped, "");
  }
  for (const p of content.paragraphs.filter((p) => p.trim())) lines.push(p, "");
  const highlights = (content.highlights ?? []).filter((h) => h.trim());
  if (highlights.length) {
    for (const h of highlights) lines.push(`- ${h}`);
    lines.push("");
  }
  if (content.ctaLabel && content.ctaUrl) lines.push(`${content.ctaLabel}: ${content.ctaUrl}`, "");
  if (content.signoff) lines.push(content.signoff);
  const footer = [brand.addressLine, brand.unsubscribeUrl ? `Unsubscribe: ${brand.unsubscribeUrl}` : null]
    .filter(Boolean)
    .join(" · ");
  if (footer) lines.push("", "—", footer);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
