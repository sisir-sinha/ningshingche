-- Disposable database only. Never run this mock setup against Supabase.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create table public.profiles(id uuid primary key,first_name text,last_name text,avatar_url text,about text,phone text,address text,designation text);
create table public.pdf_books(id uuid primary key default gen_random_uuid(),title text not null,author_or_editor text,edition text,category text,book_published_date date,page_count int,file_size_mb numeric,description text,link text,file_provider text);
create function public.has_accepted_current_terms() returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.terms',true),''),'false')::boolean $$;
create function public.moderation_restricted(uuid,text) returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.restricted',true),''),'false')::boolean $$;
create function public.dashboard_current_user_id() returns uuid language sql stable as $$ select nullif(current_setting('test.admin',true),'')::uuid $$;
create function public.dashboard_has_permission(text) returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.allowed',true),''),'false')::boolean $$;
grant usage on schema auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
insert into profiles values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','A','B','photo','about','123','address','writer');
