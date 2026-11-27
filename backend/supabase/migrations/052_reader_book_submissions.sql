-- Staging only. Requires 041, 044 and the dashboard permission functions.
-- Verify backup and production policies before deployment. Files are hosted by
-- third parties and are NOT private just because the submission is pending.
begin;
do $$ begin
  if to_regprocedure('public.has_accepted_current_terms()') is null or
     to_regprocedure('public.moderation_restricted(uuid,text)') is null or
     to_regprocedure('public.dashboard_current_user_id()') is null or
     to_regprocedure('public.dashboard_has_permission(text)') is null then
    raise exception 'Book submissions require the terms, moderation and dashboard prerequisites';
  end if;
end $$;

create table public.reader_book_submissions (
  id uuid primary key,
  user_id uuid not null,
  title text not null,
  author_or_editor text not null default '',
  edition text not null default '',
  category text not null default '',
  book_published_date date,
  page_count integer not null default 0,
  file_size_mb numeric(8,2) not null default 0,
  description text not null default '',
  link text not null,
  status text not null default 'Pending' check (status in ('Pending','Published','Rejected')),
  published_book_id uuid references public.pdf_books(id) on delete set null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index reader_book_submissions_user_created on public.reader_book_submissions(user_id,created_at desc);
create index reader_book_submissions_status_created on public.reader_book_submissions(status,created_at desc);
alter table public.reader_book_submissions enable row level security;
revoke all on public.reader_book_submissions from public, anon, authenticated;

create function public.reader_book_submission_ready() returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid := auth.uid(); p public.profiles;
begin
  if me is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if not public.has_accepted_current_terms() then
    raise exception 'Terms acceptance required' using errcode='42501',hint='terms_acceptance_required'; end if;
  if public.moderation_restricted(me,'publishing') then
    raise exception 'Publishing is restricted' using errcode='42501'; end if;
  select * into p from public.profiles where id=me;
  if p.id is null or btrim(coalesce(p.first_name,''))='' or btrim(coalesce(p.last_name,''))='' or
     btrim(coalesce(p.avatar_url,''))='' or btrim(coalesce(p.about,''))='' or
     btrim(coalesce(p.phone,''))='' or btrim(coalesce(p.address,''))='' or
     btrim(coalesce(p.designation,''))='' then
    raise exception 'Complete your profile' using errcode='42501',hint='profile_required'; end if;
  return true;
end $$;

create function public.submit_reader_book(p_id uuid, p_title text, p_author text, p_edition text,
  p_category text, p_date date, p_pages integer, p_size_mb numeric, p_description text, p_link text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid := auth.uid(); profile_row public.profiles; existing public.reader_book_submissions;
begin
  if me is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if not public.has_accepted_current_terms() then
    raise exception 'Terms acceptance required' using errcode='42501',hint='terms_acceptance_required'; end if;
  if public.moderation_restricted(me,'publishing') then
    raise exception 'Publishing is restricted' using errcode='42501'; end if;
  select * into profile_row from public.profiles where id=me;
  if profile_row.id is null or btrim(coalesce(profile_row.first_name,''))='' or
     btrim(coalesce(profile_row.last_name,''))='' or btrim(coalesce(profile_row.avatar_url,''))='' or
     btrim(coalesce(profile_row.about,''))='' or btrim(coalesce(profile_row.phone,''))='' or
     btrim(coalesce(profile_row.address,''))='' or btrim(coalesce(profile_row.designation,''))='' then
    raise exception 'Complete your profile' using errcode='42501',hint='profile_required'; end if;
  if p_id is null or length(btrim(coalesce(p_title,''))) not between 1 and 250 or
     length(coalesce(p_author,''))>250 or length(coalesce(p_edition,''))>200 or
     length(coalesce(p_category,''))>200 or length(coalesce(p_description,''))>10000 or
     coalesce(p_pages,0) not between 0 and 1000000 or coalesce(p_size_mb,0) not between 0 and 999999 or
     length(coalesce(p_link,''))>2048 or
     coalesce(p_link,'') !~ '^https://(upload[.]satoru[.]click/files/|i[.]ibb[.]co/)[A-Za-z0-9_./-]+$' then
    raise exception 'Invalid book details' using errcode='22023'; end if;
  insert into public.reader_book_submissions(id,user_id,title,author_or_editor,edition,category,
    book_published_date,page_count,file_size_mb,description,link)
  values(p_id,me,btrim(p_title),btrim(coalesce(p_author,'')),btrim(coalesce(p_edition,'')),
    btrim(coalesce(p_category,'')),p_date,coalesce(p_pages,0),coalesce(p_size_mb,0),
    btrim(coalesce(p_description,'')),p_link) on conflict(id) do nothing;
  select * into existing from public.reader_book_submissions where id=p_id;
  if existing.user_id is distinct from me or existing.title is distinct from btrim(p_title) or
     existing.link is distinct from p_link or existing.author_or_editor is distinct from btrim(coalesce(p_author,'')) or
     existing.edition is distinct from btrim(coalesce(p_edition,'')) or existing.category is distinct from btrim(coalesce(p_category,'')) or
     existing.book_published_date is distinct from p_date or existing.page_count is distinct from coalesce(p_pages,0) or
     existing.file_size_mb is distinct from coalesce(p_size_mb,0) or existing.description is distinct from btrim(coalesce(p_description,'')) then
    raise exception 'Submission id already in use' using errcode='23505'; end if;
  return p_id;
end $$;

create function public.my_reader_books() returns table(id uuid,title text,status text,created_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  return query select b.id,b.title,b.status,b.created_at from public.reader_book_submissions b
    where b.user_id=auth.uid() order by b.created_at desc limit 500;
end $$;

create function public.dashboard_book_submissions() returns setof public.reader_book_submissions
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if public.dashboard_current_user_id() is null or not coalesce(public.dashboard_has_permission('books'),false) then
    raise exception 'Books permission required' using errcode='42501'; end if;
  return query select b.* from public.reader_book_submissions b where b.status='Pending' order by b.created_at asc limit 500;
end $$;

create function public.dashboard_review_book(p_id uuid,p_action text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid := public.dashboard_current_user_id(); item public.reader_book_submissions; book_id uuid;
begin
  if actor is null or not coalesce(public.dashboard_has_permission('books'),false) then
    raise exception 'Books permission required' using errcode='42501'; end if;
  if p_action is null or p_action not in ('approve','reject') then raise exception 'Invalid action' using errcode='22023'; end if;
  select * into item from public.reader_book_submissions where id=p_id for update;
  if item.id is null then raise exception 'Submission not found' using errcode='22023'; end if;
  if item.user_id=actor then raise exception 'Cannot review your own submission' using errcode='42501'; end if;
  if item.status <> 'Pending' then raise exception 'Already reviewed' using errcode='22023'; end if;
  if p_action='approve' then
    insert into public.pdf_books(title,author_or_editor,edition,category,book_published_date,page_count,file_size_mb,description,link,file_provider)
      values(item.title,item.author_or_editor,item.edition,item.category,item.book_published_date,item.page_count,item.file_size_mb,item.description,item.link,'url') returning id into book_id;
  end if;
  update public.reader_book_submissions set status=case when p_action='approve' then 'Published' else 'Rejected' end,
    published_book_id=book_id,reviewed_by=actor,reviewed_at=now() where id=p_id;
  return book_id;
end $$;
revoke all on function public.reader_book_submission_ready() from public,anon;
grant execute on function public.reader_book_submission_ready() to authenticated;
revoke all on function public.submit_reader_book(uuid,text,text,text,text,date,integer,numeric,text,text) from public,anon;
revoke all on function public.my_reader_books() from public,anon;
revoke all on function public.dashboard_book_submissions() from public;
revoke all on function public.dashboard_review_book(uuid,text) from public;
grant execute on function public.submit_reader_book(uuid,text,text,text,text,date,integer,numeric,text,text) to authenticated;
grant execute on function public.my_reader_books() to authenticated;
grant execute on function public.dashboard_book_submissions() to anon,authenticated;
grant execute on function public.dashboard_review_book(uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
