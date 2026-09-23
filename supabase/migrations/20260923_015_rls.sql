-- 015 — Row Level Security.
--
-- Design rules (docs/04 §9, docs/07 §6):
--
--  1. Every table gets RLS. Supabase defaults to deny only once RLS is
--     enabled, so an omitted ENABLE is an open table.
--  2. Policies call only app.* helpers. No policy may reference a table that
--     itself has a policy referencing another table — that is the recursion
--     trap, and it is why every child table carries its own organization_id.
--  3. Tables written exclusively through SECURITY DEFINER RPCs get SELECT
--     policies only. The client cannot forge a sale, a stock movement or a
--     register session, no matter what it sends.
--  4. Frontend permission checks hide buttons. They never authorise.

-- ── Standard org-scoped tables ────────────────────────────────────────────
-- (table, permission prefix, client may write?)
do $$
declare
  r record;
  t text;
begin
  for r in
    select * from (values
      -- tenancy
      ('branches',              'settings',  true),
      ('warehouses',            'settings',  true),
      ('registers',             'settings',  true),
      -- rbac
      ('roles',                 'roles',     true),
      ('role_permissions',      'roles',     true),
      ('user_roles',            'users',     true),
      -- catalogue
      ('product_categories',    'products',  true),
      ('product_brands',        'products',  true),
      ('product_units',         'settings',  true),
      ('taxes',                 'settings',  true),
      ('products',              'products',  true),
      ('product_variants',      'products',  true),
      ('product_barcodes',      'products',  true),
      ('product_option_types',  'products',  true),
      ('product_option_values', 'products',  true),
      ('product_images',        'products',  true),
      -- parties
      ('customers',             'customers', true),
      ('suppliers',             'suppliers', true),
      -- money
      ('payment_methods',       'settings',  true),
      ('expense_categories',    'expenses',  true),
      ('plugins',               'plugins',   true),
      -- RPC-written: SELECT only
      ('register_sessions',     'register',      false),
      ('stock_balances',        'inventory',     false),
      ('stock_movements',       'inventory',     false),
      ('stock_transfers',       'inventory',     false),
      ('stock_transfer_items',  'inventory',     false),
      ('expenses',              'expenses',      false),
      ('sales',                 'sales',         false),
      ('sale_items',            'sales',         false),
      ('sale_payments',         'sales',         false),
      ('sale_returns',          'sales',         false),
      ('sale_return_items',     'sales',         false),
      ('sale_return_payments',  'sales',         false),
      ('purchases',             'purchases',     false),
      ('purchase_items',        'purchases',     false),
      ('purchase_payments',     'purchases',     false),
      ('plugin_migrations',     'plugins',       false),
      ('sequences',             'settings',      false)
    ) as v(tbl, perm, writable)
  loop
    t := r.tbl;

    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format(
      'create policy %I on public.%I for select using (app.in_org(organization_id))',
      t || '_select', t
    );

    if r.writable then
      execute format(
        'create policy %I on public.%I for insert with check (
           app.in_org(organization_id)
           and app.has_permission(%L)
         )',
        t || '_insert', t, r.perm || '.create'
      );

      execute format(
        'create policy %I on public.%I for update using (
           app.in_org(organization_id)
           and app.has_permission(%L)
         ) with check (app.in_org(organization_id))',
        t || '_update', t, r.perm || '.edit'
      );

      execute format(
        'create policy %I on public.%I for delete using (
           app.in_org(organization_id)
           and app.has_permission(%L)
         )',
        t || '_delete', t, r.perm || '.delete'
      );
    end if;
  end loop;
end;
$$;

-- ── organizations ─────────────────────────────────────────────────────────
-- A user may read the organizations they belong to, and edit those they
-- administer. There is no organizations.organization_id — the row *is* the
-- organization.
alter table public.organizations enable row level security;
alter table public.organizations force row level security;

create policy organizations_select on public.organizations for select
  using (app.in_org(id));

create policy organizations_update on public.organizations for update
  using (app.in_org(id) and app.has_permission('settings.business'))
  with check (app.in_org(id));

-- ── permissions: a global catalogue ───────────────────────────────────────
-- Readable by any signed-in user (the UI needs it to build role editors and
-- gate navigation). Written only by service-role code in Edge Functions,
-- which bypasses RLS by design.
alter table public.permissions enable row level security;
alter table public.permissions force row level security;

create policy permissions_select on public.permissions for select
  using (auth.uid() is not null);

-- ── user_organizations: the RLS root ──────────────────────────────────────
-- Deliberately permissive for one's own row and nothing else. app.* helpers
-- read this table SECURITY DEFINER, so this policy does not recurse.
alter table public.user_organizations enable row level security;
alter table public.user_organizations force row level security;

create policy user_organizations_select_own on public.user_organizations for select
  using (user_id = auth.uid());

-- ── outbox ────────────────────────────────────────────────────────────────
-- Clients read it for the Realtime bridge (docs/02 §3) but never write it;
-- only the transactional RPCs insert events.
alter table public.outbox enable row level security;
alter table public.outbox force row level security;

create policy outbox_select on public.outbox for select
  using (app.in_org(organization_id));

-- ── audit_logs ────────────────────────────────────────────────────────────
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

create policy audit_logs_select on public.audit_logs for select
  using (app.in_org(organization_id) and app.has_permission('audit.view'));

-- ── Branch isolation on operational tables ────────────────────────────────
-- A branch manager must not read another branch's trades (docs/07 §7).
-- These are additional restrictive policies, so they AND with the org
-- policies above.
create policy sales_branch_scope on public.sales for select
  using (branch_id = any(app.visible_branch_ids(organization_id)));

create policy register_sessions_branch_scope on public.register_sessions for select
  using (branch_id = any(app.visible_branch_ids(organization_id)));

create policy expenses_branch_scope on public.expenses for select
  using (branch_id = any(app.visible_branch_ids(organization_id)));

create policy purchases_branch_scope on public.purchases for select
  using (branch_id = any(app.visible_branch_ids(organization_id)));

-- ── Verification helper ───────────────────────────────────────────────────
-- Returns every public table missing RLS. CI fails if this is non-empty, so
-- a newly added table cannot quietly ship unprotected.
create or replace function app.tables_missing_rls()
returns table(table_name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity
   order by 1
$$;
