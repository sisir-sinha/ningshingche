-- Public love-react counts on catalog tracks.
-- App still shows a local count if this migration has not been applied.

begin;

alter table public.music_tracks
  add column if not exists love_count integer not null default 0;

create table if not exists public.music_loves (
  track_id uuid not null references public.music_tracks (id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (track_id, user_id)
);

create index if not exists music_loves_track_idx
  on public.music_loves (track_id);

grant select on public.music_loves to anon, authenticated;
grant insert, delete on public.music_loves to authenticated;

alter table public.music_loves enable row level security;

drop policy if exists music_loves_public_select on public.music_loves;
create policy music_loves_public_select on public.music_loves
for select to anon, authenticated
using (true);

drop policy if exists music_loves_own_insert on public.music_loves;
create policy music_loves_own_insert on public.music_loves
for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists music_loves_own_delete on public.music_loves;
create policy music_loves_own_delete on public.music_loves
for delete to authenticated
using (auth.uid() = user_id);

create or replace function public.music_loves_sync_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  target := coalesce(new.track_id, old.track_id);
  update public.music_tracks
    set love_count = (select count(*) from public.music_loves where track_id = target)
    where id = target;
  return coalesce(new, old);
end;
$$;

drop trigger if exists music_loves_sync_count on public.music_loves;
create trigger music_loves_sync_count
after insert or delete on public.music_loves
for each row execute function public.music_loves_sync_count();

insert into public.music_loves (track_id, user_id)
select mpt.track_id, p.user_id
from public.music_playlist_tracks mpt
join public.music_playlists p on p.id = mpt.playlist_id
where p.kind = 'loved'
on conflict do nothing;

update public.music_tracks t
set love_count = (select count(*) from public.music_loves l where l.track_id = t.id);

notify pgrst, 'reload schema';

commit;
