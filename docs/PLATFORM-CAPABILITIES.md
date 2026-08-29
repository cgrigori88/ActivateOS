# PursuitOS — Platform Capability & Technical Documentation

> **Purpose of this document.** A thorough, layered description of what PursuitOS
> is and does — written so an AI CMO (or a human GTM lead) can build a
> design-partner outreach plan from it without guessing. It moves from plain
> positioning at the top to deep technical mechanism at the bottom. Every
> capability below is **shipped and running in production** unless it appears
> under an explicit **Roadmap** heading. Do not represent roadmap items as
> current capability in outreach.
>
> _Product name: **PursuitOS** (repo: ActivateOS). Live at pursuitos.io._
> _Last updated: 2026-08-29._

---

## How to read this

| Part | Audience depth | What it answers |
|---|---|---|
| **1. The one-page thesis** | Anyone | What is it, who's it for, why does it win |
| **2. Capability map** | GTM / buyer | What can a user actually *do*, room by room |
| **3. The differentiated core** | GTM / technical buyer | The partner-led mechanisms nobody else has |
| **4. The intelligence engine** | Technical buyer | Where the data and the "knowing" come from |
| **5. The AI & agent surface** | Technical buyer / AI-native buyer | How AI is wired in, and how their agents plug in |
| **6. Architecture** | Engineer / security reviewer | Stack, multi-tenancy, scale |
| **7. Trust, security & compliance** | CISO / procurement | Why it clears an enterprise security review |
| **8. The design-partner program** | CMO / founder | Who to target, what to offer, what to ask for |
| **9. Glossary & appendices** | Reference | Terms, full inventories |

---

# Part 1 — The one-page thesis

## What it is
**PursuitOS is an AI-native revenue platform for partner-led go-to-market.** It is
the system of record and the system of action for companies whose growth depends
on *ecosystems* — alliances, channel, co-sell, and joint pursuits — not just their
own direct sales motion.

Where a normal CRM models **one company selling to accounts**, PursuitOS models
**multiple companies selling *together* to shared accounts**, with the consent,
evidence, and settlement machinery that makes that safe.

## The problem it solves
Partner-led revenue is where the money increasingly is (co-sell, marketplaces,
alliances) and where the tooling is worst. Today it runs on spreadsheets, shared
Google Sheets of "who do you know at X," LinkedIn DMs, and quarterly account-
mapping calls. The core problems:

- **You can't safely compare books.** To find overlap ("which of my accounts do
  you also cover?") both sides must expose their customer lists to each other —
  a non-starter. So mapping is manual, stale, and trust-limited.
- **No shared source of truth.** Each partner has their own CRM; the *joint* deal
  lives in email. Attribution ("who sourced vs. influenced this?") is argued, not
  recorded.
- **Intelligence is thin and unverified.** Reps act on stale firmographics and
  gut, with no provenance behind a claim.
- **AI is bolted on.** Most tools added a chat box to a forms database. The agent
  can't actually *do* the work under real controls.

## The thesis (the wedge)
> *The most credible CRM builders all shipped the AI-native architecture in the
> same stretch — each for a market they already own (solo, SMB, enterprise
> direct). The one primitive they all optimized away is **multi-tenant, cross-
> company revenue**: consent, verified evidence, and settlement between two
> companies. That's the layer PursuitOS is built on, and it's the layer that gets
> more valuable every time models, search, and "AI + CRM" get commoditized.*

Three things compound into a moat a single-seller tool structurally cannot copy:
1. **Cross-tenant ecosystem graph** — two companies' books, connected under consent.
2. **The consent ladder + verified evidence** — disclosure happens in graded,
   audited steps; claims carry provenance.
3. **Co-sell settlement** — a symmetric ledger of who sourced and influenced what,
   at closed-revenue truth.

