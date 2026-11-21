-- Exercise the view as its owner to model SECURITY DEFINER reads and RLS as the reader.
update public.forum_discussions set status='Publish' where id='66666666-6666-6666-6666-666666666666';
update public.forum_replies set status='Publish' where id='77777777-7777-7777-7777-777777777777';
insert into public.user_blocks(blocker_id,blocked_id) values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222') on conflict do nothing;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select set_config('test.moderator','no',false);
do $$ begin
  if exists(select 1 from public.forum_discussion_rows where id='66666666-6666-6666-6666-666666666666') then raise exception 'blocked discussion leaked through view'; end if;
  if exists(select 1 from public.forum_reply_rows where id='77777777-7777-7777-7777-777777777777') then raise exception 'blocked reply leaked through view'; end if;
  begin
    insert into public.forum_replies(id,discussion_id,user_id,status) values('12340000-0000-0000-0000-000000000000','66666666-6666-6666-6666-666666666666',auth.uid(),'Publish');
    raise exception 'blocked interaction accepted';
  exception when insufficient_privilege then null; end;
end $$;
set role authenticated;
do $$ begin
  if exists(select 1 from public.forum_discussions where id='66666666-6666-6666-6666-666666666666') then raise exception 'blocked discussion leaked through RLS'; end if;
  if exists(select 1 from public.forum_replies where id='77777777-7777-7777-7777-777777777777') then raise exception 'blocked reply leaked through RLS'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',false);
do $$ begin
  if not exists(select 1 from public.forum_discussion_rows where id='66666666-6666-6666-6666-666666666666') then raise exception 'guest public visibility broken'; end if;
end $$;
update public.forum_discussions set status='Unpublish' where id='66666666-6666-6666-6666-666666666666';
do $$ begin
  if exists(select 1 from public.forum_discussion_rows where id='66666666-6666-6666-6666-666666666666') or exists(select 1 from public.forum_reply_rows where id='77777777-7777-7777-7777-777777777777') then raise exception 'unpublished thread leaked'; end if;
end $$;
update public.forum_discussions set status='Publish' where id='66666666-6666-6666-6666-666666666666';
-- Reverse direction: the target blocked the current actor.
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select set_config('test.moderator','yes',false);
insert into public.forum_discussions(id,user_id,status) values('56780000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','Publish');
select set_config('test.moderator','no',false);
do $$ begin
  begin
    insert into public.forum_replies(id,discussion_id,user_id,status) values('12340000-0000-0000-0000-000000000001','56780000-0000-0000-0000-000000000000',auth.uid(),'Publish');
    raise exception 'reverse blocked interaction accepted';
  exception when insufficient_privilege then null; end;
end $$;
