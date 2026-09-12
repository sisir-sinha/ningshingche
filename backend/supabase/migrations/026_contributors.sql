-- Contributors: points, a monthly leaderboard, and the app time that feeds them.
--
-- A contributor is a registered reader whose published work and time in the app
-- add up. Points come from four things the database already knows about, plus
-- one it does not: how long the reader had the app open.
--
--   published article   50 points each
--   song uploaded       30 points each
--   comment              5 points each
--   view of their work   1 point each
--   app time             1 point per 2 minutes
--
-- The weights live in exactly one place (`contributor_points_from`), so changing
-- what makes a contributor is a single edit and everything that shows a score
-- follows automatically.
--
-- Who may see the board: **signed-in readers only**, as the owner asked. That is
-- enforced here, not in the app — the RPCs are granted to `authenticated` alone
-- and raise if there is no `auth.uid()`, so a guest with the publishable key is
-- refused by the database whatever the client does.
--
-- Run this in the Supabase SQL Editor after 024 and 025. The app degrades
-- gracefully without it: the contributor page reports that it is unavailable.

begin;

-- 0. What it reads -----------------------------------------------------------
--
-- `contributor_score` counts views, and the view table belongs to 025 — the same
-- trap 024 fell into. Either file may be pasted first, so the table is created
-- here as well if it is missing. `if not exists` makes this free when 025 has
-- already run; 025 remains the file that owns the table and adds its trigger and
-- grants. **Keep the two definitions identical.**

create table if not exists public.content_views (
  id bigserial primary key,
  content_type text not null check (content_type in ('blog', 'music')),
  content_id uuid not null,
  viewer_key text not null,
  created_at timestamptz not null default timezone('utc', now())
);

-- 1. Time in the app ---------------------------------------------------------
--
-- One row per reader per UTC day. The app reports seconds in batches while it is
-- open and again when it goes to the background; the exact session shape does
-- not matter, only the daily total.

create table if not exists public.reader_activity (
  user_id uuid not null,
  day date not null default (timezone('utc', now())::date),
  seconds integer not null default 0 check (seconds >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, day)
);

create index if not exists reader_activity_day_idx
  on public.reader_activity (day);

-- No grants and no policies: only the security-definer function below touches
-- this table, and only its own row per reader.
alter table public.reader_activity enable row level security;

-- 2. The weights -------------------------------------------------------------

create or replace function public.contributor_points_from(
  p_articles integer,
  p_songs integer,
  p_comments integer,
  p_views bigint,
  p_seconds integer
)
returns integer
language sql
immutable
as $$
  select greatest(p_articles, 0) * 50
       + greatest(p_songs, 0) * 30
       + greatest(p_comments, 0) * 5
       + greatest(p_views, 0)::integer * 1
       + (greatest(p_seconds, 0) / 120);
$$;

-- 3. One reader's numbers over a window --------------------------------------
--
-- `null` on either end means "no bound", which is how the lifetime figures are
-- read. Articles are the reader's submissions that were published, so a draft or
-- a rejection earns nothing; a view counts towards whoever owns the work, not
-- whoever read it.

