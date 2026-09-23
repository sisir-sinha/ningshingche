# 07 — Permissions Architecture

---

## 1. Model

```
permissions (catalogue, seeded + plugin-contributed)
      ↑
role_permissions ─── roles (per organization)
                        ↑
                    user_roles (user × organization × branch)
                        ↑
                    auth.users
```

Four rules:

1. **Permissions are a global catalogue.** A plugin's permission rows exist
   once, shared by all organizations. `plugins.plugin_key` marks provenance.
2. **Roles are per-organization.** "Cashier" at Shop A and "Cashier" at Shop B
   are different rows with different grants.
3. **Assignment is scoped per branch.** `user_roles.branch_id = NULL` means
   all branches (owner, admin). A branch manager gets a row per branch.
4. **Evaluation happens in Postgres.** The frontend only hides UI.

---

## 2. Key format

```
<resource>.<action>
<plugin>.<resource>.<action>      plugin permissions, three parts
```

Core examples:

```
dashboard.view

sales.view        sales.create      sales.hold         sales.resume
sales.discount    sales.refund      sales.cancel       sales.view_all_branches

products.view     products.create   products.edit      products.delete
products.import   products.export   products.price_change

inventory.view    inventory.stock_in    inventory.stock_out
inventory.adjust  inventory.transfer    inventory.count

purchases.view    purchases.create   purchases.receive   purchases.approve

customers.view    customers.create   customers.edit      customers.delete
suppliers.view    suppliers.create   suppliers.edit

expenses.view     expenses.create    expenses.edit       expenses.delete

reports.view      reports.export
analytics.view

register.open     register.close     register.adjust_cash

users.view        users.invite       users.edit          users.delete
roles.manage
settings.manage   settings.business
plugins.view      plugins.manage
audit.view
```

Plugin examples:

```
pharmacy.medicines.view      pharmacy.medicines.edit
pharmacy.prescription.record pharmacy.controlled.override
repair.orders.create         repair.orders.assign       repair.orders.complete
loyalty.points.adjust        loyalty.tiers.manage
wholesale.pricelists.manage
production.recipes.manage    production.runs.create
accounting.journal.post
```

---

## 3. Namespacing is enforced, not conventional

On plugin load, the registry rejects any permission whose key does not start
with `<plugin.id>.`:

```ts
for (const perm of manifest.permissions ?? []) {
  if (!perm.key.startsWith(`${manifest.id}.`)) {
    throw new PluginManifestError(
      `${manifest.id}: permission "${perm.key}" must be namespaced ` +
      `as "${manifest.id}.…" — a plugin may not define core permissions.`
    )
  }
}
```

Without this, a malicious or careless plugin could ship a permission keyed
`settings.manage` and inherit admin rights from every existing role that
grants it. This is a privilege-escalation path, so it is blocked at load
rather than caught in review.

---

## 4. Wildcards

Supported at evaluation time, never expanded into stored rows:

| Grant | Matches |
|---|---|
| `sales.refund` | exactly that |
| `sales.*` | every `sales.<action>` |
| `*` | everything, including plugin permissions added later |
| `pharmacy.*` | every pharmacy permission |

The match is in `app.has_permission()` ([04](./04-database-design.md) §9):

```sql
AND (p.key = p_key
     OR p.key = '*'
     OR p.key = split_part(p_key,'.',1) || '.*')
```

### The tradeoff, stated plainly

Evaluating wildcards at read time means a role holding `*` **silently gains
every permission a newly enabled plugin adds.** For an owner role that is
correct and desirable. For a custom role it may not be.

Mitigation: the Plugins admin page shows, before enabling a plugin, exactly
which existing roles would gain its permissions via wildcard. The admin
confirms. This keeps wildcards convenient without making privilege creep
invisible.

---

## 5. Seeded roles

| Role | Scope | Grants |
|---|---|---|
| **Owner** | All branches | `*` |
| **Admin** | All branches | Everything except `users.delete` on the owner account |
| **Manager** | Per branch | Sales, products, inventory, purchases, customers, suppliers, expenses, reports, analytics, register |
| **Cashier** | Per branch | `dashboard.view`, `sales.view`, `sales.create`, `sales.hold`, `sales.resume`, `products.view`, `customers.view`, `customers.create`, `inventory.view`, `register.open`, `register.close` |
| **Inventory Manager** | Per branch | Products, inventory, purchases, suppliers, reports |
| **Accountant** | All branches | Reports, analytics, expenses, purchases (view), accounting plugin |

