-- Optional uploader id so the user Dashboard can count that reader's songs.

begin;

alter table public.music_tracks
  add column if not exists user_id uuid;

create index if not exists music_tracks_user_id_idx
  on public.music_tracks (user_id);

notify pgrst, 'reload schema';

commit;
