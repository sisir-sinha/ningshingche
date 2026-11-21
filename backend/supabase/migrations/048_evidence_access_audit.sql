-- Accountability for moderator evidence reads; no automatic retention or purge.
-- Staff IDs are dashboard IDs, never reader IDs. Requires 004, 043 and 045.
begin;
create table if not exists public.moderation_evidence_access_audit (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.content_reports(id),
  dashboard_user_id uuid not null,
  accessed_at timestamptz not null default now()
);
create index if not exists moderation_evidence_access_report_idx
  on public.moderation_evidence_access_audit(report_id, accessed_at desc);
alter table public.moderation_evidence_access_audit enable row level security;
revoke all on public.moderation_evidence_access_audit from public, anon, authenticated;
revoke all on sequence public.moderation_evidence_access_audit_id_seq from public, anon, authenticated;

-- A successful returned snapshot and its access event share one transaction.
-- Unsuccessful/no-evidence reads do not insert an audit row.
create or replace function public.dashboard_report_evidence(p_report_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public
as $$ declare item public.moderation_report_evidence; staff uuid;
begin
  staff := public.dashboard_current_user_id();
  if staff is null or not coalesce(public.dashboard_has_permission('forum'),false) then
    raise exception 'Moderator required' using errcode='42501'; end if;
  select * into item from public.moderation_report_evidence where report_id=p_report_id;
  if not found then return null; end if;
  insert into public.moderation_evidence_access_audit(report_id,dashboard_user_id)
    values(item.report_id,staff);
  return to_jsonb(item);
end $$;
revoke all on function public.dashboard_report_evidence(uuid) from public;
grant execute on function public.dashboard_report_evidence(uuid) to anon, authenticated;
notify pgrst,'reload schema';
commit;
