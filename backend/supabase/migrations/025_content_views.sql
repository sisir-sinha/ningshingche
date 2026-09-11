-- View counting for articles and songs, and the dashboard's views-over-time.
--
-- A running total alone cannot draw a graph, so the counter is derived from
-- events: every view is one row in `content_views`, a trigger keeps the total on
-- the item, and the series for the dashboard comes from the same rows.
--
-- The write is an RPC for the same reason the love react is (migration 022): the
-- table itself stays closed, and the function is what a guest is allowed to
-- call. A signed-in reader is counted by `auth.uid()`; a guest by a stable
-- pseudonymous id derived from the device id — the device id itself is never
-- stored, and neither party is countable more than once per item per day.
--
-- Run this in the Supabase SQL Editor. Until it is run the app simply reports no
-- views: nothing else depends on the table.

begin;

-- 1. Totals on the items -----------------------------------------------------

alter table public.blogs
  add column if not exists views_count bigint not null default 0;

alter table public.music_tracks
  add column if not exists views_count bigint not null default 0;

-- 2. The events --------------------------------------------------------------

create table if not exists public.content_views (
  id bigserial primary key,
  content_type text not null check (content_type in ('blog', 'music')),
  content_id uuid not null,
  viewer_key text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists content_views_item_day_idx
  on public.content_views (content_type, content_id, viewer_key, created_at desc);

create index if not exists content_views_created_idx
  on public.content_views (created_at desc);

create index if not exists content_views_content_idx
  on public.content_views (content_type, content_id);

-- No grants and no policies: only the security-definer functions below touch
-- this table, and the dashboard reads aggregates, never the rows.
alter table public.content_views enable row level security;

-- 3. Totals follow the events ------------------------------------------------

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
  end if;

  -- AFTER trigger: the return value is ignored, and reading NEW here would be
  -- the unassigned record again on a delete.
  return null;
end;
$$;

drop trigger if exists content_views_sync_count on public.content_views;
create trigger content_views_sync_count
after insert or delete on public.content_views
for each row execute function public.content_views_sync_count();

-- 4. Recording a view --------------------------------------------------------
--
-- Returns the item's total, so the caller can show it without a second request.
-- One row per viewer per item per 20 hours: a reader who reopens the same
-- article, or replays the same song, does not inflate the count.

create or replace function public.record_content_view(
  p_type text,
  p_id uuid,
  p_device_id text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text := lower(btrim(coalesce(p_type, '')));
  device text := nullif(btrim(coalesce(p_device_id, '')), '');
  viewer text;
  total bigint;
begin
  if kind not in ('blog', 'music') then
    raise exception 'unknown content type: %', coalesce(p_type, '')
      using errcode = '22023';
  end if;
  if p_id is null then
    raise exception 'a content id is required' using errcode = '22023';
  end if;

  viewer := coalesce(
    auth.uid()::text,
    'device:' || md5('ningshingche:view:' || coalesce(device, 'anonymous'))
  );

  if not exists (
    select 1 from public.content_views v
    where v.content_type = kind
      and v.content_id = p_id
      and v.viewer_key = viewer
      and v.created_at > timezone('utc', now()) - interval '20 hours'
  ) then
    insert into public.content_views (content_type, content_id, viewer_key)
    values (kind, p_id, viewer);
  end if;

  if kind = 'blog' then
    select views_count into total from public.blogs where id = p_id;
  else
    select views_count into total from public.music_tracks where id = p_id;
  end if;

  return coalesce(total, 0);
end;
$$;

grant execute on function public.record_content_view(text, uuid, text) to anon, authenticated;

-- 5. The reader's own numbers ------------------------------------------------
--
-- A user's articles are the published blogs their submissions were converted
-- into; their songs are the tracks they uploaded. Nothing else is counted.

create or replace function public.user_view_totals(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'article_views', coalesce((
      select sum(b.views_count)
      from public.submitted_blogs s
      join public.blogs b on b.id = s.converted_blog_id
      where s.user_id = p_user_id
    ), 0),
    'music_views', coalesce((
      select sum(t.views_count) from public.music_tracks t where t.user_id = p_user_id
    ), 0)
  );
$$;

grant execute on function public.user_view_totals(uuid) to anon, authenticated;

-- Daily views for the last p_days days, one row per day including the empty
-- ones, so the chart has a continuous axis. Days are UTC, matching
-- `content_views.created_at`.

create or replace function public.user_view_series(
  p_user_id uuid,
  p_days integer default 30
)
returns table (day date, views bigint)
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
         count(v.id)::bigint as views
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
   )
  group by s.day
  order by s.day;
$$;

grant execute on function public.user_view_series(uuid, integer) to anon, authenticated;

commit;

-- App side: PortalRepository.recordArticleView(id) fires when an article opens,
-- recordMusicView(id) when a track starts, both returning the new total;
-- viewTotals(userId) feeds the dashboard's ভিউ counter and viewSeries(userId)
-- draws the views-over-time chart.
