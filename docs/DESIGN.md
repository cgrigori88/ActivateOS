# PursuitOS Front-End Design Brief

The front end must be top-of-class against ecosystem-revenue platforms
(Crossbeam-style data browsers) and internal vendor outreach consoles. We do
not win by matching their dashboards feature-for-feature — we win by shipping
the interface those categories don't have: a **decision cockpit**.

**Clean-room rule:** competitor and internal-tool screenshots inform the
*category feature bar* only. No layout, screen, naming, workflow, or data from
any third-party or employer-internal tool is reproduced here. Everything below
is our own design, derived from our own product thesis.

---

## 1. UX thesis — the decision cockpit

Competing surfaces answer "what is happening?" (analytics consoles) or "what
data do we share?" (overlap browsers). PursuitOS answers **"what should
happen next, and why?"** Every screen is organized around a decision the
operator can take right now, with the evidence to take it confidently.

Three product truths drive every screen:

1. **Every number explains itself.** Any score, band, or recommendation opens
   into its feature contributions and cited evidence in one click. This is our
   deepest differentiator — make it *felt* everywhere, not buried in a detail
   page.
2. **Approval is the workflow, not a feature.** Drafts (motions, campaigns,
   evidence verdicts) flow through queues designed like a great code-review
   tool: fast, keyboard-driven, always showing exactly what you need to
   decide, never more.
3. **Trust is visible.** The source-trust ledger, sampling rates, and agent
   decision logs are first-class UI. Operators should *see* the system earning
   autonomy.

## 2. Information architecture

| Route | Job |
|---|---|
| `/` **Today** | The decision queue: pending motion approvals, evidence review count, top new opportunities since last visit. Zero-state = "all clear." |
| `/accounts` | Ranked portfolio. Filters: band, solution, partner, signal freshness. Row expands to WHY NOW inline — no page hop to see the reason. |
| `/accounts/[id]` **Account room** | The narrative: score → evidence timeline → motion → campaign assets → outcome events, as one coherent story. |
| `/motions` | Board by status (draft → approved → active → completed/abandoned). Draft cards approve/reject inline with edit capture. |
| `/review` | Evidence verdict queue + trust ledger. j/k keyboard flow; verdict in one keystroke. |
| `/sources` (later) | Source health: trust curves, quarantine rates, drift alerts. |
| `/outcomes` (later) | Funnel from motions → meetings → opportunities; lift vs. baseline once real outcomes accrue. |

## 3. Visual language

- **Calm density.** Data-rich tables with generous line height and strict
  typographic hierarchy; whitespace does the separating, not boxes-in-boxes.
- **Neutral base, semantic color only.** Near-white/near-black surfaces; color
  reserved for meaning: band scale (very high → low), status (draft/approved/
  active), signal direction (positive/negative). One restrained brand accent.
  No gradients, no decoration for its own sake.
- **Numbers are typography.** Tabular numerals everywhere; scores rendered
  large with their band, deltas always signed; evidence confidence shown as
  quiet meta-text, never as chart junk.
- **Evidence styling.** Claims quote-styled with source + date + confidence;
  citations render as chips that expand to the underlying excerpt.
- **Light and dark**, system-following, equal quality in both.

## 4. Interaction standards

- Sub-100ms perceived actions: optimistic updates on verdicts and approvals.
- Keyboard-first queues (j/k navigate, single-key verdicts, Enter approves);
  command palette (⌘K) for account/motion jump once route count grows.
- Every list state shareable by URL (filters in query params).
- Empty states teach: each screen's zero-state explains what fills it and
  which command/agent produces the data.

## 5. Build approach

- Tailwind CSS v4 for the design system (tokens in CSS, no config sprawl);
  small hand-rolled components over heavy UI kits — the surface area is
  tables, queues, cards, and chips, all of which we want pixel-exact.
- Server components + server actions (already in place) stay; interactivity
  is added per-component only where needed (queues, palette).
- Design tokens defined once: band scale, status scale, surface/ink ramps,
  spacing, radii. Charts (later) follow the same tokens.

---

## 6. Meridian — the brand system (added in the design lane)

The client-supplied kit `design_handoff_pursuitos_brand` ("Meridian") is now the
authority on colour, type, radii and motion for the **marketing surface**. It is
high-fidelity: values are final and exact, and are reproduced rather than tuned.

- **Tokens** live in `src/app/globals.css` as `--pos-*` custom properties, taken
  verbatim from the kit's `tokens.css`.
- **Primitives** live in `src/components/brand.tsx`, deliberately separate from
  `src/components/ui.tsx` so the marketing surface can adopt the brand without
  colliding with the platform lane's edits to the app primitives.
- **Type**: Instrument Sans (display/interface) + JetBrains Mono (every number,
  without exception, tabular figures always on), loaded in `src/app/layout.tsx`
  as `--font-pos-sans` / `--font-pos-mono`.
- **Ground** is fixed at `--pos-canvas` (#040D43) and must never be shifted by a
  background treatment.
- **Accent** `--pos-accent` marks exactly one thing per screen — what the system
  is asserting — and stays under 6% of any surface. The warm pair (honey,
  canary) is emphasis only: section numbers and timing, never a button or fill.
- **Market-signal colours are data.** They describe the market; they never mean
  success or error in the interface. Use the accent for that.

### The background field

The kit ships without one by design. Ours is `src/app/landing/beam.tsx` and
satisfies the four stated constraints: the ground value is never shifted; no
colour sits under body copy (beams are parked outside the reading column and
panels carry opaque surfaces); the field resolves into the ground through an
~800px scrim rather than ending on an edge; and scroll is the only clock — it
translates against page progress at ~a fifth of scroll speed and crossfades
three fixed temperatures, with no timeline of its own. Clamped to none under
`prefers-reduced-motion`.

### Open: does Meridian apply app-wide?

§3 above describes the current app chrome — neutral base, light and dark of
equal quality. Meridian is a fixed dark navy ground with a different palette and
type pairing. **The two cannot both be true.** Meridian is currently scoped to
the `.meridian` class so only `/landing` uses it; the app screens are untouched.
Rolling it through the cockpit is a large, separate change to screens the
platform lane is actively building, and needs an explicit decision before it
starts. Until then, §3 governs the app and §6 governs the marketing surface.
