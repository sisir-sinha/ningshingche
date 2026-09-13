-- ============================================================================
-- 035_contributor_order.sql
-- The contributor board, in the order it is named for: most points first.
--
-- 026 built the board with `row_number() over () as rank` and an `order by` in
-- the same subquery, expecting the two to agree. They do not. A window function
-- is evaluated **before** the query's own `order by`, so `over ()` numbers the
-- rows in whatever order the executor read them — typically the physical order of
-- the table — and the outer `jsonb_agg(entry order by rank)` then sorts the board
-- by that number. The result was a board whose rows were in the database's
-- storage order, not in order of points.
--
-- The fix is to put the ordering **inside** the window: `row_number() over (order
-- by points desc, articles desc, songs desc, created_at asc)`. The rank is then
-- the ranking the board claims, and the `order by` on the query keeps the same
-- tie-breakers for the `limit`.
--
-- The app sorts the same way before it draws (PortalModels), so a database that
-- has not run this file still shows the board in order — but the numbers beside
-- the rows are this file's job, and a rank that disagrees with the order is a
-- board that is lying about who is first.
--
-- Run after 026 (and 027, which added the dashboard's second door and the
-- `contributor_board` this file re-creates). A database without 027 is left
-- alone: 026's own function is ordered inside its window already.
-- ============================================================================

begin;

do $contributor_order$
declare
  ready boolean;
begin
  -- `contributor_board` is 027's; without it there is nothing here to fix.
  select to_regprocedure('public.contributor_board(integer, date, boolean)') is not null
    into ready;

  if not ready then
    raise notice '035_contributor_order.sql needs 026_contributors.sql and 027_contributor_board_dashboard.sql first; nothing to do.';
    return;
  end if;

  -- --------------------------------------------------------------------------
  -- 1. One implementation, two gates: the same function, ranked properly
  -- --------------------------------------------------------------------------
  --
  -- Unchanged from 027 apart from the two lines that matter: the rank is computed
  -- with the ordering it is meant to describe, and `nulls last` is spelled out on
  -- each of the three keys so a reader with no articles is never put above one
  -- with articles on a tie.
  execute $board$
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
    as $body$
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
        -- The rank is the order. `over ()` — what 026 and 027 wrote — numbers the
        -- rows before the query sorts them, so the list came back in the table's
        -- own order while claiming to be a ranking.
        select row_number() over (
                 order by (score ->> 'points')::integer desc,
                          (score ->> 'articles')::integer desc,
                          (score ->> 'songs')::integer desc,
                          p.created_at asc
               ) as rank,
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
        order by (score ->> 'points')::integer desc nulls last,
                 (score ->> 'articles')::integer desc nulls last,
                 (score ->> 'songs')::integer desc nulls last,
                 p.created_at asc
        limit greatest(least(coalesce(p_limit, 20), 200), 1)
      ) board;

      return jsonb_build_object(
        'month_key', case when coalesce(p_all, false) then '' else to_char(span[1], 'YYYY-MM') end,
        'contributors', rows
      );
    end;
    $body$
  $board$;

  execute 'revoke all on function public.contributor_board(integer, date, boolean) from public';

  -- --------------------------------------------------------------------------
  -- 2. The two doors keep their own rules ------------------------------------
  -- --------------------------------------------------------------------------
  --
  -- Re-stated rather than re-created: the bodies are wrappers, and what matters
  -- about them is who may call them.
  execute 'revoke execute on function public.contributor_leaderboard(integer, date) from public';
  execute 'grant execute on function public.contributor_leaderboard(integer, date) to authenticated';
  execute 'revoke execute on function public.contributor_leaderboard_dashboard(integer, date, boolean) from public';
  execute 'grant execute on function public.contributor_leaderboard_dashboard(integer, date, boolean) to anon, authenticated';
end
$contributor_order$;

commit;
