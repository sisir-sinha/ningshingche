\set ON_ERROR_STOP on
-- A fresh account without Terms cannot use any direct insert even with a forged ID.
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select set_config('test.moderator','',false);
select set_config('test.superadmin','',false);
do $$ begin
  begin insert into public.music_tracks(id,user_id) values(gen_random_uuid(),auth.uid()); raise exception 'music bypass'; exception when insufficient_privilege then null; end;
  begin insert into public.forum_discussions(id,user_id,status) values(gen_random_uuid(),auth.uid(),'Publish'); raise exception 'forum bypass'; exception when insufficient_privilege then null; end;
  begin insert into public.forum_replies(id,user_id,status) values(gen_random_uuid(),auth.uid(),'Publish'); raise exception 'reply bypass'; exception when insufficient_privilege then null; end;
  begin insert into public.comments(id,user_id,status) values(gen_random_uuid(),auth.uid(),'Unpublish'); raise exception 'comment bypass'; exception when insufficient_privilege then null; end;
  begin perform public.dashboard_account_action(gen_random_uuid(),auth.uid(),'warning','reason'); raise exception 'reader can enforce'; exception when insufficient_privilege then null; end;
  begin perform public.submit_moderation_appeal(gen_random_uuid(),'This explanation is more than twenty characters.'); raise exception 'foreign appeal'; exception when invalid_parameter_value then null; end;
end $$;
select public.accept_terms_version('2026-11-21');
do $$ begin
  insert into public.music_tracks(id,user_id) values(gen_random_uuid(),auth.uid());
  begin insert into public.music_tracks(id,user_id) values(gen_random_uuid(),'11111111-1111-1111-1111-111111111111'); raise exception 'spoof allowed'; exception when insufficient_privilege then null; end;
  insert into public.music_tracks(id,user_id) values('dddddddd-dddd-dddd-dddd-dddddddddddd',null);

  begin perform count(*) from public.moderation_account_events; raise exception 'reader sees events table'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Anonymous comments remain supported, but cannot impersonate an account.
set role anon;
select set_config('request.jwt.claim.sub','',false);
do $$ begin
  insert into public.comments(id,user_id,status) values(gen_random_uuid(),null,'Unpublish');
  begin insert into public.comments(id,user_id,status) values(gen_random_uuid(),'11111111-1111-1111-1111-111111111111','Unpublish'); raise exception 'guest spoof'; exception when insufficient_privilege then null; end;
  begin perform public.dashboard_account_action(gen_random_uuid(),'22222222-2222-2222-2222-222222222222','warning','reason'); raise exception 'anon can enforce'; exception when insufficient_privilege then null; end;
end $$;
-- A forum moderator is not automatically a super admin.
select set_config('test.moderator','yes',false);
do $$ begin
  begin perform public.dashboard_account_action(gen_random_uuid(),'22222222-2222-2222-2222-222222222222','warning','reason'); raise exception 'moderator can restrict'; exception when insufficient_privilege then null; end;
end $$;
select set_config('test.superadmin','yes',false);
do $$ declare e jsonb; again jsonb; begin
  perform public.dashboard_account_action('aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','warning','A formal warning');
  e:=public.dashboard_account_action('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','restrict_forum','A valid reason', now()+interval '1 day');
  -- Idempotency with a stored expiration, rather than a new now().
  again:=public.dashboard_account_action('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','restrict_forum','A valid reason',(e->>'expires_at')::timestamptz);
  if e->>'id' <> again->>'id' or e->>'moderator_id' <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' then raise exception 'idempotency or attribution'; end if;
  begin perform public.dashboard_account_action('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','warning','Changed'); raise exception 'request reuse'; exception when invalid_parameter_value then null; end;
  begin perform public.dashboard_account_action(gen_random_uuid(),'22222222-2222-2222-2222-222222222222','restrict_forum','reason',now()+interval '1 day'); raise exception 'duplicate active restriction'; exception when invalid_parameter_value then null; end;
  begin perform public.dashboard_account_action(gen_random_uuid(),'22222222-2222-2222-2222-222222222222','suspend','reason',now()-interval '1 day'); raise exception 'past expiration'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
