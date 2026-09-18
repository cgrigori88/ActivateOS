# D-HIST-2 — explicit pipeline history producer

**Status:** **IMPLEMENTED AND LOCALLY ACCEPTED (`25e6c7e`). HOSTED GATE BLOCKED — awaiting Vercel
deployment capacity.** D-HIST-2 remains **OPEN**. P7 Slice 6 is not reopened. Slice 7 not begun.

**Ruling recorded.** Current state: **C** — `pipeline_snapshots` is a non-canonical analytical
materialization. Target state: **B** — ordinary read/render paths must not create it.

> **GOVERNING INVARIANT: observing canonical state may not create canonical or analytical history as a
> side effect of the observation.** GET/render/read paths are state-preserving unless the observation
> *is* the business event. `/pipeline` is not such an event.

---

## Part 1 — the render-path mutation is removed (DONE)

`src/app/pipeline/page.tsx` no longer calls `upsertCanonicalPipelineSnapshot`, and no longer imports
it. **No production module outside `src/lib/pipeline/snapshot.ts` writes `pipeline_snapshots`** — the
one remaining textual hit anywhere in `src/` is a comment in a pertinence loader.

So a visit, a refresh, a framework prefetch, a certification crawl and any filter or query change now
all produce **zero** snapshot writes: there is no code path from rendering to that table.

**Two certified guards inverted rather than deleted.** Both asserted that the render-path call
*existed*:

- `dp1-snapshot-boundary` check 20 asked whether the page's **one** call passed only the org identity.
  It now asserts **zero** calls, **positively**: the page is proven present and still rendering its
  tie-out first, so "no call" cannot pass merely because the file failed to load (§16B).
- `portfolio-pertinence` check 90 asserted the call's exact shape; it now asserts the render path
  writes no history, keeping its unrelated recency-default clause.

D-P1 remains closed on its own terms: the writer still accepts no caller-computed value, so a filtered
view could not poison a row even if something called it from a render.

**Evidence.** `dp1-snapshot-boundary` **26/26** · `portfolio-pertinence` **99/99** · unit **636/636** ·
tsc and build clean · `certify-world` **51 suites clean** at `691d26b3daadaf8f`. **Negative control:**
reintroducing the render-path write turns *both* suites red (26→25/1 and 99→98/1); restored, both green.

**Interim consumer behaviour.** With no producer yet wired, the series simply stops accruing. Both
consumers already degrade honestly — `weekAgo` is nullable and renders nothing when absent, and the
calibration list renders nothing when empty. Nothing shows a zero, a substitute or an interpolation.

---

## Part 2 — infrastructure inspection (DONE): a suitable producer already exists

**No new scheduler is required.** `src/worker/index.ts` is a long-lived process with an internal
scheduler that already does exactly this shape of work:

| Property | Existing mechanism |
|---|---|
| daily cadence | `SCREEN_HOUR_UTC` (default 07) with a `lastScreenDay` `YYYY-MM-DD` guard — once per day |
| also daily | a nightly backup, guarded by `lastBackupDay` |
| disable switch | `WORKER_CRON=off` |
| cross-org enumeration | `runScreeningSweepAllOrgs` — `select id, name from organizations order by name`, then per-org |
| authority | `getOwnerPool()` — the **owner** role |
| overlap safety | per-org Postgres **advisory locks** (`runScreeningSweepLocked`) |
| on-demand trigger | authenticated HTTP `POST /screen`, `POST /research` |

The producer function is **already independently callable and testable from rendering**:
`upsertCanonicalPipelineSnapshot(db, orgId)` is exported and is driven directly by
`scripts/dp1-snapshot-boundary-verify.ts`.

---

## Decisions returned for ruling

### D1 — producer authority (§3 requires this be returned before implementation)

A daily all-org snapshot must decide *which* orgs get a sample, so it must enumerate organizations.
The existing worker already does this **under the owner pool**, daily, for screening and backups.

- **Recommend: reuse it unchanged** — add a `lastSnapshotDay`-guarded pass alongside the existing
  daily screening sweep. This introduces **no new scheduler, no new credential and no new cross-tenant
  authority**; it reuses an authority boundary that already exists and is already exercised daily.
- **The honest caveat:** it is still cross-tenant, and §3 asks for an org-scoped producer if viable.
  A strictly org-scoped producer is *not* viable for an unattended daily series, because something
  must enumerate orgs to know a sample is due. The viable middle is the existing per-org authenticated
  HTTP trigger, which makes the caller responsible for naming the org — at the cost of no unattended
  daily history, which is the whole point of the change.

### D2 — provenance mechanism, and a schema change (§5 requires justification first)

Legacy rows are semantically contaminated and must fail safely into a legacy category.

