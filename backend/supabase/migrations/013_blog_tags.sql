-- Blog tag endpoints: normalised tag keys, a tag-count view, and RPCs that
-- return blogs for a tag or an annual issue ("নিংশিং চে বার্ষিক সংখ্যা").
-- Run in the Supabase SQL Editor after 012_comment_avatar.sql.
--
-- Why: public.blogs.tags is free text. The annual-issue tag is spelled in
-- several ways in the archive ("নিংশিং চে - ২০২৩", "নিংশিং চে-২০২৩",
-- "নিংশিং চে-2023"). tags=cs.{…} matches exact strings only, so the dashboard,
-- the Android app, and the website each needed their own workaround. This
-- migration installs one normalisation rule in PostgreSQL that
-- backend/assets/js/tags.js mirrors in the browser.
--
-- Endpoints added (all read-only, callable with the publishable key):
--   GET  /rest/v1/blog_tag_counts?order=issue_year.desc.nullslast,total.desc
--   GET  /rest/v1/blog_tag_counts?issue_year=not.is.null        (issues only)
--   POST /rest/v1/rpc/blogs_by_issue   {"p_year": 2025, "p_status": "Publish"}
--   POST /rest/v1/rpc/blogs_by_tag     {"p_tag": "সাহিত্য", "p_status": "Publish"}
--   GET  /rest/v1/blogs?tag_keys=cs.{"নিংশিংচে-2025"}      (generated column)
--
-- Row Level Security still applies: anonymous callers only see published
-- blogs; dashboard sessions with the Blogs menu also see drafts.

begin;

-- ---------------------------------------------------------------------------
-- 1. Normalisation helpers (immutable so they can back a generated column)
-- ---------------------------------------------------------------------------

