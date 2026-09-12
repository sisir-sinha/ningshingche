-- Forum: discussions, replies, and the doors the app reads them through.
--
-- A basic forum in the shape the rest of this database already uses: rows in
-- `public`, every read and write behind a `security definer` function whose
-- grants say who may call it. The app never talks to these tables directly, so
-- the rules live here and cannot be bypassed by a client that tries.
--
--   forum_categories    a seeded, ordered list — general, language, culture,
--                       history, help. A row, not an enum: the dashboard can add
--                       one later without a migration.
--   forum_discussions   one opening post, with its counters and its author.
--   forum_replies       the answers under it.
--
-- Who may do what, as the owner asked:
--
--   read      anyone, signed in or not — `forum_overview`, `forum_category`,
--             `forum_search`, `forum_discussion` are granted to anon too.
--   write     signed-in readers only — `forum_create_discussion` and
--             `forum_reply` are granted to `authenticated` alone *and* raise
--             42501 when `auth.uid()` is null, so a guest with the publishable
--             key is refused by the database whatever the client does. The app
--             recognises 42501 as a session problem (PortalError.SignedOut) and
--             answers with the sign-in gate rather than an error message.
--
-- Counters are kept by triggers, not by the client: a new reply bumps
-- `replies_count` and `last_reply_at`, and a deleted one takes its count back.
-- Opening a discussion bumps `views_count` through the RPC — the one counter a
-- trigger cannot see, because it is a read.
--
-- Content is public as soon as it is posted (`status` defaults to `Publish`),
-- which is the difference between a forum and the moderated comment stream:
-- waiting for approval would leave every new thread invisible to its own author.
-- The column is there so the dashboard can hide a thread that needs hiding, and
-- waiting rooms can be reintroduced by changing one default.
--
-- Run this in the Supabase SQL Editor. It depends on nothing else in
-- `migrations/`, so it may be pasted before or after 024-028; the app reports
-- the forum as unavailable until it is in.

begin;

-- 0. Categories ---------------------------------------------------------------

create table if not exists public.forum_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null default '',
  position integer not null default 0,
  is_locked boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

-- 1. Discussions and replies --------------------------------------------------

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

create index if not exists forum_discussions_category_idx
  on public.forum_discussions (category_id, created_at desc);

create index if not exists forum_discussions_activity_idx
  on public.forum_discussions (created_at desc, last_reply_at desc);

