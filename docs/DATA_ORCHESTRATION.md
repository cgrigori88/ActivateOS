# PursuitOS — Data Source Usage Hierarchy & Orchestration

This is the policy layer that decides **when each provider fires** and **what
it is allowed to mean**. It sits above the normalized provider architecture
(`Provider → RawObservation → Evidence → Signal → Feature → Corroboration →
Score`). No provider ever modifies a propensity score; the orchestration only
decides which evidence-gathering runs.

**Master principle:** cheap/structured sources build a preliminary picture
for every account; expensive/deep sources investigate only accounts that
earn it. Optimize for **information gain per dollar**, not API-call count.

## Two-stage flow

```
ACCOUNT → identity+fit → CHEAP SCREEN → preliminary score → RESEARCH GATE
  → (if warranted) DEEP RESEARCH → corroboration → final score → MATCH → MOTION
```

- **Stage 1 — cheap screen** (`screenCompany`): every Tier-1/2 provider whose
  policy gates permit. Builds the preliminary picture.
- **Screening sweep** (`runScreeningSweep`, `npm run screen`,
  `.github/workflows/screen.yml` daily): re-screens each org's portfolio,
  re-maps + re-scores, and enqueues deep research for accounts that now cross a
  gate — the front of the loop that keeps `research_jobs` filled. Cheap by
  construction (content-hash change detection: unchanged sources cost nothing).
  Shares the pipeline advisory lock with the research runner, so screening and
  draining never race on `scoreOrg`.
- **Research gate** (`escalationReason`): high-propensity/low-confidence,
  high-value/low-completeness, contradiction, or near-threshold → `research_jobs`.
- **Research runner** (`runPendingResearch`, the reusable library): drains the
  queue — claims pending jobs with `for update skip locked`, runs deep research
  + re-map + re-score per account, and records each job's outcome. Escalation is
  autonomous, not a manual step. Two thin callers share it — the CLI
  (`npm run research`) and an HTTP endpoint (`POST /api/research`) — so a
  scheduler (cron) and a manual trigger use the exact same code path.
  `runPendingResearchLocked` wraps it in a global Postgres advisory lock: deep
  research spends real money and re-scores whole orgs, so overlapping runs back
  off (the API returns 409) rather than double-spend. The endpoint authenticates
  with its own bearer secret (`RESEARCH_TRIGGER_SECRET`), separate from the
  app's Basic Auth, and `GET /api/research` returns queue status.
  - **Scheduled**: `.github/workflows/research.yml` runs `npm run research` every
    6 hours on a GitHub Actions runner — no serverless timeout, so it drains the
    whole queue per pass; a `concurrency` group plus the DB advisory lock prevent
    overlap. Needs repo secrets `DATABASE_URL`, `ANTHROPIC_API_KEY`,
    `TAVILY_API_KEY`, `PDL_API_KEY`.
  - **On-demand**: `POST /api/research` for a button or ops trigger — the same
    library path, so scheduled and manual stay consistent.
- **Stage 2 — deep research** (`deepResearchCompany`): Tavily, PDL people,
  Wappalyzer, Censys, deeper SEC/GitHub — only for accounts past the gate.

## The decision function

`shouldRunProvider(ctx)` (`src/lib/intel/policy.ts`) is pure and auditable —
every run/skip returns a reason. Gates:

- **stage** — screen vs deep participation
- **requiresPublicCompany** — SEC only for companies with applicable filings
- **categoryRelevant** — GitHub (engineering-observable), Censys (security/
  network/cloud/infra) only for relevant target solutions
- **requiresResearchTrigger** — PDL people, Tavily only after the account
  crosses the research threshold (or a manual request)

## Provider tiers & purpose matrix (§17, §19)

| Provider | Tier | Purpose | Stage |
|---|---|---|---|
| customer_outcomes | 0 first-party | historical wins/losses | screen |
| partner_transactions | 0 first-party | partner transaction/relationship | screen |
| installed_base | 0 first-party | installed products & renewals | screen |
| **pdl_company** | 1 identity | identity / firmographics / ICP fit | screen |
| **sec_edgar** | 2 signal | strategic / economic trigger / negative | screen+deep · public only |
| **greenhouse / lever / careers** | 2 signal | hiring momentum | screen |
| **website** | 2 signal | first-party strategic change | screen |
| **gdelt** | 2 signal | corporate-event discovery radar | screen |
| **github** | 2 signal | engineering activity / momentum | screen+deep · category-gated |
| **builtwith** | 2 signal | technographic evidence | screen+deep |
| **dns / http_fingerprint** | 2 signal | inexpensive tech fingerprint | screen |
| **ipinfo** | 2 signal | network context | screen |
| **tavily** | 3 deep | investigation / corroboration | deep · threshold |
| **pdl_people** | 3 deep | buying committee / persona | deep · threshold |
| **wappalyzer** | 3 deep | technographic corroboration | deep |
| **censys** | 3 deep | specialized public-infra research | deep · category-gated |
| **common_crawl** | 3 deep | historical company-change | deep |

Priority is **strategic-value ordering, not a scoring weight** — actual
scoring stays feature-based. First-party commercial data outranks all
inferred public intelligence; customer interactions and real outcomes
eventually supersede inferred intent.

## PDL split (§3, §22)

- **Company pass** (`pdl_company`, Tier 1): identity + firmographics on
  ~every account. Never person-search credits here. Firmographics establish
  **fit, not intent** — the provider produces provenance evidence and enriches
  the company record (industry / employee count / country), but emits **no
  propensity signal**. A present `ticker` settles the public-company question
  and opens the SEC gate.
