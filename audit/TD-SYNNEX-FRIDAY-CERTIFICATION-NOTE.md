# TD SYNNEX Friday walkthrough — certification note

**Status:** DEMO GO (synthetic, operator-controlled) — **NOT tenant-isolation certified**
**Frozen at:** `97e975f0d9895c54bfc49cdcc24924d6ac58e796`
**Host:** demo.pursuitos.io · Vercel project `pursuitos-demo` · branch `claude/activateos-platform-review-xzkgmd`
**Demo database:** Supabase project `qifatlqxfuhwrwvpbwsc` · `environment="demo"`, `is_synthetic=true`
**Canonical manifest digest:** `be0da833990ce436`

> **Archival note (2026-09-04).** This note was originally kept deliberately uncommitted so
> that writing it could not create a new SHA and invalidate the verified deployment. That
> decision was correct for the walkthrough and wrong for durability: the container was
> reclaimed and the file was lost, surviving only as a downloaded copy. It is preserved here
> on `archive/tds-certification-2026-09-04`, a branch cut from the certified live commit and
> **never merged into the deployed branch**, so the record is durable while the deployed SHA
> is untouched.

---

## 1. Accepted blocker — tenant isolation

**Defect.** The live demo runtime connects to Postgres as `postgres`, a Supabase
**superuser**. PostgreSQL superusers bypass row-level security unconditionally — including
where `RLS` and `FORCE RLS` are both enabled, as they are here on all public tables. The RLS
policies are present and correct; they never evaluate.

**Observed exploit.** A user who is a member of Vertex Systems *only* can render a pursuit
owned by Meridian Technology Partners by navigating directly to its UUID. Reproduced on
`/pursuits/54ebe8ca-debc-4e0b-a5ea-b8506b72d500`, which rendered the full sponsor decision
surface. The pursuit detail read (`select why_now, org_id, account_id from pursuits where
id = $1`) carries no application-level tenant predicate: it fetches by id and then *uses*
the row's `org_id` rather than *checking* it. Ten routes take an `[id]` parameter and none
can be certified.

**Confirmation the policies are sound.** The identical query executed as the non-superuser
role `app_rw` with `app.org_id` set returns **0 rows**.

**Provenance.** Pre-existing and previously identified — open task **#67**, "per-request
scoped DB connections (app pool off table-owner role)". Documented in
`src/lib/db/tenant.ts`: *"Today the app connects as the table owner, which bypasses RLS…
`withTenant` is INERT while DATABASE_URL still points at the owner."* **Not introduced by
Waves 6B, 6C or 6D**, none of which touched this path.

**Scope.** Synthetic demo environment only. Every record is fabricated; both "tenants" in
the exploit are demo constructs.

**Friday mitigation.** Operator-controlled screen share; no attendee credentials; no
self-service access; no real tenant or customer data present; no production customer
environment commissioned.

**Production status: BLOCKING.** No real design-partner or customer data may enter this
architecture until task #67 is complete and tenant isolation is re-certified.

**Language constraint.** The live demo must **not** be described as tenant-isolation
certified. The `/trust` room displays a "Tenant isolation" claim on screen. If asked how it
is enforced, the accurate answer today is: *the policies are written and correct; the
connection role that activates them is a scheduled cutover.*

---

## 2. Canonical commercial values — verified

Computed from a clean canonical rebuild at digest `be0da833990ce436`; re-verified
2026-09-04 during the repository preservation pass, unchanged.

| Figure | Value | Where it appears |
|---|---|---|
| Open pipeline | **$8,040,000** | Pipeline — `open pipeline`, "opportunity amounts, unweighted" |
| Open opportunities | **11** | Pipeline — `open opportunities` count bento |
| Weighted open pipeline | **$3,361,500** | derived (stage-probability curve) |
| Won revenue | **$1,780,000** across 4 deals | Pipeline — `won` |
| Motion value (all motions) | **$1,850,000** across 7 | Motions — `motion value`, "estimated, across the plays" |
| Goal-linked motions | **$1,250,000** across 5 | Goals — goal progress basis |
| Goal opportunity-level contribution | **$4,920,000** across 6 open deals | Goals — "Carried by" |
| Goal target / progress | **$5,000,000** / **25%** | Goals |

Three co-existing measures, each correct and each labelled at the figure: **$8.04M** whole
open book · **$1.85M** all motions · **$1.25M** goal-linked motions.

### Two corrections issued against the pre-walkthrough checklist

- **"motion value: $1.25M" was wrong.** The Motions room's `motion value` bento reads
  **$1.85M** — every motion. $1.25M is the *Goals* figure.
- **"weighted pipeline: $1.85M" was wrong.** $1.85M is motion value. Weighted open pipeline
  is **$3,361,500**, and it is not displayed as a headline bento.

---

## 3. Open-opportunity count: 13 → 11

**A legitimate consequence of the Wave 6C canonical fix. No data was changed to reach 11.**

Wave 6C §4/§5 found that `demo-enrich` (breadth) and `demo-stories` (narrative) both
authored the same hero deals under different names, so a clean build produced duplicates
that name-based deduplication could not catch:

| Account | Breadth layer authored | Narrative layer authored | Resolution |
|---|---|---|---|
| Stark Industries | "Hybrid cloud landing zone" $1,450,000 | "Sovereign landing zone" $1,450,000 | breadth version removed |
| Acme Robotics | "Automation platform build" $430,000 | "Incumbent displacement" $540,000 | breadth version removed |

```
13 open deals − 2 phantoms          = 11 open deals
$9,920,000 − $1,450,000 − $430,000  = $8,040,000
```

**The "13" was a reporting error, not a data change.** The Wave 6C summary paired the
*pre-fix* count (13) with the *post-fix* sum ($8.04M). $8,040,000 has been the reported
total throughout and is unchanged; only the count was misstated.

Pipeline derives `open opportunities` and `open pipeline` from the same array, so the count
and the sum cannot disagree by construction.

---

## 4. What is certified

Environment identity · database identity · send safety (config + post-deploy build) ·
deterministic canonical world `be0da833990ce436` · commercial totals above · fast-forward of
the production-designated branch `66f72f6..97e975f` with full ancestry · deployed SHA
confirmed on the Production deployment · sponsor-side disclosure (restricted $1,840,000
present for sponsor, absent in partner projection) · all four Ask cases including the
injection attempt, refused by the query registry.

**Local baseline at `97e975f`:** FRESH 238/238 · EITHER 215/215 · SEEDED 658/658 ·
**1,111/1,111**, 0 fatal · unit 149/149 · typecheck clean · production build clean ·
visual-system clean (363 files).

**Not certified:** §11 tenant isolation (above). §10's unauthorized-participant context was
not exercised live — the demo has no partner-org login by construction, and creating one
would mint a tenant and invalidate the canonical digest. That property is certified at the
read-model level by `experience-verify` on every build (restricted value absent from the
limited payload, formatted and unformatted, dropped whole rather than generalized).

---

## 5. Post-walkthrough

1. Complete task #67 — cut `DATABASE_URL` to `app_rw`, grants, re-certify §11.
2. Re-run the full battery and re-issue certification before any real tenant.
3. Until then: synthetic, operator-driven demonstrations only.
