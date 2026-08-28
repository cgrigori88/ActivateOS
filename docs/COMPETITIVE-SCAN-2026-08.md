# Competitive & Signal Scan — August 2026

**Context.** In one stretch, several credible "AI-native go-to-market" signals landed:
Salesforce **Claudeforce**, Mohit Aron's **SciFin**, HubSpot/Dharmesh's **YouSpot**,
**Monid/TinyFish** (free agent web infra), **Traxy** (LinkedIn buyer-intent), and
**Comp AI CRM** (open-source agentic-first CRM — our closest architectural peer).
This file records the meets / beats / leaps read for PursuitOS. Two throughlines
matter more than any single product:

- **The commoditizing bottom of the agent stack** — models (BYO), web search/fetch
  ($0), and the "AI-harness-with-CRM-tools" pattern are all becoming table stakes.
- **PursuitOS's non-commoditizing layer** — cross-tenant ecosystem, consent ladder,
  verified evidence, and co-sell settlement. None of these competitors touch it.

There is also one recurring GAP: every one of them leans on **person-level, real-time
interaction/engagement data** (email/calendar/LinkedIn/X) that PursuitOS does not yet
capture. If there is a single net-new investment the market keeps pointing at, it is an
**interaction-capture layer**.

---

## 1. YouSpot (HubSpot Labs / Dharmesh Shah) — AI-native *solo* CRM

**What it is.** A CRM for one-person companies (solopreneurs/consultants/creators).
Explicitly *not* for GTM teams ("I recommend HubSpot") or consumers. "A self-building
second brain." $1/mo intro, pay-as-you-go. Connects Gmail/Calendar/LinkedIn/X.

**Not a direct competitor** — it's the solo floor; HubSpot/Salesforce the enterprise
ceiling; PursuitOS owns the gap they skip: partner-led revenue teams and ecosystems.

**MEETS (PursuitOS already has this — market it louder).**
- "An AI harness with CRM tools inside; you use it like ChatGPT/Claude with structured
  context + tools" = PursuitOS `askTheRecord` (tool-use loop over `MCP_TOOLS`).
