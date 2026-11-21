-- Disposable fixture only; models independent staff and reader sessions.
create or replace function public.dashboard_is_super_admin() returns boolean language sql stable as $$
  select coalesce(current_setting('test.superadmin',true),'')='yes'
$$;
grant insert on public.comments,public.forum_discussions,public.forum_replies,public.music_tracks to anon,authenticated;

alter table public.music_tracks add column title text;
alter table public.music_tracks add column description text;
update public.music_tracks set title='Original title',description='Original excerpt' where id='99999999-9999-9999-9999-999999999999';