All six are `is_system = true` — the key and grants cannot be deleted, though
grants can be extended. **Custom Role** is a first-class concept: an admin
clones a system role and edits grants.

### The cashier discount question

`sales.discount` is deliberately *not* in the cashier default. Whether a
cashier may discount is a policy decision every shop makes differently, so
it is a permission rather than a setting — and the setup wizard asks.

---

## 6. Enforcement layers

Three layers, and only the last one is authoritative.

### Layer 1 — UI (hides)

```ts
if (permissions.has('sales.refund')) {
  render(refundButton)
}
```

Also available declaratively:

```ts
guard('products.delete', () => deleteButton)
```

### Layer 2 — Route guard (blocks navigation)

```ts
routes.add({ path: '/reports', permission: 'reports.view', load: () => import('…') })
```

An unauthorised direct URL renderers an "Access denied" state, not a blank
screen — the user should know the feature exists and that they lack rights.

### Layer 3 — Postgres (authorises)

Every policy on a mutable table checks the permission:

```sql
CREATE POLICY products_delete ON products FOR DELETE
  USING (app.in_org(organization_id) AND app.has_permission('products.delete'));
```

And every RPC re-checks at the top:

```sql
CREATE FUNCTION complete_sale(...) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT app.has_permission('sales.create') THEN
    RAISE EXCEPTION 'permission_denied: sales.create'
      USING ERRCODE = '42501';
  END IF;
  IF NOT app.in_org(p_organization_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- …
END $$;
```

**Layer 3 is not redundant.** Layers 1 and 2 are trivially bypassed with
`curl` and the anon key. A cashier who knows the API could otherwise refund
sales. This is §44's "never rely only on frontend restrictions," made
concrete.

---

## 7. Branch scoping

`user_roles.branch_id` restricts *what data a role sees*, not just what it can
do.

```sql
CREATE OR REPLACE FUNCTION app.visible_branch_ids(p_org uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM user_roles
                  WHERE user_id = auth.uid() AND organization_id = p_org
                    AND branch_id IS NULL)
      THEN (SELECT array_agg(id) FROM branches
             WHERE organization_id = p_org AND deleted_at IS NULL)
    ELSE (SELECT coalesce(array_agg(branch_id), '{}') FROM user_roles
           WHERE user_id = auth.uid() AND organization_id = p_org
             AND branch_id IS NOT NULL)
  END
$$;
```

Operational tables add `branch_id = ANY(app.visible_branch_ids(organization_id))`
to their policies. A branch manager at Gulshan cannot read Banani's sales.

`sales.view_all_branches` is the explicit override for head-office staff.

---

## 8. The active branch problem

A user with access to three branches must choose which one they are
currently operating — stock levels, the register session and reporting all
depend on it.

Stored as a JWT custom claim:

```
app_metadata: { active_branch_id: "…" }
```

Read by `app.current_branch_id()`. Set via an Edge Function on branch switch,
which refreshes the session.

Why a JWT claim rather than a `SET LOCAL` or a request header: **the Android
app gets the same semantics for free.** It sets the claim identically, and
every policy works unchanged. A header convention would need reimplementing
and re-auditing per client.

The branch switcher lives in the top bar, visible only when
`visible_branch_ids().length > 1`.

---

## 9. Permission changes and audit

Changing grants is sensitive (§31). A trigger writes the diff:

```sql
CREATE TRIGGER role_permissions_audit
  AFTER INSERT OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION audit_permission_change();
```

producing entries like:

```
action:      role.permission_granted
entity_type: role
entity_id:   <role uuid>
before:      null
after:       { "key": "sales.refund" }
actor_id:    <admin uuid>
```

And a `user.permission_changed` event is published to the outbox, so the
affected user's session refreshes their permission set without re-login.
Without this, a cashier keeps stale rights until their token expires — a real
security gap that is easy to miss.

---

## 10. Plugin permissions in practice

When the Repair plugin is enabled:

```
1. Edge Function inserts its permissions into `permissions`
     (plugin_key = 'repair')
2. Owner role: nothing to do — `*` already matches
3. Admin role: granted `repair.*` explicitly (safer than relying on wildcard)
4. Cashier: granted `repair.orders.create` and `repair.orders.view` only
5. Settings → Roles shows a "Repair" section that did not exist before
6. Disabling the plugin leaves the permission rows in place (marked inactive)
     so re-enabling restores prior grants. Nothing is silently lost.
```

That last point matters. Deleting permission rows on disable would destroy
the shop's role configuration every time they toggled a plugin off to try it.
