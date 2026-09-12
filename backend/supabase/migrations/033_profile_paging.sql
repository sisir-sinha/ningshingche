-- Public profile paging: five items at a time, from the database.
-- Run in the Supabase SQL Editor after 024 and 028.
--
-- The public profile used to arrive whole: `public_profile` (024, reworked by
-- 028) answers with the reader, their points and their view totals *and* both
-- lists in one payload, capped at 60 articles and 120 songs. That is a page a
-- reader opens once and reads from the top; it is the wrong shape for the tab
-- they scroll, and it cannot say "these five, then five more".
--
-- So the lists get their own door, and the counters stay on the profile:
--
--   * `profile_items(user, kind, limit, offset)` answers with one page of one
--     kind — `articles`, `songs`, `threads`, `answers` — and the **total** for
--     that kind, so a screen can show "৫" beside a tab and a button under it
--     without counting what it has not loaded;
--   * `kind = 'counts'` answers with the four totals and no items, which is the
--     one call the page needs before it draws its tabs.
--
-- The order is the page's promise, and it is the same order 028 set: most read
-- first, the date only as a tie-break, for work; newest first for a reader's
-- forum threads and answers, because a profile's আলোচনা tab is read as a diary.
--
-- Nothing here is readable that 024/028 did not already hand out: the same
-- columns, the same published-only filters, the same `security definer` door.

begin;

create or replace function public.profile_items(
  p_user_id uuid,
  p_kind text,
  p_limit integer default 5,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  kind text := lower(btrim(coalesce(p_kind, '')));
  span integer := greatest(least(coalesce(p_limit, 5), 50), 1);
  skip integer := greatest(coalesce(p_offset, 0), 0);
  total integer := 0;
  page jsonb := '[]'::jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('kind', kind, 'total', 0, 'items', '[]'::jsonb);
  end if;

  -- One call for the tabs: four totals, nothing loaded to count them.
  if kind = 'counts' then
    return jsonb_build_object(
      'kind', 'counts',
      'total', 0,
      'items', '[]'::jsonb,
      'totals', jsonb_build_object(
        'articles', (
          select count(*)
            from public.submitted_blogs s
            join public.blogs b on b.id = s.converted_blog_id
           where s.user_id = p_user_id and b.status = any (array['Publish', 'Published'])
        ),
        'songs', (
          select count(*) from public.music_tracks t where t.user_id = p_user_id
        ),
        'threads', case when to_regclass('public.forum_discussions') is null then 0 else (
          select count(*) from public.forum_discussions d
           where d.user_id = p_user_id and d.status = 'Publish'
        ) end,
        'answers', case when to_regclass('public.forum_replies') is null then 0 else (
          select count(*) from public.forum_replies r
           where r.user_id = p_user_id and r.status = 'Publish'
        ) end
      )
    );
  end if;

  -- Articles: their submissions that became published blogs. `image` is what
  -- the column is; `thumbnail` answers the same thing under the name the app
  -- reads, so a page written against either one draws the picture.
  if kind = 'articles' then
    select count(*) into total
      from public.submitted_blogs s
      join public.blogs b on b.id = s.converted_blog_id
     where s.user_id = p_user_id and b.status = any (array['Publish', 'Published']);

    select coalesce(jsonb_agg(row_to_json(a)::jsonb), '[]'::jsonb) into page
      from (
        select b.id,
               b.title,
               b.slug,
               b.image,
               b.image as thumbnail,
               b.views_count,
               b.published_date,
               b.created_at,
               b.category_title
          from public.submitted_blogs s
          join public.blogs b on b.id = s.converted_blog_id
         where s.user_id = p_user_id
           and b.status = any (array['Publish', 'Published'])
         order by b.views_count desc nulls last,
                  b.published_date desc nulls last,
                  b.created_at desc
         limit span offset skip
      ) a;

  -- Songs: their own uploads, most played first.
  elsif kind = 'songs' then
    select count(*) into total from public.music_tracks t where t.user_id = p_user_id;

    select coalesce(jsonb_agg(row_to_json(m)::jsonb), '[]'::jsonb) into page
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
         where t.user_id = p_user_id
         order by t.views_count desc nulls last, t.created_at desc
         limit span offset skip
      ) m;

  -- Threads: what they opened, newest first. Only if the forum exists — a
  -- database that has not run 029 answers with an empty page instead of an
  -- error, which is what a profile that has simply never been to the forum
  -- looks like anyway.
  elsif kind in ('threads', 'discussions') then
    kind := 'threads';
    if to_regclass('public.forum_discussion_rows') is not null then
      select count(*) into total
        from public.forum_discussion_rows v
       where v.author_id = p_user_id and v.status = 'Publish';

      select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into page
        from (
          select v.id,
                 v.title,
                 v.excerpt,
                 v.category_slug,
                 v.category_title,
                 v.views_count,
                 v.replies_count,
                 v.created_at,
                 v.cover_image_url,
                 v.is_official
            from public.forum_discussion_rows v
           where v.author_id = p_user_id and v.status = 'Publish'
           order by v.created_at desc
           limit span offset skip
        ) x;
    end if;

  -- Answers: the same, one row per answer, with the reactions it earned and the
  -- title of the thread it answers.
  elsif kind in ('answers', 'replies') then
    kind := 'answers';
    if to_regclass('public.forum_reply_rows') is not null
       and to_regclass('public.forum_discussions') is not null then
      select count(*) into total
        from public.forum_reply_rows v
        join public.forum_discussions d on d.id = v.discussion_id
       where v.author_id = p_user_id
         and v.status = 'Publish'
         and d.status = 'Publish';

      select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into page
        from (
          select v.id,
                 v.discussion_id,
                 d.title as discussion_title,
                 left(regexp_replace(v.body, '<[^>]*>', ' ', 'g'), 240) as excerpt,
                 v.body,
                 v.like_count,
                 v.dislike_count,
                 v.agree_count,
                 v.status,
                 v.created_at
            from public.forum_reply_rows v
            join public.forum_discussions d on d.id = v.discussion_id
           where v.author_id = p_user_id
             and v.status = 'Publish'
             and d.status = 'Publish'
           order by v.created_at desc
           limit span offset skip
        ) x;
    end if;
  else
    raise exception 'a profile page holds articles, songs, threads or answers — not %', coalesce(p_kind, '')
      using errcode = '22023';
  end if;

  return jsonb_build_object('kind', kind, 'total', coalesce(total, 0), 'items', page);
end;
$$;

grant execute on function public.profile_items(uuid, text, integer, integer) to anon, authenticated;

commit;
