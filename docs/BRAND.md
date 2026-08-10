# PursuitOS Brand Kit

Derived from the marketing site (`/landing`). The site is the source: this
document codifies what it already does so the product can carry the same
identity. Tokens live in `src/app/globals.css`; primitives in
`src/components/ui.tsx`; the shell in `src/components/shell.tsx`.

**Clean-room rule still applies.** Competitor and internal-tool recordings
inform the category feature bar only. No layout, screen, naming, workflow or
data from any third-party tool is reproduced in this product.

---

## 1. The idea

PursuitOS answers *"what should happen next, and why?"* The identity has one
job: make a dense decision surface feel calm and trustworthy. Confidence comes
from restraint — generous space, strict hierarchy, one accent that always means
something.

Three rules govern everything below:

1. **Neutral carries the interface. Colour carries meaning.** A screen is
   near-white or near-black with one blue accent. Every other colour is a
   semantic signal, never decoration.
2. **Numbers are typography.** Tabular figures everywhere, scores set large with
   their band, deltas always signed.
3. **Whitespace separates, not boxes.** No cards inside cards inside cards. A
   hairline and space do the work a border used to.

## 2. The mark

From the brand handoff: a circle carrying two voids on one axis. The large void
behind is the system; the small void ahead is the account it has isolated.

- Never rotate it — the bearing is fixed at 29°.
- Never colour the counters separately. One colour only.
- Never outline it. There is no stroked variant.
- Minimum 14px. At 16px and below the forward counter drops and it runs solid.
- Clear space on all sides equals half the mark's height.

**Wordmark**: "PursuitOS" in Instrument Sans 500. Tracking tightens as size
grows: −0.046em at 34px, −0.040em at 23px, −0.026em at 15px.

**Primary lockup**: mark + wordmark on one line, gap 40% of the mark's height.
It is the sidebar wordmark and the site header lockup.

## 3. Colour

### Brand

| Token | Light | Use |
|---|---|---|
| `accent` | `#2563EB` | The one accent. Primary actions, active nav, the assertion. |
| `accent-strong` | `#1D4ED8` | Hover and pressed. |
| `accent-tint` | `#60A5FA` | Accent on dark ground, secondary marks. |
| `accent-wash` | `#EFF5FF` | Selected rows, active nav background, quiet fills. |

Keep the accent under roughly 10% of any screen. If two things are blue and only
one is the action, demote the other to neutral.

### Ink and ground

Built from a cool neutral ramp so the greys sit with the blue rather than
fighting it. `neutral-950` is a blue-black, not a true black.

| Role | Light | Dark |
|---|---|---|
| Page ground | `neutral-50` | `neutral-950` |
| Raised surface | `white` | `neutral-900` |
| Hairline | `neutral-200` | `neutral-800` |
| Body text | `neutral-900` | `neutral-100` |
| Secondary text | `neutral-500` | `neutral-400` |
| Faint / meta | `neutral-400` | `neutral-500` |

### Semantic

Bands and statuses describe the data. They never mean "success" or "error" in
the chrome — the accent does that.

| Meaning | Colour |
|---|---|
| Band very high / positive | green `#15803D` |
| Band high | accent blue |
| Band medium / timing | amber `#B45309` |
| Band low / inert | neutral |
| Negative / failed | red `#B91C1C` |

**Conviction ramp** for propensity heat, 0.00 → 1.00:
`neutral-200` → `#9BBEFF` → `#60A5FA` → `#3B82F6` → `#2563EB`.

## 4. Typography

| Role | Size | Weight | Notes |
|---|---|---|---|
| Page title | 24px | 600 | tracking −0.02em |
| Section heading | 15px | 600 | sentence case, not uppercase |
| Eyebrow | 11px | 600 | uppercase, 0.08em tracking, neutral-500 |
| Body | 14px | 400 | line-height 1.6 |
| Meta | 12–13px | 400 | neutral-500 |
| Metric | 24–32px | 600 | `.tnum`, tracking −0.02em |
| Table cell | 13.5px | 400 | `.tnum` on every numeric column |

Interface type is the system sans. Instrument Sans is reserved for the wordmark.
Playfair Display italic belongs to the marketing site only — it does not appear
in the product.

## 5. Shape, depth, motion

- **Radii**: 6px controls, 10px inputs and chips, 14px cards, 999px pills.
- **Depth**: one soft shadow for raised surfaces, one for popovers. No shadow on
  a resting card — a hairline is enough. No inner shadows, no glows.
- **Focus**: a 2px accent ring at 2px offset. Never remove it.
- **Motion**: 120ms for hover, focus and press — border and surface step
  together, never opacity alone. 200ms for entering content. Nothing loops,
  pulses or shimmers. All of it clamps under `prefers-reduced-motion`.

## 6. Density

The product is data-dense by design, so space is the counterweight.

- Table rows: 44px min, 12px vertical padding, hairline separators at
  `neutral-100` / `neutral-800`.
- Card padding: 20px, 24px on wide surfaces.
- Page gutter: 24px mobile, 32px desktop. Content maxes at 1400px.
- Stack rhythm: 24px between sections, 12px within a group.

## 7. Voice

Declarative and evidence-first. Numbers set tight, always tabular.

Write these:
- Know where revenue moves next.
- This account is moving. Here is the evidence.
- Confidence 0.72, from 41 evidence points.

Never these:
- AI-powered revenue intelligence
- Supercharge your pipeline
- Seamless, end-to-end, best-in-class

## 8. Where it lives

- **Tokens** — `src/app/globals.css`. The `neutral` and `blue` ramps are
  overridden at the theme level, so every existing screen picks up the palette
  without its markup changing.
- **Primitives** — `src/components/ui.tsx`. Export names and props are stable;
  the platform lane's screens consume them unchanged.
- **Shell** — `src/components/shell.tsx`.
- **Living reference** — `/styleguide` renders every primitive in every state.
  It sits behind the auth gate; it is not public.
