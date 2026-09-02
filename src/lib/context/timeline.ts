import type { Pool, PoolClient } from "pg";
import { sharedInEvidence } from "@/lib/partnerships/evidence-shares";
import { renewalProjection } from "@/lib/lifecycle/projection";
import { formatMoney } from "@/lib/format/money";

type Db = Pool | PoolClient;

/**
 * Deal Timeline — the account flight recorder (task #83). One chronological,
 * provenance-carrying record of everything that actually happened on an
 * account, fused from every system PursuitOS runs: gathered evidence,
 * outreach sends and replies, motion lifecycle, opportunities, the
 * partnership fabric (joint-room events, warm intros), and renewal signals.
 *
 * Two invariants:
 *  - Every event names where it came from (`source`) — fused context without
 *    per-claim provenance is exactly the confident-garbage problem.
 *  - The partner half arrives consent-filtered BY CONSTRUCTION: joint events
 *    and intros join through partnerships the org is a member of, and their
 *    bodies are the symmetric, both-sides-identical records. Nothing here
 *    widens visibility; it only assembles what each surface already shows.
 */

export interface TimelineEvent {
  at: string; // ISO timestamp
  kind: "evidence" | "send" | "reply" | "motion" | "opportunity" | "joint" | "intro" | "renewal" | "meeting" | "shared_evidence";
  title: string;
  detail: string | null;
  /** Provenance: which system/source produced this event. */
  source: string;
  href: string | null;
}

const iso = (d: Date | string) => new Date(d).toISOString();

