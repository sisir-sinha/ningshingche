-- Phase 2 foundation. Requires 004, 006, 011, 018, 029-034 and 040-043.
-- Account actions are distinct from, and do not replace, 043 report decisions.
-- Install with compatible clients after staging; not a complete moderation system.
begin;

create table if not exists public.moderation_account_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  target_user_id uuid not null,
  moderator_id uuid not null,
  action text not null check (action in ('warning','restrict_publishing','restrict_comments','restrict_forum','suspend','lift')),
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  previous_status text not null,
  new_status text not null,
  restriction_id uuid references public.moderation_account_events(id),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists moderation_account_events_user_time_idx on public.moderation_account_events(target_user_id, created_at desc, id);
create index if not exists moderation_account_events_lift_idx on public.moderation_account_events(restriction_id) where action = 'lift';
alter table public.moderation_account_events enable row level security;
revoke all on public.moderation_account_events from public, anon, authenticated;

create table if not exists public.moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.moderation_account_events(id),
  user_id uuid not null,
  explanation text not null check (length(btrim(explanation)) between 20 and 2000),
  status text not null default 'pending' check (status in ('pending','reviewing','accepted','rejected')),
  outcome_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, explanation)
);
create unique index if not exists moderation_appeals_one_active_idx on public.moderation_appeals(event_id) where status in ('pending','reviewing');
create index if not exists moderation_appeals_user_time_idx on public.moderation_appeals(user_id,created_at desc,id);
create index if not exists moderation_appeals_status_time_idx on public.moderation_appeals(status,created_at,id);
alter table public.moderation_appeals enable row level security;
revoke all on public.moderation_appeals from public, anon, authenticated;

create table if not exists public.moderation_appeal_audit (
  id bigint generated always as identity primary key,
  appeal_id uuid not null references public.moderation_appeals(id),
  moderator_id uuid not null,
  previous_status text not null,
  new_status text not null,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.moderation_appeal_audit enable row level security;
revoke all on public.moderation_appeal_audit from public, anon, authenticated;

-- Restriction state is derived from immutable decisions, never from report counts.
create or replace function public.moderation_restricted(p_user uuid, p_area text)
returns boolean language sql stable security definer set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.moderation_account_events e
    where e.target_user_id = p_user
      and e.action in ('suspend', 'restrict_' || p_area)
      and e.expires_at > now()
      and not exists (select 1 from public.moderation_account_events l where l.action='lift' and l.restriction_id=e.id));
$$;
revoke all on function public.moderation_restricted(uuid,text) from public, anon, authenticated;

create or replace function public.dashboard_account_action(
  p_request_id uuid, p_user_id uuid, p_action text, p_reason text,
  p_expires_at timestamptz default null, p_restriction_id uuid default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare actor uuid := public.dashboard_current_user_id(); existing public.moderation_account_events;
        target public.moderation_account_events; result public.moderation_account_events;
        action_text text := lower(btrim(coalesce(p_action,''))); reason_text text := btrim(coalesce(p_reason,''));
begin
  if actor is null or not coalesce(public.dashboard_is_super_admin(),false) then
    raise exception 'Super administrator required' using errcode='42501'; end if;
  if p_request_id is null or p_user_id is null or action_text not in ('warning','restrict_publishing','restrict_comments','restrict_forum','suspend','lift')
     or length(reason_text) not between 3 and 1000 then raise exception 'Invalid action' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('moderation:' || p_user_id::text,0));
  select * into existing from public.moderation_account_events where request_id=p_request_id;
  if found then
    if existing.moderator_id is distinct from actor or existing.target_user_id is distinct from p_user_id
       or existing.action is distinct from action_text or existing.reason is distinct from reason_text
       or existing.expires_at is distinct from p_expires_at or existing.restriction_id is distinct from p_restriction_id then
      raise exception 'Request id already used' using errcode='22023'; end if;
    return to_jsonb(existing);
  end if;
  if not exists (select 1 from auth.users where id=p_user_id) then raise exception 'User not found' using errcode='22023'; end if;
  if action_text in ('restrict_publishing','restrict_comments','restrict_forum','suspend') then
    if p_expires_at is null or p_expires_at <= now() or p_expires_at > now()+interval '365 days' or p_restriction_id is not null then
      raise exception 'Invalid expiration' using errcode='22023'; end if;
    if exists (select 1 from public.moderation_account_events e where e.target_user_id=p_user_id and e.action=action_text and e.expires_at > now()
      and not exists (select 1 from public.moderation_account_events l where l.action='lift' and l.restriction_id=e.id)) then
      raise exception 'Restriction already active' using errcode='22023'; end if;
  elsif action_text='lift' then
    if p_expires_at is not null or p_restriction_id is null then raise exception 'Invalid lift' using errcode='22023'; end if;
    select * into target from public.moderation_account_events where id=p_restriction_id and target_user_id=p_user_id for update;
    if not found or target.action not in ('restrict_publishing','restrict_comments','restrict_forum','suspend') or target.expires_at <= now()
       or exists(select 1 from public.moderation_account_events where action='lift' and restriction_id=p_restriction_id) then
      raise exception 'Restriction is not active' using errcode='22023'; end if;
  elsif p_expires_at is not null or p_restriction_id is not null then
    raise exception 'Invalid warning' using errcode='22023';
  end if;
  insert into public.moderation_account_events(request_id,target_user_id,moderator_id,action,reason,previous_status,new_status,restriction_id,expires_at)
  values(p_request_id,p_user_id,actor,action_text,reason_text,
    case when action_text='lift' then 'active' else 'none' end,
    case when action_text='lift' then 'lifted' when action_text='warning' then 'warned' else 'active' end,
    p_restriction_id,p_expires_at) returning * into result;
  return to_jsonb(result);
