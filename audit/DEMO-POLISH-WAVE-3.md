# PursuitOS — Final Overnight Demo Polish (Wave 3)

**Branch** `claude/activateos-platform-review-xzkgmd` · **From** `f0bbcaf` (Wave 2)
**Scope** Presentation only, on the demo path. No features, no schema, no logic.

---

## 1. Certification — PASSED

Local production build, reseeded synthetic demo database, **1440 and 1280**.

`Today → Mapping → Pursuit → Sponsor/Partner → Trust → Pipeline Attention → Portfolio → Goals → Ask → Insights`

| Check | Result |
|---|---|
| 9 stops × 2 widths render, HTTP 200, page title present | **18 / 18** |
| Page errors / console errors | **none** |
| Horizontal overflow | **none** |
| Malformed money | **none** |
| Dead links on the journey | **none** |
| Demo state identifiable | **18 / 18** |
| Sponsor ⇄ Partner, both directions | **works** |
| **Confidential figure in sponsor DOM, absent from partner DOM** | **verified** |
| Pipeline Attention/Portfolio/All/Review, correct segment selected | **4 / 4** |
| Attention fold opens | **yes** |
| Mapping matrix drill-in + way back | **works** |
| Ask deterministic example answers; provenance behind disclosure | **works** |
| Outbound `api/build` without token | **404 — fail-closed** |
| `tsc --noEmit` | clean |
| `npm test` | **149 / 149** |
| `scope:verify` · `append-only:verify` · `microloop:verify` | **3 / 3 ok** |
| `visual-system-check` | clean — 354 files |
| `next build` | exit 0 |

Screenshots: `audit/wave3/01-today.png` … `10-insights.png` + `04-pursuit-partner-view.png`.

---

## 2. UI changes

**Today** — decision list 6 → **4** (a `limit` on an already-ranked read model; ordering, materiality
and decision logic untouched, "View all 36 decisions" still reaches every one). Systems-disagree
hint cut to `record vs deal`. **2211 → 1976px**, so "what changed materially" now sits in the first
viewport under the metrics and the four decisions.

**Mapping** — the overlap count is the room's point, so it now looks like it: cell figure at display
weight, an `open →` affordance on hover, accent focus/hover ring, and a title naming the drill-in.
Row/column totals and empty cells stepped back to context weight.

**Pursuit Detail** — no restructure. All nine demo anchors intact.

**Sponsor ⇄ Partner** — behaviour untouched. Added one line beside the control, visible in **both**
states: *"N confidential figures are never sent to the partner."* Same count, same source
(`figuresRemoved`) the partner caption already used — nothing new computed. Previously the control
announced nothing, so a viewer had to switch and notice an *absence*, which is the hardest thing to
notice. Now the switch verifies a claim already made.

**Trust** — zero-state telemetry reads as absence of activity, not absence of capability:
"This tenant has not recorded a consequential act yet" instead of "0 entries recorded". Guarantees
unchanged; no claim strengthened.

**Pipeline** — Attention shows the top 4 at full weight, the rest behind "N more needing attention".
Same list, same order, nothing filtered. **2567 → 1887px (−27%)**.

**Goals** — one compact affordance at the contribution figure: `motion-level · the roll-up below is
opportunity-level`, with the full distinction in its tooltip. No paragraph, no implication they
reconcile.

**Ask** — inspected, unchanged. The hierarchy was already question → answer → magnitude → action →
provenance, with provenance behind *Why this answer*.

**Insights** — the "Observed outcomes" band heading was sitting *below* two of the cards it covers
(and inside a conditional). Moved above attribution + partner activation + funnel, so the first
viewport reads outcomes → partner activation → calibration.

**Segmented controls — the sweep's real finding.** Wave 2 left **three** hand-rolled ones because my
sweep keyed on `role="tablist"`, and one of them didn't have it:

- the Pursuit brief drawer's audience toggle (own track, 7px off-token radius, filled hue that
  changed with audience);
- **Pipeline's primary view switcher** — `<a>` links with no `role="tablist"`, which is exactly why
  the earlier sweep missed it;
- and the helpers themselves moved to `src/components/segmented.ts`.

Every segmented control in the app now shares one grammar. **0 hand-rolled controls remain on the
demo path.**

---

## 3. Two things worth knowing

**A build that passes can still throw.** Moving Pipeline's tabs onto the shared helper compiled
clean and then returned **HTTP 500** at request time: `room-tabs.tsx` is `"use client"`, and a
server component cannot call a function exported from it. A function that takes a boolean and
returns a string has no business being client-only, so the class strings now live in
`segmented.ts` and only the interactive components stay client. Caught by certification, not by the
build.

**The certification broke the demo's hero moment, and that is a finding, not an accident.**
Mid-run the Sponsor/Partner assertion failed: the pursuit's sponsor view no longer contained
`$1,288,000`. The data was intact — the pursuit had acquired a **second route snapshot**
(`route_status = SELECTED`), and the room correctly reads the current one, which carries different
reasons. A governed route decision had been recorded during an earlier interactive pass.

That means **the Approve controls are live governed mutations**, and exercising them changes what
the room shows for the rest of the session. I restored the canonical world with the seed and
re-certified. I also changed the certification to select its pursuit **by querying for one that
carries a confidential figure on its current snapshot**, rather than taking whichever pursuit is
listed first — so the assertion can no longer pass or fail by accident.

---

## 4. Remaining caveats for the morning

1. **Clicking "Approve" during the demo is a real decision.** It writes a new route snapshot and
   changes that pursuit's reasons — including whether it still carries a confidential figure. If the
   Sponsor/Partner moment is planned, **do the disclosure demo before approving anything**, or
   reseed after rehearsal. Nine pursuits currently carry a confidential figure, so one approval will
   not exhaust the story.
2. **Trust shows `0` audit entries and `0` providers** for a fresh tenant. True, deliberately not
   padded, and now phrased as absence of activity.
3. **Insights samples are tiny** (8 closed deals; calibration `Observed` all `—`). The three bands
   say so structurally.
4. **Goals $1.25M vs roll-up $3.67M** — different measures, now named at the figure.
5. **Motions has the one remaining hand-rolled segmented control.** Off the demo path; §12 says do
   not clean up unrelated rooms, so it was left and is recorded here.
6. **Not exercised:** ⌘K, account drawers, form submissions, and the governed mutations themselves
   (Approve route, Confirm team member) — those write, and this pass did not drive writes.

---

## 5. Deployment status for the morning

**The live demo host still needs a deploy and a reseed.** Nothing in this pass touched production,
`app.pursuitos.io`, or the hosted demo — all work was local. Specifically, the hosted demo tenant:

- runs the pre-Wave-2 build, so none of the last two passes' UI is live;
- has **not** been seeded with the demo goal or the positioning skill (`scripts/demo-goal.ts`);
- still carries the pre-Wave-1 `$1288000` string in `route_candidate_reasons`, which only a reseed
  replaces with `$1,288,000`.

So the morning sequence is: deploy this SHA to the demo project, then run the demo seed against the
demo database, then re-walk the journey once before the call.

---

## 6. Hard-stop rules

Nothing was added, migrated, or altered in schema, RLS, disclosure, federation,
recommendation-vs-decision semantics, scoring, canonical data, production, `app.pursuitos.io`, or
outbound sending. Demo-story records were **restored** by their own seed, never edited. No unrelated
room was cleaned up. No item had to be skipped for these reasons.
