# PursuitOS — Master Blueprint (Canonical Engineering Direction)

This document supersedes PROJECT_BRIEF.md as the build direction. The brief
remains as founding context; where they differ, this blueprint wins.

## Master directive (verbatim)

Build PursuitOS as a modular, multi-tenant TypeScript/Next.js application
backed by PostgreSQL/Supabase. PursuitOS is an AI-native decision,
orchestration, and execution system for partner-led revenue. It must ingest
first-party and external data; resolve canonical company identities; normalize
product and technology information through a proprietary taxonomy; convert
verified evidence into standardized, time-decayed signals; calculate
explainable multidimensional propensity scores; prioritize
account-product-partner-seller opportunities; recommend the optimal pursuit
team; create structured Revenue Motion objects; orchestrate partner and seller
activation; generate and execute human-approved campaigns; capture customer
communications and meetings; advance opportunities through BVA, stakeholder
mapping, deal registration, and next-best-action workflows; and record every
commercial outcome for model evaluation and future supervised/uplift learning.

All material AI assertions must preserve evidence provenance. No LLM-generated
factual claim may contribute to propensity scoring without a supporting
Evidence object.

Use LLMs for extraction, classification, summarization, taxonomy mapping,
research, commercial reasoning, content generation, and workflow assistance.
Do not use LLM-generated probability values as the primary prediction model.
V1 scoring must be deterministic, versioned, auditable, and
feature-explainable, with later replacement by calibrated statistical/ML
models.

The canonical opportunity unit is not just Account; it is
**Account × Product × Partner × Seller × Motion × Time**.

Store all AI and human changes as auditable events. Every recommendation must
explain why it exists, what evidence supports it, what evidence contradicts
it, and what changed since the prior evaluation.

Design the data layer for future distributor transaction signals, CRM
integrations, premium intent sources, partner ecosystem data, and closed-loop
transaction outcomes without making them required for V1.

Prefer a modular monolith and managed services. Avoid premature microservices,
graph databases, proprietary model training, or heavyweight infrastructure
until scale demands them.

## The commercial loop (source of truth for every engineering decision)

Sense → Understand → Predict → Prioritize → Match → Design → Activate →
Execute → Advance → Measure → Learn → Optimize

PursuitOS is never merely a lead scorer, campaign generator, outreach tool,
PRM, intent aggregator, or CRM overlay. Those are components. The product is
the decision and operating layer across partner-led revenue.

## Layer requirements (condensed; the full user-authored spec is authoritative)

1. **SENSE** — formal source architecture: first-party customer data (highest
   priority), public data (EDGAR, web, careers, procurement), structured
   enrichment (PDL, Tavily; D&B/BuiltWith/Apollo later), premium
   Bring-Your-Own-Intelligence connectors (HG, Bombora, G2, ZoomInfo,
   Crossbeam, 6sense, TechTarget, Demandbase), and later
   partner/distributor transaction data (TD SYNNEX, Ingram, Arrow…).
2. **UNDERSTAND** — entity resolution (`pursuit_company_id`, hierarchy),
   PursuitOS Technology Ontology (100–250 categories; edges: adjacent,
   complementary, competitive, replacement, prerequisite, expansion),
   canonical Signal Registry (no agent-invented names; each signal carries
   company, type, node, value, direction, confidence, observed/first/last
   seen, expiry, half-life, source, evidence), Evidence Graph (no scored
   signal without evidence).
3. **SOURCE INTELLIGENCE** — per source: class, trust, verified rate,
   false-positive rate, sample rate, freshness, predictive value (accuracy
   trust ≠ predictive value), supported signals, licensing, last ingestion.
4. **SIGNAL DECAY** — versioned; effective weight = base × evidence
   confidence × source trust × freshness × corroboration. Contract expiry
   relevance INCREASES as the date approaches.
5. **NEGATIVE EVIDENCE** — actively sought; display positive / negative /
   net evidence totals.
6. **CORROBORATION ENGINE** — independent signal families + agreement +
   contradictions + temporal alignment → Corroboration Score.
7. **TEMPORAL CONVERGENCE** — Signal Convergence Index: clustered recency
   beats scattered history.
8. **PREDICT (multidimensional)** — separate scores: Purchase Need, Purchase
   Propensity, Timing (90d/6m/12m/24m), Solution Fit, Evidence Confidence,
   Activation Probability, Seller Fit, Incrementality Potential (heuristic →
   uplift later).
9. **SCORING ENGINE** — deterministic, versioned, per-point explainable;
   later logistic regression → gradient boosting → calibration → uplift.
10. **PRIORITIZE** — portfolio engine over Account × Product × Partner ×
    Seller × Motion × Time with rich filtering.
11. **EXPECTED COMMERCIAL VALUE** — purchase prob × activation prob ×
    expected ACV × incrementality (uncalibrated until proven).
12–14. **MATCH** — Partner Profile + Partner Fit (Account × Product ×
    Partner, reasons visible), Seller object + Seller Fit, Optimal Pursuit
    Team, Territory engine.
