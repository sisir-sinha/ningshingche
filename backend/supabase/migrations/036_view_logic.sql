-- ============================================================================
-- 036_view_logic.sql
-- One view per visit — whoever the visitor is, everywhere a view is counted.
--
-- Three counters grew up separately, and each was wrong in a different direction.
-- Articles and songs counted an event row but deduped the same viewer for twenty
-- hours, so a reader who read an article in the morning and again in the evening
-- was counted **once**. Forum threads had no dedupe at all, so leaving a thread
-- and tapping it again was a **second view** for the same person in the same
-- sitting. And a song was counted when it *started*, which counted a track
-- somebody skipped out of in three seconds.
--
-- This file gives all of them one engine and one definition:
--
--   * **A visit is thirty minutes.** The same viewer re-opening the same item
--     inside that window is the same visit and adds nothing; after half an hour
--     of silence the next open is a new visit, and counts once. That is what
--     "per visit, one view" means — the window is
--     `content_view_visit_window()`, named in one place so it can be read.
--   * **Every view says whether the visitor was registered or anonymous.**
--     `content_views.viewer_kind` is `registered` when the call carried a
--     session and `guest` when the viewer was identified by their device — which
--     is the question the dashboard could not answer before, because the
--     distinction only existed inside a hash.
--   * **A song is counted when it has been listened to.** Thirty seconds, or
--     half the track if the track is shorter than a minute —
--     `music_valid_seconds()`. The app reports the seconds it *actually played*
--     (position advancing while playing; a seek is not listening), the database
--     decides whether that is a valid play, and the seconds are kept on the
--     view, so "minutes listened" is a measurement rather than plays × runtime.
--
-- The three of them now write the same rows, so one query answers for all of
-- them: `view_overview()` for the dashboard and `view_stats()` for one item.
--
-- Run after 025 (the table) and 029/030/032/034 (the forum). A database that has
-- not run those is told so and left alone: this file needs the table before it
-- can add a column to it, and a SQL function is checked against the tables it
-- names the moment it is created.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. What a view row carries now
-- ---------------------------------------------------------------------------

alter table public.content_views
  add column if not exists viewer_kind text not null default 'guest',
  add column if not exists seconds_listened integer;

-- The forum joins the two it already had: one check, three kinds.
alter table public.content_views drop constraint if exists content_views_content_type_check;
alter table public.content_views
  add constraint content_views_content_type_check
  check (content_type in ('blog', 'music', 'forum'));

alter table public.content_views drop constraint if exists content_views_viewer_kind_check;
alter table public.content_views
  add constraint content_views_viewer_kind_check
  check (viewer_kind in ('registered', 'guest'));

alter table public.content_views drop constraint if exists content_views_seconds_listened_check;
alter table public.content_views
  add constraint content_views_seconds_listened_check
  check (seconds_listened is null or seconds_listened >= 0);

-- Rows written before this migration were keyed by `auth.uid()` for a signed-in
-- reader and by `device:<hash>` for everyone else, so the kind can be read back
-- off the key. This is the only place the default above would be a lie.
update public.content_views
   set viewer_kind = case when viewer_key like 'device:%' then 'guest' else 'registered' end
 where viewer_kind = 'guest'
   and viewer_key not like 'device:%';

-- The visit lookup: (kind, item, viewer) newest first. The 025 index leads with
-- the same three columns, so the window is answered from it.
create index if not exists content_views_visit_idx
  on public.content_views (content_type, content_id, viewer_key, created_at desc);

