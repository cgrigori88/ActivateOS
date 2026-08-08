# ActivateOS — Project Brief & Founding Technical Direction

> **ActivateOS decides what the channel should do next.**

This document is the engineering source of truth distilled from the founding strategy
conversation. It captures what we are building, why, the architecture we agreed on,
and the build sequence. It is a clean-room synthesis of our own independently
developed thesis — no third-party or employer-confidential material is referenced
or reproduced here, by design.

---

## 1. What ActivateOS is

ActivateOS is an **AI decision and orchestration layer for partner-led (channel)
revenue**. It identifies the highest-value combinations of customers, products,
partners, sellers, incentives, and market signals — and converts them into
measurable, executable revenue motions.

The technology channel does not have a partner **recruitment** problem; it has an
**activation** problem. Vendors sign partners, allocate MDF, publish portal content,
and distribute generic account lists — and very little coordinated seller execution
results. Existing categories each solve a slice:

- **CRMs** record what happened.
- **PRMs** administer partners, portals, and deal registration.
- **Ecosystem-mapping platforms (e.g. Crossbeam)** reveal who is connected to whom.
- **Intent providers (HG Insights, Bombora, G2, etc.)** sell signals.
- **Outreach/enablement tools** execute communications.

ActivateOS sits **above** all of them and answers the question none of them own:

> *Of all possible products, partners, accounts, sellers, budgets, and market
> signals — which combination should we activate right now, why, through whom,
> with what message, and what economic outcome should we expect?*

**Positioning:** "AI Partner Revenue Activation Platform" — the Revenue System of
Action for the technology channel. Contrast line: *ecosystem-mapping tools show
where partners can win together; ActivateOS makes the win happen.*
We deliberately do **not** compete on account-overlap mapping, warm-intro
infrastructure, or generic individual-seller copilots — those are inputs and
adjacent layers, not our job.

## 2. The commercial wedge (sell before building)

The company launches as a **productized, AI-enabled service**, not as SaaS:

- **Initial product: 30-Day Partner Activation** — one vendor, one product, one
  partner, one campaign, ~100 target accounts, 30 days of activation support.
  - First 3 design partners: **$7,500–$10,000** (≥50% upfront, ideally 100%).
  - Thereafter: **$12,500–$20,000** per activation.
- **Recurring: Managed Activation** — $4,000–$8,000/month.
- Later: multi-partner programs, distributor-sponsored programs, outcome-based upside.

**Bootstrap constraints (non-negotiable):**

- ≤ **$3,000** spent before the first paying customer; **$10,000** total founder cap,
  released in stages against revenue milestones.
- $0 in paid data for the first prototype; the first data subscription
  (~$100/month) only after a real pilot requires it.
- No engineering project without a paying-customer use case; no integration until
  3+ customers request the same one; no employees, no proprietary model training,
  no enterprise certifications in year one.
- Every engagement must produce structured outcome data (this is the long-term asset).

Buyers: emerging/midmarket technology vendors (~25–500 employees, $5M–$200M revenue,
$25K+ ACV) in cybersecurity, AI infrastructure, DevOps, cloud/FinOps, data,
observability, automation, compliance — companies with signed partners, weak
partner pipeline, and no channel-marketing capacity. Purchases attach to immediate
triggers (new partner signed, product launch, unused MDF, quarterly pipeline gap)
and are often MDF-fundable.

## 3. Product architecture — six engines over one graph

```text
                        ACTIVATEOS

          ┌─────────────────────────────┐
          │           SENSE             │  entity resolution + signal collection
          └──────────────┬──────────────┘
                         ▼
          ┌─────────────────────────────┐
          │          PREDICT            │  purchase propensity + activation
          │                             │  probability (later: uplift models)
          └──────────────┬──────────────┘
                         ▼
          ┌─────────────────────────────┐
          │           MATCH             │  customer × product × partner × seller
          └──────────────┬──────────────┘
                         ▼
          ┌─────────────────────────────┐
          │          DESIGN             │  Revenue Motion + campaign generation
          └──────────────┬──────────────┘
                         ▼
          ┌─────────────────────────────┐
          │          EXECUTE            │  seller actions, outreach (human-
          │                             │  approved sends), BVAs, tracking
          └──────────────┬──────────────┘
                         ▼
          ┌─────────────────────────────┐
          │           LEARN             │  outcome events → lift → retraining
          └──────────────┬──────────────┘
                         └──────► feeds back into PREDICT

                 PARTNER REVENUE GRAPH (the moat)
```

### The moat: a closed loop, not a dataset

We are not trying to build the world's best intent dataset. We are building the
world's best prediction of an **actual technology purchase** and the **intervention
most likely to cause it**. The defensible asset is the closed loop:

*who we predicted + why + which partner + which motion + what the seller did +
how the customer responded + what they actually purchased* — captured as
immutable events, repeated at scale. That is the **Partner Purchase & Revenue Graph**.