- "Robust MCP connector to Claude/ChatGPT/any MCP app" = PursuitOS `/api/mcp` + per-org
  keys (task #76).
- Self-building context, proactive "what deserves attention" = providers/intake + Today
  + morning brief + next-best-action + BYO-model.

**BEATS (adopt, adapted to partner-led).**
1. Name + surface the "Second Brain" as an **ecosystem entity graph** (accounts ↔
   partners ↔ motions ↔ opportunities ↔ evidence), centered on the org.
2. A unified **Feed** — collapse Today/Queue/brief/renewal-radar into one proactive
   stream with partner-led items.
3. **Personal comms capture** (Gmail/Calendar/LinkedIn/X) — his "no Sunday-night
   updating" loop; PursuitOS's biggest capability gap (parked, needs OAuth).
4. **Memory + Fact** as first-class, distinct from raw evidence.
5. A **chat-first front door** (promote `/ask`).

**LEAPS (a solo CRM structurally can't follow).**
1. The **multi-player second brain** — shared across a partnership, consent-gated.
2. **Cloud agents that act across the partnership** (broker warm intros / co-sell /
   evidence exchange) — extends the agent surface already started.
3. **Partner-led PLG** — guest seats land an entire partner *network* from one invite;
   a $1 solo motion lands one person.

**Do NOT copy:** solo positioning, $1 pricing, consumer simplicity. His hand-off of GTM
teams to HubSpot *is* the PursuitOS market.

---

## 2. Monid / TinyFish — free agent web search + fetch (INFRASTRUCTURE, not a competitor)

**What it is.** Agent tool-integration platform (~1,700 tools) on TinyFish web infra.
Free live web search + URL→Markdown fetch (10/call) + change monitoring + hourly
freshness. Paid only for scrapers/enrichment/media. Install via `monid.ai/SKILL.md`.
Undercuts SerpAPI $25 / Tavily $8 / Exa $7 / Brave $5 per 1k → **$0**.

**ADOPT (direct cost + capability wins).** PursuitOS's normalized provider architecture
(`shouldRunProvider`, per-category completeness) makes this a small adapter:
1. Add a `monid` provider for web search + fetch; route generic research/investigator
   through it → per-search cost ~$7–8/1k → $0; removes quota anxiety (research broadly,
   not sampled).
2. **Free change-monitoring** strengthens the trigger thesis — website/careers monitors,
   contract-expiry/renewal — watch *every* account continuously.
3. **Hourly freshness** feeds the refresh runner + time-to-event relevance.
**Caution:** young startup giving infra away → reliability/longevity risk + noise. Keep it
one interchangeable source behind the provider abstraction; lean harder on the
verification layer (confidence, contradiction detection, review queue).

**Strategic read.** When raw search is $0, value moves UP into verification + relationship
context + consent — PursuitOS's layer. "When search is free, the money is in knowing which
of it is true and who to act on it with."

**LEAP.** Abundant-research substrate → *"we watch every account in the joint book,
continuously"* at near-zero marginal cost. Publish PursuitOS's own `SKILL.md` for viral
one-line install alongside the MCP connector.

---

## 3. Traxy (Ben Buaron) — LinkedIn buyer-intent / signal-based selling

**What it is.** "LinkedIn Buyer Intent & Signal-Based Selling." Hourly agent watches
engagement on **competitor / influencer / teammate** profiles; ICP people who *engage*
with those posts become leads ("who showed buying intent this hour"). Enrich phone/email
on chosen segments; route to Slack/HubSpot/webhooks/Meta Ads the moment a lead surfaces.
No LinkedIn credentials required. $149/mo, 5,000 credits, 7-day trial, G2 5.0. Claims
8–14 meetings/mo from one LinkedIn account, "first intro in 30 min," 2.6–3× reply rates.

**MEETS.** Hourly monitoring + ICP matching + route-downstream = PursuitOS refresh runner,
`trigger_settings`, GDELT radar, `org_icp`/`icpFit`, CRM writeback, next-best-action.

**BEATS (net-new worth adding).**
1. **Engagement-signal prospecting** — PERSON-level intent (who's active in-market this
   hour), vs. PursuitOS's company/firmographic/event signals. Monitor partner/vendor/
   competitor communities → ecosystem engagement signals. (Needs LinkedIn data — same
   parked layer as comms capture.)
2. **On-demand enrichment** ("auto-enrich the segments you choose") — cost-controlled;
   PursuitOS has PDL people enrichment, could add the "enrich only what you'll act on" UX.
3. **Route-on-surface** — a real-time Slack/webhook push the moment a signal fires
   (lighter/faster than the batch writeback path; easy on the worker).
4. **Built-in split-test** — "split-test our leads vs. your source." PursuitOS's outcome
   learning / calibration / attribution can ship this as a sales wedge that proves signal
   quality at the *closed-revenue* level.

**LEAPS (partner-led).**
1. **Ecosystem engagement signals** — watch the JOINT book across BOTH partners' networks,
   consent-gated. A single-seller tool can't see the partner's side.
2. **Signal → multi-vendor play, not just a lead** — hand over the lead *and* which
   partners to co-sell with *and* the play.
3. **Attribution proof as product** — settlement ledger + outcome learning prove
   "this signal sourced/influenced this closed co-sell deal."

**Caution.** Depends on LinkedIn engagement/scraping (ToS/reliability risk). PursuitOS's
consent + provider abstraction is cleaner but slower to person-level engagement.

---

## 4. Comp AI CRM (trycomp.ai / `trycompai/crm`) — open-source *agentic-first* CRM

**What it is.** MIT-licensed, self-hostable CRM built on the exact inversion PursuitOS
already believes: *"the agent is not a feature of the CRM; the CRM is where the agent
keeps its notes."* Bun + Vercel `eve` durable agents, Next.js/shadcn, NestJS+tRPC,
Postgres/Neon+Prisma, Better Auth. Three services share `DATABASE_URL`: app, API, agent.
Works with **zero API keys** (Perplexity optional for web research). This is the closest
*architectural* peer of the four — not a market we skip, a mirror of our own thesis. Study
it for sharpenings, not for positioning.

**MEETS (same thesis, already ours).**
- Agent-as-harness over CRM tools = `askTheRecord` + `MCP_TOOLS`.
- Evidence-first, "nothing about a person is guessed" = our evidence table (stance,
  first_party, source_type, verified/quarantined/rejected).
- Self-scheduled follow-up = refresh runner + `routine_runs` + `trigger_settings`.
- Skills-as-versioned-prose (`evidence.md`, `identity-matching.md`, `data-boundaries.md`,
  `writing-a-brief.md`) = the `SKILL.md` direction already flagged (Monid).

**BEATS (four concrete sharpenings worth stealing).**
1. **Provenance-typed evidence over a raw confidence float.** Their tools report *what they
   observed* — `crm.signature-block`, `github.account-identity` — and a **ledger prices the
   evidence by source type**; they deliberately reject model-emitted confidence scores
   ("a confidently wrong fact is worse than a blank field"). PursuitOS stores
   `computed_confidence` as a number; adding a typed *provenance* dimension (what kind of
   source, priced by trust) on top of the float is a cleaner, more defensible model — and
   feeds our verification layer directly.
2. **`schedule_recheck` must carry a human-readable reason.** "An agent that cannot say why
   it will be back in fourteen days does not have a reason, it has a default." Our routine /
   refresh scheduling should attach and surface a *why* on every self-scheduled recheck.
3. **Sandbox security posture for the agent (enterprise-trust gold, ties to RISK-1/3).**
   Deny-all egress; the sandbox is **never given `DATABASE_URL`**; `web_fetch`/`web_search`
   run in the app runtime, not the sandbox — "a shell with credentials and egress is
   exfiltration-shaped; a shell with neither is a text processor." As we open the MCP/agent
   surface, this is the exact posture a corporate security officer wants to see documented.
4. **Task queue via `FOR UPDATE SKIP LOCKED` + lease/expiry.** `claimDue` leases rows so
   multiple dispatchers claim disjoint work and dead sessions free their rows. A crisp,
   proven pattern for our worker's refresh/routine drain — worth mirroring in the runner.

**LEAPS (where their *deliberate* choice becomes our moat).**
Comp AI is **single-tenant by design** and argues it explicitly: a constant `organizationId`
is "a column, an index and a permissions check that buys nothing and reads like a real one
at review time." That argument is *correct for a single-seller CRM* — and **structurally
fatal for a partner-led one**. They have optimized away the exact primitive
(org-scoping → cross-tenant consent ladder → shared-but-gated evidence → settlement) that is
PursuitOS's entire moat. This is the cleanest possible illustration of the wedge: the most
principled agentic-CRM engineers in the open-source world looked at multi-tenancy and threw
it out — because they will never broker a deal *between* two of their customers. We exist to.

**GTM note.** MIT + self-hostable + `SKILL.md`-installable is a real distribution lever.
Reinforces publishing our own open `SKILL.md` + MCP connector for viral install, while
keeping the ecosystem/settlement server-side and closed.

**Caution.** None here — it's open source; read the code. The lesson is a *design* one:
adopt the four sharpenings, and note that their headline simplification is the thing we must
never adopt.

---

## Synthesis & recommendation

**Recurring GAP (build once, unlocks three of the above):** an **interaction-capture
layer** — email/calendar (YouSpot), LinkedIn engagement (Traxy, YouSpot), X. PursuitOS is
strong on company/evidence/ecosystem, thin on person-level real-time engagement. This is
the highest-leverage net-new investment; it needs OAuth/DNS work (currently parked).

**Recurring MOAT (defend + market):** cross-tenant ecosystem + consent ladder + verified
evidence + co-sell settlement. None of these five touch it. Every commoditization event
(free models, free search, everyone's AI-harness) makes this layer *relatively more*
valuable.

**Priority order (my read):**
1. **Cheap, now:** add the `monid` free search/fetch + change-monitoring provider (real
   margin + lets intelligence run continuously). Publish a `SKILL.md`.
2. **Cheap, now:** name + surface the "AI harness + MCP" story you already have; a unified
   Feed; route-on-surface webhooks; a built-in split-test using existing attribution.
2b. **Cheap, now (Comp AI sharpenings):** attach a human-readable *reason* to every
   self-scheduled recheck; add a provenance-typed dimension to evidence (source-kind priced
   by trust, on top of the confidence float); adopt `FOR UPDATE SKIP LOCKED` lease semantics
   in the worker drain; and **document the agent sandbox posture** (no `DATABASE_URL` in
   sandbox, deny-all egress, network tools in app runtime) — direct enterprise-trust win that
   dovetails with RISK-1/RISK-3.
3. **Real engineering, high payoff:** the interaction-capture layer (comms + LinkedIn
   engagement) → unlocks person-level intent and self-building context.
4. **The wedge to keep sharpening:** *"The most credible CRM founders all shipped my
   architecture last month — each for a market I don't serve. I own the one they all
   skipped: partner-led revenue."*
