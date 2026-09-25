-- 026 — The audit trail must be readable by the people allowed to read it.
--
-- 025 defined `audit_trail` with `security_invoker = on` and joined
-- `auth.users` to show the actor's email. That join is the hole: with invoker
-- rights the *caller* — not the view's owner — needs SELECT on `auth.users`,
-- which `authenticated` does not have and should never be given.
--
-- The symptom on the deployed project was exact and unpleasant: a signed-in
-- owner, holding `audit.view`, opened the audit screen and was told
--
--     You do not have permission to do that.   (SQLSTATE 42501)
--
-- `register_session_summary` was readable because it only touches `public`
-- tables; only the view that reached into `auth` failed. The migration
-- validator could not see it, because the validator applies migrations as the
-- owner and the owner can read everything — which is why this file also adds
-- the check that would have caught it (see tools/validate-migrations.mjs).
--
-- The fix keeps the email without handing out `auth.users`: a SECURITY DEFINER
-- function resolves one email for one uuid, and the view calls it. The view
-- itself stays `security_invoker`, so `audit_logs_select` still decides which
-- rows a caller may see — the tenancy wall is unchanged.

create or replace function app.actor_email(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.email from auth.users u where u.id = p_user_id
$$;

comment on function app.actor_email(uuid) is
  'One email address for one user id. SECURITY DEFINER because authenticated must not read auth.users, and the audit trail has to name the actor.';

-- 018 revoked EXECUTE on everything in `app` from the client roles, so the
-- grant has to be explicit here too.
revoke execute on function app.actor_email(uuid) from public, anon;
grant execute on function app.actor_email(uuid) to authenticated;

-- Dropped and recreated rather than replaced: the old definition took
-- `actor_email` straight from `auth.users.email` (`varchar(255)`) and the
-- helper returns `text`, and Postgres refuses to change a view column's type
-- in place. Nothing depends on the view, so the brief drop is free.
drop view if exists public.audit_trail;

create view public.audit_trail as
  select a.id,
         a.organization_id,
         a.created_at,
         a.action,
         a.entity_type,
         a.entity_id,
         a.actor_id,
         app.actor_email(a.actor_id) as actor_email,
         a.before,
         a.after,
         a.metadata
    from public.audit_logs a;

alter view public.audit_trail set (security_invoker = on);

-- Explicit rather than inherited from Supabase's default privileges: a view's
-- readability should not depend on which role happened to create it, and an
-- invoker-rights view is only as readable as the table underneath it.
-- RLS — not the grant — is what decides which rows come back.
grant select on public.audit_logs to authenticated;
grant select on public.audit_trail to authenticated;
grant select on public.register_session_summary to authenticated;
