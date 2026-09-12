-- Public profile details: who the reader is, and what they have earned.
--
-- `public_profile` (migration 024) answered with a name, an avatar, the two view
-- totals and the two content lists. The owner asked the page to show more of the
-- reader — designation, a short address — and their points, and to lead with the
-- most-read work instead of the newest.
--
-- Two things are added, and nothing else:
--
--   * `designation` and `address` from `profiles` (migration 006 added both;
--     this file adds them again `if not exists`, so it may be pasted before 006);
--   * `points` and `month_points` — the same numbers the contributor board
--     shows, from the same function, so the profile cannot disagree with the
--     board.
--
-- The ordering of both lists changes to **views first**: `order by views_count
-- desc`, the newest only as the tie-break. That is what the page promises.
--
-- Points come from `contributor_score` (migration 026). Either file may be
-- pasted first, so the calls are made through `to_regprocedure` and dynamic SQL:
-- a database without 026 gets zeroes instead of an error, and nothing here has
-- to be re-pasted once 026 is in. Nothing is duplicated either — the weights
-- stay in `contributor_points_from`, where they have always lived.
--
-- Run this in the Supabase SQL Editor after 024. The app degrades without it:
-- the designation and address lines are simply absent, and the points read ০.

begin;

-- 0. The two columns this reads ----------------------------------------------
--
-- Present in any database that has run 006; added here so this file stands
-- alone. The email, phone and website stay private — they are not read here.

alter table public.profiles add column if not exists designation text not null default '';
alter table public.profiles add column if not exists address text not null default '';

-- 1. The page ----------------------------------------------------------------

create or replace function public.public_profile(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  person public.profiles%rowtype;
  span date[];
  month_points integer := 0;
  lifetime_points integer := 0;
begin
  select * into person from public.profiles where id = p_user_id;
  if person.id is null then
    return null;
  end if;

  -- Migration 026 may not have been pasted yet: ask whether the scoring
  -- functions are there instead of failing on a name that does not resolve.
  if to_regprocedure('public.contributor_score(uuid, date, date)') is not null
     and to_regprocedure('public.contributor_month_range(date)') is not null then
    execute 'select public.contributor_month_range(null)' into span;
    -- contributor_score answers with the whole block, not a number: the points
    -- are one key of it (`contributor_points_from` is where the weights live).
    execute format(
      'select (public.contributor_score(%L::uuid, %L::date, %L::date) ->> ''points'')::integer',
      p_user_id, span[1], span[2]
    ) into month_points;
    execute format(
      'select (public.contributor_score(%L::uuid, null, null) ->> ''points'')::integer',
      p_user_id
    ) into lifetime_points;
  end if;

  return jsonb_build_object(
    'id', person.id,
    'name', coalesce(nullif(btrim(person.name), ''), 'নিংশিং চে পাঠক'),
    'avatar_url', coalesce(person.avatar_url, ''),
    'designation', coalesce(person.designation, ''),
    'address', coalesce(person.address, ''),
    'joined_at', person.created_at,
    'points', coalesce(lifetime_points, 0),
    'month_points', coalesce(month_points, 0),
    'article_views', coalesce((
      select sum(b.views_count)
      from public.submitted_blogs s
      join public.blogs b on b.id = s.converted_blog_id
      where s.user_id = person.id and b.status = any (array['Publish', 'Published'])
    ), 0),
    'music_views', coalesce((
      select sum(t.views_count) from public.music_tracks t where t.user_id = person.id
    ), 0),
    'articles', coalesce((
      select jsonb_agg(row_to_json(a)::jsonb)
      from (
        select b.id,
               b.title,
               b.slug,
               b.image,
               b.views_count,
               b.published_date,
               b.created_at,
               b.category_title
        from public.submitted_blogs s
        join public.blogs b on b.id = s.converted_blog_id
        where s.user_id = person.id
          and b.status = any (array['Publish', 'Published'])
        -- Most read first; the date only breaks a tie.
        order by b.views_count desc nulls last,
                 b.published_date desc nulls last,
                 b.created_at desc
        limit 60
      ) a
    ), '[]'::jsonb),
    'songs', coalesce((
      select jsonb_agg(row_to_json(m)::jsonb)
      from (
        select t.id,
               t.title,
               t.artist,
               t.album,
               t.genre,
               t.thumbnail_url,
               t.audio_url,
               t.file_storage_path,
               t.duration_seconds,
               t.love_count,
               t.views_count,
               t.created_at
        from public.music_tracks t
        where t.user_id = person.id
        order by t.views_count desc nulls last, t.created_at desc
        limit 120
      ) m
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.public_profile(uuid) to anon, authenticated;

commit;

-- App side: PortalRepository.publicProfile(userId) → PublicProfile, which now
-- carries `designation`, `points` and `monthPoints`; PublicProfileScreen shows
-- Name → designation → short address, the three statistics, and the two tabs,
-- each list ordered by views (the server's order, sorted again in the mapper so
-- a cached page and a fresh one cannot disagree).
