-- Music library: public MP3/audio tracks for the reader player.
-- Adds the `music` dashboard menu, `music_tracks` table, and Storage bucket.

begin;

create table if not exists public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  artist text not null default '',
  album text not null default '',
  genre text not null default '',
  description text not null default '',
  thumbnail_url text not null default '',
  imgbb_delete_url text not null default '',
  image_meta jsonb not null default '{}'::jsonb,
  audio_url text not null check (length(btrim(audio_url)) > 0),
  file_provider text not null default 'url' check (file_provider in ('url', 'supabase-storage')),
  file_storage_path text not null default '',
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  file_size_mb numeric(8,2) not null default 0 check (file_size_mb >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists music_tracks_created_at_idx
  on public.music_tracks (sort_order asc, created_at desc);

drop trigger if exists music_tracks_set_updated_at on public.music_tracks;
create trigger music_tracks_set_updated_at
before update on public.music_tracks
for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.music_tracks to anon, authenticated;

alter table public.music_tracks enable row level security;

drop policy if exists music_tracks_public_read on public.music_tracks;
create policy music_tracks_public_read on public.music_tracks
for select to anon, authenticated using (true);

-- Super Admin always has every valid permission; other roles opt in.
create or replace function public.dashboard_valid_permissions()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array[
    'dashboard', 'authors', 'blogs', 'categories', 'comments', 'galleries',
    'books', 'submissions', 'videos', 'music', 'analytics', 'settings', 'access-control'
  ]::text[];
$$;

revoke all on function public.dashboard_valid_permissions() from public;

update public.dashboard_roles
set menu_permissions = case
  when slug = 'super-admin' then public.dashboard_valid_permissions()
  when slug in ('administrator', 'editor')
    and not ('music' = any(menu_permissions))
    then array_append(menu_permissions, 'music')
  else menu_permissions
end
where slug in ('super-admin', 'administrator', 'editor');

drop policy if exists music_tracks_dashboard_all on public.music_tracks;
drop policy if exists music_tracks_dashboard_select on public.music_tracks;
drop policy if exists music_tracks_dashboard_insert on public.music_tracks;
drop policy if exists music_tracks_dashboard_update on public.music_tracks;
drop policy if exists music_tracks_dashboard_delete on public.music_tracks;

do $music_write_policies$
declare
  rbac_installed boolean := to_regprocedure('public.dashboard_has_permission(text)') is not null;
begin
  if rbac_installed then
    execute $sql$
      create policy music_tracks_dashboard_select on public.music_tracks
      for select to anon, authenticated
      using (public.dashboard_has_any_permission(array['music','analytics']::text[]))
    $sql$;
    execute $sql$
      create policy music_tracks_dashboard_insert on public.music_tracks
      for insert to anon, authenticated
      with check (public.dashboard_has_permission('music'))
    $sql$;
    execute $sql$
      create policy music_tracks_dashboard_update on public.music_tracks
      for update to anon, authenticated
      using (public.dashboard_has_permission('music'))
      with check (public.dashboard_has_permission('music'))
    $sql$;
    execute $sql$
      create policy music_tracks_dashboard_delete on public.music_tracks
      for delete to anon, authenticated
      using (public.dashboard_has_permission('music'))
    $sql$;
  else
    execute $sql$
      create policy music_tracks_dashboard_all on public.music_tracks
      for all to anon, authenticated
      using (public.is_dashboard_request())
      with check (public.is_dashboard_request())
    $sql$;
  end if;
end
$music_write_policies$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'music',
  'music',
  true,
  33554432,
  array[
    'audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3',
    'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav',
    'audio/flac', 'audio/webm', 'application/octet-stream'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists music_public_storage_read on storage.objects;
create policy music_public_storage_read on storage.objects
for select to anon, authenticated using (bucket_id = 'music');

drop policy if exists music_dashboard_storage_insert on storage.objects;
drop policy if exists music_dashboard_storage_update on storage.objects;
drop policy if exists music_dashboard_storage_delete on storage.objects;

do $music_storage_policies$
declare
  rbac_installed boolean := to_regprocedure('public.dashboard_has_permission(text)') is not null;
begin
  if rbac_installed then
    execute $sql$
      create policy music_dashboard_storage_insert on storage.objects
      for insert to anon, authenticated
      with check (bucket_id = 'music' and public.dashboard_has_permission('music'))
    $sql$;
    execute $sql$
      create policy music_dashboard_storage_update on storage.objects
      for update to anon, authenticated
      using (bucket_id = 'music' and public.dashboard_has_permission('music'))
      with check (bucket_id = 'music' and public.dashboard_has_permission('music'))
    $sql$;
    execute $sql$
      create policy music_dashboard_storage_delete on storage.objects
      for delete to anon, authenticated
      using (bucket_id = 'music' and public.dashboard_has_permission('music'))
    $sql$;
  else
    execute $sql$
      create policy music_dashboard_storage_insert on storage.objects
      for insert to anon, authenticated
      with check (bucket_id = 'music' and public.is_dashboard_request())
    $sql$;
    execute $sql$
      create policy music_dashboard_storage_update on storage.objects
      for update to anon, authenticated
      using (bucket_id = 'music' and public.is_dashboard_request())
      with check (bucket_id = 'music' and public.is_dashboard_request())
    $sql$;
    execute $sql$
      create policy music_dashboard_storage_delete on storage.objects
      for delete to anon, authenticated
      using (bucket_id = 'music' and public.is_dashboard_request())
    $sql$;
  end if;
end
$music_storage_policies$;

notify pgrst, 'reload schema';

commit;
