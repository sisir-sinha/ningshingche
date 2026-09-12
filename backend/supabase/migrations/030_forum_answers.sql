-- Forum, second pass: what the owner asked for after using it.
--
-- Ten changes, and the database owns all of them:
--
--   1. a discussion can carry a **cover image** (ImgBB, optional);
--   2. a thread can be **authorized** — posted by the NingshingChe admin, which
--      the app offers as a filter. A row inserted through a dashboard session is
--      marked automatically by the trigger in section 6;
--   3. an answer can be **replied to**, one level deep (`parent_id`), and a reply
--      to a reply is folded back onto its own answer so the indentation can never
--      grow a second step;
--   4. answers carry **reactions** — like, dislike, agree — one per reactor per
--      answer, with a long press in the app. Guests may react: the key is the
--      device id, exactly the way `toggle_music_love` (022) keys a guest;
--   5. the forum home's discussion list takes an **order**: recent, popular
--      (most answers, replies counted), or official only;
--   6. a new reply or a new discussion **notifies readers** (section 7) — the
--      same `user_notifications` rows the dashboard's bell already reads, so the
--      app needed no second inbox;
--   7. the answers carry their **reaction counts and the reader's own reaction**,
--      which is what the app's "top answers" filter sorts on;
--   8. `forum_activity(user)` — a reader's own forum work, for their dashboard and
--      their public page;
--   9. **points** include the forum now: a discussion 20, a reply 5, a reaction
--      received 1 (section 8), still all in one place;
--  10. nothing in this file is readable by a client except through the functions.
--
-- **Paste this one last.** It replaces functions 029 wrote and one 026 wrote, so
-- 026 and 029 have to be in first; everything else about the order is free.
-- Section 0 recreates what it reads `if not exists`, so this file also applies
-- to a database that has never seen 026 or 029 — it simply does less there.

begin;

-- 0. What it reads ------------------------------------------------------------
--
-- Three of these tables belong to 029 and two to 026; each is created here as
-- well if it is missing, which is the pattern 026 set for `content_views`. Keep
-- the definitions identical to theirs — a database that has already run those
-- files skips every block below.

create table if not exists public.forum_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  description text not null default '',
  position integer not null default 0,
  is_locked boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists forum_categories_slug_idx
  on public.forum_categories (lower(slug));

