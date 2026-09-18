# P7 Slice 10 — governed actions on component-derived subjects: contract and plan

**Status:** **CONTRACT RULED — A–E APPROVED, C MODIFIED. IMPLEMENTATION AUTHORIZED.** Hosted
acceptance requires separate authorization. The rulings as returned are recorded in §R. **Builds on:** Slices 1–9, all HOSTED ACCEPTED / CLOSED. Slice 9 is not reopened.

> **A component-derived identity may determine which governed subject an action affordance refers to.
> It may never carry action authority across the render-to-click boundary.**

Substrate stays `dispatchSkill` and `assemble_pursuit_team@1`. **P45 is not enabled.**

---

## 1. The first vertical

```
SHOW ME open pursuits
      │  certified select: "first"   (Slice 8, per-plan certified export)
      ├──► EXPLAIN                (read)
      ├──► GO TO                  (read)
      └──► ASSEMBLE PURSUIT TEAM  (affordance only — never executed during assembly)
```

All three consumers take the **same** derived identity. No second-level chaining, no ANALYZE
dependency, no new selector, no model-authored payload.

---

## 2. The finding that decides §C, §D and §E

**I read the Next.js documentation in this repo rather than assuming the framework's behaviour**, and
it draws a distinction that maps exactly onto the problem:

> *"Next.js automatically encrypts the closed-over variables. A new private key is generated for each
> action every time a Next.js application is built."* — `02-guides/data-security.md`

**Closed-over variables are encrypted. `.bind()` arguments are not closures, and are not encrypted.**

That is not a theory — it is what Slice 9's own hosted gate observed. The rendered form carried:

```html
<input type="hidden" name="$ACTION_2:1" value='["95731ced-ef70-4185-9234-c1a0ec660123"]'/>
```

a **plaintext** canonical id, because Slice 9 used `assemblePursuitTeamFormAction.bind(null, subjectId)`.
And H7 proved it is genuinely caller-controlled: substituting a foreign id reached the server and was
refused by `dispatchSkill` with *"pursuit not found in this org"*.

For Slice 9 that was correct and sufficient: the subject came from the recipient's **own pre-existing
ContextManifest**, so a tampered own-org id was one the caller could have composed a surface for
anyway. **Slice 10 changes that**: the subject is *selected by the system*, so "any own-org id the
caller can name" is materially wider than "the pursuit the surface selected".

**The mechanism already exists, and it is the framework's.** Defining the action as a **closure over
the selected subject** instead of a bound argument makes the framework encrypt it with a per-build,
per-action key. A caller cannot forge a ciphertext for a different pursuit, so retargeting stops being
a policy check and becomes **structurally unavailable** — with no new secret, no bespoke HMAC and no
capability token invented.

**The residual, stated plainly rather than buried.** Encryption prevents *forging* a subject; it does
not prevent *replaying* a ciphertext the server itself produced for this principal in an earlier
render. To obtain a blob for pursuit B, B must actually have been selected as "first" for that
principal at some point — so the residual is "a subject this surface really did select for this
viewer, at a different moment", not "any pursuit". The documentation itself says encryption should not
be the only defence, and it is not: **click-time `dispatchSkill` authority remains authoritative**.
Cross-build replay is additionally bounded because the key is regenerated per build.

---

## 3. Derived identity remains execution-only

Slice 8's `DerivedIdentityContext` is unchanged: ephemeral, provider-invisible, non-promptable,
non-persistent, and structurally not a recipient `ContextManifest` (no `slots`, so `toPrompt` refuses
it in the type system and again at runtime). The action component consumes it **during assembly only**,
to decide which subject the affordance represents.

> **Derived identity may determine subject presentation. It may not survive as authorization.**

## 4. Identity laundering stays impossible

A canonical id becomes server-action input **only after** the certified `SHOW ME → first` binding
resolved it. It never becomes model input, model output, a `SurfaceSpec`-authored value or a
caller-selected subject during composition — those positions do not exist in the schema.

