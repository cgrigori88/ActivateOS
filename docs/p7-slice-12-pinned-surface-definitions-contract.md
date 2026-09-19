# P7 Slice 12 — reusable / pinned Dynamic Surface definitions: contract and plan

**Status:** **CONTRACT RULED — A–H APPROVED (E, F MODIFIED). LOCALLY IMPLEMENTED; LOCAL EVIDENCE
INCOMPLETE — the seeded-clone harness database is not running (see §V).** Migration **0114** is written
and **not applied anywhere**. Hosted migration and certification require separate authorization. Decisions requiring a ruling are in §R. **Builds on:** Slices 1–10 and D-P45-READ, all
HOSTED ACCEPTED / CLOSED. Slice 11 remains blocked and is not resumed.

> **A pinned surface may persist a validated presentation/query definition. It may not persist
> governed results, derived identities, authority, disclosure decisions or execution state.**

---

## 1. The type boundary, traced

| Type | Contains | Persistable? |
|---|---|---|
| raw `ModelProposal` | untrusted, unvalidated | **no** — persisting untrusted input makes the store an ingestion surface |
| **`SurfaceSpec`** | `specVersion`, `layout`, ordered `components[{ component, bind }]` | **the only candidate** — purely structural |
| `ValidatedSurfaceSpec` | the above **plus `CompiledIntent` per component** | **NO — and this is the trap** |
| `ContextManifest` | ordered slots **and their canonical ids** | **no** — request-scoped, and it carries ids |
| `DerivedIdentityContext` | a resolved canonical id | **no** — execution-only by Slice 8's own contract |
| `executionDigest` | resolved identity facts | **no** |
| `SurfaceResult` | governed rows, aggregates, statements, resolved paths | **no** |

**The trap is worth naming.** `ValidatedSurfaceSpec` looks like "the validated definition" and is exactly
what a careless implementation would persist. It is **not safe**: for `EXPLAIN` and `GO_TO` its
`components[].intent.request` holds a resolved `{ subjectId }` / `{ ref: { id } }` — a **canonical
object identity**, produced by resolving request-scoped context. Persisting it would durably store a
governed object reference under the name "definition".

**So the persistable content is the structural subset of `SurfaceSpec` only**: layout, the ordered
component keys, and each bind's *closed vocabulary* fields — view keys, selectors, dependency edges —
and nothing that a compilation or an execution produced.

## 2. Persist structure, not results

> **Pinning preserves intent and composition, not observation.**

A persisted definition contains no `SHOW ME` rows, no `ANALYZE` values, no `EXPLAIN` statements, no
resolved `GO TO` destination, no selected identity, no handle, no `executionDigest`, no provider
output, no authorization or disclosure result, no principal, and no action state.

## 3. Component-derived identity never persists

A pin may persist the **dependency graph** (`SHOW ME → "first" → EXPLAIN`) but never *which pursuit was
first last time*. Every open reruns the upstream query, governance, ordering and selection.

> **A pinned dependency preserves the selector rule, not the previous selection.**

## 4. Fresh principal, fresh governance, every open

Nothing about authority persists: no `ExecutionPrincipal`, role, org authority or disclosure
entitlement. Save at T1 with broad authority, role changes, open at T2 → **T2 governance wins**. This
is the same rule Slices 7–10 established at three other boundaries, and it needs no new mechanism.

## 5. Revalidation on open

Save-time validation proves the definition was legal **then**; open-time validation proves it is legal
**now**. Every open runs the current deterministic validator again. A definition referencing a
primitive that no longer exists — a retired view, an unregistered component, a removed selector —
becomes a deterministic **`DEFINITION_UNAVAILABLE`**, never a silent migration to a nearest match and
never an invented fallback. This is the same refusal discipline as an unregistered metric.

## 6. Version drift — what must be stored to detect it

Versioned primitives a definition can reference: `ViewKey` (`PLANS`), `ComponentKey` + the registry's
`kind`/operation, `SelectorKey`, metric `id@version`, aggregate `id@version`, explanation template
`id@version`, destination surface keys, `specVersion`, `COMPILER_VERSION`, `SURFACE_COMPILER_VERSION`,
and the two digests the compiler already stamps: `componentRegistryDigest` and `vocabularyDigest`.