## Who it's for (ICP hypothesis for design partners)
- **Primary:** companies running **partner/alliance/co-sell motions** — B2B software
  vendors with a partner org, ISVs on cloud marketplaces, boutique consultancies
  and agencies that co-sell with vendors.
- **Persona:** VP/Director of Partnerships or Alliances; Partner/Channel Account
  Managers; RevOps leaders who own partner-sourced pipeline; founders running
  partner-led growth directly.
- **Trigger to care:** they have partner-sourced pipeline they can't measure, an
  account-mapping process that's manual and slow, or co-sell disputes over
  attribution.

## Proof points you can use today
- **Enterprise-ready trust posture, verified in production:** database-enforced
  tenant isolation (RLS under a least-privilege role), GDPR export + erasure,
  verify-full TLS with a pinned CA, strict CSP, independent backups. (See Part 7.)
- **Real breadth:** 20 product rooms, 17 intelligence providers, a full
  co-sell lifecycle from blind account-mapping → joint pursuit → settlement.
- **AI-native, not AI-veneer:** a tool-using agent over the record, bring-your-own-
  model, and an MCP server so a customer's *own* agent can operate the platform.

---

# Part 2 — Capability map (room by room)

PursuitOS is organized into **rooms** grouped by the revenue loop. Here is the
whole surface in plain language.

### DECIDE — what deserves attention
- **Today** — a proactive home: the morning brief, next-best actions, renewal
  radar items, and attention flags (failed jobs, decaying engagement) in one place.
- **Ask** — a chat-first front door to the record: ask a natural-language question
  and the agent answers using structured context + tools (see Part 5).
- **Review** — the evidence triage queue: verify/quarantine/reject intelligence
  claims, organized by account, before they influence decisions.
- **Motions** — the revenue-motion portfolio: partner-aware plays with lifecycle
  and economics, next-best action, and drafting hooks into campaigns.

### BUILD — get accounts and contacts in, and mapped
- **Intake** — staged CSV/import pipeline (analyze → map fields → commit), per
  partner, with a runs log. Auto-detects fields and surfaces control before commit.
- **Mapping** — the overlap workbench: partner account-mapping, coverage grids,
  propensity-ranked target lists, real multi-vendor plays, and conflict detection.
- **Accounts** — the account universe: dense table, partner segmentation,
  configurable columns; each account opens a room with its intelligence.
- **Contacts** — the buying committee: people/stakeholders from enrichment, with
  hierarchy, capture-from-lists, and deep filters.
- **Campaigns** — multi-touch outreach composer: AI-sequenced, two-layer
  personalization, branded HTML templates, target-list binding, approve/send gates.

### PARTNER — the ecosystem layer (the differentiator; see Part 3)
- **Partners** — the Partner Hub: one room per partner, with scorecards (joint win
  rate, cycle time, sourced/influenced mix, responsiveness) built from settlement
  truth, and the joint workspace as a tab.

### MEASURE — outcomes and learning
- **Pipeline** — opportunities with stage, weighted value (editable per-partner
  stage weights), MEDDPICC qualification, roll-up bentos as clickable filters, and
  a renewal radar.
- **Goals** — S.M.A.R.T. goals on motions/campaigns, and per-period revenue &
  pipeline targets (base vs. joint).
- **Analytics** — funnel with in-bar figures and conversion, touch sent-vs-
  responded, daily trend lines.
- **Insights** — outcome learning: calibration of the model against reality,
  source predictive-value, what's actually working.

### PLATFORM — operate the machine
- **Sources / Provider health** — the intelligence provider registry: which
  sources ran, their status, recent-run sparklines, errors, completeness.
- **Routines** — the scheduled-intelligence catalog (morning brief, account
  digests) with worker scheduling and per-account digest cards.
- **Upcoming / Queue** — scheduled sends and the action queue derived from cadence.
- **Admin** — owner-only operations: members & roles, partnerships & invites,
  blind-overlap ladder, shared lists, agent API keys (MCP), bring-your-own-model,
  GDPR data-subject tools, ICP & suppression, and AI-operations observability
  (agent spend, latency, override rate, provider failures, queue depth, worker
  health).

