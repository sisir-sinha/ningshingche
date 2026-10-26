-- Editorial dashboard: the Forum as a real menu permission.
-- Run in the Supabase SQL Editor after 030_forum_answers.sql.
--
-- Why this file exists. The dashboard's sidebar shows a route only when the
-- signed-in role holds that route's key, and every other key is a row in the
-- allow-list public.dashboard_valid_permissions(). 008 appended its
-- `registered-users` and 014 its `music`; the forum arrived later (029/030) and
-- nobody taught this list the word.
--
-- The consequence was not cosmetic. `dashboard_save_role` filters a requested
-- permission list through that allow-list, so ticking **Forum** in
-- Users & Roles was dropped in silence: the checkbox, the save, the success
-- toast, and a role that still has no forum. A role that does hold the key now
-- sees the menu, and the three forum tables are guarded by exactly the key
-- their menu is guarded by — the shape Comments and Music already use.

begin;

-- 1. The allow-list -----------------------------------------------------------

-- 014's list plus 'forum' (and 'registered-users', which 008 added and 014's
-- copy of this function had dropped). See 004 for the original.
create or replace function public.dashboard_valid_permissions()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array[
    'dashboard', 'registered-users', 'authors', 'blogs', 'categories', 'comments',
    'forum', 'galleries', 'books', 'submissions', 'videos', 'music', 'analytics',
    'settings', 'access-control'
  ]::text[];
$$;

revoke all on function public.dashboard_valid_permissions() from public;

-- 2. The roles that already hold it -------------------------------------------

-- 008 and 014 appended their keys to the roles that hold the neighbouring
-- menus. The forum sits with Comments in the sidebar (config.js), so a role
-- that can moderate comments can moderate the forum; the Super Admin's stored
-- array is rebuilt from the allow-list, which is where it picks up the new key.
-- A custom role that holds neither keeps what it had — a Super Admin grants it
-- Forum in Users & Roles, which now sticks.
do $forum_role_keys$
begin
  if to_regclass('public.dashboard_roles') is not null then
    update public.dashboard_roles
       set menu_permissions = case
         when slug = 'super-admin' then public.dashboard_valid_permissions()
         when not ('forum' = any(menu_permissions)) then array_append(menu_permissions, 'forum')
         else menu_permissions
       end
     where slug = 'super-admin' or 'comments' = any(menu_permissions);
  end if;
end
$forum_role_keys$;

-- 3. The tables behind the menu -----------------------------------------------