create table if not exists public.forum_discussions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.forum_categories (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null default '',
  status text not null default 'Publish',
  views_count bigint not null default 0,
  replies_count integer not null default 0,
  last_reply_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.forum_replies (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.forum_discussions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  status text not null default 'Publish',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.content_views (
  id bigserial primary key,
  content_type text not null check (content_type in ('blog', 'music')),
  content_id uuid not null,
  viewer_key text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.reader_activity (
  user_id uuid not null,
  day date not null default (timezone('utc', now())::date),
  seconds integer not null default 0 check (seconds >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, day)
);

-- 011's column: it decides who hears about a new thread. Added here so this file
-- stands alone; the definition is 011's.
alter table public.profiles
  add column if not exists notifications_enabled boolean not null default true;

-- 007's inbox table. Same reason, same promise: a database that has run 007
-- ignores this. The foreign key to `auth.users` is added only where that table
-- exists — a bare test cluster has no auth schema beyond `auth.uid()`.
do $guard$
begin
  if to_regclass('auth.users') is not null then
    create table if not exists public.user_notifications (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      kind text not null,
      title text not null default '',
      body text not null default '',
      related_id text not null default '',
      is_read boolean not null default false,
      created_at timestamptz not null default timezone('utc', now()),
      unique (user_id, kind, related_id)
    );
  else
    create table if not exists public.user_notifications (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      kind text not null,
      title text not null default '',
      body text not null default '',
      related_id text not null default '',
      is_read boolean not null default false,
      created_at timestamptz not null default timezone('utc', now()),
      unique (user_id, kind, related_id)
    );
  end if;
end;
$guard$;

-- 029's counter, which the write guards use. Identical to 029's definition.
create or replace function public.forum_text_units(p_text text)
returns integer
language sql
immutable
as $$
  select char_length(regexp_replace(coalesce(p_text, ''), E'[\\s\u0981-\u0983\u09BC\u09BE-\u09CD\u09D7\u09E2\u09E3\u09FE\u200C\u200D]', '', 'g'));
$$;

revoke all on function public.forum_text_units(text) from public;

-- And the text inside the markup. The forum's bodies are written in the app's
-- editor, so they arrive as HTML: `<p>হ্যালো</p>` is one word, not fifteen
-- characters, and a post of empty paragraphs is not a post. The length a reader
-- sees beside the field has to be the length the server counts, or the writer
-- loses what they typed to a round trip that told them nothing.
create or replace function public.forum_plain_text(p_text text)
returns text
language sql
immutable
as $$
  select btrim(
    replace(
      replace(
        regexp_replace(coalesce(p_text, ''), '<[^>]*>', ' ', 'g'),
        '&nbsp;', ' '
      ),
      '&amp;', '&'
    )
  );
$$;

revoke all on function public.forum_plain_text(text) from public;

-- 1. The columns this adds ----------------------------------------------------
--
-- The cover image is ImgBB, like every other image the reader uploads: the URL
-- that is shown, and the delete URL that lets the dashboard clean up after it.
-- `is_official` is a row, not a rule the app computes: the app cannot know who
-- is staff, and a filter that asked it to try would be a filter that lies.

alter table public.forum_discussions
  add column if not exists cover_image_url text not null default '',
  add column if not exists cover_delete_url text not null default '',
  add column if not exists is_official boolean not null default false;

-- An answer's answer. Null means the reply stands on its own, which is the
-- overwhelmingly common case.
alter table public.forum_replies
  add column if not exists parent_id uuid;

do $fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'forum_replies_parent_fk') then
    alter table public.forum_replies
      add constraint forum_replies_parent_fk foreign key (parent_id)
      references public.forum_replies(id) on delete set null;
  end if;
end;
$fk$;

create index if not exists forum_replies_parent_idx
  on public.forum_replies (parent_id);

-- The home page's "official" filter reads this one; the popular filter reads
-- `replies_count`, which 029's trigger keeps.
create index if not exists forum_discussions_official_idx
  on public.forum_discussions (is_official, last_reply_at desc nulls last);

-- 2. Reactions ----------------------------------------------------------------
--
-- One row per reactor per answer, three kinds. `reactor_key` is a text because a
-- guest is not a uuid: a signed-in reader keys by their own id, a guest by
-- `md5('ningshingche-forum:' || device_id)` — the same shape 022 uses for a loved
-- song, and for the same reason (a guest's tap must be idempotent and withdrawable).

create table if not exists public.forum_reactions (
  reply_id uuid not null references public.forum_replies(id) on delete cascade,
  reactor_key text not null,
  user_id uuid,
  kind text not null check (kind in ('like', 'dislike', 'agree')),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (reply_id, reactor_key)
);

create index if not exists forum_reactions_reply_idx
  on public.forum_reactions (reply_id, kind);

-- Locked like the rest of the forum: the function below is the only door, and it
-- is the one that decides what a reactor is.
alter table public.forum_reactions enable row level security;

/**
 * Who is reacting. A signed-in reader is their own id; a guest is a device, and a
 * device id too short to be one is refused rather than guessed at.
 */
create or replace function public.forum_reactor_key(p_device_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  identity uuid := auth.uid();
  device text := nullif(btrim(coalesce(p_device_id, '')), '');
begin
  if identity is not null then
    return identity::text;
  end if;
  if length(coalesce(device, '')) < 8 then
    raise exception 'a device id of at least 8 characters is required to react without an account'
      using errcode = '22023';
  end if;
  return md5('ningshingche-forum:' || device);
end;
$$;

/**
 * React, or take the reaction back. Tapping the kind that is already there
 * withdraws it, so the popup has one gesture and no hidden state.
 *
 * Answers with the whole set of counts and the reactor's own choice, which is
 * everything the card has to redraw.
 */
create or replace function public.forum_react(
  p_reply_id uuid,
  p_kind text,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.forum_replies%rowtype;
  key text;
  clean text := lower(btrim(coalesce(p_kind, '')));
  existing text;
begin
  if clean not in ('like', 'dislike', 'agree') then
    raise exception 'a reaction is like, dislike or agree' using errcode = '22023';
  end if;

  select * into target from public.forum_replies r where r.id = p_reply_id;
  if target.id is null or target.status <> 'Publish' then
    raise exception 'no such reply' using errcode = '22023';
  end if;

  key := public.forum_reactor_key(p_device_id);

  select x.kind into existing
    from public.forum_reactions x
   where x.reply_id = p_reply_id and x.reactor_key = key;

  if existing = clean then
    delete from public.forum_reactions x
     where x.reply_id = p_reply_id and x.reactor_key = key;
  else
    insert into public.forum_reactions (reply_id, reactor_key, user_id, kind)
    values (p_reply_id, key, auth.uid(), clean)
    on conflict (reply_id, reactor_key) do update
      set kind = excluded.kind,
          user_id = excluded.user_id,
          created_at = timezone('utc', now());
  end if;

  return (
    select jsonb_build_object(
      'reply_id', p_reply_id,
      'likes', count(*) filter (where x.kind = 'like'),
      'dislikes', count(*) filter (where x.kind = 'dislike'),
      'agrees', count(*) filter (where x.kind = 'agree'),
      'mine', coalesce(max(x.kind) filter (where x.reactor_key = key), '')
    )
    from public.forum_reactions x
    where x.reply_id = p_reply_id
  );
end;
$$;

grant execute on function public.forum_react(uuid, text, text) to anon, authenticated;

-- 3. The shape one answer needs -----------------------------------------------
--
-- One projection, so a thread and a freshly posted reply cannot disagree about
-- what an answer looks like. Reaction counts are sub-selects rather than a join:
-- there are three of them, and the alternative is a lateral join with a group by
-- in every reader of this view.

create or replace view public.forum_reply_rows as
select r.id,
       r.discussion_id,
       r.parent_id,
       r.user_id as author_id,
       coalesce(nullif(btrim(p.name), ''), 'নিংশিং চে পাঠক') as author_name,
       coalesce(p.avatar_url, '') as author_avatar_url,
       r.body,
       r.status,
       r.created_at,
       (select count(*) from public.forum_reactions x
         where x.reply_id = r.id and x.kind = 'like') as like_count,
       (select count(*) from public.forum_reactions x
         where x.reply_id = r.id and x.kind = 'dislike') as dislike_count,
       (select count(*) from public.forum_reactions x
         where x.reply_id = r.id and x.kind = 'agree') as agree_count
  from public.forum_replies r
  left join public.profiles p on p.id = r.user_id;

revoke all on public.forum_reply_rows from anon, authenticated;

-- 4. The card, with everything the second pass added --------------------------

create or replace view public.forum_discussion_rows as
select d.id,
       k.id as category_id,
       k.slug as category_slug,
       k.title as category_title,
       d.title,
       left(regexp_replace(d.body, '<[^>]*>', ' ', 'g'), 240) as excerpt,
       d.body,
       d.user_id as author_id,
       coalesce(nullif(btrim(p.name), ''), 'নিংশিং চে পাঠক') as author_name,
       coalesce(p.avatar_url, '') as author_avatar_url,
       d.status,
       d.views_count,
       d.replies_count,
       d.created_at,
       d.last_reply_at,
       d.updated_at,
       -- Appended, never inserted: `create or replace view` may add a column at
       -- the end and nowhere else, and the four read functions of 029 stay
       -- dependent on this view, so it cannot be dropped and rebuilt either.
       d.cover_image_url,
       d.is_official
  from public.forum_discussions d
  join public.forum_categories k on k.id = d.category_id
  left join public.profiles p on p.id = d.user_id;

revoke all on public.forum_discussion_rows from anon, authenticated;

-- 5. What the app reads -------------------------------------------------------

/**
 * The forum home. `p_order` is what the reader picked in সাম্প্রতিক আলোচনা:
 *
 *   recent    what moved last — a new thread, or a reply to an old one (default)
 *   popular   most answers first; replies are counted, nested ones included
 *   official  only the threads the NingshingChe admin opened
 *
 * An unknown order is treated as `recent` rather than refused: the app is the
 * only caller, and a typo there should show a list, not an error.
 */
-- A new parameter makes a **new function**: `create or replace` cannot change a
-- signature, and leaving 029's one-argument version behind would make
-- `forum_overview(20)` ambiguous — "function is not unique". So the old
-- signatures of the four functions this file rewrites are dropped first, and the
-- grants that went with them are made again at the end of this section.
drop function if exists public.forum_overview(integer);
drop function if exists public.forum_discussion(uuid, boolean);
drop function if exists public.forum_create_discussion(text, text, text);
drop function if exists public.forum_reply(uuid, text);

create or replace function public.forum_overview(
  p_limit integer default 20,
  p_order text default 'recent'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  wanted text := lower(btrim(coalesce(p_order, 'recent')));
  room_limit integer := greatest(least(coalesce(p_limit, 20), 50), 1);
begin
  if wanted not in ('recent', 'popular', 'official') then
    wanted := 'recent';
  end if;

  return (
    select jsonb_build_object(
      'order', wanted,
      'categories', coalesce((
        select jsonb_agg(to_jsonb(c) order by c.position, c.title)
        from (
          select k.id,
                 k.slug,
                 k.title,
                 k.description,
                 k.position,
                 (select count(*) from public.forum_discussions d
                   where d.category_id = k.id and d.status = 'Publish') as discussions,
                 (select count(*) from public.forum_replies r
                    join public.forum_discussions d2 on d2.id = r.discussion_id
                   where d2.category_id = k.id and r.status = 'Publish') as replies
            from public.forum_categories k
        ) c
      ), '[]'::jsonb),
      'latest', coalesce((
        select jsonb_agg(to_jsonb(x))
        from (
          select v.*
            from public.forum_discussion_rows v
           where v.status = 'Publish'
             and (wanted <> 'official' or v.is_official)
           order by
             case when wanted = 'popular' then v.replies_count end desc nulls last,
             case when wanted = 'popular' then v.views_count end desc nulls last,
             coalesce(v.last_reply_at, v.created_at) desc,
             v.created_at desc
           limit room_limit
        ) x
      ), '[]'::jsonb),
      'total_discussions', (
        select count(*) from public.forum_discussions where status = 'Publish'
      ),
      'total_replies', (
        select count(*) from public.forum_replies where status = 'Publish'
      ),
      'official_count', (
        select count(*) from public.forum_discussions
         where status = 'Publish' and is_official
      )
    )
  );
end;
$$;

/**
 * One discussion with its answers.
 *
 * The answers come back **flat**, each with its `parent_id`, and the app nests
 * them: one level of indentation is a rule about reading a thread, and a rule
 * about reading belongs where the reading happens. Each answer carries its
 * reaction counts and — when the caller says who they are — their own reaction,
 * which is what the "top answers" filter sorts on.
 *
 * `p_device_id` is only ever a fallback for a guest; a signed-in reader needs no
 * device, and a guest who does not send one simply has no `mine` to show.
 */
create or replace function public.forum_discussion(
  p_id uuid,
  p_count_view boolean default true,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

/**
 * One reader's forum work — for their dashboard, and for anyone looking at their
 * public page. Public on purpose: the forum itself is public, so the list of what
 * someone wrote in it is too, and hiding it would only make the profile lie.
 *
 * Counts come with it, including the reactions their answers earned, because the
 * page shows numbers and three extra round trips to count them would be silly.
 */
create or replace function public.forum_activity(
  p_user_id uuid,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select p.id from public.profiles p where p.id = p_user_id
  ),
  room as (
    select greatest(least(coalesce(p_limit, 20), 50), 1) as n
  )
  select case when (select count(*) from me) = 0 then null else jsonb_build_object(
    'user_id', p_user_id,
    'counts', jsonb_build_object(
      'discussions', (
        select count(*) from public.forum_discussions d
         where d.user_id = p_user_id and d.status = 'Publish'
      ),
      'replies', (
        select count(*) from public.forum_replies r
         where r.user_id = p_user_id and r.status = 'Publish'
      ),
      'reactions', (
        select count(*) from public.forum_reactions x
          join public.forum_replies r on r.id = x.reply_id
         where r.user_id = p_user_id
           and r.status = 'Publish'
           and x.kind in ('like', 'agree')
      )
    ),
    'discussions', coalesce((
      select jsonb_agg(to_jsonb(d))
      from (
        select v.id,
               v.title,
               v.category_slug,
               v.category_title,
               v.excerpt,
               v.views_count,
               v.replies_count,
               v.last_reply_at,
               v.created_at
          from public.forum_discussion_rows v
         where v.author_id = p_user_id and v.status = 'Publish'
         order by v.created_at desc
         limit (select n from room)
      ) d
    ), '[]'::jsonb),
    'replies', coalesce((
      select jsonb_agg(to_jsonb(r))
      from (
        select x.id,
               x.discussion_id,
               t.title as discussion_title,
               left(regexp_replace(x.body, '<[^>]*>', ' ', 'g'), 240) as excerpt,
               x.like_count,
               x.dislike_count,
               x.agree_count,
               x.created_at
          from public.forum_reply_rows x
          join public.forum_discussions t on t.id = x.discussion_id
         where x.author_id = p_user_id
           and x.status = 'Publish'
           and t.status = 'Publish'
         order by x.created_at desc
         limit (select n from room)
      ) r
    ), '[]'::jsonb)
  ) end;
$$;

grant execute on function public.forum_activity(uuid, integer) to anon, authenticated;

-- 6. Who wrote what, and who is told ------------------------------------------

/**
 * A dashboard insert is an official thread. The column is not taken from the
 * caller: the app cannot grant itself a badge, and the admin should not have to
 * remember to tick one.
 */
create or replace function public.forum_discussions_mark_official()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regprocedure('public.is_dashboard_request()') is not null then
    if public.is_dashboard_request() then
      new.is_official := true;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists forum_discussions_mark_official on public.forum_discussions;
create trigger forum_discussions_mark_official
  before insert on public.forum_discussions
  for each row execute function public.forum_discussions_mark_official();

/**
 * A new thread reaches the readers who asked to be told about one.
 *
 * One row per reader per thread — the unique key is (user, kind, related_id) —
 * and a later reply to that thread re-arms the same row rather than stacking a
 * second one, so the bell counts threads, not noise. The fan-out is capped: a
 * forum with a hundred thousand readers should not turn one post into a hundred
 * thousand rows in a single transaction, and the readers who most recently
 * updated their profile are the honest ones to prefer.
 */
create or replace function public.forum_notify_new_discussion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'Publish' then
    return new;
  end if;

  insert into public.user_notifications (user_id, kind, title, body, related_id)
  select p.id,
         'forum_thread',
         'নতুন আলোচনা: ' || left(new.title, 120),
         left(regexp_replace(new.body, '<[^>]*>', ' ', 'g'), 160),
         new.id::text
    from public.profiles p
   where p.notifications_enabled
     and p.id <> coalesce(new.user_id, '00000000-0000-0000-0000-000000000000'::uuid)
   order by p.created_at desc nulls last
   limit 500
  on conflict (user_id, kind, related_id) do update
     set title = excluded.title,
         body = excluded.body,
         is_read = false,
         created_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists forum_notify_new_discussion on public.forum_discussions;
create trigger forum_notify_new_discussion
  after insert on public.forum_discussions
  for each row execute function public.forum_notify_new_discussion();

/**
 * A reply reaches the people already in the conversation: whoever opened the
 * thread and everyone who has answered in it. Not the person who just answered.
 */
create or replace function public.forum_notify_new_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  thread_title text;
begin
  if new.status <> 'Publish' then
    return new;
  end if;

  select d.title into thread_title
    from public.forum_discussions d
   where d.id = new.discussion_id;

  insert into public.user_notifications (user_id, kind, title, body, related_id)
  select who.id,
         'forum_reply',
         'নতুন উত্তর: ' || left(coalesce(thread_title, ''), 120),
         left(regexp_replace(new.body, '<[^>]*>', ' ', 'g'), 160),
         new.discussion_id::text
    from (
      select d.user_id as id
        from public.forum_discussions d
       where d.id = new.discussion_id and d.user_id is not null
      union
      select r.user_id
        from public.forum_replies r
       where r.discussion_id = new.discussion_id
         and r.status = 'Publish'
         and r.user_id is not null
    ) who
   where who.id <> coalesce(new.user_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and exists (
       select 1 from public.profiles p
        where p.id = who.id and p.notifications_enabled
     )
  on conflict (user_id, kind, related_id) do update
     set title = excluded.title,
         body = excluded.body,
         is_read = false,
         created_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists forum_notify_new_reply on public.forum_replies;
create trigger forum_notify_new_reply
  after insert on public.forum_replies
  for each row execute function public.forum_notify_new_reply();

-- 7. What the app writes ------------------------------------------------------
--
-- Both writes are still signed-in only, and both still raise 42501 for a guest —
-- the code the app already turns into "your session has expired".

/**
 * A new thread, with an optional cover image. The image URL is ImgBB's; a blank
 * one is a thread without a picture, not a broken card. Only http(s) is accepted,
 * because this string ends up in an `<img src>` on every reader's screen.
 */
create or replace function public.forum_create_discussion(
  p_category_slug text,
  p_title text,
  p_body text,
  p_cover_image_url text default '',
  p_cover_delete_url text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  category public.forum_categories%rowtype;
  clean_title text := btrim(coalesce(p_title, ''));
  clean_body text := btrim(coalesce(p_body, ''));
  cover text := btrim(coalesce(p_cover_image_url, ''));
  cover_delete text := btrim(coalesce(p_cover_delete_url, ''));
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'a new discussion needs a signed-in reader'
      using errcode = '42501';
  end if;

  select * into category
    from public.forum_categories k
   where k.slug = btrim(coalesce(p_category_slug, ''));

  if category.id is null then
    raise exception 'no such forum category' using errcode = '22023';
  end if;

  if category.is_locked then
    raise exception 'this forum category is closed' using errcode = '22023';
  end if;

  if public.forum_text_units(clean_title) < 4 or char_length(clean_title) > 160 then
    raise exception 'a discussion title is at least 4 characters (and at most 160)'
      using errcode = '22023';
  end if;

  -- Counted as text, not as markup: see `forum_plain_text`.
  if public.forum_text_units(public.forum_plain_text(clean_body)) < 1
     or char_length(public.forum_plain_text(clean_body)) > 8000 then
    raise exception 'a discussion body is at least 1 character (and at most 8000)'
      using errcode = '22023';
  end if;

  if cover <> '' and (char_length(cover) > 600 or cover !~* '^https?://') then
    raise exception 'a cover image is an http(s) url' using errcode = '22023';
  end if;

  insert into public.forum_discussions
    (category_id, user_id, title, body, cover_image_url, cover_delete_url)
  values
    (category.id, auth.uid(), clean_title, clean_body, cover, cover_delete)
  returning id into new_id;

  return public.forum_discussion(new_id, false, null);
end;
$$;

/**
 * A reply, or an answer to an answer.
 *
 * One level is the rule, and this is where it is enforced: a reply to a reply is
 * attached to the answer the reply belongs to, so the app can indent by exactly
 * one step and never has to work out how deep anything is.
 */
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
as $$
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
             coalesce((select x.kind from public.forum_reactions x
                        where x.reply_id = v.id and x.reactor_key = key), '') as my_reaction
        from public.forum_reply_rows v
       where v.id = reply_id
    ) r
  );
end;
$$;

-- 8. Points -------------------------------------------------------------------
--
-- The forum joins the score, in the one place the weights live. Keeping the two
-- lists apart makes the arithmetic readable and the changes additive: 026's five
-- inputs and weights are untouched, and this is what the forum adds.
--
--   discussion opened   20 points
--   answer written       5 points
--   reaction received    1 point each (like and agree; a dislike is counted and
--                        shown, but it does not subtract — points that can be
--                        taken away by a stranger are points that invite a
--                        stranger to take them)

create or replace function public.contributor_forum_points_from(
  p_discussions integer,
  p_replies integer,
  p_reactions integer
)
returns integer
language sql
immutable
as $$
  select greatest(p_discussions, 0) * 20
       + greatest(p_replies, 0) * 5
       + greatest(p_reactions, 0) * 1;
$$;

/**
 * `contributor_score`, with the forum folded in. The five keys 026 answers with
 * are unchanged — the board, the profile and the dashboard all read them — and
 * three are added, so a screen can show what the forum contributed.
 *
 * Skipped entirely on a database that has not run 026 (`contributor_points_from`
 * is what it calls). This is the one part of this file that cannot stand alone,
 * and it is the part that means nothing without 026 anyway.
 */
do $score$
begin
  if to_regprocedure('public.contributor_points_from(integer, integer, integer, bigint, integer)') is null then
    raise notice 'contributor_points_from is missing (migration 026) — forum points will be added when 030 is pasted again after it';
    return;
  end if;

  execute $fn$
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
    as $body$
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
      ),
      discussion_count as (
        select count(*)::integer as n
        from public.forum_discussions d
        where d.user_id = p_user_id
          and d.status = 'Publish'
          and (p_from is null or (d.created_at at time zone 'utc')::date >= p_from)
          and (p_to is null or (d.created_at at time zone 'utc')::date < p_to)
      ),
      forum_reply_count as (
        select count(*)::integer as n
        from public.forum_replies r
        where r.user_id = p_user_id
          and r.status = 'Publish'
          and (p_from is null or (r.created_at at time zone 'utc')::date >= p_from)
          and (p_to is null or (r.created_at at time zone 'utc')::date < p_to)
      ),
      reaction_count as (
        select count(*)::integer as n
        from public.forum_reactions x
        join public.forum_replies r on r.id = x.reply_id
        where r.user_id = p_user_id
          and r.status = 'Publish'
          and x.kind in ('like', 'agree')
          and (p_from is null or (x.created_at at time zone 'utc')::date >= p_from)
          and (p_to is null or (x.created_at at time zone 'utc')::date < p_to)
      )
      select jsonb_build_object(
        'articles', article_count.n,
        'songs', song_count.n,
        'comments', comment_count.n,
        'views', view_count.n,
        'seconds', time_count.n,
        'discussions', discussion_count.n,
        'replies', forum_reply_count.n,
        'reactions', reaction_count.n,
        'points', public.contributor_points_from(
          article_count.n, song_count.n, comment_count.n, view_count.n, time_count.n
        ) + public.contributor_forum_points_from(
          discussion_count.n, forum_reply_count.n, reaction_count.n
        )
      )
      from article_count, song_count, comment_count, view_count, time_count,
           discussion_count, forum_reply_count, reaction_count;
    $body$;
  $fn$;
end;
$score$;

-- The doors of the four rewritten functions, on their new signatures. A dropped
-- function takes its grants with it, so these are not a repeat of 029's — they
-- are what makes the rewritten functions reachable at all.
revoke all on function public.forum_overview(integer, text) from public;
revoke all on function public.forum_discussion(uuid, boolean, text) from public;
revoke all on function public.forum_create_discussion(text, text, text, text, text) from public;
revoke all on function public.forum_reply(uuid, text, uuid, text) from public;

grant execute on function public.forum_overview(integer, text) to anon, authenticated;
grant execute on function public.forum_discussion(uuid, boolean, text) to anon, authenticated;
grant execute on function public.forum_create_discussion(text, text, text, text, text) to authenticated;
grant execute on function public.forum_reply(uuid, text, uuid, text) to authenticated;

-- And the two functions of 029 this file leaves exactly as they were — granted
-- again only where 029 has actually been pasted, since this file also applies to
-- a database that has never seen it.
do $regrant$
begin
  if to_regprocedure('public.forum_category(text, integer, integer)') is not null then
    execute 'revoke all on function public.forum_category(text, integer, integer) from public';
    execute 'grant execute on function public.forum_category(text, integer, integer) to anon, authenticated';
  end if;
  if to_regprocedure('public.forum_search(text, integer)') is not null then
    execute 'revoke all on function public.forum_search(text, integer) from public';
    execute 'grant execute on function public.forum_search(text, integer) to anon, authenticated';
  end if;
end;
$regrant$;

commit;

-- App side, for the next reader of this file:
--
--   PortalRepository.forumOverview(limit, order)   → সাম্প্রতিক আলোচনা's filter
--   PortalRepository.forumDiscussion(id, countView, deviceId) → answers with reactions
--   PortalRepository.createForumDiscussion(slug, title, body, coverUrl, coverDeleteUrl)
--   PortalRepository.forumReply(id, body, parentId)
--   PortalRepository.reactToForumReply(replyId, kind)  → the long-press popup
--   PortalRepository.forumActivity(userId)             → dashboard + public profile
--
-- App-side drafts (the composer and a reply survive leaving the screen) are
-- `data/local/ForumDraftStore.kt` — they are not a database concern.
