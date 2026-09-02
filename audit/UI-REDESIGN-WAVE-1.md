# PursuitOS — UI/UX Redesign Wave 1: Visual System Lock

**Branch** `claude/activateos-platform-review-xzkgmd`
**Started from** `34dcc8e` — *Mark the app and demo deployments noindex*
**Scope** One production-quality visual system, established and enforced. Not a page-by-page redesign.

This wave changes how PursuitOS *looks*. It changes nothing about what it knows, what it
recommends, who may see what, or what it does. No migrations were written, no environment was
deployed, and the public landing page was not touched.

---

## 1. What was wrong

The audit measured the interface rather than describing it. Counts are occurrences across the
352 `.ts`/`.tsx` files under `src/` at `34dcc8e`.

| Measured at `34dcc8e` | Count | What it meant on screen |
|---|---:|---|
| `text-xs` / `text-sm` / `text-base` / `text-2xl`…| **1,040** | A second type scale running in parallel with the named roles. Two systems, no rule for which applied. |
| `rounded-sm` / `-md` / `-lg` | **284** | Three Tailwind radii competing with the five design tokens. |
| bare `rounded` (4px) | **70** | A fourth. The easiest one to type, so the most common. |
| Page-authored filled-button colours | **87** | Blue, green, violet and near-black CTAs doing one job. |
| Hand-rolled thousands formatters (`Math.round(n/1000)` + `k`) | **80** | The source of `$6250k`. |
| `Intl` currency formatters | **3** | A separate rounding policy, invisible to the codemod that fixed the other 80. |
| `buttonClass()` call sites | **3** | A contract existed and almost nothing used it. |
| `fieldClass()` call sites | **0** | No form-control contract at all. |

The clearest symptom was money. **`$6250k`** shipped: an amount over six million rendered in
thousands, because the local helper on that page had one branch. A reader has to count digits to
know whether `$6250k` is six million or six hundred thousand, and on a screen shown to a
distributor that is a commercial problem, not a cosmetic one.

The second-clearest was a page disagreeing with itself. The Pursuit hero read **`$1.3M`** while
its own value case, two panels down, read **`$1.25M`** — the same stored amount through two
formatters with different rounding.

---

## 2. What the wave established

### One money formatter — `src/lib/format/money.ts`

Every commercial amount in the product now becomes text in exactly one place.

| Function | Job |
|---|---|
| `formatMoney` | Commercial amounts. `6_250_000 → "$6.25M"`, `920_000 → "$920K"`, `847 → "$847"`. |
| `formatMoneyExact` | Where the exact figure is the point — a settlement line, a value-case input. |
| `formatCost` | Operational spend where fractions of a cent are the unit (model cost). |
| `formatCompact` | Non-currency quantities. |

Decisions worth recording:

- **The unit is chosen after rounding, not before.** `$999,999` is under a million, so a naive
  band test picks K, and rounding then produces `$1000K` — a value rendered outside its own unit.
  Promoting when the rounded figure reaches 1000 gives `$1M`, which is what the number is.
- **`null` is not `$0`.** PursuitOS treats UNKNOWN and zero as different facts. The formatter
  returns a caller-supplied fallback (default `—`) for null/undefined/NaN and `"$0"` only for an
  actual zero. A formatter that rendered null as `$0` would erase a distinction the product is
  built on.
- **A currency code resolves its own symbol, and never converts.** An unrecognized code renders
  as the code (`ZZZ1.25M`), never as `$`. Printing `$` beside an amount held in another currency
  misstates what the number is.

### One button contract — `buttonClass(variant, size)`

`primary · secondary · ghost · destructive · subtle`, in `sm/md/lg`. `accent` and `danger` remain
as deprecated aliases so nothing broke on the way. **3 → 153** call sites.

Colour now means one thing: a filled accent button is the primary action. Where a page had
painted its own — Pursuit's route approval in route-blue, its team confirmations in readiness
green, the override commit in amber, the login page's owner-creation in emerald — those are the
primary action of their own form and now look like it.

**Where that cost something, and why it was still right.** The amber on *Commit override* carried
a caution the plain contract does not. That caution now lives where it belongs: the override form
requires a written reason before the button enables, and the panel says the recommendation is
preserved either way. A one-off button hue that nothing else on the screen shares is a weak place
to keep a warning.

### One form-control contract — `fieldClass(size, opts)`

**0 → 43** call sites. Heights match the button scale exactly, so a search field beside a button
does not sit two pixels proud of it.

### One segmented control — `src/components/room-tabs.tsx`

The selected tab was filled in brand blue, putting it in direct competition with the primary
button on the same screen — two saturated blue rectangles, one a navigation state and one an
action, indistinguishable by colour. The track is now a quiet inset and the selected segment a
raised surface with high-contrast ink. Selection reads as elevation; the accent is reserved for
focus.

### One radius set, one type scale