> **Subject identification is not subject authorization.**

## 5. Upstream selection is still not action authority

Extending Slice 8:

> **Upstream visibility and identity export are not action authority.**

`SHOW ME` may legitimately select a pursuit the viewer can read while that viewer cannot invoke
`assemble_pursuit_team@1`. Identity-export eligibility must never imply action eligibility — they are
different registry facts, consulted separately.

## 6. Atomicity with an action affordance

The action does not execute during assembly, so a missing affordance cannot require undoing anything.
**Recommended rule (§R-A): the action component is never a required dependency for atomicity.** If the
action is not offered, the affordance is absent and the valid READ surface stands. That is materially
different from a required READ dependency becoming unavailable, which still fails the whole surface
under Slices 7 and 8.

Hosted evidence already exists: Slice 9's H3 demoted the viewer and all three READ components still
rendered while the action alone disappeared.

## 7. Zero-row upstream

Unchanged from Slice 8: zero governed rows with a required downstream identity → the bare
`NO_SELECTABLE_RESULT`. **No unbound action is rendered**, no fallback to recipient context, and no
memory of a previously selected pursuit.

## 8. Governance change before render

READ atomicity is unchanged. Action-offer eligibility is decided from the **current render-time** role
and governance — never cached from the moment the handle was produced. In practice the handle and the
offer decision are computed in the same request, so there is no window to cache across.

## 9. Governance change after render

Slice 9's rule carries over unchanged and was already proven hosted: **click-time authority wins.** The
rendered id and affordance preserve no org membership, role, action permission or subject eligibility.

## 10. Selection changes between render and click

Pursuit A was "first" at render; canonical state moves so a fresh `SHOW ME` would now select B; the
user clicks the affordance they actually saw.

**Recommended (§R-B): the click still identifies A.** The server authorizes **A** under current
governance. `SHOW ME` is **not** re-run at click, and the action is never silently retargeted to B.

> **Current authority is re-evaluated; historical UI selection is not recomputed.**

This is also why re-derivation cannot serve as the anti-tamper mechanism (§2): verifying "the submitted
id equals the current first" would reject a legitimate stale click precisely when ordering changed.

## 11. Tampering

| Attempt | Outcome |
|---|---|
| foreign-org pursuit | ciphertext cannot be forged; even if it could, `pursuitInOrg` + RLS refuse, as Slice 9 proved hosted |
| nonexistent UUID | same |
| own-org pursuit **B** that the caller *is* authorized for | **rejected** (§R-D) — structurally, because the subject is encrypted by the framework |
| a pursuit never returned by the upstream result | same as B |

## 12. Integrity is not authority

> **A valid binding proves "this is the subject the server rendered into this affordance." It does not
> prove the caller remains authorized to execute this action.**

Current `dispatchSkill` authority still decides. The encrypted subject is an **integrity** artefact; it
carries no role, no org, no permission and no expiry-of-authority meaning.

## 13. Model boundary

The model may propose `SHOW_ME → first → ACTION`, because both the selector and the action component
are registered. It never receives the selected id, upstream rows, integrity material or a dispatch
result. No result-to-model loop. *"Assemble the team for the second / largest / hidden pursuit"* stays
bounded by Slice 8's closed selector vocabulary.

## 14. Arguments

Slice 9's zero-argument contract is unchanged and structural. The only dynamic datum is subject
identity. The action schema is not generalized.

## 15. Idempotency

`dispatchSkill`'s existing `(org_id, skill_id, idempotency_key)` mechanism, unchanged. Derived-subject
binding introduces **no second idempotency scheme**. `assemble_pursuit_team@1` remains
business-idempotent.

## 16. P45 stays inert

`controlPlane=false`; no plan, run, approval or runtime call. **Posture of record:**
`org_features.governed_action` is **true** for the current Preview organizations and
`VNEXT_CONTROL_PLANE_ENABLED` is **off** — one gate is doing the work, and this slice neither changes
nor depends on that column.

