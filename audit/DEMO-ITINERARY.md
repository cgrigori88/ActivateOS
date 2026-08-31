# Design-Partner Demo Itinerary — the 8–12 minute canonical story

**Not a product mode.** This is a presenter's script for the existing product. One clear
commercial story, one path, four reconciled hero accounts. Run it on a **production build**
(`next build && next start`) — `next dev` does not hydrate the interactions.

- **Environment:** the local Design Partner Demonstration Environment (`pursuit_demo`, real app under `app_rw` + FORCE RLS). Synthetic/DEMO data, external actions approval-gated. **Never** a live/production target.
- **Boot:** `npx tsx scripts/demo-db.ts && npx tsx scripts/demo-stories.ts` → `npm run build` → `PORT=3100 … npx next start -p 3100` (full env in `audit/PRODUCTION-COMMISSIONING-REPORT.md` §8).
- **Viewport:** present at ~1600×1000 (shared screen). Sidebar is fixed; scroll the content pane.
- **One-line framing to open with:** *"This is PursuitOS on the real application and production architecture. The commercial data is illustrative synthetic data, and every external action is approval-gated."*

## Hero cast (reconciled across every screen)
| Account | The story it carries |
|---|---|
| **Umbrella Health Systems** | CRM says late-stage; engagement silent 34 days — intervention required. |
| **Globex Manufacturing** | Strong evidence; CDW recommended; WWT selected via executive override — recommendation preserved. |
| **Stark Industries** | Attractive, high propensity, but timing stays **UNKNOWN** — the renewal date isn't verified. |
| **Cyberdyne Systems** | Multi-partner overlap — two credible resellers; the route is decided, not silently defaulted. |

---

## The journey (in order)

### 1 · Today — "What needs my decision, and where is revenue at risk?"
- **URL:** `/`  · **Hero:** Umbrella (+ the portfolio)
- **Show:** the **Decision queue** ranked by materiality (not arrival); scroll to **"Where your systems disagree"** — Umbrella "*Datacenter exit — phase 1 … silent 30+ days … the record and the deal have parted ways*". Point at **Top opportunities** and **Recent activity**.
- **Say:** "It opens on decisions ranked by what moves revenue — and it already caught that three deals disagree with reality."
- **Interaction:** click the Umbrella disagreement row → its pursuit. **Fallback:** if the link stalls, go to `/pipeline` and show the same Umbrella card there (same canonical row).
- **Time:** ~1.5 min

### 2 · Pursuit Detail — "How does one governed object connect evidence → route → decision?"
- **URL:** `/pursuits/<GLOBEX_PURSUIT>`  · **Hero:** Globex
- **Show:** the **multi-org ribbon** (Shared pursuit · 2 organizations); the **metric band**; **Why Now** ("traceable to source", and **"What we don't know yet — No verified timing anchor"**); the **Route decision** — **Recommended CDW** vs **Selected WWT (human override — recommendation preserved)**.
- **Say:** "One governed Pursuit ties evidence, route, team and execution together — and it tells me what it still doesn't know. The recommendation was CDW; a human overrode to WWT, and the recommendation is preserved, not overwritten."
- **Interaction:** scroll to the **"Why CDW"** panel. **Fallback:** none needed (static render).
- **Time:** ~2 min

### 3 · Sponsor ⇄ Partner disclosure — "Can two companies share one pursuit safely?" **(THE wow moment)**
- **URL:** same Globex pursuit, "Why CDW" panel  · **Hero:** Globex ($1.84M)
- **Show:** in **Sponsor view**, the internal reasons including **"$1.84M recent category activity through TD SYNNEX" (CONFIDENTIAL)**. Toggle to **Partner view** — the figure is gone; caption reads **"1 confidential figure removed at the server — absent from this payload, not hidden in the browser."**
- **Say:** "Same Pursuit, two audiences. The confidential figure never enters the partner payload — it's removed server-side, not hidden in the browser. That's the cross-company trust boundary."
- **Interaction:** click **Sponsor view ⇄ Partner view** (segmented control). **Fallback:** if the toggle doesn't respond, confirm you're on `next start` (not `next dev`); the two states are also visible side-by-side in the screenshots (`audit/demo-screens/disclosure-sponsor.png` / `-partner.png`).
- **Time:** ~1.5 min

### 4 · Mapping — "Where do our books and interests overlap — and through whom?"
- **URL:** `/mapping`  · **Hero:** Cyberdyne
- **Show:** the **CDW connected-partner** scorecard (overlapping accounts, propensity); the **overlap matrix** ("Our modernization targets" × "CDW customer book" → shared accounts scored by propensity). Name Cyberdyne as an account both resellers touch.
- **Say:** "This is where our book and a partner's book overlap, scored by propensity — the shared accounts we can pursue together."
- **Interaction:** none required (read). **Fallback:** none.
- **Time:** ~1 min