**Recommendation:** store `componentRegistryDigest` and `vocabularyDigest` **as recorded at save
time**, plus the compiler versions. They are not used to *authorize* anything — they let an open
distinguish *"same meaning"* from *"the primitives underneath moved"*, and a mismatch is a signal to
revalidate loudly rather than a reason to refuse outright (revalidation itself decides).

## 7. Provider boundary

Saving and opening a pinned definition require **zero** provider calls. A model may have composed the
surface originally; once pinned, the frozen validated definition executes deterministically.

> **Pinning freezes the validated definition, not a dependency on the generating model.**

Provenance (`HAND_AUTHORED` / `MODEL`, model id, prompt template version) may be stored for audit and
**must not** affect execution — the same rule Slice 5 established, where source is provenance and never
authority.

## 8. Ownership, and a boundary asymmetry I will not paper over

**The existing RLS model is org-scoped, and that is the only enforced boundary available.** Every
policy uses `is_org_member(org_id)`, which is:

```sql
select exists (select 1 from org_members m where m.org_id = org and m.user_id = auth.uid())
    or org = public.app_current_org();
```

Under the deployed runtime the app connects as `app_rw` through the pooler with `app.org_id` set, so
access is granted by the **second disjunct** — `auth.uid()` is not the acting identity on that path.

**Consequence, stated plainly: a `created_by_user_id = auth.uid()` policy would deny every
application request, so "private to the creating user" cannot be enforced in RLS today.** It can only
be an **application-layer** predicate. That means:

- **organization isolation → enforced by RLS** (strong, identical to every other table);
- **per-user privacy → an application-layer filter** (a query bug, not a policy violation, would expose
  a peer's pin *within the same org*).

I am not going to implement "private" while implying RLS strength. **§R-E returns this.**

> **Owning a pinned definition does not confer authority to execute its underlying operations against
> data.** Loading the definition and executing what it describes are two independent checks.

## 9. Editing and deletion — follow the existing patterns, not convenience

**Immutability has a precedent:** `pursuit_plan_revisions` is append-only with `revision_no`, and
supersession is "a higher revision exists". That is the model to copy — **create, rename, delete; a
semantic edit creates a new definition/version**, never a silent in-place mutation of a saved object's
meaning.

**Soft delete has no precedent at all.** There is **no `deleted_at`, `archived_at` or `is_deleted`
column anywhere in the 160-table schema.** The product's pattern is hard delete (or append-only
history). So a pin should be **hard-deleted**, and deleting it must not touch pursuits, P2/P6 data,
canonical business data, or any audit history living elsewhere.

## 10. ACTION components must be structurally excluded

The registry already declares `kind: "READ" | "ACTION"`, so this is enforceable at the type level
rather than by "we don't render them yet": the persisted DTO's component union should be the **READ**
keys only, with a compile-time exhaustiveness assertion so that **adding a component forces a decision
about whether it is persistable**. A runtime validator rejects an ACTION key as a closed-vocabulary
failure, exactly as an unknown component already is.

## 11. Digest semantics

`surfaceSpecDigest` is **unsuitable** as definition identity, and Slice 7 ruling A is explicit about
why: it is a **post-compilation execution-identity digest**, deliberately identity-sensitive — for a
context-bound component it incorporates the resolved canonical id. Reusing it would make a persisted
identity vary with *which object a past execution resolved*.

**Recommendation:** a separate `definitionDigest` over the canonically normalized **persisted**
structure (layout + ordered component keys + closed bind vocabulary + edges/selectors). Stable across
executions; unchanged when the world changes; changed only when the definition changes.
`executionDigest` and `surfaceSpecDigest` remain recomputed per run and are never stored.

## 12. The first vertical

```
SHOW ME open pursuits  +  ANALYZE open pipeline
```

Read-only, **no context binding, no component dependency, no action**. Save once; reopen later; prove:
same persisted definition · no model call · fresh principal · fresh governed results · changed
canonical data legitimately changes results · `definitionDigest` stable · execution identity changes
when the world changes.

That separates **persistent intent** from **fresh governed execution**, which is the only thing this
slice needs to prove.

## 13. Threat proofs the implementation gate must make