### Scoring model (two models, eventually three)

- **Model A — Purchase Probability:** likelihood Customer X buys Solution Y within Z months.
- **Model B — Activation Probability:** likelihood we can influence that purchase
  through Partner P and Seller S.
- **Commercial Opportunity Score** ≈ Purchase Probability × Activation Probability
  × Expected Deal Value.
- **Model C (later) — Incrementality:** uplift modeling — who buys *because* we
  intervene, validated with holdout cohorts.

### The Revenue Motion — first-class data primitive

A motion binds: account, solution, propensity score, partner + activation score,
trigger/compelling event, competitive condition, motion name, personas, recommended
vendor + partner sellers, customer thesis, CTA/offer, and confidence. The Design
engine turns motions into campaigns; Execute runs them; Learn scores the prediction.

## 4. V1 engineering principles (binding)

1. **The LLM is never the propensity model.** LLMs extract, classify, map taxonomy,
   summarize research, and draft motions/content. V1 propensity is a **versioned,
   deterministic, explainable feature-weighting engine**, architected so it can be
   replaced by calibrated statistical models (logistic regression baseline, then
   gradient boosting) once real outcomes accrue.
2. **Every recommendation answers WHY.** Every score preserves its feature
   contributions; every externally derived assertion is stored as an **evidence
   object** (source, URL, timestamp, extracted claim, confidence, entities, decay).
   No LLM-generated "fact" becomes a scored signal without evidence.
3. **Signals decay.** Every signal carries base strength, confidence, observed_at,
   and a half-life (e.g. hiring surge ~90d, strategic announcement ~180d,
   installed tech ~720d). **Negative signals** (layoffs, budget cuts, competing
   contract signed, need already satisfied) materially reduce scores.
4. **Every commercial interaction emits an immutable outcome event**
   (MOTION_CREATED → SELLER_ASSIGNED → MESSAGE_SENT → REPLIED → MEETING →
   OPPORTUNITY → CLOSED_WON/LOST) suitable for later supervised training and
   uplift modeling.
5. **Measure lift, not eloquence.** The core metric: how much better do
   ActivateOS-selected accounts perform vs. the customer's existing targeting?
6. **Human-approved sends.** No autonomous outbound in V1.
7. **Boring stack, modular monolith.** No microservices, Kafka, Kubernetes, or a
   graph database until scale demands it.

## 5. Technical stack

| Layer | Choice |
|---|---|
| App | TypeScript, Next.js, Node.js (modular monolith, server actions/REST) |
| Hosting | Vercel |
| Database | PostgreSQL via Supabase — relational core, JSONB for raw signals, pgvector for embeddings |
| Auth / files | Supabase Auth / Supabase Storage |
| AI routing | Cheap model tier for extraction/classification/taxonomy/summarization (~80%+ of calls); frontier reasoning model only for motion design, ambiguous evidence, executive content, QA |
| Payments | Stripe invoices / payment links |
| Search/research | Tavily free tier (fallback: SerpAPI) |
| Email | Resend or business email |
| Telemetry | PostHog / Sentry free tiers |

The Partner Revenue Graph is modeled **relationally with edge tables** in Postgres.

### Core schema (initial entities)

```text
organizations, companies, company_aliases, domains, company_hierarchies
partners, partner_relationships, sellers, seller_account_relationships
vendors, products, taxonomy_nodes, product_taxonomy_mappings
signals, signal_sources, signal_observations, evidence
technologies, technology_installations, transactions, contracts
campaigns, revenue_motions, motion_accounts
activities, touches, responses, meetings
opportunities, quotes, wins, losses
propensity_scores, score_features, score_versions, outcomes
```

### Company identity graph (build first)

Every company gets a canonical `activate_company_id` linked to domain, legal name,
normalized name, hierarchy (parent/subsidiary), geography, industry codes
(NAICS/SIC), D-U-N-S when available, and external IDs (vendor/partner/distributor/
CRM account IDs). Matching hierarchy: exact domain → validated legal domain →
normalized name + geography → hierarchy → fuzzy match → LLM-assisted ambiguity
resolution → D-U-N-S as an authoritative enhancer (not a day-1 requirement).
If entity resolution is wrong, every downstream model is contaminated.

### Activate Technology Ontology (proprietary IP)

Our own taxonomy of ~100–250 enterprise technology categories (Infrastructure,
Cloud, Automation, Containers, Security, Data, AI, …) with adjacency,
complementary, and replacement edges. External taxonomies (Gartner, Forrester,
G2, vendor catalogs, distributor SKUs, job descriptions) are **mapped into it**
— we never depend on someone else's proprietary taxonomy. This enables the
adjacency/purchase-pathway modeling ("customers who bought X bought Y next")
that static propensity tools cannot do.

## 6. Data strategy — $0 first, earn every subscription

