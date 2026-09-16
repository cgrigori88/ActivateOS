import Link from "next/link";
import { Card, PageHeader, BlockLabel, buttonClass } from "@/components/ui";
import { withTenant } from "@/lib/db/tenant";
import { vnextEnvEnabled } from "@/lib/env/vnext-flags";
import { pendingApprovals } from "@/lib/runtime/approvals";
import { approveAction, rejectAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Approvals (P45-2) — the governed decisions waiting on a person.
 *
 * Deliberately narrow: what is waiting, on which pursuit, what it would do, who asked, why it needs
 * a human, and two buttons. Enough context to decide here rather than reconstructing the pursuit
 * elsewhere — and a link through when more is wanted. This is not a workflow builder.
 *
 * WAITING_FOR_APPROVAL is derived from the approval lifecycle, never stored twice: this page and
 * Pursuit detail read the same `pendingApprovals` model, so there is one representation of the
 * state, not two that can disagree.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const notice = typeof sp.notice === "string" ? sp.notice : null;

  // Backend-only gate: the control plane is infrastructure, not a pursuit surface.
  if (!vnextEnvEnabled("control_plane")) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <PageHeader title="Approvals" subtitle="Governed decisions waiting on a person." />
        <Card><p className="text-neutral-500">The governed runtime is not enabled for this deployment.</p></Card>
      </div>
    );
  }

  const pending = await withTenant(async (db, orgId) => {
    const { rows } = await db.query<{ on: boolean }>(`select governed_action as on from org_features where org_id = $1`, [orgId]);
    if (rows[0]?.on !== true) return null;
    return pendingApprovals(db, orgId);
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader title="Approvals" subtitle="Governed decisions waiting on a person. Approval authorizes continuation — it does not grant authority." />
      {notice && <Card className="mb-3"><p className="text-sm">{notice}</p></Card>}

      {pending === null ? (
        <Card><p className="text-neutral-500">Governed actions are not enabled for this organization.</p></Card>
      ) : pending.length === 0 ? (
        <Card><p className="text-neutral-500">Nothing is waiting on a decision.</p></Card>
      ) : (
        <ul className="space-y-2">
          {pending.map((p) => (
            <li key={p.requestId}>
              <Card>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <BlockLabel>{p.account ?? "—"}</BlockLabel>
                    <p className="mt-0.5 font-medium">{p.actionText ?? p.skillId}</p>
                    <p className="mt-0.5 text-sm text-neutral-500">
                      <span className="font-medium">{p.skillId}</span> · requested {new Date(p.requestedAt).toISOString().slice(0, 16).replace("T", " ")}
                    </p>
                    <p className="mt-1 text-sm text-neutral-500">Why a person decides: {p.whyRequired}</p>
                    <Link href={`/pursuits/${p.pursuitId}`} className="mt-1 inline-block text-sm font-medium hover:underline" style={{ color: "var(--color-readiness)" }}>
                      Open the pursuit →
                    </Link>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <form action={approveAction.bind(null, p.requestId)}>
                      <button type="submit" className={buttonClass("primary")}>Approve</button>
                    </form>
                    <form action={rejectAction.bind(null, p.requestId)}>
                      <button type="submit" className={buttonClass("ghost")}>Reject</button>
                    </form>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
