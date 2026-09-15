-- 0104 — H1B-0: consent-scoped cross-party access for the least-privilege runtime role.
--
-- WHY. The H1B cutover moves the web runtime from the table owner (BYPASSRLS) to app_rw, which RLS
-- binds: under app_rw a row carrying the OTHER party's org_id is invisible, and a write carrying it is
-- refused. That is correct for tenant isolation — and it breaks every partnership flow, because a
-- partnership is precisely where two companies legitimately act on each other's records (proven as the
-- real app_rw login, H1B readiness review, D-048).
--
-- THE RULE (D-049). Cross-company access is CONSENT-scoped, OBJECT-scoped, PURPOSE-scoped and AUDITABLE.
-- A partnership alone is never blanket permission. Each function below:
--   * derives the caller's org from trusted server context — app_current_org() (the per-transaction
--     `app.org_id` withTenant sets from the authenticated session), never from an argument;
--   * validates BOTH parties and the EXACT consent object (grant / share / probe / intro / joint pursuit
--     / invite), refusing revoked, declined, expired or inactive consent;
--   * exposes or mutates only that object — there is NO generic cross-tenant read or write here;
--   * is SECURITY DEFINER with a pinned search_path, EXECUTE revoked from PUBLIC and the Supabase API
--     roles, and granted to app_rw only.
-- With no tenant context, only a session that already bypasses RLS (the owner / operator paths:
-- migrations, seeds, the worker, /join's owner pool) may call them — such a caller could act directly
-- anyway, so this adds no power; it keeps those paths working unchanged.
--
-- Additive and inert under the owner connection: no table, column, existing policy or grant is
-- altered. ROLLBACK (H1B): the application keeps working on the owner connection with or without this
-- migration; to remove it, drop the functions and policies it creates (listed at the end).

-- ── gates ──────────────────────────────────────────────────────────────────────────────────────────

-- The caller's org if it is a party to partnership `pid`; NULL for a trusted RLS-bypassing session with
-- no tenant context; otherwise refuses (42501).
create or replace function public.h1b_consent_party(pid uuid) returns uuid
  language plpgsql stable security definer set search_path to 'public'
as $$
declare
  caller uuid := public.app_current_org();
  ini uuid; cp uuid;
begin
  select initiator_org_id, counterpart_org_id into ini, cp from partnerships where id = pid;
  if not found then
    raise exception 'Partnership not found.' using errcode = '42501';
  end if;
  if caller is null then
    -- A Supabase-authenticated member of either party (the RLS helper's other half).
    select m.org_id into caller from org_members m
     where m.user_id = auth.uid() and m.org_id in (ini, cp) limit 1;
  end if;
  if caller is not null then
    if caller = ini or caller = cp then return caller; end if;
    raise exception 'Not a partnership you are part of.' using errcode = '42501';
  end if;
  if exists (select 1 from pg_roles where rolname = session_user and (rolbypassrls or rolsuper)) then
    return null;
  end if;
  raise exception 'No tenant context.' using errcode = '42501';
end $$;

-- Non-raising form, for reads that must simply return nothing to a non-party.
create or replace function public.h1b_consent_allowed(pid uuid) returns boolean
  language plpgsql stable security definer set search_path to 'public'
as $$
begin
  perform public.h1b_consent_party(pid);
  return true;
exception when insufficient_privilege then
  return false;
end $$;

-- ── audit (D-049: best-effort, but never refused by the counterpart's tenant policy) ───────────────

-- One ledger row for a party of THIS partnership, written by a party of it. The handshake doctrine is
-- "every step lands in each org's own audit_log"; this is the only way a row reaches the counterpart's
-- ledger under app_rw.
create or replace function public.audit_partnership_event(
  p_partnership uuid, p_org uuid, p_actor text, p_event text, p_detail jsonb
) returns void
  language plpgsql volatile security definer set search_path to 'public'
as $$
declare ini uuid; cp uuid;
begin
  perform public.h1b_consent_party(p_partnership);
  select initiator_org_id, counterpart_org_id into ini, cp from partnerships where id = p_partnership;
  if p_org is distinct from ini and p_org is distinct from cp then
    raise exception 'Audit target is not a party to this partnership.' using errcode = '42501';
  end if;
  if p_event is null or p_event !~ '^[a-z_]+\.[a-z_]+$' then
    raise exception 'Invalid audit event.' using errcode = '22023';
  end if;
  insert into audit_log (org_id, actor, event, detail, partnership_id)
  values (p_org, left(coalesce(nullif(p_actor, ''), 'operator'), 320), p_event, coalesce(p_detail, '{}'::jsonb), p_partnership);
end $$;

-- ── invite redemption (pre-membership: the redeemer is not yet a party) ────────────────────────────

-- Acts on the ONE invited partnership whose ~93-bit code was presented, as the caller's org. It cannot
-- list or discover invites: a wrong code finds nothing and says only that.
create or replace function public.redeem_partnership_invite(p_code text)
returns table (partnership_id uuid, initiator_org_id uuid, initiator_name text, redeemer_name text)
  language plpgsql volatile security definer set search_path to 'public'
as $$
#variable_conflict use_column
declare
  caller uuid := public.app_current_org();
  v_id uuid; v_ini uuid; v_name text; v_lens uuid; v_me text;
begin
  if caller is null then
    raise exception 'No tenant context.' using errcode = '42501';
  end if;
  select p.id, p.initiator_org_id, o.name into v_id, v_ini, v_name
    from partnerships p join organizations o on o.id = p.initiator_org_id
   where p.invite_code = upper(btrim(p_code)) and p.status = 'invited'
   for update of p;
  if not found then
    raise exception 'Invite code not found, already redeemed, or revoked.' using errcode = 'P0002';
  end if;
  if v_ini = caller then
    raise exception 'This invite was issued by your own organization.' using errcode = '22023';
  end if;
  insert into partners (org_id, name, partner_type) values (caller, v_name, 'alliance') returning id into v_lens;
  update partnerships
     set counterpart_org_id = caller, counterpart_partner_id = v_lens, status = 'active', activated_at = now()
   where id = v_id;
  select name into v_me from organizations where id = caller;
  return query select v_id, v_ini, v_name, v_me;
end $$;

-- ── list grants: the sharer's list and the receiver's copy ──────────────────────────────────────────

-- The shared list's name / category and member counts (plus the copy's count, for staleness), to either
-- party of the grant's partnership. No member row, attribute or company id crosses here.
create or replace function public.list_grant_source_state(p_grant uuid)
returns table (list_name text, category text, source_members integer, source_last_added timestamptz, copy_members integer)
  language plpgsql stable security definer set search_path to 'public'
as $$
#variable_conflict use_column
declare g list_grants%rowtype;
begin
  select * into g from list_grants where id = p_grant;
  if not found or not public.h1b_consent_allowed(g.partnership_id) then return; end if;
  return query
    select ap.name, ap.category,
           (select count(*)::int from population_members m where m.population_id = g.population_id),
           (select max(m.created_at) from population_members m where m.population_id = g.population_id),
           (select count(*)::int from population_members m where m.population_id = g.materialized_population_id)
      from account_populations ap
     where ap.id = g.population_id and ap.org_id = g.from_org_id;
end $$;

-- (Re)materialise an ACCEPTED grant on an ACTIVE partnership into ITS OWN materialised copy, which must
-- belong to the receiving party; member attributes cut to the granted fields (null = all). Either party
-- may sync — the grant is the standing consent, and a sync changes nothing about WHAT is shared.
create or replace function public.sync_list_grant_members(p_grant uuid) returns integer
  language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  g list_grants%rowtype; ini uuid; cp uuid; pstatus text; receiver uuid; n integer;
begin
  select * into g from list_grants where id = p_grant for update;
  if not found then
    raise exception 'No such list grant.' using errcode = '42501';
  end if;
  perform public.h1b_consent_party(g.partnership_id);
  select initiator_org_id, counterpart_org_id, status into ini, cp, pstatus from partnerships where id = g.partnership_id;
  if g.status <> 'accepted' or pstatus <> 'active' then
    raise exception 'No live accepted share with that id on an active partnership.' using errcode = '42501';
  end if;
  if g.materialized_population_id is null then
    raise exception 'Their copy no longer exists — offer the list again.' using errcode = '22023';
  end if;
  receiver := case when ini = g.from_org_id then cp else ini end;
  if not exists (select 1 from account_populations where id = g.population_id and org_id = g.from_org_id)
     or not exists (select 1 from account_populations where id = g.materialized_population_id and org_id = receiver) then
    raise exception 'The shared list or its copy does not belong to the grant''s parties.' using errcode = '42501';
  end if;
  delete from population_members where population_id = g.materialized_population_id;
  if g.selected_fields is null then
    insert into population_members (population_id, company_id, attributes)
    select g.materialized_population_id, m.company_id, m.attributes
      from population_members m where m.population_id = g.population_id;
  else
    insert into population_members (population_id, company_id, attributes)
    select g.materialized_population_id, m.company_id,
           coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(m.attributes) e
                      where e.key = any(g.selected_fields)), '{}'::jsonb)
      from population_members m where m.population_id = g.population_id;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- Flip to 'rejected' the materialised copies of this partnership's REVOKED grants (one grant, or all).
