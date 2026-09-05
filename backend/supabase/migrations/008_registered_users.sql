-- Editorial dashboard: Registered users area for Android / Google app accounts.
-- Run in the Supabase SQL Editor after 007_user_inbox.sql.
-- Lets dashboard staff list public.profiles and reply to admin_messages.

begin;

create or replace function public.dashboard_valid_permissions()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array[
    'dashboard', 'registered-users', 'authors', 'blogs', 'categories', 'comments',
    'galleries', 'books', 'submissions', 'videos', 'analytics', 'settings',
    'access-control'
  ]::text[];
$$;

revoke all on function public.dashboard_valid_permissions() from public;

update public.dashboard_roles
set menu_permissions = array_append(menu_permissions, 'registered-users')
where slug in ('super-admin', 'administrator', 'editor', 'moderator')
  and not ('registered-users' = any(menu_permissions));

grant select on table public.profiles to anon, authenticated;

drop policy if exists profiles_dashboard_select on public.profiles;
create policy profiles_dashboard_select
  on public.profiles
  for select
  to anon, authenticated
  using (public.dashboard_has_any_permission(array['registered-users', 'analytics']::text[]));

drop policy if exists submitted_blogs_registered_users_select on public.submitted_blogs;
create policy submitted_blogs_registered_users_select
  on public.submitted_blogs
  for select
  to anon, authenticated
  using (public.dashboard_has_permission('registered-users'));

drop policy if exists comments_registered_users_select on public.comments;
create policy comments_registered_users_select
  on public.comments
  for select
  to anon, authenticated
  using (public.dashboard_has_permission('registered-users'));

do $$
begin
  if to_regclass('public.user_notifications') is not null then
    execute 'grant select on table public.user_notifications to anon, authenticated';
    execute 'drop policy if exists user_notifications_dashboard_select on public.user_notifications';
    execute $pol$
      create policy user_notifications_dashboard_select
        on public.user_notifications
        for select
        to anon, authenticated
        using (public.dashboard_has_any_permission(array['registered-users', 'analytics']::text[]))
    $pol$;
  end if;

  if to_regclass('public.admin_messages') is not null then
    execute 'grant select, insert on table public.admin_messages to anon, authenticated';
    execute 'drop policy if exists admin_messages_dashboard_select on public.admin_messages';
    execute $pol$
      create policy admin_messages_dashboard_select
        on public.admin_messages
        for select
        to anon, authenticated
        using (public.dashboard_has_any_permission(array['registered-users', 'analytics']::text[]))
    $pol$;
    execute 'drop policy if exists admin_messages_dashboard_insert on public.admin_messages';
    execute $pol$
      create policy admin_messages_dashboard_insert
        on public.admin_messages
        for insert
        to anon, authenticated
        with check (
          sender = 'admin'
          and public.dashboard_has_permission('registered-users')
        )
    $pol$;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
