\set ON_ERROR_STOP on
set role authenticated;
select set_config('test.moderator','',false);
select set_config('test.superadmin','',false);
do $$ begin
  if (select count(*) from public.moderation_policy_catalog()) <> 11 then raise exception 'catalog missing'; end if;
  begin perform public.dashboard_update_moderation_policy('spam','Spam','Description','low',array['article'],'review',true,'reason'); raise exception 'reader changed policy'; exception when insufficient_privilege then null; end;
  begin update public.moderation_policy_categories set severity='high'; raise exception 'direct policy update'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
select set_config('test.moderator','yes',false);
select set_config('test.superadmin','yes',false);
do $$ begin
  begin perform public.dashboard_update_moderation_policy('spam','Spam','Description','low',array['invalid'],'review',true,'reason'); raise exception 'invalid content type'; exception when invalid_parameter_value then null; end;
  perform public.dashboard_update_moderation_policy('spam','Spam','Description for spam','medium',array['article','reply'],'review',true,'Policy clarified');
end $$;
reset role;
do $$ begin
  if (select count(*) from public.moderation_policy_audit where policy_code='spam' and moderator_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and reason='Policy clarified' and previous_value->>'severity'='low' and new_value->>'severity'='medium') <> 1 then raise exception 'missing policy audit'; end if;
end $$;
\echo '046 fixture checks passed'
