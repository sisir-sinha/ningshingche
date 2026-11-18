-- 040_content_safety.sql
--
-- Google Play's User Generated Content policy asks an app that hosts reader
-- content for four things: terms that forbid objectionable content, a way to
-- report content, a way to block a person, and someone who acts on the reports.
--
-- This migration is the middle two. The terms are backend/terms.html; the acting
-- is the dashboard queue the rows land in.
--
--   public.report_content(...)   -- anon and authenticated: a guest can complain
--   public.block_user(uuid)      -- authenticated: blocking is a personal setting
--   public.unblock_user(uuid)
--   public.my_blocked_users()    -- what the app filters with
--
-- Reporting is deliberately open to guests. A reader who is not signed in can
-- still see the forum and its comments, so they can still see something that
-- should not be there; making them create an account first is how a report never
-- arrives. The row therefore carries either a user id or a device id, never a
-- name the reporter typed.
--
-- Run once in the Supabase SQL editor. Additive and idempotent.

create table if not exists public.content_reports (
    id               uuid primary key default gen_random_uuid(),
    -- 'discussion' | 'reply' | 'comment' | 'profile' | 'music' | 'ai_output'
    content_type     text not null check (content_type in
                        ('discussion', 'reply', 'comment', 'profile', 'music', 'ai_output')),
    -- The row's id. Text, not uuid: an AI report has no row of its own yet and
    -- carries the exchange's own key.
    content_id       text not null default '',
    -- Who wrote the thing, when the app knows. Null for an anonymous comment.
    reported_user_id uuid,
    reporter_user_id uuid,
    reporter_device  text,
    reason           text not null check (reason in
                        ('harassment', 'hate', 'sexual', 'violence', 'spam',
                         'copyright', 'misinformation', 'other')),
    note             text,
    -- What the dashboard did about it. Nothing is deleted automatically: a human
    -- reads the report, because a silent auto-removal on one tap is a tool for
    -- silencing people.
    status           text not null default 'open'
                     check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
    handled_by       text,
    created_at       timestamptz not null default timezone('utc', now()),
    updated_at       timestamptz not null default timezone('utc', now())
);

create index if not exists content_reports_status_idx
    on public.content_reports (status, created_at desc);
create index if not exists content_reports_target_idx
    on public.content_reports (content_type, content_id);
create index if not exists content_reports_user_idx
    on public.content_reports (reported_user_id);

alter table public.content_reports enable row level security;

-- Only the dashboard reads reports, and only a role that can already moderate the
-- forum. A reporter never sees their own report back — that would tell anyone who
-- tests an id whether it exists.
drop policy if exists "content_reports_dashboard_select" on public.content_reports;
create policy "content_reports_dashboard_select"
    on public.content_reports
    for select
    to authenticated
    using (public.dashboard_has_permission('forum'));

drop policy if exists "content_reports_dashboard_update" on public.content_reports;
create policy "content_reports_dashboard_update"
    on public.content_reports
    for update
    to authenticated
    using (public.dashboard_has_permission('forum'))
    with check (public.dashboard_has_permission('forum'));

-- ------------------------------------------------------------------ blocking ---
--
-- A block is one-directional and private: the blocked person is never told, and
-- the blocker's app hides that person's answers. Kept as its own table so it
-- survives a device change, which a local setting would not.

