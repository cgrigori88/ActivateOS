# Competitive & Signal Scan — August 2026

**Context.** In one stretch, five credible "AI-native go-to-market" signals landed:
Salesforce **Claudeforce**, Mohit Aron's **SciFin**, HubSpot/Dharmesh's **YouSpot**,
**Monid/TinyFish** (free agent web infra), and **Traxy** (LinkedIn buyer-intent).
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
3. **Real engineering, high payoff:** the interaction-capture layer (comms + LinkedIn
   engagement) → unlocks person-level intent and self-building context.
4. **The wedge to keep sharpening:** *"The most credible CRM founders all shipped my
   architecture last month — each for a market I don't serve. I own the one they all
   skipped: partner-led revenue."*
