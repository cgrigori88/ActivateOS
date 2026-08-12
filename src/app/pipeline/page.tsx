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
import { QuerySelect } from "@/components/query-select";
import {
  ELEMENTS,
  STATUS_LABEL,
  STATUS_TONE,
  meddpiccFor,
  meddpiccScore,
  meddpiccGaps,
  type Status,
} from "@/lib/opportunities/meddpicc";
import { quoteSignals } from "@/lib/opportunities/quotes";
import {
  advanceOpportunityAction,
  registerDealAction,
  setRegistrationStatusAction,
  setStakeholderAction,
  setMeddpiccAction,
  assessMeddpiccAction,
} from "./actions";

const MEDDPICC_STATUSES: Status[] = ["unknown", "gap", "weak", "strong"];

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
  searchParams: Promise<{ view?: string; timeframe?: string; stage?: string; partner?: string; quote?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === "review" ? "review" : "board";
  const timeframe = ["7", "30", "90"].includes(sp.timeframe ?? "") ? Number(sp.timeframe) : null;
  const pool = getPool();
  const { rows: allOpps } = await pool.query(
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

  // Timeframe filter: opportunities whose expected close falls within N days.
  const horizon = timeframe ? Date.now() + timeframe * 86_400_000 : null;
  const opps = horizon
    ? allOpps.filter((o) => o.expected_close_date && new Date(o.expected_close_date).getTime() <= horizon)
    : allOpps;

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

  const meddpicc = await meddpiccFor(pool, opps.map((o) => o.id));
  const scoreOf = (id: string) => {
    const m = meddpicc.get(id);
    return m ? meddpiccScore(m) : 0;
  };

  // Quote-delivered signal, read from each opportunity's email conversation.
  const quotes = await quoteSignals(pool, opps.map((o) => o.id));
  const quoteOf = (id: string) => quotes.get(id) ?? { delivered: false, note: null, at: null };

  // Atomic filters (apply to both board and review; bentos/chart stay on the
  // full timeframe set so the totals don't move as you slice).
  const partnerOptions = [...new Set(allOpps.map((o) => o.partner_name).filter(Boolean) as string[])];
  const visible = opps.filter(
    (o) =>
      (!sp.stage || sp.stage === "all" || o.stage === sp.stage) &&
      (!sp.partner || sp.partner === "all" || (o.partner_name ?? "Direct") === sp.partner) &&
      (!sp.quote || sp.quote === "all" || (sp.quote === "yes" ? quoteOf(o.id).delivered : !quoteOf(o.id).delivered)),
  );

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
        // Show every open stage, including the empty ones, so the shape of the
        // funnel is always visible.
        const stageRows = STAGES.map((s) => ({ label: s.replace(/_/g, " "), value: stageCounts.get(s) ?? 0 }));
        const avgQual = open.length ? Math.round(open.reduce((s, o) => s + scoreOf(o.id), 0) / open.length) : null;
        // Learned signal: qualification strength of past wins vs losses.
        const avg = (list: typeof opps) => (list.length ? Math.round(list.reduce((s, o) => s + scoreOf(o.id), 0) / list.length) : null);
        const wonQual = avg(opps.filter((o) => o.stage === "closed_won"));
        const lostQual = avg(opps.filter((o) => o.stage === "closed_lost"));
        return (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Bento label="open opportunities" value={open.length} />
              <Bento label="total pipeline" value={`$${Math.round(total / 1000)}k`} />
              <Bento label="weighted" value={`$${Math.round(weighted / 1000)}k`} subs={["by stage probability"]} />
              <Bento label="avg qualification" value={avgQual == null ? "—" : `${avgQual}`} subs={["MEDDPICC health"]} />
              <Bento label="won" value={wonCount} subs={[`$${Math.round(wonUsd / 1000)}k`]} />
              <Bento label="reg'd deals" value={regRows.length} />
            </div>
            {(wonQual != null || lostQual != null) && (
              <Card className="mb-5">
                <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Learned signal · qualification vs outcome</h2>
                <p className="text-sm text-neutral-600 dark:text-neutral-300">
                  Closed-won deals qualified at <span className="font-semibold text-green-700 dark:text-green-400">{wonQual ?? "—"}</span> MEDDPICC health on average;
                  closed-lost at <span className="font-semibold text-red-700 dark:text-red-400">{lostQual ?? "—"}</span>.
                  {wonQual != null && lostQual != null && wonQual > lostQual && (
                    <> The <span className="font-medium">+{wonQual - lostQual}</span> gap is the pattern the model banks at each close — stronger qualification, higher conversion.</>
                  )}
                </p>
              </Card>
            )}
            {stageRows.length > 0 && (
              <Card className="mb-5">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Open opportunities by stage</h2>
                <MiniBar rows={stageRows} />
              </Card>
            )}
          </>
        );
      })()}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {(["board", "review"] as const).map((v) => {
          const qs = new URLSearchParams();
          qs.set("view", v);
          for (const k of ["timeframe", "stage", "partner", "quote"] as const) if (sp[k]) qs.set(k, sp[k]!);
          return (
            <Link
              key={v}
              href={`/pipeline?${qs.toString()}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                view === v
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900"
              }`}
            >
              {v === "board" ? "Board" : "Review + deal reg"}
            </Link>
          );
        })}
        <QuerySelect param="stage" value={sp.stage ?? "all"} label="Stage" options={[{ value: "all", label: "Any stage" }, ...STAGES.map((s) => ({ value: s, label: s.replace(/_/g, " ") })), { value: "closed_won", label: "closed won" }, { value: "closed_lost", label: "closed lost" }]} />
        {partnerOptions.length > 0 && (
          <QuerySelect param="partner" value={sp.partner ?? "all"} label="Partner" options={[{ value: "all", label: "Any partner" }, { value: "Direct", label: "Direct" }, ...partnerOptions.map((p) => ({ value: p, label: p }))]} />
        )}
        <QuerySelect param="quote" value={sp.quote ?? "all"} label="Quote" options={[{ value: "all", label: "Any" }, { value: "yes", label: "Quote sent" }, { value: "no", label: "No quote" }]} />
        <QuerySelect param="timeframe" value={sp.timeframe ?? "all"} label="Closing within" options={[{ value: "all", label: "Any time" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />
        <span className="ml-auto text-xs text-neutral-500">{visible.length} of {opps.length}</span>
      </div>

      {opps.length === 0 && (
        <p className="text-sm text-neutral-500">
          No opportunities yet — promote an active motion from its brief when a conversation
          earns a meeting.
        </p>
      )}
      {opps.length > 0 && visible.length === 0 && (
        <p className="text-sm text-neutral-500">No opportunities match these filters — clear one above.</p>
      )}

      {view === "review" && visible.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 scroll-thin dark:border-neutral-800">
          <table className="data-table">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Partner</th>
                <th>Stage</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Weighted</th>
                <th className="text-right">MEDDPICC</th>
                <th>Quote</th>
                <th>Close</th>
                <th>Deal registration</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => {
                const reg = regByOpp.get(o.id);
                const closed = o.stage.startsWith("closed");
                const amt = o.amount_usd != null ? Number(o.amount_usd) : null;
                const quote = quoteOf(o.id);
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
                    <td className="tnum text-right">
                      {(() => {
                        const s = scoreOf(o.id);
                        const tone = s >= 70 ? "text-green-700 dark:text-green-400" : s >= 40 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";
                        return <span className={tone}>{s}</span>;
                      })()}
                    </td>
                    <td className="text-xs">
                      {quote.delivered ? (
                        <span className="text-green-700 dark:text-green-400" title={quote.note ?? undefined}>✓ sent{quote.at ? ` ${quote.at}` : ""}</span>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
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

      {view === "board" && visible.length > 0 && (
      <div className="space-y-4">
        {visible.map((o) => {
          const stakeholders = stakeholdersByOpp.get(o.id) ?? [];
          const gaps = o.stage.startsWith("closed") ? [] : stakeholderGaps(stakeholders);
          const stageIdx = STAGES.indexOf(o.stage as (typeof STAGES)[number]);
          const won = o.stage === "closed_won";
          const lost = o.stage === "closed_lost";
          const quote = quoteOf(o.id);
          return (
            <Card key={o.id}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link href={`/accounts/${o.company_id}`} className="font-semibold hover:underline">
                  {o.name}
                </Link>
                <span className={`text-xs font-medium uppercase tracking-wide ${won ? "text-green-700 dark:text-green-400" : lost ? "text-red-700 dark:text-red-400" : "text-neutral-500"}`}>
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
                {o.expected_close_date && (
                  <span className="text-xs text-neutral-400">· close {new Date(o.expected_close_date).toISOString().slice(0, 10)}</span>
                )}
                {quote.delivered ? (
                  <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-950 dark:text-green-300" title={quote.note ?? "detected in email conversation"}>
                    quote sent{quote.at ? ` · ${quote.at}` : ""}
                  </span>
                ) : (
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800" title="no priced document detected in the conversation yet">no quote</span>
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

              {/* Stage timeline — shown for every opportunity, won or lost or open. */}
              <div className="mb-2 flex gap-1">
                {STAGES.map((s, idx) => {
                  const on = won ? true : lost ? false : idx <= stageIdx;
                  const isCurrent = !o.stage.startsWith("closed") && idx === stageIdx;
                  const tone = won ? "bg-green-500" : on ? (isCurrent ? "bg-blue-600" : "bg-blue-400") : "bg-neutral-200 dark:bg-neutral-700";
                  return (
                    <div key={s} className="flex-1" title={s.replace(/_/g, " ")}>
                      <div className={`h-1.5 rounded-full ${tone}`} />
                      <div className={`mt-0.5 hidden text-[9px] uppercase tracking-wide sm:block ${isCurrent ? "font-semibold text-blue-700 dark:text-blue-400" : "text-neutral-400"}`}>{s.replace(/_/g, " ")}</div>
                    </div>
                  );
                })}
              </div>
              {lost && <p className="mb-2 text-[11px] font-medium text-red-700 dark:text-red-400">Closed lost — stages shown for the record.</p>}

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

              {/* MEDDPICC qualification */}
              {(() => {
                const m = meddpicc.get(o.id)!;
                const score = meddpiccScore(m);
                const gaps = meddpiccGaps(m);
                const scoreTone = score >= 70 ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" : score >= 40 ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
                return (
                  <details className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
                    <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100">
                      <span className="uppercase tracking-wide">MEDDPICC</span>
                      <span className={`tnum rounded px-1.5 py-0.5 text-[10px] font-semibold ${scoreTone}`}>{score}</span>
                      <span className="text-[11px] font-normal text-neutral-400">
                        {gaps.length === 0 ? "fully qualified" : `${gaps.length} to firm up`}
                      </span>
                    </summary>
                    <div className="mt-2">
                      <form action={assessMeddpiccAction.bind(null, o.id)} className="mb-2 flex items-center gap-2">
                        <button className="rounded-md px-2.5 py-1 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-300 hover:bg-blue-50 dark:text-blue-400 dark:ring-blue-800 dark:hover:bg-blue-950">
                          AI assess from evidence
                        </button>
                        <span className="text-[10px] text-neutral-400">drafts every element you haven&rsquo;t set from stakeholders &amp; verified signals — your call to keep</span>
                      </form>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {ELEMENTS.map((e) => {
                          const st = m[e.key];
                          return (
                            <form key={e.key} action={setMeddpiccAction.bind(null, o.id, e.key)} className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 dark:border-neutral-800" title={e.hint}>
                              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-neutral-100 text-[10px] font-bold text-neutral-500 dark:bg-neutral-800">{e.letter}</span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1">
                                  <span className="truncate text-[11px] font-medium">{e.label}</span>
                                  {st.source === "ai_assist" && <span className="rounded bg-blue-100 px-1 text-[8px] font-bold uppercase text-blue-700 dark:bg-blue-900 dark:text-blue-300" title="AI-drafted, unconfirmed">AI</span>}
                                </div>
                                <input name="notes" defaultValue={st.notes ?? ""} placeholder="notes" className="mt-0.5 w-full rounded border border-transparent bg-transparent text-[11px] text-neutral-500 hover:border-neutral-200 focus:border-neutral-300 focus:outline-none dark:hover:border-neutral-700" />
                              </div>
                              <select name="status" defaultValue={st.status} className={`rounded px-1 py-0.5 text-[10px] font-medium ${STATUS_TONE[st.status]}`}>
                                {MEDDPICC_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                              </select>
                              <button className="text-[10px] font-medium text-blue-700 hover:underline dark:text-blue-400">save</button>
                            </form>
                          );
                        })}
                      </div>
                    </div>
                  </details>
                );
              })()}

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
