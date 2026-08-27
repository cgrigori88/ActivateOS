# Security Audit Scorecard — 2026-08-27

Skill: `security-audit` (15-step codebase sweep, OWASP Top 10 patterns)
Modes: **INSIDE** (full filesystem, commit `86cab9c` baseline) and **OUTSIDE**
(live target `https://pursuitos.io`), run concurrently.
Every finding below was challenged before being written (variables traced to
their source controllers); every remediation shown here is **already shipped**
in commit `86cab9c`.

---

## Findings

- **Severity**: HIGH
- **Target**: `src/app/briefs/[motionId]/actions.ts` — `motionContext()` (pre-fix lines 14–30), reached by `generateDraftAction` and the send/package action.
- **Flaw Description**: Broken object-level authorization (BOLA/IDOR) plus a missing role gate. The actions carried no `requireWrite` check and resolved the org id *from the motion row itself* (`select m.org_id … where m.id = $1`). Any authenticated user — including a read-only viewer or a guest-seat tenant — who obtained or guessed another tenant's motion UUID could invoke AI dra