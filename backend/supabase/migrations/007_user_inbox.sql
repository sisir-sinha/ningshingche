-- In-app user notifications and admin messages.
-- Run in the Supabase SQL Editor after 006_reader_workspace.sql.
-- The Android publishable key cannot execute DDL.

begin;

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null default '',
  body text not null default '',
  related_id text not null default '',
  is_read boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  unique (user_id, kind, related_id)
);

create index if not exists user_notifications_user_created_idx
  on public.user_notifications (user_id, created_at desc);

create table if not exists public.admin_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sender text not null check (sender in ('user', 'admin')),
  subject text not null default '',
  body text not null default '',
  is_read boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists admin_messages_user_created_idx
  on public.admin_messages (user_id, created_at desc);

alter table public.user_notifications enable row level security;
alter table public.admin_messages enable row level security;

drop policy if exists user_notifications_select_own on public.user_notifications;
create policy user_notifications_select_own
  on public.user_notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_notifications_insert_own on public.user_notifications;
create policy user_notifications_insert_own
  on public.user_notifications for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_notifications_update_own on public.user_notifications;
create policy user_notifications_update_own
  on public.user_notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists admin_messages_select_own on public.admin_messages;
create policy admin_messages_select_own
  on public.admin_messages for select to authenticated
  using (user_id = auth.uid());

drop policy if exists admin_messages_insert_user on public.admin_messages;
create policy admin_messages_insert_user
  on public.admin_messages for insert to authenticated
  with check (user_id = auth.uid() and sender = 'user');

create or replace function public.notify_user_on_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  nkind text;
  ntitle text;
  nbody text;
begin
  if tg_table_name = 'comments' then
    if new.status is distinct from 'Publish' then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.status = 'Publish' then
      return new;
    end if;
    uid := new.user_id;
    nkind := 'comment_published';
    ntitle := 'মন্তব্য প্রকাশিত হয়েছে';
    nbody := coalesce(nullif(btrim(new.content), ''), 'আপনার মন্তব্য প্রকাশিত হয়েছে।');
  else
    if new.status not in ('Published', 'Approved') then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.status in ('Published', 'Approved') then
      return new;
    end if;
    uid := new.user_id;
    nkind := 'article_published';
    ntitle := 'প্রবন্ধ প্রকাশিত হয়েছে';
    nbody := coalesce(nullif(btrim(new.title), ''), 'আপনার প্রবন্ধ প্রকাশিত হয়েছে।');
  end if;

  if uid is null then
    return new;
  end if;

  insert into public.user_notifications (user_id, kind, title, body, related_id)
  values (uid, nkind, ntitle, left(nbody, 280), new.id::text)
  on conflict (user_id, kind, related_id) do nothing;

  return new;
end;
$$;

drop trigger if exists comments_notify_publish on public.comments;
create trigger comments_notify_publish
  after insert or update of status on public.comments
  for each row execute function public.notify_user_on_publish();

drop trigger if exists submitted_blogs_notify_publish on public.submitted_blogs;
create trigger submitted_blogs_notify_publish
  after insert or update of status on public.submitted_blogs
  for each row execute function public.notify_user_on_publish();

create or replace function public.notify_user_on_admin_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sender is distinct from 'admin' then
    return new;
  end if;
  insert into public.user_notifications (user_id, kind, title, body, related_id)
  values (
    new.user_id,
    'admin_message',
    coalesce(nullif(btrim(new.subject), ''), 'অ্যাডমিনের বার্তা'),
    left(coalesce(new.body, ''), 280),
    new.id::text
  )
  on conflict (user_id, kind, related_id) do nothing;
  return new;
end;
$$;

drop trigger if exists admin_messages_notify_user on public.admin_messages;
create trigger admin_messages_notify_user
  after insert on public.admin_messages
  for each row execute function public.notify_user_on_admin_message();

commit;