- **People pass** (`pdl_people`, Tier 3): only after the research threshold or
  a motion needing personas — and only the senior technical committee
  (`job_title_levels` cxo/vp/director × `job_title_role` engineering), capped
  at five, never every employee. Mandatory for credit efficiency.

## Generic careers monitor (P0-C)

Covers companies **not** on Greenhouse or Lever — the self-hosted / long-tail
case. Dependency-free, free extraction from the company's own careers page:

1. **schema.org JobPosting JSON-LD** — the SEO standard for Google Jobs; the
   high-precision primary path.
2. **Anchor fallback** — job-detail links whose text reads like a role title,
   used only when no structured data is present.

Both normalize into the **shared hiring model** (`classifyJob` /
`computeHiringFeatures` / `hiringEvidence`), so a self-hosted board yields
exactly the same velocity features, thresholds, and evidence as an ATS board —
no duplicated downstream logic. Verified live on Sentry (self-hosted, not on
Greenhouse/Lever): 47 postings extracted → "6 open security roles, 8 added in
30 days" and two new technology-leadership positions.

Honest limitation: fully JS-rendered SPA career pages expose no jobs in their
initial HTML, so an HTTP-only monitor returns nothing for them (a **skip**,
never an error) — those need an ATS API or a headless-browser deep provider.

## Common Crawl historical change (P2-A)

Common Crawl is a free, open web archive. Its CDX index exposes a company's
captured URL surface across crawls **months apart** — retroactively, without our
ever having monitored the site. That is its unique value: the first-party
website monitor only sees change from when *we* start watching; Common Crawl
reveals change that already happened. The provider compares a recent crawl to
one ~12 months older and emits evidence when a strategically-meaningful section
(ai, cloud, security, partners, careers, platform…) **appears** between them —
deep-tier, moderate confidence (0.55), a corroboration/timing clue rather than a
primary intent driver. A few segments map to a real initiative (ai →
AI_INITIATIVE, cloud → CLOUD_MIGRATION, security → CYBERSECURITY_INITIATIVE,
partners → PARTNERSHIP); the rest are corroboration-only.

Resilient to a flaky upstream: Common Crawl's index frequently returns transient
503s, so index/CDX fetches retry a few times and any sustained failure is a
**skip**, never an error.

## GDELT event radar (P0-E)

GDELT indexes global news in near-real time and is **free** — the cheap
DISCOVERY layer for corporate events (launches, partnerships, acquisitions,
expansions, facilities, leadership changes). It is a **radar, not a witness**:

1. **Candidate** — one screen-tier query per company returns recent headlines.
2. **Relevance classify** — a deterministic, subject-gated headline classifier
   (the company must be the actor, plus an event pattern) types each candidate;
   an optional single cheap-LLM pass prunes residual noise when a key is set.
3. **Corroborate** — GDELT's source-trust prior is deliberately low (0.4) and
   its evidence is radar-grade (confidence 0.45), so a lone GDELT article is
   **quarantined** by the quality gate. It is promoted to verified only when an
   independent higher-trust source — the company's own newsroom, an SEC filing,
   or a Tavily investigation of an escalated account — reports the same event
   (§26 corroboration). Noisy press never inflates propensity on its own.

Throttle-safe: GDELT rate-limits by IP and returns a plain-text notice instead
of JSON when busy; the provider treats any non-JSON body as a **skip** (not an
error, and it never trips the metered-refresh guard), and runs at most daily.

## Tavily deep research & investigator (§12)

Tavily is the deep-tier web researcher — metered credits, so deep-only and
gated behind the research threshold. Two roles:

- **Investigation** (`tavily` provider): runs a few targeted queries about an
  escalated account and extracts specific, **cited** claims as evidence
  (secondary-web trust prior 0.6). Stands on its own and corroborates other
  providers when claims align.
- **Corroboration** (`investigateCandidates`): closes the radar loop. It takes
  the cheap radar's (GDELT / Common Crawl) **unconfirmed** candidates, sends
  Tavily to confirm each, and on a confirmed lead writes **verified**,
  fingerprint-aligned evidence carrying Tavily's credible citation. The radar
  pointed us where to look; the investigator supplied the proof. A radar lead
  is never promoted on its own — its own trust stays low; the *event* graduates
  because a credible source confirmed it. Verified live: a MongoDB acquisition
  lead was confirmed to a prnewswire.com release as verified evidence.

## SEC staged processing (§4, §23)

Filing discovered → cheap keyword/section identification → relevant-section
extraction → low-cost structured extraction → deep reasoning only where
necessary. Never whole 100–300pp filings to frontier models. High-trust
primary-source evidence; citations preserved.

## Data completeness ≠ propensity (§24)

`computeCompleteness` scores coverage per category — identity, strategic,
hiring, technology, engineering, relationship, timing, people — **separately**
from propensity. A high-propensity / low-completeness account is a research
target, not a weak account. Displayed as three distinct numbers: Purchase
Propensity · Evidence Confidence · Data Completeness.

## Status vs the command

Every source is now retrofitted into the normalized architecture and
policy-governed: pdl_company, pdl_people, greenhouse, lever, careers, dns,
ipinfo, builtwith_free (builtwith_domain/change credit-gated), wappalyzer
(disabled — no plan), censys, sec_edgar, website, github, http_fingerprint,
gdelt, common_crawl, and tavily (provider + investigator). The earlier ad-hoc
research modules (`research/tavily`, `research/gather`, `research/edgar`) remain
as low-level connectors the providers build on — no orphan data paths, no
change to the policy or scoring layers.
