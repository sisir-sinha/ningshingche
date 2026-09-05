-- Persist the app notification opt-in on public.profiles so staff can
-- broadcast to users who admitted notification permission.
-- Run in the Supabase SQL Editor after 010_admin_messages_read.sql.

begin;

alter table public.profiles
  add column if not exists notifications_enabled boolean not null default true;

comment on column public.profiles.notifications_enabled is
  'True when the Android user admitted notification permission / kept in-app notices on.';

commit;
