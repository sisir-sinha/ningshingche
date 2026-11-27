-- Tests 050 RLS and the actual 044 terms/restriction BEFORE INSERT trigger together.
set role anon;
select set_config('request.jwt.claim.sub','',false);
select set_config('request.jwt.claims','{}',false);
select set_config('test.moderator','no',false);
do $$ begin
  if not exists(select 1 from public.comments where id='88888888-8888-8888-8888-888888888888') then raise exception 'historic public comment missing'; end if;
  begin insert into public.comments(id,user_id,status) values(gen_random_uuid(),null,'Unpublish'); raise exception 'guest allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
select set_config('request.jwt.claims','{"is_anonymous":false}',false);
do $$ begin
  begin insert into public.comments(id,user_id,status) values(gen_random_uuid(),auth.uid(),'Unpublish'); raise exception 'terms not enforced'; exception when insufficient_privilege then null; end;
end $$;
select public.accept_terms_version('2026-11-21');
do $$ begin
  begin insert into public.comments(id,user_id,status) values(gen_random_uuid(),'11111111-1111-1111-1111-111111111111','Unpublish'); raise exception 'spoof allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.comments(id,user_id,status) values(gen_random_uuid(),auth.uid(),'Publish'); raise exception 'self approval allowed'; exception when insufficient_privilege then null; end;
  insert into public.comments(id,user_id,status) values(gen_random_uuid(),auth.uid(),'Unpublish');
end $$;
select set_config('request.jwt.claims','{"is_anonymous":true}',false);
do $$ begin
  begin insert into public.comments(id,user_id,status) values(gen_random_uuid(),auth.uid(),'Unpublish'); raise exception 'anonymous auth allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.moderation_account_events(request_id,target_user_id,moderator_id,action,reason,previous_status,new_status,expires_at)
values(gen_random_uuid(),'55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','restrict_comments','fixture','none','active',now()+interval '1 hour');
set role authenticated;
select set_config('request.jwt.claims','{}',false);
do $$ begin
  begin insert into public.comments(id,user_id,status) values(gen_random_uuid(),auth.uid(),'Unpublish'); raise exception 'restriction bypass'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
select set_config('request.jwt.claim.sub','',false);
select set_config('test.moderator','yes',false);
insert into public.comments(id,user_id,status) values(gen_random_uuid(),null,'Publish');
reset role;
