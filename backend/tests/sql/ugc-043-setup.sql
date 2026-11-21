-- Minimal continuation fixture, not production schema.
create table public.forum_discussions(id uuid primary key,user_id uuid,status text);
create table public.forum_replies(id uuid primary key,discussion_id uuid,user_id uuid,status text);
create table public.comments(id uuid primary key,blog_id uuid,user_id uuid,status text);
create table public.music_tracks(id uuid primary key,user_id uuid);
insert into public.forum_discussions values ('66666666-6666-6666-6666-666666666666','22222222-2222-2222-2222-222222222222','Publish');
insert into public.forum_replies values ('77777777-7777-7777-7777-777777777777','66666666-6666-6666-6666-666666666666','22222222-2222-2222-2222-222222222222','Publish');
insert into public.comments values ('88888888-8888-8888-8888-888888888888','33333333-3333-3333-3333-333333333333',null,'Publish');
insert into public.music_tracks values ('99999999-9999-9999-9999-999999999999','22222222-2222-2222-2222-222222222222');