Pin stores no result data · no canonical identity · no principal, role or authority · no
`executionDigest` · opening derives the current principal · opening revalidates against the current
registry · opening reruns governance · a stale role loses access · stale context cannot silently
retarget · a foreign-org pin id cannot be loaded · ownership confers no data authority · no provider
call on open · ACTION components cannot be persisted · a deleted pin cannot be reopened · a semantic
edit cannot silently mutate definition identity · no result-to-model loop.

## 14. Excluded, unchanged

Action-bearing pins · persisted derived identities · persisted `ContextManifest` · org-shared pins ·
cross-org sharing · public templates · collaborative editing · model regeneration on open · arbitrary
JSON surface storage · value-based selectors · deeper chaining · P45 activation.

---

## R. Decisions requiring a ruling

**R-A — the persistable type boundary.** *Recommend: a separate `PersistedSurfaceDefinition`
containing only the structural subset of `SurfaceSpec`* — layout, ordered component keys, and closed
bind vocabulary. **Explicitly NOT `ValidatedSurfaceSpec`**, which carries `CompiledIntent` and
therefore a resolved canonical `subjectId` for EXPLAIN/GO_TO. A separate DTO also stops a field added
to `SurfaceSpec` later from becoming durable by accident — which is the failure mode worth designing
against.

**R-B — context-bound pins.** *Recommend the strongest form of your preference: do not persist
context-bound components at all in the first vertical.* `{fromContext:n}` is a positional index into a
**request-scoped** manifest; persisting it means "slot n of whatever context you happen to have next
time", which is a silent-retarget risk dressed as reuse. Restricting v1 to components that need no
recipient context removes the question rather than answering it weakly. **If the product requirement
for "pinning" actually means "save this exact pursuit surface", that is a different feature — a
durable object bookmark — and I am returning it rather than smuggling subject persistence in.**

**R-C — `definitionDigest` vs `surfaceSpecDigest`.** *Recommend a new `definitionDigest`.*
`surfaceSpecDigest` is recorded in Slice 7 as post-compilation **execution** identity and is
identity-sensitive by design; reusing it for persistence would embed an execution artefact in a stored
definition. The two must not be conflated, and `executionDigest` is never stored.

**R-D — save-time vs open-time validation.** *Recommend both, as you preferred:* save-time proves it
was legal then, open-time proves it is legal now, and an incompatible primitive yields a deterministic
`DEFINITION_UNAVAILABLE` rather than a migration or fallback. Store the save-time
`componentRegistryDigest` and `vocabularyDigest` as drift **signals**, not as authority.

**R-E — ownership and visibility. THE ONE I MOST WANT RULED.** The enforced boundary available today
is **org-scoped RLS**; `auth.uid()` is not the acting identity under `app_rw`, so a user-scoped policy
would deny every application request. Therefore "private to the creating user" can only be an
**application-layer** filter, and org isolation alone is the RLS-enforced guarantee. Three options:
**(a)** org RLS + application-layer user filter, with the asymmetry recorded — smallest, my
recommendation, provided we state that "private" is a product-level narrowing rather than a policy
boundary; **(b)** extend the tenancy substrate with a user GUC so user-scoped RLS becomes possible — a
change to a security primitive that affects everything and deserves its own ruling; **(c)** make v1
explicitly **org-visible**, so what is promised equals what is enforced — which conflicts with your
"no org-shared pins" exclusion, and so I am not choosing it unilaterally.

**R-F — edit and delete semantics.** *Recommend create / rename / delete, with a semantic edit creating
a new version*, following `pursuit_plan_revisions`' append-only precedent. **Hard delete**, because
**no soft-delete column exists anywhere in the schema** — I checked rather than picking the convenient
option, and introducing `deleted_at` here would be a new product pattern rather than reuse.

**R-G — structural exclusion of ACTION components.** *Recommend type-level exclusion*: the persisted
DTO's component union is the READ keys only, with a compile-time exhaustiveness assertion so adding a
component forces an explicit persistable/not decision, plus a runtime closed-vocabulary rejection.
Registry `kind` already makes this a declared fact rather than an inference.

**R-H — minimum schema if implementation proceeds.** One table: `id`, `org_id` (RLS boundary),
`created_by_user_id` (attribution and the application-layer filter), `name`, `definition` (the closed
DTO), `definition_digest`, the save-time registry/vocabulary digests and compiler versions,
`created_at`. Immutable rows; a semantic edit inserts a new one. **No column for results, identity,
principal, role, authority or execution state** — the schema itself should make the forbidden content
unrepresentable, not merely unwritten.


