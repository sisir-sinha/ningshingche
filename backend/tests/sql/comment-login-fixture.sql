-- Disposable PostgreSQL fixture, NOT a real Supabase installation.
-- Run only against a fresh throwaway database owned by the current test user:
-- psql -v ON_ERROR_STOP=1 -f backend/tests/sql/comment-login-fixture.sql
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub', '')::uuid
$$;
create function public.dashboard_has_permission(p_permission text) returns boolean language sql stable as $$
  select p_permission = 'comments' and coalesce(current_setting('test.staff', true), '') = 'yes'
$$;
grant usage on schema auth to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
grant execute on function public.dashboard_has_permission(text) to anon, authenticated;
create table public.comments (user_id uuid, status text not null, content text not null);
insert into public.comments values (null, 'Publish', 'historic guest comment');
alter table public.comments enable row level security;
grant select, insert on public.comments to anon, authenticated;
create policy comments_public_read on public.comments for select to anon, authenticated using (status = 'Publish');
create policy comments_public_insert on public.comments for insert to anon, authenticated with check (status = 'Unpublish');
-- Simulate a forgotten permissive policy: the restrictive gate must still apply.
create policy legacy_broad_insert on public.comments for insert to anon, authenticated with check (true);
\ir ../../supabase/migrations/050_authenticated_article_comments.sql
\ir ../../supabase/migrations/050_authenticated_article_comments.sql

create function public.expect_comment_denied(p_uid uuid, p_status text) returns void language plpgsql as $$
begin
  insert into public.comments values (p_uid, p_status, 'should be denied');
  raise exception 'an unauthorized insert unexpectedly succeeded';
exception when insufficient_privilege then null;
end $$;
grant execute on function public.expect_comment_denied(uuid, text) to anon, authenticated;

set role anon;
select set_config('request.jwt.claims', '{}', false);
select set_config('test.staff', '', false);
select public.expect_comment_denied(null, 'Unpublish');
select public.expect_comment_denied('11111111-1111-4111-8111-111111111111', 'Unpublish');
do $$ begin
  if (select count(*) from public.comments) <> 1 then raise exception 'guest cannot read historic published comment'; end if;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","is_anonymous":true}', false);
select public.expect_comment_denied('11111111-1111-4111-8111-111111111111', 'Unpublish');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","is_anonymous":false}', false);
select public.expect_comment_denied(null, 'Unpublish');
select public.expect_comment_denied('22222222-2222-4222-8222-222222222222', 'Unpublish');
select public.expect_comment_denied('11111111-1111-4111-8111-111111111111', 'Publish');
insert into public.comments values ('11111111-1111-4111-8111-111111111111', 'Unpublish', 'real reader');
reset role;

set role anon;
select set_config('request.jwt.claims', '{}', false);
select set_config('test.staff', 'yes', false);
insert into public.comments values (null, 'Publish', 'authorized dashboard staff');
reset role;
do $$ begin
  if (select count(*) from public.comments) <> 3 then raise exception 'unexpected row count'; end if;
end $$;
select 'authenticated comment RLS fixture passed' as result;
