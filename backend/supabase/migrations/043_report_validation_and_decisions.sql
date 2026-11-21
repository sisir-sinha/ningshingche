-- Apply after 040-042, together with the matching dashboard and app release.
-- This does not delete content. AI output is local and cannot be independently
-- verified; its opaque id is retained only for triage, never as proof of a target.
begin;

create or replace function public.report_content(
  p_content_type text, p_content_id text, p_reason text,
  p_note text default null, p_reported_user uuid default null, p_device_id text default null
) returns boolean language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  me uuid := auth.uid(); target_id uuid; owner_id uuid; found_target boolean := false;
  kind text := lower(btrim(coalesce(p_content_type, '')));
  item text := btrim(coalesce(p_content_id, ''));
  why text := lower(btrim(coalesce(p_reason, '')));
  note_text text := nullif(btrim(coalesce(p_note, '')), '');
begin
  -- Device identifiers are user-controlled and are not an abuse boundary.
  if me is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if kind not in ('discussion','reply','comment','profile','music','ai_output','article')
     or why not in ('harassment','hate','sexual','violence','spam','copyright','misinformation','impersonation','other')
     or length(item) not between 1 and 256 or length(coalesce(note_text,'')) > 1000 then
    raise exception 'Invalid report' using errcode = '22023';
  end if;
  if kind <> 'ai_output' then
    begin target_id := item::uuid;
    exception when invalid_text_representation then raise exception 'Invalid target' using errcode = '22023'; end;
    -- Canonical UUID text prevents case/spelling variants bypassing deduplication.
    item := target_id::text;
    case kind
      when 'article' then
        select exists(select 1 from public.blogs b where b.id=target_id and b.status='Publish') into found_target;
        select case when count(distinct s.user_id)=1 then (array_agg(distinct s.user_id))[1] end
          into owner_id from public.submitted_blogs s
          where s.converted_blog_id=target_id and s.user_id is not null and s.status in ('Approved','Published');
      when 'profile' then
        select exists(select 1 from public.profiles p where p.id=target_id) into found_target;
        owner_id := target_id;
      when 'discussion' then
        select true,d.user_id into found_target,owner_id from public.forum_discussions d
          where d.id=target_id and d.status='Publish';
      when 'reply' then
        select true,r.user_id into found_target,owner_id from public.forum_replies r
          join public.forum_discussions d on d.id=r.discussion_id
          where r.id=target_id and r.status='Publish' and d.status='Publish';
      when 'comment' then
        select true,c.user_id into found_target,owner_id from public.comments c
          join public.blogs b on b.id=c.blog_id
          where c.id=target_id and c.status='Publish' and b.status='Publish';
      when 'music' then
        select true,m.user_id into found_target,owner_id from public.music_tracks m where m.id=target_id;
    end case;
    if not coalesce(found_target,false) then raise exception 'Content not found' using errcode = '22023'; end if;
    if owner_id=me then raise exception 'Cannot report your own content' using errcode = '22023'; end if;
  end if;
  -- Both unused legacy parameters remain in the signature for compatibility.
  -- Never trust either parameter for attribution or reporter identity.
  perform pg_advisory_xact_lock(hashtextextended(me::text, 0));
  if exists (select 1 from public.content_reports r where r.content_type=kind and r.content_id=item and r.reporter_user_id=me) then
    return true;
  end if;
  if (select count(*) from public.content_reports r where r.reporter_user_id=me and r.created_at >= now()-interval '1 day') >= 30 then
    raise exception 'Report limit reached' using errcode = 'P0001';
  end if;
  insert into public.content_reports(content_type,content_id,reported_user_id,reporter_user_id,reporter_device,reason,note)
    values(kind,item,owner_id,me,null,why,note_text);
  return true;
end $$;
revoke all on function public.report_content(text,text,text,text,uuid,text) from public, anon;
grant execute on function public.report_content(text,text,text,text,uuid,text) to authenticated;

alter table public.content_reports add column if not exists decision_reason text;
alter table public.content_report_audit add column if not exists decision_reason text;

