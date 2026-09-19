# P7 Slice 12 — reusable / pinned Dynamic Surface definitions: contract and plan

**Status:** **DESIGN AND DISCOVERY ONLY — NOT AUTHORIZED FOR IMPLEMENTATION.** No code, no migration,
no DB mutation. Decisions requiring a ruling are in §R. **Builds on:** Slices 1–10 and D-P45-READ, all
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
