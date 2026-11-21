-- Human guidance only; no automatic verdicts or enforcement.
begin;
create table if not exists public.moderation_policy_categories (
  code text primary key,
  label text not null check(length(btrim(label)) between 1 and 100),
  description text not null check(length(btrim(description)) between 3 and 1000),
  severity text not null check(severity in ('low','medium','high')),
  content_types text[] not null,
  recommended_action text not null check(recommended_action in ('review','warning','remove','restrict')),
  appeal_eligible boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.moderation_policy_categories enable row level security;
revoke all on public.moderation_policy_categories from public,anon,authenticated;
create table if not exists public.moderation_policy_audit (
  id bigint generated always as identity primary key,
  policy_code text not null references public.moderation_policy_categories(code),
  moderator_id uuid not null,
  reason text not null,
  previous_value jsonb not null,
  new_value jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.moderation_policy_audit enable row level security;
revoke all on public.moderation_policy_audit from public,anon,authenticated;

insert into public.moderation_policy_categories(code,label,description,severity,content_types,recommended_action) values
('spam','Spam','Unwanted repetitive or promotional content.','low',array['article','comment','discussion','reply','profile','music'],'review'),
('harassment','Harassment','Targeted abuse, bullying or harassment.','high',array['article','comment','discussion','reply','profile','music'],'review'),
('hate','Hate speech','Content targeting protected groups with hatred.','high',array['article','comment','discussion','reply','profile','music'],'review'),
('threats','Threats and intimidation','Threats, coercion or intimidation.','high',array['article','comment','discussion','reply','profile','music'],'review'),
('impersonation','Impersonation','Deceptive use of another person’s identity.','medium',array['article','comment','discussion','reply','profile','music'],'review'),
('copyright','Copyright infringement','Use of material without required rights.','medium',array['article','comment','discussion','reply','profile','music'],'review'),
('explicit','Explicit or inappropriate content','Potentially inappropriate or sexually explicit content.','high',array['article','comment','discussion','reply','profile','music'],'review'),
('fraud','Fraudulent information','Potentially deceptive information or schemes.','high',array['article','comment','discussion','reply','profile','music'],'review'),
('malicious_links','Malicious links','Links that may facilitate harm, phishing or malware.','high',array['article','comment','discussion','reply','profile','music'],'review'),
('personal_information','Personal information exposure','Sharing private personal information without permission.','high',array['article','comment','discussion','reply','profile','music'],'review'),
('other','Other','Other potential community-policy concerns.','medium',array['article','comment','discussion','reply','profile','music'],'review')
on conflict (code) do nothing;

create or replace function public.moderation_policy_catalog()
returns setof public.moderation_policy_categories language sql stable security definer set search_path=pg_catalog,public
as $$ select * from public.moderation_policy_categories order by label,code $$;
revoke all on function public.moderation_policy_catalog() from public;
grant execute on function public.moderation_policy_catalog() to anon,authenticated;

create or replace function public.dashboard_update_moderation_policy(
  p_code text,p_label text,p_description text,p_severity text,p_content_types text[],
  p_recommended_action text,p_appeal_eligible boolean,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$ declare actor uuid:=public.dashboard_current_user_id(); oldrow public.moderation_policy_categories; newrow public.moderation_policy_categories;
begin
  if actor is null or not coalesce(public.dashboard_is_super_admin(),false) then raise exception 'Super administrator required' using errcode='42501'; end if;
  if length(btrim(coalesce(p_label,''))) not between 1 and 100 or length(btrim(coalesce(p_description,''))) not between 3 and 1000
    or p_severity is null or p_severity not in ('low','medium','high')
    or p_recommended_action is null or p_recommended_action not in ('review','warning','remove','restrict')
    or p_appeal_eligible is null or p_content_types is null or cardinality(p_content_types) not between 1 and 7
    or array_position(p_content_types,null) is not null
    or not (p_content_types <@ array['article','comment','discussion','reply','profile','music','ai_output']::text[])
    or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Invalid policy' using errcode='22023'; end if;
  select * into oldrow from public.moderation_policy_categories where code=p_code for update;
  if not found then raise exception 'Policy not found' using errcode='22023'; end if;
  update public.moderation_policy_categories set label=btrim(p_label),description=btrim(p_description),severity=p_severity,
    content_types=p_content_types,recommended_action=p_recommended_action,appeal_eligible=p_appeal_eligible,updated_at=now()
    where code=p_code returning * into newrow;
  insert into public.moderation_policy_audit(policy_code,moderator_id,reason,previous_value,new_value)
    values(p_code,actor,btrim(p_reason),to_jsonb(oldrow),to_jsonb(newrow));
  return to_jsonb(newrow);
end $$;
revoke all on function public.dashboard_update_moderation_policy(text,text,text,text,text[],text,boolean,text) from public;
grant execute on function public.dashboard_update_moderation_policy(text,text,text,text,text[],text,boolean,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
