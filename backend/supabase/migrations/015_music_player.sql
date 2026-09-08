-- Lyrics on public tracks, plus per-user playlists and loved songs.
-- App playback still works from Room if this migration has not been applied.

begin;

alter table public.music_tracks
  add column if not exists lyrics text not null default '';

create table if not exists public.music_playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null check (length(btrim(title)) > 0),
  kind text not null default 'custom' check (kind in ('custom', 'loved')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists music_playlists_loved_user_idx
  on public.music_playlists (user_id)
  where kind = 'loved';

create index if not exists music_playlists_user_idx
  on public.music_playlists (user_id, updated_at desc);

create table if not exists public.music_playlist_tracks (
  playlist_id uuid not null references public.music_playlists (id) on delete cascade,
  track_id uuid not null references public.music_tracks (id) on delete cascade,
  sort_order integer not null default 0,
  added_at timestamptz not null default timezone('utc', now()),
  primary key (playlist_id, track_id)
);

drop trigger if exists music_playlists_set_updated_at on public.music_playlists;
create trigger music_playlists_set_updated_at
before update on public.music_playlists
for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.music_playlists to authenticated;
grant select, insert, update, delete on public.music_playlist_tracks to authenticated;

alter table public.music_playlists enable row level security;
alter table public.music_playlist_tracks enable row level security;

drop policy if exists music_playlists_own_all on public.music_playlists;
create policy music_playlists_own_all on public.music_playlists
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists music_playlist_tracks_own_all on public.music_playlist_tracks;
create policy music_playlist_tracks_own_all on public.music_playlist_tracks
for all to authenticated
using (
  exists (
    select 1 from public.music_playlists p
    where p.id = playlist_id and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.music_playlists p
    where p.id = playlist_id and p.user_id = auth.uid()
  )
);

notify pgrst, 'reload schema';

commit;