---

## V. Implementation status

**Rulings recorded.** A — a separate closed `PersistedSurfaceDefinition`; persistence is **opt-in by
field**, never inherited from `SurfaceSpec`. B — context-bound components are **refused**, in the
strong form; no canonical subject id as a workaround; "pin this exact pursuit" is a different,
separately-ruled feature. C — a domain-separated `definitionDigest`; `surfaceSpecDigest` is execution
identity and is not reused. D — validate at save **and** at open; no silent upgrade, substitution,
replacement, migration or repair; incompatible primitive → `DEFINITION_UNAVAILABLE` before execution.
E — **organization isolation is RLS-enforced; creator visibility is application-enforced, and is not
called RLS-private.** F — create / open / rename / hard delete only; rename is metadata and leaves the
digest untouched; no revision chains. G — ACTION components structurally non-persistable, exhaustively.
H — one table, with the forbidden content unrepresentable.

| Module | Role |
|---|---|
| `surface/persisted.ts` | the closed type, the exhaustive persistability map, save/load validation, `definitionDigest` |
| `surface/pin-repository.ts` | the **only** production access path; every statement scoped by org **and** creator |
| `supabase/migrations/0114_…sql` | one additive table; org RLS; no column for results, identity, authority or execution state |
| `page.tsx` | `?pin=<name>` saves from the **pre-execution** spec; `?open=<id>` revalidates, compiles and executes fresh |

**Two things I changed in the product rather than in a test.** Opening a pin now compiles against the
**empty** manifest — a persisted definition has no context-bound components by construction, so
reading recipient context for it would have been both unnecessary and misleading. And the Slice 1
no-writes invariant was **narrowed in the Slice 5/9 shape and strengthened**: P7 may now mutate
**exactly one table from exactly one named module**, every other P7 file still performs no SQL
mutation, and a list of canonical tables is asserted untouchable. The blanket form was no longer
honest once P7 owned durable state; the replacement also pins *where* the write path is.

**Evidence so far.** `p7-slice12` **25/25** · unit **802/802** · tsc and `next build` clean.

**Evidence NOT yet obtained, and why.** The seeded-clone verifier and `certify-world` require the local
harness database at `127.0.0.1:5433` (`pursuit_demo`, role `postgres`). It was running earlier in this
session — `certify-world` passed on it — and is now down. I did **not** guess at how it is provisioned:
I briefly started Homebrew's `postgresql@17`, found it binds `:5432` with no `postgres` role and is
therefore **not** the harness instance, and stopped it again, leaving the machine exactly as found
(`postgresql@17 none`, no listener). **Migration 0114 has been applied nowhere.**

**Five defects of my own in the suite**, all fixed before the recorded run — and four were the **same
§16A trap for the fifth time in this engagement**: assertions that scanned text containing the prose
which *explains* the property. The migration's own comments say why there is no `auth.uid()` policy and
no visibility/metadata column, so a raw scan found those words in the text forbidding them; structural
assertions now read **comment-stripped DDL**, with the prose asserted separately on purpose. The fifth
was a substring scan for `"value"` that collided with the legitimate view key `open-by-value` — now
asserted on **field names** rather than serialized bytes.

**Proposed deployment order (§16F), for authorization — not taken.** Migration 0114 is purely additive
and referenced by no existing object, so the currently serving application is unaffected by the table
existing. The safe order is therefore: **deploy the implementation commit → prove the serving commit
independently → apply 0114 → establish a new baseline → certify.** Deploying first also means the pin
feature is the only thing that could fail in the window, and it fails closed. **Production is not
touched.**


---

## W. Post-review rulings, and the harness STOP

**Ruling A — empty manifest on reopen: APPROVED.** A v1 definition is structurally forbidden from
containing context-bound components, so reopening compiles against the empty manifest rather than
reconstructing recipient context the definition cannot consume. Recorded:

> **Persisted definition execution derives fresh authority but carries no persisted or
> request-context identity dependency.**

Recipient `ContextManifest` construction is **not** reintroduced for symmetry with ordinary surfaces.