end $$;
revoke all on function public.dashboard_account_action(uuid,uuid,text,text,timestamptz,uuid) from public;
grant execute on function public.dashboard_account_action(uuid,uuid,text,text,timestamptz,uuid) to anon, authenticated;

-- The subject sees only their own decisions, never report or reporter details.
create or replace function public.my_moderation_actions(p_limit integer default 50, p_before timestamptz default null)
returns table(id uuid, action text, reason text, expires_at timestamptz, created_at timestamptz, restriction_id uuid)
language plpgsql stable security definer set search_path = pg_catalog, public
as $$ begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  return query select e.id,e.action,e.reason,e.expires_at,e.created_at,e.restriction_id
    from public.moderation_account_events e where e.target_user_id=auth.uid() and (p_before is null or e.created_at < p_before)
    order by e.created_at desc,e.id desc limit greatest(1,least(coalesce(p_limit,50),100));
end $$;
revoke all on function public.my_moderation_actions(integer,timestamptz) from public, anon;
grant execute on function public.my_moderation_actions(integer,timestamptz) to authenticated;

create or replace function public.submit_moderation_appeal(p_event_id uuid,p_explanation text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public
as $$ declare me uuid := auth.uid(); event public.moderation_account_events; appeal_id uuid;
explanation_text text := btrim(coalesce(p_explanation,''));
begin
  if me is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if length(explanation_text) not between 20 and 2000 then raise exception 'Invalid explanation' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('appeal:' || me::text,0));
  select * into event from public.moderation_account_events e where e.id=p_event_id and e.target_user_id=me for update;
  if not found or event.action='lift' then raise exception 'Decision not appealable' using errcode='22023'; end if;
  select a.id into appeal_id from public.moderation_appeals a where a.event_id=p_event_id and a.explanation=explanation_text;
  if found then return appeal_id; end if;
  if exists(select 1 from public.moderation_appeals a where a.event_id=p_event_id and a.status in ('pending','reviewing')) then
    raise exception 'An appeal is already being reviewed' using errcode='22023'; end if;
  if (select count(*) from public.moderation_appeals a where a.user_id=me and a.created_at >= now()-interval '1 day') >= 10 then
    raise exception 'Appeal limit reached' using errcode='22023'; end if;
  insert into public.moderation_appeals(event_id,user_id,explanation) values(p_event_id,me,explanation_text) returning id into appeal_id;
  return appeal_id;
end $$;
revoke all on function public.submit_moderation_appeal(uuid,text) from public, anon;
grant execute on function public.submit_moderation_appeal(uuid,text) to authenticated;