-- The copy lives in the receiver's book; revocation ends access NOW on both sides.
create or replace function public.revoke_list_grant_copies(p_partnership uuid, p_grant uuid default null) returns integer
  language plpgsql volatile security definer set search_path to 'public'
as $$
declare n integer;
begin
  perform public.h1b_consent_party(p_partnership);
  update account_populations ap set status = 'rejected'
   where ap.id in (select g.materialized_population_id from list_grants g
                    where g.partnership_id = p_partnership and g.status = 'revoked'
                      and g.materialized_population_id is not null
                      and (p_grant is null or g.id = p_grant));
  get diagnostics n = row_count;
  return n;
end $$;

-- ── overlap ladder: the approver computes the disclosure, the raw books never leave the database ───

-- An org's "book": distinct companies (with category) in its approved, non-lens lists.
create or replace function public.h1b_org_book(o uuid) returns table (company_id uuid, category text)
  language sql stable security definer set search_path to 'public'
as $$
  select distinct pm.company_id, ap.category
    from population_members pm join account_populations ap on ap.id = pm.population_id
   where ap.org_id = o and ap.status = 'approved' and ap.partner_id is null
$$;

-- Only the rung-appropriate aggregate: counts → {overlap}; bands → + categories per org and top-8
-- industries; named → + up to 500 named shared accounts. Same shape the application always stored.
create or replace function public.h1b_overlap_results(a uuid, b uuid, lvl text) returns jsonb
  language plpgsql stable security definer set search_path to 'public'
