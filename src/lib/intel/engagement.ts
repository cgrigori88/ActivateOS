import type pg from "pg";

/**
 * Engagement → intelligence (Phase 9A/9D seam).
 *
 * Email engagement is not just campaign-copy training data. Opens, clicks,
 * replies and their timing are first-party behavioral signal about the buying
 * committee, and this module rolls them into engagement_scores — the feed that
 * downstream subsystems consume:
 *
 *   • Propensity     — engagement is the CUSTOMER_ENGAGEMENT feature family:
 *                      real interest expressed by the account, not inferred fit.
 *   • Compelling event — a burst of engagement (velocity spike) is itself a
 *                      buying signal worth surfacing on the account.
 *   • Forecasting    — engagement velocity and reply latency track deal heat.
 *   • Buyer behavior / influence — WHICH persona/level engages, and how deeply,
 *                      maps the real (vs assumed) decision unit.
 *
 * The rollup is deterministic and recomputed from email_events + messages, so
 * it can be rebuilt at any time and never drifts from the event log.
 */

const WEIGHTS = { open: 1, click: 3, reply: 8, positive: 12 } as const;

export interface ContactEngagement {
  contactId: string | null;
  email: string;
  touchesSent: number;
  opens: number;
  clicks: number;
  replies: number;
  positiveReplies: number;
  score: number;
  lastEngagedAt: Date | null;
}

/**
 * Recompute engagement for one company from its communication threads and
 * upsert engagement_scores (one row per contact + one company-level row with a
 * null contact). Returns the per-contact breakdown.
 */
