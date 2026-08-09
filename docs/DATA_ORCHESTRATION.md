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
- **Research gate** (`escalationReason`): high-propensity/low-confidence,
  high-value/low-completeness, contradiction, or near-threshold → enqueue.
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

Retrofitted into the normalized architecture and policy-governed today:
pdl_company, pdl_people, greenhouse, lever, dns, ipinfo, builtwith_free
(builtwith_domain/change credit-gated), wappalyzer (disabled — no plan),
censys, sec_edgar, website, github, http_fingerprint, gdelt. Policy entries
exist for the ad-hoc sources still on their earlier modules (tavily, careers,
common_crawl); the orchestration already reasons about them, and each becomes
a first-class provider as it is retrofitted — with no change to the policy or
scoring layers.