as $$
declare
  n integer; cats jsonb; inds jsonb; accts jsonb; total integer;
begin
  select count(*) into n from (select distinct company_id from public.h1b_org_book(a)) x
    join (select distinct company_id from public.h1b_org_book(b)) y using (company_id);
  if lvl = 'counts' then return jsonb_build_object('overlap', n); end if;
  if lvl = 'bands' then
    with shared as (select company_id from public.h1b_org_book(a) intersect select company_id from public.h1b_org_book(b))
    select jsonb_build_object(
             a::text, coalesce((select jsonb_object_agg(q.category, q.n) from (
               select ab.category, count(distinct ab.company_id)::int n from public.h1b_org_book(a) ab
                 join shared s on s.company_id = ab.company_id group by ab.category) q), '{}'::jsonb),
             b::text, coalesce((select jsonb_object_agg(q.category, q.n) from (
               select bb.category, count(distinct bb.company_id)::int n from public.h1b_org_book(b) bb
                 join shared s on s.company_id = bb.company_id group by bb.category) q), '{}'::jsonb))
      into cats;
    with shared as (select company_id from public.h1b_org_book(a) intersect select company_id from public.h1b_org_book(b))
    select coalesce(jsonb_agg(jsonb_build_object('industry', coalesce(q.industry, 'unknown'), 'count', q.n) order by q.n desc), '[]'::jsonb)
      into inds
      from (select c.industry, count(*)::int n from shared s join companies c on c.id = s.company_id
             group by c.industry order by count(*) desc limit 8) q;
    return jsonb_build_object('overlap', n, 'categories', cats, 'industries', inds);
  end if;
  if lvl = 'named' then
    with shared as (select company_id from public.h1b_org_book(a) intersect select company_id from public.h1b_org_book(b)),
         picked as (select s.company_id, c.legal_name, c.industry from shared s join companies c on c.id = s.company_id
                     order by c.legal_name limit 501)
    select count(*)::int,
           coalesce(jsonb_agg(jsonb_build_object(
             'company_id', p.company_id, 'name', p.legal_name, 'industry', p.industry,
             'cats', jsonb_build_object(
               a::text, coalesce((select to_jsonb(array_agg(distinct ab.category order by ab.category)) from public.h1b_org_book(a) ab where ab.company_id = p.company_id), '[]'::jsonb),
               b::text, coalesce((select to_jsonb(array_agg(distinct bb.category order by bb.category)) from public.h1b_org_book(b) bb where bb.company_id = p.company_id), '[]'::jsonb)))
             order by p.legal_name) filter (where p.rn <= 500), '[]'::jsonb)
      into total, accts
      from (select picked.*, row_number() over (order by picked.legal_name) rn from picked) p;
    return jsonb_build_object('overlap', n, 'truncated', total > 500, 'accounts', accts);
  end if;
  raise exception 'Unknown disclosure level.' using errcode = '22023';
end $$;

-- The counterpart of the requester decides. Approve computes and stores the rung's aggregate; decline
-- records the refusal. The requester consented by requesting; only the other party can approve, and
-- only on an ACTIVE partnership.
create or replace function public.decide_overlap_probe(p_probe uuid, p_approve boolean) returns text
  language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  caller uuid := public.app_current_org();
  pr overlap_probes%rowtype; ini uuid; cp uuid; pstatus text;
