-- Additive follow-up to 040/041. Apply only after both have been installed.
begin;

-- An old app must not record agreement to wording it never displayed. The
-- zero-argument RPC is deliberately disabled; old clients fail closed.
create or replace function public.current_terms_version()
returns text language sql immutable set search_path = pg_catalog, public
as $$ select '2026-11-21'::text $$;

create or replace function public.accept_terms_version(p_terms_version text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare me uuid := auth.uid(); accepted public.user_terms_acceptances;
begin
  if me is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_terms_version is distinct from public.current_terms_version() then
    raise exception 'Terms version changed; update the application' using errcode = '22023';
  end if;
  insert into public.user_terms_acceptances(user_id, terms_version, terms_url, acceptance_method)
    values (me, public.current_terms_version(), public.current_terms_url(), 'android_ugc_gate')
    on conflict (user_id, terms_version) do nothing;
  select * into strict accepted from public.user_terms_acceptances
    where user_id = me and terms_version = public.current_terms_version();
  return jsonb_build_object('terms_version', accepted.terms_version,
    'terms_url', accepted.terms_url, 'accepted_at', accepted.accepted_at);
end $$;
revoke all on function public.accept_terms_version(text) from public, anon;
grant execute on function public.accept_terms_version(text) to authenticated;
revoke execute on function public.accept_current_terms() from public, anon, authenticated;

alter table public.content_reports drop constraint if exists content_reports_content_type_check;
alter table public.content_reports add constraint content_reports_content_type_check
  check (content_type in ('discussion','reply','comment','profile','music','ai_output','article'));
alter table public.content_reports drop constraint if exists content_reports_reason_check;
alter table public.content_reports add constraint content_reports_reason_check
  check (reason in ('harassment','hate','sexual','violence','spam','copyright','misinformation','impersonation','other'));

-- A reader-owned update policy from migration 006 permitted changing
-- converted_blog_id and writer snapshots on Pending rows. The active app does
-- not edit submitted rows; dashboard moderation retains its separate policy.
drop policy if exists submitted_blogs_update_own on public.submitted_blogs;

-- Article and profile reports are authenticated and target-validated. Legacy
-- guest reporting for other surfaces remains available for old app versions.
create or replace function public.report_content(
  p_content_type text, p_content_id text, p_reason text,
  p_note text default null, p_reported_user uuid default null, p_device_id text default null
) returns boolean language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  me uuid := auth.uid(); target_id uuid; owner_id uuid;
  kind text := lower(btrim(coalesce(p_content_type, '')));
  item text := btrim(coalesce(p_content_id, ''));
  why text := lower(btrim(coalesce(p_reason, '')));
  note_text text := nullif(btrim(coalesce(p_note, '')), '');
  device text := nullif(btrim(coalesce(p_device_id, '')), '');
begin
  if kind not in ('discussion','reply','comment','profile','music','ai_output','article')
    or why not in ('harassment','hate','sexual','violence','spam','copyright','misinformation','impersonation','other')
    or length(item) not between 1 and 256 or length(coalesce(note_text,'')) > 1000
    or length(coalesce(device,'')) > 256 then
    raise exception 'Invalid report' using errcode = '22023';
  end if;
  if kind in ('article','profile') then
    if me is null then raise exception 'Sign in required' using errcode = '42501'; end if;
    begin target_id := item::uuid;
    exception when invalid_text_representation then raise exception 'Invalid target' using errcode = '22023'; end;
    if kind = 'article' then
      if not exists (select 1 from public.blogs b where b.id = target_id and b.status = 'Publish') then
        raise exception 'Content not found' using errcode = '22023';
      end if;
      -- An editorial author id is not an auth user id. Only a converted submission
      -- carries a reliable account association. Editorial articles remain null.
      select case when count(distinct s.user_id) = 1 then (array_agg(distinct s.user_id))[1] end
        into owner_id from public.submitted_blogs s
        where s.converted_blog_id = target_id and s.user_id is not null
          and s.status in ('Approved', 'Published');
    else
      if not exists (select 1 from public.profiles p where p.id = target_id) then
        raise exception 'Profile not found' using errcode = '22023';
      end if;
      owner_id := target_id;
    end if;
    if owner_id = me then raise exception 'Cannot report your own content' using errcode = '22023'; end if;
  else
    if me is null and device is null then raise exception 'Device required' using errcode = '22023'; end if;
    owner_id := p_reported_user; -- legacy types: attribution not yet independently verified
  end if;
  -- Serialize per account/device: the duplicate and rate checks cannot race.
  perform pg_advisory_xact_lock(hashtextextended(coalesce(me::text, 'guest:' || device), 0));
  if exists (select 1 from public.content_reports r where r.content_type = kind and r.content_id = item
    and ((me is not null and r.reporter_user_id = me) or (me is null and r.reporter_device = device))) then
    return true;
  end if;
  if (select count(*) from public.content_reports r where r.created_at >= now() - interval '1 day'
    and ((me is not null and r.reporter_user_id = me) or (me is null and r.reporter_device = device))) >= 30 then
    raise exception 'Report limit reached' using errcode = 'P0001';
  end if;
  insert into public.content_reports(content_type,content_id,reported_user_id,reporter_user_id,reporter_device,reason,note)
    values(kind,item,owner_id,me,case when me is null then device else null end,why,note_text);
  return true;
end $$;
revoke all on function public.report_content(text,text,text,text,uuid,text) from public;
grant execute on function public.report_content(text,text,text,text,uuid,text) to anon, authenticated;

-- Dashboard sessions use the anon PostgREST role plus an opaque session header.
-- Permission is checked inside the policy; an anon key alone grants nothing.
drop policy if exists content_reports_dashboard_select on public.content_reports;
create policy content_reports_dashboard_select on public.content_reports for select to anon, authenticated
  using (public.dashboard_has_permission('forum'));
drop policy if exists content_reports_dashboard_update on public.content_reports;
create policy content_reports_dashboard_update on public.content_reports for update to anon, authenticated
  using (public.dashboard_has_permission('forum')) with check (public.dashboard_has_permission('forum'));
grant select, update on public.content_reports to anon, authenticated;
revoke insert, delete on public.content_reports from anon, authenticated;

create table if not exists public.content_report_audit (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.content_reports(id),
  moderator_id uuid not null,
  action text not null,
  content_type text not null,
  content_id text not null,
  previous_status text not null,
  new_status text not null,
  created_at timestamptz not null default now()
);
create index if not exists content_report_audit_report_idx on public.content_report_audit(report_id, created_at desc);
alter table public.content_report_audit enable row level security;
drop policy if exists content_report_audit_dashboard_select on public.content_report_audit;
create policy content_report_audit_dashboard_select on public.content_report_audit for select to anon, authenticated
  using (public.dashboard_has_permission('forum'));
revoke all on public.content_report_audit from anon, authenticated;
grant select on public.content_report_audit to anon, authenticated;

create or replace function public.audit_content_report_update()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare moderator uuid := public.dashboard_current_user_id();
begin
  if moderator is null or not public.dashboard_has_permission('forum') then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['status','handled_by','updated_at'])
     is distinct from (to_jsonb(old) - array['status','handled_by','updated_at']) then
    raise exception 'Report details are immutable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    insert into public.content_report_audit(report_id,moderator_id,action,content_type,content_id,previous_status,new_status)
      values(old.id,moderator,'status_change',old.content_type,old.content_id,old.status,new.status);
  end if;
  new.handled_by := moderator::text;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.audit_content_report_update() from public, anon, authenticated;
drop trigger if exists content_report_update_audit on public.content_reports;
create trigger content_report_update_audit before update on public.content_reports
  for each row execute function public.audit_content_report_update();
commit;
