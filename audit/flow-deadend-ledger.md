# Flow & Dead-End Ledger — PursuitOS (Phase 3)

**Date:** 2026-08-27 · **/architect Phase 3** · Static analysis, no code changed.

## Route graph (clean)

32 routes; both error boundaries present (`error.tsx`, `global-error.tsx`);
all 8 dynamic routes (`accounts/[id]`, `briefs/[motionId]`, `campaigns/[id]`,
`intake/[batchId]`, `join/[code]`, `joint/[id]`, `partners/[id]`,
`partners/[id]/review`) guard bad IDs (`notFound()` / redirect / null-return).
No `coming soon` / `TODO` / `href="#"` dead-ends — every "placeholder" hit is
a legitimate form-input hint. **No broken internal links:** every `href` to a
`/route` resolves to a real page. **No empty catch blocks.**

## Headline finding

### FLOW-1 — Systemic IDOR-on-write: mutations keyed by `id` with no ownership check. [HIGH]

A cluster of mutating server actions call `requireWrite` — which proves the
caller is a writer **in their own org** — then write to a row **by `id`
alone**, with no `org_id` in the `WHERE` clause and no preceding ownership
`SELECT`. An authenticated user in org A who supplies a row `id` from org B
mutates org B's data. Same bug class as the briefs finding from the
/security-audit (already fixed); this pass found the rest of the family.

Confirmed cases (action-level, no ownership gate):
| Action | File:line | Effect if exploited |
| --- | --- | --- |
| `deleteCampaignAction` | `campaigns/[id]/actions.ts:40` | **Cross-tenant DELETE of a campaign** (destructive) |
| `dismissCampaignAction` | `campaigns/actions.ts:90` | Dismiss another tenant's campaign |
| `setCampaignGoalAction` | `campaigns/actions.ts:81` | Retarget another tenant's campaign goal |
| `linkMotionAction` | `campaigns/[id]/actions.ts:29` | Re-link another tenant's campaign |
| `setMotionGoalAction` | `motions/actions.ts:141` | Retarget another tenant's motion goal |
| `setPopulationStatusAction` | `mapping/actions.ts:52` | Approve/reject another tenant's account list |
| `acceptPopulationAction` | `mapping/actions.ts:65` | Same |
| `rejectTouchAction` | `campaigns/[id]/actions.ts:137` | Reject another tenant's touch |

Exploitability: UUIDs aren't trivially enumerable, but they leak (URLs,
screenshots, the MCP surface, logs). Security must not rest on UUID secrecy.
**`deleteCampaignAction` is the sharpest — cross-tenant destructive delete.**

**Through-line to Phase 1:** every one of these would be blocked at the
database the moment RISK-1 is fixed — the `is_org_member(org_id)` RLS policy
filters the target row out and the UPDATE/DELETE hits 0 rows. Right now, with
the app running as table owner, RLS does not save them, so they are **live.**
This is the concrete proof of why RISK-1 (RLS enforcement) matters: the app
layer has real gaps, and defense-in-depth is currently off.

### FLOW-2 — Lib-level writes to trace before clearing. [MEDIUM — needs trace]
Same `WHERE id = $1` shape, but in lib functions that *may* carry a preceding
org/partnership check by the caller: `skills.ts:283/297` (skill-share decide/
revoke — likely partnership-scoped), `goals.ts:176/180`, `targets.ts:144`,
`quality/review.ts:41/45` (evidence verify/quarantine), `routines/actions.ts:31/47`
(uses a pre-fetched `routine` object — likely scoped). Each needs a one-line
trace in Phase 4 to confirm the caller establishes ownership; any that don't
join FLOW-1.

## Verified clean

- Both error boundaries present; all dynamic routes guard bad IDs.
- No broken internal links; no dead-end/placeholder buttons.
- No empty/silent catch blocks in server actions.
- **No server action trusts a client-supplied `orgId`** — org scope is always
  resolved server-side via `currentOrgId`. (The gap in FLOW-1 is the
  *target row's* ownership, not the caller's org.)

## Remediation shape (for Phase 4)

Two layers, both wanted:
1. **Close the class at the DB — enforce RLS (RISK-1).** Neutralizes FLOW-1
   entirely and every future instance of it. This is the high-leverage fix.
2. **Belt-and-suspenders — scope the writes.** Add the org check to each
   FLOW-1 action: either `… where id = $1 and org_id = <caller org>`, or a
   preceding ownership `SELECT`. Mechanical, backward-compatible, ~8 edits.
   Do FLOW-2 traces first to fold any confirmed cases in.
