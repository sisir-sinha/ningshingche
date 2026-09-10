-- Signed-in app users may upload MP3s under music/user/<auth.uid()>/ and
-- insert their own music_tracks rows. Re-runnable. Fixes Storage 403
-- AccessDenied (RLS) on Android uploads that are not dashboard sessions.

begin;

drop policy if exists music_tracks_authenticated_insert on public.music_tracks;
create policy music_tracks_authenticated_insert on public.music_tracks
for insert to authenticated
with check (
  auth.uid() is not null
  and (user_id is null or user_id = auth.uid())
);

drop policy if exists music_user_storage_insert on storage.objects;
create policy music_user_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'music'
  and name like ('user/' || auth.uid()::text || '/%')
);

drop policy if exists music_user_storage_update on storage.objects;
create policy music_user_storage_update on storage.objects
for update to authenticated
using (
  bucket_id = 'music'
  and name like ('user/' || auth.uid()::text || '/%')
)
with check (
  bucket_id = 'music'
  and name like ('user/' || auth.uid()::text || '/%')
);

update storage.buckets
set allowed_mime_types = array[
  'audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3', 'audio/x-mp3',
  'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/m4a',
  'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/webm',
  'application/octet-stream', 'application/mp3'
]
where id = 'music';

notify pgrst, 'reload schema';

commit;
