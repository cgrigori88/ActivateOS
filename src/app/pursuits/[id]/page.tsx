import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui";
import { withTenant } from "@/lib/db/tenant";
import { pursuitExperienceEnabled } from "@/lib/pursuits/experience-flags";
import { getPursuitDetail } from "@/lib/pursuits/read-models/detail";
import { callerFor } from "@/lib/pursuits/read-models/caller";
import { Panel } from "@/components/pursuit/panel";
import { PursuitHero, MetricBand, WhyNowBento, FactsBento, MaterialChangeTimeline } from "@/components/pursuit/surfaces";
import { RoutePath, RecommendationChange, RouteCandidateTable, RouteComparisonInsight } from "@/components/pursuit/route";
import { RouteDecision } from "@/components/pursuit/route-decision";
import { ExecutionPlan } from "@/components/pursuit/team-decision";
import { PursuitBriefButton } from "@/components/pursuit/pursuit-brief";
import { buildPursuitBrief } from "@/lib/pursuits/read-models/brief";
import { OutcomePanel } from "@/components/pursuit/outcome-panel";
import { getPursuitOutcomeSummary } from "@/lib/pursuits/read-models/outcome-summary";
import { currentRole } from "@/lib/auth/org";
import { DisclosureTheater } from "@/components/pursuit/disclosure-theater";
import { BandPill, SyntheticBadge } from "@/components/pursuit/parts";
import { humanizeText } from "@/components/pursuit/vocab";
import { experienceEnabledFor, federationEnabledFor } from "@/lib/pursuits/tenant-flags";
import { getPursuitFederation, getGovernedActions, getPursuitOutcomes } from "@/lib/pursuits/federation/read-models";
import { buildFederationViewer } from "@/lib/pursuits/federation/grants";
import { FederationBento } from "@/components/pursuit/federation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIFECYCLE_WORD: Record<string, string> = {
  DETECTED: "Detected", QUALIFYING: "Qualifying", ACTIVE: "Active", ROUTING: "Routing",
  COMMITTED: "Committed", WON: "Won", LOST: "Lost", DORMANT: "Dormant",
};

/**
 * Pursuit detail — the executive decision surface (Workstream D / D.5). A bento
 * composition built from the semantic material system: hero → decision band →
 * (Why Now | Facts) → Route decision + disclosure split → (Team | What changed).
 * Renders read-model view objects only — never recomputes a score, and only ever
 * receives what the caller is permitted to see (disclosure is server-side).
 */