15–17. **DESIGN** — Revenue Motion as rich structured object (typed: net
    new, cross-sell, upsell, renewal attach, displacement, win-back,
    migration, expansion; prose generated only after structure), Motion
    Portfolio, motion workflow statuses (DRAFT → AI_REVIEWED →
    EVIDENCE_REVIEW → MANAGER_REVIEW → APPROVED → ACTIVATING → ACTIVE →
    PAUSED → COMPLETED / REJECTED) with all decisions recorded as labels.
18–19. **ACTIVATE** — ecosystem mobilization workflow (assignments,
    acceptances, notifications, MDF, enablement, cadence) with Activation
    Completion measured; Seller Action Queue as a major surface (every task
    answers "why this action?").
20–22. **CAMPAIGNS** — full activation package grounded in Product Knowledge
    System (per-product capabilities, personas, problems, competitors,
    migration paths, objections, case studies, approved claims) with human
    preview/edit/approve, all edits logged as feedback.
23–27. **COMMUNICATIONS** — native email execution (identities, aliases,
    tracking, opt-out), thread ingestion (per-motion capture addresses),
    Conversation Agent (classify + extract → update graph), contact/persona
    intelligence (buying committees, not titles), configurable → adaptive
    cadences.
28–32. **ADVANCE** — meeting intelligence (pre-brief/post-extract),
    Discovery/Stakeholder/BVA/Competitive/Opportunity agents, Mutual Action
    Plans, deal registration, Opportunity object, Pipeline view.
33–36. **MEASURE** — outreach/engagement/commercial/strategic analytics;
    propensity validation by tier; customer-baseline comparison (the key
    commercial proof); holdout experiments.
37–39. **LEARN** — evidence/signal/score/motion/partner/seller/messaging/
    intervention learning loops; model evolution stages; purchase-sequence
    intelligence (category transition graphs).
40–44. **STRATEGIC PIPELINES** — distributor TransactionSignalProvider
    interface (clean room, derived signals, federated later), ecosystem
    connectors (Crossbeam as input), premium intent adapters (weight by
    observed lift), MDF/Investment engine, Incentive engine.
45. **OPTIMIZE** — the end state: allocate products/accounts/partners/
    sellers/budgets for maximum incremental revenue.
46. **PARTNER REVENUE GRAPH** — long-term moat; relational Postgres now.
47–52. **AGENT ARCHITECTURE & OPERATIONS** — formalized agent set (propensity
    scoring is never an LLM agent), job orchestration with full
    observability (versions, model, tokens, cost, latency, confidence),
    AI cost tracking per unit, tiered Refresh Engine, alerting,
    "What changed?" as a core interface.
53–55. **PLATFORM** — multi-tenancy (organization_id + RLS before external
    customers), roles (Admin, Channel Executive, Partner Manager, Sales
    Manager, Seller, Analyst, Reviewer), full audit logging.
56. **TOP-LEVEL UX** — Today · Opportunities · Ecosystem · Motions ·
    Campaigns · Pipeline · Insights · Intelligence · Admin.

## Engineering sequence

- **Phase 1 — Intelligence Foundation (NOW):** entity resolution + hierarchy,
  ontology, signal registry, decay, negative evidence, corroboration,
  contradiction detection, separate score/confidence, feature contribution,
  refresh scheduler, agent observability. Goal: Sense + Understand + Predict
  trustworthy.
- **Phase 2 — Ecosystem Match:** partners, practices, sellers, territories,
  relationships, partner fit, seller fit, pursuit team.
- **Phase 3 — Motion Engine:** structured motion, templates, economics,
  lifecycle, approvals, portfolio, next-best action.
- **Phase 4 — Activation Workspace:** briefs, campaign builder, outreach,
  manager activation, approvals, assignments, action queue.
- **Phase 5 — Communications:** email infra, aliases, tracking, thread
  capture, classification, cadence, opt-out.
- **Phase 6 — Opportunity Advancement:** meetings, contact graph, stakeholder
  map, discovery, BVA, opportunity, DR, MAP, pipeline.
- **Phase 7 — Outcome Learning:** outcome events, funnels, calibration,
  baselines, benchmarks, source lift.
- **Phase 8 — Predictive ML:** regression → boosting → calibration →
  sequence/partner/seller prediction.
- **Phase 9 — Incrementality & Optimization:** holdouts, uplift, MDF and
  incentive optimization, resource allocation.

## Data pipeline phasing

Start now (near-zero cost): first-party CSV, Tavily, PDL, SEC, web, careers,
press. Add once intelligence is stable: Apollo/BuiltWith/D&B/procurement.
Add with first customers: customer-owned CRM/install/renewal/outcome data
(more valuable than more third-party intent). Add after validation: HG,
Bombora, G2, Crossbeam, ZoomInfo (never purchased centrally until lift is
demonstrated). Strategic later stage: distributor transaction signals.

## Standing priority

The biggest priority is not surface features: it is turning the
research-and-motion prototype into a properly structured commercial
intelligence engine, then layering partner/seller routing and true execution
onto it — preserving the PursuitOS vision instead of drifting into an
outreach application.
