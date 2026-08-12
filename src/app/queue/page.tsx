import Link from "next/link";
import { getPool } from "@/db/client";
import { Bento, Card, PageHeader } from "@/components/ui";
import { QuerySelect } from "@/components/query-select";
import { resolveActionAction, resolveCommActionAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The action queue (#53 restructure): one prioritized worklist that merges the
 * dated cadence steps of active motions with the follow-ups conversations
 * surfaced. Bentos frame the load (overdue / today / this week), deep filters
 * (window · source) narrow it, and a group-by lens (due bucket / account /
 * partner) organizes it. Overdue always floats up. Quick-actions resolve in place.
 */

interface Item {
  id: string;
  kind: "cadence" | "conversation";
  dueAt: Date | null;
  title: string;
  detail: string | null;
  motionId: string | null;
  companyId: string | null;
  legalName: string;
  partnerName: string | null;
  owner: string | null;
  meta: string | null;
}

const DAY = 86_400_000;
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; source?: string; group?: string; partner?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const groupKey = ["due", "account", "partner"].includes(sp.group ?? "") ? sp.group! : "due";
  const pool = getPool();

  const { rows: cadence } = await pool.query(
    `select a.id, a.step, a.action, a.due_at,
            m.id as motion_id, c.id as company_id, c.legal_name,
            pa.name as partner_name, s.name as seller_name
     from motion_actions a
     join revenue_motions m on m.id = a.motion_id
     join companies c on c.id = m.company_id
     left join partners pa on pa.id = m.partner_id
     left join sellers s on s.id = m.partner_seller_id
     where a.status = 'pending' and m.status = 'active'
     order by a.due_at, a.step`,
  );
  const { rows: comms } = await pool.query(
    `select ca.id, ca.title, ca.detail, ca.due_at, ca.confidence, ca.motion_id,
            t.company_id, c.legal_name, s.name as owner_name
     from communication_actions ca
     join communication_threads t on t.id = ca.thread_id
     join companies c on c.id = t.company_id
     left join sellers s on s.id = ca.owner_seller_id
     where ca.status = 'pending'
     order by ca.due_at nulls last`,
  );
  const { rows: recent } = await pool.query(
    `select a.action, a.status, a.completed_at, c.legal_name
     from motion_actions a
     join revenue_motions m on m.id = a.motion_id
     join companies c on c.id = m.company_id
     where a.status in ('done','skipped')
     order by a.completed_at desc limit 8`,
  );

  const items: Item[] = [
    ...cadence.map((a) => ({
      id: a.id as string,
      kind: "cadence" as const,
      dueAt: a.due_at ? new Date(a.due_at) : null,
      title: a.action as string,
      detail: null,
      motionId: a.motion_id as string,
      companyId: a.company_id as string,
      legalName: a.legal_name as string,
      partnerName: (a.partner_name as string) ?? null,
      owner: (a.seller_name as string) ?? null,
      meta: `step ${a.step}`,
    })),
    ...comms.map((a) => ({
      id: a.id as string,
      kind: "conversation" as const,
      dueAt: a.due_at ? new Date(a.due_at) : null,
      title: a.title as string,
      detail: (a.detail as string) ?? null,
      motionId: (a.motion_id as string) ?? null,
      companyId: (a.company_id as string) ?? null,
      legalName: a.legal_name as string,
      partnerName: null,
      owner: (a.owner_name as string) ?? null,
      meta: a.confidence ? `${a.confidence} confidence` : null,
    })),
  ];

  const now = Date.now();
  const today0 = startOfToday();

  // Bentos (from the full set)
  const overdueN = items.filter((i) => i.dueAt && i.dueAt.getTime() < today0).length;
  const todayN = items.filter((i) => i.dueAt && i.dueAt.getTime() >= today0 && i.dueAt.getTime() < today0 + DAY).length;
  const weekN = items.filter((i) => i.dueAt && i.dueAt.getTime() < today0 + 7 * DAY).length;
  const convoN = items.filter((i) => i.kind === "conversation").length;

  // Filters — window / source / partner / account search, so the worklist holds
  // at thousands of accounts.
  const partnerOptions = [...new Set(items.map((i) => i.partnerName).filter(Boolean) as string[])].sort();
  const query = (sp.q ?? "").trim().toLowerCase();
  const windowDays = ["7", "30"].includes(sp.window ?? "") ? Number(sp.window) : null;
  const inWindow = (i: Item) => {
    if (sp.window === "overdue") return i.dueAt != null && i.dueAt.getTime() < today0;
    if (sp.window === "today") return i.dueAt != null && i.dueAt.getTime() >= today0 && i.dueAt.getTime() < today0 + DAY;
    if (windowDays != null) return i.dueAt != null && i.dueAt.getTime() < today0 + windowDays * DAY;
    return true;
  };
  const filtered = items.filter((i) => {
    if (sp.source && sp.source !== "all" && i.kind !== sp.source) return false;
    if (sp.partner && sp.partner !== "all" && (i.partnerName ?? "Direct") !== sp.partner) return false;
    if (query && !`${i.legalName} ${i.title} ${i.owner ?? ""}`.toLowerCase().includes(query)) return false;
    return inWindow(i);
  });

  // Sort: overdue/dated first (earliest due), undated last.
  filtered.sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));

  // Group
  const bucketOf = (i: Item): string => {
    if (!i.dueAt) return "No date";
    const t = i.dueAt.getTime();
    if (t < today0) return "Overdue";
    if (t < today0 + DAY) return "Today";
    if (t < today0 + 7 * DAY) return "This week";
    return "Later";
  };
  const BUCKET_ORDER = ["Overdue", "Today", "This week", "Later", "No date"];
  const groups = new Map<string, Item[]>();
  for (const i of filtered) {
    const key = groupKey === "account" ? i.legalName : groupKey === "partner" ? i.partnerName ?? "Direct" : bucketOf(i);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(i);
  }
  const orderedKeys =
    groupKey === "due"
      ? BUCKET_ORDER.filter((k) => groups.has(k))
      : [...groups.keys()].sort((a, b) => groups.get(b)!.length - groups.get(a)!.length);

  return (
    <main>
      <PageHeader
        title="Action queue"
        subtitle="One worklist across active motions and live conversations. Overdue floats up — activation means scheduled work, not a status."
      />

      {/* Bentos */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Bento label="open actions" value={items.length} />
        <Bento label="overdue" value={overdueN} />
        <Bento label="due today" value={todayN} />
        <Bento label="due this week" value={weekN} />
        <Bento label="from conversations" value={convoN} />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <QuerySelect param="window" value={sp.window ?? "all"} label="Window" options={[{ value: "all", label: "All" }, { value: "overdue", label: "Overdue" }, { value: "today", label: "Today" }, { value: "7", label: "Next 7 days" }, { value: "30", label: "Next 30 days" }]} />
        <QuerySelect param="source" value={sp.source ?? "all"} label="Source" options={[{ value: "all", label: "All sources" }, { value: "cadence", label: "Motion cadence" }, { value: "conversation", label: "Conversations" }]} />
        {partnerOptions.length > 0 && (
          <QuerySelect param="partner" value={sp.partner ?? "all"} label="Partner" options={[{ value: "all", label: "Any partner" }, { value: "Direct", label: "Direct" }, ...partnerOptions.map((p) => ({ value: p, label: p }))]} />
        )}
        <QuerySelect param="group" value={groupKey} label="Group by" options={[{ value: "due", label: "Due bucket" }, { value: "account", label: "Account" }, { value: "partner", label: "Partner" }]} />
        <form className="ml-auto flex items-center gap-2">
          {Object.entries({ window: sp.window, source: sp.source, partner: sp.partner, group: sp.group }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search account, task…" className="w-52 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
          <span className="text-xs text-neutral-500">{filtered.length}</span>
        </form>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-500">
            {items.length === 0
              ? "Nothing pending. Actions appear when a motion goes active — its play cadence becomes dated steps — or when a conversation surfaces a follow-up."
              : "Nothing matches this filter."}
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {orderedKeys.map((k) => (
            <section key={k}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                <span className={k === "Overdue" ? "text-red-700 dark:text-red-400" : ""}>{k}</span>
                <span className="tnum text-neutral-400">{groups.get(k)!.length}</span>
              </h2>
              <div className="space-y-2">
                {groups.get(k)!.map((i) => {
                  const overdue = i.dueAt != null && i.dueAt.getTime() < today0;
                  return (
                    <Card key={`${i.kind}:${i.id}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm">
                            <span className={overdue ? "font-semibold text-red-700 dark:text-red-400" : "font-medium text-neutral-500"}>
                              {i.dueAt ? `${overdue ? "overdue · " : ""}${i.dueAt.toISOString().slice(0, 10)}` : "no date"}
                            </span>
                            <span className="text-neutral-400"> · </span>
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${i.kind === "conversation" ? "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"}`}>
                              {i.kind === "conversation" ? "conversation" : "cadence"}
                            </span>
                            {i.meta && <span className="ml-1 text-xs text-neutral-400">{i.meta}</span>}
                            {groupKey !== "account" && (
                              <>
                                {" · "}
                                {i.motionId ? (
                                  <Link href={`/briefs/${i.motionId}`} className="font-semibold hover:underline">{i.legalName}</Link>
                                ) : i.companyId ? (
                                  <Link href={`/accounts/${i.companyId}`} className="font-semibold hover:underline">{i.legalName}</Link>
                                ) : (
                                  <span className="font-semibold">{i.legalName}</span>
                                )}
                              </>
                            )}
                            {i.partnerName && <span className="text-neutral-500"> via {i.partnerName}</span>}
                            {i.owner && <span className="text-neutral-400"> → {i.owner}</span>}
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{i.title}</p>
                          {i.detail && <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">{i.detail}</p>}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {i.kind === "cadence" ? (
                            <>
                              <form action={resolveActionAction.bind(null, i.id, "done")}>
                                <button className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800">Done</button>
                              </form>
                              <form action={resolveActionAction.bind(null, i.id, "skipped")}>
                                <button className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900">Skip</button>
                              </form>
                            </>
                          ) : (
                            <>
                              <form action={resolveCommActionAction.bind(null, i.id, "done")}>
                                <button className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800">Done</button>
                              </form>
                              <form action={resolveCommActionAction.bind(null, i.id, "dismissed")}>
                                <button className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-400 dark:ring-neutral-700 dark:hover:bg-neutral-900">Dismiss</button>
                              </form>
                            </>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <Card className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Recently resolved</h2>
          <ul className="space-y-1.5">
            {recent.map((r, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
                <span className={r.status === "done" ? "text-green-700 dark:text-green-400" : "text-neutral-400"}>{r.status}</span>
                <span>{r.legal_name} — {r.action}</span>
                <span className="ml-auto shrink-0 text-xs text-neutral-400">{new Date(r.completed_at).toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