## 17. The headless contract

**Recommended (§R-E): no integrity metadata enters the headless `SurfaceResult`.** It carries what
Slice 9 already certified — component, title, `interpretedAs`, capability key, `subjectId`, `offered` —
and the integrity artefact lives **only in the invocation transport**, produced by the framework when
the renderer closes over the subject. Nothing executable, no authority, no P45 state, no payload.

## 18. Smallest implementation plan

```
surface/registry.ts    pursuit.assemble_team gains acceptsComponentIdentity: true
surface/compile.ts     an ACTION bind may carry { fromComponent, select } as well as { fromContext }
surface/assemble.ts    the ACTION subject resolves from the derived identity, as EXPLAIN/GO TO do
app/experience/…/actions.ts   the action becomes a CLOSURE over the subject, not a .bind() argument
page.tsx               unchanged in substance — it renders whatever the assembler decided
```

**No database schema, environment, flag, P5 or P6 change. No new secret.**

## 19. Threat proofs the implementation gate must make

The model cannot select an arbitrary subject · only the certified `"first"` export may supply it ·
`DerivedIdentityContext` never reaches a provider · the selected id is absent from the `SurfaceSpec`
and from any model proposal · **the rendered transport carries no plaintext canonical id** (the Slice 9
observation, inverted into a requirement) · a tampered subject cannot execute, own-org or foreign ·
render binding is integrity, not authority · click-time governance always re-runs · an ordering change
does not retarget a stale affordance · action absence does not invalidate valid sibling reads · zero
upstream rows → `NO_SELECTABLE_RESULT` with no affordance · no dispatch during render or compose · only
an explicit click mutates · no P45 activity · no P7 persistence.

**Negative controls for:** reverting to a `.bind()` subject (plaintext in the transport) · re-running
`SHOW ME` at click · treating export eligibility as action eligibility · caching the offer decision ·
failing the whole surface when only the action is unavailable.

## 20. Excluded, unchanged

P45 actions · approvals · non-idempotent actions · action chaining · autonomous execution · autosend ·
value-based selectors · arbitrary ordinals · second-level identity chains · generic dataflow ·
model-authored payloads.

---

## R. Rulings (returned and recorded)

**R-A — APPROVED.** The ACTION component is **not a required dependency** for the read surface. If the
selected pursuit remains valid for the READs but the viewer may not be offered the action, SHOW ME,
EXPLAIN and GO TO render and the affordance is **omitted** — the surface does not fail.

> **A missing optional action affordance does not invalidate a valid read surface. A missing required
> read dependency does.**

**R-B — APPROVED.** A stale rendered action still identifies pursuit **A**. `SHOW ME` is not re-run at
click and the action is never silently retargeted to B. The click means *"act on the subject
represented by the affordance I actually clicked"*, and current authority for A is re-evaluated then.

> **Selection identity is preserved; authority is not.** A stale selection may remain the requested
> subject. A stale authorization may not survive.

**R-C — APPROVED WITH MODIFICATION.** Use Next's existing encrypted-closure mechanism rather than
`.bind()`. **No custom HMAC, no new signing secret, no persisted nonce table, no capability-token
service, no P7 action session.** But the closure must capture **more than the subject**:

- the selected canonical pursuit id;
- the **render-time authenticated principal identity**;
- the **render-time organization/scope identity** needed to distinguish that rendered affordance.

On invocation: restore the closed-over values through the framework, **independently derive the
current principal and org server-side**, verify the invocation corresponds to the principal/scope the
affordance was rendered for, then pass the captured subject into the fixed `dispatchSkill` path and let
current dispatch authorization decide.

> **Render binding proves "this is the subject this server rendered for this principal/scope." It does
> not prove "this principal is still authorized to act."**