create table if not exists public.forum_replies (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.forum_discussions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  status text not null default 'Publish',
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists forum_replies_discussion_idx
  on public.forum_replies (discussion_id, created_at asc);

-- 2. The counters --------------------------------------------------------------

/**
 * One reply in, one reply counted; a deleted reply takes its count back and
 * hands `last_reply_at` to whatever is left. Kept as a trigger so every path
 * that writes a reply — the RPC, the dashboard, a future import — agrees.
 */
create or replace function public.forum_replies_sync_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  target := coalesce(new.discussion_id, old.discussion_id);

  update public.forum_discussions d
     set replies_count = coalesce((
           select count(*) from public.forum_replies r
            where r.discussion_id = target and r.status = 'Publish'
         ), 0),
         last_reply_at = (
           select max(r.created_at) from public.forum_replies r
            where r.discussion_id = target and r.status = 'Publish'
         )
   where d.id = target;

  return null;
end;
$$;

drop trigger if exists forum_replies_sync_count on public.forum_replies;
create trigger forum_replies_sync_count
  after insert or update or delete on public.forum_replies
  for each row execute function public.forum_replies_sync_count();

/** `updated_at` follows every real edit, so "edited" can be shown honestly. */
create or replace function public.forum_discussions_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists forum_discussions_touch on public.forum_discussions;
create trigger forum_discussions_touch
  before update on public.forum_discussions
  for each row execute function public.forum_discussions_touch();

-- 3. Counting what the reader typed -------------------------------------------
--
-- Bengali is written with combining marks, and the same syllable arrives
-- pre-composed from one keyboard and decomposed from another: `ছোট` is three
-- characters to the reader and nine code points as this database receives it. A
-- minimum counted in code points therefore means different things from
-- different keyboards, so the marks and the spaces come out before counting. The
-- app mirrors this in `ForumText.units`, so the number the writer sees beside
-- the field is the number the server enforces.

create or replace function public.forum_text_units(p_text text)
returns integer
language sql
immutable
as $$
  select char_length(regexp_replace(
    coalesce(p_text, ''),
    E'[\\s\u0981-\u0983\u09BC\u09BE-\u09CD\u09D7\u09E2\u09E3\u09FE\u200C\u200D]',
    '', 'g'
  ));
$$;

revoke all on function public.forum_text_units(text) from public;

-- 4. The shape one card needs --------------------------------------------------
--
-- One definition, so the four read functions cannot drift apart. It is a view
-- for the same reason the counters are triggers: the alternative is the same
-- twenty-line projection copied four times.
--
-- The view has **no grants**: `security definer` functions read it as its owner,
-- and anon/authenticated are revoked explicitly, because a view runs with its
-- owner's rights and would otherwise be a way around the RLS policies below.

create or replace view public.forum_discussion_rows as
select d.id,
       k.id as category_id,
       k.slug as category_slug,
       k.title as category_title,
       d.title,
       left(regexp_replace(d.body, '\s+', ' ', 'g'), 180) as excerpt,
       d.body,
       d.user_id as author_id,
       coalesce(nullif(btrim(p.name), ''), 'নিংশিং চে পাঠক') as author_name,
       coalesce(p.avatar_url, '') as author_avatar_url,
       d.status,
       d.views_count,
       d.replies_count,
       d.created_at,
       d.last_reply_at,
       d.updated_at
  from public.forum_discussions d
  join public.forum_categories k on k.id = d.category_id
  left join public.profiles p on p.id = d.user_id;

revoke all on public.forum_discussion_rows from anon, authenticated;

-- 5. What the app reads --------------------------------------------------------

/**
 * The forum home: the categories with their counts, and the discussions that
 * moved most recently — a new thread, or a reply to an old one. Readable by
 * anyone, guest included.
 */
create or replace function public.forum_overview(p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
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
         order by coalesce(v.last_reply_at, v.created_at) desc, v.created_at desc
         limit greatest(least(coalesce(p_limit, 20), 50), 1)
      ) x
    ), '[]'::jsonb),
    'total_discussions', (
      select count(*) from public.forum_discussions where status = 'Publish'
    ),
    'total_replies', (
      select count(*) from public.forum_replies where status = 'Publish'
    )
  );
$$;

