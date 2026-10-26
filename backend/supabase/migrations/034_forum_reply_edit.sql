-- ============================================================================
-- 034_forum_reply_edit.sql
-- An answer is the reader's own: editing it, and taking it back.
--
-- The owner's newest corrections are half a page of layout and two sentences of
-- behaviour: a reader may change or remove **their own** answer in the app, by a
-- long press, and an answer the dashboard wrote is marked as the admin's. Both
-- halves need the database to say one extra word about every answer, which is
-- what this file adds.
--
-- `forum_reply_rows` has carried `is_official` since 032 (the dashboard's own
-- signature). What it has never carried is `is_mine` — whether the reader asking
-- is the one who wrote it — because until now the app had nothing to do with the
-- answer. A long press needs it: the two actions belong to the author and to
-- nobody else, and the app must know that before it offers them, not after the
-- database refuses.
--
-- Run after 029_forum.sql, 030_forum_answers.sql and 032_forum_editorial.sql.
-- A database that has not run them is told so and left alone.
-- ============================================================================

begin;

do $forum_reply_edit$
declare
  ready boolean;
begin
  -- Everything here needs 032's columns as well as 029's table: `is_official` is
  -- what the app's badge reads, and a database that has run 029 but not 032 is
  -- told so rather than half-changed.
  select to_regclass('public.forum_replies') is not null
     and to_regclass('public.forum_reply_rows') is not null
     and exists (
       select 1 from pg_attribute a
        where a.attrelid = 'public.forum_replies'::regclass
          and a.attname = 'is_official'
          and not a.attisdropped
     )
    into ready;

  if not ready then
    raise notice '034_forum_reply_edit.sql needs 029_forum.sql, 030_forum_answers.sql and 032_forum_editorial.sql first; nothing to do.';
    return;
  end if;

  -- --------------------------------------------------------------------------
  -- 1. The answers the app reads, with the two words appended
  -- --------------------------------------------------------------------------
  --
  -- The shape is unchanged: the same columns in the same order, with
  -- `is_official` and `is_mine` at the end of each reply. A function whose shape
  -- is a promise may only grow at the end, and the app reads it by name — so
  -- this is the same body 030 and 032 built, plus two columns.
  --
  -- `is_mine` is `(author_id is not null and author_id = auth.uid())` and not a
  -- bare `=`: an editorial answer has no reader behind it, and `null = null` is
  -- null, which is not true. A reader is never handed a row that says it is
  -- theirs when it is nobody's.
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
        update public.forum_discussions d
           set views_count = d.views_count + 1
         where d.id = p_id and d.status = 'Publish';
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

  execute $fn_reply$
    create or replace function public.forum_reply(
      p_id uuid,
      p_body text,
      p_parent_id uuid default null,
      p_device_id text default null
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      thread public.forum_discussions%rowtype;
      parent public.forum_replies%rowtype;
      clean_body text := btrim(coalesce(p_body, ''));
      root uuid;
      reply_id uuid;
      key text := '';
      device text := nullif(btrim(coalesce(p_device_id, '')), '');
    begin
      if auth.uid() is null then
        raise exception 'a reply needs a signed-in reader'
          using errcode = '42501';
      end if;

      select * into thread from public.forum_discussions d where d.id = p_id;

      if thread.id is null or thread.status <> 'Publish' then
        raise exception 'no such discussion' using errcode = '22023';
      end if;

      if p_parent_id is not null then
        select * into parent from public.forum_replies r where r.id = p_parent_id;
        if parent.id is null
           or parent.discussion_id <> p_id
           or parent.status <> 'Publish' then
          raise exception 'no such reply to answer' using errcode = '22023';
        end if;
        -- An answer's answer belongs to the answer, not to the remark it was typed
        -- under: indentation stops at one step.
        root := coalesce(parent.parent_id, parent.id);
      end if;

      -- And so is an answer, for the same reason.
      if public.forum_text_units(public.forum_plain_text(clean_body)) < 1
         or char_length(public.forum_plain_text(clean_body)) > 4000 then
        raise exception 'a reply is at least 1 character (and at most 4000)'
          using errcode = '22023';
      end if;

      insert into public.forum_replies (discussion_id, user_id, body, parent_id)
      values (p_id, auth.uid(), clean_body, root)
      returning id into reply_id;

      if auth.uid() is not null then
        key := auth.uid()::text;
      elsif length(coalesce(device, '')) >= 8 then
        key := md5('ningshingche-forum:' || device);
      end if;

      return (
        select to_jsonb(r)
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
                 v.is_official,
                 (v.author_id is not null and v.author_id = auth.uid()) as is_mine,
                 coalesce((select x.kind from public.forum_reactions x
                            where x.reply_id = v.id and x.reactor_key = key), '') as my_reaction
            from public.forum_reply_rows v
           where v.id = reply_id
        ) r
      );
    end;
    $body$
  $fn_reply$;

  -- --------------------------------------------------------------------------
  -- 2. Changing an answer
  -- --------------------------------------------------------------------------
  --
  -- The words, and only the words.
  -- `author_name` and `is_official` are not touched here: 032's guard trigger
  -- enforces it even for a direct PostgREST update, so a reader cannot sign their
  -- answer with someone else's name, or award themselves the official badge, by
  -- going around this function.
  --
  -- The length and content rules are the ones writing an answer has always had,
  -- measured on the *words* rather than the markup: an answer holding one picture
  -- and no sentence is not an answer.
  execute $edit$
    create or replace function public.forum_edit_reply(
      p_id uuid,
      p_body text
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      reply public.forum_replies%rowtype;
      clean_body text := btrim(coalesce(p_body, ''));
      key text := '';
    begin
      if auth.uid() is null then
        raise exception 'editing an answer needs a signed-in reader'
          using errcode = '42501';
      end if;

      select * into reply from public.forum_replies r where r.id = p_id;

      if reply.id is null or reply.status <> 'Publish' then
        raise exception 'no such answer' using errcode = '22023';
      end if;

      -- The author, and only the author. A reader cannot edit an editorial answer
      -- (`user_id` is null) or anybody else's, and the dashboard's own moderation
      -- does not come through here — it has PostgREST and its policies for that.
      if reply.user_id is null or reply.user_id <> auth.uid() then
        raise exception 'an answer is edited by the reader who wrote it'
          using errcode = '42501';
      end if;

      if public.forum_text_units(public.forum_plain_text(clean_body)) < 1
         or char_length(public.forum_plain_text(clean_body)) > 4000 then
        raise exception 'a reply is at least 1 character (and at most 4000)'
          using errcode = '22023';
      end if;

      update public.forum_replies r
         set body = clean_body
       where r.id = p_id;

      key := auth.uid()::text;

      return (
        select to_jsonb(r)
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
                 v.is_official,
                 (v.author_id is not null and v.author_id = auth.uid()) as is_mine,
                 coalesce((select x.kind from public.forum_reactions x
                            where x.reply_id = v.id and x.reactor_key = key), '') as my_reaction
            from public.forum_reply_rows v
           where v.id = p_id
        ) r
      );
    end;
    $body$
  $edit$;

  -- --------------------------------------------------------------------------
  -- 3. Taking an answer back
  -- --------------------------------------------------------------------------
  --
  -- `status = 'Removed'`, never a `delete`: the row stays, the dashboard can
  -- still see what was there, and the author's own id keeps its history. The
  -- answers written under it are handed to the answer it answered, which is the
  -- one indent level the thread draws — so a reader who takes their answer back
  -- takes their own words away and nobody else's, and the argument under it does
  -- not fall into a hole.
  --
  -- The reply counter is a column (`replies_count`) kept by a trigger, so it
  -- settles by itself when the status changes; the app re-reads the thread after
  -- a delete and gets the settled number.
  execute $delete$
    create or replace function public.forum_delete_reply(p_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      reply public.forum_replies%rowtype;
      moved integer := 0;
    begin
      if auth.uid() is null then
        raise exception 'removing an answer needs a signed-in reader'
          using errcode = '42501';
      end if;

      select * into reply from public.forum_replies r where r.id = p_id;

      if reply.id is null or reply.status <> 'Publish' then
        raise exception 'no such answer' using errcode = '22023';
      end if;

      if reply.user_id is null or reply.user_id <> auth.uid() then
        raise exception 'an answer is deleted by the reader who wrote it'
          using errcode = '42501';
      end if;

      update public.forum_replies c
         set parent_id = reply.parent_id
       where c.parent_id = reply.id
         and c.status = 'Publish';
      get diagnostics moved = row_count;

      update public.forum_replies r
         set status = 'Removed'
       where r.id = reply.id;

      return jsonb_build_object(
        'id', reply.id,
        'discussion_id', reply.discussion_id,
        'parent_id', reply.parent_id,
        'answers_moved', moved
      );
    end;
    $body$
  $delete$;

  -- --------------------------------------------------------------------------
  -- 4. Who may call what
  -- --------------------------------------------------------------------------
  --
  -- Both functions are the reader's own: signed-in, and only over rows whose
  -- `user_id` is theirs. Nothing is granted to `anon` — a guest is not offered
  -- the long press at all, and the database refuses it anyway.
  execute 'grant execute on function public.forum_edit_reply(uuid, text) to authenticated';
  execute 'grant execute on function public.forum_delete_reply(uuid) to authenticated';
  execute 'revoke execute on function public.forum_edit_reply(uuid, text) from anon';
  execute 'revoke execute on function public.forum_delete_reply(uuid) from anon';

  -- The read functions keep the grants 029 and 030 gave them: this file only
  -- replaced their bodies.
  execute 'grant execute on function public.forum_discussion(uuid, boolean, text) to anon, authenticated';
  execute 'grant execute on function public.forum_reply(uuid, text, uuid, text) to authenticated';
end
$forum_reply_edit$;

-- 5. RLS, restated for the table this file writes -------------------------------

do $forum_reply_edit_rls$
begin
  if to_regclass('public.forum_replies') is not null then
    execute 'alter table public.forum_replies enable row level security';
  end if;
end
$forum_reply_edit_rls$;

commit;
