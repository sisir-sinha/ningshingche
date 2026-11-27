-- Require a real reader session for new article comments.
-- REVIEW AND STAGE FIRST. Do not apply in production without a verified backup
-- and recovery plan. Existing comments, including historical guest comments,
-- are not changed. Authorized dashboard staff retain their existing policy.
-- Requires migrations 004 (dashboard RBAC) and 006 (comments.user_id).
begin;

drop policy if exists comments_public_insert on public.comments;
create policy comments_public_insert on public.comments
  for insert to authenticated
  with check (
    auth.uid() is not null
    and coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true'
    and user_id = auth.uid()
    and status = 'Unpublish'
  );

-- PostgreSQL ORs permissive policies, so the policy above alone cannot close a
-- forgotten broad INSERT policy. This restrictive gate applies to *all* reader
-- INSERT paths, while preserving authenticated dashboard staff workflows.
drop policy if exists comments_require_reader_login on public.comments;
create policy comments_require_reader_login on public.comments
  as restrictive for insert to anon, authenticated
  with check (
    (
      auth.uid() is not null
      and coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true'
      and user_id = auth.uid()
      and status = 'Unpublish'
    )
    or coalesce(public.dashboard_has_permission('comments'), false)
  );

notify pgrst, 'reload schema';
commit;
