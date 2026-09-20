# D-P454-PRODUCTION-ARTIFACT-DELETION — operational incident, 2026-09-20

**Status: RECORDED / REMEDIATION HELD.** Not a product defect. A process failure in the P45-4
Boundary-B deployment cleanup, and the standing invariant adopted because of it.

---

## 1. What happened

> **The Production database was never addressed and no Production data was read or written. The
> live Production deployment remained intact, aliased and serving throughout. However, the P45-4
> Boundary-B cleanup sweep deleted 12 historical Production deployment artifacts of
> `pursuitos-demo`, including the build of `97e975f0`, the documented known-good demo reference.
> `--safe` prevented deletion of the current Production deployment because it carried an alias.
> This was artifact and rollback-capability loss, not data loss and not live-service impact. All 12
> source commits remain in Git and are redeployable; the original deployment identities and their
> exact build-time environment resolution are not recoverable.**

**188 unique deployments were deleted**, not 199. The earlier figure counted all 180 sweep *targets*
as deletions when 12 were refused by `--safe`, and omitted the final removal. The audited arithmetic:

```
B = 19    named removals                      (B ∩ A = 0, verified)
A = 182   complete enumeration, captured after B and after ON-A existed
C = 180   sweep targets = A \ {serving, ON-A}
C ∩ D = 12   refused by --safe (all aliased)
C \ D = 168  deleted
+ 1       the former OFF deployment, removed after the alias moved
DELETED = 19 + 168 + 1 = 188        200 at phase start + 2 created − 188 = 14 retained ✓
```

## 2. The twelve deleted Production artifacts

Authoritative classification came from GitHub's deployments API (`.environment` =
`"Production – pursuitos-demo"`, Vercel URL in each deployment's statuses) — **not** inferred from
branch names. Exactly 12 such deployments exist in the repository's history; all 12 were deleted.

| Vercel URL | Source SHA | Commit subject |
|---|---|---|
| `…-odxrmgfwp-…` | `97e975f` | Wave 6D: make canonical demo manifest deterministic |
| `…-oexfpqnzt-…` | `66f72f6` | Wave 3: final demo polish |
| `…-eiox3wrpv-…` | `f0bbcaf` | Wave 2: make the demo journey read as one product |
| `…-khdtt3n5r-…` | `41e66dd` | Wave 1: lock the visual system onto one set of tokens |
| `…-iks3apgn1-…` | `34dcc8e` | Mark the app and demo deployments noindex |
| `…-lep5mvrwq-…` | `b8ff543` | Certify the demo environment against the live deployment |
| `…-p14pl811k-…` | `561d156` | Fix: `/joint` lost its navigation to a path-prefix match |
| `…-6xnw402ye-…` | `7777ff6` | Let the ops fingerprint endpoint past the auth gate |
| `…-l403y5a3u-…` | `6e6b748` | Distinguish an unreadable database from an unmarked one |
| `…-55w8bkw1b-…` | `f017cbb` | demo-db in-place: require schema parity |
| `…-j6iu84g5y-…` | `886abe1` | Landing page: runtime-configurable contact route |
| `…-ikj1qe2o1-…` | `a535b3f` | Trigger Vercel builds for pursuitos-web and pursuitos-demo |

Every source commit still exists in Git; `97e975f0` additionally carries the pushed backup tag
`backup/2026-09-04/tds-live-demo`.

## 3. Classification

- **Artifact loss — yes.** Twelve built Production runtime artifacts are gone permanently.
- **Data loss — no.** Deployments are build artifacts; no database, table, row or migration moved.
- **Live-service impact — no.** `dpl_22uuzDWFfMw1X8kZ8WYSnJDEzZ6K` served continuously;
  `https://demo.pursuitos.io/` answers `307 → /login`, the application itself.
- **Rollback-capability loss — yes.** The instant-promotion path to any of those twelve is gone,
  including the artifact of the documented known-good demo reference.

## 4. THE STANDING INVARIANT

> **A destructive deployment operation requires: complete enumeration WITH PAGINATION · a frozen,
> materialized candidate set · positive Environment classification per candidate · positive
> project/database classification · explicit Production exclusion · the final candidate IDs printed
> · an asserted ZERO-Production-candidate count · and only then deletion.**

**`--safe` is an alias-protection backstop. It is not environment scoping and must never substitute
for positive classification.** No `head`, no implicit page bound and no URL-only sweep qualifies.

The failure was exactly that: the sweep filtered `vercel ls` output by URL without reading the
Environment column, and the listing had been truncated twice — once by `head -14`, then by the
default 20-per-page bound — so a surface of 182 was reported as 14. This is §16M's rule
(a membership assertion must control for the presentation window) applied to a destructive action
instead of a test, which is where it costs the most.

## 5. Remediation status — HELD, and why

The owner authorized reconstructing **one** credible Production rollback from `97e975f0`,
explicitly labelled a **RECONSTRUCTED** rollback deployment rather than a restored one, since its
identity, timestamp and resolved environment are necessarily new.

**That reconstruction is HELD and was not performed.** Source inspection of `97e975f0` found a
blocking hazard: `src/app/pipeline/page.tsx` writes to `pipeline_snapshots` **from a page render** —
its own comment reads *"Today's snapshot, idempotent — history accrues just by looking."* That is
the D-HIST-1 / D-P1 read-path-write class, later closed by `6f3e65d`. A Production-configured
deployment of that commit would therefore mutate canonical Production history the moment any
certification loaded `/pipeline`, and the Production database is not readable from this
workstream — so such a write could be neither prevented by evidence nor detected afterwards.

**Restoring a rollback artifact must not cost a Production write.** See §6 of this document for the
options returned to the owner.

## 6. Options returned, none executed

1. Reconstruct a **later** source whose read paths are already clean (post-`6f3e65d`), accepting
   that it is not the historically documented known-good reference.
2. Reconstruct `97e975f0` and certify it **only** on surfaces proven not to reach the pipeline
   read-path write, with the hazard accepted and recorded.
3. Reconstruct `97e975f0` against a **non-Production** database, certifying source-boots-clean only,
   and record that it is not certified against the Production substrate.
4. Accept the documented rollback-capability loss and record the source references as the durable
   recovery path, which is what `OPERATIONS.md` §Rollback already relies on.
