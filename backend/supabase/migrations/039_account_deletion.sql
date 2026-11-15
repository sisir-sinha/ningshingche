-- 039_account_deletion.sql
--
-- Google Play's User Data policy asks for two things from any app that lets a
-- person create an account: an in-app path to delete the account *and its data*,
-- and a web resource where the same request can be filed without reinstalling the
-- app. This migration is the server half of both.
--
--   public.delete_my_account()            -- called from Settings, authenticated
--   public.request_account_deletion(...)  -- called from account-deletion.html, anon
--   public.account_deletion_requests      -- the queue the editors work from
--
-- What "delete" means here was decided by the schema, not by taste:
--
--   profiles, user_notifications, admin_messages, forum_discussions,
--   forum_replies, forum_reactions   -> ON DELETE CASCADE from auth.users/profiles,
--                                        so they go with the account automatically
--   submitted_blogs.user_id          -> ON DELETE SET NULL: the article survives as
--                                        archive material, detached from the person
--   comments.user_id                 -> ON DELETE SET NULL, same reason
--   music_playlists, music_playlists_tracks, music_loves, reader_activity
--                                    -> plain uuid columns with no FK; deleted here
--   music_tracks / pdf_books the person uploaded
--                                    -> kept, but the uploader name is anonymised,
--                                        because removing a song breaks every saved
--                                        playlist and shared link that points at it.
--   contributor_points               -> computed from rows, never stored, so nothing
--                                        to delete.
--
-- Run this once in the Supabase SQL editor. It is additive and idempotent.

-- ---------------------------------------------------------------- the queue ---
--
-- A request is not an account: most come from people who can no longer sign in
-- (lost the Google account, uninstalled, changed phone). So the row keeps only
-- what an editor needs to find the account, and no password-equivalent material.

create table if not exists public.account_deletion_requests (
    id            uuid primary key default gen_random_uuid(),
    email         text not null,
    google_email  text,
    reason        text not null default 'other'
                  check (reason in ('no-longer-use', 'privacy', 'too-many-emails', 'other')),
    note          text,
    status        text not null default 'pending'
                  check (status in ('pending', 'in-progress', 'done', 'rejected')),
    handled_by    text,
    created_at    timestamptz not null default timezone('utc', now()),
    updated_at    timestamptz not null default timezone('utc', now())
);

create index if not exists account_deletion_requests_status_idx
    on public.account_deletion_requests (status, created_at desc);

create index if not exists account_deletion_requests_email_idx
    on public.account_deletion_requests (lower(email));

alter table public.account_deletion_requests enable row level security;

-- No select for anyone but the dashboard: the queue holds email addresses.
drop policy if exists "account_deletion_requests_dashboard_select"
    on public.account_deletion_requests;
create policy "account_deletion_requests_dashboard_select"
    on public.account_deletion_requests
    for select
    to authenticated
    using (public.dashboard_has_permission('settings'));

drop policy if exists "account_deletion_requests_dashboard_update"
    on public.account_deletion_requests;
create policy "account_deletion_requests_dashboard_update"
    on public.account_deletion_requests
    for update
    to authenticated
    using (public.dashboard_has_permission('settings'))
    with check (public.dashboard_has_permission('settings'));

-- ------------------------------------------------------- request from the web ---
--
-- Granted to anon on purpose: a person who cannot sign in must still be able to
-- ask. The function is a write-only sink — it returns nothing and reveals nothing
-- (a caller cannot ask "does this email exist?"), and the insert is rate-limited
-- by a duplicate guard: the same address can file once per day.

create or replace function public.request_account_deletion(
    p_email         text,
    p_google_email  text default null,
    p_reason        text default 'other',
    p_note          text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    clean_email text := lower(btrim(coalesce(p_email, '')));
    clean_google text := nullif(lower(btrim(coalesce(p_google_email, ''))), '');
    clean_reason text := coalesce(nullif(btrim(p_reason), ''), 'other');
    clean_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
    if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'A valid email address is required.' using errcode = '22023';
    end if;

    if clean_reason not in ('no-longer-use', 'privacy', 'too-many-emails', 'other') then
        clean_reason := 'other';
    end if;

    -- One request per address per day: stops a refresh loop from filling the queue.
    if exists (
        select 1
          from public.account_deletion_requests r
         where lower(r.email) = clean_email
           and r.created_at > now() - interval '1 day'
    ) then
        return true;  -- silently accepted; the first request already exists
    end if;

    insert into public.account_deletion_requests (email, google_email, reason, note)
    values (clean_email, clean_google, clean_reason, clean_note);

    return true;
end;
$$;

revoke all on function public.request_account_deletion(text, text, text, text) from public;
grant execute on function public.request_account_deletion(text, text, text, text) to anon, authenticated;

-- ------------------------------------------------------ delete from the app ---
--
-- Signed in only, and it acts on auth.uid() rather than an argument, so one reader
-- can never delete another. SECURITY DEFINER is required because auth.users is not
-- writable by the authenticated role.
--
-- Deleting the auth.users row is what triggers the cascades above; the manual
-- deletes before it exist because those tables carry a bare uuid with no FK.

create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    me uuid := auth.uid();
    removed_playlists integer := 0;
    removed_loves integer := 0;
    removed_activity integer := 0;
    anonymised_tracks integer := 0;
begin
    if me is null then
        raise exception 'Sign in to delete your account.' using errcode = '42501';
    end if;

    -- Playlists and their tracks. music_playlist_tracks cascades from the playlist.
    delete from public.music_playlists where user_id = me;
    get diagnostics removed_playlists = row_count;

    delete from public.music_loves where user_id = me;
    get diagnostics removed_loves = row_count;

    delete from public.reader_activity where user_id = me;
    get diagnostics removed_activity = row_count;

    -- Uploads stay in the archive; the person is detached from them.
    update public.music_tracks
       set user_id = null,
           uploader_name = 'লেখক মুছে ফেলা হয়েছে'
     where user_id = me;
    get diagnostics anonymised_tracks = row_count;

    -- profiles (and through it the forum), notifications and inbox all cascade
    -- from this row; submitted_blogs and comments keep their content and lose the
    -- author (ON DELETE SET NULL).
    delete from auth.users where id = me;

    return jsonb_build_object(
        'ok', true,
        'playlists', removed_playlists,
        'loves', removed_loves,
        'activity_days', removed_activity,
        'anonymised_tracks', anonymised_tracks
    );
end;
$$;

revoke all on function public.delete_my_account() from public;
-- `from public` alone is not enough on Supabase: its default privileges grant
-- EXECUTE on new functions to anon explicitly, and only an explicit revoke takes
-- that back. The body refuses a caller with no session anyway, but a function that
-- can delete an account should not be reachable from the guest role at all.
revoke all on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;

-- The dashboard's own readers list has to keep working after a reader leaves:
-- public_profile() already left-joins profiles, so a missing row reads as a
-- deleted author rather than an error.

comment on table public.account_deletion_requests is
    'Deletion requests filed from account-deletion.html; worked by editors, 30-day target.';
comment on function public.delete_my_account() is
    'Play account-deletion requirement: removes the signed-in reader''s account and personal data.';
