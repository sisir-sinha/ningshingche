-- Profile views: the total the owner asked for, counted rather than guessed.
--
-- The profile page's headline number was `article_views + music_views` — the two
-- sums `024` wrote out by hand:
--
--     articles: sum(blogs.views_count)   where the submission became that blog
--     songs:    sum(music_tracks.views_count)
--
-- Two things were wrong with it, and both are why this file exists.
--
--   * **The forum was missing.** Threads have been counted since `029`, and the
--     count is on `forum_discussions.views_count`, but no profile ever showed it.
--     A reader whose work is mostly threads — write ten discussions, no article —
--     read **০** on their own page while dozens of people had read them.
--   * **It counted by hand.** The database has had one counting engine since
--     `036`: one view per visit, whoever the visitor is (`content_view_record`),
--     and `user_view_totals` is that engine's reader-facing sum — the same
--     function the app's dashboard draws its ভিউ section from. A second sum
--     written out here is a second answer, and two answers eventually disagree.
--
-- So the page asks `user_view_totals` when it is there, and says so in its own
-- reply: `article_views`, `music_views`, `forum_views`, `total_views` (the three
-- added up in one place, so the headline can never disagree with the parts beside
-- it), plus `visitors` — different people, which is the one number a view count
-- cannot give — and `minutes_listened`.
--
-- `036` may not have been pasted yet, so this file is written the way `028` was:
-- ask `to_regprocedure` whether the function is there, and fall back to the item
-- counters, which is exactly what the page did before. `forum_discussions` is
-- asked about the same way, because a database may have the profile without the
-- forum. Either way the page opens, the number is real, and nothing here fails.
--
-- Run this in the Supabase SQL Editor after `028`. It replaces one function and
-- adds no table: one transaction, safe to run twice.
--
-- Handy check, after running it — this must print the same number twice:
--
--     select public.public_profile('<user-id>') -> 'total_views',
--            (public.public_profile('<user-id>') ->> 'article_views')::bigint
--          + (public.public_profile('<user-id>') ->> 'music_views')::bigint
--          + (public.public_profile('<user-id>') ->> 'forum_views')::bigint;

begin;

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
  -- The views, and where they came from: 036's totals when it is installed, the
  -- item counters when it is not.
  totals jsonb;
  article_views bigint := 0;
  music_views bigint := 0;
  forum_views bigint := 0;
  visitors bigint := 0;
  minutes_listened bigint := 0;
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

  -- The views. Read, never recomputed: `user_view_totals` is the engine's own
  -- answer, so this page and the app's dashboard cannot show two different
  -- numbers for the same reader.
  if to_regprocedure('public.user_view_totals(uuid)') is not null then
    execute format('select public.user_view_totals(%L::uuid)', p_user_id) into totals;
  end if;

  if totals is null then
    -- 036 is not in yet. The counters on the item rows are the only record of
    -- views, and summing them is what the page did before this file — with the
    -- forum now included, and the article rule unchanged from 036's (every blog
    -- the reader's submissions became, not only the published ones).
    select coalesce(sum(b.views_count), 0) into article_views
      from public.submitted_blogs s
      join public.blogs b on b.id = s.converted_blog_id
     where s.user_id = person.id;
    select coalesce(sum(t.views_count), 0) into music_views
      from public.music_tracks t
     where t.user_id = person.id;
    if to_regclass('public.forum_discussions') is not null then
      select coalesce(sum(d.views_count), 0) into forum_views
        from public.forum_discussions d
       where d.user_id = person.id;
    end if;
  else
    article_views := coalesce((totals ->> 'article_views')::bigint, 0);
    music_views := coalesce((totals ->> 'music_views')::bigint, 0);
    forum_views := coalesce((totals ->> 'forum_views')::bigint, 0);
    visitors := coalesce((totals ->> 'visitors')::bigint, 0);
    minutes_listened := coalesce((totals ->> 'minutes_listened')::bigint, 0);
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
    -- Everything counted, and the parts it is made of. `total_views` is added up
    -- here rather than in the app, so the headline and the split under it are the
    -- same arithmetic.
    'article_views', article_views,
    'music_views', music_views,
    'forum_views', forum_views,
    'total_views', article_views + music_views + forum_views,
    'visitors', visitors,
    'minutes_listened', minutes_listened,
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

-- App side: `PublicProfile` carries the three counts, the total, the visitors and
-- the minutes; `PublicProfileScreen`'s statistics card shows the real total and
-- the split under it, and `UserProfileScreen` — the reader's own প্রোফাইল — shows
-- the same total from `user_view_totals` through the dashboard's metrics.
-- `backend/API.md` §7.18 documents the fields.
