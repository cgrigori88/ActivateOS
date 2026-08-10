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
Auth gate in `src/middleware.ts` — it holds no customer data and reads nothing
from the database.

It is a recreation of a supplied reference design (a QClay-style animated
fintech landing page), rebuilt around our own copy, mark and wordmark. Ten
sections: navbar, hero, about, numbers, bento grid, performance dashboard,
expense/motion grid, product truths, FAQ, footer CTA.

**This section is deliberately exempt from §3.** The cockpit is calm, neutral
and dense; the landing page is cinematic and animated, and that is the point —
it has a different job and a different audience. §3 still governs every
authenticated screen. The landing styles live in `src/app/landing/landing.css`,
scoped under `.cirform` so nothing leaks into the app.

### Stack notes

The reference was written for TanStack Start + Vite. Ported to the Next.js App
Router: the route files became `page.tsx` (server, metadata) plus `Landing.tsx`
(client), the shadcn `Button` import was inlined, and the reference's global
`@theme` block was *not* reproduced — redefining `--background` / `--card` /
`--border` globally would have restyled every cockpit screen. Only new colour
names (`ink`, `night`, `brand`) were added to the app theme.

Motion: Framer Motion for component animation, count-ups, cursor and marquee;
GSAP + ScrollTrigger for scroll reveals and the dashboard; Lenis for desktop
smooth scroll only (disabled under 1024px). All animation is clamped under
`prefers-reduced-motion`.

### The hero mesh

`src/app/landing/HeroMesh.tsx` replaces the hero video with the mark rendered
as a slowly rotating wireframe (Three.js, imported dynamically so it stays out
of the initial bundle).

The reference this came from used a `TorusGeometry` — one hole. The subject here
is our own mark instead: a `Shape` carrying two circular holes, taken straight
from the handoff's construction and recentred for WebGL — outer circle at
(0, 0) r20, large counter at (-5, -2) r10, small counter at (11, 7) r4. The
counters land 18.36 units apart on a bearing of 29.36°, which is the handoff's
fixed bearing.

Everything else is kept from the reference: two layered `LineBasicMaterial`s
(#2563eb at 0.15 and #60a5fa at 0.10, additive, `depthWrite` off, the inner copy
scaled to 0.98 and offset half a segment), and the rotation — `time += 0.0015`,
`rotation.z = time * 0.5`, a `sin` wobble on y, and a gentle float.

Two things worth knowing if you tune it:

- **The extruded caps are discarded.** Only the swept side walls (materialIndex
  1) are wireframed. The caps are earcut-triangulated and read as coarse
  triangle fans across the face; the walls are a regular ring grid, which is
  what gives the reference's torus its even density.
- **The profile is pre-compensated for the bevel.** Bevelling grows the outer
  edge outward and eats each hole inward, so the shape is drawn with its outer
  circle one unit smaller and both counters one unit larger. After bevelling the
  silhouette is the mark at true proportions. Without it the small counter loses
  half its radius and the mark stops reading as aim.
- **Segment counts track the reference torus** (radialSegments 120, tubular 250):
  220 along each contour, 58 rings around the profile.
- **The mark scales with aspect ratio.** On a narrow viewport the visible width
  collapses, so it shrinks and recentres rather than pushing the small counter
  off the right edge.

### Two things to settle before this goes public

1. **Media is hot-linked from `qclay.design`.** The hero video, portraits and
   icons all load from the reference's origin. That is someone else's CDN and
   someone else's media — fine for a preview, not for a production site. These
   need to be replaced with our own assets, or at minimum self-hosted with
   permission, before launch.
2. **The testimonial carousel carries no testimonials.** The reference had
   named people at named banks. We have no customers yet — we are taking our
   first design partners — so inventing quotes would be publishing fabricated
   endorsements. The section keeps its design and animation and carries the
   three product truths from §1 instead. Swap in real quotes once a design
   partner has agreed to be named.

Pricing is also absent. The brief carries real numbers; publishing them is a
commercial decision, not a design one.
