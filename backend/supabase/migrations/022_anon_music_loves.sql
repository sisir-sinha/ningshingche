-- Love reacts (❤) from listeners who are not signed in.
--
-- music_loves is keyed by user_id and its RLS policies only let the row's
-- owner write it, so a guest — with no auth.uid() — could never insert a row:
-- the heart filled in on the device, and the public counter on the track never
-- moved. Opening the table to `anon` would let anyone insert or delete any
-- row, so the write is owned by this security-definer function instead. For a
-- guest it derives a stable pseudonymous id from the device id, which keeps
-- the (track_id, user_id) primary key doing the deduping (one device, one love
-- per track) and leaves the existing music_loves_sync_count trigger to keep
-- music_tracks.love_count authoritative.
--
-- The device id is never stored: only md5('ningshingche:' || device) is, so the
-- table gains no new personal data.
--
-- App side: MusicLibraryStore.syncLoveRemote calls this RPC for everyone, using
-- the publishable key as the bearer when signed out, and applies the returned
-- count. Loves that cannot reach the server are replayed later.

begin;

create or replace function public.toggle_music_love(
  p_track_id uuid,
  p_device_id text,
  p_loved boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  identity uuid;
  device text;
  remaining integer;
begin
  device := nullif(btrim(coalesce(p_device_id, '')), '');
  identity := auth.uid();

  if identity is null then
    if device is null or length(device) < 8 then
      raise exception 'a device id of at least 8 characters is required to love a track without an account'
        using errcode = '22023';
    end if;
    -- Same device id -> same uuid -> same row, so a guest's love is idempotent
    -- and can be withdrawn again with the same call.
    identity := md5('ningshingche:' || device)::uuid;
  end if;

  if p_loved then
    insert into public.music_loves (track_id, user_id)
    values (p_track_id, identity)
    on conflict (track_id, user_id) do nothing;
  else
    delete from public.music_loves
    where track_id = p_track_id and user_id = identity;
  end if;

  select t.love_count into remaining
  from public.music_tracks t
  where t.id = p_track_id;

  -- Fresh, trigger-computed count so the client never has to guess.
  return coalesce(remaining, 0);
end;
$$;

revoke all on function public.toggle_music_love(uuid, text, boolean) from public;
grant execute on function public.toggle_music_love(uuid, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