### 5 · Accounts intelligence — "Where should I hunt, why now, and through whom?"
- **URL:** `/accounts?sel=<STARK_CO>`  · **Hero:** Stark (alt: `?sel=<CYBERDYNE_CO>` for the multi-partner routing story)
- **Show:** the clean scan table, then the **intelligence pane**: **HUNT** (78·80 propensity, $1.45M), **WHY NOW** — **Timing "UNKNOWN — preserved, not assumed"** and **"Still missing: a verified renewal/contract-end date would materially raise timing and priority"**, **THROUGH WHOM** (WWT recommended, partner relationships, shared book), **WHAT NEXT** (draft motion awaiting approval).
- **Say:** "Attractive account, high propensity — but the platform refuses to manufacture urgency. Timing is UNKNOWN, and it names exactly what evidence would change the score."
- **Interaction:** click another account name to reselect the pane (e.g. Cyberdyne → "two resellers both credibly positioned — a routing decision, not a default"). **Fallback:** the pane is server-rendered from the URL, so a reload of the same URL always restores it.
- **Time:** ~1.5 min

### 6 · Pipeline — "What is actually happening, and where is revenue at risk?"
- **URL:** `/pipeline`  · **Hero:** Umbrella (reconciles with step 1) + the materiality order
- **Show:** roll-up at top; then the board **ordered by materiality** with **attention rails** — Umbrella "*Late-stage on paper, silent 34 days … Next: Re-engage the economic buyer*" (the **same language as Today**); the $1.45M Stark deal weighted above the $210k. Expand **"Manage"** on one card to show MEDDPICC lives behind progressive disclosure.
- **Say:** "Not a CRM board — it's ranked by materiality and it says what's actually happening and the next intervention. The CRM mechanics are one click away, not in your face."
- **Interaction:** open one card's **"Manage"** disclosure. **Fallback:** none (native `<details>`).
- **Time:** ~1.5 min

### 7 · Queue — "How does intelligence become governed, dated work?"
- **URL:** `/queue`  · **Hero:** the governed action set
- **Show:** **Overdue** (Hooli dormant), **Today** (Globex "Approve WWT route brief" — awaiting approval; Umbrella "Intervene — late-stage deal silent 34 days"), **This week** (Cyberdyne "Awaiting distributor acceptance of shared pursuit role" — cross-org), **Recently resolved** (Initech win).
- **Say:** "Every recommendation becomes a governed, dated action — one awaiting my approval, one cross-company pending a partner. Nothing sends itself."
- **Interaction:** none required. **Fallback:** none.
- **Time:** ~1 min

### 8 · Insights — "Does the system learn, honestly?"
- **URL:** `/insights`  · **Hero:** the learning loop
- **Show:** **Stage-probability calibration** (declared vs observed, **observed "—", "early sample — patterns firm up with volume"** — honest small-sample discipline); **"What sat behind the outcomes"** (source predictive value); **Attention triggers** — the **named "Late stage, silent engagement" rule** that flagged Umbrella on Today, toggleable and explainable.
- **Say:** "Outcomes recalibrate the model — but assumptions stay visibly declared until observed data earns the change. And the rule that flagged Umbrella earlier is right here: named, explainable, and something you can switch off."
- **Interaction:** none required (do **not** toggle a trigger live). **Fallback:** none.
- **Time:** ~1.5 min

**Total: ~11.5 min.** Trim by shortening steps 4 and 7 to reach ~8 min.

---

## Reconciliation spine (say it if asked "is this the same record?")
- **Umbrella** appears on Today (disagreement), Pipeline (same silent-34-day card, same language), Insights (the trigger that fired) — one `opportunities` row, one condition.
- **Globex** on Pursuit Detail (route + override + disclosure) and its opportunity/queue action — one pursuit, one route snapshot.
- **Stark** on Accounts (UNKNOWN timing) and Pursuits — one pursuit with `timing = null`.
- **Cyberdyne** on Mapping (overlap) and Accounts (two-reseller routing note) and the Queue cross-org action — one pursuit, two participants.
The opportunity amount/stage is identical wherever it appears because every room reads the same `opportunities` row (linked to the pursuit).

## Screens intentionally NOT shown in the initial demo
Keep the story to the eight-step spine. Do not open these unless the prospect asks:
- **Partners** (index) — the channel story is carried by Mapping; joint-room counts are thin in the demo.
- **Analytics** (outreach funnel) — reads empty **by design** (no external send occurred — the safety boundary); only open it to make the safety point explicitly.
- **Motions**, **Campaigns**, **Upcoming**, **Goals**, **Contacts**, **Intake** — execution/CRM plumbing that dilutes the decision story.
- **Sources / Trust / Provider health / Review** — provenance depth; strong follow-up material, not opening material.
- **Ask / Skills / Routines / Admin** — platform/config surfaces.

## Presentation-only refinements made this pass
None required — the Phase 3 work already made these rooms legible at presentation size
(materiality-ordered Pipeline with attention rails; Accounts intelligence pane; Today with
the systems-disagree card promoted and per-row demo pills removed). The single environment
requirement stands: **run on `next build && next start`**, or the disclosure toggle and other
interactions will not hydrate.

## Reconciliation discrepancies discovered
None. The four hero narratives reconcile across all eight screens from one canonical object
set (`scripts/demo-stories.ts`). The only "empty" surfaces (Analytics funnel, thin Partners
joint rooms) are truthful states, excluded above rather than papered over.
