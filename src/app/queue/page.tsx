import Link from "next/link";
import { Bento, Card, PageHeader, BlockLabel } from "@/components/ui";
import { RoomTabs } from "@/components/room-tabs";
import { QuerySelect } from "@/components/query-select";
import { withTenant } from "@/lib/db/tenant";
import { getScopeContext } from "@/lib/scope/server";
import { resolveActionAction, resolveCommActionAction } from "./actions";
import { buttonClass } from "@/components/ui";
import { ExecutionModel } from "@/components/execution-model";
import { formatMoney } from "@/lib/format/money";

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
  /** Motion-level value of the work this item advances. Null when not applicable. */
  valueUsd: number | null;
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
  searchParams: Promise<{ window?: string; source?: string; group?: string; partner?: string; q?: string; scope?: string }>;
}) {
  const sp = await searchParams;
  const groupKey = ["due", "account", "partner"].includes(sp.group ?? "") ? sp.group! : "due";

  // Ecosystem scope (§1): narrow the worklist to the authorized company set — never
  // widen. Both row sources already carry a company linkage (motion→company,
  // thread→company), so scope filters on it as a read-side view predicate. Actions
  // (id-scoped, RLS-bounded) are unaffected. Same idiom as Today/Pipeline.
  const scope = await getScopeContext(sp.scope ?? null);
  const scopeIds = scope.companyIds;
  const scoped = scopeIds != null;
  const ids = scopeIds ?? [];

  const { cadence, comms, recent } = await withTenant(async (db) => ({
    cadence: (
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
     where a.status = 'pending' and m.status = 'active'
       and ($2::boolean is false or m.company_id = any($1))
     order by a.due_at, a.step`,
        [ids, scoped],
      )
    ).rows,
    comms: (
      await db.query(
        `select ca.id, ca.title, ca.detail, ca.due_at, ca.confidence, ca.motion_id,
            t.company_id, c.legal_name, s.name as owner_name
     from communication_actions ca
     join communication_threads t on t.id = ca.thread_id
     join companies c on c.id = t.company_id
     left join sellers s on s.id = ca.owner_seller_id
     where ca.status = 'pending'
       and ($2::boolean is false or t.company_id = any($1))
     order by ca.due_at nulls last`,
        [ids, scoped],
      )
    ).rows,
    recent: (
      await db.query(
        `select a.action, a.status, a.completed_at, c.legal_name
     from motion_actions a
     join revenue_motions m on m.id = a.motion_id
     join companies c on c.id = m.company_id
     where a.status in ('done','skipped')
       and ($2::boolean is false or m.company_id = any($1))
     order by a.completed_at desc limit 8`,
        [ids, scoped],
      )
    ).rows,
  }));

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
      /* §3/§11: "step 1" is the cadence engine's internal counter, not something a
         business operator acts on. It moves behind the fold with the rest of the
         mechanism; the row leads with the work and what it is worth. */
      meta: `step ${a.step}`,
      valueUsd: a.estimated_value_usd == null ? null : Number(a.estimated_value_usd),
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
      /* Conversation follow-ups are not motion-scoped, so they carry no motion
         value. Left null rather than defaulted to zero — an unknown value and a
         zero value are different claims (§12). */
      valueUsd: null,
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
        title="Queue"
        subtitle="What needs to happen now — across active motions and live conversations."
      />
      <RoomTabs tabs={[{ href: "/", label: "Today" }, { href: "/queue", label: "Queue" }]} />

      {/* Wave 4 §2/§8: the stage of the execution model this room occupies. */}
      <ExecutionModel
        current="queue"
        steps={{
          queue: { label: `${items.length} open`, detail: overdueN > 0 ? `${overdueN} overdue` : undefined },
        }}
      />

      {/* §12/§13: five tiles, one of which read "0 from conversations" — an empty
          instrument at the top of a work surface. A count earns its tile while it
          has something to report; the filters that act on these numbers are the
          row directly below, unchanged. */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Bento label="open actions" value={items.length} href="/queue" />
        {overdueN > 0 && <Bento label="overdue" value={overdueN} href="/queue?window=overdue" intent="warning" />}
        <Bento label="due today" value={todayN} href="/queue?window=today" />
        <Bento label="due this week" value={weekN} href="/queue?window=7" />
        {convoN > 0 && <Bento label="from conversations" value={convoN} href="/queue?source=conversation" />}
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
          {Object.entries({ window: sp.window, source: sp.source, partner: sp.partner, group: sp.group, scope: sp.scope }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search account, task…" className="w-52 rounded-control border border-neutral-300 bg-white px-2.5 py-1.5 text-copy dark:border-neutral-700 dark:bg-neutral-900" />
          <span className="text-body text-neutral-500">{filtered.length}</span>
        </form>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <p className="text-copy text-neutral-500">
            {items.length === 0
              ? "Nothing pending. Actions appear when a motion goes active — its play cadence becomes dated steps — or when a conversation surfaces a follow-up."
              : "Nothing matches this filter."}
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {orderedKeys.map((k) => (
            <section key={k}>
              <h2 className="mb-2 flex items-center gap-2 text-copy font-semibold uppercase tracking-wide text-neutral-500">
                <span className={k === "Overdue" ? "text-red-700 dark:text-red-400" : ""}>{k}</span>
                <span className="tnum text-neutral-400">{groups.get(k)!.length}</span>
              </h2>
              <div className="space-y-2">
                {groups.get(k)!.map((i) => {
                  const overdue = i.dueAt != null && i.dueAt.getTime() < today0;
                  return (
                    /*
                      Wave 4 §2/§3/§9 — the row, and the most important correction
                      in this wave.

                      THE DEFECT. Every row ended in two filled primary buttons
                      labelled "Done" and "Skip". `Done` writes
                      motion_actions.status='done' — it resolves the REMINDER. It
                      does not approve a route, does not authorize anything, and
                      sends nothing. Yet it sat, at primary weight, on a row reading
                      "Approve WWT route brief before sending to partner". A
                      reasonable operator would read that button as performing the
                      approval. That is exactly the collapse §2 forbids: a queued
                      reminder and a governed decision are different objects, and
                      the UI implied one control did both.

                      THE FIX, presentation only. The control is renamed to what it
                      actually does — "Mark handled" — and demoted to subtle, because
                      book-keeping is not the primary act. The primary act is opening
                      the place where the real decision is made, which the row now
                      links to as its leading affordance. No server action, authority
                      check or status value changed.

                      The rest is §3's hierarchy: the work first, then the commercial
                      object and what it is worth, then who owns it, then the date.
                      Mechanism ("cadence", "step 1") moves to the end at metadata
                      weight, where it can still be read but no longer leads.
                    */
                    <Card key={`${i.kind}:${i.id}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          {/* WHAT needs to happen */}
                          <p className="text-copy font-semibold leading-snug ink">{i.title}</p>
                          {i.detail && <p className="mt-0.5 text-body ink-muted">{i.detail}</p>}

                          {/* WHICH commercial object, and what it is worth */}
                          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-body">
                            {i.companyId ? (
                              <Link href={`/accounts/${i.companyId}`} className="font-semibold hover:underline">{i.legalName}</Link>
                            ) : (
                              <span className="font-semibold">{i.legalName}</span>
                            )}
                            {i.partnerName && <span className="ink-muted">via {i.partnerName}</span>}
                            {i.valueUsd != null && i.valueUsd > 0 && (
                              <span className="tnum ink-muted"><b className="ink">{formatMoney(i.valueUsd)}</b> motion value</span>
                            )}
                            {i.owner && <span className="ink-faint">owner {i.owner}</span>}
                          </p>

                          {/* WHEN, and the mechanism that produced it — last, and quiet */}
                          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-label ink-faint">
                            <span className={overdue ? "font-semibold" : ""} style={overdue ? { color: "var(--color-accent-risk)" } : undefined}>
                              {i.dueAt ? `${overdue ? "overdue · " : "due "}${i.dueAt.toISOString().slice(0, 10)}` : "no date"}
                            </span>
                            <span aria-hidden>·</span>
                            <span>{i.kind === "conversation" ? "raised by a conversation" : "from the motion's play cadence"}</span>
                            {i.meta && <><span aria-hidden>·</span><span>{i.meta}</span></>}
                          </p>
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          {/* The real work lives where the governed control is. */}
                          {i.motionId ? (
                            <Link href={`/briefs/${i.motionId}`} className={buttonClass("primary", "sm")}>Open the work →</Link>
                          ) : i.companyId ? (
                            <Link href={`/accounts/${i.companyId}`} className={buttonClass("primary", "sm")}>Open the account →</Link>
                          ) : null}
                          {/* A dot between them: two adjacent subtle buttons read as
                              one phrase ("Mark handled Skip") without a separator. */}
                          <div className="flex items-center gap-1.5 text-label ink-faint">
                            {i.kind === "cadence" ? (
                              <>
                                <form action={resolveActionAction.bind(null, i.id, "done")}>
                                  <button className={buttonClass("subtle", "sm")} title="Removes this reminder from the queue. It does not approve, authorize or send anything.">Mark handled</button>
                                </form>
                                <span aria-hidden>·</span>
                                <form action={resolveActionAction.bind(null, i.id, "skipped")}>
                                  <button className={buttonClass("subtle", "sm")} title="Skip this cadence step.">Skip</button>
                                </form>
                              </>
                            ) : (
                              <>
                                <form action={resolveCommActionAction.bind(null, i.id, "done")}>
                                  <button className={buttonClass("subtle", "sm")} title="Removes this follow-up from the queue. It does not send anything.">Mark handled</button>
                                </form>
                                <span aria-hidden>·</span>
                                <form action={resolveCommActionAction.bind(null, i.id, "dismissed")}>
                                  <button className={buttonClass("subtle", "sm")}>Dismiss</button>
                                </form>
                              </>
                            )}
                          </div>
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
          <BlockLabel>Recently resolved</BlockLabel>
          <ul className="space-y-1.5">
            {recent.map((r, i) => (
              <li key={i} className="flex items-center gap-2 text-copy text-neutral-600 dark:text-neutral-400">
                <span className={r.status === "done" ? "text-positive dark:text-green-400" : "text-neutral-400"}>{r.status}</span>
                <span>{r.legal_name} — {r.action}</span>
                <span className="ml-auto shrink-0 text-body text-neutral-400">{new Date(r.completed_at).toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
