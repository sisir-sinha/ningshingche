-- 004 — Authorization helpers.
--
-- Every one of these is SECURITY DEFINER with a pinned search_path so it can
-- read the underlying tables WITHOUT re-entering row level security. That is
-- what stops policy recursion (docs/09 #3).
--
-- The rule to hold: no RLS policy may reference a table that itself has a
-- policy referencing another table. These helpers break that chain.

-- Which organizations can the caller see?
create or replace function app.current_org_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(organization_id), '{}')
    from public.user_organizations
   where user_id = auth.uid()
     and is_active
$$;

create or replace function app.in_org(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is not null
     and p_org = any(app.current_org_ids())
$$;

-- The branch the caller is currently operating in. Sourced from a JWT claim
-- so an Android client gets identical semantics with no policy changes
-- (docs/07 §8).
create or replace function app.current_branch_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
           coalesce(auth.jwt() -> 'app_metadata' ->> 'active_branch_id', ''),
           ''
         )::uuid
$$;

-- Does the caller hold this permission in the current org and branch?
-- Wildcards are evaluated here, never expanded into stored rows (docs/07 §4).
create or replace function app.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.permissions p       on p.id = rp.permission_id
     where ur.user_id = auth.uid()
       and ur.organization_id = any(app.current_org_ids())
       and (ur.branch_id is null or ur.branch_id = app.current_branch_id())
       and (p.key = p_key
            or p.key = '*'
            or p.key = split_part(p_key, '.', 1) || '.*')
  )
$$;

-- Branches whose operational data the caller may read. A null branch_id on
-- any assignment means "all branches in this organization".
create or replace function app.visible_branch_ids(p_org uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.user_roles
       where user_id = auth.uid()
         and organization_id = p_org
         and branch_id is null
    ) then (
      select coalesce(array_agg(id), '{}')
        from public.branches
       where organization_id = p_org
         and deleted_at is null
    )
    else (
      select coalesce(array_agg(branch_id), '{}')
        from public.user_roles
       where user_id = auth.uid()
         and organization_id = p_org
         and branch_id is not null
    )
  end
$$;

create or replace function app.in_visible_branch(p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_branch = any(app.visible_branch_ids(
    (select organization_id from public.branches where id = p_branch)
  ))
$$;

-- Imperative guard for RPCs. Raising inside a function is clearer than making
-- every caller branch on a boolean.
create or replace function app.require_permission(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app.has_permission(p_key) then
    raise exception 'permission_denied: %', p_key using errcode = '42501';
  end if;
end;
$$;

create or replace function app.require_org(p_org uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app.in_org(p_org) then
    raise exception 'forbidden: organization %', p_org using errcode = '42501';
  end if;
end;
$$;
