-- A stand-in for the parts of the production database that migrations 024 and
-- 025 touch, so those two files can be executed for real before they are pasted
-- into the Supabase SQL Editor.
--
-- Column names here are copied from `backend/supabase/schema.sql` and from the
-- live database (checked over PostgREST), NOT from the migrations — a fixture
-- that agrees with the migration proves nothing.
--
-- Not a general test suite: it creates exactly the tables, roles and helper
-- functions the two migrations reference, and nothing else.

-- Supabase's roles and the JWT helper. `auth.uid()` is the only part of
-- Supabase auth the migrations see.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end $$;

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- 005 -------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key,
  name text,
  email text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- schema.sql ------------------------------------------------------------------
create table if not exists public.blogs (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'শিরোনাম',
  sub_title text not null default '',
  image text not null default '',
  content text not null default '',
  status text not null default 'Draft' check (status in ('Draft', 'Publish')),
  tags text[] not null default '{}'::text[],
  slug text not null default '',
  views_count bigint not null default 0 check (views_count >= 0),
  published_date date,
  category_title text not null default '',
  category_slug text not null default '',
  author_name text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

-- 006 / 016 -------------------------------------------------------------------
create table if not exists public.submitted_blogs (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  status text not null default 'Pending',
  user_id uuid,
  writer_email text not null default '',
  inline_media jsonb not null default '[]'::jsonb,
  converted_blog_id uuid,
  created_at timestamptz not null default timezone('utc', now())
);

-- 006 / schema.sql ------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  blog_id uuid,
  content text not null default '',
  status text not null default 'Unpublish',
  user_id uuid,
  created_at timestamptz not null default timezone('utc', now())
);

-- 014 / 018 -------------------------------------------------------------------
create table if not exists public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  artist text not null default '',
  album text not null default '',
  genre text not null default '',
  description text not null default '',
  thumbnail_url text not null default '',
  audio_url text not null default '',
  file_provider text not null default 'url',
  file_storage_path text not null default '',
  duration_seconds integer not null default 0,
  file_size_mb numeric(8,2) not null default 0,
  love_count integer not null default 0,
  user_id uuid,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

-- Supabase grants these to the publishable key by default; without them the
-- guest paths below could not even read the row they just wrote.
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.blogs, public.music_tracks, public.submitted_blogs,
  public.comments
  to anon, authenticated;

-- 004's dashboard-session helper, which 027 gates on. The real one reads
-- `dashboard_sessions`; here the session is whatever the caller sets, which is
-- all the gate needs to be exercised both ways.
create or replace function public.is_dashboard_request()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('test.dashboard', true), '') = 'on'
$$;

-- Deliberately *not* created: `music_tracks.views_count` and
-- `music_tracks.uploader_name`. Those are what the two migrations bring; a
-- fixture that pre-created them would hide the very ordering bug being tested.
