-- Store the commenter's profile photo on public.comments so the article
-- comment list can show registered-user avatars after moderation.
-- Run in the Supabase SQL Editor after 011_notifications_enabled.sql.

begin;

alter table public.comments
  add column if not exists avatar_url text not null default '';

comment on column public.comments.avatar_url is
  'Public profile photo URL captured when a registered app user comments.';

commit;