export default async function PursuitDetail({ params }: { params: Promise<{ id: string }> }) {
  // Env master is the fast deployment deny; per-tenant enforcement happens below.
  if (!pursuitExperienceEnabled()) notFound();
  const { id } = await params;
  // Server-side per-tenant gate + the detail read, in one tenant transaction. A tenant
  // not enabled for the experience gets notFound() — not a hidden-but-reachable page.
  const loaded = await withTenant(async (db, orgId) => {
    if (!(await experienceEnabledFor(db, orgId))) return null;
    const fed = (await federationEnabledFor(db, orgId)) ? await getPursuitFederation(db, orgId, id) : null;

    // Participant viewer (can see the pursuit as an ACTIVE participant but does NOT own
    // it): render ONLY the disclosure-filtered federation projection — never the
    // sponsor's decision surface. This is the same canonical Pursuit, a different view.
    if (fed && !fed.isSponsor && fed.isParticipant) {
      const actions = await getGovernedActions(db, { type: "USER", orgId, role: "operator" }, id);
      const outcomes = await getPursuitOutcomes(db, await buildFederationViewer(db, orgId, id), id);
      return { kind: "participant" as const, fed, actions, outcomes };
    }

    // Sponsor / owning org: the full D.5 decision surface (+ the federation panel).
    const detail = await getPursuitDetail(db, await callerFor(db, orgId), id);
    if (!detail) return null;
    // Can this caller COMMIT a governed route decision? Operators/owners only — the dispatch
    // boundary re-checks, this only decides whether to render the control (viewers see state).
    const role = await currentRole(db);
    const canDecide = role === "owner" || role === "operator";
    const outcome = await getPursuitOutcomeSummary(db, id);
    // Motion context (P1A): deterministic linkage only — a motion names this pursuit_id or nothing.
    const motion = (await db.query<{ id: string; status: string; hypothesis: string }>(
      `select m.id, m.status, n.name as hypothesis from revenue_motions m
         join taxonomy_nodes n on n.id = m.taxonomy_node_id
        where m.pursuit_id = $1 order by m.created_at desc limit 1`, [id])).rows[0] ?? null;
    let federation = null;
    if (fed) {
      const actions = await getGovernedActions(db, { type: "USER", orgId, role: "operator" }, id);
      const outcomes = await getPursuitOutcomes(db, await buildFederationViewer(db, orgId, id), id);
      federation = { fed, actions, outcomes };
    }
    return { kind: "sponsor" as const, detail, federation, canDecide, outcome, motion };
  });
  if (!loaded) notFound();

  // The participant view: header + the disclosure-safe federation projection only.
  if (loaded.kind === "participant") {
    return (
      <div className="mx-auto max-w-[1240px] px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <BackLink href="/pursuits" label="Pursuits" />
          <SyntheticBadge text="Shared pursuit — participant view" />
        </div>
        <Panel eyebrow="One pursuit, many organizations — disclosure decided server-side" title="Shared pursuit" accent="var(--color-route)">
          <FederationBento fed={loaded.fed} actions={loaded.actions} outcomes={loaded.outcomes} />
        </Panel>
      </div>
    );
  }

  const d = loaded.detail;
  const federation = loaded.federation;
  const r = d.route;
  const recWord = r.recommended?.label ?? "the recommended route";
  // Disclosure-aware Pursuit Brief (F1) — a presentation over the already-authorized detail view.
  const brief = buildPursuitBrief(d, loaded.outcome, loaded.motion);

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <BackLink href="/pursuits" label="Pursuits" />
        <div className="flex items-center gap-2.5">
          {d.demoBanner && <SyntheticBadge text="Demo environment" />}
          <PursuitBriefButton brief={brief} />
        </div>
      </div>

      {/*
        Decision-first composition (D.5 §2/§24). One flow that reorders per
        viewport via `order`: on MOBILE it is a flex column ordered around the
        decision — identity → Why Now (with unknowns) → recommended/selected
        route → why (disclosure) → team → facts → material changes. On DESKTOP
        the same panels flow by `lg:order` into a 2-col grid (hero full · Why
        Now|Facts · route full · disclosure full · team|timeline).
      */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start">
        {/* Identity + decision band */}
        <Panel className="order-1 lg:order-1 lg:col-span-2">
          <PursuitHero d={d} lifecycleWord={LIFECYCLE_WORD[d.lifecycle] ?? d.lifecycle} />
          {/* Motion context strip (P1A) — which commercial hypothesis this pursuit serves. */}
          {loaded.motion && (
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
              <span className="font-bold uppercase tracking-[0.04em] text-neutral-400">Serving</span>
              <a href="/motions" className="font-semibold hover:underline" style={{ color: "var(--color-priority)" }}>{loaded.motion.hypothesis}</a>
              <span className="rounded-full px-2 py-px text-[10.5px] font-semibold" style={{ background: "var(--surface-inset)" }}>motion {loaded.motion.status}</span>
            </div>
          )}
          {/* Multi-org ribbon — federation reads before the reader scrolls to the panel */}
          {federation && federation.fed.participants.length > 1 && (
            <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-control px-3 py-2 text-[11.5px]"
              style={{ background: "color-mix(in srgb, var(--color-route) 6%, var(--surface-primary))", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-route) 22%, transparent)" }}>
              <span className="font-bold uppercase tracking-[0.04em]" style={{ color: "var(--color-route)" }}>Shared pursuit</span>
              <span className="text-neutral-500">{federation.fed.participants.length} organizations · disclosure decided server-side</span>
              <span className="flex flex-wrap items-center gap-1.5">
                {federation.fed.participants.map((p, i) => (
                  <span key={i} className="rounded-full px-2 py-px text-[10.5px] font-semibold" style={{ background: "var(--surface-inset)", color: "var(--text-primary, inherit)" }}>
                    {p.orgName ?? p.roleKey}{p.isSponsor ? " · sponsor" : ""}
                  </span>
                ))}
              </span>
            </div>
          )}
          <div className="mt-5">
            <MetricBand scores={d.decisionBand} />
          </div>
        </Panel>

        {/* Why Now (carries unknowns + contradictions) */}
        <Panel eyebrow="Assembled from the fact & signal graph — traceable" title="Why now" accent="var(--color-priority)" className="order-2 lg:order-2">
          <WhyNowBento w={d.whyNow} />
        </Panel>

        {/* Route decision — recommended + human selection above the dense compare. `#route` is the
            Today deep-link anchor; scroll-mt keeps it clear of the sticky chrome. The governed
            decision control (RouteDecision) is the first human governed mutation in the platform. */}
        <div id="route" className="order-3 scroll-mt-6 lg:order-4 lg:col-span-2">
        <Panel eyebrow="Recommendation is not selection" title="Route decision" accent="var(--color-route)"
          aside={r.changeEvents.length > 0 ? (
            <span className="inline-flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <span className="font-semibold uppercase tracking-[0.03em] text-neutral-400">Changed</span>
              <span className="font-semibold text-neutral-400 line-through">{r.changeEvents.at(-1)!.before ? humanizeText(r.changeEvents.at(-1)!.before!) : "—"}</span>→
              <span className="font-bold" style={{ color: "var(--color-route)" }}>{humanizeText(r.changeEvents.at(-1)!.after ?? "—")}</span>
              {r.changeEvents.at(-1)!.synthetic && <SyntheticBadge text="synthetic signal" />}
            </span>
          ) : undefined}>
          <div className="space-y-4">
            <RoutePath view={r} />
            <RecommendationChange view={r} />
            <RouteDecision view={r} pursuitId={d.pursuitId} canDecide={loaded.canDecide} />
            <RouteComparisonInsight view={r} />
            <RouteCandidateTable view={r} />
          </div>
        </Panel>
        </div>

        {/* Why (disclosure split) — the centerpiece */}
        {r.recommended && (
          <Panel eyebrow="Enforced server-side, not in the browser" title={`Why ${recWord}`} accent="var(--color-band-high)" className="order-4 lg:order-5 lg:col-span-2">
            <p className="mb-3.5 max-w-[80ch] text-[12.5px] text-neutral-500">
              The same recommendation, two audiences. Toggle the audience — what a partner may see is decided in the read model before it reaches a screen, so the confidential figure is never serialized into the shareable payload.
            </p>
            <DisclosureTheater internal={r.recommended.reasonsInternal} shareable={r.recommended.reasonsShareable} candidateLabel={r.recommended.label} />
          </Panel>
        )}

        {/* Pursuit team — the Multi-Party Execution Plan. `#team` is the Today deep-link anchor for a
            "waiting on this participant" item. Governed confirm/accept lives inline (operators only). */}
        <div id="team" className="order-5 scroll-mt-6 lg:order-6">
        <Panel title="Pursuit team" accent="var(--color-readiness)"
          aside={<span className="inline-flex items-center gap-1.5 text-[11.5px] text-neutral-500">Readiness <BandPill band={d.team.activationReadiness.band} /></span>}>
          <ExecutionPlan team={d.team} pursuitId={d.pursuitId} canDecide={loaded.canDecide} />
        </Panel>
        </div>

        {/* Facts / evidence */}
        <Panel eyebrow="Trusted intelligence" title="Facts behind this" accent="var(--color-evidence)" tint className="order-6 lg:order-3">
          <FactsBento facts={d.facts} />
        </Panel>

        {/* Material changes */}
        <Panel eyebrow="Material events only" title="What changed" accent="var(--color-accent-violet)" className="order-7 lg:order-7">
          <MaterialChangeTimeline timeline={d.timeline} />
        </Panel>

        {/* Outcome & attribution — the learning half (Phase B). Only when an outcome exists. */}
        {loaded.outcome.latest && (
          <Panel eyebrow="What happened ≠ who moved it" title="Outcome & attribution" accent="var(--color-accent-verified)" className="order-8 lg:order-9 lg:col-span-2">
            <OutcomePanel summary={loaded.outcome} />
          </Panel>
        )}

        {/* Federation — participants, shared context, governed actions, outcome trail (disclosure-safe) */}
        {federation && (
          <Panel eyebrow="One pursuit, many organizations — disclosure decided server-side" title="Federation" accent="var(--color-route)" className="order-8 lg:order-8 lg:col-span-2">
            <FederationBento fed={federation.fed} actions={federation.actions} outcomes={federation.outcomes} />
          </Panel>
        )}
      </div>
    </div>
  );
}
