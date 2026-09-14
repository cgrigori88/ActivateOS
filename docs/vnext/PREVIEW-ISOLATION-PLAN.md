# PursuitOS vNext — Preview Isolation Plan

**Created:** 2026-09-12T14:30Z
**Updated:** 2026-09-14T02:16Z
**Status:** **DESIGN ONLY — NOTHING BUILT.** Objective F fired: safe isolation
could not be verified or established with the credentials available in this
environment, so no preview was created and no hosted configuration was touched.

**2026-09-14 — Option 2 step 1 now has a target, and steps 2-4 have a proven
blocker.** A `DEMO_TARGET_URL` was supplied, resolving to Supabase project ref
`mejokqxriwyawfhawuxu` — **not** `qifatlqxfuhwrwvpbwsc`. It could not be marked
or seeded: Claude Code Web has **no Postgres egress** (TCP 5432/6543 time out;
HTTPS to `api.supabase.com` is refused by policy), and the canonical seed path
has no HTTPS fallback. Nothing was written. The full evidence, the exact
code-derived invocation, and the variable-conflation trap are in
`ENVIRONMENT-MAP.md` §10.

**This file is a plan, not a record of facts.** Verified environment facts live
in `ENVIRONMENT-MAP.md`, which is governed by a VERIFIED-FACTS-ONLY rule. Keep
the two apart: a plan that migrates into the facts file is how an inference
becomes a "fact" nobody checked.

---

## Why this stopped

| Requirement | Needs | Present here |
|---|---|---|
| Read which `DATABASE_URL` the Preview scope carries | `VERCEL_TOKEN` | ✗ |
| Read the live serving commit | `OPS_FINGERPRINT_TOKEN`, or a signed-in session, or `VERCEL_TOKEN` | ✗ |
| Create a Preview-scoped `DATABASE_URL` | Vercel dashboard or `VERCEL_TOKEN` | ✗ |
| Create or seed an isolated Supabase project | Supabase access token / dashboard | ✗ |

Preview data safety is therefore still **UNKNOWN**, and the standing instruction
is explicit: *do not create a preview connected to unknown or shared writable
data.* Nothing in this session did.

`ENVIRONMENT-MAP.md` §6 now also records that **no application-layer mitigation
exists** if Preview does share the database — `VERCEL_ENV` gates nothing,
`assertSyntheticDatabase` passes for anything marked synthetic (which the demo DB
is), and 22 files carry server actions. The one piece of good news is B-d: a
Vercel *build* performs no database access, because every application route is
dynamic. A preview nobody opens has touched nothing.

---

## Objective C — the smallest safe isolation, in the stated preference order

### Option 1 — an existing isolated demo-safe Supabase project · **PARTIALLY ANSWERED (2026-09-14)**

Nothing in the repository names a second Supabase project. Only
`qifatlqxfuhwrwvpbwsc` (`pursuitos-demo`) appears, and the `app.pursuitos.io`
project is never named. Whether a spare project already exists is a
dashboard-only question.

**A second project ref now exists and is designated the vNext target:**
`mejokqxriwyawfhawuxu`, supplied out-of-band as `DEMO_TARGET_URL`. Whether it is
a Supabase *branch* of the demo project or an independent project is still
**UNVERIFIED** (a dashboard or Management-API read answers it); either way the
ref differs and a branch is a physically separate database. Whether it is empty,
migrated, or already marked is **unknown** — the marker read failed on the
connection, not on the marker. So Option 1 has become "Option 2's work without
the project-creation step", exactly as anticipated — the work simply has to run
somewhere with Postgres egress.

**Still to check, read-only:** Supabase dashboard → organization → project list,
or `GET https://api.supabase.com/v1/projects` with a personal access token —
which answers whether `mejokqxriwyawfhawuxu` is a branch or a standalone project,
and what tier it sits on.

### Option 2 — a mechanism the repository already supports · **RECOMMENDED**

This is the smallest path, and it is smallest precisely because **every piece
already exists and is already exercised.** Nothing new gets written.

