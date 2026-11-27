-- Disposable fixture: combine the real 044 trigger with simulated Supabase RLS.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
$$;
alter table public.comments enable row level security;
grant select on public.comments to anon, authenticated;
create policy fixture_public_read on public.comments for select to anon, authenticated using (status='Publish');
create policy fixture_legacy_insert on public.comments for insert to anon, authenticated with check (true);
insert into auth.users(id) values ('55555555-5555-4555-8555-555555555555');