create table if not exists public.user_blocks (
    blocker_id uuid not null,
    blocked_id uuid not null,
    created_at timestamptz not null default timezone('utc', now()),
    primary key (blocker_id, blocked_id),
    check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

drop policy if exists "user_blocks_own_select" on public.user_blocks;
create policy "user_blocks_own_select"
    on public.user_blocks
    for select
    to authenticated
    using (blocker_id = auth.uid());

drop policy if exists "user_blocks_own_delete" on public.user_blocks;
create policy "user_blocks_own_delete"
    on public.user_blocks
    for delete
    to authenticated
    using (blocker_id = auth.uid());

-- ---------------------------------------------------------------------- RPCs ---

create or replace function public.report_content(
    p_content_type text,
    p_content_id   text,
    p_reason       text,
    p_note         text default null,
    p_reported_user uuid default null,
    p_device_id    text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    me uuid := auth.uid();
    clean_type text := coalesce(nullif(btrim(p_content_type), ''), 'other');
    clean_reason text := coalesce(nullif(btrim(p_reason), ''), 'other');
    clean_id text := coalesce(btrim(p_content_id), '');
    clean_note text := nullif(btrim(coalesce(p_note, '')), '');
    clean_device text := nullif(btrim(coalesce(p_device_id, '')), '');
begin
    if clean_type not in ('discussion', 'reply', 'comment', 'profile', 'music', 'ai_output') then
        raise exception 'Unknown content type: %', clean_type using errcode = '22023';
    end if;

    if clean_reason not in ('harassment', 'hate', 'sexual', 'violence', 'spam',
                            'copyright', 'misinformation', 'other') then
        clean_reason := 'other';
    end if;

    if me is null and clean_device is null then
        -- A guest has to be attributable to something, or the queue fills with
        -- rows nobody can triage and one person can empty it in a minute.
        raise exception 'A device id is required to report without signing in.'
            using errcode = '22023';
    end if;

    -- One report per reporter per item. A second tap is a no-op, not an error:
    -- the reader has already been heard.
    if exists (
        select 1
          from public.content_reports r
         where r.content_type = clean_type
           and r.content_id = clean_id
           and (
                (me is not null and r.reporter_user_id = me)
             or (me is null and r.reporter_device = clean_device)
           )
    ) then
        return true;
    end if;

    insert into public.content_reports (
        content_type, content_id, reported_user_id, reporter_user_id,
        reporter_device, reason, note
    ) values (
        clean_type, clean_id, p_reported_user, me,
        case when me is null then clean_device else null end, clean_reason, clean_note
    );

    return true;
end;
$$;

revoke all on function public.report_content(text, text, text, text, uuid, text) from public;
grant execute on function public.report_content(text, text, text, text, uuid, text)
    to anon, authenticated;

create or replace function public.block_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    me uuid := auth.uid();
begin
    if me is null then
        raise exception 'Sign in to block someone.' using errcode = '42501';
    end if;
    if p_user_id is null or p_user_id = me then
        return false;
    end if;

    insert into public.user_blocks (blocker_id, blocked_id)
    values (me, p_user_id)
    on conflict (blocker_id, blocked_id) do nothing;

    return true;
end;
$$;

revoke all on function public.block_user(uuid) from public;
-- Supabase grants EXECUTE on new functions to anon by default; `from public`
-- does not remove it. These three are signed-in-only, so take it back explicitly.
revoke all on function public.block_user(uuid) from anon;
grant execute on function public.block_user(uuid) to authenticated;

create or replace function public.unblock_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    me uuid := auth.uid();
begin
    if me is null then
        raise exception 'Sign in to change your blocks.' using errcode = '42501';
    end if;

    delete from public.user_blocks b
     where b.blocker_id = me and b.blocked_id = p_user_id;

    return true;
end;
$$;

revoke all on function public.unblock_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from anon;
grant execute on function public.unblock_user(uuid) to authenticated;

-- The ids the app hides, in one call at startup. An array, not a table: there are
-- rarely more than a handful, and the client needs all of them at once.
create or replace function public.my_blocked_users()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(array_agg(b.blocked_id), '{}'::uuid[])
      from public.user_blocks b
     where b.blocker_id = auth.uid();
$$;

revoke all on function public.my_blocked_users() from public;
revoke all on function public.my_blocked_users() from anon;
grant execute on function public.my_blocked_users() to authenticated;

comment on table public.content_reports is
    'Play UGC policy: in-app reports (forum, comments, profiles, AI output), worked from the dashboard.';
comment on table public.user_blocks is
    'Play UGC policy: per-reader blocks; private, one-directional, never announced.';