| Step | Existing tool | Already used for |
|---|---|---|
| 1 · point at an empty database | `DEMO_TARGET_URL` | the guarded in-place hosted reseed (no drop/create) |
| 2 · mark it synthetic | `scripts/environment-identity.ts --set demo --label "…"` | how `pursuitos-demo` itself was marked |
| 3 · seed the canonical world | `scripts/seed-demo-world.ts` (10 layers + `verify()`) | the local synthetic DB and the hosted demo |
| 4 · prove it | `verify()` + `scripts/demo-manifest.ts` digest | canonical certification |
| 5 · scope it to Preview only | Vercel env var, `target: preview` | — (the one genuinely new act) |

Step 5 is the only change to hosted configuration, and it is **additive**: adding
a Preview-scoped `DATABASE_URL` overrides the inherited one for Preview builds
and leaves Production's value untouched. Nothing about Production changes.

**Ordering matters.** Mark the database synthetic (step 2) *before* seeding
(step 3), because `seed-demo-world.ts` calls `assertSyntheticDatabase` and will
refuse an unmarked target. That refusal is the guard working; it is not a
configuration error.

**One step was missing from this table, and the code says so: migrate first.**
The in-place path in `demo-db.ts` compares `count(*)` in `schema_migrations`
against the number of files on disk and **refuses** a partially-migrated target,
because "seeding a database whose schema we silently created would hide a
migration failure behind a seed failure". So step 1 is really
`DATABASE_URL="$DEMO_TARGET_URL" npx tsx scripts/migrate.ts` — which is also the
only step in the whole recipe that could travel over the Supabase Management API
(`scripts/db-remote.ts`), since it is plain SQL. The seed cannot: its ten layer
scripts run application code over a live `pg` pool. The exact verified sequence
is in `ENVIRONMENT-MAP.md` §10.

**Supabase branching is the variant worth checking first** — if the plan
supports it, a branch database is cheaper than a second project and Vercel's
Supabase integration can wire the Preview scope automatically. `ENVIRONMENT-MAP.md`
§8 note 5 records that this plan has **no managed backups**, which is a hint that
it is a low tier and may not include branching. Verify before assuming.

### Option 3 — a brand-new isolated synthetic target · only if 1 and 2 fail

Same five steps as Option 2; the difference is only that step 1 creates a
project. Defer: it costs money, it adds a second hosted database to keep
reconciled, and it is not needed before Monday.

### Option 4 — read-only preview · **the fallback, and it is already sufficient for Slice 1**

If no isolated write-capable preview can be established, a read-only preview is
not a consolation prize for this slice. **Slice 1 introduces no writes**
(`ACCEPTANCE.md` S1-6), so a read-only preview exercises 100% of it.

There is currently **no code-level read-only mode**, so "read-only" would have to
be established by the database grant, not by the application — e.g. a
Preview-scoped `DATABASE_URL` whose role holds `SELECT` and nothing else. That is
a real option against an isolated copy; against the *demo* database it is still
the wrong answer, because a connection that can only read still puts preview
traffic on the database serving Monday's demo.

**Until an isolated target exists, the local synthetic path remains the
development environment** — already isolated, already seeded, already guarded,
and already the basis of every Slice 1 measurement.

### Invariants any isolated preview must preserve

Carried verbatim from the standing constraints, with how each is enforced:

| Invariant | Enforcement | Preview action |
|---|---|---|
| Synthetic-cannot-send | `externalSendingArmed()` returns false unless `OUTREACH_AUTOSEND === "on"` exactly | leave `OUTREACH_AUTOSEND` **unset** on the Preview scope |
| `OUTREACH_AUTOSEND` OFF | same | as above; also leave `RESEND_API_KEY` absent, as it already is on `PursuitOS-demo` |
| Disclosure rules | server-side withholding in the read-models | unchanged — no preview-specific code |
| Recommendation ≠ decision | `pursuit_overrides` + append-only ledgers (D-004) | unchanged |
| Organization scoping | explicit `where org_id` on every query | unchanged |
| vNext feature flags | `vnextCapabilities(tenant)` — narrowing only (D-013) | set per Objective D below |
| Synthetic data only | `environment_identity` row + `assertSyntheticDatabase` | step 2 above, **before** seeding |
| Canonical numbers | `seed-demo-world.ts` `verify()` | must reconcile: 3 orgs · 14 companies · 19 opportunities · 11 open · $8,040,000 · 14 pursuits |