---

# Part 3 — The differentiated core (partner-led mechanisms)

This is the part no single-seller CRM has. Each mechanism is built on the
cross-tenant model and the consent ladder.

## 3.1 Blind overlap — account-mapping without exposing your book
Two partner tenants can learn how much their customer books overlap **without
either side revealing an account first.** It works as a **graded disclosure
ladder**, and every rung requires *both* owners to approve, with every step
audit-logged:

1. **Counts** — "you share N accounts" (a number only).
2. **Bands** — overlap by category/industry band (shape, still no names).
3. **Named** — the actual shared accounts, revealed only after mutual approval.

Critically, an overlap probe can only ever surface accounts **already in your own
book** — it tells you which of *yours* the partner also has; it never leaks an
account you don't know. This turns a trust-gated, manual quarterly exercise into a
safe, self-serve, continuous one.

## 3.2 Joint pursuit rooms — a shared workspace for a co-sell deal
When partners agree to pursue a shared account, they open a **joint pursuit room**:
a cross-tenant co-sell workspace with a **symmetric ledger** both sides read
identically, a broker-proposed play, and a "what they can see" panel so each side
always knows exactly what's disclosed. The deal stops living in email.

## 3.3 Co-sell settlement ledger — attribution as a product
A **symmetric sourced/influenced ledger** per partnership, gated on joint pursuits.
Both sides make attribution statements; the ledger is the shared record of who
sourced and who influenced, at **closed-revenue truth**. This is what powers the
partner scorecards — and it's the thing that ends co-sell attribution disputes.

## 3.4 Warm-intro requests — the ecosystem-qualified lead (EQL)
A first-class, consent-gated object: request a warm introduction to a specific
contact at a shared account. The counterpart's decision *is* the disclosure —
accepting reveals exactly one contact of their choosing (snapshotted so both
tenants read the identical record forever); declining reveals nothing. Same
disclosure gate as joint pursuits (active partnership + approved named overlap).

## 3.5 Shared lists, evidence shares, skill shares
Partners can share **field-scoped account lists** (their copy materializes only on
accept; revocation withdraws it instantly), **evidence**, and **playbooks/skills** —
each under explicit, revocable consent, each audit-logged on both sides.

## 3.6 Guest seats — partner-led PLG
A partnership invite can mint a **free, scoped guest workspace** for a partner who
isn't on PursuitOS yet (public `/join/[code]` flow). One invite can land an entire
partner *network*, not one seat — a growth loop a solo-CRM's $/seat motion can't match.

---

# Part 4 — The intelligence engine

PursuitOS doesn't just store what you type — it **builds a verified picture of each
account** from many sources, and it's honest about how well it knows what it knows.

## 4.1 Providers (17, shipped)
A normalized provider architecture with orchestration (`shouldRunProvider` policy,
per-category completeness). Current roster:

- **Hiring / intent:** Greenhouse, Lever, generic careers monitor
- **Tech stack / infra:** BuiltWith, Wappalyzer, Censys, HTTP-fingerprint, DNS, ipinfo
- **People & firmographic enrichment:** PDL (People Data Labs)
- **Filings & signals:** SEC/EDGAR, GitHub, GDELT (global event radar)
- **Web research:** Tavily (deep research + investigator)
- **Change over time:** website monitor, Common Crawl (historical company change)

Each provider is interchangeable behind the abstraction, health-tracked (runs,
success, errors, sparklines), and cost/quota-governed by the orchestration policy.

## 4.2 Evidence & verification — provenance, not vibes
Every claim about an account is **evidence** with a source, a provider, a stance
(supports/refutes), a first-party flag, a computed confidence, and a status
(**verified / quarantined / rejected**). Reps triage evidence in the Review room;
only verified claims influence scoring and drafting. **Contradiction detection**
(via Tavily refutations) flags when sources disagree.

