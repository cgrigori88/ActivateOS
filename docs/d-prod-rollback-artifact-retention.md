# D-PROD-ROLLBACK-ARTIFACT-RETENTION — Production rollback artifact retention and certification

**Status: OPEN / NOT BLOCKING P45-4.** Operational follow-up, not a product defect. Opened
2026-09-20 out of `D-P454-PRODUCTION-ARTIFACT-DELETION`. **Nothing here is implemented, and no work
on it is authorized yet.**

## Why it exists

Two facts met on 2026-09-20 and together left Production without an instant rollback:

1. A deployment-cleanup sweep deleted **12 historical Production deployment artifacts**, because it
   filtered a project-wide listing by URL without classifying Environment, over a listing that had
   been truncated twice. `--safe` saved the current Production deployment only because it carried an
   alias.
2. The obvious reconstruction candidate could not be certified. `97e975f0` writes
   `pipeline_snapshots` from a page render, and **the Production database is not observable from the
   operator context** — so a rebuild could neither be prevented from mutating canonical Production
   history nor shown afterwards not to have. Selecting a later, clean source would remove the known
   write defect but **would not cure the observability gap**.

The second fact is the more important one, and it is why "just rebuild a newer commit" is not the
answer. **A rollback artifact you cannot certify is not a rollback artifact.**

## Purpose

> **Establish a durable process so Production normally retains at least one independently-certified
> prior deployment artifact, and so destructive deployment cleanup cannot remove it.**

## Scope, for a later separately-authorized slice

- **Retention policy** — how many prior Production artifacts are kept, for how long, and on what
  certification basis.
- **Pin / protection** — an explicit mechanism (or its documented absence) that makes a retained
  rollback artifact undeletable by routine cleanup, rather than accidentally surviving because it
  happens to hold an alias.
- **Environment-scoped deletion gates** — the invariant in
  `D-P454-PRODUCTION-ARTIFACT-DELETION` §4, made mechanical rather than remembered.
- **Read-only Production observability** — enough to certify a rollback candidate: database identity,
  schema version, and before/after movement evidence sufficient to prove zero business mutation.
  Without this, no Production rollback candidate can be honestly certified by anyone.
- **Source rollback vs artifact rollback** — carried into `OPERATIONS.md` as a permanent
  distinction, not a footnote.

## Current truthful state

| | |
|---|---|
| Historical known-good **source** reference | `97e975f0` (tag `backup/2026-09-04/tds-live-demo`) — **source only**, and unsuitable for reconstruction |
| Available built Production **rollback artifact** | **NONE currently retained or certified** |
| Current Production deployment | `dpl_22uuzDWFfMw1X8kZ8WYSnJDEzZ6K` — **current, not a fallback** |

Of the 14 retained deployments, exactly one carries `target: production`, and it is the one serving.
A Preview or non-Production deployment must never be recorded as a Production rollback artifact.
