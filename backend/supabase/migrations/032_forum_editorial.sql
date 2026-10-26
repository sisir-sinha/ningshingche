-- Editorial dashboard: the forum as something the CMS writes, not only reads.
-- Run in the Supabase SQL Editor after 029_forum.sql and 030_forum_answers.sql.
--
-- 029 and 030 built the forum for readers: every thread and every answer had a
-- reader behind it, and `user_id` was NOT NULL because of it. This file opens the
-- other direction — the NingshingChe admin writes threads and answers from the
-- dashboard, and can edit or remove anything a reader wrote.
--
-- Three things make that work, and only three:
--
--   * an editorial post has no reader, so `user_id` may be null, and the name
--     the app shows comes from a stored `author_name` first (the dashboard fills
--     it), the reader's profile second, and the magazine's reader label last;
--   * `is_official` already exists on a thread (030) and is what the app's
--     **অনুমোদিত** tab filters on — a dashboard insert is official by 030's own
--     trigger, so an admin thread appears there without the admin ticking a box;
--   * reactions become a table the dashboard may read and manage, which 030
--     deliberately left closed: `forum_react` was the only door, and it needs
--     either a signed-in reader or a guest device id.
--
-- A reader still cannot sign their post with someone else's name or award
-- themselves the official badge, which is what the guard trigger below is for.

begin;

-- 1. Who wrote it --------------------------------------------------------------
--
-- `if exists` throughout: a database that has not installed 029 yet has no forum
-- to open up, and this file should not be the one that fails on it.

alter table if exists public.forum_discussions add column if not exists author_name text not null default '';
alter table if exists public.forum_replies add column if not exists author_name text not null default '';
alter table if exists public.forum_replies add column if not exists is_official boolean not null default false;

-- Until now every post had a reader behind it. An editorial one does not.
alter table if exists public.forum_discussions alter column user_id drop not null;
alter table if exists public.forum_replies alter column user_id drop not null;

-- 2. The name the app shows, and 3. the two columns a reader may not fake ------
--
-- Both views keep their columns, in their order, with their types: a view can be
-- replaced, and its expressions may change, but only new columns may be appended.
-- The one expression that changes is `author_name` — an editorial post is signed
-- by the dashboard, a reader's post by the reader's profile, and a row with
-- neither is still a reader's post.
--
-- This is one block because everything in it needs 030's columns. A database that
-- has run 029 but not 030 is told so rather than half-changed.
do $forum_editorial$
declare
  ready boolean;
begin
  select to_regclass('public.forum_discussions') is not null
     and exists (
       select 1 from pg_attribute a
        where a.attrelid = 'public.forum_discussions'::regclass
          and a.attname = 'is_official'
          and not a.attisdropped
     )
    into ready;

  if not ready then
    raise notice '032_forum_editorial.sql needs 029_forum.sql and 030_forum_answers.sql first; nothing to do.';
    return;
  end if;

  execute $view$
    create or replace view public.forum_discussion_rows as
    select d.id,
           k.id as category_id,
           k.slug as category_slug,
           k.title as category_title,
           d.title,
           left(regexp_replace(d.body, '<[^>]*>', ' ', 'g'), 240) as excerpt,
           d.body,
           d.user_id as author_id,
           coalesce(nullif(btrim(d.author_name), ''), nullif(btrim(p.name), ''), 'নিংশিং চে পাঠক') as author_name,
           coalesce(p.avatar_url, '') as author_avatar_url,
           d.status,
           d.views_count,
           d.replies_count,
           d.created_at,
           d.last_reply_at,
           d.updated_at,
           d.cover_image_url,
           d.is_official
      from public.forum_discussions d
      join public.forum_categories k on k.id = d.category_id
      left join public.profiles p on p.id = d.user_id
  $view$;

  execute 'revoke all on public.forum_discussion_rows from anon, authenticated';

  execute $view$
    create or replace view public.forum_reply_rows as
    select r.id,
           r.discussion_id,
           r.parent_id,
           r.user_id as author_id,
           coalesce(nullif(btrim(r.author_name), ''), nullif(btrim(p.name), ''), 'নিংশিং চে পাঠক') as author_name,
           coalesce(p.avatar_url, '') as author_avatar_url,
           r.body,
           r.status,
           r.created_at,
           (select count(*) from public.forum_reactions x
             where x.reply_id = r.id and x.kind = 'like') as like_count,
           (select count(*) from public.forum_reactions x
             where x.reply_id = r.id and x.kind = 'dislike') as dislike_count,
           (select count(*) from public.forum_reactions x
             where x.reply_id = r.id and x.kind = 'agree') as agree_count,
           r.is_official
      from public.forum_replies r
      left join public.profiles p on p.id = r.user_id
  $view$;

  execute 'revoke all on public.forum_reply_rows from anon, authenticated';

  -- `author_name` and `is_official` are the dashboard's to write. The app's own
  -- door is `forum_create_discussion` / `forum_reply`, and neither touches either
  -- column — but a signed-in reader can also PATCH their own row straight through
  -- PostgREST, and 029's `*_own_write` policy allows exactly that. Without this
  -- trigger a reader could sign a post "নিংশিং চে" or put their own thread in
  -- অনুমোদিত.
  --
  -- The dashboard is untouched: a request carrying a dashboard session keeps
  -- whatever it sent. Everything else keeps the stored values, and a brand-new
  -- row keeps the empty label and no badge.
  execute $guard$
    create or replace function public.forum_content_guard()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    begin
      if to_regprocedure('public.is_dashboard_request()') is not null then
        if public.is_dashboard_request() then
          return new;
        end if;
      end if;

      if tg_op = 'UPDATE' then
        new.author_name := old.author_name;
        new.is_official := old.is_official;
      else
        new.author_name := '';
        new.is_official := false;
      end if;
      return new;
    end;
    $body$
  $guard$;

  execute 'drop trigger if exists forum_discussions_content_guard on public.forum_discussions';
  execute $guard$
    create trigger forum_discussions_content_guard
      before insert or update on public.forum_discussions
      for each row execute function public.forum_content_guard()
  $guard$;

  execute 'drop trigger if exists forum_replies_content_guard on public.forum_replies';
  execute $guard$
    create trigger forum_replies_content_guard
      before insert or update on public.forum_replies
      for each row execute function public.forum_content_guard()
  $guard$;
