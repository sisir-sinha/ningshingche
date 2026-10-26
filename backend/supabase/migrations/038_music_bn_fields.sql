-- Bengali titles for music library + placeholder-friendly defaults
-- Dashboard now collects bn_title / bn_artist / bn_album alongside the
-- existing title / artist / album. Placeholders are handled in the UI;
-- these columns simply allow bilingual display in the app.

begin;

alter table public.music_tracks
  add column if not exists bn_title text not null default '',
  add column if not exists bn_artist text not null default '',
  add column if not exists bn_album text not null default '';

-- Keep PostgREST schema cache in sync so the dashboard sees the columns
-- immediately after this migration is applied.
notify pgrst, 'reload schema';

commit;
