-- User B accepted the current version in 044. Simulate a SECURITY DEFINER update
-- as table owner while keeping B's JWT; no fixture shortcut around trigger logic.
select set_config('test.moderator','no',false);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
update public.forum_replies set body='allowed edit' where id='77777777-7777-7777-7777-777777777777';
insert into public.moderation_account_events(request_id,target_user_id,moderator_id,action,reason,previous_status,new_status,expires_at)
values(gen_random_uuid(),auth.uid(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','restrict_forum','fixture','none','active',now()+interval '1 hour');
do $$ begin
  begin update public.forum_replies set body='forbidden' where id='77777777-7777-7777-7777-777777777777'; raise exception 'restricted edit accepted'; exception when insufficient_privilege then null; end;
  -- Counters and moderation status remain writable, and deletion is not blocked.
  update public.forum_discussions set replies_count=42 where id='66666666-6666-6666-6666-666666666666';
end $$;
select set_config('test.moderator','yes',false);
update public.forum_replies set body='moderator edit' where id='77777777-7777-7777-7777-777777777777';
select set_config('test.moderator','no',false);
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ begin
  begin update public.forum_replies set body='spoof' where id='77777777-7777-7777-7777-777777777777'; raise exception 'foreign edit accepted'; exception when insufficient_privilege then null; end;
end $$;
