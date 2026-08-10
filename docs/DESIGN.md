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

## 6. The mark and wordmark

The brand handoff supplies the identity; §3 above still governs the visual
language. We take **only the mark and the wordmark** from that kit. Its palette,
type scale, dark navy ground and motion rules are deliberately *not* adopted:
they are derived from a third party's brand guidelines and would contradict the
neutral, light-and-dark-equal system described in §3.

- `src/components/brand.tsx` holds `Mark` and `Lockup`, and nothing else.
- The mark is a circle carrying two voids on one axis. Never rotate it (the
  bearing is fixed at 29°), never colour the counters separately, never outline
  it. At 16px and below the forward counter is dropped and it runs solid — the
  favicon in `src/app/icon.svg` uses that solid variant.
- The wordmark is "PursuitOS" at weight 500, tracking tightening as size grows
  (-0.046em at 34px, -0.040em at 23px, -0.026em at 15px). Instrument Sans is
  loaded for this one purpose via `--font-brand`; interface and body type stay
  on the system stack.
- Primary lockup only: mark + wordmark on one line, gap 40% of the mark's
  height. It is the sidebar wordmark in `shell.tsx` and the header and footer
  lockup on `/landing`.

## 7. The public landing page

`/landing` is the marketing surface and the one route excluded from the Basic
Auth gate in `src/middleware.ts` — it holds no customer data. It is a server
component with no database access, so it prerenders as static.

Its argument is the one from PROJECT_BRIEF §1: the channel has an activation
problem, not a recruitment problem. The page runs problem → proof → mechanism →
offer, with the pursuit surface embedded mid-page as evidence rather than as the
pitch, because what we are selling today is a 30-Day Partner Activation
engagement, not self-serve SaaS.

Pricing is deliberately absent. The brief carries real numbers; publishing them
is a commercial decision, not a design one.