---

## Objective D — Preview flag configuration plan

**Not applied.** These are the values to set on the **Preview scope only**, once
an isolated target exists.

### ON — Slice 1

| Variable | Value | Why |
|---|---|---|
| `VNEXT_CONTEXT_HEALTH_ENABLED` | `1` | Slice 1 |
| `VNEXT_PURSUIT_STATE_ENABLED` | `1` | Slice 1 |
| `VNEXT_PURSUIT_MEMORY_ENABLED` | `1` | Slice 1 |
| `VNEXT_PURSUIT_INTELLIGENCE_ENABLED` | `1` | Slice 1 — **the gate the composed surface actually reads** |

`vnextCapabilities()` computes
`pursuit_intelligence && pursuit_state && pursuit_memory`, so all four must be on
for the surface to render. Setting only `VNEXT_PURSUIT_INTELLIGENCE_ENABLED`
would silently do nothing — that dependency chain is pinned by test.

### OFF — everything else

| Variable | Value |
|---|---|
| `VNEXT_NEXT_BEST_ACTION_ENABLED` | **unset** |
| `VNEXT_DYNAMIC_SURFACES_ENABLED` | **unset** |
| `VNEXT_CONTROL_PLANE_ENABLED` | **unset** |

Prefer *unset* to `0`. Every flag defaults OFF and only `true|1|on|yes` enables
one, so an unset variable is unambiguous and leaves no value to misread later.

### Also required on the Preview scope

| Variable | Value | Why |
|---|---|---|
| `PURSUITOS_ENV` | `demo` | Anything unrecognised **throws** (`siteMode()` refuses to guess). Unset resolves to `local`, which is safe but mislabels the deployment. `demo` is the honest identity for a synthetic preview. |
| `PURSUITS_ENABLED`, `FACTS_ENABLED`, `ROUTING_ENABLED`, `PURSUIT_EXPERIENCE_ENABLED`, `FEDERATION_ENABLED` | `1` | Shipped gates the Pursuit Detail route already needs. |
| `OUTREACH_AUTOSEND` | **unset** | The send invariant. |
| `OPS_FINGERPRINT_TOKEN` | set | So `/api/build` can confirm which database the preview actually reached — the whole point. |
| `DATABASE_URL` | the isolated target, `target: preview` | The isolation itself. |

### Production / demo scope — unchanged

**No `VNEXT_*` variable is set on the Production scope, and none is added.** The
composed surface stays invisible on `demo.pursuitos.io`. Two independent reasons
it is inert there even if code ships: every flag defaults OFF, and Vercel binds
env changes at build time, so nothing changes without a new build.

---

## Objective E — continuous preview workflow

The loop every future session follows. **No step in it promotes anything.**

```
  roadmap work on roadmap/pursuitos-vnext
      ↓
  tests: npx tsc --noEmit · npm test · npm run build
         vnext-context verifier against the LOCAL synthetic DB
      ↓
  commit  (correctness and refinement in separate commits)
      ↓
  push -u origin roadmap/pursuitos-vnext
      ↓
  Vercel builds a Preview for that commit   ← isolated target, Slice-1 flags ON
      ↓
  owner reviews the preview URL
      ↓
  feature stays PREVIEW READY
      ↓
  DEMO CERTIFIED only via a separate, explicit decision  (DEMO-PROMOTION-GATE.md)
```

### The rules that make it safe

1. **Preview never auto-promotes.** Promotion means merging into
   `claude/activateos-platform-review-xzkgmd`. Pushing `roadmap/pursuitos-vnext`
   is not promotion and a preview deployment is not promotion
   (`DEMO-PROMOTION-GATE.md`). Nothing in this loop touches that branch.
