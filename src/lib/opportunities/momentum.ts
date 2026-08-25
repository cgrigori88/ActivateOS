import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/**
 * Deal momentum (task #88): signal-based stage assessment, PursuitOS-style.
 *
 * Where "AI-native" pipelines let the model move the stage, we keep the
 * human-declared stage as truth and put the OBSERVED behavior next to it —
 * deterministic, receipts attached, and cross-company aware: activity in a
 * joint room with a partner counts as momentum, because on a co-sell deal
 * it is.
 *
 * Verdicts (14-day observation window unless noted):
 *  - advancing: ≥2 engagement events, or a meeting + a reply
 *  - steady:    exactly 1 engagement event
 *  - stalling:  outreach without response, or simply quiet
 *  - at_risk:   quote out 14d+ unanswered · late stage silent 21d+ ·
 *               record untouched 30d+ with nothing observed
 */

export type MomentumVerdict = "advancing" | "steady" | "stalling" | "at_risk";

export interface MomentumInput {
  id: string;
  companyId: string;
  stage: string;
  updatedAt: string | Date;
  quote?: { delivered: boolean; at: string | null };
}

export interface Momentum {
  verdict: MomentumVerdict;
  reasons: string[];
  jointActive: boolean;
}

const WINDOW_DAYS = 14;

export async function dealMomentum(db: Db, orgId: string, opps: MomentumInput[]): Promise<Map<string, Momentum>> {
  const out = new Map<string, Momentum>();
  const open = opps.filter((o) => !o.stage.startsWith("closed"));
  if (open.length === 0) return out;
  const companyIds = [...new Set(open.map((o) => o.companyId))];

  const [meetings, replies, sends, joint, engaged] = await Promise.all([
    db.query<{ company_id: string; n: string; last: string }>(
      `select company_id, count(*) as n, max(met_at)::text as last from meeting_notes
       where org_id = $1 and company_id = any($2) and met_at > (now() - interval '${WINDOW_DAYS} days')::date
       group by company_id`,
      [orgId, companyIds],
    ),
    db.query<{ company_id: string; n: string }>(
      `select coalesce(ca.company_id, m.company_id) as company_id, count(distinct e.id) as n
       from campaign_touches t
       join campaigns ca on ca.id = t.campaign_id
       left join revenue_motions m on m.id = ca.motion_id
       join email_events e on e.message_id = t.message_id and e.event_type = 'REPLIED'
         and e.occurred_at > now() - interval '${WINDOW_DAYS} days'
       where coalesce(ca.company_id, m.company_id) = any($1)
       group by 1`,
      [companyIds],
    ),
    db.query<{ company_id: string; n: string }>(
      `select coalesce(ca.company_id, m.company_id) as company_id, count(distinct t.id) as n
       from campaign_touches t
       join campaigns ca on ca.id = t.campaign_id
       left join revenue_motions m on m.id = ca.motion_id
       where coalesce(ca.company_id, m.company_id) = any($1)
         and t.status = 'sent' and t.sent_at > now() - interval '${WINDOW_DAYS} days'
       group by 1`,
      [companyIds],
    ),
    db.query<{ company_id: string; n: string }>(
      `select jp.company_id, count(*) as n
       from joint_pursuit_events e
       join joint_pursuits jp on jp.id = e.pursuit_id
       join partnerships p on p.id = jp.partnership_id
       where jp.company_id = any($1)
         and (p.initiator_org_id = $2 or p.counterpart_org_id = $2)
         and e.created_at > now() - interval '${WINDOW_DAYS} days'
       group by jp.company_id`,
      [companyIds, orgId],
    ),
    db.query<{ company_id: string; last: Date | null }>(
      `select company_id, max(last_engaged_at) as last from engagement_scores
       where company_id = any($1) group by company_id`,
      [companyIds],
    ),
  ]);

  const by = <T extends { company_id: string }>(rows: T[]) => new Map(rows.map((r) => [r.company_id, r]));
  const meetBy = by(meetings.rows);
  const replyBy = by(replies.rows);
  const sendBy = by(sends.rows);
  const jointBy = by(joint.rows);
  const engagedBy = by(engaged.rows);

  const daysSince = (d: string | Date | null | undefined): number | null =>
    d == null ? null : Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);

  for (const o of open) {
    const nMeet = Number(meetBy.get(o.companyId)?.n ?? 0);
    const nReply = Number(replyBy.get(o.companyId)?.n ?? 0);
    const nSend = Number(sendBy.get(o.companyId)?.n ?? 0);
    const nJoint = Number(jointBy.get(o.companyId)?.n ?? 0);
    const recent = nMeet + nReply + nJoint;
    const engagedDays = daysSince(engagedBy.get(o.companyId)?.last ?? null);
    const untouchedDays = daysSince(o.updatedAt) ?? 0;
    const quoteDays = o.quote?.delivered ? daysSince(o.quote.at) : null;

    const reasons: string[] = [];
    if (nMeet > 0) reasons.push(`${nMeet} meeting${nMeet === 1 ? "" : "s"} in ${WINDOW_DAYS}d`);
    if (nReply > 0) reasons.push(`${nReply} repl${nReply === 1 ? "y" : "ies"} in ${WINDOW_DAYS}d`);
    if (nJoint > 0) reasons.push(`joint room active (${nJoint} event${nJoint === 1 ? "" : "s"})`);

    let verdict: MomentumVerdict;
    if (o.quote?.delivered && quoteDays != null && quoteDays > 14 && nReply === 0) {
      verdict = "at_risk";
      reasons.push(`quote out ${quoteDays}d, no reply`);
    } else if (
      (o.stage === "proposal" || o.stage === "negotiation") &&
      recent === 0 &&
      (engagedDays == null || engagedDays > 21)
    ) {
      verdict = "at_risk";
      reasons.push(`late stage, silent ${engagedDays == null ? "21+" : engagedDays}d`);
    } else if (recent === 0 && untouchedDays > 30) {
      verdict = "at_risk";
      reasons.push(`untouched ${untouchedDays}d`);
    } else if (recent >= 2 || (nMeet >= 1 && nReply >= 1)) {
      verdict = "advancing";
    } else if (recent === 1) {
      verdict = "steady";
    } else if (nSend > 0) {
      verdict = "stalling";
      reasons.push(`${nSend} touch${nSend === 1 ? "" : "es"} out, no response yet`);
    } else {
      verdict = "stalling";
      reasons.push(`no activity in ${WINDOW_DAYS}d`);
    }

    out.set(o.id, { verdict, reasons, jointActive: nJoint > 0 });
  }
  return out;
}

export const MOMENTUM_LABEL: Record<MomentumVerdict, string> = {
  advancing: "advancing",
  steady: "steady",
  stalling: "stalling",
  at_risk: "at risk",
};