-- The database, not the UI, records who decided and why. Even a moderator's
-- direct update is not permitted after this migration: use the guarded RPC.
create or replace function public.audit_content_report_update()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare moderator uuid := public.dashboard_current_user_id();
begin
  if moderator is null or not public.dashboard_has_permission('forum') then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['status','handled_by','updated_at','decision_reason'])
     is distinct from (to_jsonb(old) - array['status','handled_by','updated_at','decision_reason']) then
    raise exception 'Report details are immutable' using errcode = '42501';
  end if;
  if new.status in ('dismissed','actioned') and length(btrim(coalesce(new.decision_reason,''))) not between 3 and 1000 then
    raise exception 'A decision reason is required' using errcode = '22023';
  end if;
  if new.status is distinct from old.status then
    insert into public.content_report_audit(report_id,moderator_id,action,content_type,content_id,previous_status,new_status,decision_reason)
      values(old.id,moderator,'status_change',old.content_type,old.content_id,old.status,new.status,new.decision_reason);
  end if;
  new.handled_by := moderator::text;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.audit_content_report_update() from public, anon, authenticated;
revoke update on public.content_reports from anon, authenticated;

create or replace function public.dashboard_moderate_report(p_report_id uuid, p_action text, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  actor uuid := public.dashboard_current_user_id();
  report public.content_reports; target uuid; before_status text; after_status text;
  reason_text text := btrim(coalesce(p_reason,'')); action_text text := lower(btrim(coalesce(p_action,'')));
begin
  if actor is null or not public.dashboard_has_permission('forum') then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;
  if action_text not in ('review','dismiss','resolve','remove') then
    raise exception 'Invalid action' using errcode = '22023';
  end if;
  if action_text <> 'review' and length(reason_text) not between 3 and 1000 then
    raise exception 'A decision reason is required' using errcode = '22023';
  end if;
  select * into report from public.content_reports where id=p_report_id for update;
  if not found then raise exception 'Report not found' using errcode = '22023'; end if;
  if (action_text='review' and report.status <> 'open') or
     (action_text <> 'review' and report.status <> 'reviewing') then
    raise exception 'Report status changed; refresh before deciding' using errcode = '22023';
  end if;
  if action_text='remove' then
    begin target := report.content_id::uuid;
    exception when invalid_text_representation then raise exception 'Invalid target' using errcode='22023'; end;
    case report.content_type
      when 'article' then
        if not public.dashboard_has_permission('blogs') then raise exception 'Blogs permission required' using errcode='42501'; end if;
        select status into before_status from public.blogs where id=target for update;
        if not found then raise exception 'Content not found' using errcode='22023'; end if;
        after_status := 'Draft';
        update public.blogs set status=after_status where id=target;
      when 'comment' then
        if not public.dashboard_has_permission('comments') then raise exception 'Comments permission required' using errcode='42501'; end if;
        select status into before_status from public.comments where id=target for update;
        if not found then raise exception 'Content not found' using errcode='22023'; end if;
        after_status := 'Unpublish';
        update public.comments set status=after_status where id=target;
      when 'discussion' then
        select status into before_status from public.forum_discussions where id=target for update;
        if not found then raise exception 'Content not found' using errcode='22023'; end if;
        after_status := 'Unpublish';
        update public.forum_discussions set status=after_status where id=target;
      when 'reply' then
        select status into before_status from public.forum_replies where id=target for update;
        if not found then raise exception 'Content not found' using errcode='22023'; end if;
        after_status := 'Unpublish';
        update public.forum_replies set status=after_status where id=target;
      else raise exception 'Removal is not supported for this target' using errcode='22023';
    end case;
    insert into public.content_report_audit(report_id,moderator_id,action,content_type,content_id,previous_status,new_status,decision_reason)
      values(report.id,actor,'unpublish_content',report.content_type,report.content_id,before_status,after_status,reason_text);
  end if;
  update public.content_reports set
    status=case action_text when 'review' then 'reviewing' when 'dismiss' then 'dismissed' else 'actioned' end,
    decision_reason=case when action_text='review' then null else reason_text end
    where id=report.id returning * into report;
  return to_jsonb(report);
end $$;
revoke all on function public.dashboard_moderate_report(uuid,text,text) from public;
grant execute on function public.dashboard_moderate_report(uuid,text,text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