**R-C1 — why principal/scope binding is required.** Encryption alone prevents arbitrary modification of
the subject; it does **not** establish that a valid payload originated in the current caller's render. A
payload copied from another render must not let a different principal invoke a system-selected subject
merely because they independently hold action permission. **Do not assume this property from encryption
alone** — either prove the transport makes it structurally impossible, with exact framework evidence
proven hosted, or keep the explicit captured-principal/scope comparison.

**R-C2 — the accepted replay residual, narrowed.** The **same** principal/scope may replay a previously
valid encrypted affordance the server genuinely rendered to them. Acceptable because the subject was
genuinely system-selected for that principal/scope, click-time governance is re-evaluated,
`assemble_pursuit_team@1` is business-idempotent, existing dispatch replay semantics still apply, and
build-key rotation limits stale artefacts. **Do not claim single-use semantics. Do not add server-side
nonce persistence in this slice.** A later non-idempotent action needs a stronger invocation contract.

**R-C3 — hosted proof required.** The documentation finding is accepted as the **design basis only**;
it has not been certified in this application. Hosted acceptance must inspect the **actual rendered
transport and response bytes** and prove: no plaintext canonical pursuit id · no plaintext captured
principal/org values · A → B retargeting impossible · malformed/tampered closure state rejected ·
current server-side authentication and governance still re-run · rendering alone causes no invocation.
**Do not infer confidentiality or integrity from framework documentation alone.**

**R-D — APPROVED: MUST BE REJECTED.** A caller may not change the invocation from A to B because B is
in the same organization, because they could otherwise act on B, or because B would pass
`dispatchSkill`. That would make the affordance a generic `assembleTeam(anyPursuitId)` endpoint and
destroy the meaning of system-derived selection. Under the approved design this is structurally
unavailable; if a manipulated transport nevertheless reaches the server, **fail before business
effect** — never fall back to "B is authorized anyway".

> **Authorization answers whether the action may execute on the bound subject; it does not permit the
> caller to redefine which subject was bound.**

**R-E — APPROVED.** No anti-tamper or render-binding metadata enters `SurfaceResult`; the Slice 9
headless contract is preserved. The integrity artefact belongs solely to the invocation transport
generated by the framework/server rendering layer.

> **Surface semantics and invocation integrity are separate layers.**

---

## R (original). Decisions returned for ruling

**R-A — action absence vs whole-surface atomicity.** *Recommend: the action component is never a
required dependency.* If the affordance is not offered, it is absent and the valid READ surface stands;
a required READ dependency becoming unavailable still fails the whole surface. Slice 9's H3 already
demonstrated this shape hosted, with all READs rendering while the action alone disappeared.

**R-B — stale selection when ordering changes.** *Recommend: the click identifies the pursuit the user
actually saw (A), authorized under current governance.* `SHOW ME` is not re-run at click and the action
is never silently retargeted. Consequence to accept: a user may act on a pursuit that is no longer
"first" — which is correct, because they are invoking the affordance they were shown, and its authority
is re-evaluated regardless.

**R-C — anti-tamper binding.** *Recommend the framework's existing mechanism: define the action as a
**closure** over the selected subject rather than a `.bind()` argument, so Next encrypts it with its
per-build, per-action key.* No new secret, no bespoke HMAC, no capability token. **The residual I want
ruled with eyes open:** this prevents forging a subject but not replaying a ciphertext the server
produced for this same principal in an earlier render — bounded, because that subject must genuinely
have been selected for them, and because the key rotates per build. If you want that residual closed
too, it needs a nonce with server-side state, which §17 and Slice 9's no-persistence rule currently
forbid — I would rather return that than quietly accept a weaker claim. *Rejected alternative:*
re-deriving "first" at click, which would break §R-B.

**R-D — must a tampered but authorized own-org subject be rejected?** *Recommend: yes*, as your
starting preference — otherwise a rendered affordance becomes a generic act-on-any-pursuit endpoint.
Under R-C this is enforced **structurally** rather than by a policy check.