end
$forum_editorial$;

-- 4. Reactions, for the dashboard ----------------------------------------------
--
-- 030 created the table with RLS on and no policy and no grant: `forum_react` was
-- the only door, and it decides who a reactor is (a signed-in reader, or a guest
-- device). The dashboard is neither, so reading the counts of an answer and
-- managing its reactions needs its own door — granted, and then guarded by the
-- same menu key as the rest of the forum. A database without 030 has no such
-- table and skips this.

do $forum_reaction_access$
declare
  rbac_installed boolean := to_regprocedure('public.dashboard_has_permission(text)') is not null;
begin
  if to_regclass('public.forum_reactions') is null then
    return;
  end if;

  execute 'grant select, insert, update, delete on public.forum_reactions to anon, authenticated';

  execute 'drop policy if exists forum_reactions_dashboard_all on public.forum_reactions';
  execute 'drop policy if exists forum_reactions_dashboard_select on public.forum_reactions';
  execute 'drop policy if exists forum_reactions_dashboard_insert on public.forum_reactions';
  execute 'drop policy if exists forum_reactions_dashboard_update on public.forum_reactions';
  execute 'drop policy if exists forum_reactions_dashboard_delete on public.forum_reactions';

  if rbac_installed then
    -- Readable wherever the forum's own tables are readable (the index dashboard
    -- draws its panel with Analytics alone), writable with the Forum menu.
    execute $sql$
      create policy forum_reactions_dashboard_select on public.forum_reactions
      for select to anon, authenticated
      using (public.dashboard_has_any_permission(array['forum','analytics']::text[]))
    $sql$;
    execute $sql$
      create policy forum_reactions_dashboard_insert on public.forum_reactions
      for insert to anon, authenticated
      with check (public.dashboard_has_permission('forum'))
    $sql$;
    execute $sql$
      create policy forum_reactions_dashboard_update on public.forum_reactions
      for update to anon, authenticated
      using (public.dashboard_has_permission('forum'))
      with check (public.dashboard_has_permission('forum'))
    $sql$;
    execute $sql$
      create policy forum_reactions_dashboard_delete on public.forum_reactions
      for delete to anon, authenticated
      using (public.dashboard_has_permission('forum'))
    $sql$;
  else
    execute $sql$
      create policy forum_reactions_dashboard_all on public.forum_reactions
      for all to anon, authenticated
      using (public.is_dashboard_request()) with check (public.is_dashboard_request())
    $sql$;
  end if;
end
$forum_reaction_access$;

-- 5. RLS, restated after the policies it belongs to ----------------------------

do $forum_editorial_rls$
begin
  if to_regclass('public.forum_discussions') is not null then
    execute 'alter table public.forum_discussions enable row level security';
  end if;
  if to_regclass('public.forum_replies') is not null then
    execute 'alter table public.forum_replies enable row level security';
  end if;
  if to_regclass('public.forum_reactions') is not null then
    execute 'alter table public.forum_reactions enable row level security';
  end if;
end
$forum_editorial_rls$;

commit;