## 4.3 Completeness & signals
Per-account **completeness** scoring (which signal families are covered) tells you
how well you actually know an account. **Signals** are typed and canonicalized;
**time-to-event relevance** ramps a signal's weight as an event (e.g., contract
expiry) approaches.

## 4.4 Propensity scoring & ICP
**Propensity scores** with bands rank accounts by fit and timing. An **ICP profile
+ suppression list** shape targeting (advisory fit chips on results; hard
suppression of competitors/customers). **Source predictive-value** learning feeds
back which sources actually predict outcomes.

---

# Part 5 — The AI & agent surface

PursuitOS is an **AI harness with revenue tools inside**, not a database with a
chat box.

## 5.1 The agent over the record ("Ask")
`askTheRecord` runs a tool-use loop over the platform's tools with structured
context — the same pattern as using Claude/ChatGPT, but grounded in the tenant's
verified record and gated by the platform's controls.

## 5.2 Agent workflows
Purpose-built agents run the drafting and analysis work — e.g. **motion designer**,
**campaign multi-touch sequence generator**, the **conversation agent** for inbound
email, evidence extraction, MEDDPICC training, and next-best-action. Every run is
observable in Admin: **spend, latency, and human-override rate** (the health metric
— rising edits/rejections mean a workflow is drifting).

## 5.3 Bring-your-own-model (BYO-model)
A tenant can supply their **own Anthropic API key**; every drafting agent then runs
on **their** AI contract — their tenancy, their retention terms, their bill. The key
is encrypted (AES-256-GCM) before storage, never shown again, and clearing it
reverts to the platform key instantly. This is a direct answer to enterprise "where
does our data go" objections.

## 5.4 The MCP server — *their* agent operates *our* platform
A **Model Context Protocol** server (`/api/mcp`, streamable HTTP, JSON-RPC 2.0) lets
any MCP-speaking agent (Claude, Copilot, a custom bot) operate one tenant with a
per-org API key. **10 tools**, tenant-scoped by the key and enforced by RLS:

`pipeline_summary`, `account_brief`, `overlap_status`, `joint_pursuits`,
`partner_context`, `initiative_status`, `deal_context`, `org_skills`,
`request_warm_intro`, and `draft_touch`.

Design rules that make this safe to hand an external agent: **reads mirror the
tenant's own screens** (nothing extra), the **only write** produces a *draft* behind
existing human approval gates, and **cross-tenant data appears only where both
partners already consented**. Keys are minted/revoked in Admin, hashed at rest,
last-used tracked.

## 5.5 Routines — scheduled autonomous intelligence
A catalog of scheduled jobs (morning brief, per-account digests) run by a
background worker, surfaced as digest cards and attention flags. Failures raise a
red rail badge and a line in the morning brief.

---

# Part 6 — Architecture

## 6.1 Stack
- **App:** Next.js (App Router) on Vercel (serverless).
- **Database:** PostgreSQL on Supabase — **62 migrations, ~98 tables.**
- **Worker:** a long-lived Railway service (HTTP trigger + internal scheduler) for
  the research pipeline, routines, refresh, and nightly backups.
- **Auth:** Supabase Auth (JWT); membership-as-grant model.
- **Comms:** Resend for outbound, an inbound pipeline + webhook for replies.
- **DB access:** a raw `pg` connection pool (transaction pooler for serverless).

## 6.2 Multi-tenant model
- **Org = tenant.** Every tenant-owned row carries an `org_id`; membership in an org
  is the grant (roles: owner / operator / viewer).
- **Cross-tenant** objects (partnerships, overlaps, joint pursuits, grants, warm
  intros) are scoped by *partnership*, visible only to member orgs on either side.
- **Per-request tenant context** (`withTenant`) pins the caller's org into the DB
  session so tenant scoping is enforced below the app layer (see Part 7).

