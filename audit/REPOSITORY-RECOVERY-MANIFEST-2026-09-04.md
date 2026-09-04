# PursuitOS — repository recovery manifest

**Date:** 2026-09-04
**Origin:** `https://github.com/cgrigori88/ActivateOS`
**Purpose:** if every container and workstation disappears, this document plus `origin`
is sufficient to recover all meaningful PursuitOS source, release, audit and certification
work.

This branch (`archive/tds-certification-2026-09-04`) is **non-deployment**. It is cut from
the certified live commit and must never be merged into the production-designated branch or
connected to Vercel.

---

## 1. Current live state

| | |
|---|---|
| Production-designated branch | `claude/activateos-platform-review-xzkgmd` |
| Live / certified SHA | `97e975f0d9895c54bfc49cdcc24924d6ac58e796` |
| Verified how | `git ls-remote origin refs/heads/claude/activateos-platform-review-xzkgmd` |
| Host | demo.pursuitos.io (Vercel project `pursuitos-demo`) |
| Deploy trigger | every commit pushed to that branch creates a Production deployment |
| Certification | DEMO GO — synthetic, operator-controlled. **Not tenant-isolation certified.** |

---

## 2. Milestone table

Every SHA below was verified reachable from `origin` during this pass.

| Milestone | Full SHA | Remote branch | Backup tag |
|---|---|---|---|
| UI Wave 2 | `c34a16a93bfd0297ccc46a7843683bb5dced0e39` | `ui-wave-2` | `backup/2026-09-04/ui-wave-2` |
| UI Wave 3 | `821da7949781bd7bb895db845977307f45169080` | `ui-wave-3` | `backup/2026-09-04/ui-wave-3` |
| UI Wave 4 | `fcee418928a5d4e1e4b026836f967b4f4ed9e120` | `ui-wave-4` | `backup/2026-09-04/ui-wave-4` |
| UI Wave 5 | `40b576510b60b5824b2861e5ecff2875b4cdb537` | `ui-wave-5` | `backup/2026-09-04/ui-wave-5` |
| UI Wave 6 (NO-GO RC) | `c7580ff31a69f7ba57729b2d40a1c10e247e6f0f` | `ui-wave-6` | `backup/2026-09-04/ui-wave-6` |
| Wave 6B — blocker remediation | `7f4347e96e5f94ade8f8ead2ec2fcc902273c92b` | `ui-wave-6b` | `backup/2026-09-04/ui-wave-6b` |
| Wave 6C — canonical demo world | `5763af63fe10e9b166ad6b378acbf087931ddb76` | `ui-wave-6c` | `backup/2026-09-04/ui-wave-6c` |
| Wave 6D — deterministic manifest (final RC) | `97e975f0d9895c54bfc49cdcc24924d6ac58e796` | `ui-wave-6d` | `backup/2026-09-04/ui-wave-6d` |
| TD SYNNEX live demo (same commit) | `97e975f0d9895c54bfc49cdcc24924d6ac58e796` | `claude/activateos-platform-review-xzkgmd` | `backup/2026-09-04/tds-live-demo` |

**Earlier certified demo lineage** — Waves 1–3 of the original demo series are ancestors of
the UI wave lineage, not separate branches:

| Milestone | SHA | Reachable via |
|---|---|---|
| Wave 1 — visual system | `41e66dd` | ancestor of all UI waves |
| Wave 2 — demo journey | `f0bbcaf` | ancestor of all UI waves |
| Wave 3 — final demo polish | `66f72f61228588d70bee18771c5753e355e0a7c2` | prior tip of the production branch; ancestor of `97e975f` |

`ui-wave-6` existed only locally until this pass and is now pushed. Its commit was already
durable (an ancestor of `ui-wave-6b`); only the branch name was missing.

---

## 3. Canonical demo state

**Authoritative deterministic digest: `be0da833990ce436`**

Measured 2026-09-04 from a clean rebuild using Wave 6D tooling at `97e975f`.

Wave 6D changed the manifest's hero-row ordering (adding a trailing `o.name` tiebreak) but
**not** the digest value: `o.name` ascending happens to match the order the database was
already returning. The digest is therefore unchanged in value but now *determined* rather
than incidental. Before Wave 6D the same canonical world could hash to either
`be0da833990ce436` or `c2dc24b781993ea8` depending on how Postgres ordered two tied Acme
Robotics rows.

> **Usage caveat.** The digest is only meaningful against a **freshly rebuilt** world. The
> SEEDED and EITHER verifier suites mutate the demo database, so running the manifest after
> a battery yields a different digest (observed: `c3da4b3d5d260c09`). Always
> `seed-demo-world.ts` immediately before measuring.

