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

      {/* Hero + decision band */}
      <Panel className="mb-4">
        <PursuitHero d={d} lifecycleWord={LIFECYCLE_WORD[d.lifecycle] ?? d.lifecycle} />
        <div className="mt-5">
          <MetricBand scores={d.decisionBand} />
        </div>
      </Panel>

      {/* Why Now | Facts */}
      <div className="mb-4 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Panel eyebrow="Assembled from the fact & signal graph — traceable" title="Why now" accent="var(--color-priority)">
          <WhyNowBento w={d.whyNow} />
        </Panel>
        <Panel eyebrow="Trusted intelligence" title="Facts behind this" accent="var(--color-evidence)" tint>
          <FactsBento facts={d.facts} />
        </Panel>
      </div>

      {/* Route decision */}
      <Panel eyebrow="Recommendation is not selection" title="Route decision" accent="var(--color-route)" className="mb-4"
        aside={r.changeEvents.length > 0 ? (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="font-semibold uppercase tracking-[0.03em] text-neutral-400">Changed</span>
            <span className="font-semibold text-neutral-400 line-through">{r.changeEvents.at(-1)!.before ?? "—"}</span>→
            <span className="font-bold" style={{ color: "var(--color-route)" }}>{r.changeEvents.at(-1)!.after}</span>
            {r.changeEvents.at(-1)!.synthetic && <SyntheticBadge text="synthetic signal" />}
          </span>
        ) : undefined}>
        <div className="space-y-4">
          <RoutePath view={r} />
          <RecommendationChange view={r} />
          <RouteCandidateTable view={r} />
        </div>
      </Panel>

      {/* Disclosure split — the centerpiece */}
      {r.recommended && (
        <Panel eyebrow="Enforced server-side, not in the browser" title={`Why ${recWord}`} accent="var(--color-band-high)" className="mb-4">
          <p className="mb-3.5 max-w-[80ch] text-[12.5px] text-neutral-500">
            The same recommendation, two audiences. What a partner may see is decided in the read model before it reaches a screen — the confidential figure is never serialized into the shareable payload.
          </p>
          <DisclosureSplit candidate={r.recommended} />
        </Panel>
      )}

      {/* Team | What changed */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Pursuit team" accent="var(--color-readiness)"
          aside={<span className="inline-flex items-center gap-1.5 text-[11.5px] text-neutral-500">Readiness <BandPill band={d.team.activationReadiness.band} /></span>}>
          <TeamBento team={d.team} />
        </Panel>
        <Panel eyebrow="Material events only" title="What changed" accent="var(--color-accent-violet)">
          <MaterialChangeTimeline timeline={d.timeline} />
        </Panel>
      </div>
    </div>
  );
}
