# PursuitOS — Roadmap Opportunities (expanded, with descriptions & value)

> **Purpose.** The 22 opportunities from the Aug-2026 competitive scan
> (`docs/COMPETITIVE-SCAN-2026-08.md`), each written out in full: **what it is,
> what it does, and why it matters** — so a planning/execution agent can scope,
> sequence, and estimate them without going back to the source titles.
>
> **Gate status:** these were gated behind the enterprise RISK tier (RISK-1 RLS
> cutover, RISK-3 TLS). **That tier is now CLOSED in production** — so every item
> here is unblocked. Ordering below is by cost/leverage, not mandatory sequence.
>
> **Legend — Effort:** S (hours) · M (days) · L (real engineering: OAuth/DNS/schema).
> **Type:** BEAT (adopt a competitor's good idea, adapted to partner-led) ·
> LEAP (a partner-led move a single-seller tool structurally cannot copy).
> **Source:** which scanned product inspired it.
>
> _Terms used below (Motion, blind overlap, joint pursuit, settlement ledger, EQL,
> evidence, propensity, MCP, BYO-model, guest seat) are defined in
> `docs/PLATFORM-CAPABILITIES.md` §9.1._

---

## Tier 0 — Cheap, high-leverage, no new external surface

### O-1 · Name & surface the "AI-harness + MCP" story — BEAT · S · (YouSpot, Comp AI)
- **What it is.** A first-class product narrative and UI surface for capabilities
  PursuitOS *already ships* but buries: the tool-using agent over the record
  (`askTheRecord`), the MCP server, and per-org agent keys.
- **What it does.** Elevates them from hidden features into a named story — a
  landing section / positioning line / an in-app surface that says "this is an AI
  harness with revenue tools inside, and your own agent can drive it."
- **Why it matters.** Competitors (YouSpot, Comp AI) win attention with exactly
  this framing while PursuitOS has the substance and stays quiet. Pure packaging of
  shipped capability → near-zero cost, disproportionate positioning payoff with the
  AI-native buyer. No code beyond copy/surfacing.

### O-2 · Publish an open `SKILL.md` for one-line agent install — BEAT · S · (Monid, Comp AI)
- **What it is.** A public, versioned `SKILL.md` (agent-install manifest) that lets
  any agent connect to a PursuitOS tenant's MCP server in one line.
- **What it does.** Turns "integrate our API" into "paste this URL into your agent."
  Distribution mechanic that rides the MCP server already built.
- **Why it matters.** Viral, low-friction install is how Monid and Comp AI seed
  adoption. Keeps the ecosystem/settlement moat server-side and closed while making
  the *entry* frictionless. Cheap growth lever.

### O-3 · Reason-carrying self-scheduled rechecks — BEAT · S · (Comp AI)
- **What it is.** Every routine/refresh recheck the system schedules for itself
  carries a human-readable **reason**, surfaced in the UI.
- **What it does.** Instead of "next refresh in 14 days," it says "re-checking in
  14 days because the renewal is <120 days out." Attaches and displays a *why* on
  each self-scheduled job.
- **Why it matters.** Comp AI's principle: "an agent that can't say why it'll be
  back has a default, not a reason." Turns opaque automation into legible,
  trustworthy automation — a trust/credibility win at trivial cost, building on the
  existing routines + refresh runner.

### O-4 · Provenance-typed evidence — BEAT · M · (Comp AI)
- **What it is.** A source-*kind* dimension on evidence (e.g. `crm.signature-block`,
  `github.identity`, `sec.filing`), priced by trust, layered on top of the existing
  numeric `computed_confidence`.
- **What it does.** Records not just *how confident* a claim is but *what kind of
  source* it came from, and weights trust by source type — feeding the
  verification/contradiction layer with better signal.
- **Why it matters.** Comp AI's insight: "a confidently wrong fact is worse than a
  blank field." A typed-provenance model is more defensible and auditable than a raw
  float; it sharpens the evidence engine that's already a differentiator. Don't
  remove the float — augment it.

### O-5 · `FOR UPDATE SKIP LOCKED` lease queue in the worker drain — BEAT · S · (Comp AI)
- **What it is.** Refactor the worker's refresh/routine job pickup to claim work
  with `SELECT … FOR UPDATE SKIP LOCKED` plus a lease/expiry.
- **What it does.** Lets multiple worker dispatchers claim *disjoint* jobs safely in
  parallel; a dead worker's leased rows free themselves on expiry.
- **Why it matters.** A proven, crisp concurrency pattern that hardens the worker
  against double-processing and stuck jobs as volume grows — cheap reliability
  insurance on infrastructure already in place.

### O-6 · Document the agent sandbox posture — BEAT · S · (Comp AI)
- **What it is.** A written, publishable security note describing the agent
  execution posture: no `DATABASE_URL` in any sandbox, deny-all egress, network
  tools run in the app runtime not the sandbox.
- **What it does.** Produces an artifact a security reviewer can read — the "a shell
  with credentials and egress is exfiltration-shaped; a shell with neither is a text
  processor" framing.
- **Why it matters.** Directly strengthens enterprise-trust conversations (dovetails
  with the RISK-1/RISK-3 work already done). Cheap, and it's exactly what a CISO
  wants to see when you're handing agents access.

---

## Tier 1 — Cheap, adds a lightweight external touch

### O-7 · `monid` free web-search + fetch provider — BEAT · M · (Monid)
- **What it is.** A new intelligence provider wrapping Monid/TinyFish's free live
  web search + URL→Markdown fetch, slotted behind the existing provider abstraction.
- **What it does.** Routes generic research/investigator queries through it, so
  per-search cost drops from ~$7–8 / 1k (SerpAPI/Tavily-class) toward **$0**.
- **Why it matters.** Real margin plus the freedom to research *broadly* instead of
  sampling under quota anxiety. Because the provider architecture is normalized, it's
  a small adapter. Keep it one interchangeable source and lean on the verification
  layer for noise/longevity risk (young vendor).

### O-8 · Free continuous change-monitoring (via Monid) — BEAT · M · (Monid)
- **What it is.** Use Monid's free change-monitoring to watch website/careers/
  contract-expiry signals across accounts continuously.
- **What it does.** Moves account monitoring from *sampled* to *every account, all
  the time* at near-zero marginal cost.
- **Why it matters.** Strengthens the whole trigger thesis (time-to-event relevance,
  renewal radar) — you catch changes as they happen rather than on a refresh
  cadence. Compounds with O-7.

### O-9 · Route-on-surface webhooks — BEAT · M · (Traxy)
- **What it is.** A real-time push (Slack / generic webhook) the moment a signal
  fires, distinct from the batch CRM-writeback path.
- **What it does.** When something important happens on an account, it hits the
  user's Slack/tooling immediately instead of waiting for the next batch.
- **Why it matters.** Speed-to-signal is a core Traxy selling point ("first intro in
  30 min"). Lightweight on the worker, and it makes the platform feel alive/reactive
  rather than reporting-after-the-fact.

### O-10 · On-demand enrichment UX ("enrich only what you'll act on") — BEAT · M · (Traxy)
- **What it is.** A cost-controlled enrichment flow where the user chooses which
  segments/accounts to enrich (PDL people-enrichment already exists underneath).
- **What it does.** Instead of enriching everything (cost) or nothing (blind spots),
  the user spends enrichment budget deliberately on what they'll pursue.
- **Why it matters.** Traxy's "auto-enrich the segments you choose" is a clean cost-
  governance UX. Puts spend under user control and improves unit economics.

### O-11 · Unified Feed — BEAT · M · (YouSpot)
- **What it is.** Collapse Today / Queue / morning brief / renewal-radar into one
  proactive stream, with partner-led items woven in.
- **What it does.** One place that answers "what deserves my attention right now,"
  including cross-partner items — the "no Sunday-night updating" experience.
- **Why it matters.** YouSpot's self-building second-brain feel comes largely from a
  single proactive surface. PursuitOS has all the inputs already; this is
  consolidation + presentation, high perceived value.

### O-12 · Chat-first front door (promote `/ask`) — BEAT · S · (YouSpot)
- **What it is.** Elevate the existing `Ask` room to a primary entry point / front
  door to the whole platform.
- **What it does.** Lets a user start with a question in natural language rather than
  navigating rooms — the agent answers from the record with tools.
- **Why it matters.** Matches the AI-native expectation that you *talk* to your
  system. `askTheRecord` already exists; this is positioning + navigation, cheap.

### O-13 · Memory + Fact as first-class objects — BEAT · M · (YouSpot)
- **What it is.** Distinguish durable **Memory / Fact** objects from raw evidence —
  first-class, referenceable "what we know and have decided" units.
- **What it does.** Separates stable, curated knowledge (a fact the team affirms)
  from the stream of incoming evidence, so the agent and users can rely on it.
- **Why it matters.** Reinforces the "second brain" framing and gives the agent a
  cleaner grounding substrate than raw evidence alone.

---

## Tier 2 — Real engineering, highest payoff (the recurring GAP)

### O-14 · Interaction-capture layer — BEAT (enabling) · L · (YouSpot, Traxy)
- **What it is.** Capture of **person-level, real-time interaction/engagement data**
  — email, calendar, LinkedIn engagement, X — the layer PursuitOS does **not** yet
  have. (Currently parked; needs OAuth/DNS work.)
- **What it does.** Ingests who's meeting whom, who opened/replied, who engaged with
  what — turning the platform from company/firmographic-aware into person-and-
  behavior-aware, and enabling self-building context (auto-logged activity).
- **Why it matters.** This is the **single recurring gap** every scanned competitor
  leans on and PursuitOS lacks — and the enabler for O-15, O-16, and richer
  second-brain context. Highest-leverage net-new investment; also the biggest lift.
  **Build once, unlocks three.**

### O-15 · Engagement-signal prospecting — BEAT · L · (Traxy)
- **What it is.** Person-level "who's in-market/active this hour" prospecting, built
  on O-14: monitor partner/vendor/competitor communities for ICP people who engage.
- **What it does.** Surfaces individuals showing buying intent through their
  engagement behavior, as leads — a new signal *axis* on top of PursuitOS's existing
  company/firmographic/event signals.
- **Why it matters.** Traxy's core value ("who showed buying intent this hour") is a
  person-level intent stream PursuitOS can add once interaction capture exists.
  Depends on O-14.

---

## Tier 3 — LEAPS: partner-led moves a single-seller tool structurally cannot make

### O-16 · Ecosystem engagement signals — LEAP · L · (Traxy)
- **What it is.** Watch the **JOINT book across BOTH partners' networks**, consent-
  gated — the two-sided extension of O-14/O-15.
- **What it does.** Surfaces in-market engagement signals visible only when you can
  see *both* partners' relationship graphs at once, under the consent ladder.
- **Why it matters.** A single-seller tool sees one side of the network; PursuitOS's
  cross-tenant model can see the union, consented. This is intent data no competitor
  can produce — the moat applied to engagement signals. Depends on O-14/O-15.

### O-17 · Multi-player second brain (shared entity graph) — LEAP · M · (YouSpot)
- **What it is.** Name and surface the ecosystem entity graph — accounts ↔ partners
  ↔ motions ↔ opportunities ↔ evidence — **shared across a partnership, consent-
  gated**, centered on the org.
- **What it does.** Presents the relationships PursuitOS already stores as a
  navigable "second brain" that spans two companies (not one), gated by consent.
- **Why it matters.** YouSpot's second brain is single-player by definition;
  PursuitOS's is inherently multi-player. Largely surfacing/graph-view work over
  existing data — high perceived value, moderate cost.

### O-18 · Cloud agents that act across the partnership — LEAP · L · (YouSpot)
- **What it is.** Agents that operate *across* a partnership — broker warm intros,
  advance co-sell, exchange evidence — extending the agent surface already started.
- **What it does.** Autonomous/assisted actions that span two tenants under consent
  (e.g., an agent that proposes and brokers a warm intro end-to-end).
- **Why it matters.** Multi-tenant agency is impossible for a single-seller tool.
  Builds on the MCP/agent surface + consent ladder + joint pursuit rooms. A
  flagship "only we can do this" capability.

### O-19 · Signal → multi-vendor play (not just a lead) — LEAP · M · (Traxy)
- **What it is.** When a signal fires, hand over the lead **plus which partners to
  co-sell with plus the play** — not just the contact.
- **What it does.** Turns a raw intent signal into an ecosystem-routed action:
  "here's the account, here's the partner combo, here's the multi-vendor play."
- **Why it matters.** Competitors deliver a lead; PursuitOS can deliver a *coordinated
  motion*. Builds on existing multi-vendor plays + partner-fit + routing. The signal
  becomes strategy, not just a name.

### O-20 · Attribution proof as product / built-in split-test — LEAP · M · (Traxy)
- **What it is.** Use the settlement ledger + outcome learning to *prove* "this
  signal sourced/influenced this closed co-sell deal," and ship a built-in
  split-test ("our signal vs. your source") at closed-revenue truth.
- **What it does.** Provides hard, revenue-level attribution evidence for signal
  quality — a claim backed by the symmetric settlement record.
- **Why it matters.** Traxy split-tests at reply-rate; PursuitOS can prove value at
  **closed revenue**, which single-seller tools can't (they don't hold the co-sell
  settlement truth). Powerful sales wedge and retention driver.

### O-21 · Partner-led PLG (guest-seat network loop) — LEAP · M · (YouSpot)
- **What it is.** Extend guest seats (already v1) so one invite lands an entire
  partner *network*, not one seat — a viral, partner-led growth loop.
- **What it does.** A partnership invite pulls in a partner, whose own partners can
  be pulled in, each via free scoped guest workspaces — compounding adoption along
  real business relationships.
- **Why it matters.** A solo tool's $/seat motion lands one person; PursuitOS's
  invite lands a network. Growth that rides the very ecosystem the product models —
  builds directly on guest seats v1.

### O-22 · "We watch every account in the joint book, continuously" — LEAP · M · (Monid)
- **What it is.** Combine the abundant-research substrate (O-7/O-8) with the cross-
  tenant joint book to continuously monitor *every* account both partners share, at
  near-zero marginal cost.
- **What it does.** Positions and delivers always-on intelligence across the entire
  joint book, not sampled — a capability that only makes sense when research is free
  *and* you can see the joint book.
- **Why it matters.** The moat (cross-tenant book) × the cheap-research substrate =
  a claim no one else can make. Depends on O-7/O-8; strategic positioning + capability
  combination.

---

## Synthesis (for prioritization)

- **Recurring GAP (build once, unlocks O-15/O-16/O-17 and richer context):** the
  **interaction-capture layer (O-14)**. PursuitOS is strong on company/evidence/
  ecosystem, thin on person-level real-time engagement. Highest-leverage net-new
  build; needs OAuth/DNS.
- **Recurring MOAT (defend + market):** cross-tenant ecosystem + consent ladder +
  verified evidence + co-sell settlement. Every commoditization event (free models,
  free search, everyone's "AI + CRM") makes this layer *relatively more* valuable —
  and it's what powers every Tier-3 LEAP.
- **Suggested sequence:** Tier 0 (cheap surfacings + trust) → Tier 1 (Monid margin
  + reactive UX) → O-14 (the enabling build) → the Tier-3 LEAPs it unlocks. Keep the
  partner-led wedge sharp throughout: *"the layer every credible CRM optimized away
  is the one we're built on."*

---

_Source of record for the analysis behind these: `docs/COMPETITIVE-SCAN-2026-08.md`.
Titles-only version: `docs/OPPORTUNITY-BACKLOG.md`. Platform capabilities these
build on: `docs/PLATFORM-CAPABILITIES.md`._
