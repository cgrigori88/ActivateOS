import { getOwnerPool } from "@/db/client";
import { PageHeader, Card } from "@/components/ui";
import { currentRole } from "@/lib/auth/org";
import { withTenant } from "@/lib/db/tenant";
import { governanceHealth, deadLetters, type GovernanceHealth, type DeadLetter } from "@/lib/pursuits/federation/ops";

export const dynamic = "force-dynamic";

/**
 * Governance ops (Release Gate R1-G6). A read-only, owner-gated operational view of the
 * closed loop — governed actions, the recompute queue, the external-action outbox, and
 * the dead/stuck work needing attention — so an operator can diagnose a failed
 * pursuit/action/recompute without SQL. Org-scoped by RLS inside withTenant.
 */
export default async function OpsPage() {
  const role = await currentRole(getOwnerPool());
  if (role !== "owner") {
    return (
      <main>
        <PageHeader title="Governance ops" subtitle="Operational view of the governed loop." />
        <Card><p className="text-copy text-neutral-500">Owner access required.</p></Card>
      </main>
    );
  }

  const { health, dead } = await withTenant(async (db, orgId) => ({
    health: await governanceHealth(db, orgId),
    dead: await deadLetters(db, orgId, 100),
  }));

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-6">
      <PageHeader title="Governance ops" subtitle="Governed actions · recompute queue · external-action outbox — read-only." />
      <div className="grid gap-4 sm:grid-cols-3">
        <HealthCard title="Governed actions" counts={health.invocations} />
        <HealthCard title="Recompute queue" counts={health.recomputes} />
        <HealthCard title="Action outbox" counts={health.outbox} />
      </div>
      <div className="mt-6">
        <h2 className="mb-2 text-body font-semibold uppercase tracking-[0.04em] text-neutral-400">Needs attention ({dead.length})</h2>
        {dead.length === 0 ? (
          <Card><p className="text-copy text-neutral-500">No failed, compensated, or dead-lettered work. The loop is clean.</p></Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-body">
                <thead>
                  <tr className="text-left text-label uppercase tracking-[0.03em] text-neutral-400">
                    <th className="py-1 pr-3">Kind</th><th className="py-1 pr-3">What</th><th className="py-1 pr-3">Status</th>
                    <th className="py-1 pr-3">Attempts</th><th className="py-1 pr-3">Reason</th><th className="py-1">When</th>
                  </tr>
                </thead>
                <tbody>
                  {dead.map((d: DeadLetter) => (
                    <tr key={`${d.kind}-${d.id}`} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="py-1.5 pr-3 text-neutral-500">{d.kind}</td>
                      <td className="py-1.5 pr-3 font-medium">{d.label}</td>
                      <td className="py-1.5 pr-3"><StatusPill status={d.status} /></td>
                      <td className="py-1.5 pr-3 tabular-nums text-neutral-500">{d.attempts ?? "—"}</td>
                      <td className="py-1.5 pr-3 max-w-[36ch] truncate text-neutral-500" title={d.reason ?? ""}>{d.reason ?? "—"}</td>
                      <td className="py-1.5 tabular-nums text-neutral-400">{d.at.replace("T", " ").slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}

function HealthCard({ title, counts }: { title: string; counts: GovernanceHealth["invocations"] }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return (
    <Card>
      <div className="text-label font-semibold uppercase tracking-[0.04em] text-neutral-400">{title}</div>
      <div className="mt-1 pos-metric-fig">{total}</div>
      <ul className="mt-2 space-y-0.5">
        {entries.length === 0 ? <li className="text-body text-neutral-400">none</li> : entries.map(([k, n]) => (
          <li key={k} className="flex items-center justify-between text-body"><StatusPill status={k} /><span className="tabular-nums text-neutral-500">{n}</span></li>
        ))}
      </ul>
    </Card>
  );
}

const BAD = /FAIL|REJECT|COMPENSAT|SUPPRESS/;
function StatusPill({ status }: { status: string }) {
  const bad = BAD.test(status);
  return <span className="inline-block rounded-inner px-1.5 py-0.5 text-label font-medium" style={{ background: bad ? "rgba(239,68,68,0.12)" : "rgba(16,185,129,0.12)", color: bad ? "#ef4444" : "#059669" }}>{status.toLowerCase()}</span>;
}