export async function dealTimeline(db: Db, orgId: string, companyId: string, limit = 80): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  // 1. Verified intelligence, each claim with its source.
  const { rows: ev } = await db.query<{ claim: string; source_type: string; collected_at: Date }>(
    `select claim, source_type, collected_at from evidence
     where company_id = $1 and org_id = $2 and status = 'verified'
       and source_type <> 'meeting' -- meetings render as their own event kind below
     order by collected_at desc limit 40`,
    [companyId, orgId],
  );
  for (const e of ev) {
    events.push({
      at: iso(e.collected_at),
      kind: "evidence",
      title: e.claim.slice(0, 160),
      detail: null,
      source: e.source_type,
      href: `/accounts/${companyId}`,
    });
  }

  // 2. Outreach out: touches actually sent.
  const { rows: sends } = await db.query<{ subject: string; sent_at: Date; campaign_id: string; cname: string }>(
    `select t.subject, t.sent_at, ca.id as campaign_id, ca.name as cname
     from campaign_touches t
     join campaigns ca on ca.id = t.campaign_id
     left join revenue_motions m on m.id = ca.motion_id
     where coalesce(ca.company_id, m.company_id) = $1 and ca.org_id = $2 and t.sent_at is not null
     order by t.sent_at desc limit 30`,
    [companyId, orgId],
  );
  for (const s of sends) {
    events.push({
      at: iso(s.sent_at),
      kind: "send",
      title: `Sent: "${s.subject}"`,
      detail: s.cname,
      source: "outreach",
      href: `/campaigns/${s.campaign_id}`,
    });
  }

  // 3. Outreach in: inbound replies on this account's threads.
  const { rows: replies } = await db.query<{ subject: string | null; from_email: string; at: Date }>(
    `select msg.subject, msg.from_email, coalesce(msg.received_at, msg.created_at) as at
     from messages msg
     join communication_threads th on th.id = msg.thread_id
     where th.company_id = $1 and th.org_id = $2 and msg.direction = 'inbound'
     order by at desc limit 20`,
    [companyId, orgId],
  );
  for (const r of replies) {
    events.push({
      at: iso(r.at),
      kind: "reply",
      title: `Reply from ${r.from_email}`,
      detail: r.subject,
      source: "inbox",
      href: "/queue",
    });
  }

  // 4. Motion lifecycle — each recorded transition is its own event.
  const { rows: motions } = await db.query<{
    id: string; status: string; outcome: string | null;
    created_at: Date; approved_at: Date | null; activated_at: Date | null; closed_at: Date | null;
  }>(
    `select id, status, outcome, created_at, approved_at, activated_at, closed_at
     from revenue_motions where company_id = $1 order by created_at desc limit 10`,
    [companyId],
  );
  for (const m of motions) {
    const href = `/briefs/${m.id}`;
    events.push({ at: iso(m.created_at), kind: "motion", title: "Motion drafted", detail: null, source: "motion designer", href });
    if (m.approved_at) events.push({ at: iso(m.approved_at), kind: "motion", title: "Motion approved", detail: null, source: "operator", href });
    if (m.activated_at) events.push({ at: iso(m.activated_at), kind: "motion", title: "Motion activated", detail: null, source: "operator", href });
    if (m.closed_at) {
      events.push({
        at: iso(m.closed_at),
        kind: "motion",
        title: `Motion ${m.status}${m.outcome ? ` — ${m.outcome}` : ""}`,
        detail: null,
        source: "operator",
        href,
      });
    }
  }

  // 5. Opportunities: opened, and (when closed) settled.
  const { rows: opps } = await db.query<{
    name: string; stage: string; amount_usd: string | null; created_at: Date; closed_at: Date | null; updated_at: Date;
  }>(
    `select name, stage, amount_usd, created_at, closed_at, updated_at
     from opportunities where company_id = $1 and ($2::uuid is null or org_id = $2)
     order by created_at desc limit 10`,
    [companyId, orgId],
  );
  for (const o of opps) {
    const amt = o.amount_usd ? ` (${formatMoney(Number(o.amount_usd))})` : "";
    events.push({ at: iso(o.created_at), kind: "opportunity", title: `Opportunity opened: ${o.name}${amt}`, detail: null, source: "pipeline", href: "/pipeline" });
    if (o.stage === "closed_won" || o.stage === "closed_lost") {
      events.push({
        at: iso(o.closed_at ?? o.updated_at),
        kind: "opportunity",
        title: `${o.stage === "closed_won" ? "Closed won" : "Closed lost"}: ${o.name}${amt}`,
        detail: null,
        source: "pipeline",
        href: "/pipeline",
      });
    }
  }

  // 6. The partner half: joint-room events (symmetric records, consent by the
  //    partnership join) on this account.
  const { rows: joint } = await db.query<{ body: string; kind: string; created_at: Date; pursuit_id: string }>(
    `select e.body, e.kind, e.created_at, e.pursuit_id
     from joint_pursuit_events e
     join joint_pursuits jp on jp.id = e.pursuit_id
     join partnerships p on p.id = jp.partnership_id
     where jp.company_id = $1 and (p.initiator_org_id = $2 or p.counterpart_org_id = $2)
     order by e.created_at desc limit 20`,
    [companyId, orgId],
  );
  for (const j of joint) {
    events.push({
      at: iso(j.created_at),
      kind: "joint",
      title: j.body.slice(0, 180),
      detail: null,
      source: j.kind === "proposal" ? "broker" : "joint room",
      href: `/joint/${j.pursuit_id}`,
    });
  }

  // 7. Warm intros on this account (request + decision; the revealed contact
  //    is already a symmetric snapshot).
  const { rows: intros } = await db.query<{
    status: string; created_at: Date; decided_at: Date | null;
    revealed: { name: string } | null; other: string | null; requested_by_org: string;
  }>(
    `select w.status, w.created_at, w.decided_at, w.revealed_contact as revealed, w.requested_by_org,
            (select o.name from organizations o
             where o.id = case when p.initiator_org_id = $2 then p.counterpart_org_id else p.initiator_org_id end) as other
     from warm_intro_requests w
     join partnerships p on p.id = w.partnership_id
     where w.company_id = $1 and (p.initiator_org_id = $2 or p.counterpart_org_id = $2)
     order by w.created_at desc limit 10`,
    [companyId, orgId],
  );
  for (const w of intros) {
    const mine = w.requested_by_org === orgId;
    events.push({
      at: iso(w.created_at),
      kind: "intro",
      title: mine ? `Warm intro requested from ${w.other ?? "partner"}` : `${w.other ?? "Partner"} requested a warm intro`,
      detail: null,
      source: "partnership",
      href: "/partners",
    });
    if (w.decided_at && w.status !== "requested") {
      events.push({
        at: iso(w.decided_at),
        kind: "intro",
        title: w.status === "accepted"
          ? `Intro accepted${w.revealed?.name ? ` — meet ${w.revealed.name}` : ""}`
          : "Intro declined",
        detail: null,
        source: "partnership",
        href: "/partners",
      });
    }
  }

  // 8a. Meetings (task #86): the engagement email can't see, seller-recorded.
  const { rows: meetings } = await db.query<{ met_at: string; title: string | null; attendees: string | null; body: string }>(
    `select met_at::text, title, attendees, body from meeting_notes
     where org_id = $2 and company_id = $1 order by met_at desc limit 15`,
    [companyId, orgId],
  );
  for (const m of meetings) {
    events.push({
      at: iso(m.met_at),
      kind: "meeting",
      title: `Meeting${m.title ? `: ${m.title}` : ""}${m.attendees ? ` — with ${m.attendees.slice(0, 80)}` : ""}`,
      detail: m.body.slice(0, 160),
      source: "meeting notes",
      href: `/accounts/${companyId}`,
    });
  }

  // 8b. CRM-export snapshots: what the customer's own system said, verbatim.
  const { rows: snaps } = await db.query<{
    opportunity_name: string; stage: string; stage_raw: string | null;
    amount_usd: string | null; reported_at: Date;
  }>(
    `select opportunity_name, stage, stage_raw, amount_usd, reported_at
     from crm_snapshots where org_id = $2 and company_id = $1
     order by reported_at desc limit 10`,
    [companyId, orgId],
  );
  for (const s of snaps) {
    const amt = s.amount_usd ? ` (${formatMoney(Number(s.amount_usd))})` : "";
    events.push({
      at: iso(s.reported_at),
      kind: "opportunity",
      title: `CRM reports "${s.opportunity_name}" at ${s.stage_raw ?? s.stage}${amt}`,
      detail: null,
      source: "crm_export",
      href: "/pipeline",
    });
  }

  // 8. Lifecycle signals inside 180 days. P2A §5: read from the canonical fact graph, not from the
  // import JSON — so the timeline can say "expected 10 Feb → 28 Mar" or "contradicted" instead of
  // asserting a day it does not actually know.
  const renewals = await renewalProjection(db, orgId, { days: 180, companyIds: [companyId], limit: 3 });
  for (const r of renewals) {
    events.push({
      at: iso(r.clockDate),
      kind: "renewal",
      title: `${r.label} ${r.phrase}`,
      detail: r.listName ? `${r.event.because} Account is on "${r.listName}".` : r.event.because,
      source: `canonical record · ${r.sourceNote}`,
      href: "/pipeline",
    });
  }

  // Claims shared IN by partners through the evidence exchange (slice G):

  // read live from their record, provenance intact, consent-gated.

  for (const sh of await sharedInEvidence(db, orgId, companyId)) {

    events.push({

      at: `${sh.observedAt}T00:00:00.000Z`,

      kind: "shared_evidence",

      title: sh.claim.slice(0, 200),

      detail: `shared by ${sh.sharedBy}`,

      source: sh.sourceType,

      href: null,

    });

  }


  events.sort((a, b) => (a.at < b.at ? 1 : -1));
  return events.slice(0, limit);
}