begin
  if caller is null then
    raise exception 'No tenant context.' using errcode = '42501';
  end if;
  select * into pr from overlap_probes where id = p_probe for update;
  if not found then
    raise exception 'Probe not found.' using errcode = 'P0002';
  end if;
  select initiator_org_id, counterpart_org_id, status into ini, cp, pstatus from partnerships where id = pr.partnership_id;
  if caller is distinct from ini and caller is distinct from cp then
    raise exception 'Your organization is not part of this partnership.' using errcode = '42501';
  end if;
  if pr.status <> 'requested' then
    raise exception 'This probe is already %.', pr.status using errcode = '22023';
  end if;
  if pr.requested_by_org = caller or (pr.requested_by_org is distinct from ini and pr.requested_by_org is distinct from cp) then
    raise exception 'The requesting side can''t approve its own probe.' using errcode = '42501';
  end if;
  if not p_approve then
    update overlap_probes set status = 'declined', decided_at = now() where id = p_probe;
    return 'declined';
  end if;
  if pstatus <> 'active' or cp is null then
    raise exception 'Overlap probes need an active partnership.' using errcode = '42501';
  end if;
  update overlap_probes
     set status = 'approved', decided_at = now(), computed_at = now(), results = public.h1b_overlap_results(ini, cp, pr.level)
   where id = p_probe;
  return 'approved';
end $$;

-- ── evidence shares: only the claim's displayed columns cross, only under a live share ─────────────

create or replace function public.partnership_evidence_shares(p_partnership uuid)
returns table (id uuid, status text, offered_by_org uuid, claim text, source_type text, observed_at timestamptz,
               legal_name text, company_id uuid, offered_at timestamptz)
  language plpgsql stable security definer set search_path to 'public'
as $$
#variable_conflict use_column
declare caller uuid := public.app_current_org(); pstatus text;
begin
  if caller is null or not public.h1b_consent_allowed(p_partnership) then return; end if;
  select p.status into pstatus from partnerships p where p.id = p_partnership;
  return query
    select s.id, s.status, s.offered_by_org, e.claim, e.source_type, e.observed_at, c.legal_name, e.company_id, s.offered_at
      from evidence_shares s
      join evidence e on e.id = s.evidence_id and (e.org_id = s.offered_by_org or e.org_id is null)
      join companies c on c.id = e.company_id
     where s.partnership_id = p_partnership and s.status <> 'revoked'
       and (s.offered_by_org = caller or pstatus = 'active')
     order by s.offered_at desc limit 40;
end $$;

-- Accepted claims shared IN to the caller about one account, on its ACTIVE partnerships.
create or replace function public.shared_in_evidence(p_company uuid)
returns table (claim text, source_type text, observed_at timestamptz, org_name text)
  language plpgsql stable security definer set search_path to 'public'
as $$
#variable_conflict use_column
declare caller uuid := public.app_current_org();
begin
  if caller is null then return; end if;
  return query
    select e.claim, e.source_type, e.observed_at, o.name
      from evidence_shares s
      join partnerships p on p.id = s.partnership_id and p.status = 'active'
       and (p.initiator_org_id = caller or p.counterpart_org_id = caller)
      join evidence e on e.id = s.evidence_id and e.company_id = p_company
       and (e.org_id = s.offered_by_org or e.org_id is null)
      join organizations o on o.id = s.offered_by_org
     where s.status = 'accepted' and s.offered_by_org <> caller
     order by e.observed_at desc limit 20;
end $$;

-- ── skill shares: a shared skill is read live, never copied — only under a live share ──────────────

-- Owner of a skill, for the consent guard (the non-owner deciding a share cannot see the skill row).
create or replace function public.h1b_skill_owner(p_skill uuid) returns uuid
  language sql stable security definer set search_path to 'public'
as $$ select org_id from skills where id = p_skill $$;

create or replace function public.partnership_skill_shares(p_partnership uuid)
returns table (id uuid, skill_id uuid, name text, kind text, status text, owner_org uuid, from_org_name text, body text, offered_at timestamptz)
  language plpgsql stable security definer set search_path to 'public'
as $$
#variable_conflict use_column
declare caller uuid := public.app_current_org(); ini uuid; cp uuid;
begin
  if caller is null or not public.h1b_consent_allowed(p_partnership) then return; end if;
  select p.initiator_org_id, p.counterpart_org_id into ini, cp from partnerships p where p.id = p_partnership;
  return query
    select sh.id, sh.skill_id, s.name, s.kind, sh.status, s.org_id, o.name, s.body, sh.offered_at
      from skill_shares sh
      join skills s on s.id = sh.skill_id and s.status = 'active' and s.org_id in (ini, cp)
      join organizations o on o.id = s.org_id
     where sh.partnership_id = p_partnership
     order by sh.offered_at desc;
