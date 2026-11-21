select set_config('test.evidence_report',(select report_id::text from public.moderation_report_evidence limit 1),false);
select set_config('test.moderator','no',false);
set role authenticated;
do $$ begin
  begin perform public.dashboard_report_evidence(current_setting('test.evidence_report')::uuid); raise exception 'unauthorized evidence'; exception when insufficient_privilege then null; end;
  begin perform count(*) from public.moderation_evidence_access_audit; raise exception 'audit exposed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('test.moderator','yes',false);
set role anon;
select public.dashboard_report_evidence(current_setting('test.evidence_report')::uuid);
select public.dashboard_report_evidence(gen_random_uuid());
reset role;
do $$ begin
  if (select count(*) from public.moderation_evidence_access_audit) <> 1 then raise exception 'evidence access audit incorrect'; end if;
  if not exists(select 1 from public.moderation_evidence_access_audit where report_id=current_setting('test.evidence_report')::uuid and dashboard_user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') then raise exception 'incorrect staff audit identity'; end if;
end $$;
