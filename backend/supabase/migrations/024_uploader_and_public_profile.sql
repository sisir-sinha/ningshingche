-- Who uploaded a song, and a public page for every registered user.
--
-- Two things the owner asked for: a track should name the registered user who
-- uploaded it, and that user should have a page anyone can open to see their
-- songs and their published writing.
--
-- Both need columns/tables the publishable key cannot create, so run this in
-- the Supabase SQL Editor (the app degrades gracefully until it is run: the
-- uploader line is simply empty and the public page reports that it is
-- unavailable).
--
-- Why an RPC for the page instead of letting the app read the rows:
--   * `profiles` is select-own (migration 005), so one reader cannot read
--     another's name or avatar.
--   * `submitted_blogs` is select-own too (migration 006), and the row carries
--     the writer's email, phone and address — none of which belongs on a public
--     page.
-- The function below reads both as the definer and returns only the safe
-- fields, only for content that is actually published.

begin;

-- 1. The uploader, denormalised onto the track -------------------------------

alter table public.music_tracks
  add column if not exists uploader_name text not null default '';

create index if not exists music_tracks_user_id_idx
  on public.music_tracks (user_id);

-- Existing uploads already carry `user_id` (migration 018), so the name can be
-- filled in from the profile that owns them. Rows with no owner stay blank.
update public.music_tracks t
  set uploader_name = coalesce(p.name, '')
  from public.profiles p
  where t.user_id = p.id
    and coalesce(t.uploader_name, '') = '';

-- 2. One public page per registered user -------------------------------------
--
-- Returns a jsonb document, so the app opens the page with a single request:
--
--   {
--     "id": uuid, "name": text, "avatar_url": text, "joined_at": timestamptz,
--     "article_views": bigint, "music_views": bigint,
--     "articles": [ { id, title, slug, thumbnail, views_count, published_date,
--                     created_at, category_title } ],
--     "songs": [ { id, title, artist, album, genre, thumbnail_url, audio_url,
--                  duration_seconds, love_count, views_count, created_at } ]
--   }
--
-- `null` when the id is not a registered user.

create or replace function public.public_profile(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id,
    'name', coalesce(nullif(btrim(p.name), ''), 'নিংশিং চে পাঠক'),
    'avatar_url', coalesce(p.avatar_url, ''),
    'joined_at', p.created_at,
    'article_views', coalesce((
      select sum(b.views_count)
      from public.submitted_blogs s
      join public.blogs b on b.id = s.converted_blog_id
      where s.user_id = p.id and b.status = any (array['Publish', 'Published'])
    ), 0),
    'music_views', coalesce((
      select sum(t.views_count) from public.music_tracks t where t.user_id = p.id
    ), 0),
    'articles', coalesce((
      select jsonb_agg(row_to_json(a)::jsonb)
      from (
        select b.id,
               b.title,
               b.slug,
               b.thumbnail,
               b.views_count,
               b.published_date,
               b.created_at,
               b.category_title
        from public.submitted_blogs s
        join public.blogs b on b.id = s.converted_blog_id
        where s.user_id = p.id
          and b.status = any (array['Publish', 'Published'])
        order by coalesce(b.published_date::timestamptz, b.created_at) desc
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
        where t.user_id = p.id
        order by t.created_at desc
        limit 120
      ) m
    ), '[]'::jsonb)
  ) end
  from (select id, name, avatar_url, created_at from public.profiles where id = p_user_id) p;
$$;

grant execute on function public.public_profile(uuid) to anon, authenticated;

commit;

-- App side: PortalRepository.publicProfile(userId) → PublicProfile; the player's
-- credit line shows `Uploader: <name>` ahead of the singer, and the uploader's
-- name in a song row opens `ReaderRoute.publicProfile(userId)`.
