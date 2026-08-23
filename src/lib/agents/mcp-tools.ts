import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { loadStageWeights } from "../opportunities/stage-weights";
import { weightedPipelineValue, type Stage } from "../opportunities/lifecycle";
import { listJointPursuits, pursuitEvents } from "../partnerships/joint";
import { overlapLadder } from "../partnerships/overlap";
import { listPartnerships } from "../partnerships/partnerships";
import { upsertTouch } from "../comms/authoring";
import { dealTimeline } from "../context/timeline";
import { accountDivergences } from "../context/divergence";
import { listSkills, sharedInSkills } from "../skills/skills";

/**
 * BYO-bot tool surface (task #76). The tools a personal agent may call
 * against ONE tenant, resolved from its API key. Design rules:
 *
 *  - reads mirror what the tenant's own screens show — nothing extra;
 *  - the ONLY write produces a DRAFT campaign touch behind the existing
 *    approval gates (nothing an agent does here can send or share);
 *  - cross-tenant data appears only where the fabric already consented it
 *    (overlap results, joint rooms) — the same boundaries as the UI.
 */

// ── Keys ────────────────────────────────────────────────────────────────────

export function mintKey(): { plaintext: string; hash: string } {
  const plaintext = `pos_${randomBytes(24).toString("hex")}`;
  return { plaintext, hash: createHash("sha256").update(plaintext).digest("hex") };
}

export async function resolveKey(pool: Pool, bearer: string | null): Promise<{ orgId: string; keyId: string } | null> {
  if (!bearer || !bearer.startsWith("pos_")) return null;
  const hash = createHash("sha256").update(bearer).digest("hex");
  const { rows } = await pool.query<{ id: string; org_id: string }>(
    `select id, org_id from api_keys where key_hash = $1 and revoked_at is null`,
    [hash],
  );
  if (!rows[0]) return null;
  await pool.query(`update api_keys set last_used_at = now() where id = $1`, [rows[0].id]);
  return { orgId: rows[0].org_id, keyId: rows[0].id };
}

