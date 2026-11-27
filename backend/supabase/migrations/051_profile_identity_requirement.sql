-- Align article submission with the profile editor: title/identity is required;
-- Facebook is optional. No profile rows are changed. Requires migrations 041
-- and 044. Stage against the actual database and take a verified backup first.
begin;

-- Never overwrite an absent or independently modified production function.
-- Recognize only the exact 041 body or this migration's own body (reruns).
do $$
declare existing oid := to_regprocedure('public.submit_reader_article(uuid,text,text,text,text)');
begin
  if existing is null or not exists (
    select 1 from pg_proc where oid=existing and prosecdef
      and md5(prosrc) in ('42ba5b4a5b9bed2d457932ed59685a98', 'a32c756fee073dfb0b57203d69e86ec5')
  ) then
    raise exception 'Unexpected submit_reader_article definition; review migration 051 against this database';
  end if;
end $$;

create or replace function public.submit_reader_article(
    p_id uuid,
    p_title text,
    p_content text,
    p_thumbnail text default '',
    p_imgbb_delete_url text default ''
)
returns setof public.submitted_blogs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
    me uuid := auth.uid();
    profile_row public.profiles;
    clean_title text := btrim(coalesce(p_title, ''));
    clean_content text := btrim(coalesce(p_content, ''));
    clean_plain text;
begin
    if me is null then
        raise exception 'A valid sign-in is required to submit an article.'
            using errcode = '42501';
    end if;

    if not public.has_accepted_current_terms() then
        raise exception 'Accept the current Terms before submitting an article.'
            using errcode = '42501', hint = 'terms_acceptance_required';
    end if;

    if p_id is null then
        raise exception 'A request id is required.' using errcode = '22023';
    end if;

    clean_plain := btrim(regexp_replace(clean_content, '<[^>]*>', ' ', 'g'));
    if length(clean_title) not between 1 and 250 then
        raise exception 'Article title must contain 1 to 250 characters.'
            using errcode = '22023';
    end if;
    if length(clean_plain) < 1 or length(clean_content) > 200000 then
        raise exception 'Article content is empty or too long.'
            using errcode = '22023';
    end if;
    if length(coalesce(p_thumbnail, '')) > 2048
       or length(coalesce(p_imgbb_delete_url, '')) > 2048 then
        raise exception 'An image URL is too long.' using errcode = '22023';
    end if;

    select p.* into profile_row
      from public.profiles p
     where p.id = me;

    if profile_row.id is null then
        raise exception 'Complete your profile before submitting an article.'
            using errcode = '42501', hint = 'profile_required';
    end if;

    if btrim(coalesce(profile_row.first_name, '')) = ''
       or btrim(coalesce(profile_row.last_name, '')) = ''
       or btrim(coalesce(profile_row.avatar_url, '')) = ''
       or btrim(coalesce(profile_row.about, '')) = ''
       or btrim(coalesce(profile_row.phone, '')) = ''
       or btrim(coalesce(profile_row.address, '')) = ''
       or btrim(coalesce(profile_row.designation, '')) = '' then
        raise exception 'Complete your profile before submitting an article.'
            using errcode = '42501', hint = 'profile_required';
    end if;

    insert into public.submitted_blogs (
        id, title, designation, address, phone, thumbnail, imgbb_delete_url,
        writer_name, writer_designation, writer_profile_image, writer_email,
        writer_facebook, content_title, content, status, converted_blog_id, user_id
    ) values (
        p_id,
        clean_title,
        coalesce(profile_row.designation, ''),
        coalesce(profile_row.address, ''),
        coalesce(profile_row.phone, ''),
        btrim(coalesce(p_thumbnail, '')),
        btrim(coalesce(p_imgbb_delete_url, '')),
        coalesce(
            nullif(btrim(concat_ws(' ', profile_row.first_name, profile_row.last_name)), ''),
            nullif(btrim(profile_row.name), ''),
            'Reader'
        ),
        coalesce(profile_row.designation, ''),
        coalesce(profile_row.avatar_url, ''),
        coalesce(nullif(btrim(profile_row.email), ''), auth.jwt() ->> 'email', ''),
        coalesce(profile_row.facebook_id, ''),
        clean_title,
        clean_content,
        'Pending',
        null,
        me
    )
    on conflict (id) do nothing;

    return query
        select s.*
          from public.submitted_blogs s
         where s.id = p_id
           and s.user_id = me;

    if not found then
        raise exception 'That submission id is already in use.' using errcode = '23505';
    end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
