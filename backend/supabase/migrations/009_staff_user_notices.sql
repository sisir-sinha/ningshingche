-- Allow editorial staff to send in-app notices to a registered app user.
-- Run after 008_registered_users.sql.

begin;

do $$
begin
  if to_regclass('public.user_notifications') is null then
    raise notice 'user_notifications is missing. Run 007_user_inbox.sql first.';
    return;
  end if;

  execute 'grant select, insert on table public.user_notifications to anon, authenticated';

  execute 'drop policy if exists user_notifications_dashboard_insert on public.user_notifications';
  execute $pol$
    create policy user_notifications_dashboard_insert
      on public.user_notifications
      for insert
      to anon, authenticated
      with check (public.dashboard_has_permission('registered-users'))
  $pol$;
end $$;

notify pgrst, 'reload schema';

commit;
