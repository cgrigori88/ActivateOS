import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui";
import { withTenant } from "@/lib/db/tenant";
import { pursuitExperienceEnabled } from "@/lib/pursuits/experience-flags";
import { getPursuitDetail } from "@/lib/pursuits/read-models/detail";
import { callerFor } from "@/lib/pursuits/read-models/caller";
import { Panel } from "@/components/pursuit/panel";
import { PursuitHero, MetricBand, WhyNowBento, FactsBento, TeamBento, MaterialChangeTimeline } from "@/components/pursuit/surfaces";
import { RoutePath, RecommendationChange, RouteCandidateTable, DisclosureSplit } from "@/components/pursuit/route";
import { BandPill, SyntheticBadge } from "@/components/pursuit/parts";
import { humanizeText } from "@/components/pursuit/vocab";

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
  if (!pursuitExperienceEnabled()) notFound();
  const { id } = await params;
  const d = await withTenant(async (db, orgId) => getPursuitDetail(db, await callerFor(db, orgId), id));
  if (!d) notFound();
  const r = d.route;
  const recWord = r.recommended?.label ?? "the recommended route";

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <BackLink href="/pursuits" label="Pursuits" />
        {d.demoBanner && <SyntheticBadge text="Demo environment" />}
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
          <div className="mt-5">
            <MetricBand scores={d.decisionBand} />
          </div>
        </Panel>

        {/* Why Now (carries unknowns + contradictions) */}
        <Panel eyebrow="Assembled from the fact & signal graph — traceable" title="Why now" accent="var(--color-priority)" className="order-2 lg:order-2">
          <WhyNowBento w={d.whyNow} />
        </Panel>

        {/* Route decision — recommended + human selection above the dense compare */}
        <Panel eyebrow="Recommendation is not selection" title="Route decision" accent="var(--color-route)" className="order-3 lg:order-4 lg:col-span-2"
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
            <RouteCandidateTable view={r} />
          </div>
        </Panel>

        {/* Why (disclosure split) — the centerpiece */}
        {r.recommended && (
          <Panel eyebrow="Enforced server-side, not in the browser" title={`Why ${recWord}`} accent="var(--color-band-high)" className="order-4 lg:order-5 lg:col-span-2">
            <p className="mb-3.5 max-w-[80ch] text-[12.5px] text-neutral-500">
              The same recommendation, two audiences. What a partner may see is decided in the read model before it reaches a screen — the confidential figure is never serialized into the shareable payload.
            </p>
            <DisclosureSplit candidate={r.recommended} />
          </Panel>
        )}

        {/* Team readiness */}
        <Panel title="Pursuit team" accent="var(--color-readiness)" className="order-5 lg:order-6"
          aside={<span className="inline-flex items-center gap-1.5 text-[11.5px] text-neutral-500">Readiness <BandPill band={d.team.activationReadiness.band} /></span>}>
          <TeamBento team={d.team} />
        </Panel>

        {/* Facts / evidence */}
        <Panel eyebrow="Trusted intelligence" title="Facts behind this" accent="var(--color-evidence)" tint className="order-6 lg:order-3">
          <FactsBento facts={d.facts} />
        </Panel>

        {/* Material changes */}
        <Panel eyebrow="Material events only" title="What changed" accent="var(--color-accent-violet)" className="order-7 lg:order-7">
          <MaterialChangeTimeline timeline={d.timeline} />
        </Panel>
      </div>
    </div>
  );
}
