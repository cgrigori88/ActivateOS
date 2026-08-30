import { notFound } from "next/navigation";
import { PageHeader, BackLink } from "@/components/ui";
import { BandPill, ScoreTile, TrustTag, SyntheticBadge } from "@/components/pursuit/parts";
import { withTenant } from "@/lib/db/tenant";
import { pursuitExperienceEnabled } from "@/lib/pursuits/experience-flags";
import { getPursuitDetail } from "@/lib/pursuits/read-models/detail";
import { callerFor } from "@/lib/pursuits/read-models/caller";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Pursuit detail — the hero decision surface (Workstream D, §4-15). Decision band, structured
 * Why Now (traceable, missing-stays-missing), route decision (disclosure-filtered by the read
 * model), team + readiness, material What-Changed. The page renders view objects only — it never
 * recomputes a score, and it only ever receives what the caller is permitted to see.
 */
export default async function PursuitDetail({ params }: { params: Promise<{ id: string }> }) {
  if (!pursuitExperienceEnabled()) notFound();
  const { id } = await params;
  const d = await withTenant(async (db, orgId) => getPursuitDetail(db, await callerFor(db, orgId), id));
  if (!d) notFound();
  const r = d.route;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <BackLink href="/pursuits" label="Pursuits" />
      {d.demoBanner && <div className="mb-3 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300">{d.demoBanner}</div>}
      <PageHeader title={d.thesis} subtitle={`${d.accountLabel}${d.solution ? ` · ${d.solution}` : ""} · ${d.lifecycle}`} />

      {/* Decision band */}
      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-slate-100 dark:bg-slate-800 sm:grid-cols-3 lg:grid-cols-6">
        {d.decisionBand.map((s) => <div key={s.key} className="bg-white dark:bg-slate-900"><ScoreTile s={s} /></div>)}
      </div>

      {/* Why Now */}
      <section className="mt-4 rounded-2xl border bg-white p-4 dark:bg-slate-900">
        <h2 className="text-sm font-bold">Why now <span className="ml-2 text-xs font-normal text-slate-500">Assembled from the fact &amp; signal graph — traceable</span></h2>
        {!d.whyNow.present ? (
          <p className="mt-2 text-sm italic text-slate-500">No structured Why Now assembled yet.</p>
        ) : (
          <div className="mt-3 grid gap-2">
            {([d.whyNow.businessTrigger, d.whyNow.technologyCondition, d.whyNow.timingAnchor, d.whyNow.signalConvergence, d.whyNow.routeRelevance].filter(Boolean)).map((c, i) => (
              <div key={i} className="grid grid-cols-[130px_1fr] gap-3 border-t border-slate-100 py-2 first:border-0 dark:border-slate-800">
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">{c!.label}</div>
                <div>
                  <div className="font-semibold">{c!.detail ?? <span className="italic text-slate-400">Not established</span>}</div>
                  {c!.commercialImplication && <div className="text-xs text-slate-500">{c!.commercialImplication}</div>}
                  {c!.refId && <div className="mt-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400">↳ traceable to source</div>}
                </div>
              </div>
            ))}
            {d.whyNow.timingAnchor === null && <div className="grid grid-cols-[130px_1fr] gap-3 border-t border-slate-100 py-2 dark:border-slate-800"><div className="text-xs font-semibold text-slate-600 dark:text-slate-300">Timing anchor</div><div className="italic text-slate-400">Not yet established</div></div>}
          </div>
        )}
        {d.whyNow.contradictions.length > 0 && (
          <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm dark:border-rose-900 dark:bg-rose-950/40">
            <b className="text-rose-600">Conflicting evidence.</b> {d.whyNow.contradictions.map((c) => c.text).join("; ")}. Understand the uncertainty before acting.
          </div>
        )}
        {d.whyNow.unknowns.length > 0 && (
          <div className="mt-3 rounded-xl border border-dashed bg-slate-50 px-3 py-2 dark:bg-slate-950/40">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">What we don&apos;t know yet</div>
            <ul className="mt-1 list-disc pl-4 text-xs text-slate-600 dark:text-slate-300">{d.whyNow.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul>
          </div>
        )}
      </section>

      {/* Route decision */}
      <section className="mt-4 rounded-2xl border bg-white p-4 dark:bg-slate-900">
        <h2 className="text-sm font-bold">Route decision</h2>
        {r.changeEvents.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-900 dark:bg-blue-950/40">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">Recommendation changed</span>
            <span className="font-semibold text-slate-400 line-through">{r.changeEvents.at(-1)!.before}</span>→
            <span className="font-bold text-blue-600 dark:text-blue-400">{r.changeEvents.at(-1)!.after}</span>
            {r.changeEvents.at(-1)!.synthetic && <SyntheticBadge text="synthetic distributor signal" />}
          </div>
        )}
        {r.path.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {r.path.map((p, i) => (<span key={i} className="flex items-center gap-2">
              <span className="rounded-lg border bg-slate-50 px-3 py-1.5 font-semibold dark:bg-slate-800">{p.label} <span className="font-normal text-slate-400">{p.role.charAt(0) + p.role.slice(1).toLowerCase()}</span></span>
              {i < r.path.length - 1 && <span className="text-slate-400">→</span>}</span>))}
          </div>
        )}
        {r.recommended && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <RM k="Route score" v={r.recommended.routeScore.value} band={r.recommended.routeScore.band} />
            <RM k="Route confidence" band={r.recommended.confidence.band} word />
            <RM k="Suitability" v={r.recommended.suitability.value} band={r.recommended.suitability.band} />
            <RM k="Readiness" v={r.recommended.readiness.value} band={r.recommended.readiness.band} />
          </div>
        )}
        {r.selected && !r.selectionMatchesRecommendation && (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40">
            <b className="text-amber-700 dark:text-amber-400">Selected: {r.selected.label}</b> — overriding the recommendation. {r.overrideReason ? `Reason: ${r.overrideReason}` : ""} {r.overrideCategory ? `(${r.overrideCategory.replace(/_/g, " ").toLowerCase()})` : ""}. Original recommendation and ranking preserved.
          </div>
        )}
        {r.alternatives.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs"><thead><tr className="text-left uppercase tracking-wide text-slate-500">
              <th className="px-2 py-1.5">Dimension</th>{[r.recommended, ...r.alternatives].filter(Boolean).slice(0, 4).map((c) => <th key={c!.key} className="px-2 py-1.5">{c!.label}</th>)}
            </tr></thead>
            <tbody>{r.dimensionKeys.map((dim) => (
              <tr key={dim} className="border-t border-slate-100 dark:border-slate-800"><td className="px-2 py-1.5 text-slate-500">{dim.replace(/_/g, " ")}</td>
                {[r.recommended, ...r.alternatives].filter(Boolean).slice(0, 4).map((c) => { const cell = c!.dimensions[dim]; return <td key={c!.key} className="px-2 py-1.5">{cell?.known ? <BandPill band={cell.band} word={cell.label} /> : <span className="text-slate-400">Not available</span>}</td>; })}
              </tr>))}
            </tbody></table>
          </div>
        )}
      </section>

      {/* Team + What Changed + Decisions */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-white p-4 dark:bg-slate-900">
          <h2 className="text-sm font-bold">Pursuit team <span className="ml-2 text-xs font-normal">Readiness <BandPill band={d.team.activationReadiness.band} /></span></h2>
          <div className="mt-3 grid gap-2">
            {d.team.members.map((m, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border bg-slate-50 px-3 py-2 dark:bg-slate-800">
                <div><div className="text-xs font-semibold">{m.role.replace(/_/g, " ").toLowerCase()}</div><div className="text-[11px] text-slate-500">{m.personLabel ?? "—"}</div></div>
                <StatusPill status={m.status} />
              </div>
            ))}
            {d.team.members.length === 0 && <p className="text-sm text-slate-500">No team assembled yet.</p>}
          </div>
          {d.team.missingRequiredRoles.length > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Readiness held — required role(s) not yet accepted: {d.team.missingRequiredRoles.map((x) => x.replace(/_/g, " ").toLowerCase()).join(", ")}.</p>}
        </section>

        <section className="rounded-2xl border bg-white p-4 dark:bg-slate-900">
          <h2 className="text-sm font-bold">What changed <span className="ml-2 text-xs font-normal text-slate-500">Material events only</span></h2>
          <div className="mt-3 grid gap-0">
            {d.timeline.events.map((e, i) => (
              <div key={i} className="grid grid-cols-[14px_1fr] gap-3 border-t border-slate-100 py-2 first:border-0 dark:border-slate-800">
                <span className={`mt-1.5 h-2 w-2 rounded-full ${e.changeType === "CONTRADICTION_DETECTED" ? "bg-rose-500" : "bg-blue-500"}`} />
                <div><div className="text-[11px] text-slate-500">{new Date(e.at).toLocaleString()}</div><div className="text-sm font-semibold">{e.label}{e.synthetic && <> <SyntheticBadge /></>}</div>
                  {e.before && e.after && <div className="text-xs"><span className="text-slate-400 line-through">{e.before}</span> → <span className="font-semibold text-blue-600 dark:text-blue-400">{e.after}</span></div>}</div>
              </div>
            ))}
            {d.timeline.events.length === 0 && <p className="text-sm text-slate-500">No material changes yet.</p>}
          </div>
        </section>
      </div>

      {/* Facts */}
      {d.facts.length > 0 && (
        <section className="mt-4 rounded-2xl border bg-white p-4 dark:bg-slate-900">
          <h2 className="text-sm font-bold">What we know</h2>
          <div className="mt-3 grid gap-2">
            {d.facts.slice(0, 8).map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-3 border-t border-slate-100 py-2 first:border-0 dark:border-slate-800">
                <div className="text-sm">{f.proposition}</div>
                <div className="flex items-center gap-1.5">{f.trust.map((t) => <TrustTag key={t} label={t} />)}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RM({ k, v, band, word }: { k: string; v?: number | null; band: string; word?: boolean }) {
  const cls: Record<string, string> = { very_high: "text-emerald-600 dark:text-emerald-400", high: "text-blue-600 dark:text-blue-400", moderate: "text-amber-600 dark:text-amber-400", low: "text-slate-500", unknown: "text-slate-400" };
  const bandWord: Record<string, string> = { very_high: "Very high", high: "High", moderate: "Moderate", low: "Low", unknown: "Unknown" };
  return <div className="rounded-xl border bg-slate-50 p-3 dark:bg-slate-800"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{k}</div><div className={`mt-1 text-base font-bold ${cls[band] ?? ""}`}>{word ? bandWord[band] : (v ?? "—")}</div></div>;
}
function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = { ACCEPTED: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40", ACTIVE: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40", INVITED: "text-amber-600 bg-amber-50 dark:bg-amber-950/40", RECOMMENDED: "text-slate-500 bg-slate-100 dark:bg-slate-800", DECLINED: "text-rose-600 bg-rose-50 dark:bg-rose-950/40" };
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${map[status] ?? "text-slate-500 bg-slate-100 dark:bg-slate-800"}`}>{status.toLowerCase()}</span>;
}