## 6.3 Data resilience
Independent nightly backups (dump/restore library + worker schedule + CLI) —
because the managed DB's own backups were insufficient. Restores are exercised, not
assumed.

---

# Part 7 — Trust, security & compliance (the enterprise-readiness layer)

This is the section a design partner's security reviewer will care about most. All
of the following is **shipped and verified in production.**

## 7.1 Database-enforced tenant isolation (RLS under least privilege)
The application connects as a **non-owner Postgres role (`app_rw`)**, not the table
owner — so **Row-Level Security is actually enforced by the database**, not merely
by app-layer `where org_id` discipline. Every one of the ~98 tables has RLS
policies: org-scoped tables gate on `is_org_member(org_id)`; cross-tenant tables
gate on partnership membership; reference tables are read-only-shared; child tables
scope through their parent's org. Tenant context is threaded per-request via a
transaction-local GUC (`app.org_id`), resolved from the authenticated session.

**Verified in production:** connecting as `app_rw` with no tenant context returns
**zero** rows (RLS denies); with the tenant context set, it returns exactly that
org's rows. A forgotten `where` clause can no longer cross tenants — the database
refuses.

## 7.2 GDPR data-subject rights
Owner tools to **export** (Art. 15/20 — portable JSON of everything held about a
person) and **erase** (Art. 17 — anonymize-in-place; business records survive,
identifiers are removed; irreversible, typed-confirmation gated). Every erasure is
audit-logged with a one-way hash of the email, never the address.

## 7.3 Transport security
DB connections use **`verify-full` TLS** with the Supabase root CA **pinned in the
application** (not just trusted from the system store), with `rejectUnauthorized`.
An unverified/MITM'd database connection is refused.

## 7.4 Application security
- **Strict Content-Security-Policy** with nonces (theme-boot + framework inline
  chunks) — no `unsafe-inline`.
- **Rate limiting** on the public API surface (per-IP and per-key on MCP).
- **Encrypted secrets** — tenant BYO-model keys encrypted at rest (AES-256-GCM);
  API keys hashed (SHA-256), never stored in plaintext.
- **Consent ladder + audit trail** — every cross-tenant disclosure is a deliberate,
  mutually-approved, logged act; both partners get mirror audit entries.
- **Role gating** — owner/operator/viewer enforced at the app boundary, mirroring
  the database's write policies.

## 7.5 What this means for outreach
PursuitOS can credibly tell a prospective design partner: *your data is isolated at
the database layer, your customers' PII is handled to GDPR, your AI runs on your own
contract if you want, and every cross-company disclosure is consent-gated and
audited.* Very few early-stage GTM tools can say all of that.

---

# Part 8 — The design-partner program (for the CMO)

## 8.1 Who to target first (ranked)
1. **Alliance/partner leaders at B2B SaaS vendors** with an active co-sell motion
   and partner-sourced pipeline they can't measure. *Sharpest pain, clearest ROI.*
2. **ISVs on cloud marketplaces** (AWS/Azure/GCP co-sell) needing account mapping +
   attribution with many partners.
3. **Boutique consultancies/agencies** that co-sell with a stable of vendors and
   live in spreadsheets of overlap.
4. **RevOps leaders** who own partner-sourced pipeline reporting.

## 8.2 The wedge message (per segment)
- To alliance leaders: *"Map accounts with any partner without either of you
  exposing your book — then run the joint deal and settle attribution in one shared
  room."*
- To RevOps: *"Partner-sourced vs. influenced pipeline as a real ledger, at
  closed-revenue truth — not a quarterly argument."*
- To the AI-native buyer: *"Point your own agent at it over MCP; it runs under our
  controls, on your model, on your data."*

## 8.3 What a design partner gets
- White-glove onboarding of their book and their top partners (blind overlap works
  from day one).
- Direct influence on roadmap priority.
- Free guest seats to pull their partners in (partner-led PLG loop).
- The enterprise-trust posture (Part 7) already in place.

