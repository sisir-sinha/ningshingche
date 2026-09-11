-- Artist / album artwork and bios for dedicated pages in the app.

begin;

alter table public.music_tracks
  add column if not exists artist_image text not null default '',
  add column if not exists artist_description text not null default '',
  add column if not exists album_image text not null default '',
  add column if not exists album_description text not null default '';

notify pgrst, 'reload schema';

commit;
