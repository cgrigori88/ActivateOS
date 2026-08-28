# Opportunity Backlog — Beats & Leaps (from the Aug 2026 competitive scan)

**Purpose.** A workflow-ready distillation of the *Beats* (adopt, adapted) and *Leaps*
(partner-led moves only PursuitOS can make) surfaced across today's four analyses:
**YouSpot**, **Monid/TinyFish**, **Traxy**, and **Comp AI CRM**. Full reasoning lives in
`docs/COMPETITIVE-SCAN-2026-08.md`; this file is the actionable list we'll build a workflow
around **once the open RISKs (RISK-1 cutover, RISK-3 TLS) are closed.**

**Do not start these until the RISK tier is done.** Ordering below is by cost/leverage, not
priority-of-execution; the workflow will sequence them.

Legend — **Effort:** S (hours) · M (days) · L (real engineering, OAuth/DNS/schema).
**Type:** BEAT (adopt) · LEAP (partner-led differentiator). **Src:** which analysis.

---

## Tier 0 — Cheap, high-leverage, no new external surface

| # | Item | Type | Effort | Src | Notes |
|---|------|------|--------|-----|-------|
| O-1 | **Name + surface the "AI-harness + MCP" story** you already have (`askTheRecord`, `/api/mcp`, per-org keys) — a first-class page/positioning, not a buried feature | BEAT | S | YouSpot, Comp AI | Pure surfacing of shipped capability |
| O-2 | **Publish an open `SKILL.md`** for one-line install alongside the MCP connector (viral distribution; keep ecosystem/settlement server-side) | BEAT | S | Monid, Comp AI | MIT-style distribution lever |
| O-3 | **Reason-carrying self-scheduled rechecks** — every routine/refresh recheck attaches + surfaces a human-readable *why* ("back in 14d because renewal < 120d") | BEAT | S | Comp AI | "An agent that can't say why it'll be back has a default, not a reason" |
| O-4 | **Provenance-typed evidence** — add a source-kind dimension priced by trust on top of `computed_confidence` (e.g. `crm.signature-block`, `github.identity`); feeds verification/contradiction layer | BEAT | M | Comp AI | Cleaner than a raw float; don't remove the float, augment it |
| O-5 | **`FOR UPDATE SKIP LOCKED` + lease/expiry** in the worker drain (refresh/routine) so multiple dispatchers claim disjoint work; dead sessions free their rows | BEAT | S | Comp AI | Proven queue pattern; hardens the worker |
| O-6 | **Document the agent sandbox posture** (no `DATABASE_URL` in sandbox, deny-all egress, web tools in app runtime) — enterprise-trust artifact | BEAT | S | Comp AI | Dovetails with RISK-1/RISK-3; a security-officer asset |

## Tier 1 — Cheap, adds a lightweight external touch

| # | Item | Type | Effort | Src | Notes |
|---|------|------|--------|-----|-------|
| O-7 | **`monid` free web search + fetch provider** — route generic research/investigator through it; per-search cost ~$7–8/1k → $0 | BEAT | M | Monid | Keep behind provider abstraction (one interchangeable source); lean on verification layer for noise/longevity risk |
| O-8 | **Free change-monitoring** (website/careers/contract-expiry) via Monid → watch *every* account continuously, not sampled | BEAT | M | Monid | Strengthens the trigger thesis at ~$0 marginal cost |
| O-9 | **Route-on-surface webhooks** — real-time Slack/webhook push the moment a signal fires (lighter/faster than batch writeback) | BEAT | M | Traxy | Easy on the worker |
| O-10 | **On-demand enrichment UX** — "enrich only the segments you'll act on" (cost-controlled; PDL already present) | BEAT | M | Traxy | Cost governance for people-enrichment |
| O-11 | **Unified Feed** — collapse Today/Queue/brief/renewal-radar into one proactive stream with partner-led items | BEAT | M | YouSpot | The "no Sunday-night updating" experience |
| O-12 | **Chat-first front door** — promote `/ask` as a primary entry point | BEAT | S | YouSpot | Positioning + nav |
| O-13 | **Memory + Fact as first-class objects**, distinct from raw evidence | BEAT | M | YouSpot | Second-brain framing |