-- The dashboard's split, per day.
create index if not exists content_views_kind_idx
  on public.content_views (viewer_kind, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. The two rules, in one place each
-- ---------------------------------------------------------------------------

/**
 * How long a visit lasts.
 *
 * The same viewer opening the same item inside this window is still the same
 * visit — a refresh, a rotation, coming back from another screen. Outside it,
 * they have come back, and that is a second visit and a second view.
 */
create or replace function public.content_view_visit_window()
returns interval
language sql
immutable
as $$
  select interval '30 minutes';
$$;

/**
 * How long a song has to be listened to before it is a play.
 *
 * Thirty seconds, or half the track when the track is shorter than a minute — a
 * forty-second piece is a play at twenty. A row with no duration on file asks for
 * the full thirty: an unknown length is not a licence to count a skip.
 */
create or replace function public.music_valid_seconds(p_duration integer)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(p_duration, 0) <= 0 then 30
    else least(30, greatest(1, ceil(p_duration / 2.0)::integer))
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The engine
-- ---------------------------------------------------------------------------

/**
 * Counts one visit of one item, by one viewer, and answers with the new total.
 *
 * `p_type` is `blog`, `music` or `forum`; `p_device_id` is the app's stable
 * install id (never stored — it is hashed into the viewer key); `p_seconds` is
 * how much of a song was *heard* since the last report, which only the music
 * branch reads.
 *
 * A visitor is `registered` when the call carried a session, and `guest`
 * otherwise. Both are counted — the same person is one viewer either way, and
 * signing in changes their key from the device to the account, which is the one
 * case where one person can hold two keys.
 *
 * Returns the item's public total, so a caller can show it without a second
 * request. Nothing is inserted for a song that has not been listened to.
 */
create or replace function public.content_view_record(
  p_type text,
  p_id uuid,
  p_device_id text default null,
  p_seconds integer default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text := lower(btrim(coalesce(p_type, '')));
  device text := nullif(btrim(coalesce(p_device_id, '')), '');
  account uuid := auth.uid();
  viewer text;
  visitor text;
  heard integer := greatest(coalesce(p_seconds, 0), 0);
  needed integer := 0;
  duration integer := 0;
  visit_id bigint;
  total bigint;
begin
  -- Seconds are a music column. A caller that sends them for an article or a
  -- thread is ignored rather than allowed to inflate minutes listened.
  if kind <> 'music' then
    heard := 0;
  end if;

  if kind not in ('blog', 'music', 'forum') then
    raise exception 'unknown content type: %', coalesce(p_type, '')
      using errcode = '22023';
  end if;
  if p_id is null then
    raise exception 'a content id is required' using errcode = '22023';
  end if;

  viewer := coalesce(
    account::text,
    'device:' || md5('ningshingche:view:' || coalesce(device, 'anonymous'))
  );
  visitor := case when account is null then 'guest' else 'registered' end;

  -- The newest counted view of this item by this viewer, if it is still the same
  -- visit.
  select v.id into visit_id
    from public.content_views v
   where v.content_type = kind
     and v.content_id = p_id
     and v.viewer_key = viewer
     and v.created_at > timezone('utc', now()) - public.content_view_visit_window()
   order by v.created_at desc
   limit 1;

  if visit_id is not null then
    -- The same visit: no new view, but listening keeps adding up, so a reader who
    -- plays a song through twice inside one sitting reports twice and is counted
    -- once, with both halves of the listening in the total.
    if kind = 'music' and heard > 0 then
      update public.content_views
         set seconds_listened = coalesce(seconds_listened, 0) + heard
       where id = visit_id;
    end if;
  else
    if kind = 'music' then
      select coalesce(m.duration_seconds, 0) into duration
        from public.music_tracks m
       where m.id = p_id;
      needed := public.music_valid_seconds(duration);
    end if;

    -- A new visit — and for a song, only if it was listened to.
    if kind <> 'music' or heard >= needed then
      insert into public.content_views (content_type, content_id, viewer_key, viewer_kind, seconds_listened)
      values (
        kind,
        p_id,
        viewer,
        visitor,
        case when kind = 'music' then heard else null end
      );
    end if;
  end if;

  if kind = 'blog' then
    select b.views_count into total from public.blogs b where b.id = p_id;
  elsif kind = 'music' then
    select m.views_count into total from public.music_tracks m where m.id = p_id;
  else
    select d.views_count into total from public.forum_discussions d where d.id = p_id;
  end if;

  return coalesce(total, 0);
end;
$$;

revoke all on function public.content_view_record(text, uuid, text, integer) from public;
grant execute on function public.content_view_record(text, uuid, text, integer) to anon, authenticated;

-- The 025 entry point stays, because an installed app still calls it. It now
-- routes through the engine, so a view it records is the same kind of view as
-- any other — and a song it reports carries no seconds, so it cannot mint a play
-- that was never listened to (the music branch needs `p_seconds`).
create or replace function public.record_content_view(
  p_type text,
  p_id uuid,
  p_device_id text default null
)
returns bigint
language sql
security definer
set search_path = public
as $$
  select public.content_view_record(p_type, p_id, p_device_id, null);
$$;

revoke all on function public.record_content_view(text, uuid, text) from public;
grant execute on function public.record_content_view(text, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The totals follow the rows — forum included
-- ---------------------------------------------------------------------------
--
-- Same ±1 shape as 025, which is also what keeps the counts that predate this
-- migration: the forum's existing views are a number in a column, not rows in the
-- table, and a delta leaves that number alone instead of resetting it. (The app's
-- own forum counts were 85 across four threads when this was written.)

create or replace function public.content_views_sync_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
  target uuid;
  delta integer;
begin
  -- Whichever record the operation actually has: NEW is unassigned in a delete,
  -- so the two cases are read separately rather than coalesced.
  if tg_op = 'DELETE' then
    kind := old.content_type;
    target := old.content_id;
    delta := -1;
  else
    kind := new.content_type;
    target := new.content_id;
    delta := 1;
  end if;

  if kind = 'blog' then
    update public.blogs
      set views_count = greatest(coalesce(views_count, 0) + delta, 0)
      where id = target;
  elsif kind = 'music' then
    update public.music_tracks
      set views_count = greatest(coalesce(views_count, 0) + delta, 0)
      where id = target;
  elsif kind = 'forum' then
    update public.forum_discussions
      set views_count = greatest(coalesce(views_count, 0) + delta, 0)
      where id = target;
  end if;

  -- AFTER trigger: the return value is ignored, and reading NEW here would be
  -- the unassigned record again on a delete.
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reading it back
-- ---------------------------------------------------------------------------

/**
 * One item's numbers: how many visits, how many different people, how many of
 * them were signed in, and how long the songs were listened to.
 *
 * `visitors` is the count of distinct viewer keys — the answer to "how many
 * people", where `views` is the answer to "how many visits". One reader who came
 * back three times is one visitor and three views.
 */
create or replace function public.view_stats(p_type text, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'views', count(*),
    'visitors', count(distinct v.viewer_key),
    'registered', count(*) filter (where v.viewer_kind = 'registered'),
    'guest', count(*) filter (where v.viewer_kind = 'guest'),
    'minutes_listened', (coalesce(sum(v.seconds_listened), 0) / 60)::bigint
  )
  from public.content_views v
  where v.content_type = lower(btrim(coalesce(p_type, '')))
    and v.content_id = p_id;
$$;

revoke all on function public.view_stats(text, uuid) from public;
grant execute on function public.view_stats(text, uuid) to anon, authenticated;

/**
 * The whole app, day by day: visits, visitors, the registered/guest split, and
 * the minutes listened. Empty days are included, so the chart has a floor to
 * stand on.
 *
 * Aggregate counts only — no per-reader rows leave this function, and
 * `content_views` itself stays closed to every caller.
 */
create or replace function public.view_overview(p_days integer default 30)
returns table (
  day date,
  views bigint,
  visitors bigint,
  registered bigint,
  guest bigint,
  minutes_listened bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with span as (
    select generate_series(
      (timezone('utc', now())::date - (greatest(coalesce(p_days, 30), 1) - 1)),
      timezone('utc', now())::date,
      interval '1 day'
    )::date as day
  )
  select s.day,
         count(v.id)::bigint,
         count(distinct v.viewer_key)::bigint,
         count(v.id) filter (where v.viewer_kind = 'registered')::bigint,
         count(v.id) filter (where v.viewer_kind = 'guest')::bigint,
         (coalesce(sum(v.seconds_listened), 0) / 60)::bigint
  from span s
  left join public.content_views v
    on (v.created_at at time zone 'utc')::date = s.day
  group by s.day
  order by s.day;
$$;

revoke all on function public.view_overview(integer) from public;
grant execute on function public.view_overview(integer) to anon, authenticated;

/**
 * The window in one line, for the dashboard's panel.
 *
 * `visitors` is a distinct count across the whole window — a reader who came back
 * on four days is one visitor and four visits, which is not what adding up the
 * days would say. The daily rows are [view_overview]'s job, for the chart.
 */
create or replace function public.view_summary(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'days', greatest(coalesce(p_days, 30), 1),
    'views', count(*),
    'visitors', count(distinct v.viewer_key),
    'registered_views', count(*) filter (where v.viewer_kind = 'registered'),
    'guest_views', count(*) filter (where v.viewer_kind = 'guest'),
    'registered_visitors', count(distinct v.viewer_key) filter (where v.viewer_kind = 'registered'),
    'guest_visitors', count(distinct v.viewer_key) filter (where v.viewer_kind = 'guest'),
    'minutes_listened', (coalesce(sum(v.seconds_listened), 0) / 60)::bigint
  )
  from public.content_views v
  where v.created_at > timezone('utc', now())
        - make_interval(days => greatest(coalesce(p_days, 30), 1));
$$;

revoke all on function public.view_summary(integer) from public;
grant execute on function public.view_summary(integer) to anon, authenticated;

-- The reader's own chart gains the same two columns. A table function's shape is
-- a promise, so the old one is dropped before the new one is created — and this
-- is additive at the end, which is what the app expects.
drop function if exists public.user_view_series(uuid, integer);

create or replace function public.user_view_series(
  p_user_id uuid,
  p_days integer default 30
)
returns table (day date, views bigint, visitors bigint, minutes_listened bigint)
language sql
stable
security definer
set search_path = public
as $$
  with span as (
    select generate_series(
      (timezone('utc', now())::date - (greatest(coalesce(p_days, 30), 1) - 1)),
      timezone('utc', now())::date,
      interval '1 day'
    )::date as day
  )
  select s.day,
         count(v.id)::bigint,
         count(distinct v.viewer_key)::bigint,
         (coalesce(sum(v.seconds_listened), 0) / 60)::bigint
  from span s
  left join public.content_views v
    on (v.created_at at time zone 'utc')::date = s.day
   and (
     (v.content_type = 'music' and exists (
        select 1 from public.music_tracks t
        where t.id = v.content_id and t.user_id = p_user_id))
     or
     (v.content_type = 'blog' and exists (
        select 1 from public.submitted_blogs sb
        where sb.converted_blog_id = v.content_id and sb.user_id = p_user_id))
     or
     (v.content_type = 'forum' and exists (
        select 1 from public.forum_discussions d
        where d.id = v.content_id and d.user_id = p_user_id))
   )
  group by s.day
  order by s.day;
$$;

revoke all on function public.user_view_series(uuid, integer) from public;
grant execute on function public.user_view_series(uuid, integer) to anon, authenticated;

/**
 * The writer's own totals.
 *
 * The three view counts are the item rows' own `views_count` — the same numbers
 * the dashboard lists — so this function and the CMS cannot disagree. The split
 * and the listening time are measured from the views themselves, which is the
 * only place the method (registered, guest, one per visit) is known.
 */
create or replace function public.user_view_totals(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    -- Everything this reader published: the blogs their submissions became, the
    -- songs they uploaded, the threads they started.
    select b.id from public.blogs b
     where exists (
       select 1 from public.submitted_blogs sb
        where sb.converted_blog_id = b.id and sb.user_id = p_user_id)
    union all
    select t.id from public.music_tracks t where t.user_id = p_user_id
    union all
    select d.id from public.forum_discussions d where d.user_id = p_user_id
  ),
  counted as (
    select v.content_id,
           count(*) filter (where v.viewer_kind = 'registered') as registered,
           count(*) filter (where v.viewer_kind = 'guest') as guest,
           coalesce(sum(v.seconds_listened), 0) as seconds_listened
      from public.content_views v
     group by v.content_id
  )
  select jsonb_build_object(
    -- The item rows' own totals, which is what the dashboard lists beside them.
    'article_views', (
      select coalesce(sum(b.views_count), 0) from public.blogs b
       where exists (
         select 1 from public.submitted_blogs sb
          where sb.converted_blog_id = b.id and sb.user_id = p_user_id)),
    'music_views', (
      select coalesce(sum(t.views_count), 0) from public.music_tracks t
       where t.user_id = p_user_id),
    'forum_views', (
      select coalesce(sum(d.views_count), 0) from public.forum_discussions d
       where d.user_id = p_user_id),
    -- …and the split and the listening, which only the views themselves know.
    'visitors', (
      select count(distinct v.viewer_key) from public.content_views v
       where v.content_id in (select id from mine)),
    'registered_views', (
      select coalesce(sum(c.registered), 0) from counted c
       where c.content_id in (select id from mine)),
    'guest_views', (
      select coalesce(sum(c.guest), 0) from counted c
       where c.content_id in (select id from mine)),
    -- Cast on purpose: `sum` of a bigint is numeric, and numeric division would
    -- answer 1.83 where the app reads a whole number of minutes.
    'minutes_listened', (
      select (coalesce(sum(c.seconds_listened), 0) / 60)::bigint from counted c
       where c.content_id in (select id from mine))
  );
$$;

revoke all on function public.user_view_totals(uuid) from public;
grant execute on function public.user_view_totals(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The forum counts through the same engine
-- ---------------------------------------------------------------------------
--
-- 034's function, with one statement changed: opening a thread records a view
-- through `content_view_record` instead of adding one to the column, so a forum
-- view is now deduped per visit and carries the registered/guest kind like the
-- other two. The rest of the body — the answers, the reactions, the device-keyed
-- "is_mine" — is 034's, copied whole rather than retyped.

do $forum_view_engine$
declare
  ready boolean;
begin
  -- The body below is 034's, and 034 reads `is_official`, which 032 adds — so a
  -- database that has run the forum but not the editorial migration is told so
  -- rather than given a thread reader that fails the moment a reader opens one.
  select to_regclass('public.forum_discussions') is not null
     and to_regclass('public.forum_replies') is not null
     and to_regclass('public.content_views') is not null
     and exists (
       select 1 from pg_attribute a
        where a.attrelid = 'public.forum_replies'::regclass
          and a.attname = 'is_official'
          and not a.attisdropped
     )
    into ready;

  if not ready then
    raise notice '036_view_logic.sql needs 025_content_views.sql, 029_forum.sql, 030_forum_answers.sql, 032_forum_editorial.sql and 034_forum_reply_edit.sql first; the forum half is skipped.';
    return;
  end if;

  execute $fn_discussion$
    create or replace function public.forum_discussion(
      p_id uuid,
      p_count_view boolean default true,
      p_device_id text default null
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      row_data jsonb;
      key text := '';
      device text := nullif(btrim(coalesce(p_device_id, '')), '');
    begin
      if p_count_view then
        -- One view per visit, registered or anonymous: the engine this file adds
        -- decides. The total on the discussion row is kept by the content_views
        -- trigger, so the row returned below already carries the new number.
        perform public.content_view_record('forum', p_id, device, null);
      end if;

      select to_jsonb(v) into row_data
        from public.forum_discussion_rows v
       where v.id = p_id;

      if row_data is null then
        return null;
      end if;

      -- Who is asking: the reader's own id, or a device id long enough to be one.
      -- Anyone else simply has no reaction of their own in this thread.
      if auth.uid() is not null then
        key := auth.uid()::text;
      elsif length(coalesce(device, '')) >= 8 then
        key := md5('ningshingche-forum:' || device);
      end if;

      return jsonb_build_object(
        'discussion', row_data,
        'replies', coalesce((
          select jsonb_agg(to_jsonb(r) order by r.created_at)
          from (
            select v.id,
                   v.discussion_id,
                   v.parent_id,
                   v.author_id,
                   v.author_name,
                   v.author_avatar_url,
                   v.body,
                   v.created_at,
                   v.like_count,
                   v.dislike_count,
                   v.agree_count,
                   -- The two words this file exists for, appended after everything
                   -- 030 and 032 read by name.
                   v.is_official,
                   (v.author_id is not null and v.author_id = auth.uid()) as is_mine,
                   coalesce((select x.kind from public.forum_reactions x
                              where x.reply_id = v.id and x.reactor_key = key), '') as my_reaction
              from public.forum_reply_rows v
             where v.discussion_id = p_id and v.status = 'Publish'
             order by v.created_at
             limit 300
          ) r
        ), '[]'::jsonb)
      );
    end;
    $body$
  $fn_discussion$;

  execute 'grant execute on function public.forum_discussion(uuid, boolean, text) to anon, authenticated';
end;
$forum_view_engine$;

commit;

-- App side:
--   PortalRepository.recordArticleView(id)      → rpc/content_view_record {p_type: blog}
--   PortalRepository.recordMusicListen(id, sec) → the same, with p_seconds, fired
--                                                 when the valid-listen threshold
--                                                 is crossed and every minute after
--   forumDiscussion(id, countView)              → counts through the engine as before
--   userViewTotals(userId) / userViewSeries(…)  → the writer's own numbers, with visitors
-- Dashboard side:
--   NC.api.rpc('view_overview', { p_days: 30 }) → the Readers panel on Analytics
