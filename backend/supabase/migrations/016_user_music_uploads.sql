-- Signed-in app users may upload MP3s into the public music library.
-- Files land under music/user/<auth.uid()>/… so staff can still delete them.

begin;

drop policy if exists music_tracks_authenticated_insert on public.music_tracks;
create policy music_tracks_authenticated_insert on public.music_tracks
for insert to authenticated
with check (auth.uid() is not null);

drop policy if exists music_user_storage_insert on storage.objects;
create policy music_user_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'music'
  and (storage.foldername(name))[1] = 'user'
  and (storage.foldername(name))[2] = auth.uid()::text
);

notify pgrst, 'reload schema';

commit;