## Tier 2 — Real engineering, highest payoff (the recurring GAP)

| # | Item | Type | Effort | Src | Notes |
|---|------|------|--------|-----|-------|
| O-14 | **Interaction-capture layer** — email/calendar (YouSpot), LinkedIn engagement (Traxy/YouSpot), X. Person-level, real-time engagement data PursuitOS does not yet capture | BEAT (enabling) | L | YouSpot, Traxy | Needs OAuth/DNS (currently parked). Unlocks O-15, O-16, and self-building context |
| O-15 | **Engagement-signal prospecting** — person-level "who's in-market this hour" from monitored partner/vendor/competitor communities (builds on O-14) | BEAT | L | Traxy | Adds a person-level intent axis to our company/firmographic/event signals |

## Tier 3 — LEAPS: partner-led moves a single-seller tool structurally cannot make

| # | Item | Type | Effort | Src | Notes |
|---|------|------|--------|-----|-------|
| O-16 | **Ecosystem engagement signals** — watch the JOINT book across BOTH partners' networks, consent-gated (extends O-14/O-15 to the partnership) | LEAP | L | Traxy | A single-seller tool sees one side only |
| O-17 | **Multi-player second brain** — the entity graph (accounts ↔ partners ↔ motions ↔ opportunities ↔ evidence) shared across a partnership, consent-gated | LEAP | M | YouSpot | Name + surface the ecosystem graph centered on the org |
| O-18 | **Cloud agents that act across the partnership** — broker warm intros / co-sell / evidence exchange (extends the agent surface already started) | LEAP | L | YouSpot | Multi-tenant agency |
| O-19 | **Signal → multi-vendor play, not just a lead** — hand over the lead *plus* which partners to co-sell with *plus* the play | LEAP | M | Traxy | Ecosystem routing on top of a signal |
| O-20 | **Attribution proof as product** — settlement ledger + outcome learning prove "this signal sourced/influenced this *closed* co-sell deal"; ship as a **built-in split-test** ("our leads vs. your source") wedge | LEAP | M | Traxy | Proves signal quality at closed-revenue level — a claim single-seller tools can't make |
| O-21 | **Partner-led PLG** — a guest-seat invite lands an entire partner *network* from one invite (already have guest seats v1; extend the viral loop) | LEAP | M | YouSpot | Contrast: a $1 solo motion lands one person |
| O-22 | **"We watch every account in the joint book, continuously"** — abundant-research substrate (O-7/O-8) applied across the partnership at near-zero marginal cost | LEAP | M | Monid | Positioning + capability combination |

---

## The wedge (keep sharpening — the throughline of all four)

> *"The most credible CRM builders all shipped my architecture — each for a market I don't
> serve. YouSpot took the solo floor; the enterprise suites own the ceiling; Comp AI, the
> most principled agentic-CRM engineers in open source, deliberately threw out multi-tenancy
> because they'll never broker a deal between two of their customers. I own the one primitive
> they all optimized away: partner-led, cross-tenant revenue — consent, verified evidence,
> and settlement."*

**Recurring GAP** (build once, unlocks O-15/O-16/O-17): the **interaction-capture layer** (O-14).
**Recurring MOAT** (defend + market): cross-tenant ecosystem + consent ladder + verified
evidence + co-sell settlement. Every commoditization event (free models, free search,
everyone's AI-harness, open-source single-tenant CRMs) makes this layer *relatively more*
valuable.

---

## Gate

**Blocked on:** RISK-1 (`app_rw` cutover) and RISK-3 (TLS verify-full + password rotation).
See `audit/RISK-1-rls-enforcement-TDD.md` and `audit/enterprise-risk-ledger.md`. Build the
workflow around this backlog only after those close.