create or replace function public.bengali_to_ascii_digits(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select translate(p_text, '০১২৩৪৫৬৭৮৯', '0123456789');
$$;

create or replace function public.ascii_to_bengali_digits(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select translate(p_text, '0123456789', '০১২৩৪৫৬৭৮৯');
$$;

-- Lower-case, ASCII digits, plain hyphen, no whitespace, no leading "#".
create or replace function public.blog_tag_normalize(p_tag text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select regexp_replace(
           regexp_replace(
             lower(public.bengali_to_ascii_digits(normalize(btrim(p_tag), NFC))),
             '[–—−]', '-', 'g'),
           '(^#+|\s+)', '', 'g');
$$;

-- Four-digit year when the tag is an annual-issue tag, otherwise null.
create or replace function public.blog_tag_issue_year(p_tag text)
returns integer
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select (regexp_match(public.blog_tag_normalize(p_tag),
                       '^(?:নিংশিংচে|ningshingche|ningshing-che)-?(\d{4})$'))[1]::integer;
$$;

-- Comparison key. Every spelling of an issue collapses to "নিংশিংচে-YYYY".
create or replace function public.blog_tag_key(p_tag text)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select case
    when public.blog_tag_issue_year(p_tag) is not null
      then 'নিংশিংচে-' || public.blog_tag_issue_year(p_tag)::text
    else nullif(public.blog_tag_normalize(p_tag), '')
  end;
$$;

create or replace function public.blog_tag_keys(p_tags text[])
returns text[]
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select coalesce(array_agg(distinct k order by k), '{}'::text[])
  from unnest(coalesce(p_tags, '{}'::text[])) as t(tag)
  cross join lateral (select public.blog_tag_key(t.tag) as k) as keyed
  where k is not null;
$$;

-- Canonical display label, e.g. "নিংশিং চে-২০২৫".
create or replace function public.blog_issue_label(p_year integer)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select 'নিংশিং চে-' || public.ascii_to_bengali_digits(p_year::text);
$$;

revoke all on function public.bengali_to_ascii_digits(text) from public;
revoke all on function public.ascii_to_bengali_digits(text) from public;
revoke all on function public.blog_tag_normalize(text) from public;
revoke all on function public.blog_tag_issue_year(text) from public;
revoke all on function public.blog_tag_key(text) from public;
revoke all on function public.blog_tag_keys(text[]) from public;
revoke all on function public.blog_issue_label(integer) from public;
grant execute on function public.bengali_to_ascii_digits(text) to anon, authenticated;
grant execute on function public.ascii_to_bengali_digits(text) to anon, authenticated;
grant execute on function public.blog_tag_normalize(text) to anon, authenticated;
grant execute on function public.blog_tag_issue_year(text) to anon, authenticated;
grant execute on function public.blog_tag_key(text) to anon, authenticated;
grant execute on function public.blog_tag_keys(text[]) to anon, authenticated;
grant execute on function public.blog_issue_label(integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Generated key column + index so `tag_keys=cs.{…}` is a plain REST filter
-- ---------------------------------------------------------------------------

alter table public.blogs
  add column if not exists tag_keys text[]
    generated always as (public.blog_tag_keys(tags)) stored;

comment on column public.blogs.tag_keys is
  'Normalised tag keys (blog_tag_key). Issue tags collapse to নিংশিংচে-YYYY. Generated from tags.';

create index if not exists blogs_tag_keys_gin_idx on public.blogs using gin (tag_keys);

-- ---------------------------------------------------------------------------
-- 3. Tag catalogue view (security_invoker so RLS decides which blogs count)
-- ---------------------------------------------------------------------------

drop view if exists public.blog_tag_counts;
create view public.blog_tag_counts
with (security_invoker = true)
as
with exploded as (
  select
    b.id,
    b.status,
    btrim(t.tag) as spelling,
    public.blog_tag_key(t.tag) as tag_key,
    public.blog_tag_issue_year(t.tag) as issue_year
  from public.blogs b
  cross join lateral unnest(b.tags) as t(tag)
  where public.blog_tag_key(t.tag) is not null
),
per_key as (
  select
    tag_key,
    issue_year,
    count(distinct id) as total,
    count(distinct id) filter (where status = 'Publish') as published
  from exploded
  group by tag_key, issue_year
),
spellings as (
  select tag_key, spelling, count(*) as uses
  from exploded
  group by tag_key, spelling
),
ranked as (
  select
    tag_key,
    array_agg(spelling order by uses desc, spelling) as spellings
  from spellings
  group by tag_key
)
select
  k.tag_key,
  case when k.issue_year is not null then public.blog_issue_label(k.issue_year) else r.spellings[1] end as tag,
  k.issue_year,
  (k.issue_year is not null) as is_issue,
  k.total,
  k.published,
  r.spellings
from per_key k
join ranked r using (tag_key);

comment on view public.blog_tag_counts is
  'One row per normalised blog tag: label, issue year, totals and every spelling in use.';

grant select on public.blog_tag_counts to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC endpoints (security invoker: RLS on public.blogs still applies)
-- ---------------------------------------------------------------------------

-- Blogs for one annual issue. p_year accepts 2025 or ২০২৫ via text overload below.
create or replace function public.blogs_by_issue(
  p_year integer,
  p_status text default null,
  p_limit integer default 200,
  p_offset integer default 0
)
returns setof public.blogs
language sql
stable
set search_path = public, pg_catalog
as $$
  select b.*
  from public.blogs b
  where b.tag_keys @> array['নিংশিংচে-' || p_year::text]
    and (p_status is null or p_status = '' or p_status = 'all' or b.status = p_status)
  order by coalesce(b.published_date, b.created_at::date) desc, b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- Blogs for any tag spelling (issue or otherwise).
create or replace function public.blogs_by_tag(
  p_tag text,
  p_status text default null,
  p_limit integer default 200,
  p_offset integer default 0
)
returns setof public.blogs
language sql
stable
set search_path = public, pg_catalog
as $$
  select b.*
  from public.blogs b
  where b.tag_keys @> array[public.blog_tag_key(p_tag)]
    and (p_status is null or p_status = '' or p_status = 'all' or b.status = p_status)
  order by coalesce(b.published_date, b.created_at::date) desc, b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- Annual issues that actually exist in the archive, newest first.
create or replace function public.blog_issue_years(p_status text default 'Publish')
returns table (issue_year integer, label text, total bigint)
language sql
stable
set search_path = public, pg_catalog
as $$
  select
    public.blog_tag_issue_year(t.tag) as issue_year,
    public.blog_issue_label(public.blog_tag_issue_year(t.tag)) as label,
    count(distinct b.id) as total
  from public.blogs b
  cross join lateral unnest(b.tags) as t(tag)
  where public.blog_tag_issue_year(t.tag) is not null
    and (p_status is null or p_status = '' or p_status = 'all' or b.status = p_status)
  group by 1, 2
  order by 1 desc;
$$;

revoke all on function public.blogs_by_issue(integer, text, integer, integer) from public;
revoke all on function public.blogs_by_tag(text, text, integer, integer) from public;
revoke all on function public.blog_issue_years(text) from public;
grant execute on function public.blogs_by_issue(integer, text, integer, integer) to anon, authenticated;
grant execute on function public.blogs_by_tag(text, text, integer, integer) to anon, authenticated;
grant execute on function public.blog_issue_years(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