end $$;

-- Accepted skills other tenants shared with the caller on its ACTIVE partnerships, with the caller's own
-- lens on the sharer (for grounding only when THAT partner is on the deal).
create or replace function public.shared_in_skills()
returns table (id uuid, name text, kind text, body text, from_org_name text, partner_id uuid, partner_name text, offered_at timestamptz)
  language plpgsql stable security definer set search_path to 'public'
as $$
#variable_conflict use_column
declare caller uuid := public.app_current_org();
begin
  if caller is null then return; end if;
  return query
    select s.id, s.name, s.kind, s.body, o.name,
           case when p.initiator_org_id = caller then p.initiator_partner_id else p.counterpart_partner_id end,
           pa.name, sh.offered_at
      from skill_shares sh
      join skills s on s.id = sh.skill_id and s.status = 'active' and s.org_id <> caller
      join organizations o on o.id = s.org_id
      join partnerships p on p.id = sh.partnership_id and p.status = 'active'
       and (p.initiator_org_id = caller or p.counterpart_org_id = caller)
       and s.org_id in (p.initiator_org_id, p.counterpart_org_id)
      left join partners pa on pa.org_id = caller
       and pa.id = case when p.initiator_org_id = caller then p.initiator_partner_id else p.counterpart_partner_id end
     where sh.status = 'accepted'
     order by sh.offered_at desc;
end $$;

