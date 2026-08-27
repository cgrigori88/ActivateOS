import Link from "next/link";
import { notFound } from "next/navigation";
import { getPool } from "@/db/client";
import { currentOrgId } from "@/lib/auth/org";
import { partnerRoom } from "@/lib/partners/hub";
import { listInitiatives } from "@/lib/partnerships/initiatives";
import { loadPartnerPlaybook } from "@/lib/playbooks/playbooks";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/**
 * Partnership review (task #83 follow-up): the transition artifact. Where a
 * partner-plan document is authored once and stale the day after, this page is
 * PULLED — every figure computed from the live record at render time. It
 * exists for the org whose leadership still wants a document; when the partner
 * becomes a tenant, the shared plan replaces it and this stays as the printout.
 */

const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n > 0 ? `$${Math.round(n / 1000)}k` : "$0";

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 break-inside-avoid">
      <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-neutral-200 pb-1 dark:border-neutral-800 print:border-neutral-300">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
        {note && <span className="text-xs text-neutral-400">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800 print:border-neutral-300">
      <div className="text-label uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="tnum text-lg font-semibold">{value}</div>
      {sub && <div className="text-label text-neutral-400">{sub}</div>}
    </div>
  );
}

export default async function PartnershipReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = getPool();
  const orgId = await currentOrgId(pool);
  if (!orgId) return <main>No organization.</main>;

  const room = await partnerRoom(pool, orgId, id);
  if (!room) notFound();
  const { partner, book, partnership, ladder, grants, pursuits, settlement, scorecard } = room;
  const initiatives = await listInitiatives(pool, orgId, { partnerId: id, includeArchived: false });
  const playbook = (await loadPartnerPlaybook(pool, orgId, id)) ?? { positioning: "", strengths: "", rules: "" };

  // The renewal clock on this partner's approved lists — the co-sell homework.
  const { rows: renewals } = await pool.query<{ legal_name: string; renewal: string; list_name: string }>(
    `select distinct on (pm.company_id) c.legal_name,
            pm.attributes->>'renewal_date' as renewal, ap.name as list_name
     from population_members pm
     join account_populations ap on ap.id = pm.population_id
       and ap.org_id = $1 and ap.partner_id = $2 and ap.status = 'approved'
     join companies c on c.id = pm.company_id
     where pm.attributes ? 'renewal_date'
       and (pm.attributes->>'renewal_date')::date between now()::date and (now() + interval '180 days')::date
     order by pm.company_id, (pm.attributes->>'renewal_date')::date asc`,
    [orgId, id],
  );

  const generatedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
  const approvedRungs = ladder ? Object.entries(ladder.rungs).filter(([, r]) => r.state === "approved").map(([level]) => level) : [];
  const openPursuits = pursuits.filter((p) => p.status === "accepted" || p.status === "proposed").length;

  return (
    <main className="mx-auto max-w-4xl">
      <style>{`@media print { aside, nav, header.pos-topbar { display: none !important; } main { max-width: 100% !important; } body { background: #fff !important; } }`}</style>

      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link href={`/partners/${partner.id}`} className="text-sm text-neutral-500 hover:underline">← {partner.name}</Link>
        <PrintButton />
      </div>

      <header className="mb-6 border-b-2 border-neutral-900 pb-3 dark:border-neutral-100 print:border-neutral-900">
        <p className="text-label font-bold uppercase tracking-[0.14em] text-neutral-400">Partnership review</p>
        <h1 className="text-2xl font-bold">{partner.name}</h1>
        <p className="mt-1 text-xs text-neutral-500">
          {[partner.partnerType, partnership?.otherOrgName ? `connected tenant: ${partnership.otherOrgName}` : "not yet a connected tenant"].filter(Boolean).join(" · ")}
          {" · generated "}{generatedAt} UTC
        </p>
        <p className="mt-1 text-xs italic text-neutral-400">
          Every figure on this page is computed from the live record at the moment it was generated — nothing is authored, nothing can go stale. Pull it again and it is current again.
        </p>
      </header>

      <Section title="Scorecard" note="settlement truth, not self-reporting">
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          <Metric label="joint win rate" value={scorecard.jointWinRate == null ? "—" : `${scorecard.jointWinRate}%`} sub={scorecard.settledN + scorecard.lostN > 0 ? `${scorecard.settledN} won · ${scorecard.lostN} lost` : "no settled deals"} />
          <Metric label="avg joint cycle" value={scorecard.avgCycleDays == null ? "—" : `${scorecard.avgCycleDays}d`} sub="open → closed-won" />
          <Metric label="sourced" value={money(scorecard.sourcedUsd)} sub="deal-registered" />
          <Metric label="influenced" value={money(scorecard.influencedUsd)} sub="jointly pursued" />
          <Metric label="responsiveness" value={scorecard.responsivenessDays == null ? "—" : scorecard.responsivenessDays < 1 ? "<1d" : `${Math.round(scorecard.responsivenessDays)}d`} sub="proposal → decision" />
          <Metric label="motion win rate" value={scorecard.motionWinRate == null ? "—" : `${scorecard.motionWinRate}%`} sub="our motions together" />
        </div>
      </Section>

      <Section title="Initiatives" note="target vs what the pipeline actually did">
        {initiatives.length === 0 ? (
          <p className="text-sm text-neutral-500">No initiatives on record with this partner.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-label uppercase tracking-wide text-neutral-400">
                <th className="py-1 pr-2 font-semibold">Initiative</th>
                <th className="py-1 pr-2 font-semibold">Period</th>
                <th className="py-1 pr-2 text-right font-semibold">Target</th>
                <th className="py-1 pr-2 text-right font-semibold">Won</th>
                <th className="py-1 pr-2 text-right font-semibold">Registered</th>
                <th className="py-1 pr-2 text-right font-semibold">Lost</th>
                <th className="py-1 text-right font-semibold">Activity</th>
              </tr>
            </thead>
            <tbody>
              {initiatives.map((i) => (
                <tr key={i.id} className="border-t border-neutral-100 dark:border-neutral-800 print:border-neutral-200">
                  <td className="py-1.5 pr-2 font-medium">{i.name}{i.status !== "active" && <span className="ml-1 text-xs text-neutral-400">({i.status})</span>}</td>
                  <td className="py-1.5 pr-2 text-neutral-500">{i.periodLabel ?? "—"}</td>
                  <td className="tnum py-1.5 pr-2 text-right">{i.targetUsd != null ? money(i.targetUsd) : "—"}</td>
                  <td className="tnum py-1.5 pr-2 text-right text-emerald-700 dark:text-emerald-400">{money(i.wonUsd)} ({i.wonN})</td>
                  <td className="tnum py-1.5 pr-2 text-right text-accent dark:text-blue-400">{money(i.openUsd)} ({i.openN})</td>
                  <td className="tnum py-1.5 pr-2 text-right text-neutral-500">{i.lostN > 0 ? `${money(i.lostUsd)} (${i.lostN})` : "—"}</td>
                  <td className="py-1.5 text-right text-neutral-500">{i.motions}m · {i.campaigns}c</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Coverage" note="their book as ingested and matched">
        {book.length === 0 ? (
          <p className="text-sm text-neutral-500">No account lists from this partner yet.</p>
        ) : (
          <ul className="grid gap-1 text-sm md:grid-cols-2">
            {book.map((l) => (
              <li key={l.id} className="flex justify-between gap-2 border-b border-neutral-100 py-1 dark:border-neutral-800 print:border-neutral-200">
                <span>{l.name} <span className="text-xs text-neutral-400">· {l.category}</span></span>
                <span className="tnum text-neutral-500">{l.members} accounts · {l.status}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          Disclosure ladder: {approvedRungs.length > 0 ? `${approvedRungs.join(", ")} approved by both sides` : "not connected — this review shows our side only"}
          {" · "}{openPursuits} open joint pursuit{openPursuits === 1 ? "" : "s"}
          {" · "}{grants.filter((g) => g.status === "accepted").length} shared list{grants.filter((g) => g.status === "accepted").length === 1 ? "" : "s"} in force
        </p>
      </Section>

      {renewals.length > 0 && (
        <Section title="Renewal clock" note="next 180 days on this partner's lists">
          <ul className="text-sm">
            {renewals.map((r) => (
              <li key={r.legal_name} className="flex justify-between gap-2 border-b border-neutral-100 py-1 dark:border-neutral-800 print:border-neutral-200">
                <span>{r.legal_name} <span className="text-xs text-neutral-400">· from “{r.list_name}”</span></span>
                <span className="tnum text-neutral-500">{r.renewal}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {settlement && (
        <Section title="Settlement" note="sourced / influenced, agreed symmetrically">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            {settlement.settled.length} settled statement{settlement.settled.length === 1 ? "" : "s"} on this partnership —
            {" "}{money(scorecard.sourcedUsd)} sourced, {money(scorecard.influencedUsd)} influenced. The same statement is visible to both tenants; neither side can restate it alone.
          </p>
        </Section>
      )}

      {(playbook.positioning || playbook.strengths || playbook.rules) && (
        <Section title="Playbook" note="internal — never shared with the partner">
          <div className="grid gap-3 text-sm md:grid-cols-3">
            {playbook.positioning && <div><p className="mb-0.5 text-xs font-semibold text-neutral-400">Joint positioning</p><p className="text-neutral-600 dark:text-neutral-300">{playbook.positioning}</p></div>}
            {playbook.strengths && <div><p className="mb-0.5 text-xs font-semibold text-neutral-400">Their strengths</p><p className="text-neutral-600 dark:text-neutral-300">{playbook.strengths}</p></div>}
            {playbook.rules && <div><p className="mb-0.5 text-xs font-semibold text-neutral-400">Rules of engagement</p><p className="text-neutral-600 dark:text-neutral-300">{playbook.rules}</p></div>}
          </div>
        </Section>
      )}

      <footer className="mt-8 border-t border-neutral-200 pt-2 text-label text-neutral-400 dark:border-neutral-800 print:border-neutral-300">
        Generated by PursuitOS from the live partnership record. Scorecard figures come from the settlement ledger and motion outcomes; initiative progress from linked opportunities; coverage from ingested partner lists. This document is an output of the work, not a separate chore.
      </footer>
    </main>
  );
}
