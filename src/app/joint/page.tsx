import Link from "next/link";
import { getPool } from "@/db/client";
import { currentOrgId } from "@/lib/auth/org";
import { Card, PageHeader } from "@/components/ui";
import { listPartnerships } from "@/lib/partnerships/partnerships";
import { listJointPursuits, namedOverlapAccounts } from "@/lib/partnerships/joint";
import { decidePursuitAction, proposePursuitAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Joint pursuits (task #74) — the co-sell rooms this tenant shares with its
 * partners. Violet is the joint color everywhere in the platform. A pursuit
 * can only be proposed on an account from an approved NAMED overlap — the
 * disclosure ladder is the door key.
 */

const STATUS_TONE: Record<string, string> = {
  proposed: "bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900",
  active: "bg-green-50 text-green-800 ring-green-200 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-900",
  declined: "bg-neutral-100 text-neutral-500 ring-neutral-200 dark:bg-neutral-800 dark:ring-neutral-700",
  closed: "bg-neutral-100 text-neutral-500 ring-neutral-200 dark:bg-neutral-800 dark:ring-neutral-700",
};

export default async function JointPage() {
  const pool = getPool();
  const orgId = await currentOrgId(pool);
  if (!orgId) return <main>No organization.</main>;

  const pursuits = await listJointPursuits(pool, orgId);
  const partnerships = (await listPartnerships(pool, orgId)).filter((p) => p.status === "active");

  // Proposable accounts per partnership: named overlap minus existing pursuits.
  const taken = new Set(pursuits.filter((x) => x.status !== "declined").map((x) => `${x.partnershipId}:${x.companyId}`));
  const proposable: { partnershipId: string; otherOrgName: string | null; accounts: { company_id: string; name: string }[] }[] = [];
  for (const p of partnerships) {
    const named = await namedOverlapAccounts(pool, p.id);
    const open = named.filter((a) => !taken.has(`${p.id}:${a.company_id}`));
    if (open.length > 0) proposable.push({ partnershipId: p.id, otherOrgName: p.otherOrgName ?? p.myLensName, accounts: open });
  }

  return (
    <main>
      <PageHeader
        title="Joint pursuits"
        subtitle="Co-sell rooms shared with a partner tenant. Each side sees the identical ledger; the broker proposes plays from data both sides already approved — nothing else."
      />

      {pursuits.length === 0 && proposable.length === 0 && (
        <Card muted>
          <p className="text-sm text-neutral-500">
            No joint pursuits yet — and nothing is proposable until a partnership&apos;s blind-overlap
            ladder reaches the <em>named accounts</em> rung. Run the ladder on the{" "}
            <Link href="/admin" className="text-blue-700 hover:underline dark:text-blue-400">Admin</Link> page;
            once both owners approve the named rung, those shared accounts become eligible rooms here.
          </p>
        </Card>
      )}

      {pursuits.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          {pursuits.map((p) => (
              <Card key={p.id} className={p.awaitingYou ? "ring-2 ring-violet-300 dark:ring-violet-800" : ""}>
                <div className="mb-1 flex items-center gap-2">
                  <Link href={`/joint/${p.id}`} className="font-semibold hover:underline">{p.accountName}</Link>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${STATUS_TONE[p.status]}`}>
                    {p.status}
                  </span>
                  {p.awaitingYou && (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white">awaiting your decision</span>
                  )}
                </div>
                <p className="text-xs text-neutral-500">
                  with {p.otherOrgName ?? "partner org"}
                  {p.industry ? ` · ${p.industry}` : ""} · proposed {p.createdAt}
                </p>
                {p.awaitingYou && (
                  <div className="mt-2 flex gap-2">
                    <form action={decidePursuitAction.bind(null, p.id, true)}>
                      <button className="rounded-md bg-violet-700 px-3 py-1 text-xs font-medium text-white hover:bg-violet-800">Accept & open the room</button>
                    </form>
                    <form action={decidePursuitAction.bind(null, p.id, false)}>
                      <button className="rounded-md px-3 py-1 text-xs font-medium text-neutral-600 ring-1 ring-inset ring-neutral-300 hover:bg-neutral-50 dark:text-neutral-300 dark:ring-neutral-700 dark:hover:bg-neutral-900">Decline</button>
                    </form>
                  </div>
                )}
              </Card>
          ))}
        </div>
      )}

      {proposable.length > 0 && (
        <Card>
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">Open a new room</h2>
          <p className="mb-3 text-xs text-neutral-500">
            Only accounts from an approved named overlap are eligible — both sides already know they share them.
            The partner&apos;s owner accepts before the room opens.
          </p>
          {proposable.map((g) => (
            <form key={g.partnershipId} action={proposePursuitAction} className="mb-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="partnershipId" value={g.partnershipId} />
              <label className="text-sm">
                <span className="mb-1 block text-xs text-neutral-500">Shared account · with {g.otherOrgName}</span>
                <select name="companyId" className="w-72 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                  {g.accounts.map((a) => <option key={a.company_id} value={a.company_id}>{a.name}</option>)}
                </select>
              </label>
              <button className="rounded-md bg-violet-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-800">
                Propose joint pursuit
              </button>
            </form>
          ))}
        </Card>
      )}
    </main>
  );
}