export async function deriveEngagement(
  db: pg.PoolClient,
  args: { orgId: string | null; companyId: string },
): Promise<{ company: ContactEngagement; contacts: ContactEngagement[] }> {
  // Outbound touches (what we sent) per recipient.
  const { rows: sent } = await db.query<{ email: string; n: string }>(
    `select lower(recip) as email, count(*)::text as n
     from messages m
     join communication_threads t on t.id = m.thread_id
     cross join lateral unnest(m.to_emails) as recip
     where t.company_id = $1 and m.direction = 'outbound' and m.status = 'sent'
     group by lower(recip)`,
    [args.companyId],
  );

  // Engagement events keyed to the recipient of the message they belong to.
  const { rows: ev } = await db.query<{
    email: string;
    event_type: string;
    n: string;
    last_at: Date | null;
  }>(
    `select lower(recip) as email, e.event_type, count(*)::text as n, max(e.occurred_at) as last_at
     from email_events e
     join messages m on m.id = e.message_id
     join communication_threads t on t.id = m.thread_id
     cross join lateral unnest(m.to_emails) as recip
     where t.company_id = $1 and e.event_type in ('OPENED','CLICKED','REPLIED')
     group by lower(recip), e.event_type`,
    [args.companyId],
  );

  // Positive replies come from the conversation classifier (interaction_events).
  const { rows: pos } = await db.query<{ email: string; n: string }>(
    `select lower(coalesce(c.email, '')) as email, count(*)::text as n
     from interaction_events ie
     left join contacts c on c.id = ie.contact_id
     where ie.company_id = $1 and ie.type = 'POSITIVE_RESPONSE'
     group by lower(coalesce(c.email, ''))`,
    [args.companyId],
  );

  const byEmail = new Map<string, ContactEngagement>();
  const get = (email: string): ContactEngagement => {
    let c = byEmail.get(email);
    if (!c) {
      c = { contactId: null, email, touchesSent: 0, opens: 0, clicks: 0, replies: 0, positiveReplies: 0, score: 0, lastEngagedAt: null };
      byEmail.set(email, c);
    }
    return c;
  };
  for (const r of sent) get(r.email).touchesSent = Number(r.n);
  for (const r of ev) {
    const c = get(r.email);
    if (r.event_type === "OPENED") c.opens = Number(r.n);
    else if (r.event_type === "CLICKED") c.clicks = Number(r.n);
    else if (r.event_type === "REPLIED") c.replies = Number(r.n);
    if (r.last_at && (!c.lastEngagedAt || r.last_at > c.lastEngagedAt)) c.lastEngagedAt = r.last_at;
  }
  for (const r of pos) if (r.email) get(r.email).positiveReplies = Number(r.n);

  // Resolve contact ids by email (best effort).
  const emails = [...byEmail.keys()].filter(Boolean);
  if (emails.length > 0) {
    const { rows: cs } = await db.query<{ id: string; email: string }>(
      `select id, lower(email) as email from contacts where company_id = $1 and lower(email) = any($2)`,
      [args.companyId, emails],
    );
    for (const c of cs) {
      const e = byEmail.get(c.email);
      if (e) e.contactId = c.id;
    }
  }

  const contacts = [...byEmail.values()];
  for (const c of contacts) c.score = scoreContact(c);

  // Company-level rollup.
  const company: ContactEngagement = {
    contactId: null,
    email: "",
    touchesSent: sum(contacts, "touchesSent"),
    opens: sum(contacts, "opens"),
    clicks: sum(contacts, "clicks"),
    replies: sum(contacts, "replies"),
    positiveReplies: sum(contacts, "positiveReplies"),
    score: 0,
    lastEngagedAt: contacts.reduce<Date | null>((a, c) => (c.lastEngagedAt && (!a || c.lastEngagedAt > a) ? c.lastEngagedAt : a), null),
  };
  company.score = scoreContact(company);
  const velocity = engagementVelocity(company);

  // Upsert rows. Company row uses a fixed sentinel via unique (company_id, contact_id);
  // contact_id null is allowed by the unique index (nulls distinct) so we clear + rewrite.
  await db.query(`delete from engagement_scores where company_id = $1`, [args.companyId]);
  for (const c of contacts) {
    // Per-recipient row only when it resolves to a known contact — an
    // unresolved email would collide with the null-contact company rollup.
    if (!c.contactId) continue;
    await db.query(
      `insert into engagement_scores
        (org_id, company_id, contact_id, touches_sent, opens, clicks, replies, positive_replies, engagement_score, velocity, last_engaged_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [args.orgId, args.companyId, c.contactId, c.touchesSent, c.opens, c.clicks, c.replies, c.positiveReplies, c.score, engagementVelocity(c), c.lastEngagedAt],
    );
  }
  await db.query(
    `insert into engagement_scores
      (org_id, company_id, contact_id, touches_sent, opens, clicks, replies, positive_replies, engagement_score, velocity, last_engaged_at)
     values ($1,$2,null,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [args.orgId, args.companyId, company.touchesSent, company.opens, company.clicks, company.replies, company.positiveReplies, company.score, velocity, company.lastEngagedAt],
  );

  return { company, contacts };
}

/**
 * The learning loop (Phase 9D): turn account engagement into a first-party
 * momentum signal that the propensity scorer consumes, and flag engagement
 * surges as compelling events. Deterministic — no LLM, no invented facts.
 *
 * Gating matters: opens alone are weak (prefetch, bots) and never emit a
 * scoring signal; clicks and replies do. The signal is idempotent — one
 * current engagement signal per account, rewritten each time.
 */
export async function emitEngagementSignals(
  db: pg.PoolClient,
  args: { orgId: string | null; companyId: string },
): Promise<{ emitted: boolean; signalType: string | null; surge: boolean }> {
  const { company } = await deriveEngagement(db, args);

  // Always clear the prior engagement signal so this stays a single current one.
  await db.query(
    `delete from evidence where company_id = $1 and source_type = 'campaign_engagement'`,
    [args.companyId],
  );

  const meaningful = company.clicks + company.replies + company.positiveReplies;
  if (meaningful === 0) return { emitted: false, signalType: null, surge: false };

  const magnitude = Math.min(
    1,
    company.clicks * 0.15 + company.replies * 0.4 + company.positiveReplies * 0.6,
  );
  const signalType = company.replies + company.positiveReplies > 0 ? "CAMPAIGN_REPLY" : "CAMPAIGN_ENGAGEMENT";
  const observedAt = company.lastEngagedAt ?? new Date();
  const claim =
    `Buying committee engaged with outreach: ${company.opens} open(s), ${company.clicks} click(s), ` +
    `${company.replies} repl(y/ies)${company.positiveReplies ? `, ${company.positiveReplies} positive` : ""}`;

  const { rows: ev } = await db.query<{ id: string }>(
    `insert into evidence (org_id, company_id, source_type, claim, confidence, observed_at, status, computed_confidence)
     values ($1, $2, 'campaign_engagement', $3, 0.9, $4, 'verified', 0.9) returning id`,
    [args.orgId, args.companyId, claim, observedAt],
  );
  const evidenceId = ev[0].id;

  await db.query(
    `insert into signals (org_id, company_id, signal_type, direction, magnitude, confidence,
        observed_at, half_life_days, evidence_id)
     values ($1, $2, $3, 1, $4, 0.9, $5, $6, $7)`,
    [args.orgId, args.companyId, signalType, magnitude, observedAt, signalType === "CAMPAIGN_REPLY" ? 60 : 45, evidenceId],
  );

  // Compelling event: a positive reply, or multiple clicks, is a buying signal
  // worth surfacing. Deduped to one surge per account per rolling week.
  const surge = company.positiveReplies > 0 || company.replies > 0 || company.clicks >= 2;
  if (surge) {
    await db.query(
      `insert into interaction_events (org_id, company_id, actor, type, channel, payload)
       select $1, $2, 'customer', 'ENGAGEMENT_SURGE', 'EMAIL', $3
       where not exists (
         select 1 from interaction_events
         where company_id = $2 and type = 'ENGAGEMENT_SURGE' and occurred_at > now() - interval '7 days')`,
      [args.orgId, args.companyId, JSON.stringify({ clicks: company.clicks, replies: company.replies, positive: company.positiveReplies })],
    );
  }

  return { emitted: true, signalType, surge };
}

function scoreContact(c: ContactEngagement): number {
  const raw =
    c.opens * WEIGHTS.open +
    c.clicks * WEIGHTS.click +
    c.replies * WEIGHTS.reply +
    c.positiveReplies * WEIGHTS.positive;
  // Squash to 0..100 — saturating, so a highly engaged contact tops out.
  return Math.round(100 * (1 - Math.exp(-raw / 20)));
}

/** Engagement events per active week since first touch — a heat proxy. */
function engagementVelocity(c: ContactEngagement): number {
  const events = c.opens + c.clicks + c.replies;
  if (events === 0 || !c.lastEngagedAt) return 0;
  return Math.round((events / 1) * 100) / 100; // per-week refinement lands in 9D with send timestamps
}

function sum(rows: ContactEngagement[], key: keyof ContactEngagement): number {
  return rows.reduce((a, r) => a + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
}