create or replace function public.contributor_score(
  p_user_id uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with article_count as (
    select count(*)::integer as n
    from public.submitted_blogs s
    join public.blogs b on b.id = s.converted_blog_id
    where s.user_id = p_user_id
      and b.status = any (array['Publish', 'Published'])
      and (p_from is null or coalesce(b.published_date, (b.created_at at time zone 'utc')::date) >= p_from)
      and (p_to is null or coalesce(b.published_date, (b.created_at at time zone 'utc')::date) < p_to)
  ),
  song_count as (
    select count(*)::integer as n
    from public.music_tracks t
    where t.user_id = p_user_id
      and (p_from is null or (t.created_at at time zone 'utc')::date >= p_from)
      and (p_to is null or (t.created_at at time zone 'utc')::date < p_to)
  ),
  comment_count as (
    select count(*)::integer as n
    from public.comments c
    where c.user_id = p_user_id
      and (p_from is null or (c.created_at at time zone 'utc')::date >= p_from)
      and (p_to is null or (c.created_at at time zone 'utc')::date < p_to)
  ),
  view_count as (
    select count(*)::bigint as n
    from public.content_views v
    where (p_from is null or (v.created_at at time zone 'utc')::date >= p_from)
      and (p_to is null or (v.created_at at time zone 'utc')::date < p_to)
      and (
        (v.content_type = 'music' and exists (
          select 1 from public.music_tracks t
          where t.id = v.content_id and t.user_id = p_user_id))
        or
        (v.content_type = 'blog' and exists (
          select 1 from public.submitted_blogs sb
          where sb.converted_blog_id = v.content_id and sb.user_id = p_user_id))
      )
  ),
  time_count as (
    select coalesce(sum(a.seconds), 0)::integer as n
    from public.reader_activity a
    where a.user_id = p_user_id
      and (p_from is null or a.day >= p_from)
      and (p_to is null or a.day < p_to)
  )
  select jsonb_build_object(
    'articles', article_count.n,
    'songs', song_count.n,
    'comments', comment_count.n,
    'views', view_count.n,
    'seconds', time_count.n,
    'points', public.contributor_points_from(
      article_count.n, song_count.n, comment_count.n, view_count.n, time_count.n
    )
  )
  from article_count, song_count, comment_count, view_count, time_count;
$$;

-- 4. Reporting time ----------------------------------------------------------
--
-- Signed in only: a guest has no profile to credit, so their seconds are dropped
-- (the call answers 0 rather than failing — the app should not have to care).
-- One call is clamped to an hour, which is the app's flush interval gone wrong
-- rather than a reader's real session, and the daily total is capped at 16 hours
-- so a phone left face-up on a desk cannot mint points.

create or replace function public.record_app_time(p_seconds integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  reader uuid := auth.uid();
  granted integer;
  capped integer;
  today integer;
begin
  if reader is null then
    return 0;
  end if;

  granted := least(greatest(coalesce(p_seconds, 0), 0), 3600);
  if granted = 0 then
    if not exists (
      select 1 from public.reader_activity
      where user_id = reader and day = (timezone('utc', now())::date)
    ) then
      return 0;
    end if;
  end if;

  insert into public.reader_activity (user_id, day, seconds)
  values (reader, (timezone('utc', now())::date), least(granted, 57600))
  on conflict (user_id, day) do update
    set seconds = least(public.reader_activity.seconds + granted, 57600),
        updated_at = timezone('utc', now());

  select least(seconds, 57600) into capped
    from public.reader_activity
    where user_id = reader and day = (timezone('utc', now())::date);

  return coalesce(capped, 0);
end;
$$;

-- 5. The board ---------------------------------------------------------------
--
-- Monthly, because that is what the home page shows. `p_month` may be any date
-- inside the month wanted; today's month is the default.

create or replace function public.contributor_month_range(p_month date default null)
returns date[]
language sql
stable
as $$
  select array[
    date_trunc('month', coalesce(p_month, timezone('utc', now())::date))::date,
    (date_trunc('month', coalesce(p_month, timezone('utc', now())::date)) + interval '1 month')::date
  ];
$$;

/**
 * The readers who earned the most in the given month, best first. Readers with
 * nothing to show are left out rather than listed at zero.
 *
 * A security-definer read: `profiles` is select-own (migration 005), so the
 * board cannot be assembled by the client. It returns a name and an avatar for
 * people the caller is not allowed to select directly — which is the point of a
 * leaderboard, and no more than the public page already shows.
 */
create or replace function public.contributor_leaderboard(
  p_limit integer default 20,
  p_month date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  span date[] := public.contributor_month_range(p_month);
  rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'contributor board is for signed-in readers'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(entry order by rank), '[]'::jsonb) into rows
  from (
    select row_number() over () as rank,
           jsonb_build_object(
             'user_id', p.id,
             'name', coalesce(nullif(btrim(p.name), ''), 'নিংশিং চে পাঠক'),
             'avatar_url', coalesce(p.avatar_url, ''),
             'articles', score ->> 'articles',
             'songs', score ->> 'songs',
             'comments', score ->> 'comments',
             'views', score ->> 'views',
             'seconds', score ->> 'seconds',
             'points', (score ->> 'points')::integer
           ) as entry
    from public.profiles p
    cross join lateral (select public.contributor_score(p.id, span[1], span[2]) as score) s
    where (score ->> 'points')::integer > 0
    order by (score ->> 'points')::integer desc,
             (score ->> 'articles')::integer desc,
             (score ->> 'songs')::integer desc,
             p.created_at asc
    limit greatest(least(coalesce(p_limit, 20), 100), 1)
  ) board;

  return jsonb_build_object(
    'month_key', to_char(span[1], 'YYYY-MM'),
    'contributors', rows
  );
end;
$$;

/** A reader's own figures: this month and since they joined. */
create or replace function public.contributor_points(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  span date[] := public.contributor_month_range(null);
begin
  if auth.uid() is null then
    raise exception 'contributor points are for signed-in readers'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'month_key', to_char(span[1], 'YYYY-MM'),
    'month', public.contributor_score(p_user_id, span[1], span[2]),
    'lifetime', public.contributor_score(p_user_id, null, null)
  );
end;
$$;

-- 6. Only registered readers -------------------------------------------------

revoke execute on function public.contributor_score(uuid, date, date) from public;
revoke execute on function public.contributor_month_range(date) from public;
revoke execute on function public.contributor_points_from(integer, integer, integer, bigint, integer) from public;
revoke execute on function public.contributor_leaderboard(integer, date) from public;
revoke execute on function public.contributor_points(uuid) from public;
revoke execute on function public.record_app_time(integer) from public;

grant execute on function public.contributor_leaderboard(integer, date) to authenticated;
grant execute on function public.contributor_points(uuid) to authenticated;
grant execute on function public.record_app_time(integer) to authenticated;

commit;

-- App side: `ContributorScreen` (সেরা অবদানকারী) reads the board;
-- `ReaderWorkspaceViewModel` reads the reader's own points for the dashboard;
-- `AppTimeTracker` calls record_app_time every five minutes and again when the
-- app goes to the background. A guest gets `42501` from the read RPCs, which the
-- screen shows as "sign in to see this page".