/** One category's threads. `p_offset` pages the same order the home page uses. */
create or replace function public.forum_category(
  p_slug text,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with wanted as (
    select k.id, k.slug, k.title, k.description, k.is_locked
      from public.forum_categories k
     where k.slug = btrim(coalesce(p_slug, ''))
  ),
  rows as (
    select v.*
      from public.forum_discussion_rows v
      join wanted w on w.id = v.category_id
     where v.status = 'Publish'
     order by coalesce(v.last_reply_at, v.created_at) desc, v.created_at desc
     limit greatest(least(coalesce(p_limit, 30), 100), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select case when (select count(*) from wanted) = 0 then null else jsonb_build_object(
    'category', (
      select jsonb_build_object(
        'id', w.id,
        'slug', w.slug,
        'title', w.title,
        'description', w.description,
        'is_locked', w.is_locked,
        'discussions', (
          select count(*) from public.forum_discussions d
           where d.category_id = w.id and d.status = 'Publish'
        )
      ) from wanted w
    ),
    'discussions', coalesce((select jsonb_agg(to_jsonb(r)) from rows r), '[]'::jsonb),
    'total', (
      select count(*) from public.forum_discussions d
       join wanted w on w.id = d.category_id
       where d.status = 'Publish'
    )
  ) end;
$$;

/**
 * Search over titles and bodies, newest activity first.
 *
 * `strpos` rather than `ilike`: the reader's own text never becomes a pattern,
 * so `%`, `_` and `\` are ordinary characters here and need no escaping. An
 * empty query is the latest list, not every row.
 */
create or replace function public.forum_search(p_query text, p_limit integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with term as (select btrim(coalesce(p_query, '')) as q),
  hits as (
    select v.*
      from public.forum_discussion_rows v
      cross join term t
     where v.status = 'Publish'
       and (
         t.q = ''
         or strpos(lower(v.title), lower(t.q)) > 0
         or strpos(lower(v.body), lower(t.q)) > 0
       )
     order by coalesce(v.last_reply_at, v.created_at) desc, v.created_at desc
     limit greatest(least(coalesce(p_limit, 30), 100), 1)
  )
  select jsonb_build_object(
    'query', (select q from term),
    'discussions', coalesce((select jsonb_agg(to_jsonb(h)) from hits h), '[]'::jsonb),
    'total', (select count(*) from hits)
  );
$$;

/**
 * One discussion with its replies, oldest reply first — the order they were
 * written in, which is the order an argument has to be read in.
 *
 * `p_count_view` is on by default because this function is called when the
 * screen opens; the app passes false when it is only refreshing. Every open
 * counts, guest or not, the way a forum page view counts anywhere else.
 */
create or replace function public.forum_discussion(
  p_id uuid,
  p_count_view boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
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

  return jsonb_build_object(
    'discussion', row_data,
    'replies', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at)
      from (
        select f.id,
               f.discussion_id,
               f.user_id as author_id,
               coalesce(nullif(btrim(p.name), ''), 'নিংশিং চে পাঠক') as author_name,
               coalesce(p.avatar_url, '') as author_avatar_url,
               f.body,
               f.created_at
          from public.forum_replies f
          left join public.profiles p on p.id = f.user_id
         where f.discussion_id = p_id and f.status = 'Publish'
         limit 300
      ) r
    ), '[]'::jsonb)
  );
end;
$$;

-- 6. What the app writes -------------------------------------------------------

/**
 * A new thread. Signed-in readers only: the grant below says so, and the check
 * inside raises 42501 anyway, so a guest calling it through a proxy is refused
 * with the same error the app already turns into "your session has expired".
 */
create or replace function public.forum_create_discussion(
  p_category_slug text,
  p_title text,
  p_body text
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

  if public.forum_text_units(clean_body) < 1 or char_length(clean_body) > 8000 then
    raise exception 'a discussion body is at least 1 character (and at most 8000)'
      using errcode = '22023';
  end if;

  insert into public.forum_discussions (category_id, user_id, title, body)
  values (category.id, auth.uid(), clean_title, clean_body)
  returning id into new_id;

  return public.forum_discussion(new_id, false);
end;
$$;

/** A reply. Same door as a new thread, same refusal for a guest. */
create or replace function public.forum_reply(p_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  thread public.forum_discussions%rowtype;
  clean_body text := btrim(coalesce(p_body, ''));
  reply_id uuid;
begin
  if auth.uid() is null then
    raise exception 'a reply needs a signed-in reader'
      using errcode = '42501';
  end if;

  select * into thread from public.forum_discussions d where d.id = p_id;

  if thread.id is null or thread.status <> 'Publish' then
    raise exception 'no such discussion' using errcode = '22023';
  end if;

  if public.forum_text_units(clean_body) < 1 or char_length(clean_body) > 4000 then
    raise exception 'a reply is at least 1 character (and at most 4000)'
      using errcode = '22023';
  end if;

  insert into public.forum_replies (discussion_id, user_id, body)
  values (p_id, auth.uid(), clean_body)
  returning id into reply_id;

  return (
    select to_jsonb(r)
    from (
      select f.id,
             f.discussion_id,
             f.user_id as author_id,
             coalesce(nullif(btrim(p.name), ''), 'নিংশিং চে পাঠক') as author_name,
             coalesce(p.avatar_url, '') as author_avatar_url,
             f.body,
             f.created_at
        from public.forum_replies f
        left join public.profiles p on p.id = f.user_id
       where f.id = reply_id
    ) r
  );
end;
$$;

-- 7. The lock ------------------------------------------------------------------
--
-- Supabase's default privileges hand `anon` access to anything new in `public`,
-- so a table that ends up here without RLS is exposed through the API. The
-- reader's rules are the policies below; the RPCs above are the only writer.

alter table public.forum_categories enable row level security;
alter table public.forum_discussions enable row level security;
alter table public.forum_replies enable row level security;

-- Categories and published threads are public reads.
drop policy if exists forum_categories_public_read on public.forum_categories;
create policy forum_categories_public_read on public.forum_categories
  for select to anon, authenticated using (true);

drop policy if exists forum_discussions_public_read on public.forum_discussions;
create policy forum_discussions_public_read on public.forum_discussions
  for select to anon, authenticated using (status = 'Publish');

drop policy if exists forum_replies_public_read on public.forum_replies;
create policy forum_replies_public_read on public.forum_replies
  for select to anon, authenticated using (status = 'Publish');

-- A signed-in reader may read, edit and delete their own row. The app writes
-- through the RPCs, but the policy is what makes "own row" true of the table.
drop policy if exists forum_discussions_own_write on public.forum_discussions;
create policy forum_discussions_own_write on public.forum_discussions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists forum_replies_own_write on public.forum_replies;
create policy forum_replies_own_write on public.forum_replies
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- The dashboard moderates: hide a thread, delete spam, lock a category.
drop policy if exists forum_categories_dashboard_all on public.forum_categories;
create policy forum_categories_dashboard_all on public.forum_categories
  for all to anon, authenticated
  using (public.is_dashboard_request()) with check (public.is_dashboard_request());

drop policy if exists forum_discussions_dashboard_all on public.forum_discussions;
create policy forum_discussions_dashboard_all on public.forum_discussions
  for all to anon, authenticated
  using (public.is_dashboard_request()) with check (public.is_dashboard_request());

drop policy if exists forum_replies_dashboard_all on public.forum_replies;
create policy forum_replies_dashboard_all on public.forum_replies
  for all to anon, authenticated
  using (public.is_dashboard_request()) with check (public.is_dashboard_request());

grant select on public.forum_categories, public.forum_discussions, public.forum_replies
  to anon, authenticated;

-- 8. The doors the app knocks on ----------------------------------------------
--
-- Reads are open to everyone; the two writes are granted to `authenticated`
-- alone, which is the first of the two locks on them.

revoke all on function public.forum_overview(integer) from public;
revoke all on function public.forum_category(text, integer, integer) from public;
revoke all on function public.forum_search(text, integer) from public;
revoke all on function public.forum_discussion(uuid, boolean) from public;
revoke all on function public.forum_create_discussion(text, text, text) from public;
revoke all on function public.forum_reply(uuid, text) from public;

grant execute on function public.forum_overview(integer) to anon, authenticated;
grant execute on function public.forum_category(text, integer, integer) to anon, authenticated;
grant execute on function public.forum_search(text, integer) to anon, authenticated;
grant execute on function public.forum_discussion(uuid, boolean) to anon, authenticated;
grant execute on function public.forum_create_discussion(text, text, text) to authenticated;
grant execute on function public.forum_reply(uuid, text) to authenticated;

-- 9. Five rooms to start in ----------------------------------------------------
--
-- Real rooms for the subject this encyclopedia is about, not filler: the owner
-- can rename or add to them from the dashboard.

insert into public.forum_categories (slug, title, description, position) values
  ('general',  'সাধারণ আলোচনা',     'যেকোনো বিষয়ে খোলা আলোচনা — পরিচয়, প্রশ্ন, পরামর্শ।', 1),
  ('language', 'ভাষা ও সাহিত্য',    'বিষ্ণুপ্রিয়া মণিপুরি ভাষা, ব্যাকরণ, শব্দ ও সাহিত্য।',   2),
  ('culture',  'সংস্কৃতি ও ঐতিহ্য', 'উৎসব, নৃত্য, গান, পোশাক ও রীতিনীতি।',                  3),
  ('history',  'ইতিহাস ও সমাজ',     'ইতিহাস, গোত্র, মিংকৌ, ইঞ্চৌঘর ও সমাজব্যবস্থা।',         4),
  ('help',     'সাহায্য ও পরামর্শ', 'অ্যাপ ও ওয়েবসাইট ব্যবহারে সমস্যা, অনুরোধ ও মতামত।',   5)
on conflict (slug) do nothing;

commit;

-- App side: PortalRepository.forumOverview / forumCategory / forumSearch /
-- forumDiscussion / createForumDiscussion / forumReply, and the four screens in
-- ui/screens/ForumScreens.kt reached from the drawer's ফোরাম row.
