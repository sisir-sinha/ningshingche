-- seed/001 — Permission catalogue.
--
-- `permissions` is global (one row per key, shared by every organization);
-- roles are per-organization and are created by provision_organization() in
-- seed/002.
--
-- Plugin permissions are namespaced `<plugin_key>.<resource>.<action>` and are
-- inserted by the plugin-enable Edge Function, never here.

insert into public.permissions (key, label, category, plugin_key, description) values
  -- dashboard
  ('dashboard.view',  'View dashboard', 'dashboard', null, 'See the dashboard and its widgets'),

  -- sales
  ('sales.view',              'View sales',            'sales', null, 'List and open sales'),
  ('sales.view_all_branches', 'View all branches'' sales', 'sales', null, 'Override branch isolation for head office'),
  ('sales.create',            'Create sale',           'sales', null, 'Complete a sale at the POS'),
  ('sales.hold',              'Hold sale',             'sales', null, 'Park a sale mid-transaction'),
  ('sales.resume',            'Resume sale',           'sales', null, 'Resume a held sale'),
  ('sales.discount',          'Apply discount',        'sales', null, 'Discount a line or a whole sale'),
  ('sales.refund',            'Refund sale',           'sales', null, 'Issue full or partial refunds'),
  ('sales.cancel',            'Cancel sale',           'sales', null, 'Void a completed sale'),

  -- products
  ('products.view',          'View products',       'products', null, 'Browse and search the catalogue'),
  ('products.create',        'Create product',      'products', null, 'Add products and variants'),
  ('products.edit',          'Edit product',        'products', null, 'Modify product details'),
  ('products.delete',        'Delete product',      'products', null, 'Remove products'),
  ('products.price_change',  'Change selling price','products', null, 'Alter prices (audited separately)'),
  ('products.import',        'Import products',     'products', null, 'Bulk import from CSV'),
  ('products.export',        'Export products',     'products', null, 'Bulk export to CSV'),

  -- inventory
  ('inventory.view',     'View stock',        'inventory', null, 'See balances and the movement ledger'),
  ('inventory.stock_in', 'Stock in',          'inventory', null, 'Receive stock without a purchase order'),
  ('inventory.stock_out','Stock out',         'inventory', null, 'Remove stock with a reason'),
  ('inventory.adjust',   'Adjust stock',      'inventory', null, 'Correct balances (audited)'),
  ('inventory.transfer', 'Transfer stock',    'inventory', null, 'Move stock between warehouses'),
  ('inventory.count',    'Stocktake',         'inventory', null, 'Run and approve cycle counts'),

  -- purchases
  ('purchases.view',    'View purchases',    'purchases', null, 'List purchase orders'),
  ('purchases.create',  'Create purchase',   'purchases', null, 'Raise a purchase order'),
  ('purchases.receive', 'Receive purchase',  'purchases', null, 'Receive stock against a PO'),
  ('purchases.approve', 'Approve purchase',  'purchases', null, 'Approve a PO above the threshold'),

  -- customers / suppliers
  ('customers.view',   'View customers',   'customers', null, 'Browse customers'),
  ('customers.create', 'Create customer',  'customers', null, 'Add customers'),
  ('customers.edit',   'Edit customer',    'customers', null, 'Modify customer details'),
  ('customers.delete', 'Delete customer',  'customers', null, 'Remove customers'),
  ('suppliers.view',   'View suppliers',   'suppliers', null, 'Browse suppliers'),
  ('suppliers.create', 'Create supplier',  'suppliers', null, 'Add suppliers'),
  ('suppliers.edit',   'Edit supplier',    'suppliers', null, 'Modify supplier details'),
  ('suppliers.delete', 'Delete supplier',  'suppliers', null, 'Remove suppliers'),

  -- expenses
  ('expenses.view',   'View expenses',   'expenses', null, 'See expense records'),
  ('expenses.create', 'Record expense',  'expenses', null, 'Record an expense'),
  ('expenses.edit',   'Edit expense',    'expenses', null, 'Modify an expense'),
  ('expenses.delete', 'Delete expense',  'expenses', null, 'Remove an expense'),

  -- reports / analytics
  ('reports.view',   'View reports',   'reports',   null, 'Run reports'),
  ('reports.export', 'Export reports', 'reports',   null, 'Export to CSV, PDF or print'),
  ('analytics.view', 'View analytics', 'analytics', null, 'See analytics and trends'),

  -- register
  ('register.open',        'Open register',    'register', null, 'Start a cashier session'),
  ('register.close',       'Close register',   'register', null, 'End a cashier session'),
  ('register.adjust_cash', 'Cash in / out',    'register', null, 'Manual drawer movements'),

  -- users / roles
  ('users.view',   'View users',   'users', null, 'List users'),
  ('users.create', 'Invite user',  'users', null, 'Invite and assign roles'),
  ('users.edit',   'Edit user',    'users', null, 'Change a user''s roles'),
  ('users.delete', 'Remove user',  'users', null, 'Revoke access'),
  ('roles.create', 'Create role',  'roles', null, 'Define a custom role'),
  ('roles.edit',   'Edit role',    'roles', null, 'Change role permissions'),
  ('roles.delete', 'Delete role',  'roles', null, 'Remove a custom role'),
  ('roles.manage', 'Manage roles', 'roles', null, 'All role operations'),

  -- settings
  ('settings.view',    'View settings',  'settings', null, 'Read configuration'),
  ('settings.create',  'Add config',     'settings', null, 'Add branches, warehouses, registers, tax rules, payment methods'),
  ('settings.edit',    'Edit config',    'settings', null, 'Modify configuration records'),
  ('settings.delete',  'Delete config',  'settings', null, 'Remove configuration records'),
  ('settings.manage',  'Manage settings','settings', null, 'All settings operations'),
  ('settings.business','Edit business profile', 'settings', null, 'Change organization name, currency, timezone'),

  -- plugins
  ('plugins.view',   'View plugins',   'plugins', null, 'See installed plugins'),
  ('plugins.create', 'Install plugin', 'plugins', null, 'Add a plugin'),
  ('plugins.edit',   'Configure plugin','plugins', null, 'Change plugin settings'),
  ('plugins.delete', 'Remove plugin',  'plugins', null, 'Uninstall a plugin'),
  ('plugins.manage', 'Manage plugins', 'plugins', null, 'Enable, disable and configure plugins'),

  -- audit
  ('audit.view', 'View audit log', 'audit', null, 'Read the audit trail')
on conflict (key) do nothing;

-- ── Self-verification ─────────────────────────────────────────────────────
-- The RLS policies in 015 check `<resource>.create`, `.edit` and `.delete`
-- for every writable table. If one of those keys is missing from this
-- catalogue, writes to that table are silently denied for everyone — a
-- failure that is invisible until a user hits it. Fail loudly instead.
do $$
declare
  v_required text[] := array[
    'settings','roles','users','products','customers','suppliers','expenses','plugins'
  ];
  v_resource text;
  v_action   text;
  v_key      text;
  v_missing  text[] := '{}';
begin
  foreach v_resource in array v_required loop
    foreach v_action in array array['create','edit','delete'] loop
      v_key := v_resource || '.' || v_action;
      if not exists (select 1 from public.permissions where key = v_key) then
        v_missing := v_missing || v_key;
      end if;
    end loop;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception 'permission catalogue is missing keys required by RLS: %',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;