-- The subject of one share (its partnership, status, the skill's owner and name) for a party to decide
-- or revoke it.
create or replace function public.skill_share_subject(p_share uuid)
returns table (partnership_id uuid, status text, owner_org uuid, name text)
  language plpgsql stable security definer set search_path to 'public'
as $$
#variable_conflict use_column
declare pid uuid;
begin
  select sh.partnership_id into pid from skill_shares sh where sh.id = p_share;
  if pid is null or not public.h1b_consent_allowed(pid) then return; end if;
  return query
    select sh.partnership_id, sh.status, s.org_id, s.name
      from skill_shares sh join skills s on s.id = sh.skill_id where sh.id = p_share;
end $$;

-- ── joint pursuits: the broker's line in the shared room ────────────────────────────────────────────

-- The broker proposal is an org-less line both sides read identically; a party writes it only into an
-- ACTIVE room of its own partnership.
create or replace function public.record_broker_event(p_pursuit uuid, p_body text, p_detail jsonb) returns void
  language plpgsql volatile security definer set search_path to 'public'
as $$
declare pid uuid; st text;
begin
  select partnership_id, status into pid, st from joint_pursuits where id = p_pursuit;
  if pid is null then
    raise exception 'Pursuit not found.' using errcode = 'P0002';
  end if;
  perform public.h1b_consent_party(pid);
  if st <> 'active' then
    raise exception 'The broker only writes into an active room.' using errcode = '22023';
  end if;
  insert into joint_pursuit_events (pursuit_id, org_id, actor, kind, body, detail)
  values (p_pursuit, null, 'broker', 'proposal', p_body, coalesce(p_detail, '{}'::jsonb));
end $$;

-- ── settlement: both books, ONLY on jointly pursued accounts, ONLY for a party ─────────────────────

create or replace function public.partnership_settlement_rows(p_partnership uuid)
returns table (org_id uuid, company_id uuid, legal_name text, stage text, amount_usd numeric,
               created_at timestamptz, updated_at timestamptz, closed_at timestamptz, registered boolean)
  language plpgsql stable security definer set search_path to 'public'
as $$
#variable_conflict use_column
declare ini uuid; cp uuid;
begin
  if not public.h1b_consent_allowed(p_partnership) then return; end if;
  select p.initiator_org_id, p.counterpart_org_id into ini, cp from partnerships p where p.id = p_partnership;
  return query
    select o.org_id, o.company_id, c.legal_name, o.stage, o.amount_usd, o.created_at, o.updated_at, o.closed_at,
           exists (select 1 from deal_registrations dr where dr.opportunity_id = o.id)
      from joint_pursuits jp
      join opportunities o on o.company_id = jp.company_id and o.org_id in (ini, cp)
      join companies c on c.id = o.company_id
     where jp.partnership_id = p_partnership and jp.status in ('active', 'closed')
     order by o.updated_at desc;
end $$;

-- ── the consent guard: under app_rw, consent rows are written only by their rightful actor ─────────
--
-- The functions above trust consent rows, so those rows must not be forgeable. Enforced for the
-- least-privilege runtime role only (current_user = 'app_rw'): owner / operator paths and the validated
-- definer functions (which run as the owner) are unaffected. It ties every actor column to the caller's
-- org, allows only the product's own transitions, and routes every disclosing approval through a
-- function.
create or replace function public.h1b_consent_guard() returns trigger
  language plpgsql set search_path to 'public'
as $$
declare
  caller uuid;
  ini uuid; cp uuid;
  owner uuid;
  deny text := null;
begin
  if current_user <> 'app_rw' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  caller := public.app_current_org();
  if caller is null then
    raise exception 'No tenant context.' using errcode = '42501';
  end if;

  if tg_table_name = 'partnerships' then
    if tg_op = 'INSERT' then
      if new.initiator_org_id is distinct from caller or new.counterpart_org_id is not null
         or new.counterpart_partner_id is not null or new.status <> 'invited' then
        deny := 'A partnership starts as an invitation from your own organization.';
      end if;
    elsif tg_op = 'UPDATE' then
      if (caller is distinct from old.initiator_org_id and caller is distinct from old.counterpart_org_id)
         or new.status <> 'revoked'
         or new.initiator_org_id is distinct from old.initiator_org_id or new.counterpart_org_id is distinct from old.counterpart_org_id
         or new.initiator_partner_id is distinct from old.initiator_partner_id or new.counterpart_partner_id is distinct from old.counterpart_partner_id
         or new.invite_code is distinct from old.invite_code or new.activated_at is distinct from old.activated_at then
        deny := 'A partnership can only be revoked here; activation is by invite redemption.';
      end if;
    else
      deny := 'Partnerships are revoked, not deleted.';
    end if;

  elsif tg_table_name = 'list_grants' then
    if tg_op = 'INSERT' then
      if new.from_org_id is distinct from caller or new.status <> 'offered' or new.materialized_population_id is not null
         or not exists (select 1 from account_populations ap where ap.id = new.population_id and ap.org_id = caller) then
        deny := 'You can only offer your own list.';
      end if;
    elsif tg_op = 'DELETE' then
      deny := 'List grants are revoked, not deleted.';
    else
      select initiator_org_id, counterpart_org_id into ini, cp from partnerships where id = old.partnership_id;
      if (caller is distinct from ini and caller is distinct from cp)
         or new.partnership_id is distinct from old.partnership_id or new.from_org_id is distinct from old.from_org_id
         or new.population_id is distinct from old.population_id or new.selected_fields is distinct from old.selected_fields then
        deny := 'That list grant is not yours to change.';
      elsif new.status = old.status then
        if new.materialized_population_id is distinct from old.materialized_population_id then
          deny := 'A list grant''s copy is set only when it is accepted.';
        end if;
      elsif old.status = 'offered' and new.status = 'accepted' then
        if caller = old.from_org_id or new.materialized_population_id is null
           or not exists (select 1 from account_populations ap where ap.id = new.materialized_population_id and ap.org_id = caller) then
          deny := 'Only the receiving side accepts a list grant, into its own copy.';
        end if;
      elsif old.status = 'offered' and new.status = 'declined' then
        if caller = old.from_org_id then deny := 'Only the receiving side declines a list grant.'; end if;
      elsif old.status in ('offered', 'accepted') and new.status = 'revoked' then
        if new.materialized_population_id is distinct from old.materialized_population_id then
          deny := 'Revoking does not re-point the copy.';
        end if;
      else
        deny := 'That list-grant transition is not allowed.';
      end if;
    end if;

  elsif tg_table_name = 'overlap_probes' then
    if tg_op = 'INSERT' then
      if new.requested_by_org is distinct from caller or new.status <> 'requested' or new.results is not null
         or new.computed_at is not null or new.decided_at is not null then
        deny := 'An overlap probe is requested by your own organization, and computed only on approval.';
      end if;
    else
      deny := 'Overlap probes are decided through decide_overlap_probe().';
    end if;

  elsif tg_table_name = 'evidence_shares' then
    if tg_op = 'INSERT' then
      if new.offered_by_org is distinct from caller or new.status <> 'offered'
         or not exists (select 1 from evidence e where e.id = new.evidence_id and e.org_id = caller) then
        deny := 'You can only offer your own evidence.';
      end if;
    elsif tg_op = 'DELETE' then
      deny := 'Evidence shares are revoked, not deleted.';
    else
      select initiator_org_id, counterpart_org_id into ini, cp from partnerships where id = old.partnership_id;
      if (caller is distinct from ini and caller is distinct from cp)
         or new.evidence_id is distinct from old.evidence_id or new.partnership_id is distinct from old.partnership_id then
        deny := 'That evidence share is not yours to change.';
      elsif new.status = 'offered' then
        if new.offered_by_org is distinct from caller
           or not exists (select 1 from evidence e where e.id = new.evidence_id and e.org_id = caller) then
          deny := 'Only the evidence''s owner re-offers it.';
        end if;
      elsif old.status = 'offered' and new.status in ('accepted', 'declined') then
        if caller = old.offered_by_org or new.offered_by_org is distinct from old.offered_by_org then
          deny := 'Only the receiving side decides an evidence share.';
        end if;
      elsif old.status in ('offered', 'accepted') and new.status = 'revoked' then
        if caller is distinct from old.offered_by_org or new.offered_by_org is distinct from old.offered_by_org then
          deny := 'Only the offering side revokes an evidence share.';
        end if;
      else
        deny := 'That evidence-share transition is not allowed.';
      end if;
    end if;

  elsif tg_table_name = 'skill_shares' then
    owner := public.h1b_skill_owner(case when tg_op = 'DELETE' then old.skill_id else new.skill_id end);
    if tg_op = 'INSERT' then
      if owner is distinct from caller or new.status <> 'offered' then
        deny := 'You can only share your own skill.';
      end if;
    elsif tg_op = 'DELETE' then
      if owner is distinct from caller then deny := 'Only the sharing side revokes a skill share.'; end if;
    else
      select initiator_org_id, counterpart_org_id into ini, cp from partnerships where id = old.partnership_id;
      if (caller is distinct from ini and caller is distinct from cp)
         or new.skill_id is distinct from old.skill_id or new.partnership_id is distinct from old.partnership_id then
        deny := 'That skill share is not yours to change.';
      elsif owner = caller then
        if new.status <> 'offered' and new.status is distinct from old.status then
          deny := 'The sharing side only (re-)offers.';
        end if;
      elsif old.status = 'offered' and new.status in ('accepted', 'declined') then
        null;
      else
        deny := 'That skill-share transition is not allowed.';
      end if;
    end if;

  elsif tg_table_name = 'joint_pursuits' then
    if tg_op = 'INSERT' then
      if new.proposed_by_org is distinct from caller or new.status <> 'proposed' then
        deny := 'A joint pursuit is proposed by your own organization.';
      end if;
    else
      select initiator_org_id, counterpart_org_id into ini, cp from partnerships where id = old.partnership_id;
      if caller is distinct from ini and caller is distinct from cp then
        deny := 'That joint pursuit is not yours to change.';
      elsif tg_op = 'DELETE' then
        if old.status <> 'declined' then deny := 'Only a declined proposal is cleared.'; end if;
      elsif new.partnership_id is distinct from old.partnership_id or new.company_id is distinct from old.company_id
         or new.proposed_by_org is distinct from old.proposed_by_org or new.name is distinct from old.name then
        deny := 'A joint pursuit''s parties and account do not change.';
      elsif old.status = 'proposed' and new.status in ('active', 'declined') then
        if caller = old.proposed_by_org then deny := 'The proposing side can''t decide its own proposal.'; end if;
      elsif old.status = 'active' and new.status = 'closed' then
        null;
      else
        deny := 'That joint-pursuit transition is not allowed.';
      end if;
    end if;

  elsif tg_table_name = 'warm_intro_requests' then
    if tg_op = 'INSERT' then
      if new.requested_by_org is distinct from caller or new.status <> 'requested' or new.revealed_contact is not null then
        deny := 'A warm intro is requested by your own organization.';
      end if;
    elsif tg_op = 'DELETE' then
      deny := 'Warm-intro requests are decided, not deleted.';
    else
      select initiator_org_id, counterpart_org_id into ini, cp from partnerships where id = old.partnership_id;
      if (caller is distinct from ini and caller is distinct from cp)
         or new.partnership_id is distinct from old.partnership_id or new.company_id is distinct from old.company_id
         or new.requested_by_org is distinct from old.requested_by_org or new.ask is distinct from old.ask then
        deny := 'That warm intro is not yours to change.';
      elsif old.status = 'requested' and new.status in ('accepted', 'declined') and caller <> old.requested_by_org then
        if new.status = 'declined' and new.revealed_contact is not null then
          deny := 'A declined intro reveals no contact.';
        end if;
      else
        deny := 'Only the other side decides a warm intro, once.';
      end if;
    end if;

  elsif tg_table_name = 'context_grants' then
    if tg_op = 'INSERT' then
      if new.from_org_id is distinct from caller or new.status <> 'offered' then
        deny := 'A context grant is offered by your own organization.';
      end if;
    elsif tg_op = 'DELETE' then
      deny := 'Context grants are revoked or expire; they are not deleted.';
    elsif caller is distinct from old.from_org_id and caller is distinct from old.to_org_id then
      deny := 'That context grant is not yours to change.';
    elsif new.pursuit_id is distinct from old.pursuit_id or new.from_org_id is distinct from old.from_org_id
       or new.to_org_id is distinct from old.to_org_id or new.grant_kind is distinct from old.grant_kind
       or new.information_classes is distinct from old.information_classes or new.action_family is distinct from old.action_family
       or new.purpose is distinct from old.purpose or new.scope is distinct from old.scope
       or new.delegation_allowed is distinct from old.delegation_allowed or new.onward_sharing_allowed is distinct from old.onward_sharing_allowed
       or new.retention_class is distinct from old.retention_class or new.expires_at is distinct from old.expires_at then
      deny := 'A context grant''s terms do not change after it is offered.';
    elsif old.status = 'offered' and new.status in ('accepted', 'declined') then
      if caller is distinct from old.to_org_id then deny := 'Only the receiving org decides a context grant.'; end if;
    elsif old.status in ('offered', 'accepted') and new.status = 'revoked' then
      if caller is distinct from old.from_org_id then deny := 'Only the granting org revokes a context grant.'; end if;
    elsif new.status = 'expired' then
      if old.expires_at is null or old.expires_at > now() then deny := 'A context grant expires only at its expiry.'; end if;
    elsif new.status is distinct from old.status then
      deny := 'That context-grant transition is not allowed.';
    end if;
  end if;

  if deny is not null then
    raise exception '%', deny using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array['partnerships','list_grants','overlap_probes','evidence_shares','skill_shares',
                           'joint_pursuits','warm_intro_requests','context_grants'] loop
    execute format('drop trigger if exists h1b_consent_guard on public.%I', t);
    execute format('create trigger h1b_consent_guard before insert or update or delete on public.%I
                      for each row execute function public.h1b_consent_guard()', t);
  end loop;
end $$;

-- ── policies ────────────────────────────────────────────────────────────────────────────────────────

-- The joint-room ledger is symmetric by design: either party reads every line of a room it can see,
-- and writes only lines carrying its own org (the broker's org-less line goes through
-- record_broker_event()). No line is updated or deleted by the runtime role.
drop policy if exists joint_pursuit_events_rw on public.joint_pursuit_events;
drop policy if exists joint_pursuit_events_rw_insert on public.joint_pursuit_events;
create policy joint_pursuit_events_rw on public.joint_pursuit_events for select to app_rw
  using (exists (select 1 from joint_pursuits jp where jp.id = joint_pursuit_events.pursuit_id and public.can_see_partnership(jp.partnership_id)));
create policy joint_pursuit_events_rw_insert on public.joint_pursuit_events for insert to app_rw
  with check (org_id = public.app_current_org()
              and exists (select 1 from joint_pursuits jp where jp.id = joint_pursuit_events.pursuit_id and public.can_see_partnership(jp.partnership_id)));

-- Organisations are readable catalogue (names on shared surfaces); the runtime role may update only
-- its own, and never creates or deletes one (provisioning is owner-path only).
drop policy if exists organizations_rw on public.organizations;
drop policy if exists organizations_rw_update on public.organizations;
create policy organizations_rw on public.organizations for select to app_rw using (true);
create policy organizations_rw_update on public.organizations for update to app_rw
  using (id = public.app_current_org()) with check (id = public.app_current_org());

-- ── EXECUTE: app_rw only, for exactly the functions the application calls ───────────────────────────

do $$
declare
  f text;
  app_callable text[] := array[
    'public.audit_partnership_event(uuid, uuid, text, text, jsonb)',
    'public.redeem_partnership_invite(text)',
    'public.list_grant_source_state(uuid)',
    'public.sync_list_grant_members(uuid)',
    'public.revoke_list_grant_copies(uuid, uuid)',
    'public.decide_overlap_probe(uuid, boolean)',
    'public.partnership_evidence_shares(uuid)',
    'public.shared_in_evidence(uuid)',
    'public.partnership_skill_shares(uuid)',
    'public.shared_in_skills()',
    'public.skill_share_subject(uuid)',
    'public.record_broker_event(uuid, text, jsonb)',
    'public.partnership_settlement_rows(uuid)',
    'public.h1b_skill_owner(uuid)'];
  internal text[] := array[
    'public.h1b_consent_party(uuid)', 'public.h1b_consent_allowed(uuid)',
    'public.h1b_org_book(uuid)', 'public.h1b_overlap_results(uuid, uuid, text)', 'public.h1b_consent_guard()'];
  r text;
begin
  foreach f in array app_callable || internal loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated', 'service_role', 'app_rw'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
  end loop;
  foreach f in array app_callable loop
    execute format('grant execute on function %s to app_rw', f);
  end loop;
end $$;

-- ROLLBACK (H1B): the application also works on the owner connection with this migration applied.
-- To remove it: drop trigger h1b_consent_guard on the eight tables above; drop the functions listed in
-- app_callable / internal; restore `joint_pursuit_events_rw` and `organizations_rw` as FOR ALL policies
-- (0058 / 0061 definitions) and drop joint_pursuit_events_rw_insert / organizations_rw_update.
