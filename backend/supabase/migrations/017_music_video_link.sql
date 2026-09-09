-- Optional social video (YouTube, Facebook, Instagram, Vimeo, …) on a music track.
-- The app plays the iframe embed on the cover canvas when the user taps the video icon.

begin;

alter table public.music_tracks
  add column if not exists video_link text not null default '';

notify pgrst, 'reload schema';

commit;
