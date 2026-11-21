-- A bounded, server-derived excerpt for new validated database targets only.
-- AI output has no authoritative persisted source and is never marked verified.
begin;
create table if not exists public.moderation_report_evidence (
  report_id uuid primary key references public.content_reports(id),
  content_type text not null,
  content_id text not null,
  author_id uuid,
  snapshot text not null,
  captured_at timestamptz not null default now()
);
alter table public.moderation_report_evidence enable row level security;
revoke all on public.moderation_report_evidence from public,anon,authenticated;

create or replace function public.capture_report_evidence()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$ declare row_data jsonb; excerpt text;
begin
  -- Legacy AI IDs are not proof and must not be stored as verified evidence.
  if new.content_type='ai_output' then return new; end if;
  case new.content_type
    when 'article' then select to_jsonb(b) into row_data from public.blogs b where b.id::text=new.content_id;
    when 'comment' then select to_jsonb(c) into row_data from public.comments c where c.id::text=new.content_id;
    when 'discussion' then select to_jsonb(d) into row_data from public.forum_discussions d where d.id::text=new.content_id;
    when 'reply' then select to_jsonb(r) into row_data from public.forum_replies r where r.id::text=new.content_id;
    when 'music' then select to_jsonb(m) into row_data from public.music_tracks m where m.id::text=new.content_id;
    when 'profile' then select jsonb_build_object('name',p.name) into row_data from public.profiles p where p.id::text=new.content_id;
    else return new;
  end case;
  if row_data is null then raise exception 'Evidence target not found' using errcode='22023'; end if;
  excerpt := case new.content_type
    when 'article' then concat_ws(E'\n',row_data->>'title',row_data->>'content')
    when 'comment' then coalesce(row_data->>'content','')
    when 'discussion' then concat_ws(E'\n',row_data->>'title',row_data->>'body')
    when 'reply' then coalesce(row_data->>'body','')
    when 'music' then concat_ws(E'\n',row_data->>'title',row_data->>'description')
    when 'profile' then coalesce(row_data->>'name','') end;
  insert into public.moderation_report_evidence(report_id,content_type,content_id,author_id,snapshot)
    values(new.id,new.content_type,new.content_id,new.reported_user_id,left(coalesce(excerpt,''),2000));
  return new;
end $$;
revoke all on function public.capture_report_evidence() from public,anon,authenticated;
drop trigger if exists phase2_report_evidence on public.content_reports;
create trigger phase2_report_evidence after insert on public.content_reports for each row execute function public.capture_report_evidence();

create or replace function public.dashboard_report_evidence(p_report_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public
as $$ declare item public.moderation_report_evidence;
begin
  if public.dashboard_current_user_id() is null or not coalesce(public.dashboard_has_permission('forum'),false) then
    raise exception 'Moderator required' using errcode='42501'; end if;
  select * into item from public.moderation_report_evidence where report_id=p_report_id;
  if not found then return null; end if;
  return to_jsonb(item);
end $$;
revoke all on function public.dashboard_report_evidence(uuid) from public;
grant execute on function public.dashboard_report_evidence(uuid) to anon,authenticated;
notify pgrst, 'reload schema';
commit;
