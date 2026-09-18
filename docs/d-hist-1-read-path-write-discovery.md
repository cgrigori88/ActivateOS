# D-HIST-1 — read-path write discovery: `pipeline_snapshots`

**Status:** **DISCOVERY / RULING ONLY.** No implementation, no schema, no environment change, and
Slice 6 is not reopened. Its 131/0 hosted record stands.

**Recommendation: C — NON-CANONICAL MATERIALIZATION, trending to B.** Full reasoning in §7.

> **STANDING DISTINCTION, recorded: clock-derived observation is not the same as a clock-conditioned
> write.** A persistent mutation may not be waived as "clock-derived" merely because the date or time
> determined *when* it occurred. What moved during Slice 6 certification was not a value recomputed
> from an unchanged world — it was **a new row committed to a canonical table by a render path**.

---

## 1. The mutation, traced

| Question | Answer |
|---|---|
| Function | `upsertCanonicalPipelineSnapshot(db, orgId)` — `src/lib/pipeline/snapshot.ts` |
| Call chain | `/pipeline` server render → `withTenant(async (db, orgId) => …)` → tie-out block → line 454 |
| Mechanism | **React Server Component render** of a `force-dynamic` page. Not an action, not an API route, not a worker |
| Gate | `if (tieOrgId)` — i.e. *any resolved org*. **No flag, no filter, no user action, no capability** |
| DB role | the runtime pool — **`app_rw`**, non-`BYPASSRLS` |
| Tenancy | inside `withTenant`, so `app.org_id` is pinned and RLS applies; a cross-org write is refused |
| Key / conflict | `insert … values ($1, now()::date, …) on conflict (org_id, taken_on) do update` |
| Every refresh? | **Yes** — every render attempts the upsert |
| Persistence bound | one row per `(org_id, day)`; `taken_on` is the **database's** `now()::date`, never caller-supplied, so prior-date rows are immutable by construction |

**Not accidental.** The module documents the behaviour as deliberate: *"Deliberately unchanged: … the
read-triggered write ('history accrues just by looking')."* It also records **D-P1**, an earlier and
more serious defect in the same place: the page used to pass its *rendered, filtered* aggregates into
the row, so viewing a 7-day window overwrote canonical history with filtered totals. That defect is
genuinely fixed — the writer now accepts no caller-computed value and derives every field from the
org's full unfiltered set, so filtered-view poisoning is impossible **by API shape**. What D-P1 did
not change is *who triggers the write*.

---

## 2. Every trigger

| Trigger | Writes? | Evidence |
|---|---|---|
| ordinary page visit to `/pipeline` | **yes** | the only call site, gated solely on `tieOrgId` |
| page refresh / re-render | **yes**, idempotently | `force-dynamic`; every render re-runs the loader |
| framework prefetch of `/pipeline` | **yes** if the RSC payload is produced | server render is the trigger; nothing distinguishes a prefetch |
| crawler / certification request | **yes** | this is precisely how the Slice 6 movement occurred |
| explicit user action | no separate path | there is no action, button or mutation endpoint |
| API invocation | none | no API route imports the writer |
| scheduled / background | **none** | no `vercel.json`, no cron, no worker call site |

Only one production call site exists. Everything else that references the writer is a test
(`scripts/dp1-snapshot-boundary-verify.ts`) or a comment.

---

## 3. What a row means — and the load-bearing mismatch

The table is described in-code as *"the canonical, unfiltered daily pipeline state for that org"*, and
it has exactly two consumers, both on `/pipeline`:

1. **Week-ago comparison** — `where taken_on <= (now() - 6 days) order by taken_on desc limit 1`,
   rendered as *"Open pipeline {takenOn}: {openUsd}"*.
2. **Calibration card** — buckets rows at the ~30-day and ~60-day horizons and compares each against
   what actually closed since.

> **Both consumers assume a row exists because business state existed on that date. The writer only
> guarantees a row exists because somebody rendered the page on that date.**

That is the distinction the ruling names, and it is not theoretical:

- The week-ago figure is *labelled* with its date, which keeps it honest, but its **selection** — "the
  most recent row at least six days old" — presumes a roughly daily series. A fortnight of no visits
  silently turns "last week" into "three weeks ago".
- The calibration card is explicitly analytical history: *what we believed 30 and 60 days ago versus
  what we realised*. A bucket is empty, or represents a different day than intended, purely as a
  function of who browsed. **Calibration measured against a viewing schedule is not calibration.**

