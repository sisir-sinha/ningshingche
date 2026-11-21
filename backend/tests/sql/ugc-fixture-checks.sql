-- Run ONLY in a disposable fixture database with simulated auth and dashboard
-- identity functions. These tests deliberately write data; never run in production.
\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$
begin
  begin
    perform public.submit_reader_article('55555555-5555-5555-5555-555555555555','Title','Body');
    raise exception 'submission without consent was accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.accept_terms_version('2026-10-26');
    raise exception 'old version was accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.accept_current_terms();
    raise exception 'old acceptance RPC still executable';
  exception when insufficient_privilege then null; end;
end $$;
select public.accept_terms_version('2026-11-21');
select public.accept_terms_version('2026-11-21');
do $$
declare first_row public.submitted_blogs; again public.submitted_blogs;
begin
  if (select count(*) from public.user_terms_acceptances) <> 1 then raise exception 'acceptance not idempotent'; end if;
  select * into first_row from public.submit_reader_article('55555555-5555-5555-5555-555555555555','Title','Body');
  select * into again from public.submit_reader_article('55555555-5555-5555-5555-555555555555','Title','Body');
  if first_row.status <> 'Pending' or first_row.user_id <> auth.uid() or again.id <> first_row.id then
    raise exception 'submission identity/status/idempotency failed';
  end if;
  update public.submitted_blogs set converted_blog_id = '33333333-3333-3333-3333-333333333333' where id = first_row.id;
  if found then raise exception 'reader changed pending moderation metadata'; end if;
  perform public.report_content('article','33333333-3333-3333-3333-333333333333','impersonation','note','11111111-1111-1111-1111-111111111111',null);
  perform public.report_content('article','33333333-3333-3333-3333-333333333333','spam',null,null,null);
  perform public.report_content('profile','22222222-2222-2222-2222-222222222222','harassment',null,null,null);
  begin
    perform public.report_content('profile','11111111-1111-1111-1111-111111111111','spam',null,null,null);
    raise exception 'self report accepted';
  exception when invalid_parameter_value then null; end;
  if (select count(*) from public.content_reports) <> 0 then raise exception 'reader can read reports'; end if;
  if (select count(*) from public.content_report_audit) <> 0 then raise exception 'reader can read audit'; end if;
  perform public.block_user('22222222-2222-2222-2222-222222222222');
  if not ('22222222-2222-2222-2222-222222222222'::uuid = any(public.my_blocked_users())) then raise exception 'block missing'; end if;
  perform public.unblock_user('22222222-2222-2222-2222-222222222222');
  if cardinality(public.my_blocked_users()) <> 0 then raise exception 'unblock failed'; end if;
end $$;
reset role;
set role anon;
select set_config('request.jwt.claim.sub','',false);
do $$ begin
  begin
    perform public.report_content('article','33333333-3333-3333-3333-333333333333','spam',null,null,'device');
    raise exception 'guest article report accepted';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.content_reports) <> 0 then raise exception 'anonymous report read'; end if;
end $$;
select set_config('test.moderator','yes',false);
do $$
declare rid uuid;
begin
  if (select count(*) from public.content_reports) <> 2 then raise exception 'duplicate or missing reports'; end if;
  if (select reported_user_id from public.content_reports where content_type='article') <> '22222222-2222-2222-2222-222222222222'::uuid then
    raise exception 'article attribution was forged';
  end if;
  select id into rid from public.content_reports where content_type='article';
  update public.content_reports set status='reviewing',handled_by='forged' where id=rid;
  if (select count(*) from public.content_report_audit where report_id=rid and previous_status='open' and new_status='reviewing' and moderator_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') <> 1 then
    raise exception 'audit missing';
  end if;
  if (select handled_by from public.content_reports where id=rid) <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' then raise exception 'forged moderator'; end if;
  begin
    update public.content_reports set reason='other' where id=rid;
    raise exception 'report details changed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
\echo 'UGC fixture checks passed'
