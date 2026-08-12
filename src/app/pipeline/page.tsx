import Link from "next/link";
import { getPool } from "@/db/client";
import {
  STAGE_PROBABILITY,
  STAGES,
  stakeholderGaps,
  weightedPipelineValue,
  type Stage,
} from "@/lib/opportunities/lifecycle";
import { Bento, Card, MiniBar, PageHeader, StatusBadge } from "@/components/ui";
import {
  advanceOpportunityAction,
  registerDealAction,
  setRegistrationStatusAction,
  setStakeholderAction,
} from "./actions";

export const dynamic = "force-dynamic";

const ROLES = ["economic_buyer", "technical_buyer", "champion", "influencer", "blocker", "end_user"];
const SENTIMENTS = ["unknown", "positive", "neutral", "negative"];

interface DealReg {
  id: string;
  opportunity_id: string | null;
  vendor: string | null;
  product: string | null;
  status: string;
  protected_until: string | null;
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const view = (await searchParams).view === "review" ? "review" : "board";
  const pool = getPool();
  const { rows: opps } = await pool.query(
    `select o.id, o.name, o.stage, o.amount_usd, o.next_step, o.expected_close_date,
            o.company_id, c.legal_name, n.slug, o.motion_id,
            pa.name as partner_name
     from opportunities o
     join companies c on c.id = o.company_id
     left join taxonomy_nodes n on n.id = o.taxonomy_node_id
     left join revenue_motions m on m.id = o.motion_id
     left join partners pa on pa.id = m.partner_id
     order by o.updated_at desc`,
  );

  const { rows: stakeholderRows } = await pool.query(
    `select s.opportunity_id, s.contact_id, s.role, s.sentiment, ct.name, ct.email
     from stakeholders s join contacts ct on ct.id = s.contact_id
     where s.opportunity_id = any($1)`,
    [opps.map((o) => o.id)],
  );
  const stakeholdersByOpp = new Map<string, typeof stakeholderRows>();
  for (const s of stakeholderRows) {
    const list = stakeholdersByOpp.get(s.opportunity_id) ?? [];
    list.push(s);
    stakeholdersByOpp.set(s.opportunity_id, list);
  }

  const { rows: regRows } = await pool.query<DealReg>(
    `select id, opportunity_id, vendor, product, status, protected_until
     from deal_registrations where opportunity_id = any($1)
     order by created_at desc`,
    [opps.map((o) => o.id)],
  );
  const regByOpp = new Map<string, DealReg>();
  for (const r of regRows) if (r.opportunity_id && !regByOpp.has(r.opportunity_id)) regByOpp.set(r.opportunity_id, r);

  const open = opps.filter((o) => !o.stage.startsWith("closed"));
  const weighted = weightedPipelineValue(
    opps.map((o) => ({ stage: o.stage as Stage, amountUsd: o.amount_usd ? Number(o.amount_usd) : null })),
  );
  const total = open.reduce((s, o) => s + Number(o.amount_usd ?? 0), 0);

