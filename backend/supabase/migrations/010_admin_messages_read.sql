-- Let signed-in readers mark admin messages as read (green ticks / badge).
-- Run in the Supabase SQL Editor after 009_staff_user_notices.sql.

begin;

grant select, insert, update on table public.admin_messages to authenticated;

drop policy if exists admin_messages_update_own on public.admin_messages;
create policy admin_messages_update_own
  on public.admin_messages for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists admin_messages_dashboard_update on public.admin_messages;
create policy admin_messages_dashboard_update
  on public.admin_messages for update to anon, authenticated
  using (public.dashboard_has_permission('registered-users'))
  with check (public.dashboard_has_permission('registered-users'));

notify pgrst, 'reload schema';

commit;
