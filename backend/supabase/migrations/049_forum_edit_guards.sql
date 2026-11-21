-- Reader-authored forum content edits, including 034's SECURITY DEFINER edit RPC.
-- Counters/status and account deletion are deliberately not treated as edits.
-- Other edit/profile/AI paths require their own reviewed enforcement.
begin;
create or replace function public.guard_reader_forum_content_edit()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$ declare me uuid:=auth.uid(); changed boolean;
begin
  changed := (to_jsonb(new)->'body') is distinct from (to_jsonb(old)->'body');
  if tg_table_name='forum_discussions' then
    changed := changed or (to_jsonb(new)->'title') is distinct from (to_jsonb(old)->'title')
      or (to_jsonb(new)->'cover_image_url') is distinct from (to_jsonb(old)->'cover_image_url');
  end if;
  if not changed then return new; end if;
  if public.dashboard_current_user_id() is not null and coalesce(public.dashboard_has_permission('forum'),false) then return new; end if;
  -- No-JWT maintenance is left to existing database privileges/RLS; this is not
  -- a replacement for auditing SECURITY DEFINER functions or privileged writes.
  if me is null then return new; end if;
  if old.user_id is distinct from me or new.user_id is distinct from me then
    raise exception 'Invalid author' using errcode='42501'; end if;
  if not public.has_accepted_current_terms() then
    raise exception 'Accept the current Terms before editing' using errcode='42501', hint='terms_acceptance_required'; end if;
  if public.moderation_restricted(me,'forum') then
    raise exception 'Posting is temporarily restricted' using errcode='42501'; end if;
  return new;
end $$;
revoke all on function public.guard_reader_forum_content_edit() from public,anon,authenticated;
drop trigger if exists phase3_forum_edit_guard on public.forum_discussions;
create trigger phase3_forum_edit_guard before update on public.forum_discussions
  for each row execute function public.guard_reader_forum_content_edit();
drop trigger if exists phase3_forum_edit_guard on public.forum_replies;
create trigger phase3_forum_edit_guard before update on public.forum_replies
  for each row execute function public.guard_reader_forum_content_edit();
notify pgrst,'reload schema';
commit;
