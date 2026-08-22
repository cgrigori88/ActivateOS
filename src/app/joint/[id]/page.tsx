import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@/db/client";
import { currentOrgId } from "@/lib/auth/org";
import { Card, PageHeader } from "@/components/ui";
import { namedOverlapAccounts, pursuitEvents } from "@/lib/partnerships/joint";
import { addNoteAction, closePursuitAction, decidePursuitAction, refreshBrokerAction, saveJointPlaybookAction } from "../actions";
import { loadJointPlaybook } from "@/lib/playbooks/playbooks";

export const dynamic = "force-dynamic";

/**
 * One joint pursuit room (task #74). Violet = joint, everywhere. The three
 * panels encode the trust story:
 *  - the LEDGER both sides read identically (stored text uses org names);
 *  - the BROKER's proposal, composed only from consented data;
 *  - the WHAT-THEY-SEE panel: exactly the surface the other side has —
 *    no more wondering what the partner's screen shows.
 */
export default async function JointPursuitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const pool = getPool();
  const orgId = await currentOrgId(pool);
  if (!orgId) notFound();

  const { rows } = await pool.query<{
    id: string; partnership_id: string; company_id: string; name: string; status: string;
    proposed_by_org: string; created_at: Date; legal_name: string; industry: string | null;
    initiator_org_id: string; counterpart_org_id: string | null; other_name: string | null; my_name: string;
  }>(
    `select jp.id, jp.partnership_id, jp.company_id, jp.name, jp.status, jp.proposed_by_org, jp.created_at,
            c.legal_name, c.industry, p.initiator_org_id, p.counterpart_org_id,
            (select o.name from organizations o
             where o.id = case when p.initiator_org_id = $2 then p.counterpart_org_id else p.initiator_org_id end) as other_name,
            (select o.name from organizations o where o.id = $2) as my_name
     from joint_pursuits jp
     join partnerships p on p.id = jp.partnership_id
     join companies c on c.id = jp.company_id
     where jp.id = $1 and (p.initiator_org_id = $2 or p.counterpart_org_id = $2)`,
    [id, orgId],
  );
  const pursuit = rows[0];
  if (!pursuit) notFound();

  const events = await pursuitEvents(pool, orgId, id);
  const named = await namedOverlapAccounts(pool, pursuit.partnership_id);
  const jointPlaybook = await loadJointPlaybook(pool, pursuit.partnership_id);
  const account = named.find((a) => a.company_id === pursuit.company_id);
  const otherOrgId = pursuit.initiator_org_id === orgId ? pursuit.counterpart_org_id : pursuit.initiator_org_id;
  const myCats = account?.cats[orgId] ?? [];
  const theirCats = (otherOrgId && account?.cats[otherOrgId]) || [];
  const latestProposal = [...events].reverse().find((e) => e.kind === "proposal");
  const awaitingYou = pursuit.status === "proposed" && pursuit.proposed_by_org !== orgId;

  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/joint" className="pos-backlink"><span aria-hidden>←</span>Joint pursuits</Link>
        <Link href={`/accounts/${pursuit.company_id}`} className="pos-backlink">
          {pursuit.legal_name} account<span aria-hidden>→</span>
        </Link>
      </div>
      <PageHeader
        title={pursuit.legal_name}
        subtitle={`Joint pursuit with ${pursuit.other_name ?? "partner org"} · ${pursuit.status}${pursuit.industry ? ` · ${pursuit.industry}` : ""}`}
      />

      {awaitingYou && (
        <Card className="mb-6 ring-2 ring-violet-300 dark:ring-violet-800">
          <p className="mb-2 text-sm">
            <span className="font-semibold">{pursuit.other_name}</span> proposed working this account together.
            Accepting opens a shared room — they see nothing new beyond the named overlap both owners already approved.
          </p>
          <div className="flex gap-2">
            <form action={decidePursuitAction.bind(null, pursuit.id, true)}>
              <button className="rounded-md bg-violet-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-800">Accept & open the room</button>
            </form>
            <form action={decidePursuitAction.bind(null, pursuit.id, false)}>
              <button className="rounded-md px-4 py-1.5 text-sm font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-300 dark:ring-neutral-700 dark:hover:bg-neutral-900">Decline</button>
            </form>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Ledger — the shared record, identical on both sides */}
        <Card className="lg:col-span-2">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Shared ledger</h2>
          <p className="mb-3 text-xs text-neutral-500">
            Both sides read exactly this — entries are written once, with org names, never a private version.
          </p>
          <ol className="space-y-2">
            {events.map((e) => (
              <li
                key={e.id}
                className={`rounded-lg border p-3 text-sm ${
                  e.side === "broker"
                    ? "border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/30"
                    : "border-neutral-200 dark:border-neutral-800"
                }`}
              >
                <p className="mb-1 text-[11px] text-neutral-400">
                  <span className={`font-semibold uppercase tracking-wide ${e.side === "broker" ? "text-violet-700 dark:text-violet-400" : "text-neutral-500"}`}>
                    {e.side === "broker" ? "broker" : e.side === "us" ? `${pursuit.my_name} (you)` : pursuit.other_name}
                  </span>
                  {" · "}{e.kind} · {e.createdAt} UTC
                </p>
                <pre className="whitespace-pre-wrap font-sans leading-relaxed">{e.body}</pre>
              </li>
            ))}
          </ol>

          {pursuit.status === "active" && (
            <form action={addNoteAction.bind(null, pursuit.id)} className="mt-3 flex items-end gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <label className="flex-1 text-sm">
                <span className="mb-1 block text-xs text-neutral-500">Add to the ledger — the partner sees it verbatim</span>
                <textarea name="body" rows={2} required className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
              </label>
              <button className="rounded-md bg-violet-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-800">Post</button>
            </form>
          )}
        </Card>

        <div className="space-y-6">
          {/* What they can see — the trust panel */}
          <Card>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">What {pursuit.other_name ?? "they"} can see</h2>
            <p className="mb-2 text-xs text-neutral-500">The other side&apos;s complete surface for this account — nothing beyond this list crosses the boundary.</p>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-violet-700 dark:bg-violet-950/50 dark:text-violet-400">overlap</span>
                <span>That you hold this account as: {myCats.map((c) => c.replace(/_/g, " ")).join(", ") || "—"} (named rung, both owners approved)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-violet-700 dark:bg-violet-950/50 dark:text-violet-400">ledger</span>
                <span>Every entry in this room&apos;s shared ledger, verbatim</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-neutral-500 dark:bg-neutral-800">not</span>
                <span className="text-neutral-500">Your evidence, contacts, pipeline, campaigns, scores — none of it, unless separately shared as a field-scoped list grant</span>
              </li>
            </ul>
            <p className="mt-2 border-t border-neutral-100 pt-2 text-xs text-neutral-500 dark:border-neutral-800">
              You see their side the same way: they hold this account as {theirCats.map((c) => c.replace(/_/g, " ")).join(", ") || "—"}.
            </p>
          </Card>

          {/* Broker */}
          <Card>
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Broker</h2>
            <p className="mb-2 text-xs text-neutral-500">
              A neutral proposal from the platform — composed only from data both sides approved, said identically to both.
            </p>
            {latestProposal ? (
              <p className="mb-2 text-xs text-neutral-400">Latest proposal is in the ledger ({latestProposal.createdAt} UTC).</p>
            ) : (
              <p className="mb-2 text-xs text-neutral-400">No proposal yet.</p>
            )}
            {pursuit.status === "active" && (
              <form action={refreshBrokerAction.bind(null, pursuit.id)}>
                <button className="rounded-md px-3 py-1.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-300 hover:bg-violet-50 dark:text-violet-400 dark:ring-violet-800 dark:hover:bg-violet-950">
                  {latestProposal ? "Refresh proposal" : "Ask the broker"}
                </button>
              </form>
            )}
          </Card>

          {/* Joint playbook (task #83): one shared text per partnership, symmetric like the ledger */}
          <Card tone="violet">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Joint playbook</h2>
            <p className="mb-2 text-xs text-neutral-500">
              How the two companies work together — one text, co-edited. {pursuit.other_name ?? "The partner"} sees
              this identically, and every save lands on both audit ledgers. The broker cites it.
              {jointPlaybook?.updatedAt && <span className="text-neutral-400"> Last saved {jointPlaybook.updatedAt}.</span>}
            </p>
            <form action={saveJointPlaybookAction.bind(null, pursuit.id, pursuit.partnership_id)}>
              <textarea
                name="body"
                rows={6}
                maxLength={8000}
                defaultValue={jointPlaybook?.body ?? ""}
                readOnly={pursuit.status !== "active"}
                placeholder="Who opens, how deals register, the joint pitch, escalation paths…"
                className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
              {pursuit.status === "active" && (
                <button className="mt-2 rounded-md bg-violet-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-800">
                  Save joint playbook
                </button>
              )}
            </form>
          </Card>

          {pursuit.status === "active" && (
            <div className="flex justify-end">
              <form action={closePursuitAction.bind(null, pursuit.id)}>
                <button className="rounded-md px-3 py-1.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50 dark:text-red-400 dark:ring-red-800 dark:hover:bg-red-950">
                  Close pursuit
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