**Ruling B — the P7 mutation invariant: APPROVED, and scoped.** The blanket *"P7 performs no writes"*
is no longer literally true now that P7 owns durable definition state. It is replaced by:

> **P7 may persist only its explicitly authorized durable definition state through the named
> persistence module. All other P7 execution remains read-only with respect to canonical, business
> and governance state.**

Mechanically enforced: exactly one authorized table · exactly one authorized production module · no
other P7 SQL mutation · canonical Pursuit/P2/P6/P45/business tables mutation-forbidden. **The
exception is capability-scoped and module-scoped — not a general licence to write.**

**§16H-SOURCE — authorized AFTER Slice 12 closes, deliberately not folded in now.** The recurring
§16A collision deserves the same treatment §16H gave disclosure, but not by changing this slice's
candidate commit while two local proofs are merely missing. When it is built it must be
**language-aware** — preserving SQL quoted strings and identifiers while excluding comments, and
parser/AST-aware for TypeScript — never a naive global regex stripper. The principle mirrors §16H:
**the assertion must name the semantic region it intends to inspect.**

### Migration order — REVISED, and migration-first is right

My proposed deploy-first order is **superseded**. 0114 is additive and invisible to the serving
application, so migrating first removes any window in which newly deployed pin code could meet a
missing table. **Proof that 0114 is backwards-compatible with the currently serving commit**, taken
from the migration itself:

| Statement | Target |
|---|---|
| `create table if not exists` · 2 × `create index` · `create policy` · `drop policy if exists` · 2 × `alter table` · 2 × `comment on` · `grant` | **every one of them `pinned_surface_definitions`** |

**No statement alters, drops or rewrites any pre-existing object.** The only pre-existing things it
*references* are `organizations(id)` (FK), `is_org_member` (the canonical RLS predicate) and the
`app_rw` role — all present today and unmodified. A serving commit that has never heard of the table
is therefore unaffected by its existence.

**The ruled hosted order, for when authorization comes:** capture the pre-0114 Preview baseline → apply
0114 to Preview only → verify the existing serving application remains healthy → establish the
post-0114 baseline → deploy the accepted implementation commit → independently prove it is serving →
run Slice 12 hosted certification. **Production is not contacted.**

**Expected consequences to carry into certification:** the schema legitimately moves **113 → 114**, so
the fingerprint inventory must be re-derived from the new baseline and **"160" must not be
hard-coded**. Save/rename/delete tests intentionally mutate the authorized pin table, so the success
condition is an **allowlisted mutation proof**, not a blanket zero-diff — with canonical, business,
P2, P6 and P45 state required to stay stable.

### THE HARNESS: STOPPED, with evidence

The canonical harness is documented as Postgres 17 on `127.0.0.1:5433`, socket `/tmp/pgv5433`,
database `pursuit_demo`, role `postgres`, with its data directory **in the session scratchpad**
(`docs/vnext/SESSION-HANDOFF.md` §§128, 276, 641–651).

**That data directory no longer exists**, so there is no cluster to start:

- `/tmp/pgv5433` exists but is **empty** — the cluster ran and shut down, taking its socket with it;
- **no `PG_VERSION` exists anywhere** under the session scratchpad or `/tmp`;
- the only Postgres data directory on the machine is Homebrew's `/opt/homebrew/var/postgresql@17`,
  and it is **virgin**: 39 MB, **3 databases** (the two templates plus `postgres`), a **13-line** log
  whose earliest entry is my own start at 23:27 tonight, and **no `postgres` role**. It is not the
  harness, and it never was.

The documented recovery is `initdb` + `pg_ctl` + `seed-demo-world.ts` — which **builds a new world**
rather than restoring the one `certify-world` has been comparing against. That is creating a
replacement cluster, so I stopped and returned this instead.

**What I did and undid:** I briefly ran Homebrew's `postgresql@17` to test whether it was the harness,
found it binds `:5432` with no `postgres` role, and stopped it. `brew services list` reports
`postgresql@17 none` and no listener remains — **the machine is exactly as I found it**, and nothing
was initialized, seeded or substituted.


---

## X. Harness reconstruction — AUTHORIZED, EXECUTED, and STOPPED with two findings

