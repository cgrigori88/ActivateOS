# UI Redesign — Wave 4: Execution, Automation & Human Governance

**Starting SHA:** `821da7949781bd7bb895db845977307f45169080` (`ui-wave-3`)
**Branch:** `ui-wave-4`
**Ending SHA:** recorded at the end of this document.
**Scope:** UI / IA / presentation. No schema, migration, RLS, tenant, disclosure, federation, reconciliation, decision/action/outcome semantics, governed-mutation authority, outbox, idempotency, action authorization, revocation, send-flag, Ask, scoring, lifecycle, value, stakeholder, environment or auth change. No new automation platform, campaign engine, agent runtime or approval model. No deployment. Landing page untouched.

---

## The finding that shaped this wave

Queue rows ended in two filled primary buttons, **Done** and **Skip**. `Done` writes `motion_actions.status='done'` — it resolves the *reminder*. It approves nothing, authorizes nothing, sends nothing.

It sat at primary weight on a row reading **"Approve WWT route brief before sending to partner."**

A reasonable operator reads that button as performing the approval. That is precisely the collapse §2 forbids: a queued reminder and a governed decision are different objects, and the interface implied one control did both. On a product whose entire proposition is *governed* action, this is the most expensive kind of ambiguity.

**Fixed as presentation only.** The control is renamed to what it does — **"Mark handled"** — and demoted to subtle, because book-keeping is not the primary act. The primary act is opening where the real decision lives, which the row now leads to. No server action, authority check or status value changed.

---

## Room by room

### Queue (§3) — a work surface, not a task list

**Was:** every row led with `2026-09-02 · cadence · step 1 · Account via Partner`, then one sentence, then two identical blue buttons. Date and mechanism first; commercial consequence entirely absent. Five tiles, one reading "0 from conversations".

**Now, in §3's order:** the work → the account, partner, **what it is worth**, and its owner → then date and mechanism last, at metadata weight. `estimated_value_usd` joins the existing select (additive read on a query that already joined the motion) so a row can state its consequence — the one field that lets an operator choose between two rows. `step 1` survives as trailing metadata rather than a heading.

**On grouping.** §3 asks for buckets like *Decision required / Approval required / Ready to execute*. **I did not build them.** The data model distinguishes source (cadence vs conversation) and due window; it carries no workflow-state column. Deriving those buckets by pattern-matching the action text would be fabrication dressed as semantics, and §3 says explicitly not to fake a distinction the model does not make. Due-bucket grouping is what is real, so it stays; the honest gain was commercial context and authority, which the data does support.

### Skills (§4) — organizational knowledge, not prompt configuration

**Was:** subtitle *"Typed instructions your agents follow, attributed to the runs they grounded"* — an accurate description of the implementation, and the wrong side of the screen. A 400px authoring form sat open beneath a one-item library, so the room's dominant message was "configure something".

**Now:** *"How this organization wants each kind of work performed — written once, followed everywhere."* The form is behind disclosure (the treatment Goals gave its target form in Wave 3), and the textarea label reads **"How the work should be done"** rather than "Instructions the agents will follow". The mechanism is unchanged and still visible on every card.

### Routines (§5) — cadence, and the line against Skills

**Was:** *"Scheduled jobs from a known catalog, each with a visible guardrail"* — how an engineer describes a scheduler.

**Now:** *"What PursuitOS checks on a schedule, so nobody has to remember to."* The Skill/Routine boundary the brief asks for is stated in the room, with a link: **a Skill says how a kind of work is performed; a Routine says when it recurs.** Morning brief and Account digests demonstrate the concept, each carrying its guardrail (*read-only digest · sends nothing on your behalf*) and an unambiguous Running/Paused state.

### Campaigns (§6) — one channel, and the truth about sending

**Was:** no statement of whether the workspace could reach the outside world at all; six tiles reading `0 · 0 · 0 · 0 · — · 0` on an empty workspace.

**Now:** an execution-readiness state at the top, from `resendConfigured()` — the same check the send path itself uses, so the banner cannot claim a readiness the runtime would refuse:

> **EXTERNAL SENDING NOT CONFIGURED** — PursuitOS cannot send email from this workspace. Sequences can still be generated, approved and scheduled — a person sends them. *Set up sending →*

The six zero tiles become one sentence plus the composer that resolves it. The subtitle states the room's place: *"One governed way a motion reaches the market. Nothing leaves without a person."*

### Review (§7) — a governance surface that looks satisfied, not broken

**Was:** the empty-dashboard problem in its purest form — five zero tiles, four filters filtering nothing, and a sentence of engineering prose about sampling and cross-checkers, over 600px of void.

**Now:** empty is a *state*, not a layout. **"You're caught up. No evidence or decisions currently require review."** followed by what would bring work here — drawn only from review reasons this product actually produces. Instruments and filters return the moment there is something to instrument. Also fixed: **Accurate** and **Unsure** were both filled primaries; deferring is not an endorsement.

---

## Customer-facing engineering leakage removed (§6)

| Where | Was | Now |
|---|---|---|
| `briefs/[motionId]` | "Direct sending is disabled until Resend is configured (**RESEND_API_KEY**)" | "**External sending is not configured**, so PursuitOS cannot send anything from here… An administrator can enable direct sending in Admin." |
| `campaigns/[id]` | "…unless **the worker is explicitly armed**" | "Approving does not send. Scheduled touches wait on Upcoming until a person sends them." |
| `upcoming` | "**worker auto-send: armed / off (manual)**" | "Automatic sending is ON" / "Automatic sending is off — every send is a person's action" |
| `upcoming` | "waiting on you (or **the armed worker**)" | "waiting on a person to send" |
| `routines` | "email delivery needs **Resend** configured" | "email delivery is not configured — the brief still runs and appears here" |