---

## 4. State-integrity effect — which instruments saw it

| Instrument | Covers `pipeline_snapshots`? | Why |
|---|---|---|
| per-table fingerprints (160) | **yes** | every base table in `public` is fingerprinted; the compare named it explicitly: `3:da14da24… → 4:2813755b…` |
| world hash | **yes** | it is the digest over all table fingerprints |
| `businessFingerprint` | **yes** | all fingerprints except `schema_migrations` |
| `securityHash` | no | functions, triggers, policies, RLS, grants only |
| `stableManifestDigest` | **no** | the manifest counts a curated set of canonical tables and hero rows; `pipeline_snapshots` is not among them — which is why the manifest stayed at `8c1b67b7dd3bcf94` while the world hash moved |

So the instrumentation behaved correctly and the layering is informative: **the whole-world fingerprint
is what caught this, and the curated manifest could not have.** That is the H1A design working exactly
as it was written — "a verifier that mutates anything else leaves the manifest digest untouched and the
world silently different."

---

## 5. Reproducibility — measured, on the disposable local clone

| Step | Result |
|---|---|
| A. baseline | 1 row: `2026-09-14` |
| B. same canonical state, **no visit** | 1 row — **unchanged** |
| C. same canonical state, **one visit** | **2 rows** — today's row created |
| D. four further visits, same date | 2 rows — **identical to one visit** (idempotent) |
| E. today's row deleted (a day nobody visited) | 1 row — today absent |
| F. one visit | 2 rows — **identical to C** |

> **Identical canonical source state yields different persistent state depending on whether a page was
> observed.** Combined with `taken_on = now()::date` and the `(org_id, taken_on)` primary key: **a row
> exists for a date if and only if someone rendered `/pipeline` on that date.** The date boundary
> decides *which* row is written; the visit decides *whether* one is.

The clone was restored to its pre-discovery state afterwards and `certify-world` re-verified at
**`691d26b3daadaf8f`**, unchanged.

---

## 6. Side-effect analysis — what moving it would change

Removing the write from the render path changes **no rendered figure that is computed live**: open
count, open USD, weighted USD and the CRM tie-out are all recomputed per request from canonical
tables. It changes only the two **history** consumers, and only by making them depend on a series that
no longer accrues by browsing.

Conceptual alternatives, not implemented:

| Alternative | Effect |
|---|---|
| **Explicit scheduled snapshot** | a real daily series independent of viewing. Needs a scheduler this deployment does not have (no cron today) |
| **Write-time / ingestion snapshot** | history accrues when pipeline data actually changes — arguably the most faithful to "business state existed" |
| **Deterministic historical derivation** | derive history from the append-only ledger instead of storing it; no write at all, and no dependence on anything having been observed |
| **Explicit analytics materialization** | keep the table, reclassify it as a derived cache, and instrument it as such |
| **Retain observation-triggered writes** | zero work; keeps a canonical-looking table whose completeness depends on browsing |

---

## 7. Recommendation

**C — NON-CANONICAL MATERIALIZATION**, with a stated preference for moving to **B** when a scheduler
exists.

The reasoning: the table is **not** canonical business history, because nothing in the business
creates a row — only observation does. Calling it canonical is what makes it dangerous, since both
consumers then reason about it as though the series were complete. But it is also not merely a cache:
a cache can be rebuilt from canonical state on demand, and this cannot — **a day that was never
observed is unrecoverable**, which is precisely why it should stop being described as canonical.

So the minimal, honest correction is to **reclassify**: name it a derived analytical materialization,
state in both consumers that the series is observation-sampled rather than daily, and instrument it in
the certification layer as a non-canonical table whose movement is expected and explained rather than
alarming. **B is the better end state** — an explicit producer, so history reflects the business rather
than the audience — and it becomes available the moment there is a scheduler or a write-time hook to
hang it on.

**Not recommended: A.** Page observation is not plausibly the intended historical event. The evidence
is the consumers themselves: a 30/60-day calibration card and a "one week ago" comparison both describe
*the business over time*, and neither is meaningful if the sampling schedule is "whenever somebody
opened a tab". The in-code phrase *"history accrues just by looking"* reads as a convenience that was
never revisited, not as a deliberate claim that looking is the event.

**What this discovery does not do.** It does not reopen Slice 6, change any code, schema, instrument
or environment, or authorise Slice 7.