-- 029 gave the three tables one blanket dashboard policy, gated on the session
-- alone: any dashboard login could read — and delete — every thread through
-- REST while the menu hid the page. Read follows the menu (and Analytics, which
-- draws the index dashboard's forum panel); every write needs Forum itself.
-- The public policies 029 wrote for readers are untouched, and the app still
-- reads through its own `security definer` RPCs.
--
-- Guarded on both sides: a database that never ran 029 has no tables to guard,
-- and one that never ran 004 has no permission function to name — the 029
-- policy is recreated exactly as it was in that case.
do $forum_menu_policies$
declare
  rbac_installed boolean := to_regprocedure('public.dashboard_has_permission(text)') is not null;
  forum_installed boolean := to_regclass('public.forum_discussions') is not null
    and to_regclass('public.forum_replies') is not null
    and to_regclass('public.forum_categories') is not null;
begin
  if not forum_installed then
    return;
  end if;

  execute $sql$drop policy if exists forum_discussions_dashboard_all on public.forum_discussions$sql$;
  execute $sql$drop policy if exists forum_discussions_dashboard_select on public.forum_discussions$sql$;
  execute $sql$drop policy if exists forum_discussions_dashboard_insert on public.forum_discussions$sql$;
  execute $sql$drop policy if exists forum_discussions_dashboard_update on public.forum_discussions$sql$;
  execute $sql$drop policy if exists forum_discussions_dashboard_delete on public.forum_discussions$sql$;

  execute $sql$drop policy if exists forum_replies_dashboard_all on public.forum_replies$sql$;
  execute $sql$drop policy if exists forum_replies_dashboard_select on public.forum_replies$sql$;
  execute $sql$drop policy if exists forum_replies_dashboard_insert on public.forum_replies$sql$;
  execute $sql$drop policy if exists forum_replies_dashboard_update on public.forum_replies$sql$;
  execute $sql$drop policy if exists forum_replies_dashboard_delete on public.forum_replies$sql$;

  execute $sql$drop policy if exists forum_categories_dashboard_all on public.forum_categories$sql$;
  execute $sql$drop policy if exists forum_categories_dashboard_select on public.forum_categories$sql$;
  execute $sql$drop policy if exists forum_categories_dashboard_insert on public.forum_categories$sql$;
  execute $sql$drop policy if exists forum_categories_dashboard_update on public.forum_categories$sql$;
  execute $sql$drop policy if exists forum_categories_dashboard_delete on public.forum_categories$sql$;

  if rbac_installed then
    -- Discussions: read with Forum or Analytics, everything else with Forum.
    execute $sql$
      create policy forum_discussions_dashboard_select on public.forum_discussions
      for select to anon, authenticated
      using (public.dashboard_has_any_permission(array['forum','analytics']::text[]))
    $sql$;
    execute $sql$
      create policy forum_discussions_dashboard_insert on public.forum_discussions
      for insert to anon, authenticated
      with check (public.dashboard_has_permission('forum'))
    $sql$;
    execute $sql$
      create policy forum_discussions_dashboard_update on public.forum_discussions
      for update to anon, authenticated
      using (public.dashboard_has_permission('forum'))
      with check (public.dashboard_has_permission('forum'))
    $sql$;
    execute $sql$
      create policy forum_discussions_dashboard_delete on public.forum_discussions
      for delete to anon, authenticated
      using (public.dashboard_has_permission('forum'))
    $sql$;

    -- Answers, on the same two keys.
    execute $sql$
      create policy forum_replies_dashboard_select on public.forum_replies
      for select to anon, authenticated
      using (public.dashboard_has_any_permission(array['forum','analytics']::text[]))
    $sql$;
    execute $sql$
      create policy forum_replies_dashboard_insert on public.forum_replies
      for insert to anon, authenticated
      with check (public.dashboard_has_permission('forum'))
    $sql$;
    execute $sql$
      create policy forum_replies_dashboard_update on public.forum_replies
      for update to anon, authenticated
      using (public.dashboard_has_permission('forum'))
      with check (public.dashboard_has_permission('forum'))
    $sql$;
    execute $sql$
      create policy forum_replies_dashboard_delete on public.forum_replies
      for delete to anon, authenticated
      using (public.dashboard_has_permission('forum'))
    $sql$;

    -- Categories, on the same two keys: the Forum page lists the boards.
    execute $sql$
      create policy forum_categories_dashboard_select on public.forum_categories
      for select to anon, authenticated
      using (public.dashboard_has_any_permission(array['forum','analytics']::text[]))
    $sql$;
    execute $sql$
      create policy forum_categories_dashboard_insert on public.forum_categories
      for insert to anon, authenticated
      with check (public.dashboard_has_permission('forum'))
    $sql$;
    execute $sql$
      create policy forum_categories_dashboard_update on public.forum_categories
      for update to anon, authenticated
      using (public.dashboard_has_permission('forum'))
      with check (public.dashboard_has_permission('forum'))
    $sql$;
    execute $sql$
      create policy forum_categories_dashboard_delete on public.forum_categories
      for delete to anon, authenticated
      using (public.dashboard_has_permission('forum'))
    $sql$;
  else
    -- No access-control layer: the 029 policies, unchanged.
    execute $sql$
      create policy forum_discussions_dashboard_all on public.forum_discussions
      for all to anon, authenticated
      using (public.is_dashboard_request()) with check (public.is_dashboard_request())
    $sql$;
    execute $sql$
      create policy forum_replies_dashboard_all on public.forum_replies
      for all to anon, authenticated
      using (public.is_dashboard_request()) with check (public.is_dashboard_request())
    $sql$;
    execute $sql$
      create policy forum_categories_dashboard_all on public.forum_categories
      for all to anon, authenticated
      using (public.is_dashboard_request()) with check (public.is_dashboard_request())
    $sql$;
  end if;

  -- The grants 029 wrote are what the policies are read against; keep them true
  -- whether or not this database had them.
  execute $sql$
    grant select on public.forum_categories, public.forum_discussions, public.forum_replies
      to anon, authenticated
  $sql$;
end
$forum_menu_policies$;

-- 4. RLS, restated after the policies it belongs to ---------------------------

-- 029 already enabled this on all three tables; restating it is cheap insurance
-- that the policies above are never the only thing standing, and the guard
-- keeps this file runnable on a database that has not installed 029 at all.
do $forum_rls$
begin
  if to_regclass('public.forum_discussions') is not null then
    execute 'alter table public.forum_discussions enable row level security';
  end if;
  if to_regclass('public.forum_replies') is not null then
    execute 'alter table public.forum_replies enable row level security';
  end if;
  if to_regclass('public.forum_categories') is not null then
    execute 'alter table public.forum_categories enable row level security';
  end if;
end
$forum_rls$;

commit;
