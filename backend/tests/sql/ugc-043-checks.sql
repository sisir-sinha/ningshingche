\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ declare kind text; item text; begin
  foreach kind in array array['discussion','reply','comment','music'] loop
    item := case kind when 'discussion' then '66666666-6666-6666-6666-666666666666' when 'reply' then '77777777-7777-7777-7777-777777777777' when 'comment' then '88888888-8888-8888-8888-888888888888' else '99999999-9999-9999-9999-999999999999' end;
    perform public.report_content(kind,item,'spam',null,'11111111-1111-1111-1111-111111111111', 'spoof');
    perform public.report_content(kind,upper(item),'hate',null,null,null);
  end loop;
  begin perform public.report_content('discussion','00000000-0000-0000-0000-000000000000','spam'); raise exception 'missing target accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.report_content('music','bad','spam'); raise exception 'invalid UUID accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.report_content('music','99999999-9999-9999-9999-999999999999','invalid'); raise exception 'bad reason accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.dashboard_moderate_report(gen_random_uuid(),'review',''); raise exception 'reader could moderate'; exception when insufficient_privilege then null; end;
  begin update public.content_reports set status='dismissed'; raise exception 'direct update worked'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
select set_config('request.jwt.claim.sub','',false);
do $$ begin
  begin perform public.report_content('ai_output','anything','spam'); raise exception 'guest report accepted'; exception when insufficient_privilege then null; end;
end $$;
select set_config('test.moderator','yes',false);
do $$ declare rid uuid; result jsonb; begin
  select id into rid from public.content_reports where content_type='discussion';
  if (select count(*) from public.content_reports where content_type='discussion') <> 1 then raise exception 'duplicate'; end if;
  if (select reported_user_id from public.content_reports where id=rid) <> '22222222-2222-2222-2222-222222222222'::uuid then raise exception 'spoofed owner'; end if;
  result := public.dashboard_moderate_report(rid,'review','');
  begin perform public.dashboard_moderate_report(rid,'remove',''); raise exception 'empty reason accepted'; exception when invalid_parameter_value then null; end;
  result := public.dashboard_moderate_report(rid,'remove','Violates community rules');
  if result->>'status' <> 'actioned' then raise exception 'resolution missing'; end if;
  if (select count(*) from public.content_report_audit where report_id=rid and action='unpublish_content' and moderator_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and decision_reason='Violates community rules') <> 1 then raise exception 'content audit missing'; end if;
  begin perform public.dashboard_moderate_report(rid,'remove','again'); raise exception 'closed case modified'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ begin if (select status from public.forum_discussions where id='66666666-6666-6666-6666-666666666666') <> 'Unpublish' then raise exception 'content still published'; end if; end $$;
\echo '043 fixture checks passed'
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ declare i integer; begin
  for i in 1..30 loop perform public.report_content('ai_output','rate-test-'||i,'spam'); end loop;
  -- Idempotent repeats do not spend another quota slot.
  perform public.report_content('ai_output','rate-test-1','hate');
  begin perform public.report_content('ai_output','rate-test-31','spam'); raise exception '31st report accepted';
  exception when raise_exception then if sqlerrm <> 'Report limit reached' then raise; end if; end;
end $$;
reset role;
