-- Disposable database only; exercise the real 041 RPC plus the 044 trigger.
\set ON_ERROR_STOP on
reset role;
select set_config('test.moderator','no',false);
update public.profiles set facebook_id='', designation='Writer' where id='11111111-1111-1111-1111-111111111111';
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ declare r public.submitted_blogs; repeat_row public.submitted_blogs; begin
  select * into r from public.submit_reader_article('99999999-9999-4999-8999-999999999991','Title','Body');
  select * into repeat_row from public.submit_reader_article('99999999-9999-4999-8999-999999999991','Title','Body');
  if r.id is null or r.writer_facebook <> '' or r.writer_designation <> 'Writer' or r.status <> 'Pending' or r.user_id <> auth.uid() or repeat_row.id <> r.id then
    raise exception 'optional facebook, identity or idempotency failed';
  end if;
end $$;
reset role;
update public.profiles set facebook_id='present',designation='   ' where id='11111111-1111-1111-1111-111111111111';
set role authenticated;
do $$ begin
  begin perform public.submit_reader_article('99999999-9999-4999-8999-999999999992','Title','Body'); raise exception 'missing identity allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Neither the new profile rule nor a permissive Facebook value bypasses Terms
-- or the 044 publishing restrictions.
insert into auth.users(id) values ('66666666-6666-4666-8666-666666666666');
insert into public.profiles(id,first_name,last_name,name,avatar_url,about,phone,address,facebook_id,designation,email)
values ('66666666-6666-4666-8666-666666666666','Test','Reader','Test Reader','image','about','phone','address','','Writer','reader@example.test');
set role authenticated;
select set_config('request.jwt.claim.sub','66666666-6666-4666-8666-666666666666',false);
do $$ begin
  begin perform public.submit_reader_article('99999999-9999-4999-8999-999999999993','Title','Body'); raise exception 'terms bypass'; exception when insufficient_privilege then null; end;
end $$;
select public.accept_terms_version('2026-11-21');
reset role;
insert into public.moderation_account_events(request_id,target_user_id,moderator_id,action,reason,previous_status,new_status,expires_at)
values(gen_random_uuid(),'66666666-6666-4666-8666-666666666666','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','restrict_publishing','fixture','none','active',now()+interval '1 hour');
set role authenticated;
do $$ begin
  begin perform public.submit_reader_article('99999999-9999-4999-8999-999999999994','Title','Body'); raise exception 'restriction bypass'; exception when insufficient_privilege then null; end;
end $$;
reset role;
