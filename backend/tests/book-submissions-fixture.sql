-- Run ONLY against a disposable database with the fixture auth/dashboard mocks.
-- This intentionally rolls back every test row.
begin;
set local role authenticated;
select set_config('test.uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
select set_config('test.terms','true',true);
select set_config('test.restricted','false',true);
do $$ begin
  if not public.reader_book_submission_ready() then raise exception 'preflight failed'; end if;
  if public.submit_reader_book('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Book','Writer','1','History',null,3,2.0,'Notes','https://upload.satoru.click/files/test.pdf') <> 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid then raise exception 'wrong id'; end if;
  if public.submit_reader_book('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Book','Writer','1','History',null,3,2.0,'Notes','https://upload.satoru.click/files/test.pdf') <> 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid then raise exception 'retry failed'; end if;
  if (select count(*) from public.my_reader_books()) <> 1 then raise exception 'own status missing'; end if;
  begin
    perform public.submit_reader_book('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Book','DIFFERENT','1','History',null,3,2.0,'Notes','https://upload.satoru.click/files/test.pdf');
    raise exception 'changed retry accepted';
  exception when unique_violation then null; end;
  begin
    perform public.submit_reader_book('cccccccc-cccc-cccc-cccc-cccccccccccc','Bad','','','',null,0,0,'','https://evil.example/test.pdf');
    raise exception 'untrusted URL accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform * from public.reader_book_submissions;
    raise exception 'raw queue exposed';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.dashboard_book_submissions();
    raise exception 'ordinary user read queue';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('test.uid','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',true);
do $$ begin
  if (select count(*) from public.my_reader_books()) <> 0 then raise exception 'another user saw submissions'; end if;
end $$;
select set_config('test.uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
select set_config('test.terms','false',true);
do $$ begin
  begin perform public.reader_book_submission_ready(); raise exception 'missing terms accepted';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('test.terms','true',true);
select set_config('test.restricted','true',true);
do $$ begin
  begin perform public.reader_book_submission_ready(); raise exception 'restricted user accepted';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('test.restricted','false',true);
select set_config('test.admin','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
select set_config('test.allowed','true',true);
do $$ begin
  begin perform public.dashboard_review_book('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','approve'); raise exception 'self approval accepted';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('test.admin','dddddddd-dddd-dddd-dddd-dddddddddddd',true);
do $$ begin
  if (select count(*) from public.dashboard_book_submissions()) <> 1 then raise exception 'review queue missing'; end if;
  begin perform public.dashboard_review_book('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',null); raise exception 'null action accepted';
  exception when invalid_parameter_value then null; end;
  if public.dashboard_review_book('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','approve') is null then raise exception 'approval did not publish'; end if;
  if (select count(*) from public.dashboard_book_submissions()) <> 0 then raise exception 'review queue not cleared'; end if;
  if (select status from public.my_reader_books() limit 1) <> 'Published' then raise exception 'status not updated'; end if;
  begin perform public.dashboard_review_book('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','approve'); raise exception 'duplicate approval accepted';
  exception when invalid_parameter_value then null; end;
end $$;
select public.submit_reader_book('cccccccc-cccc-cccc-cccc-cccccccccccc','Rejected Book','','','',null,0,0,'','https://upload.satoru.click/files/reject.pdf');
select public.dashboard_review_book('cccccccc-cccc-cccc-cccc-cccccccccccc','reject');
do $$ begin
  if (select status from public.my_reader_books() where id='cccccccc-cccc-cccc-cccc-cccccccccccc') <> 'Rejected' then raise exception 'rejection missing'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.pdf_books) <> 1 then raise exception 'wrong published book count'; end if;
end $$;
rollback;