**Reproduce:**
```bash
export DATABASE_URL='<demo db>'   # must carry environment_identity: demo / is_synthetic
export DEMO_TARGET_URL="$DATABASE_URL"   # hosted target → in-place guarded reseed
export DEMO_URL="$DATABASE_URL"
npx tsx scripts/environment-identity.ts      # must report demo / is_synthetic=true
npx tsx scripts/seed-demo-world.ts           # rebuild + self-verify
npx tsx scripts/demo-manifest.ts --digest    # expect be0da833990ce436
```

Committed canonical snapshot: `audit/canonical-demo-world.json`.

---

## 4. Canonical commercial anchors

Re-verified 2026-09-04 on a clean rebuild. All current.

| Figure | Value |
|---|---|
| Open pipeline | **$8,040,000** |
| Open opportunities | **11** |
| Weighted open pipeline | **$3,361,500** |
| Won | **$1,780,000** across 4 |
| Motion value (all motions) | **$1,850,000** across 7 |
| Goal-linked motion value | **$1,250,000** across 5 |
| Goal opportunity-level contribution | **$4,920,000** across 6 |
| Goal target / progress | **$5,000,000** / **25%** |

---

## 5. Known blocking production issue — Task #67

**The runtime connects to Postgres as a Supabase superuser, and superusers bypass RLS
unconditionally** — including where `RLS` and `FORCE RLS` are both enabled, as they are on
all public tables here. Tenant isolation therefore rests entirely on application-level
`where org_id` predicates, and at least the pursuit detail read has none.

Reproduced: a Vertex-only member renders a Meridian-owned pursuit by direct UUID. The same
query as `app_rw` with `app.org_id` set returns 0 rows — the policies are correct, they are
simply not in force.

**No real design-partner or customer data may enter this architecture** until the runtime is
cut over to the least-privileged `app_rw` role and tenant isolation is completely
re-certified. Synthetic, operator-driven demonstrations only.

Full detail: `audit/TD-SYNNEX-FRIDAY-CERTIFICATION-NOTE.md` on this branch.

---

## 6. Recovery instructions

A fresh engineer or container needs nothing from the original environment.

**Latest source and final release**
```bash
git clone https://github.com/cgrigori88/ActivateOS.git
cd ActivateOS
git fetch --all --tags
git checkout 97e975f0d9895c54bfc49cdcc24924d6ac58e796      # final release candidate
npm ci
```
On macOS the clone warns about a case collision between `audit/SECURITY-AUDIT-2026-08-27.md`
and `audit/security-audit-2026-08-27.md`. It is cosmetic — neither file is referenced by
code. Use `git checkout -f <sha>` if the warning blocks a checkout.

**Any milestone**
```bash
git checkout backup/2026-09-04/ui-wave-6c    # or any tag from §2
```

**Audit and certification records**
```bash
git checkout archive/tds-certification-2026-09-04
ls audit/
```
Key documents: `UI-REDESIGN-WAVE-6-RELEASE-CANDIDATE.md`,
`UI-REDESIGN-WAVE-6B-BLOCKER-REMEDIATION.md`,
`UI-REDESIGN-WAVE-6C-CANONICAL-DEMO.md`, `TD-SYNNEX-FRIDAY-CERTIFICATION-NOTE.md`,
`canonical-demo-world.json`, and this manifest.

**Canonical demo tooling** (present from `ui-wave-6c` onward)

| Script | Purpose |
|---|---|
| `scripts/seed-demo-world.ts` | build the canonical world + self-verify (10 layers) |
| `scripts/demo-manifest.ts` | emit the deterministic manifest / digest |
| `scripts/environment-identity.ts` | read or set the synthetic-database marker |
| `scripts/verify-classes.ts` | FRESH / SEEDED / EITHER / DEPLOYMENT_ONLY contract |
| `scripts/verify-run.ts` | run a class or a single suite |
| `scripts/verify-guard.ts` | fail-fast connection guard |
| `scripts/backup-dump.ts` / `backup-restore.ts` | logical database backup |

**Re-run the full local baseline**
```bash
npx tsx scripts/verify-run.ts --class FRESH     # expect 238/238
npx tsx scripts/verify-run.ts --class EITHER    # expect 215/215
npx tsx scripts/verify-run.ts --class SEEDED    # expect 658/658
npm test                                        # expect 149/149
npx tsc --noEmit && npx next build
npx tsx scripts/visual-system-check.ts          # expect clean, 363 files
```
SEEDED requires a canonical world built first; FRESH and EITHER provision their own
disposable databases.

**What is deliberately NOT in the repository:** `.env`, `.env.local`, any credential, and
any database dump. `.env.example` documents every required variable with placeholders.
Deployment configuration lives in Vercel (project `pursuitos-demo`) and Supabase (project
`qifatlqxfuhwrwvpbwsc`); neither is recoverable from Git and both must be re-established
from their own consoles.
