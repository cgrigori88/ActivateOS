import { notFound } from "next/navigation";
import { BackLink, Disclosure } from "@/components/ui";
import { withTenant } from "@/lib/db/tenant";
import { pursuitExperienceEnabled } from "@/lib/pursuits/experience-flags";
import { getPursuitDetail } from "@/lib/pursuits/read-models/detail";
import { callerFor } from "@/lib/pursuits/read-models/caller";
import { Panel } from "@/components/pursuit/panel";
import { PursuitHero, PursuitRail, MetricBand, WhyNowBento, FactsBento, MaterialChangeTimeline } from "@/components/pursuit/surfaces";
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
import { experienceEnabledFor, federationEnabledFor, tenantFeatures } from "@/lib/pursuits/tenant-flags";
import { vnextCapabilities } from "@/lib/env/vnext-flags";
import { composePursuitContext } from "@/lib/pursuits/read-models/pursuit-context";
import { PursuitContextNarrative } from "@/components/pursuit/context-narrative";
import { loadContextHealth, loadMissingContext, loadPursuitEvidence, loadPursuitMemory } from "@/lib/pursuits/read-models/context-loaders";
import { loadPursuitPlanView } from "@/lib/pursuits/read-models/plan-loaders";
import { PlanStatusChip, PursuitPlanSurface } from "@/components/pursuit/pursuit-plan";
import { frameApprovedPlan } from "@/lib/pursuits/read-models/pursuit-plan";
import { getPursuitFederation, getGovernedActions, getPursuitOutcomes } from "@/lib/pursuits/federation/read-models";
import { buildFederationViewer } from "@/lib/pursuits/federation/grants";
import { FederationBento } from "@/components/pursuit/federation";
import { StakeholderPanel } from "@/components/pursuit/stakeholders";
import { LifecycleBento } from "@/components/pursuit/lifecycle";
import { ValueCaseCard } from "@/components/pursuit/value-case";
import { RecommendedMotions } from "@/components/pursuit/motions";
import { applyMotionAction } from "./actions";

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
    const outcome = await getPursuitOutcomeSummary(db, orgId, id);
    /**
     * THIN P9 — which reusable commercial motions appear to apply to this account.
     *
     * Read-only and deterministic: evaluating eligibility instantiates NOTHING. It is two bounded
     * statements for every template against this one account, and it contributes nothing to P2 —
     * motion fit answers "does this pattern apply here", which is a different question from "what
     * deserves attention relative to the comparison set".
     */
    const motionFits = await (async () => {
      try {
        const [{ loadMotionTemplates, evaluateMotions }] = await Promise.all([import("@/lib/motions/eligibility")]);
        const templates = await loadMotionTemplates(db);
        if (templates.length === 0) return [];
        return (await evaluateMotions(db, orgId, templates, [detail.accountId], new Date())).get(detail.accountId) ?? [];
      } catch { return []; }   // a malformed template must not take the pursuit page down with it
    })();
    // Motion context (P1A): deterministic linkage only — a motion names this pursuit_id or nothing.
    const motion = (await db.query<{ id: string; status: string; hypothesis: string }>(
      `select m.id, m.status, n.name as hypothesis from revenue_motions m
         join taxonomy_nodes n on n.id = m.taxonomy_node_id
        where m.pursuit_id = $1 and m.org_id = $2 order by m.created_at desc, m.id desc limit 1`, [id, orgId])).rows[0] ?? null;
    let federation = null;
    if (fed) {
      const actions = await getGovernedActions(db, { type: "USER", orgId, role: "operator" }, id);
      const outcomes = await getPursuitOutcomes(db, await buildFederationViewer(db, orgId, id), id);
      federation = { fed, actions, outcomes };
    }
    // Stakeholder assertion candidates (P1C): the account's captured contacts — the governed form
    // only ever offers real people; nothing is synthesized.
    const contacts = (await db.query<{ id: string; name: string | null; title: string | null }>(
      `select id, name, title from contacts where company_id = $1 and org_id = $2
        order by name nulls last, id limit 40`, [detail.accountId, orgId])).rows;

    /* vNext Slice 1 — the composed context narrative. Resolved through
       vnextCapabilities(tenant), which ANDs against the already-resolved tenant
       gate, so a vNext flag can only ever narrow (D-013). Loaded ONLY when
       armed: with the flag off this block runs no queries, so flag-off costs
       nothing and the payload is byte-identical to before. */
    const caller = await callerFor(db, orgId);
    const vnext = vnextCapabilities(await tenantFeatures(db, orgId));
    let pursuitContext = null;
    if (vnext.pursuitIntelligence) {
      const [health, evidence, memory, missing] = await Promise.all([
        loadContextHealth(db, caller, id),
        loadPursuitEvidence(db, caller, id),
        loadPursuitMemory(db, caller, id, { order: "newest", limit: 40 }),
        loadMissingContext(db, caller, id),
      ]);
      pursuitContext = composePursuitContext({
        pursuitId: id, accountLabel: detail.accountLabel,
        whyNow: detail.whyNow, evidence, memory, missingContext: missing, contextHealth: health,
      });
    }
    /* vNext Slice 2A — the Pursuit plan. Same resolver, same narrowing rule; it
       also requires the Slice 1 capability, because a plan's focus and "why" are
       composed from that context. Loaded ONLY when armed: with the flag off this
       issues no query, touches no plan table, and the page is unchanged. */
    const pursuitPlan = vnext.pursuitCoordination ? await loadPursuitPlanView(db, caller, id) : null;
    /* vNext Slice 2B — labelling only: once the approved plan needs review it is framed as the
       CURRENT APPROVED PLAN, so its preserved content is not read as current reality. Nothing is
       rewritten, and with the attention capability off the Slice 2A view passes through untouched. */
    return {
      kind: "sponsor" as const, detail, federation, canDecide, outcome, motion, contacts, pursuitContext, motionFits,
      pursuitPlan: pursuitPlan && vnext.pursuitAttention ? frameApprovedPlan(pursuitPlan) : pursuitPlan,
    };
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
  const pursuitContext = loaded.pursuitContext;
  const r = d.route;
  const recWord = r.recommended?.label ?? "the recommended route";
  // Disclosure-aware Pursuit Brief (F1) — a presentation over the already-authorized detail view.
  const brief = buildPursuitBrief(d, loaded.outcome, loaded.motion);

  /* Wave 2 §10: the five sections a reader actually navigates between, in the
     order the page tells its story. Each points at an anchor that already
     existed, so Today's deep links, the Brief and ⌘K keep working unchanged.
     Conditional sections drop out of the nav rather than dead-linking. */
  const sections = [
    { href: "#overview", label: "Overview" },
    ...(d.valueCase ? [{ href: "#value", label: "Economics" }] : []),
    { href: "#evidence", label: "Evidence" },
    { href: "#route", label: "Route & team" },
    { href: "#activity", label: "Activity" },
  ];

  /* Why Now (carries unknowns + contradictions) + lifecycle timing (P2A).
     `#whynow` is the deep-link anchor from Today, the horizon and ⌘K. */
  /* vNext: the composed surface spans BOTH desktop columns. As a
     half-width card it stood 1,068px tall beside a 475px Value case and
     left 593px of dead space below the fold; full width it lays its
     evidence and open questions side by side and the row closes.
     Flag OFF keeps the original half-width Why Now exactly as it was. */
  const whyNowSection = (
        <div id="whynow" className={pursuitContext ? "order-2 scroll-mt-16 lg:order-2 lg:col-span-2" : "order-2 scroll-mt-16 lg:order-2"}>
        {/* ONE narrative in place of Why Now + Facts + What changed. It carries
            the #evidence and #activity anchors internally so Today's deep links,
            the rail and ⌘K keep resolving after the collapse. */}
        {pursuitContext ? (
          <Panel title="What matters now" hint="Why it matters, what we know, and what still needs attention" accent="var(--color-priority)">
            <PursuitContextNarrative
              context={pursuitContext}
              lifecycleSlot={<LifecycleBento events={d.whyNow.lifecycle} />}
            />
          </Panel>
        ) : (
        <Panel eyebrow="Assembled from the fact & signal graph — traceable" title="Why now" accent="var(--color-priority)">
          <WhyNowBento w={d.whyNow} />
          <div className="mt-3 border-t border-neutral-200/70 pt-2.5 dark:border-neutral-800">
            <span className="text-micro font-bold uppercase tracking-[0.05em] text-neutral-400">Lifecycle timing</span>
            <div className="mt-1"><LifecycleBento events={d.whyNow.lifecycle} /></div>
          </div>
        </Panel>
        )}
        </div>
  );

  /* vNext Slice 2A — Pursuit plan: goal → plan → motion → next action,
     immediately beneath "What matters now" and full width like it. Same order
     slot, so it follows the context on desktop and mobile without moving any
     other panel. Null with the flag off. */
  const motionSection = loaded.kind === "sponsor" && loaded.motionFits?.length ? (
    <div id="motions" className="order-2 scroll-mt-16 lg:col-span-2">
      <Panel eyebrow="Reusable commercial patterns, matched against what we hold"
        title="Recommended motions" accent="var(--color-route)">
        <RecommendedMotions fits={loaded.motionFits} pursuitId={d.pursuitId} apply={applyMotionAction} />
      </Panel>
    </div>
  ) : null;

  const planSection = loaded.pursuitPlan ? (
          <div id="plan" className="order-2 scroll-mt-16 lg:order-2 lg:col-span-2">
            <Panel title="Pursuit plan" hint="What we are trying to achieve, and the next move" accent="var(--color-readiness)"
              aside={<PlanStatusChip view={loaded.pursuitPlan} />}>
              <PursuitPlanSurface view={loaded.pursuitPlan} pursuitId={d.pursuitId} canDecide={loaded.canDecide} />
            </Panel>
          </div>
  ) : null;

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <BackLink href="/pursuits" label="Pursuits" />
        <div className="flex items-center gap-2.5">
          {d.demoBanner && <SyntheticBadge text="Demo environment" />}
          <PursuitBriefButton brief={brief} />
        </div>
      </div>

      <PursuitRail d={d} lifecycleWord={LIFECYCLE_WORD[d.lifecycle] ?? d.lifecycle} sections={sections} />

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
        <Panel id="overview" className="order-1 scroll-mt-16 lg:order-1 lg:col-span-2">
          <PursuitHero d={d} lifecycleWord={LIFECYCLE_WORD[d.lifecycle] ?? d.lifecycle} />
          {/* Motion context strip (P1A) — which commercial hypothesis this pursuit serves. */}
          {loaded.motion && (
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-label">
              <span className="font-bold uppercase tracking-[0.04em] text-neutral-400">Serving</span>
              <a href="/motions" className="font-semibold hover:underline" style={{ color: "var(--color-priority)" }}>{loaded.motion.hypothesis}</a>
              <span className="rounded-full px-2 py-px text-micro font-semibold" style={{ background: "var(--surface-inset)" }}>motion {loaded.motion.status}</span>
            </div>
          )}
          {/* Multi-org ribbon — federation reads before the reader scrolls to the panel */}
          {federation && federation.fed.participants.length > 1 && (
            <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-control px-3 py-2 text-label"
              style={{ background: "color-mix(in srgb, var(--color-route) 6%, var(--surface-primary))", boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-route) 22%, transparent)" }}>
              <span className="font-bold uppercase tracking-[0.04em]" style={{ color: "var(--color-route)" }}>Shared pursuit</span>
              <span className="text-neutral-500">{federation.fed.participants.length} organizations · disclosure decided server-side</span>
              <span className="flex flex-wrap items-center gap-1.5">
                {federation.fed.participants.map((p, i) => (
                  <span key={i} className="rounded-full px-2 py-px text-micro font-semibold" style={{ background: "var(--surface-inset)", color: "var(--text-primary, inherit)" }}>
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

        {/* Why Now / What matters now, then — only when armed — the Pursuit plan.
            A ternary, not `plan && …`: a `&&` child leaves a null in the
            serialized tree with the flag off, so the flag-OFF payload would no
            longer match the pre-slice page byte for byte (U-16). */}
        {planSection ? <>{whyNowSection}{planSection}</> : whyNowSection}
        {motionSection}

        {/* Value Case (P2B §12) — economics on the Pursuit, not in a room of its own. `#value` is
            the deep-link anchor from Today, the Brief and ⌘K. */}
        {d.valueCase && (
          <div id="value" className="order-2 scroll-mt-16 lg:order-3">
            <Panel eyebrow="What is at stake, and what supports it" title="Value case" accent="var(--color-readiness)">
              <ValueCaseCard vc={d.valueCase} />
            </Panel>
          </div>
        )}

        {/* Route decision — recommended + human selection above the dense compare. `#route` is the
            Today deep-link anchor; scroll-mt keeps it clear of the sticky chrome. The governed
            decision control (RouteDecision) is the first human governed mutation in the platform. */}
        <div id="route" className="order-3 scroll-mt-16 lg:order-5 lg:col-span-2">
        <Panel eyebrow="Recommendation is not selection" title="Route decision" accent="var(--color-route)"
          aside={r.changeEvents.length > 0 ? (
            <span className="inline-flex flex-wrap items-center gap-1.5 text-label">
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
            {/* Wave 2 §15: the five-dimension candidate matrix is how you CHECK the
                recommendation, not how you read it. Permanently open it added ~250px
                of table between the decision and the disclosure moment that explains
                it — so the page's most important interaction sat below the fold behind
                a grid most readers scrolled past. The insight line above already states
                what the comparison concludes; this is the working underneath it, one
                click away and never more. */}
            <Disclosure summary="Compare all routes, dimension by dimension">
              <RouteCandidateTable view={r} />
            </Disclosure>
          </div>
        </Panel>
        </div>

        {/* Why (disclosure split) — the centerpiece */}
        {r.recommended && (
          <Panel eyebrow="Enforced server-side, not in the browser" title={`Why ${recWord}`} accent="var(--color-band-high)" className="order-4 lg:order-6 lg:col-span-2">
            {/* The toggle IS the explanation — a reader who flips it sees the
                confidential line disappear. The mechanism behind that goes in
                disclosure, below the thing it describes, so the demo moment is
                the first thing on the panel rather than the fourth line of a
                paragraph about it. */}
            <DisclosureTheater internal={r.recommended.reasonsInternal} shareable={r.recommended.reasonsShareable} candidateLabel={r.recommended.label} />
            <Disclosure summary="How this works" className="mt-3.5">
              What a partner may see is decided in the read model, before it reaches a screen. The
              confidential figure is never serialized into the shareable payload — the browser is not
              trusted to hide it.
            </Disclosure>
          </Panel>
        )}

        {/* Pursuit team — the Multi-Party Execution Plan. `#team` is the Today deep-link anchor for a
            "waiting on this participant" item. Governed confirm/accept lives inline (operators only). */}
        <div id="team" className="order-5 scroll-mt-16 lg:order-7">
        <Panel title="Pursuit team" accent="var(--color-readiness)"
          aside={<span className="inline-flex items-center gap-1.5 text-label text-neutral-500">Readiness <BandPill band={d.team.activationReadiness.band} /></span>}>
          <ExecutionPlan team={d.team} pursuitId={d.pursuitId} canDecide={loaded.canDecide} />
        </Panel>
        </div>

        {/* Stakeholder Intelligence (P1C) — coverage and missing roles, never an address book.
            `#stakeholders` is the deep-link anchor from Today, Motion overlays and constraint remedies. */}
        {d.stakeholders && (
          <div id="stakeholders" className="order-5 scroll-mt-16 lg:order-7">
            <Panel eyebrow="Roles and coverage — verified ≠ inferred ≠ unverified" title="Stakeholders" accent="var(--color-accent-violet)">
              <StakeholderPanel c={d.stakeholders} pursuitId={d.pursuitId} accountLabel={d.accountLabel} canDecide={loaded.canDecide} contacts={loaded.contacts} />
            </Panel>
          </div>
        )}

        {/* Facts / evidence — the verification layer. `#evidence` is the section anchor. */}
        {!pursuitContext && (
          <Panel id="evidence" eyebrow="Trusted intelligence" title="Facts behind this" accent="var(--color-evidence)" tint className="order-6 scroll-mt-16 lg:order-4 lg:col-span-2">
            <FactsBento facts={d.facts} />
          </Panel>
        )}

        {/* Material changes — `#activity` anchors the last section of the rail. */}
        {!pursuitContext && (
          <Panel id="activity" eyebrow="Material events only" title="What changed" accent="var(--color-accent-violet)" className="order-7 scroll-mt-16 lg:order-8">
            <MaterialChangeTimeline timeline={d.timeline} />
          </Panel>
        )}

        {/* Outcome & attribution — the learning half (Phase B). Only when an outcome exists.

            Its desktop row partner depends on the flag, and the panel itself is
            untouched either way. Flag OFF it pairs with "What changed" at
            order-8, as it always has. Flag ON that panel no longer exists, so it
            would sit alone at half width — and so would Value case, once the
            composed surface takes a full-width row of its own. Pairing the two
            leftovers closes both gaps and reads coherently: what is at stake,
            beside what happened and who moved it. */}
        {loaded.outcome.latest && (
          <Panel eyebrow="What happened ≠ who moved it" title="Outcome & attribution" accent="var(--color-accent-verified)"
            className={pursuitContext ? "order-8 lg:order-3" : "order-8 lg:order-8"}>
            <OutcomePanel summary={loaded.outcome} />
          </Panel>
        )}

        {/* Federation — participants, shared context, governed actions, outcome trail (disclosure-safe) */}
        {federation && (
          <Panel eyebrow="One pursuit, many organizations — disclosure decided server-side" title="Federation" accent="var(--color-route)" className="order-9 lg:order-9 lg:col-span-2">
            <FederationBento fed={federation.fed} actions={federation.actions} outcomes={federation.outcomes} />
          </Panel>
        )}
      </div>
    </div>
  );
}
