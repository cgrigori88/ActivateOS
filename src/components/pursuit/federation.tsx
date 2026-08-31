import { TrustTag } from "./parts";
import type { FederationView, GovernedActionView, OutcomeTrailView } from "@/lib/pursuits/federation/read-models";

/**
 * Federation surface (Workstream E3-H) — native to the D.5 material system. Renders
 * only what the read models already resolved for THIS caller (disclosure is decided
 * server-side): the participant roster, the shared context the viewer may see, the
 * governed actions this actor may take, and the material-outcome trail. It never
 * recomputes and never receives a suppressed value — an omitted item simply isn't here.
 */

const STATE_TONE: Record<string, string> = {
  ACTIVE: "var(--color-band-high)", INVITED: "var(--color-priority)",
  DECLINED: "var(--color-neutral, #9ca3af)", LEFT: "#9ca3af", REVOKED: "#ef4444",
};
const EFFECT_WORD: Record<string, string> = {
  READ: "Read", INTERNAL_WRITE: "Internal", EXTERNAL_ACTION: "External", CROSS_TENANT_ACTION: "Cross-org",
};

export function FederationBento({ fed, actions, outcomes }: {
  fed: FederationView; actions: GovernedActionView; outcomes: OutcomeTrailView | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Participants */}
      <div>
        <div className="mb-2 text-label font-semibold uppercase tracking-[0.04em] text-neutral-400">Participants on this pursuit</div>
        <ul className="flex flex-col gap-1.5">
          {fed.participants.map((p) => (
            <li key={p.orgId} className="flex items-center justify-between gap-3 rounded-md border border-neutral-200/70 bg-white/40 px-3 py-2 dark:border-neutral-700/60 dark:bg-white/5">
              <span className="flex items-center gap-2 text-copy">
                <span className="font-semibold">{p.orgName ?? "Participant org"}</span>
                {p.isSponsor && <TrustTag label="Sponsor" />}
                <span className="text-label text-neutral-500">{p.roleKey}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-label font-medium">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATE_TONE[p.state] ?? "#9ca3af" }} />
                {p.state}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Shared context (already disclosure-filtered) */}
      <div>
        <div className="mb-2 text-label font-semibold uppercase tracking-[0.04em] text-neutral-400">Shared context you may see</div>
        {fed.sharedContext.length === 0 ? (
          <p className="text-body text-neutral-500">No shared context is disclosed to you on this pursuit.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {fed.sharedContext.map((c, i) => (
              <li key={i} className="flex items-start justify-between gap-3 text-body">
                <span className="text-neutral-700 dark:text-neutral-200">{c.value.detail || c.value.label}</span>
                <span className="shrink-0 rounded-full border border-neutral-200/70 px-1.5 py-0.5 text-micro uppercase tracking-[0.03em] text-neutral-400 dark:border-neutral-700/60">{c.visibility}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Governed actions available to this actor */}
      <div>
        <div className="mb-2 text-label font-semibold uppercase tracking-[0.04em] text-neutral-400">Actions you can take</div>
        <div className="flex flex-wrap gap-1.5">
          {actions.eligible.length === 0
            ? <span className="text-body text-neutral-500">No governed actions are available to you here.</span>
            : actions.eligible.map((a) => (
              <span key={a.skillId} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200/70 bg-white/40 px-2 py-1 text-body dark:border-neutral-700/60 dark:bg-white/5" title={a.description}>
                {a.description}
                <span className="rounded-sm bg-neutral-100 px-1 text-micro uppercase tracking-[0.02em] text-neutral-500 dark:bg-white/10">{EFFECT_WORD[a.effectClass] ?? a.effectClass}</span>
              </span>
            ))}
        </div>
        {actions.history.length > 0 && (
          <p className="mt-2 text-label text-neutral-500">
            Last action: <span className="font-medium text-neutral-600 dark:text-neutral-300">{actions.history[0].skillId}</span> — {actions.history[0].status}
          </p>
        )}
      </div>

      {/* Outcome trail */}
      {outcomes && outcomes.outcomes.length > 0 && (
        <div>
          <div className="mb-2 text-label font-semibold uppercase tracking-[0.04em] text-neutral-400">Outcome trail</div>
          <ol className="flex flex-wrap items-center gap-1.5 text-body">
            {outcomes.outcomes.map((o, i) => (
              <li key={i} className="inline-flex items-center gap-1.5">
                <span className={`rounded-md px-2 py-0.5 ${o.isTerminal ? "font-semibold" : ""}`} style={{ background: o.isTerminal ? "var(--color-band-high)" : "var(--color-surface-muted, #f3f4f6)", color: o.isTerminal ? "white" : "inherit" }}>
                  {o.label.replace(/_/g, " ").toLowerCase()}
                  {o.valueAmount !== null && <span className="ml-1 tabular-nums opacity-80">${(o.valueAmount / 1000).toFixed(0)}k</span>}
                </span>
                {i < outcomes.outcomes.length - 1 && <span className="text-neutral-300">→</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
