# Workstream E3-A — Federation identity + participation (verification)

First gated sub-phase of Phase 3. Establishes the N-organization participation edge around the ONE canonical Pursuit, with **no new data exposure** (participant reads of child data land with the E3-B disclosure engine).

## Delivered
- `supabase/migrations/0080_pursuit_participation.sql` — `pursuit_role_types` (extensible role registry, seed data not a frozen CHECK, R3), `pursuit_participants` (N-org edge on `pursuits`, R1/R2), `can_see_pursuit()` (sponsor OR ACTIVE participant, SECURITY DEFINER, mirrors `can_see_partnership`), `joint_pursuits.pursuit_id` (Room→Pursuit projection binding, R1/§5), RLS + `app_rw` grants.
- `src/lib/pursuits/federation/flags.ts` — `FEDERATION_ENABLED` (default OFF) with dependency fail-safe on the Pursuit experience (R42).
- `src/lib/pursuits/federation/participation.ts` — lifecycle model (`addParticipant`/`accept`/`decline`/`leave`/`revoke` with a legal-transition guard), `getParticipants`, `activeParticipantOrgIds`. Participation is explicit, never derived from route or room (R2). No ledger emission here — event wiring lands in E3-E.
- `scripts/federation-verify.ts` — the blind harness.

## Blind harness — 19 / 19 (against full-schema `pursuit_demo`, as `app_rw` under RLS)
- Extensible role registry (≥9 roles; route-capability distinguishes participation from route).
- Participation lifecycle + illegal-transition rejection (accept a DECLINED row throws).
- **`can_see_pursuit` isolation (R2 / T1–T3):** sponsor sees; ACTIVE participant sees; non-participant does NOT; INVITED-only/declined does NOT; an org sees only its own edge; sponsor sees all edges.
- Cross-tenant write refusal (outsider cannot insert a participation row for another org).
- Multi-party topology (>2 orgs, varied roles) + graceful partial participation (solo pursuit resolves, empty participant set, no error).
- Room→Pursuit projection binding present.
- Federation flag fail-safe (OFF when its experience dependency is off; missing dep named).

## Gate
tsc **clean** · migrations **80 applied** on `pursuit_demo` · RLS isolation **proven in-harness** · `federationEnabled()` **default OFF** · **no production backfill** (demo DB only) · additive migration, absent from the reduced `wsc_verify` ORDER so `experience-verify`/`routes-verify` are unaffected.

## Deferred to later sub-phases (by design)
- Participant reads of Pursuit **child data** (facts/scores/routes) → **E3-B** (disclosure engine mediates; not widened here, so E3-A adds no new exposure).
- Participation **events** (`PARTICIPANT_INVITED/JOINED/…`) + recompute triggers → **E3-E** (event engine owns the `change_type` extension + emission).
- Federation **UI** (participants strip, invite/accept) → **E3-H**, native to the D.5 system (R31).

**E3-A complete. Proceeding to E3-B (consent + disclosure).**