**What was done, exactly as documented** (`SESSION-HANDOFF.md` §§641–651), from the **pre-0114** tree
(`3de4813`: 113 migration files, no `0114`, clean):

```sh
PG=/opt/homebrew/opt/postgresql@17/bin
$PG/initdb -D <scratchpad>/pgdata -U postgres --auth=trust -E UTF8 --locale=en_US.UTF-8
mkdir -p /tmp/pgv5433 && $PG/pg_ctl -D <scratchpad>/pgdata -o "-p 5433 -k /tmp/pgv5433" -l <dir>/log start
env -u DEMO_TARGET_URL -u DATABASE_URL DEMO_PGHOST=127.0.0.1 DEMO_PGPORT=5433 DEMO_DB_NAME=pursuit_demo \
  DEMO_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres \
  DEMO_URL=postgresql://postgres:postgres@127.0.0.1:5433/pursuit_demo npx tsx scripts/seed-demo-world.ts
```

No improvised seed, schema subset, dump or hand-made fixture was used.

**Harness identity, proven rather than inferred (§4):**

| | |
|---|---|
| version / port / socket | **PostgreSQL 17.11**, **5433**, **`/tmp/pgv5433`** |
| database / role | **`pursuit_demo`** / **`postgres`** |
| public tables | **159** |
| `schema_migrations` | **empty** — exactly as the handoff documents for a `demo-db.ts`-built world |
| `pinned_surface_definitions` | **absent** — 0114 applied nowhere |
| Homebrew `:5432` | **stopped**, nothing listening — it is not the database under test |

### Finding 1 — the canonical world is NOT reproducible from source

| Instance | World digest |
|---|---|
| pre-loss recorded baseline | **`c9004670ffda112f`** |
| clean reconstruction #1 | **`295a0090ef57590c`** |
| clean reconstruction #2 (identical command, minutes later) | **`d43fe13b1f194132`** |

Two clean recreations **on the same day, from the same commit, with the same command** produced
**two different digests**, and neither matched the recorded baseline. So the divergence is **not**
date-parameterisation — **the seed is non-deterministic run to run.**

What that means precisely, stated narrowly: `c9004670ffda112f` was a property of *that particular
seeded instance*, not of the repository. Within any single instance the world is stable —
`certify-world` reported start digest **==** end digest in both reconstructions — so its **drift
detection still works**. What is lost is **cross-instance reproducibility**, and therefore the ability
to answer *"can the repository reconstruct the certified pre-0114 world from source?"* with **yes**.

**I have not blessed a new baseline.** Per §2 this is returned, not resolved.

### Finding 2 — `ordering-determinism` carries a stale hard-coded fixture date

Reproduced **identically in both reconstructions**: 42 passed, **1 failed**.

> `C2 non-unique LIMIT: the 6 kept activity rows are the documented (occurred_at desc, id desc) set`
> — got `["Cyberdyne Systems","Initech Financial (expansion)","Wayne Enterprises","Umbrella Health
> Systems","DG82 Act 0","DG82 Act 1"]`

**Root cause proven, not guessed.** The fixture plants eight outcome events at a **hard-coded literal**
`'2026-09-16T00:00:00Z'`, with a comment asserting they are *"newer than everything else"*
(`scripts/ordering-determinism-verify.ts` §§294–305). A freshly seeded world carries
`outcome_events` to **2026-09-18** (today is 2026-09-19), so **four real rows now outrank the
fixture** and only `DG82 Act 0`/`1` survive into the top six.

This is a **defect in the certification suite**, exposed by reconstruction — the CFR-1.2 clock class
this engagement has tracked throughout. It is **not** a Slice 12 defect (`7e735ce` was not even
checked out) and **not** a product defect: the ordering code under test is unchanged, and the
expectation is what has gone stale. **I have not edited the suite.**

### Consequence

The pre-condition in §3 — *"Can the repository still reconstruct the same certified pre-0114 world
from source?"* — is **answered NO**, for a reason more fundamental than the missing data directory.
Slice 12's missing local evidence (seeded-clone verifier, `certify-world`) therefore cannot be
completed against a world that matches the recorded baseline, and I have not proceeded to it.

`7e735ce` remains frozen and unmodified; the working tree is back on it. Migration 0114 is applied
nowhere. Production untouched.