Named sizes (`text-micro` 10 … `text-hero` 30) and tokens (`rounded-inner` 8 · `control` 10 ·
`input` 12 · `card` 18 · `panel` 22 · `full`). `rounded-full` stays legal everywhere — a pill *is*
a radius in this system.

### Absence has one grammar — `<Absence>`

`unknown` (dotted underline — we do not know) · `unavailable` · `disabled` · `empty`. A **known
zero is not absence** and goes through the value path, so `$0 settled` reads as a fact and an
unestablished amount reads as unestablished.

---

## 3. Result

| Measure | `34dcc8e` | Now |
|---|---:|---:|
| Parallel type scale (`text-xs`/`sm`/`base`/…) | 1,040 | **0** |
| Tailwind radii `rounded-sm/md/lg` | 284 | **0** |
| bare `rounded` (4px) | 70 | **0**¹ |
| Page-authored filled-button colours | 87 | **0** |
| Hand-rolled thousands formatters | 80 | **0** |
| `Intl` currency formatters | 3 | **1**² |
| Inline pixel `fontSize` | 6 | **5**³ |
| `buttonClass()` call sites | 3 | **153** |
| `fieldClass()` call sites | 0 | **43** |
| `format{Money,Cost,MoneyExact,Compact}()` call sites | 0 | **95** |

¹ One occurrence remains, inside a prose comment in `money.ts`.
² The sanctioned currency-symbol lookup inside `money.ts` itself.
³ All five in `app/global-error.tsx`, which renders when the root layout has failed and therefore
cannot assume the stylesheet loaded. Explicitly exempted.

---

## 4. The lock — `scripts/visual-system-check.ts`

The previous normalization held for exactly as long as nobody added a page, because nothing failed
when they did. Eleven rules now fail the build instead:

`arbitrary-font-size` · `half-pixel-font-size` · `inline-font-size` · `parallel-type-scale` ·
`page-authored-button-colour` · `inline-styled-button` · `parallel-money-formatter` ·
`page-local-radius` · `page-local-shadow` · `dom-position-colour` · `doubled-currency-symbol` ·
`hand-rolled-money`

```
npx tsx scripts/visual-system-check.ts            # whole app
npx tsx scripts/visual-system-check.ts --staged   # staged files only
```

**It is deliberately narrow.** Each rule encodes a violation the audit actually measured, and each
has an escape hatch for the legitimate exception. A detector that cries wolf gets suppressed, and a
suppressed detector is worse than none. Charts and canvases are exempt by path; comments are
stripped before checking, because describing the old world is what a comment is for.

Three rules exist because they caught something the others missed:

- **`inline-styled-button`** — the className rule only sees Tailwind utilities. Pursuit painted its
  CTAs through `style={{ background: "var(--color-route)" }}`, invisible to it.
- **`parallel-money-formatter`** — the two `Intl` formatters did not look like the
  `Math.round(n/1000)` shape the money codemod matched, so they survived it. They are the reason
  the hero and the value case disagreed.
- **`inline-font-size`** — the half-pixel rule could not see `fontSize` inside a ternary, which is
  exactly where Pipeline's off-scale `17 / 15 / 13.5` ramp was living.

Every rule was verified to fire by injecting the violation it targets and confirming a non-zero
exit, then removing it.

---

## 5. Verification

