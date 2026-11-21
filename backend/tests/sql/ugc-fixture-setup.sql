-- Disposable test cluster only. Never run on a production server.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
grant usage on schema auth to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
create function public.dashboard_has_permission(text) returns boolean language sql stable as $$select coalesce(current_setting('test.moderator',true),'')='yes'$$;
create function public.dashboard_current_user_id() returns uuid language sql stable as $$select case when current_setting('test.moderator',true) = 'yes' then 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid else null end$$;
create table public.profiles(id uuid primary key, first_name text, last_name text, name text, avatar_url text, about text, phone text, address text, facebook_id text, designation text, email text);
create table public.blogs(id uuid primary key, status text);
create table public.submitted_blogs(id uuid primary key,title text, designation text,address text,phone text,thumbnail text,imgbb_delete_url text,writer_name text,writer_designation text,writer_profile_image text,writer_email text,writer_facebook text,content_title text,content text,status text,converted_blog_id uuid,user_id uuid);
alter table public.submitted_blogs enable row level security;
create policy submitted_blogs_update_own on public.submitted_blogs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select,update on public.submitted_blogs to authenticated;
insert into auth.users values ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222');
insert into public.profiles values ('11111111-1111-1111-1111-111111111111','A','B','A B','image','about','phone','address','facebook','',''),('22222222-2222-2222-2222-222222222222','C','D','C D','image','about','phone','address','facebook','','');
insert into public.blogs values ('33333333-3333-3333-3333-333333333333','Publish');
insert into public.submitted_blogs(id,status,converted_blog_id,user_id) values ('44444444-4444-4444-4444-444444444444','Approved','33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222');