- **Recommend a schema change:** migration 0113 adding
  `source text not null default 'legacy_observation'` with a `check (source in
  ('legacy_observation','scheduled_daily'))` to `pipeline_snapshots`.
- **Justification.** The default makes **every existing row legacy automatically**, with no backfill,
  no cutover date embedded in application code, and no possibility of an old row being silently
  reinterpreted. Consumers then filter `source = 'scheduled_daily'`, which is machine-readable
  provenance exactly as preferred. The alternative — a date constant in code — is precisely the
  undocumented cutover the ruling rejects, and it breaks the moment anyone backfills or restores.
- Additive, defaulted, no rewrite of existing rows, no RLS or grant change.

### D3 — sampling-time semantics (§7 asks this be returned if it affects interpretation; it does)

- **Recommend first-write-wins for a given `(org, day)`:** `on conflict do nothing` for the scheduled
  producer, so the sample is *"as at the first scheduled run of that day"*. A retry, a restart or a
  manual re-run then cannot move an already-recorded sample.
- Last-write-wins (today's behaviour) would replace page-view timing with **job-retry timing**, which
  is the same class of defect this correction exists to remove.
- Consequence to accept deliberately: a same-day correction to canonical data will not be reflected in
  that day's sample. That is what a *sample* means.

### D4 — time basis (§8 requires this be established and recorded; it is currently undefined)

**Measured, and it is not UTC — it is the session timezone**, so `taken_on` means different days to
different callers:

| Session | `SHOW TimeZone` | `now()::date` | UTC date |
|---|---|---|---|
| local seeded clone | `America/Chicago` | **2026-09-17** | 2026-09-18 |
| Preview runtime | `UTC` | **2026-09-18** | 2026-09-18 |

The same instant produces a different `taken_on` depending on who connects — for five to six hours of
every day. This is a latent semantic defect **independent of** the read-path issue, and it means there
is no established basis to preserve.

- **Recommend: fix the basis explicitly to UTC** in the producer — `(now() at time zone 'utc')::date`
  — and align the worker's daily guard, which is already UTC-based (`SCREEN_HOUR_UTC`).
- **This does change meaning for non-UTC sessions**, which §8 says must not happen silently. It is
  therefore returned rather than done. Organization-local day boundaries would be a larger change and
  are **not** recommended: they would make a single row's meaning depend on tenant configuration.

---

## Remaining work, once ruled

Consumer validity semantics (§6), idempotency proof (§7), the no-visit-independence and no-fake-history
proofs (§9), the producer/read classification in the acceptance gate (§10), and the remaining negative
controls (§11) all depend on D2's provenance column and D1's producer. They are specified and ready;
none is implemented.

**Proposed consumer semantics, for ruling alongside D2:**

- **Week-ago comparison** — require an **exact** valid sample at `today - 7`. Today's query takes "the
  most recent row at least six days old", which silently turns a three-week-old row into "last week".
  Absent → a deterministic *insufficient history* state, not a nearest neighbour and not a zero.
- **30/60-day calibration** — require a valid sample within each bucket, and state the coverage the
  card is computed from. A bucket without one is omitted rather than filled from whatever exists.

**Not implemented, per §12:** no scheduler, no new authority, no new credential, no schema change, and
no producer wiring.


---

## Blocked state and the resume sequence

**Blocker.** `vercel deploy` returns `Resource is limited - try again in 24 hours (more than 100,
code: "api-deployments-free-per-day")`. The account's daily deployment quota is exhausted, which is
also why `e5f123f`, `b6ccd69` and `25e6c7e` were pushed but never deployed.

**Hosted state, verified and unchanged:** serving `f7b40b1` · schema **112** · **no `source` column** ·
`pipeline_snapshots` 4 rows · Production not contacted. **Migration 0113 was deliberately NOT applied**
— see §16F of the parent contract for why the ordering is not negotiable.

**Resume exactly here when capacity returns — steps 2–4 must not be collapsed:**

1. Deploy `25e6c7e`.
2. **Prove the exact serving commit is `25e6c7e`**, from the deployment itself, before any schema change.
3. **Verify the deployed code no longer contains the `/pipeline` render-path snapshot writer.**
4. Only then apply migration 0113 through the normal mechanism.
5. Establish the new post-0113 baseline (do **not** expect the 0112 world digest to survive).
6. Run the authorized H0–H10 gate.

**If `25e6c7e` fails to deploy for any reason other than the quota once the window reopens: STOP and
return the new failure rather than applying 0113.**

**While blocked, deliberately not done:** no repeated deployment probes, no change to migration 0113,
no weakening of the `NOT NULL` / no-default provenance design, no transitional default restored to
accommodate older deployed code, no second Preview environment, no Production, no Slice 7.
