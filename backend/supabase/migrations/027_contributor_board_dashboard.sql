-- The contributor board for the dashboard's Registered-users menu.
--
-- The app's board (026) is deliberately closed to anyone without a reader
-- session, which is right for the app and useless for the dashboard: its staff
-- are logged in to the dashboard, not as readers. This migration adds the same
-- board behind the dashboard's own gate instead — `is_dashboard_request()`, the
-- helper migration 004 already uses for every table in the CMS — so the page
-- appears in the dashboard's sidebar without loosening the app's rule.
--
-- The counting itself is untouched: `contributor_score` and
-- `contributor_points_from` (026) still do all of it, and the weights are still
-- in one place. This file only adds a second door to the same room.
--
-- Run after 026. The dashboard page degrades to "run the migration" without it.

begin;

-- 1. One implementation, two gates -------------------------------------------
--
-- `contributor_board` does the work and checks nothing: it is revoked from every
-- role and is only ever reached through the wrappers below, each of which checks
-- its own caller. `p_all` is what the dashboard's "Lifetime" switch sends — the
-- month is then ignored.

create or replace function public.contributor_board(
  p_limit integer default 20,
  p_month date default null,
  p_all boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  span date[];
  rows jsonb;
begin
  if coalesce(p_all, false) then
    span := array[null::date, null::date];
  else
    span := public.contributor_month_range(p_month);
  end if;

  select coalesce(jsonb_agg(entry order by rank), '[]'::jsonb) into rows
  from (
    select row_number() over () as rank,
           jsonb_build_object(
             'user_id', p.id,
             'name', coalesce(nullif(btrim(p.name), ''), 'নিংশিং চে পাঠক'),
             'email', coalesce(p.email, ''),
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
    limit greatest(least(coalesce(p_limit, 20), 200), 1)
  ) board;

  return jsonb_build_object(
    'month_key', case when coalesce(p_all, false) then '' else to_char(span[1], 'YYYY-MM') end,
    'contributors', rows
  );
end;
$$;

revoke all on function public.contributor_board(integer, date, boolean) from public;

-- 2. The app's door (unchanged rule: a reader session) ------------------------

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
begin
  if auth.uid() is null then
    raise exception 'contributor board is for signed-in readers'
      using errcode = '42501';
  end if;
  return public.contributor_board(p_limit, p_month, false);
end;
$$;

revoke execute on function public.contributor_leaderboard(integer, date) from public;
grant execute on function public.contributor_leaderboard(integer, date) to authenticated;

-- 3. The dashboard's door (a dashboard session) ------------------------------

create or replace function public.contributor_leaderboard_dashboard(
  p_limit integer default 50,
  p_month date default null,
  p_all boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_dashboard_request() then
    raise exception 'the contributor board is available to the dashboard and to signed-in readers'
      using errcode = '42501';
  end if;
  return public.contributor_board(p_limit, p_month, coalesce(p_all, false));
end;
$$;

revoke execute on function public.contributor_leaderboard_dashboard(integer, date, boolean) from public;
grant execute on function public.contributor_leaderboard_dashboard(integer, date, boolean) to anon, authenticated;

commit;

-- Dashboard side: the "সেরা অবদানকারী" page under Registered users
-- (assets/js/registered-users.js, route `ru-contributors`), which calls this with
-- the dashboard session the API layer already sends.