**Day 1 ($0):** customer-uploaded CSVs (account lists, install base, renewals,
wins/losses, partner + seller mappings — the single most valuable day-1 source),
company websites, press, career pages/job postings (track *velocity*, not counts),
SEC EDGAR (10-K/10-Q/8-K initiative extraction), SAM.gov + state procurement,
USASpending.gov, public GitHub org activity, BuiltWith free endpoint, Tavily free
tier, People Data Labs free tier.

**Purchase order (only when a pilot proves need):**
1. PDL Company API (~$100/mo) — first paid subscription.
2. D&B Hoovers (~$49/mo) for identity research only — embedding/redistribution
   requires separate licensing; do not assume.
3. BuiltWith Basic (~$295/mo) — only if web technographics demonstrably improve lift.

**Do not buy in year one:** HG Insights, ZoomInfo, Bombora, G2 Buyer Intent,
Gartner/Forrester data. Instead: **"Bring Your Own Intelligence"** — customers
connect signal sources they already license, as an ActivateOS feature.

**Distributor partnership (e.g. TD SYNNEX) — after the engine proves lift.**
Distributor transaction history is the killer signal (actual purchases beat
inferred intent: purchase sequences, spend velocity, category adjacency, partner
relationship strength). Approach via **clean-room / federated architecture**:
raw transactions never leave the distributor; we consume derived variables
(spend percentiles, velocity, adjacency scores, relationship tenure) and prove
predictive lift vs. baseline. Long-term: federated learning across distributors.

## 7. Competitive boundaries

- **vs. Crossbeam:** they own relationship/overlap intelligence ("who knows whom").
  We own activation architecture ("what should the ecosystem do next"). Their data
  can become a scoring input; do not rebuild account mapping.
- **vs. seller copilots (SalesOgre-style):** they optimize an individual rep's
  workflow inside one company. We orchestrate motions **across companies**
  (vendor × distributor × partner × sellers). We may add channel-specific seller
  intelligence later (Phase 3), not first.
- **vs. internal vendor campaign tools:** execution-automation platforms
  (account matching, automated outreach, reply tracking) are **execution
  endpoints** below us. We will build our own clean execution layer as part of
  end-to-end coverage, but the differentiation is the decision layer above it —
  campaign generation is a feature, not the core.
- **Clean-room discipline:** nothing derived from any employer's internal systems,
  code, data, prompts, or workflows enters this codebase. Employment/IP counsel
  review before commercial launch; initial market kept clear of employer accounts.

## 8. MVP definition and build sequence

**MVP capability:** take 500–5,000 accounts and answer — *for Solution X, which
50 accounts should we pursue right now, why, through which partner, with which
seller, around what trigger, and with what motion?*

**Week 1**
- Day 1: repo, Postgres/Supabase schema (companies, products, taxonomy, signals, evidence).
- Day 2: CSV account ingestion + company identity resolution.
- Day 3: research agent (website/press/careers/filings → structured signals with evidence).
- Day 4: taxonomy mapper (raw signals → ontology nodes).
- Day 5: propensity scorer v1 (deterministic, explainable; top evidence + negative signals + recommended motion).
- Days 6–7: minimal UI — ranked account list; click-through to "WHY NOW" evidence panel.

**Weeks 2–4**
- Week 2: partner + seller scoring (activation probability).
- Week 3: Revenue Motion generator.
- Week 4: campaign generation + outcome-event capture.

**Four-week demo:** 1,000 accounts in → ~25 justified opportunities → complete
partner motion → seller campaign → measured results.

**Presentation discipline:** scores ship as an index ("93/100 — Very High"),
never as a calibrated probability, until we have statistically valid calibration
from real outcomes. Holdout cohorts prove incrementality when volume allows.

## 9. Long-term staging

1. **Activation service** (revenue + market learning) →
2. **Campaign/customer workspace** (after ≥2 paid customers) →
3. **Channel Revenue OS** (campaigns, accounts, sellers, opportunities, MDF
   intelligence; optional CRM export before any live integration) →
4. **Partner Revenue Graph** (learned motion→outcome intelligence; MDF becomes a
   capital-allocation problem: "where should the next $100K go for the highest
   expected return?") →
5. **Activation Network** (vendors fund motions, partners execute, sellers get
   prioritized opportunities; software + service + transaction economics —
   the unicorn layer).

End-state ambition: a channel executive asks *"I need $50M of incremental pipeline
with $2M of channel investment — what should I do?"* and ActivateOS allocates the
budget across partners, motions, and pursuit teams with expected pipeline and
confidence — then executes the plan.

**Mission:** less selling, better matching, better outcomes — make commercial
ecosystems work better by connecting the right solutions, partners, sellers, and
customers at the right time, and eliminating wasted effort. Recommendations
optimize for the intersection of commercial probability **and** customer value,
not conversion alone.