2. **PREVIEW READY ≠ DEMO CERTIFIED.** They are separate states in `STATUS.md`
   and only the owner moves a capability between them.
3. **Local synthetic first.** Tests and verifiers run against local Postgres, not
   against the preview. The preview is for the owner's eyes, not for the test
   suite.
4. **Confirm the target on every first preview of a session:**
   `curl -H "x-ops-token: …" <preview>/api/build` and check
   `database.projectRef` is the isolated ref — **not** `qifatlqxfuhwrwvpbwsc`.
   One request, and it is the only thing that proves the isolation still holds.
5. **No writes from a preview until its target is confirmed isolated.** Slice 1
   needs none.
6. **Env changes need a rebuild.** A flag flip is not live until a new build
   completes. Re-check `/api/build` after any change.

### Until isolation exists

Substitute "isolated preview builds" with the local render loop this weekend
already used for GATE C: `npm run build`, serve twice with and without the flags,
capture at 1440×1000 and 390×844, and hand the owner the images in-conversation
(`SESSION-HANDOFF.md` → standing instruction). It produced every GATE C and
refinement measurement, so it is a working substitute rather than a stopgap.

---

## Validation checklist — to run when an isolated preview first exists

None of this could run in this session. Left here so it is not re-derived.

| # | Check | How |
|---|---|---|
| V-1 | `demo.pursuitos.io` unchanged | `/login` → 200; `/api/build` → 404 unauthenticated; production branch SHA unmoved |
| V-2 | Production SHA unchanged | `git rev-parse origin/claude/activateos-platform-review-xzkgmd` === `97e975f0…` |
| V-3 | Preview URL resolves | HTTP 200 on the preview `/login` |
| V-4 | Preview identifies as synthetic/vNext | `/api/build` → `environment: "demo"`, `vercelEnv: "preview"`, `database.projectRef` = **the isolated ref**; and `environment_identity` on that DB reads `is_synthetic=true` |
| V-5 | Slice 1 flag ON works | "What matters now" renders on the Globex pursuit; "Earlier history (7)" opens and lists 7 entries |
| V-6 | Demo flag OFF unchanged | No `VNEXT_*` on Production; `demo.pursuitos.io` still shows Why now / Facts behind this / What changed |
| V-7 | Writes affect only isolated data | Only after V-4 passes. Confirm a write lands on the isolated ref, never `qifatlqxfuhwrwvpbwsc` |
| V-8 | No email/outreach can send | `/api/build` → `externalSendingArmed: false`; `OUTREACH_AUTOSEND` unset; `RESEND_API_KEY` absent |
| V-9 | Canonical numbers reconcile | 3 orgs · 14 companies · 19 opportunities · 11 open · $8,040,000 · 14 pursuits |
| V-10 | Desktop and mobile load clean | 1440×1000 and 390×844; no horizontal body scroll |

---

## Open question this session could not answer

**Have Preview deployments already been created for `roadmap/pursuitos-vnext`?**

The branch received roughly eighteen pushes over this weekend. If the Vercel
GitHub integration is enabled with default settings, each one produced a Preview
build against whatever `DATABASE_URL` the Preview scope carries. This session
could not verify it: there is no Vercel credential, the GitHub MCP server exposes
no deployments endpoint, and a Vercel branch alias cannot be constructed without
the team slug.

**What bounds the risk.** Three things, all verified:

1. A build performs **no** database access — every application route is dynamic
   (`ENVIRONMENT-MAP.md` §6, B-d). A preview nobody opened connected to nothing.
2. All `VNEXT_*` flags default OFF, so even an opened preview rendered the
   pre-slice product.
3. Slice 1 introduces **no writes**.

So the plausible worst case is *reads* against the demo database from an opened
preview URL. Worth confirming, not worth alarm — and it is one dashboard glance:
**Vercel → `PursuitOS-demo` → Deployments, filter Preview.** If previews exist
and the Preview scope shares `DATABASE_URL`, the cheapest immediate mitigation is
to **disable automatic preview builds for the branch** until an isolated target
exists.