create or replace function public.my_moderation_appeals(p_limit integer default 50)
returns table(id uuid,event_id uuid,explanation text,status text,outcome_reason text,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public
as $$ begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  return query select a.id,a.event_id,a.explanation,a.status,a.outcome_reason,a.created_at,a.updated_at
    from public.moderation_appeals a where a.user_id=auth.uid() order by a.created_at desc,a.id desc limit greatest(1,least(coalesce(p_limit,50),100));
end $$;
revoke all on function public.my_moderation_appeals(integer) from public, anon;
grant execute on function public.my_moderation_appeals(integer) to authenticated;

create or replace function public.dashboard_decide_appeal(p_id uuid,p_action text,p_reason text default '')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$ declare actor uuid := public.dashboard_current_user_id(); item public.moderation_appeals;
act text := lower(btrim(coalesce(p_action,''))); reason_text text := btrim(coalesce(p_reason,'')); new_state text;
begin
  if actor is null or not coalesce(public.dashboard_is_super_admin(),false) then raise exception 'Super administrator required' using errcode='42501'; end if;
  if act not in ('review','accept','reject') or (act <> 'review' and length(reason_text) not between 3 and 1000) then
    raise exception 'Invalid appeal decision' using errcode='22023'; end if;
  select * into item from public.moderation_appeals where id=p_id for update;
  if not found or (act='review' and item.status <> 'pending') or (act <> 'review' and item.status <> 'reviewing') then
    raise exception 'Appeal status changed' using errcode='22023'; end if;
  new_state := case act when 'review' then 'reviewing' when 'accept' then 'accepted' else 'rejected' end;
  insert into public.moderation_appeal_audit(appeal_id,moderator_id,previous_status,new_status,reason)
    values(item.id,actor,item.status,new_state,reason_text);
  update public.moderation_appeals set status=new_state,outcome_reason=case when act='review' then null else reason_text end,updated_at=now()
    where id=item.id returning * into item;
  -- Acceptance does not silently lift a restriction; a separate audited action is required.
  return to_jsonb(item);
end $$;
revoke all on function public.dashboard_decide_appeal(uuid,text,text) from public;
grant execute on function public.dashboard_decide_appeal(uuid,text,text) to anon, authenticated;

create or replace function public.dashboard_account_history(p_user_id uuid,p_limit integer default 50)
returns setof public.moderation_account_events language plpgsql stable security definer set search_path = pg_catalog, public
as $$ begin
  if public.dashboard_current_user_id() is null or not coalesce(public.dashboard_is_super_admin(),false) then raise exception 'Super administrator required' using errcode='42501'; end if;
  return query select e.* from public.moderation_account_events e where e.target_user_id=p_user_id
    order by e.created_at desc,e.id desc limit greatest(1,least(coalesce(p_limit,50),100));
end $$;
revoke all on function public.dashboard_account_history(uuid,integer) from public;
grant execute on function public.dashboard_account_history(uuid,integer) to anon, authenticated;

-- Bounded staff-only appeal queue. Reporter identities are not part of this record.
create or replace function public.dashboard_list_moderation_appeals(p_status text default 'pending',p_limit integer default 50,p_offset integer default 0)
returns table(id uuid,event_id uuid,user_id uuid,explanation text,status text,outcome_reason text,created_at timestamptz,updated_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public
as $$ begin
  if public.dashboard_current_user_id() is null or not coalesce(public.dashboard_is_super_admin(),false) then raise exception 'Super administrator required' using errcode='42501'; end if;
  if p_status not in ('pending','reviewing','accepted','rejected','all') or coalesce(p_offset,0) not between 0 and 10000 then raise exception 'Invalid pagination' using errcode='22023'; end if;
  return query select a.id,a.event_id,a.user_id,a.explanation,a.status,a.outcome_reason,a.created_at,a.updated_at
    from public.moderation_appeals a where p_status='all' or a.status=p_status
    order by a.created_at desc,a.id desc limit greatest(1,least(coalesce(p_limit,50),100)) offset coalesce(p_offset,0);
end $$;
revoke all on function public.dashboard_list_moderation_appeals(text,integer,integer) from public;
grant execute on function public.dashboard_list_moderation_appeals(text,integer,integer) to anon, authenticated;

-- BEFORE INSERT guards apply to both SECURITY DEFINER RPCs and direct REST writes.
-- Staff editorial inserts are exempt only with their existing content permission.
-- Guests retain the existing anonymous-comment contract; this is NOT guest consent.
create or replace function public.guard_reader_ugc_insert()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$ declare me uuid := auth.uid(); area text; permission text;
begin
  area := case tg_table_name when 'comments' then 'comments' when 'forum_discussions' then 'forum' when 'forum_replies' then 'forum' else 'publishing' end;
  permission := case tg_table_name when 'comments' then 'comments' when 'forum_discussions' then 'forum' when 'forum_replies' then 'forum' when 'submitted_blogs' then 'submissions' else 'music' end;
  if public.dashboard_current_user_id() is not null and coalesce(public.dashboard_has_permission(permission),false) then return new; end if;
  if me is null then
    if tg_table_name='comments' and new.user_id is null then return new; end if;
    raise exception 'Sign in required' using errcode='42501';
  end if;
  if new.user_id is null then new.user_id := me;
  elsif new.user_id is distinct from me then raise exception 'Invalid author' using errcode='42501'; end if;
  if not public.has_accepted_current_terms() then raise exception 'Accept the current Terms before posting' using errcode='42501', hint='terms_acceptance_required'; end if;
  if public.moderation_restricted(me,area) then raise exception 'Posting is temporarily restricted' using errcode='42501'; end if;
  return new;
end $$;
revoke all on function public.guard_reader_ugc_insert() from public, anon, authenticated;
drop trigger if exists phase2_reader_ugc_guard on public.comments;
create trigger phase2_reader_ugc_guard before insert on public.comments for each row execute function public.guard_reader_ugc_insert();
drop trigger if exists phase2_reader_ugc_guard on public.forum_discussions;
create trigger phase2_reader_ugc_guard before insert on public.forum_discussions for each row execute function public.guard_reader_ugc_insert();
drop trigger if exists phase2_reader_ugc_guard on public.forum_replies;
create trigger phase2_reader_ugc_guard before insert on public.forum_replies for each row execute function public.guard_reader_ugc_insert();
drop trigger if exists phase2_reader_ugc_guard on public.music_tracks;
create trigger phase2_reader_ugc_guard before insert on public.music_tracks for each row execute function public.guard_reader_ugc_insert();
drop trigger if exists phase2_reader_ugc_guard on public.submitted_blogs;
create trigger phase2_reader_ugc_guard before insert on public.submitted_blogs for each row execute function public.guard_reader_ugc_insert();
notify pgrst, 'reload schema';
commit;