All run at the final tree state.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` | **149 / 149 pass** (was 130 before the wave; +19 money-format assertions) |
| `npx next build` | exit 0 |
| `npx tsx scripts/visual-system-check.ts` | clean — 353 files |
| Rendered-DOM sweep, 28 routes | **0 problems, 130 amounts checked** |
| Screenshot walk, 1440 + 1280 | **no page errors, no horizontal overflow** |

### The DOM sweep

Regex over source is not evidence about what a reader sees, so every room was fetched from a
running production build and the **rendered DOM** (scripts stripped) checked for doubled symbols,
four-digit thousands, lowercase `k`, `$0k`, `$NaN`, un-abbreviated seven-digit amounts, raw float
tails, and React error boundaries.

This mattered. Mid-wave I grepped the *served HTML* for `$$` and found 28 hits, and briefly
concluded the doubled-symbol fix had not taken. It had. In the RSC flight payload `$` is the
reference marker (`"$"`, `"$L13"`), so a string that genuinely begins with `$` is escaped by
doubling it — `"$$6.25M"` in the payload is `$6.25M` in the DOM. **The measurement was wrong, not
the code.** Separating the DOM from the payload is why the sweep is trustworthy.

### Screenshots — `audit/wave1/`

14 captures: Today, Pipeline, Accounts, Ask, Admin, Pursuits, Partners, Motions, a Pursuit room and
an Account room at 1440; Today, Pipeline, Admin and Pursuit at 1280.

Captured against a locally rebuilt production build on a freshly reseeded local demo database.
`.env.local` was held aside during the build, because `next build` bakes `NEXT_PUBLIC_*` and a
build made with Supabase credentials present gates every room behind `/login`; it is restored.

---

## 6. Defects found in screenshots and fixed in this wave

| Found | Fix |
|---|---|
| Pipeline roll-up read `$$2.75M`, `$$920K` | The money codemod rewrote `${Math.round(n/1000)}k` in place — correct inside a template literal, wrong in JSX, where the leading `$` is a literal character and `{formatMoney(n)}` already supplies one. Fixed, plus a detector rule covering **both** JSX boundaries the codemod produced (`>` and `}`). |
| Pursuit hero `$1.3M` vs its own value case `$1.25M` | Retired both surviving `Intl` formatters. Verified visually: both now read `$1.18M` on the captured pursuit. |
| Pursuit team cards showed `dist…`, `ven…` | The role *is* the row; `truncate` in a ~150px card removed the only thing it said. |
| …and after my first fix, `distri / butor / bdm` | `break-words` was worse — it hard-broke inside words, because the status badge and action are both `shrink-0`. The card now **stacks**: name on its own full-width line, controls below. Holds at any panel width. |
| Pursuit room: 5 hand-styled filled CTAs | Route approval, override commit, two team confirmations, brief opener → the button contract. Route chips → the segmented control. Override's select and reason input → `fieldClass`. |
| Login: emerald *Create owner & sign in* beside blue *Sign in* | Both are the primary action of their own form; both now look like it. |
| Ask: commercial amounts set in the mono face | On that page mono means *verbatim machine token* (intent key, catalog version). An amount is neither a token nor Ask-specific — same face and tabular figures as every other room. |
| Pipeline: `fontSize: 17 / 15 / 13.5` inline | Off the named scale in both directions. Same three-step materiality ramp, now `section / title / copy`. |
| Admin: three recipes for one cost figure | `.toFixed(2)`, `.toFixed(3)`, and a bare interpolation of a **string** column that could print `$0.00034500000000000004`. All three → `formatCost`. |
| Pursuit room: `CDW category spend $1288000` | Not a render site — a hand-rolled `$${n.toFixed(0)}` in the demo seed, stored and printed verbatim. Routed through `formatMoneyExact`, the local demo DB reseeded, and verified as `$1,288,000` in the rendered DOM. |

---

## 7. Preserved — explicitly checked, not assumed

Domain models · canonical data · fact graph · federation and disclosure · RLS and FORCE RLS ·
recommendation ≠ decision · UNKNOWN semantics · governed mutations · stakeholder, lifecycle and
value-case intelligence · Ask and the resolver architecture · routing · outcomes and attribution ·
environment topology · demo seed and auth · external-action fail-closed behaviour.

No migration was written. No environment was deployed. `/` was not touched. Every change is
presentation: class names, a formatter, a component boundary. Where a value was displayed, it is
still the same value.

One case deserves naming. `formatMoneyExact` in the demo seed changes a **stored string**, not a
number — `(amt * 1.4).toFixed(0)` still computes the same figure; only the text a human reads
changes. The already-seeded hosted demo carries the old string until its next reseed, which this
wave deliberately does not perform.

---

## 8. Deferred, with reasons

- **~1,090 raw grey text utilities** (`text-neutral-500` and kin). These have no dark-mode pair and
  rely on a theme-level ramp override. Codemodding them blind would change contrast in dark mode on
  a thousand elements with no way to verify the result in one pass. **Measured and deferred, not
  overlooked.**
- **`TeamBento` in `components/pursuit/surfaces.tsx`** is exported and imported nowhere — a dormant
  duplicate of the live team surface, free to drift. Removing an export is a functional change and
  belongs to a wave that owns functionality.
- **The login page keeps its own local `primary`/`secondary`/`field` constants.** It is a bespoke
  split-screen surface outside the shell. Folding it into the shared contract is a redesign of that
  page, not a lock.
- **`/goals` label "Target (raw $, e.g. 500000)"** asks for an unformatted number. Correct for an
  input; worth revisiting alongside the field contract.
- **Interactive behaviour is not claimed as verified.** The screenshot walk asserts render, page
  errors and overflow. Sponsor⇄Partner toggles, ⌘K and drawers were not exercised.

---

## 9. Corrections made during this wave

Recorded because a reader should know which conclusions were revised.

1. **"Double dollars are still being served."** They were not. I had grepped the RSC flight payload,
   where a leading `$` is escaped by doubling. The fix I had just made was correct; the measurement
   was not. This is why verification moved to the rendered DOM.
2. **The `doubled-currency-symbol` rule was too narrow.** I had anchored it on `>` after a false
   positive on a template literal — which excluded the `}` boundary the same codemod also produced.
   Widened to both.
3. **My first fix for the truncated team cards made them worse.** `break-words` hard-broke inside
   words. Corrected by changing the layout rather than the wrapping.

---

## 10. Status

**Wave 1 complete. HALT FOR REVIEW.** Wave 2 has not begun.
