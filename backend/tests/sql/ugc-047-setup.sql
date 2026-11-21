-- Minimal forum projection stand-in, not a complete forum or Supabase schema.
create table public.forum_categories(id uuid primary key,slug text,title text);
create table public.forum_reactions(reply_id uuid,kind text);
insert into public.forum_categories values ('aaaa0000-0000-0000-0000-000000000000','general','General');
alter table public.forum_discussions add column category_id uuid default 'aaaa0000-0000-0000-0000-000000000000', add column title text default '', add column body text default '', add column author_name text default '', add column views_count bigint default 0, add column replies_count integer default 0, add column created_at timestamptz default now(), add column last_reply_at timestamptz, add column updated_at timestamptz default now(), add column cover_image_url text default '', add column is_official boolean default false;
alter table public.forum_replies add column parent_id uuid, add column author_name text default '', add column body text default '', add column created_at timestamptz default now(), add column is_official boolean default false;
alter table public.forum_discussions enable row level security;
alter table public.forum_replies enable row level security;
create policy fixture_discussion_public on public.forum_discussions for select to anon,authenticated using (status='Publish');
create policy fixture_reply_public on public.forum_replies for select to anon,authenticated using (status='Publish');
grant select on public.forum_discussions,public.forum_replies to anon,authenticated;
-- Isolate 047's interaction behavior; 044 has separate tests.
alter table public.forum_replies disable trigger phase2_reader_ugc_guard;
