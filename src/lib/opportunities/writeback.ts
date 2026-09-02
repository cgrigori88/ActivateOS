import type { Pool, PoolClient } from "pg";
import { formatMoney } from "@/lib/format/money";

/**
 * CRM writeback (slice A): the tie-out card detects drift; this repairs it —
 * behind a gate. Proposals are generated from the same reconciliation the
 * card shows, a human approves or dismisses, and the approved set exports as
 * a CSV the operator applies to the CRM today. A live push adapter plugs
 * into exactly this queue when CRM credentials exist; the gate stays.
 */

type Db = Pool | PoolClient;

export interface WritebackRow {
  id: string;
  companyId: string;
  accountName: string;
  opportunityName: string;
  field: string;
  crmValue: string | null;
  liveValue: string | null;
  rationale: string;
  status: string;
  createdAt: string;
}

/**
 * Draft correction proposals from the current CRM-vs-live reconciliation.
 * Per drifted account: an 'amount' proposal carrying the live total; for CRM
 * opportunities with no live counterpart, a 'presence' proposal asking
 * whether the CRM row should close. Idempotent — open proposals dedupe.
 */
export async function draftWritebacks(db: Db, orgId: string): Promise<number> {
  const { rows: crmRows } = await db.query<{
    company_id: string; legal_name: string; opportunity_name: string; amount_usd: string | null; stage: string;
  }>(
    `select s.company_id, c.legal_name, s.opportunity_name, s.amount_usd, s.stage
     from (select distinct on (company_id, lower(opportunity_name))
                  company_id, opportunity_name, amount_usd, stage
           from crm_snapshots where org_id = $1
           order by company_id, lower(opportunity_name), reported_at desc) s
     join companies c on c.id = s.company_id
     where s.stage not in ('closed_won', 'closed_lost')`,
    [orgId],
  );
  let created = 0;
  for (const r of crmRows) {
    const { rows: live } = await db.query<{ total: string | null; n: string }>(
      `select sum(amount_usd) as total, count(*) as n from opportunities
       where company_id = $1 and stage not in ('closed_won', 'closed_lost')`,
      [r.company_id],
    );
    const liveTotal = Number(live[0].total ?? 0);
    const liveN = Number(live[0].n);
    const crmAmt = r.amount_usd == null ? null : Number(r.amount_usd);

    if (liveN === 0) {
      const res = await db.query(
        `insert into crm_writebacks (org_id, company_id, opportunity_name, field, crm_value, live_value, rationale)
         values ($1, $2, $3, 'presence', $4, 'no open opportunity', $5)
         on conflict (org_id, lower(opportunity_name), field) where status in ('proposed','approved') do nothing`,
        [
          orgId, r.company_id, r.opportunity_name, crmAmt != null ? `$${crmAmt}` : r.stage,
          `CRM carries "${r.opportunity_name}" as open (${r.stage}), but the live record holds no open opportunity at ${r.legal_name} — close it in the CRM or open it here.`,
        ],
      );
      created += res.rowCount ?? 0;
    } else if (crmAmt != null && Math.abs(crmAmt - liveTotal) >= 1000) {
      const res = await db.query(
        `insert into crm_writebacks (org_id, company_id, opportunity_name, field, crm_value, live_value, rationale)
         values ($1, $2, $3, 'amount', $4, $5, $6)
         on conflict (org_id, lower(opportunity_name), field) where status in ('proposed','approved') do nothing`,
        [
          orgId, r.company_id, r.opportunity_name, `$${crmAmt}`, `$${liveTotal}`,
          `CRM says ${formatMoney(crmAmt)}; the live record holds ${formatMoney(liveTotal)} open at ${r.legal_name} (evidence-backed, ${liveN} open opportunit${liveN === 1 ? "y" : "ies"}). Correct the CRM amount to the live figure.`,
        ],
      );
      created += res.rowCount ?? 0;
    }
  }
  return created;
}

export async function listWritebacks(db: Db, orgId: string): Promise<WritebackRow[]> {
  const { rows } = await db.query<{
    id: string; company_id: string; legal_name: string; opportunity_name: string; field: string;
    crm_value: string | null; live_value: string | null; rationale: string; status: string; created_at: Date;
  }>(
    `select w.id, w.company_id, c.legal_name, w.opportunity_name, w.field,
            w.crm_value, w.live_value, w.rationale, w.status, w.created_at
     from crm_writebacks w join companies c on c.id = w.company_id
     where w.org_id = $1 and w.status in ('proposed', 'approved')
     order by w.created_at desc limit 30`,
    [orgId],
  );
  return rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    accountName: r.legal_name,
    opportunityName: r.opportunity_name,
    field: r.field,
    crmValue: r.crm_value,
    liveValue: r.live_value,
    rationale: r.rationale,
    status: r.status,
    createdAt: r.created_at.toISOString().slice(0, 10),
  }));
}

export async function decideWriteback(db: Db, orgId: string, id: string, status: "approved" | "dismissed"): Promise<void> {
  await db.query(
    `update crm_writebacks set status = $3, decided_at = now()
     where id = $1 and org_id = $2 and status in ('proposed', 'approved')`,
    [id, orgId, status],
  );
  await db.query(
    `insert into audit_log (org_id, actor, event, detail)
     select org_id, 'operator', 'writeback.' || $3, jsonb_build_object('opportunity', opportunity_name)
     from crm_writebacks where id = $1 and org_id = $2`,
    [id, orgId, status],
  );
}

/** Approved corrections as CSV; rows flip to 'exported' once handed over. */
export async function exportApprovedWritebacks(db: Db, orgId: string): Promise<string> {
  const { rows } = await db.query<{
    id: string; legal_name: string; opportunity_name: string; field: string;
    crm_value: string | null; live_value: string | null; rationale: string;
  }>(
    `select w.id, c.legal_name, w.opportunity_name, w.field, w.crm_value, w.live_value, w.rationale
     from crm_writebacks w join companies c on c.id = w.company_id
     where w.org_id = $1 and w.status = 'approved' order by w.created_at`,
    [orgId],
  );
  // Formula-injection guard: spreadsheet apps execute cells starting with
  // = + - @ — account names arrive from CSV imports, so prefix them inert.
  const esc = (v: string | null) => {
    let s = String(v ?? "");
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [
    "account,opportunity,field,crm_value,corrected_value,rationale",
    ...rows.map((r) =>
      [esc(r.legal_name), esc(r.opportunity_name), esc(r.field), esc(r.crm_value), esc(r.live_value), esc(r.rationale)].join(","),
    ),
  ];
  if (rows.length) {
    await db.query(`update crm_writebacks set status = 'exported' where id = any($1)`, [rows.map((r) => r.id)]);
  }
  return lines.join("\n");
}