  return (
    <main>
      <PageHeader
        title="Pipeline"
        subtitle="Opportunities advanced from motions. Weighted by declared stage probabilities until outcomes calibrate them."
      />

      {(() => {
        const wonCount = opps.filter((o) => o.stage === "closed_won").length;
        const wonUsd = opps.filter((o) => o.stage === "closed_won").reduce((s, o) => s + Number(o.amount_usd ?? 0), 0);
        const stageCounts = new Map<string, number>();
        for (const o of open) stageCounts.set(o.stage, (stageCounts.get(o.stage) ?? 0) + 1);
        const stageRows = STAGES.filter((s) => stageCounts.has(s)).map((s) => ({ label: s.replace(/_/g, " "), value: stageCounts.get(s) ?? 0 }));
        return (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Bento label="open opportunities" value={open.length} />
              <Bento label="total pipeline" value={`$${Math.round(total / 1000)}k`} />
              <Bento label="weighted" value={`$${Math.round(weighted / 1000)}k`} subs={["by stage probability"]} />
              <Bento label="won" value={wonCount} subs={[`$${Math.round(wonUsd / 1000)}k`]} />
              <Bento label="reg'd deals" value={regRows.length} />
            </div>
            {stageRows.length > 0 && (
              <Card className="mb-5">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Open opportunities by stage</h2>
                <MiniBar rows={stageRows} />
              </Card>
            )}
          </>
        );
      })()}

      <div className="mb-4 flex items-center gap-2">
        {(["board", "review"] as const).map((v) => (
          <Link
            key={v}
            href={`/pipeline?view=${v}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              view === v
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900"
            }`}
          >
            {v === "board" ? "Board" : "Review + deal reg"}
          </Link>
        ))}
      </div>

      {opps.length === 0 && (
        <p className="text-sm text-neutral-500">
          No opportunities yet — promote an active motion from its brief when a conversation
          earns a meeting.
        </p>
      )}

      {view === "review" && opps.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
          <table className="data-table">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Partner</th>
                <th>Stage</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Weighted</th>
                <th>Close</th>
                <th>Deal registration</th>
              </tr>
            </thead>
            <tbody>
              {opps.map((o) => {
                const reg = regByOpp.get(o.id);
                const closed = o.stage.startsWith("closed");
                const amt = o.amount_usd != null ? Number(o.amount_usd) : null;
                return (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/accounts/${o.company_id}`} className="font-medium hover:underline">{o.name}</Link>
                      <div className="text-[11px] text-neutral-400">{o.legal_name}</div>
                    </td>
                    <td className="text-xs text-neutral-500">{o.partner_name ?? "—"}</td>
                    <td className="text-xs uppercase tracking-wide text-neutral-500">{o.stage.replace(/_/g, " ")}</td>
                    <td className="tnum text-right">{amt != null ? `$${Math.round(amt / 1000)}k` : "—"}</td>
                    <td className="tnum text-right text-neutral-500">
                      {amt != null && !closed ? `$${Math.round((amt * STAGE_PROBABILITY[o.stage as Stage]) / 1000)}k` : "—"}
                    </td>
                    <td className="text-xs text-neutral-500">{o.expected_close_date ? new Date(o.expected_close_date).toISOString().slice(0, 10) : "—"}</td>
                    <td>
                      {reg ? (
                        <div className="flex items-center gap-2">
                          <StatusBadge status={reg.status === "approved" ? "approved" : reg.status === "rejected" ? "rejected" : reg.status === "submitted" ? "running" : "skipped"} />
                          <span className="text-[11px] text-neutral-400">
                            {reg.vendor ?? "vendor"}{reg.protected_until ? ` · until ${reg.protected_until}` : ""}
                          </span>
                          {reg.status === "submitted" && (
                            <span className="flex gap-1">
                              <form action={setRegistrationStatusAction.bind(null, reg.id, "approved")}>
                                <button className="text-[11px] font-medium text-green-700 hover:underline dark:text-green-400">approve</button>
                              </form>
                              <form action={setRegistrationStatusAction.bind(null, reg.id, "rejected")}>
                                <button className="text-[11px] font-medium text-red-700 hover:underline dark:text-red-400">reject</button>
                              </form>
                            </span>
                          )}
                        </div>
                      ) : closed ? (
                        <span className="text-xs text-neutral-400">—</span>
                      ) : (
                        <form action={registerDealAction.bind(null, o.id)} className="flex items-center gap-1">
                          <input name="vendor" placeholder="vendor" className="w-20 rounded border border-neutral-300 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-neutral-700" />
                          <input name="product" placeholder="product" className="w-24 rounded border border-neutral-300 bg-transparent px-1.5 py-0.5 text-[11px] dark:border-neutral-700" />
                          <button className="rounded bg-blue-700 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-blue-800">Register</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === "board" && (
      <div className="space-y-4">
        {opps.map((o) => {
          const stakeholders = stakeholdersByOpp.get(o.id) ?? [];
          const gaps = o.stage.startsWith("closed") ? [] : stakeholderGaps(stakeholders);
          const stageIdx = STAGES.indexOf(o.stage as (typeof STAGES)[number]);
          return (
            <Card key={o.id}>
              <div className="mb-1 flex items-baseline gap-3">
                <Link href={`/accounts/${o.company_id}`} className="font-semibold hover:underline">
                  {o.name}
                </Link>
                <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {o.stage.replace(/_/g, " ")}
                </span>
                {o.amount_usd != null && (
                  <span className="tnum text-sm text-neutral-500">
                    ${Math.round(Number(o.amount_usd) / 1000)}k
                    {!o.stage.startsWith("closed") &&
                      ` · $${Math.round((Number(o.amount_usd) * STAGE_PROBABILITY[o.stage as Stage]) / 1000)}k weighted`}
                  </span>
                )}
                {o.partner_name && (
                  <span className="text-xs text-neutral-400">via {o.partner_name}</span>
                )}
                {o.motion_id && (
                  <Link
                    href={`/briefs/${o.motion_id}`}
                    className="ml-auto text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
                  >
                    Brief →
                  </Link>
                )}
              </div>

              {!o.stage.startsWith("closed") && (
                <div className="mb-2 flex h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <div
                    className="bg-blue-600"
                    style={{ width: `${((stageIdx + 1) / STAGES.length) * 100}%` }}
                  />
                </div>
              )}

              {gaps.length > 0 && (
                <p className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                  Risk: {gaps.join(" · ")}
                </p>
              )}

              {stakeholders.length > 0 && (
                <div className="mb-2 space-y-1">
                  {stakeholders.map((s) => (
                    <form
                      key={s.contact_id}
                      action={setStakeholderAction.bind(null, o.id, s.contact_id)}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="font-medium">{s.name ?? s.email}</span>
                      <select
                        name="role"
                        defaultValue={s.role}
                        className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                      <select
                        name="sentiment"
                        defaultValue={s.sentiment}
                        className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                      >
                        {SENTIMENTS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="text-xs font-medium text-blue-700 hover:underline dark:text-blue-400"
                      >
                        Save
                      </button>
                    </form>
                  ))}
                </div>
              )}

              {!o.stage.startsWith("closed") && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {[...STAGES, "closed_won", "closed_lost"]
                    .filter((s) => {
                      const idx = STAGES.indexOf(s as (typeof STAGES)[number]);
                      if (s === "closed_won" || s === "closed_lost") return true;
                      return idx > stageIdx || idx === stageIdx - 1;
                    })
                    .map((s) => (
                      <form key={s} action={advanceOpportunityAction.bind(null, o.id, s as Stage)}>
                        <button
                          type="submit"
                          className={
                            s === "closed_won"
                              ? "rounded-md bg-green-700 px-3 py-1 text-xs font-medium text-white hover:bg-green-800"
                              : s === "closed_lost"
                                ? "rounded-md px-3 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50 dark:text-red-400 dark:ring-red-800 dark:hover:bg-red-950"
                                : "rounded-md px-3 py-1 text-xs font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900"
                          }
                        >
                          {s.replace(/_/g, " ")}
                        </button>
                      </form>
                    ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      )}
    </main>
  );
}