set role authenticated;
select set_config('test.moderator','',false);
select set_config('test.superadmin','',false);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ declare e uuid; a uuid; begin
  select id into e from public.my_moderation_actions() where action='restrict_forum';
  if e is null then raise exception 'own history missing'; end if;
  begin insert into public.forum_discussions(id,user_id,status) values(gen_random_uuid(),auth.uid(),'Publish'); raise exception 'restriction bypass'; exception when insufficient_privilege then null; end;
  -- Other scopes remain writable.
  insert into public.music_tracks(id,user_id) values(gen_random_uuid(),auth.uid());
  a:=public.submit_moderation_appeal(e,'This decision should be reviewed because it is mistaken.');
  if a<>public.submit_moderation_appeal(e,'This decision should be reviewed because it is mistaken.') then raise exception 'duplicate appeal'; end if;
  begin perform public.submit_moderation_appeal(e,'This is another new explanation to review carefully.'); raise exception 'multiple active appeals'; exception when invalid_parameter_value then null; end;
  if (select count(*) from public.my_moderation_appeals())<>1 then raise exception 'own appeal missing'; end if;
end $$;
reset role;
set role anon;
select set_config('request.jwt.claim.sub','',false);
select set_config('test.moderator','yes',false);
select set_config('test.superadmin','yes',false);
do $$ declare e uuid; a uuid; begin
  select id into e from public.dashboard_account_history('22222222-2222-2222-2222-222222222222') where action='restrict_forum';
  -- Retrieve fixture-created appeal as owner in a later check, not through a client table grant.
  begin perform count(*) from public.moderation_appeals; raise exception 'direct access allowed'; exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin if (select user_id from public.music_tracks where id='dddddddd-dddd-dddd-dddd-dddddddddddd') <> '22222222-2222-2222-2222-222222222222'::uuid then raise exception 'server identity not assigned'; end if; end $$;
-- Operator obtains the synthetic ID solely for fixture driving.
select set_config('test.appeal_id',(select id::text from public.moderation_appeals limit 1),false);
set role anon;
select set_config('test.moderator','yes',false);
select set_config('test.superadmin','yes',false);
do $$ declare a uuid:=current_setting('test.appeal_id')::uuid; result jsonb; e uuid; begin
  result:=public.dashboard_decide_appeal(a,'review','');
  begin perform public.dashboard_decide_appeal(a,'accept',''); raise exception 'missing reason accepted'; exception when invalid_parameter_value then null; end;
  result:=public.dashboard_decide_appeal(a,'accept','New information accepted');
  if result->>'status'<>'accepted' then raise exception 'appeal outcome'; end if;
  select id into e from public.dashboard_account_history('22222222-2222-2222-2222-222222222222') where action='restrict_forum';
  perform public.dashboard_account_action('cccccccc-cccc-cccc-cccc-cccccccccccc','22222222-2222-2222-2222-222222222222','lift','Reason to lift',null,e);
end $$;
reset role;
do $$ begin
  if (select count(*) from public.moderation_appeal_audit where moderator_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and new_status in ('reviewing','accepted'))<>2 then raise exception 'appeal audit missing'; end if;
  if not exists(select 1 from public.moderation_account_events where action='warning' and target_user_id='22222222-2222-2222-2222-222222222222' and moderator_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and reason='A formal warning') then raise exception 'warning audit missing'; end if;
end $$;
set role authenticated;
select set_config('test.moderator','',false);
select set_config('test.superadmin','',false);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
  insert into public.forum_discussions(id,user_id,status) values(gen_random_uuid(),auth.uid(),'Publish');
  if (select status from public.my_moderation_appeals() limit 1) <> 'accepted' then raise exception 'appeal missing outcome'; end if;
end $$;
reset role;
\echo '044 fixture checks passed'

-- Time-based expiration is derived from server time, not an automatic suspension.
insert into public.moderation_account_events(request_id,target_user_id,moderator_id,action,reason,previous_status,new_status,expires_at)
values(gen_random_uuid(),'22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','restrict_comments','Expired test','none','active',now()-interval '1 second');
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin insert into public.comments(id,user_id,status) values(gen_random_uuid(),auth.uid(),'Unpublish'); end $$;
reset role;
