\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select set_config('test.moderator','',false);
do $$ begin
  perform public.report_content('music','99999999-9999-9999-9999-999999999999','hate'); -- duplicate, no new evidence
  perform public.report_content('article','33333333-3333-3333-3333-333333333333','spam'); -- duplicate
  perform public.report_content('profile','22222222-2222-2222-2222-222222222222','spam'); -- duplicate
  begin perform public.dashboard_report_evidence(gen_random_uuid()); raise exception 'reader can read evidence'; exception when insufficient_privilege then null; end;
  begin perform count(*) from public.moderation_report_evidence; raise exception 'evidence table exposed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- B already used its report quota in 043 tests, so add an isolated synthetic account.
insert into auth.users values('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
set role authenticated;
select set_config('request.jwt.claim.sub','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',false);
select public.report_content('music','99999999-9999-9999-9999-999999999999','spam');
select public.report_content('ai_output','unverified-answer','spam');
reset role;
update public.music_tracks set title='Changed title',description='Changed excerpt' where id='99999999-9999-9999-9999-999999999999';
do $$ begin
  if (select snapshot from public.moderation_report_evidence where content_type='music') not like '%Original excerpt%' then raise exception 'evidence did not preserve original'; end if;
  if (select count(*) from public.moderation_report_evidence where content_type='music') <> 1 then raise exception 'evidence missing'; end if;
  if exists (select 1 from public.moderation_report_evidence where content_type='ai_output') then raise exception 'AI evidence falsely verified'; end if;
end $$;
select set_config('test.evidence_report',(select report_id::text from public.moderation_report_evidence limit 1),false);
set role anon;
select set_config('test.moderator','yes',false);
do $$ declare id uuid; evidence jsonb; begin
  -- In a real request the queue gives the moderator the report ID.
  id := current_setting('test.evidence_report',true)::uuid;
  evidence := public.dashboard_report_evidence(id);
  if evidence->>'content_type' <> 'music' or evidence->>'snapshot' not like '%Original title%' or evidence->>'author_id' <> '22222222-2222-2222-2222-222222222222' then raise exception 'incorrect evidence'; end if;
end $$;
reset role;
\echo '045 fixture checks passed'
