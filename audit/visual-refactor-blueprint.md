# Visual Refactoring Blueprint — PursuitOS (Phase 2)

**Date:** 2026-08-27 · **/architect Phase 2** · Analysis only, no code changed.

## Token system (what exists)

`src/app/globals.css` — a real Tailwind-v4 CSS-token system (no JS config):
semantic colors (`--color-accent`, `--color-emerald`, `--color-amber`,
`--color-rose`, `--color-violet`, `--color-indigo`, `--color-teal`,
`--color-positive/negative`, propensity `--color-band-*`, `--color-rail-*`),
radii (`--radius-card/control/inner/input/panel`), motion
(`--dur-move/react`, `--ease-move`), glass, hairline, shadow. **The system
is well-designed. The problem is that the codebase doesn't consistently use
it.**

## Findings (measured, not asserted)

### DRIFT-1 — Two parallel color vocabularies for the same meaning. [HIGH]
Semantic tokens exist but lose to raw Tailwind palette scales:
| Concept | Token usage | Palette usage |
| --- | --- | --- |
| success/positive | `text-emerald` ×32 | `text-green-700` ×35 |
| accent/primary | `text-accent` ×21 | `text-blue-700` ×68 |

Totals across views: `blue-*` 321, `green-*` 219, `red-*` 110, `emerald-*` 45.
**Cost:** the same UI meaning renders as two different values depending on
which file/when it was written, and a rebrand (e.g. accent off blue) would
silently miss the ~321 palette usages. This is the concrete form of the
"AI slop / drift" concern — not visible breakage, but an unenforced system.

### DRIFT-2 — No shared Button component; 164 ad-hoc `<button>`. [HIGH]
`src/components/ui.tsx` exports 20 primitives (Card, Bento, StatusBadge,
PageHeader, …) but **no Button.** Every button hand-writes its
padding/height/text-size/color, so no two primary buttons share a canonical
class string. This is the root cause of the "broken button row heights" and
"uneven padding" concerns — there is nothing to keep them equal.

### DRIFT-3 — Fragmented type scale. [MEDIUM]
~12 distinct arbitrary font sizes with no named scale:
`text-[9px]` ×6, `text-[10px]` ×83, `text-[11px]` ×157, `text-[12px]` ×4,
`text-[13px]` ×12, `text-[14px]`, `text-[14.5px]`, `text-[15px]` ×10,
`text-[19px]`, `text-[26px]` ×11, `text-[32px]` ×5, `text-[34px]`. The
`10/11px` micro-labels are used consistently; the mid/large sizes are
one-offs. No type scale means every new surface reinvents its sizes.

### DRIFT-4 — Token-duplicating hardcoded hexes. [LOW]
25 hex literals in components. **Most are legitimate and should stay:**
`global-error.tsx` inline styles (the root error boundary cannot use
Tailwind classes) and the login decorative gradient. **A handful duplicate
tokens** — e.g. `hover:bg-[#047857]` on the login CTA is
`--color-accent-strong`. Only the token-duplicating ones are in scope.

### NOT-YET-VERIFIED — pixel alignment, bento density.
The "cramped bento boxes / misaligned text / uneven padding" items in the
brief are *visual* defects I have not confirmed with a live screenshot pass
this phase (the env recycled; no running build). I will not assert defects I
haven't seen. Recommend a live desktop+mobile screenshot pass (Impeccable
review loop) as the first step of execution, folded into Phase 4 verification.

## The blueprint (how execution will align files to tokens)

Proportionate to the risk, and honoring "no premature abstraction" — no
churn-for-churn sweep of the 1,843 `neutral-*` usages (those are consistent
and fine).

1. **Semantic color aliases + migration of the two split concepts.**
   Add utility aliases so `success`/`accent` map to the tokens, then migrate
   the two highest-drift pairs: `green-700 → emerald` semantics (67 sites)
   and `blue-700 → accent` semantics (89 sites). Mechanical, reversible,
   token-backed. Leaves `red-*`/`amber-*`/`neutral-*` as-is unless a second
   pass is approved.
2. **A `Button` primitive in `ui.tsx`** with `variant` (primary / ghost /
   subtle / danger) and `size` (sm / md), built on the radius + accent
   tokens, fixed row heights. Then migrate the ad-hoc buttons room by room,
   starting with the highest-traffic (pipeline, partner room, admin). This
   directly fixes button row-height and padding drift.
3. **A named type scale** — codify the real sizes into tokens
   (`--text-micro` 10px, `--text-label` 11px, `--text-body` 13–14px,
   `--text-h2` 15px, `--text-display` 26/32px) and replace arbitrary
   `text-[Npx]` with them. Highest-frequency first (`10/11px`).
4. **Kill token-duplicating hexes** (a handful); leave the error-boundary
   and decorative gradients as intentional exceptions, commented as such.
5. **Live Impeccable pass** (desktop + mobile, batched once) across the
   ~10 core views to catch the visual items static analysis can't:
   bento density, alignment, empty-state polish. Fix in one batch, confirm
   with one more round, stop.

## Sequencing note (architect's recommendation)

Items 1–4 are safe, mechanical, backward-compatible refactors — pure class
swaps behind existing tokens, zero feature-logic change. Item 5 is a
judgment pass. **None of this should touch data flow or server actions.**
Recommend executing 2 (Button) and 1 (color aliases) first — they remove the
most future drift — then 3, 4, 5. Estimate: a focused pass, not a rewrite.
