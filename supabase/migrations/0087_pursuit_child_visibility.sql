-- 0087: Workstream E3-H — participant-visible Pursuit-child reads.
--
-- Federation means an ACTIVE participant can SEE the shared decision surface of the one
-- canonical Pursuit — the route it's on, and the outcomes that have landed — WITHOUT
-- gaining any write authority and WITHOUT any non-participant ever seeing it. We add a
-- narrow, SELECT-ONLY policy keyed on can_see_pursuit(pursuit_id) alongside the existing
-- org-scoped for-all policy. Postgres ORs permissive policies, so:
--   * org members keep full read/write via the existing policy;
--   * ACTIVE participants (and the sponsor) gain READ via the new policy;
--   * everyone else is still refused (can_see_pursuit is false for them).
-- Writes stay org-scoped — the new policy is FOR SELECT only, granting no with-check.
-- Inert in production today (no participant rows exist while federation is OFF); the
-- disclosure layer still governs which VALUES a permitted reader actually receives.

set check_function_bodies = off;

-- Route recommendation surface.
drop policy if exists pursuit_route_snapshots_participant_ro on pursuit_route_snapshots;
create policy pursuit_route_snapshots_participant_ro on pursuit_route_snapshots
  for select to app_rw using (public.can_see_pursuit(pursuit_id));

drop policy if exists route_candidates_participant_ro on route_candidates;
create policy route_candidates_participant_ro on route_candidates
  for select to app_rw using (
    exists (select 1 from pursuit_route_snapshots s
             where s.id = route_candidates.route_snapshot_id
               and public.can_see_pursuit(s.pursuit_id)));

-- Outcome trail (labels are participant-shared; value magnitudes still downgrade in the
-- disclosure layer for non-sponsors).
drop policy if exists pursuit_outcomes_participant_ro on pursuit_outcomes;
create policy pursuit_outcomes_participant_ro on pursuit_outcomes
  for select to app_rw using (public.can_see_pursuit(pursuit_id));
