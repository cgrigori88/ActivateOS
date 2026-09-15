import type { PoolClient, QueryResultRow } from "pg";

/**
 * The Queue's worklist reads — pending cadence steps of active motions, pending conversation
 * follow-ups, and the recently resolved list. Moved out of `app/queue/page.tsx` unchanged in shape
 * so they can be verified against a real schema, and TENANT-SCOPED EXPLICITLY (2026-09-14).
 *
 * WHY. The three reads named no org and leaned on RLS, which is inert on the owner-role app path
 * (task #67): every org's queue rows — and their bento counts, due buckets and "overdue" totals —
 * reached every caller. Each is now scoped through its canonical org-owned parent (the motion for
 * a cadence step, the thread for a follow-up), in SQL, before ordering and LIMIT.
 */
export async function loadQueueWorklist(
  db: PoolClient, orgId: string, companyIds: string[] | null,
): Promise<{ cadence: QueryResultRow[]; comms: QueryResultRow[]; recent: QueryResultRow[] }> {
  const scoped = companyIds != null;
  const ids = companyIds ?? [];
  const cadence = (
    await db.query(
      /* Wave 4 §3: `estimated_value_usd` joins the existing select so a queue row
         can state the commercial consequence of the work. The queue previously
         carried dates, a step number and a sentence — everything except what the
         item is worth, which is the one field that lets an operator choose
         between two rows. Additive read on a query that already joined the
         motion; no new table, no new predicate, no semantic change. */
      `select a.id, a.step, a.action, a.due_at,
          m.id as motion_id, m.estimated_value_usd, c.id as company_id, c.legal_name,
          pa.name as partner_name, s.name as seller_name
   from motion_actions a
   join revenue_motions m on m.id = a.motion_id
   join companies c on c.id = m.company_id
   left join partners pa on pa.id = m.partner_id
   left join sellers s on s.id = m.partner_seller_id
   where a.status = 'pending' and m.status = 'active' and m.org_id = $3
     and ($2::boolean is false or m.company_id = any($1))
   order by a.due_at, a.step`,
      [ids, scoped, orgId],
    )
  ).rows;
  const comms = (
    await db.query(
      `select ca.id, ca.title, ca.detail, ca.due_at, ca.confidence, ca.motion_id,
          t.company_id, c.legal_name, s.name as owner_name
   from communication_actions ca
   join communication_threads t on t.id = ca.thread_id
   join companies c on c.id = t.company_id
   left join sellers s on s.id = ca.owner_seller_id
   where ca.status = 'pending' and t.org_id = $3 and ca.org_id = $3
     and ($2::boolean is false or t.company_id = any($1))
   order by ca.due_at nulls last`,
      [ids, scoped, orgId],
    )
  ).rows;
  const recent = (
    await db.query(
      `select a.action, a.status, a.completed_at, c.legal_name
   from motion_actions a
   join revenue_motions m on m.id = a.motion_id
   join companies c on c.id = m.company_id
   where a.status in ('done','skipped') and m.org_id = $3
     and ($2::boolean is false or m.company_id = any($1))
   order by a.completed_at desc limit 8`,
      [ids, scoped, orgId],
    )
  ).rows;
  return { cadence, comms, recent };
}