## 8.4 What we need from a design partner
- A **real, active co-sell relationship** to run the loop against (not hypothetical).
- Willingness to import a book and invite ≥1 partner.
- Feedback cadence (e.g., weekly) during the design-partner window.
- A named exec sponsor on the partnerships/RevOps side.

## 8.5 Ideal design-partner success criteria (define up front)
- First blind overlap completed with a real partner in < 1 week.
- ≥1 joint pursuit room opened; ≥1 settlement statement recorded.
- Partner-sourced pipeline visible and attributed in Analytics.
- A qualitative "this replaced a spreadsheet/manual process" testimonial.

## 8.6 Honest boundaries (do NOT overclaim)
See the Roadmap below. In particular, PursuitOS does **not yet** capture person-level
interaction data (email/calendar/LinkedIn engagement); positioning should lead with
the **cross-tenant ecosystem + consent + settlement** moat, which is real today.

---

## Roadmap (NOT current capability — for internal planning only)
- **Interaction-capture layer** — email/calendar/LinkedIn/X engagement capture
  (person-level, real-time intent). Highest-leverage net-new build; needs OAuth/DNS
  work. *Parked.*
- **Ecosystem engagement signals** — person-level in-market intent across both
  partners' networks, consent-gated (extends interaction capture).
- **Free web-search/fetch + change-monitoring provider** — near-zero-cost continuous
  research across the whole joint book.
- **Published `SKILL.md` + open MCP install** — viral one-line agent install.
- **Reason-carrying self-scheduled rechecks; provenance-typed evidence; agent
  sandbox posture doc** — quality/trust refinements.

---

# Part 9 — Glossary & appendices

## 9.1 Glossary
- **Motion** — a repeatable revenue play (often partner-aware) with lifecycle and economics.
- **Blind overlap / consent ladder** — graded, mutually-approved disclosure of book overlap (counts → bands → named).
- **Joint pursuit** — a cross-tenant co-sell workspace for a shared account.
- **Settlement ledger** — symmetric sourced/influenced attribution record per partnership.
- **EQL (ecosystem-qualified lead)** — a consent-gated warm-intro request to a contact at a shared account.
- **Evidence** — a provenance-bearing claim about an account (source, stance, confidence, status).
- **Completeness** — how fully an account's signal families are covered.
- **Propensity** — model-scored fit/timing rank for an account.
- **withTenant / `app.org_id`** — the per-request mechanism that pins tenant context into the DB session for RLS.
- **app_rw** — the least-privilege Postgres role the app runs as, under which RLS is enforced.
- **MCP** — Model Context Protocol; how an external agent operates one tenant via API key.
- **BYO-model** — a tenant running agents on their own (encrypted) Anthropic key.
- **Guest seat** — a free, scoped workspace minted from a partnership invite.

## 9.2 Room inventory (20)
Today, Ask, Review, Motions, Intake, Mapping, Accounts, Contacts, Campaigns,
Partners (Hub + Joint), Pipeline, Goals, Analytics, Insights, Sources/Provider
health, Routines, Upcoming, Queue, Admin, Login.

## 9.3 Provider inventory (17)
Greenhouse, Lever, careers-monitor, BuiltWith, Wappalyzer, Censys,
HTTP-fingerprint, DNS, ipinfo, PDL, SEC/EDGAR, GitHub, GDELT, Tavily,
website-monitor, Common Crawl.

## 9.4 MCP tool inventory (10)
pipeline_summary, account_brief, overlap_status, joint_pursuits, partner_context,
initiative_status, deal_context, org_skills, request_warm_intro, draft_touch.

## 9.5 Scale snapshot
62 migrations · ~98 tables · 20 rooms · 4 API surfaces · 17 providers · 10 MCP tools
· 26 capability modules.

---

_This document reflects the platform as built and verified in production as of the
date above. Keep the shipped/roadmap boundary intact in any outward-facing use._