No limitation was softened. Each replacement states the boundary at least as plainly as the original, and names what still works.

---

## Execution-state vocabulary (§9)

Each word means exactly one thing, and no word implies the next stage:

| Word | Means | Does **not** mean |
|---|---|---|
| **recommended** | the system's conclusion | that a human agreed |
| **draft / generated** | content exists | that it was approved |
| **approved** | a person authorized it | that it was scheduled or sent |
| **scheduled** | it has a date | that it was delivered |
| **sent** | it actually left | that it was received or worked |
| **queued** | it is on the worklist | that it was executed |
| **handled** | the reminder is closed | that the underlying decision was made |
| **paused / running** | a routine's state | anything about outcomes |
| **won** | a settled outcome | anything about attribution |

The load-bearing additions this wave: **handled ≠ approved** (the Queue fix), **approved ≠ sent**, and **scheduled ≠ delivered**.

---

## External-send verification (§10) — stated precisely

| Check | Result |
|---|---|
| `OUTREACH_AUTOSEND` in this environment | **unset** — no automatic sending |
| `send.ts` when unconfigured | **fails closed** — throws before a provider is constructed, and marks the message `failed` rather than silently succeeding |
| `campaign_touches` in the demo world | **4 of 4 `draft`** — nothing is `sent` |
| UI claims an external action occurred | **no** — Campaigns and Upcoming both state the sending posture explicitly |
| Synthetic data able to trigger a send | **no path found** — every send route passes the same `resendConfigured()` gate |

**One thing I must not overstate.** `RESEND_API_KEY` **is present in this repository's `.env.local`**, which Next loads automatically, so on *this local machine* `resendConfigured()` returns true and the "not configured" banner correctly does not render. I therefore captured the unconfigured state on a second server started with the key blanked. What I verified is that the guard is correct and fail-closed and that nothing in the demo world is in a sent state. **I did not verify the deployed demo's environment variables** — I have no access to them from here, and I am not going to infer a production posture from my local box. If the certified demo must be provably incapable of sending, the deployment's `RESEND_API_KEY` should be confirmed absent by someone who can read it.

---

## Cross-linking (§8)

The execution spine (`components/execution-model.tsx`) renders on Queue, Skills, Routines, Campaigns and Review:

**DECISION → QUEUE → SKILL → ROUTINE → EXECUTION → REVIEW → OUTCOME**

Every step routes to a page that exists (`/pursuits`, `/queue`, `/skills`, `/routines`, `/campaigns`, `/review`, `/insights`); each room hands it its own counts. Queue rows link to the motion brief or the account — relationships already carried by `motion_actions → revenue_motions → companies`. **No relationship was invented**, and where one does not exist the step renders as text rather than a link that lies.

---

## Screenshot QA (§13) — generated **and inspected**

12 captures: Queue (default and grouped), Skills, Skill authoring, Routines, Campaigns (configured **and** unconfigured), Review empty, Upcoming with sending off, a cross-linked journey, plus Queue and Campaigns at 1280.

**All HTTP 200. Zero JS/console errors. Zero horizontal overflow at either width.**

Repaired after inspection: "Mark handled" and "Skip" ran together as one phrase (separator added); the Campaigns zero-tile band on an empty workspace (replaced with a purposeful empty state).

## Tests (§14)

| Suite | Result |
|---|---|
| `tsc --noEmit` | clean |
| `next build` | clean |
| `visual-system-check` (12 rules, 358 files) | clean |
| disclosure · isolation · federation · scope · governed-mutation | 21 · 12 · 19 · 17 · 13 |
| outcomes · tenant-flags · **outbox** · observability · contributions · append-only | 18 · 13 · **20** · 13 · 12 · 11 |
| **Total** | **169 passed, 0 failed** |

### Known pre-existing failures — signatures confirmed identical

| Script | Signature | Unchanged? |
|---|---|---|
| `pursuit-verify` / `routes-verify` / `experience-verify` | `null value in column "slug" of relation "taxonomy_nodes"` | yes |
| `governance-verify` | `current transaction is aborted` (downstream of the same fixture failure) | yes |

Not repaired in this wave, per §14.

---

## Deferred

- **`taxonomy_nodes.slug` fixture drift** — data-layer; out of scope for a presentation wave.
- **Queue operating buckets** (Decision / Approval / Evidence / Ready to execute) — needs a workflow-state the model does not carry. Adding one is a domain change, explicitly outside this wave's boundary.
- **Deployed demo's send configuration** — see §10 above; needs someone with access to the deployment's environment.
- **Test-org data visible in the composer** (an account named "A Co 2fojry", two stray `G1 Vendor …` orgs owning the only campaigns) — a seed-hygiene issue, not a UI one, and the reason Campaigns renders its empty state in this tenant.

---

## Success test

> *PursuitOS identified what matters. This is the work that now needs to happen. These are the rules for how we perform that work. These routines make sure it happens repeatedly. This execution can be prepared safely. A human remains in control where authority is required. And the system records what actually happened.*

Each sentence now has a room that states it, a spine that places it, and — critically — a vocabulary that keeps *prepared*, *approved*, *scheduled* and *sent* from blurring into one another. The one place the product previously blurred them, the Queue's `Done` button, was the first thing fixed.