**R-E — where integrity metadata belongs.** *Recommend: not in the headless result at all.* The
`SurfaceResult` keeps exactly the Slice 9 fields; the integrity artefact exists only in the invocation
transport, created by the framework. This keeps the headless contract free of anything resembling
authority and leaves React purely presentational.

**One thing I want confirmed rather than assumed:** the closure-encryption behaviour is documented in
this repo's own Next version, but Slice 9's transport used `.bind()`, so it has **not** been observed
here. The implementation gate must prove it *hosted* — that the rendered transport contains no
plaintext canonical id — before any claim in R-C is treated as certified.

---

## V. Implementation status — LOCALLY IMPLEMENTED AND PROVEN (hosted acceptance NOT authorized)

**Evidence.** `p7-slice10` **21/21** · unit **765/765** · `p7-slice1` **66/66** (seeded clone) · tsc and
`next build` clean · `certify-world` **52 suites clean, no drift** (`c9004670ffda112f`). All five ruled
negative controls bite, four of them **on the checkers themselves** (reverting to a bound argument,
omitting the principal/scope comparison, treating the binding as authority, and re-running SHOW ME at
click are each constructed in memory and confirmed caught).

**No database schema, environment, flag, P5, P6 or P45 change. No new secret.**

| Module | Change |
|---|---|
| `surface/registry.ts` | `pursuit.assemble_team` gains `acceptsComponentIdentity: true` — it still exports nothing |
| `surface/schema.ts` | the ACTION subject becomes `CONTEXT \| DERIVED`; `SurfaceResult` unchanged |
| `surface/compile.ts` | a derived action subject validates through the **same** `validateDependency` |
| `surface/assemble.ts` | the derived subject resolves from the export; **no subject ⇒ `NO_SELECTABLE_RESULT`** |
| `app/experience/pursuits/binding.ts` | **new, `server-only`** — the render binding and principal derivation |
| `app/experience/pursuits/actions.ts` | takes a `RenderBinding`; compares principal and scope **before** role and dispatch |
| `page.tsx` | the affordance now **closes over** the binding instead of `.bind()` |

**The closure is the mechanism, and the plaintext transport is gone.** `page.tsx` defines an inline
`"use server"` function capturing the binding, so the framework encrypts it. A suite asserts
`.bind(null, component.subjectId)` is absent and that the form renders no caller-controlled field —
with a control that reintroduces the bound argument and confirms it is caught.

**The binding module is deliberately not a `"use server"` file.** Everything exported from one becomes
a callable endpoint, and a helper that reports who the server thinks you are has no business being one.
It is `server-only` instead, so it cannot reach a client bundle either.

**Ordering is integrity → current role → dispatch**, asserted positionally: the principal/scope
comparison happens first, the role is resolved again at click, and `dispatchSkill` decides last. The
suite also asserts the binding is never consulted as permission.

**An action with no subject is not an action.** A derived action whose upstream exported nothing yields
`NO_SELECTABLE_RESULT` — never an unbound affordance, and never a fallback to recipient context. That
is distinct from the affordance merely not being *offered*, which omits it and leaves the read surface
standing (ruling A).

**What is NOT proven locally, and must be proven hosted (ruling C3):** that the deployed transport
contains no plaintext canonical id, no plaintext principal or org, that it cannot be modified to
retarget A → B, that malformed closure state is rejected, and that a different principal cannot reuse
another's binding. Those are properties of the running framework, and the documentation is the design
basis only.

**Three defects of my own in the suite**, all caught before the recorded run — and all the **same class
I have now hit four times**: a source scan that matched the prose *describing* the property rather than
the code implementing it. The binding module's own comment explains that it is not a `"use server"`
file; the schema's comment on `offered` says it is "not authorization"; and `bindings` in the assembler
is Slice 8's legitimately-named execution-digest input. Each is now scoped to stripped code or to
declared field names, with a control proving the prose still exists outside the scanned region.