// ── Tools ───────────────────────────────────────────────────────────────────

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(pool: Pool, orgId: string, args: Record<string, unknown>): Promise<unknown>;
}

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "pipeline_summary",
    description:
      "Open pipeline for this tenant: opportunities with stage, amount, and weighted value using the org's editable stage weights (per-partner overrides applied). Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run(pool, orgId) {
      const { rows } = await pool.query<{
        name: string; stage: string; amount_usd: string | null; partner_name: string | null; partner_id: string | null;
      }>(
        `select o.name, o.stage, o.amount_usd, pa.name as partner_name, m.partner_id
         from opportunities o
         left join revenue_motions m on m.id = o.motion_id
         left join partners pa on pa.id = m.partner_id
         order by o.updated_at desc`,
      );
      const weights = await loadStageWeights(pool, orgId);
      const open = rows.filter((r) => !r.stage.startsWith("closed"));
      const weighted = weightedPipelineValue(
        open.map((r) => ({
          stage: r.stage as Stage,
          amountUsd: r.amount_usd ? Number(r.amount_usd) : null,
          probability: weights.weightFor(r.partner_id, r.stage as Stage),
        })),
      );
      return {
        openCount: open.length,
        totalUsd: open.reduce((s, r) => s + Number(r.amount_usd ?? 0), 0),
        weightedUsd: weighted,
        wonCount: rows.filter((r) => r.stage === "closed_won").length,
        opportunities: open.map((r) => ({
          name: r.name,
          stage: r.stage,
          amountUsd: r.amount_usd ? Number(r.amount_usd) : null,
          partner: r.partner_name,
        })),
      };
    },
  },
  {
    name: "account_brief",
    description:
      "Brief for one account by name: propensity score, open opportunities, latest weekly digest items, and recent verified evidence. Read-only.",
    inputSchema: {
      type: "object",
      properties: { account: { type: "string", description: "Account (company) name, fuzzy matched" } },
      required: ["account"],
      additionalProperties: false,
    },
    async run(pool, orgId, args) {
      const q = String(args.account ?? "").trim();
      if (!q) throw new Error("account is required");
      const { rows: companies } = await pool.query<{ id: string; legal_name: string; industry: string | null }>(
        `select id, legal_name, industry from companies where legal_name ilike $1 order by legal_name limit 1`,
        [`%${q}%`],
      );
      const c = companies[0];
      if (!c) return { found: false, message: `No account matching "${q}".` };
      const [{ rows: scores }, { rows: opps }, { rows: digests }, { rows: evidence }] = [
        await pool.query(
          `select p.score, p.band from propensity_scores p where p.company_id = $1 order by p.computed_at desc limit 1`,
          [c.id],
        ),
        await pool.query(
          `select name, stage, amount_usd from opportunities where company_id = $1 and stage not in ('closed_won','closed_lost')`,
          [c.id],
        ),
        await pool.query(
          `select items, period_end from account_digests where company_id = $1 and org_id = $2 order by created_at desc limit 1`,
          [c.id, orgId],
        ),
        await pool.query(
          `select claim, source_type, observed_at from evidence
           where company_id = $1 and status = 'verified' order by observed_at desc limit 5`,
          [c.id],
        ),
      ];
      return {
        found: true,
        account: c.legal_name,
        industry: c.industry,
        propensity: scores[0] ? { score: Number(scores[0].score), band: scores[0].band } : null,
        openOpportunities: opps.map((o) => ({ name: o.name, stage: o.stage, amountUsd: o.amount_usd ? Number(o.amount_usd) : null })),
        latestDigest: digests[0] ?? null,
        recentEvidence: evidence.map((e) => ({ claim: e.claim, source: e.source_type, at: new Date(e.observed_at).toISOString().slice(0, 10) })),
      };
    },
  },
  {
    name: "overlap_status",
    description:
      "Partnerships and their blind-overlap ladder state (counts/bands/named rungs, approved results). Shows exactly what this tenant's Admin screen shows. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run(pool, orgId) {
      const partnerships = (await listPartnerships(pool, orgId)).filter((p) => p.status === "active");
      const out = [];
      for (const p of partnerships) {
        const ladder = await overlapLadder(pool, orgId, p.id);
        out.push({ partner: p.otherOrgName ?? p.myLensName, rungs: ladder.rungs });
      }
      return { partnerships: out };
    },
  },
  {
    name: "joint_pursuits",
    description:
      "Joint pursuit rooms this tenant shares with partners, with each room's full symmetric ledger (both sides read the identical record). Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run(pool, orgId) {
      const pursuits = await listJointPursuits(pool, orgId);
      const out = [];
      for (const p of pursuits) {
        const events = p.status === "active" || p.status === "closed" ? await pursuitEvents(pool, orgId, p.id) : [];
        out.push({
          account: p.accountName,
          partner: p.otherOrgName,
          status: p.status,
          awaitingYou: p.awaitingYou,
          ledger: events.map((e) => ({ side: e.side, kind: e.kind, body: e.body, at: e.createdAt })),
        });
      }
      return { pursuits: out };
    },
  },
  {
    name: "draft_touch",
    description:
      "THE ONLY WRITE TOOL, and it only drafts: add a DRAFT email touch to an existing campaign (matched by name). Nothing is sent — the draft lands behind the same human approval gate as every touch. Returns the created draft.",
    inputSchema: {
      type: "object",
      properties: {
        campaign: { type: "string", description: "Campaign name, fuzzy matched" },
        name: { type: "string", description: "Touch name, e.g. 'Follow-up on pilot'" },
        subject: { type: "string" },
        body: { type: "string", description: "Plain-text email body" },
      },
      required: ["campaign", "subject", "body"],
      additionalProperties: false,
    },
    async run(pool, orgId, args) {
      const q = String(args.campaign ?? "").trim();
      const { rows } = await pool.query<{ id: string; name: string }>(
        `select id, name from campaigns where name ilike $1 order by created_at desc limit 1`,
        [`%${q}%`],
      );
      if (!rows[0]) return { created: false, message: `No campaign matching "${q}".` };
      const db = await pool.connect();
      try {
        await upsertTouch(db, {
          campaignId: rows[0].id,
          fields: {
            name: String(args.name ?? "Agent draft"),
            subject: String(args.subject),
            body: String(args.body),
            preheader: "",
            headline: "",
            highlights: [],
            ctaLabel: "",
            ctaUrl: "",
            sendOffsetDays: 0,
            accountAngle: "",
            customHtml: "",
            ccEmails: [],
          },
        });
      } finally {
        db.release();
      }
      return {
        created: true,
        campaign: rows[0].name,
        status: "draft",
        note: "Draft only — a human approves it in the campaign room before anything can send.",
      };
    },
  },
  {
    name: "deal_context",
    description:
      "The full fused context of one account as a chronological timeline: gathered evidence (with source provenance), outreach sends and replies, motion lifecycle, opportunities, joint-room events and warm intros from the partnership fabric (consent-filtered — only what both sides already approved), and renewal signals. Includes reality-divergence findings where systems disagree. This is the whole deal, both companies' consented halves. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", description: "Account (company) name, fuzzy matched" },
        limit: { type: "number", description: "Max timeline events (default 40, max 80)" },
      },
      required: ["account"],
      additionalProperties: false,
    },
    async run(pool, orgId, args) {
      const q = String(args.account ?? "").trim();
      if (!q) throw new Error("account is required");
      const limit = Math.min(Math.max(Number(args.limit) || 40, 1), 80);
      const { rows: companies } = await pool.query<{ id: string; legal_name: string }>(
        `select id, legal_name from companies where legal_name ilike $1 order by legal_name limit 1`,
        [`%${q}%`],
      );
      const c = companies[0];
      if (!c) return { found: false, message: `No account matching "${q}".` };
      const [timeline, allDivergences] = await Promise.all([
        dealTimeline(pool, orgId, c.id, limit),
        accountDivergences(pool, orgId),
      ]);
      return {
        found: true,
        account: c.legal_name,
        timeline: timeline.map(({ href: _href, ...rest }) => rest),
        divergences: allDivergences
          .filter((d) => d.companyId === c.id)
          .map((d) => ({ kind: d.kind, finding: d.text })),
        note: "Every event names its source. Partner-side events are the symmetric records both tenants read identically — nothing here exceeds what the partnership already consented to.",
      };
    },
  },
  {
    name: "org_skills",
    description:
      "The organization's skills library: curated, typed instructions (positioning / process / style / rules) that PursuitOS's own agents follow when drafting motions and campaigns — plus skills partner organizations have shared through the consent fabric. Use these to ground your own drafting the same way the platform's agents are grounded. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["positioning", "process", "style", "rules"],
          description: "Optional filter to one kind",
        },
      },
      additionalProperties: false,
    },
    async run(pool, orgId, args) {
      const kind = args.kind ? String(args.kind) : null;
      const own = (await listSkills(pool, orgId)).filter(
        (s) => s.status === "active" && (!kind || s.kind === kind),
      );
      const shared = (await sharedInSkills(pool, orgId)).filter((s) => !kind || s.kind === kind);
      return {
        skills: own.map((s) => ({
          name: s.name,
          kind: s.kind,
          appliesTo: s.scopeLabel,
          instructions: s.body,
          groundedRuns: s.uses,
        })),
        sharedByPartners: shared.map((s) => ({
          name: s.name,
          kind: s.kind,
          from: s.fromOrgName,
          appliesTo: s.partnerName ? `Deals with ${s.partnerName}` : "Shared context",
          instructions: s.body,
        })),
        note: "Same library the platform's agents read. Partner-shared skills were explicitly accepted by this organization and are read live from the sharing tenant — treat them as that partner's guidance for joint deals.",
      };
    },
  },
];
