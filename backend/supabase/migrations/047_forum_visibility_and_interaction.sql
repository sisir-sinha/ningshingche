-- Requires 029-034, 036 and 040. Reader visibility is one-way: a blocker no
-- longer sees a blocked author's forum rows. Replying across either-direction
-- blocks is denied. Staff moderation retains its existing direct-table policies.
-- This does not solve article/profile/music/search/cache/notification blocking.
begin;

create or replace function public.forum_author_visible(p_author uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is null or p_author is null or not exists (
    select 1 from public.user_blocks b where b.blocker_id=auth.uid() and b.blocked_id=p_author
  );
$$;
revoke all on function public.forum_author_visible(uuid) from public;
grant execute on function public.forum_author_visible(uuid) to anon, authenticated;

-- Restrictive policies compose with existing permissive read/own/staff policies;
-- they cannot grant access on their own. Dashboard sessions remain unaffected.
drop policy if exists phase3_forum_discussions_block_filter on public.forum_discussions;
create policy phase3_forum_discussions_block_filter on public.forum_discussions
  as restrictive for select to anon, authenticated
  using (public.forum_author_visible(user_id) or coalesce(public.dashboard_has_permission('forum'),false)
         or coalesce(public.dashboard_has_permission('analytics'),false));
drop policy if exists phase3_forum_replies_block_filter on public.forum_replies;
create policy phase3_forum_replies_block_filter on public.forum_replies
  as restrictive for select to anon, authenticated
  using ((public.forum_author_visible(user_id) and exists (
      select 1 from public.forum_discussions d where d.id=discussion_id and d.status='Publish' and public.forum_author_visible(d.user_id)))
    or coalesce(public.dashboard_has_permission('forum'),false)
    or coalesce(public.dashboard_has_permission('analytics'),false));

-- Preserve 032's exact columns and order. Unlike table RLS these filters also
-- apply when 030/034/036 SECURITY DEFINER RPCs read the ungranted views.
create or replace view public.forum_discussion_rows as
select d.id,k.id as category_id,k.slug as category_slug,k.title as category_title,
  d.title,left(regexp_replace(d.body,'<[^>]*>',' ','g'),240) as excerpt,d.body,
  d.user_id as author_id,
  coalesce(nullif(btrim(d.author_name),''),nullif(btrim(p.name),''),'নিংশিং চে পাঠক') as author_name,
  coalesce(p.avatar_url,'') as author_avatar_url,d.status,d.views_count,d.replies_count,
  d.created_at,d.last_reply_at,d.updated_at,d.cover_image_url,d.is_official
from public.forum_discussions d
join public.forum_categories k on k.id=d.category_id
left join public.profiles p on p.id=d.user_id
where d.status='Publish' and public.forum_author_visible(d.user_id);
revoke all on public.forum_discussion_rows from public, anon, authenticated;

create or replace view public.forum_reply_rows as
select r.id,r.discussion_id,r.parent_id,r.user_id as author_id,
  coalesce(nullif(btrim(r.author_name),''),nullif(btrim(p.name),''),'নিংশিং চে পাঠক') as author_name,
  coalesce(p.avatar_url,'') as author_avatar_url,r.body,r.status,r.created_at,
  (select count(*) from public.forum_reactions x where x.reply_id=r.id and x.kind='like') as like_count,
  (select count(*) from public.forum_reactions x where x.reply_id=r.id and x.kind='dislike') as dislike_count,
  (select count(*) from public.forum_reactions x where x.reply_id=r.id and x.kind='agree') as agree_count,
  r.is_official
from public.forum_replies r
join public.forum_discussions d on d.id=r.discussion_id
left join public.profiles p on p.id=r.user_id
where r.status='Publish' and d.status='Publish' and public.forum_author_visible(r.user_id)
  and public.forum_author_visible(d.user_id);
revoke all on public.forum_reply_rows from public, anon, authenticated;

-- Reject direct/RPC reply insertion across either-direction blocks. The owner
-- identity comes from the JWT; never use a supplied user ID to establish it.
create or replace function public.guard_forum_blocked_reply()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$ declare me uuid:=auth.uid(); thread_author uuid; parent_author uuid;
begin
  if public.dashboard_current_user_id() is not null and coalesce(public.dashboard_has_permission('forum'),false) then return new; end if;
  if me is null or new.user_id is distinct from me then raise exception 'Sign in required' using errcode='42501'; end if;
  select user_id into thread_author from public.forum_discussions where id=new.discussion_id and status='Publish';
  if not found then raise exception 'Discussion not found' using errcode='22023'; end if;
  if new.parent_id is not null then
    select user_id into parent_author from public.forum_replies
      where id=new.parent_id and discussion_id=new.discussion_id and status='Publish';
    if not found then raise exception 'Reply not found' using errcode='22023'; end if;
  end if;
  if exists(select 1 from public.user_blocks b where
    (b.blocker_id=me and b.blocked_id in (thread_author,parent_author)) or
    (b.blocked_id=me and b.blocker_id in (thread_author,parent_author))) then
    raise exception 'Interaction unavailable' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_forum_blocked_reply() from public,anon,authenticated;
drop trigger if exists phase3_forum_reply_block_guard on public.forum_replies;
create trigger phase3_forum_reply_block_guard before insert on public.forum_replies
  for each row execute function public.guard_forum_blocked_reply();
notify pgrst,'reload schema';
commit;
