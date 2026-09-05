-- Reader workspace: complete-profile fields, own articles, own comments.
-- Run in the Supabase SQL Editor after 005_reader_profiles.sql.
-- The Android publishable key cannot execute DDL.

begin;

alter table public.profiles add column if not exists first_name text not null default '';
alter table public.profiles add column if not exists last_name text not null default '';
alter table public.profiles add column if not exists about text not null default '';
alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists address text not null default '';
alter table public.profiles add column if not exists facebook_id text not null default '';
alter table public.profiles add column if not exists designation text not null default '';
alter table public.profiles add column if not exists location text not null default '';
alter table public.profiles add column if not exists website text not null default '';
alter table public.profiles add column if not exists imgbb_delete_url text not null default '';
alter table public.profiles add column if not exists profile_completed boolean not null default false;

-- Backfill names from the existing display name where possible.
update public.profiles
set
  first_name = coalesce(nullif(btrim(first_name), ''), split_part(btrim(coalesce(name, '')), ' ', 1), ''),
  last_name = coalesce(
    nullif(btrim(last_name), ''),
    nullif(btrim(substr(btrim(coalesce(name, '')), strpos(btrim(coalesce(name, '')) || ' ', ' ') + 1)), ''),
    ''
  )
where coalesce(btrim(first_name), '') = '' or coalesce(btrim(last_name), '') = '';

alter table public.submitted_blogs
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists submitted_blogs_user_id_idx
  on public.submitted_blogs (user_id);

alter table public.comments
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists comments_user_id_idx on public.comments (user_id);
create index if not exists comments_email_lower_idx on public.comments (lower(email));

drop policy if exists submitted_blogs_select_own on public.submitted_blogs;
create policy submitted_blogs_select_own
  on public.submitted_blogs
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or lower(writer_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists submitted_blogs_insert_own on public.submitted_blogs;
create policy submitted_blogs_insert_own
  on public.submitted_blogs
  for insert
  to authenticated
  with check (
    status = 'Pending'
    and converted_blog_id is null
    and (user_id is null or user_id = auth.uid())
  );

drop policy if exists submitted_blogs_update_own on public.submitted_blogs;
create policy submitted_blogs_update_own
  on public.submitted_blogs
  for update
  to authenticated
  using (user_id = auth.uid() and status = 'Pending')
  with check (user_id = auth.uid() and status = 'Pending');

drop policy if exists comments_select_own on public.comments;
create policy comments_select_own
  on public.comments
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

commit;
