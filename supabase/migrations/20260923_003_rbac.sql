-- 003 — RBAC: permission catalogue, roles, memberships, assignments.
--
-- Four rules (docs/07 §1):
--   1. permissions is a global catalogue, shared across organizations
--   2. roles are per-organization
--   3. assignment is scoped per organization AND per branch
--   4. evaluation happens in Postgres, never in the client

create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,     -- 'sales.refund', 'repair.orders.create'
  label       text not null,
  category    text not null,            -- 'sales','inventory','plugins', …
  plugin_key  text,                     -- null for core permissions
  description text
);

create index permissions_plugin_idx
  on public.permissions(plugin_key)
  where plugin_key is not null;

create table public.roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key             text not null,        -- 'owner','admin','cashier', …
  name            text not null,
  is_system       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, key)
);

create trigger roles_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

create table public.role_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  granted_at    timestamptz not null default now(),
  primary key (role_id, permission_id)
);

-- The RLS root. Deliberately a flat junction table with no further joins, so
-- authorization helpers never recurse into policy-protected tables
-- (docs/09 #3 — the previous codebase shipped a fix_rls_recursion.sql).
create table public.user_organizations (
  user_id         uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  primary key (user_id, organization_id)
);

create index user_organizations_org_idx
  on public.user_organizations(organization_id);

-- branch_id null = the role applies to every branch (owner, admin).
create table public.user_roles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id       uuid references public.branches(id) on delete cascade,
  role_id         uuid not null references public.roles(id) on delete cascade,
  granted_by      uuid references auth.users(id),
  granted_at      timestamptz not null default now(),
  unique (user_id, organization_id, branch_id, role_id)
);

create index user_roles_lookup_idx
  on public.user_roles(user_id, organization_id);
