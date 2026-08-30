-- 0093: Release Gate R1-G8 — participant-visible Pursuit row.
--
-- 0087 gave ACTIVE participants SELECT on the Pursuit-CHILD tables (route snapshots,
-- candidates, outcomes). The Pursuit row itself was still sponsor-only, so a
-- participant could not load the pursuit page at all — it 404'd before disclosure ran.
-- This adds a SELECT-only participant policy on `pursuits` keyed on can_see_pursuit,
-- alongside the existing org-scoped for-all policy. Writes stay org-scoped; a
-- non-participant still sees nothing. What a participant then SEES on the page is the
-- disclosure-filtered federation projection (getPursuitFederation), never the sponsor's
-- decision surface — the page renders the participant branch, not getPursuitDetail.

set check_function_bodies = off;

drop policy if exists pursuits_participant_ro on pursuits;
create policy pursuits_participant_ro on pursuits
  for select to app_rw using (public.can_see_pursuit(id));
