import type { Pool, PoolClient } from "pg";

type Db = Pool | PoolClient;

/**
 * Quote-delivered detection. Reads the opportunity's own email conversation and
 * decides whether a quote / pricing proposal has actually gone out — from the
 * message text and from attachments (a priced document attached to an outbound
 * mail). Purely from stored comms, so it works with no external model; when
 * Anthropic creds are present the same signal can be refined, but the heuristic
 * is the dependable floor. Every hit carries the evidence line it matched on.
 */

export interface QuoteSignal {
  delivered: boolean;
  note: string | null; // the subject/snippet we matched on
  at: string | null; // ISO date the quote went out
}

const QUOTE_RX = "(quote|quotation|pricing|price list|proposal|estimate|sow|statement of work|order form|quotation attached)";

export async function quoteSignals(db: Db, opportunityIds: string[]): Promise<Map<string, QuoteSignal>> {
  const out = new Map<string, QuoteSignal>();
  if (opportunityIds.length === 0) return out;
  for (const id of opportunityIds) out.set(id, { delivered: false, note: null, at: null });

  const { rows } = await db.query<{
    opportunity_id: string;
    delivered: boolean;
    note: string | null;
    at: Date | null;
  }>(
    `select t.opportunity_id,
            bool_or(hit.is_quote) as delivered,
            (array_agg(hit.subject order by hit.sent_at desc nulls last) filter (where hit.is_quote))[1] as note,
            max(hit.sent_at) filter (where hit.is_quote) as at
     from communication_threads t
     join lateral (
       select m.subject, coalesce(m.sent_at, m.created_at) as sent_at,
              (
                coalesce(m.direction, 'outbound') <> 'inbound'
                and (
                  m.subject ~* '${QUOTE_RX}'
                  or m.text_body ~* '(${QUOTE_RX}).{0,40}(attached|enclosed|below|for your review)'
                  or (coalesce(m.attachment_count, 0) > 0 and (m.subject ~* '${QUOTE_RX}' or m.text_body ~* '${QUOTE_RX}'))
                )
              ) as is_quote
       from messages m where m.thread_id = t.id
     ) hit on true
     where t.opportunity_id = any($1)
     group by t.opportunity_id`,
    [opportunityIds],
  );
  for (const r of rows) {
    out.set(r.opportunity_id, {
      delivered: Boolean(r.delivered),
      note: r.note ? String(r.note).slice(0, 90) : null,
      at: r.at ? new Date(r.at).toISOString().slice(0, 10) : null,
    });
  }
  return out;
}
