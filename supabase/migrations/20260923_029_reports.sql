-- 029 — Reports: eleven questions, one framework (spec §23).
--
-- §23 wants reports that filter, search, sort and paginate, and the tempting
-- shortcut is to write each one as its own screen, its own query and its own
-- CSV encoder. That is how a shop ends up with a sales CSV whose column order
-- differs from the sales table on screen, and a "profit" column that means
-- something slightly different in each.
--
-- So there is one framework:
--
--   app.report_spec()  a declarative description of a report — its columns,
--                      its FROM/WHERE, what may be sorted, what may be
--                      searched, which columns carry a total
--   public.report_rows()   runs it with filters, search, sort, pagination,
--                      and returns rows + columns + row count + totals
--   public.report_catalog() the list of reports, from the same specs
--
-- The screen, the CSV export and the print view all read `report_rows`, so the
-- exported file is the table with commas — not a second implementation that
-- has to be kept in step. Sorting keys are whitelisted through the spec, and
-- every value is interpolated as a quoted literal: no text from a client ever
-- becomes SQL.
--
-- Measures written down here come from the Phase 5 engine and keep its
-- definitions: takings include tax, revenue does not, profit is revenue minus
-- cost of goods.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Two views the reports stand on
-- ══════════════════════════════════════════════════════════════════════════
--
-- `security_invoker` because a view without it runs as its owner and would
-- hand every organization's stock to any signed-in user (docs/09 #5).

create or replace view public.inventory_valuation
with (security_invoker = true) as
  select sb.organization_id,
         w.branch_id,
         sb.warehouse_id,
         w.name          as warehouse_name,
         p.id            as product_id,
         p.name          as product_name,
         p.sku,
         p.reorder_point,
         pc.name         as category_name,
         v.id            as variant_id,
         v.name_suffix   as variant_name,
         sb.quantity,
         sb.avg_unit_cost,
         round(sb.quantity * sb.avg_unit_cost, 2) as stock_value,
         case
           when not p.track_stock then 'untracked'
           when sb.quantity <= 0 then 'out'
           when sb.quantity <= p.reorder_point then 'low'
           else 'ok'
         end             as stock_state
    from public.stock_balances sb
    join public.products p          on p.id = sb.product_id
    join public.product_variants v  on v.id = sb.variant_id
    join public.warehouses w        on w.id = sb.warehouse_id
    left join public.product_categories pc on pc.id = p.category_id
   where p.deleted_at is null;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. What a report is
-- ══════════════════════════════════════════════════════════════════════════
--
-- Returns the spec as jsonb. Everything in it is written by this migration —
-- the only values that vary with a caller are quoted as literals.

create or replace function app.report_spec(
  p_report text,
  p_org    uuid,
  p_branch uuid,
  p_from   timestamptz,
  p_to     timestamptz,
  p_filters jsonb
)
returns jsonb
language plpgsql
stable
as $fn$
declare
  v_org_filter text;
  v_from_lit text;
  v_to_lit text;
  v_spec jsonb;
  v_type text;
  v_method uuid;
begin
  v_org_filter := format('%L', p_org);
  v_from_lit   := format('%L', p_from);
  v_to_lit     := format('%L', p_to);

  v_type   := nullif(p_filters ->> 'type', '');
  v_method := nullif(p_filters ->> 'method_id', '')::uuid;

  case p_report

  when 'sales' then
    v_spec := jsonb_build_object(
      'title', 'Sales',
      'group', 'Money',
      'description', 'Every completed bill in the period, with what it earned.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','invoice_no','label','Invoice','type','text'),
        jsonb_build_object('key','created_at','label','When','type','date'),
        jsonb_build_object('key','customer_name','label','Customer','type','text'),
        jsonb_build_object('key','cashier','label','Cashier','type','text'),
        jsonb_build_object('key','status','label','Status','type','status'),
        jsonb_build_object('key','subtotal','label','Subtotal','type','money','align','right'),
        jsonb_build_object('key','discount_total','label','Discount','type','money','align','right'),
        jsonb_build_object('key','tax_total','label','Tax','type','money','align','right'),
        jsonb_build_object('key','total','label','Total','type','money','align','right'),
        jsonb_build_object('key','refunded','label','Refunded','type','money','align','right'),
        jsonb_build_object('key','profit','label','Profit','type','money','align','right')
      ),
      'select', 'sd.id, sd.invoice_no, sd.created_at, sd.customer_name,
                 app.actor_email(sd.created_by) as cashier, sd.status,
                 sd.subtotal, sd.discount_total, sd.tax_total, sd.total,
                 coalesce(rf.refunded, 0) as refunded, sd.profit',
      'from', format('public.sales_detail sd
                      left join lateral (
                        select round(sum(sr.refund_total), 2) as refunded
                          from public.sale_returns sr where sr.sale_id = sd.id
                      ) rf on true'),
      'where', format('sd.organization_id = %L
                       and sd.created_at >= %s and sd.created_at < %s%s',
                      p_org, v_from_lit, v_to_lit,
                      case when p_branch is not null
                           then format(' and sd.branch_id = %L', p_branch) else '' end),
      'search', 'sd.invoice_no || '' '' || coalesce(sd.customer_name, '''')',
      'sort', jsonb_build_object('created_at','sd.created_at','total','sd.total',
                                 'profit','sd.profit','discount_total','sd.discount_total',
                                 'invoice_no','sd.invoice_no','refunded','coalesce(rf.refunded, 0)'),
      'default_sort', 'created_at',
      'totals', jsonb_build_array('subtotal','discount_total','tax_total','total','refunded','profit')
    );

  when 'profit' then
    v_spec := jsonb_build_object(
      'title', 'Profit',
      'group', 'Money',
      'description', 'Revenue, cost of goods and margin per bill — the same figures the P&L reads.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','invoice_no','label','Invoice','type','text'),
        jsonb_build_object('key','created_at','label','When','type','date'),
        jsonb_build_object('key','customer_name','label','Customer','type','text'),
        jsonb_build_object('key','revenue','label','Revenue','type','money','align','right'),
        jsonb_build_object('key','cogs','label','Cost of goods','type','money','align','right'),
        jsonb_build_object('key','profit','label','Profit','type','money','align','right'),
        jsonb_build_object('key','margin','label','Margin %','type','percent','align','right')
      ),
      'select', 'sd.invoice_no, sd.created_at, sd.customer_name,
                 round(sd.total - sd.tax_total, 2) as revenue,
                 sd.cogs, sd.profit,
                 round((sd.total - sd.tax_total - sd.cogs)
                       / nullif(sd.total - sd.tax_total, 0) * 100, 1) as margin',
      'from', 'public.sales_detail sd',
      'where', format('sd.organization_id = %L
                       and sd.created_at >= %s and sd.created_at < %s%s',
                      p_org, v_from_lit, v_to_lit,
                      case when p_branch is not null
                           then format(' and sd.branch_id = %L', p_branch) else '' end),
      'search', 'sd.invoice_no || '' '' || coalesce(sd.customer_name, '''')',
      'sort', jsonb_build_object('created_at','sd.created_at','revenue','revenue',
                                 'cogs','sd.cogs','profit','sd.profit','margin','margin'),
      'default_sort', 'created_at',
      'totals', jsonb_build_array('revenue','cogs','profit')
    );

  when 'inventory' then
    v_spec := jsonb_build_object(
      'title', 'Inventory',
      'group', 'Stock',
      'description', 'What is on the shelves right now, at weighted average cost.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','sku','label','SKU','type','text'),
        jsonb_build_object('key','product_name','label','Product','type','text'),
        jsonb_build_object('key','variant_name','label','Variant','type','text'),
        jsonb_build_object('key','category_name','label','Category','type','text'),
        jsonb_build_object('key','warehouse_name','label','Location','type','text'),
        jsonb_build_object('key','quantity','label','On hand','type','qty','align','right'),
        jsonb_build_object('key','avg_unit_cost','label','Unit cost','type','money','align','right'),
        jsonb_build_object('key','stock_value','label','Value','type','money','align','right'),
        jsonb_build_object('key','reorder_point','label','Reorder at','type','qty','align','right'),
        jsonb_build_object('key','stock_state','label','State','type','status')
      ),
      'select', 'iv.sku, iv.product_name, iv.variant_name, iv.category_name,
                 iv.warehouse_name, iv.quantity, iv.avg_unit_cost, iv.stock_value,
                 iv.reorder_point, iv.stock_state',
      'from', 'public.inventory_valuation iv',
      'where', format('iv.organization_id = %L%s%s',
                      p_org,
                      case when p_branch is not null
                           then format(' and iv.branch_id = %L', p_branch) else '' end,
                      case when v_type = 'low' then ' and iv.stock_state in (''low'', ''out'')'
                           when v_type = 'untracked' then ' and iv.stock_state = ''untracked'''
                           else '' end),
      'search', 'iv.product_name || '' '' || coalesce(iv.sku, '''') || '' '' || coalesce(iv.category_name, '''')',
      'sort', jsonb_build_object('product_name','iv.product_name','quantity','iv.quantity',
                                 'stock_value','iv.stock_value','avg_unit_cost','iv.avg_unit_cost',
                                 'sku','iv.sku','category_name','iv.category_name'),
      'default_sort', 'stock_value',
      'totals', jsonb_build_array('quantity','stock_value')
    );

  when 'product_performance' then
    v_spec := jsonb_build_object(
      'title', 'Product performance',
      'group', 'Selling',
      'description', 'Units, takings, cost and profit per item — including what came back.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','product_name','label','Product','type','text'),
        jsonb_build_object('key','variant_name','label','Variant','type','text'),
        jsonb_build_object('key','units_sold','label','Units','type','qty','align','right'),
        jsonb_build_object('key','orders','label','Bills','type','int','align','right'),
        jsonb_build_object('key','takings','label','Takings','type','money','align','right'),
        jsonb_build_object('key','cogs','label','Cost of goods','type','money','align','right'),
        jsonb_build_object('key','profit','label','Profit','type','money','align','right'),
        jsonb_build_object('key','margin','label','Margin %','type','percent','align','right'),
        jsonb_build_object('key','returned_qty','label','Returned','type','qty','align','right'),
        jsonb_build_object('key','returned_value','label','Refunded','type','money','align','right')
      ),
      'select', 'si.product_name, si.variant_name, si.sku,
                 sum(si.quantity) as units_sold,
                 count(distinct si.sale_id) as orders,
                 round(sum(si.line_total * (1 - si.order_share)), 2) as takings,
                 round(sum(si.line_cogs), 2) as cogs,
                 round(sum(si.line_total * (1 - si.order_share) - si.tax_total - si.line_cogs), 2) as profit,
                 round(sum(si.line_total * (1 - si.order_share) - si.tax_total - si.line_cogs)
                       / nullif(sum(si.line_total * (1 - si.order_share) - si.tax_total), 0) * 100, 1) as margin,
                 coalesce(ret.returned_qty, 0) as returned_qty,
                 coalesce(ret.returned_value, 0) as returned_value',
      'from', format('(select si0.product_id, si0.variant_id, si0.product_name,
                             v0.name_suffix as variant_name, si0.sku,
                             si0.quantity, si0.tax_total, si0.line_total, si0.line_cogs,
                             si0.sale_id,
                             case when coalesce(pool.line_pool, 0) > 0
                                  then greatest(s0.discount_total - coalesce(pool.line_disc, 0), 0)
                                       / pool.line_pool
                                  else 0 end as order_share
                        from public.sale_items si0
                        join public.sales s0 on s0.id = si0.sale_id
                        left join public.product_variants v0 on v0.id = si0.variant_id
                        left join (
                          select si2.sale_id, sum(si2.line_total) as line_pool,
                                 sum(si2.discount_total) as line_disc
                            from public.sale_items si2 group by 1
                        ) pool on pool.sale_id = si0.sale_id
                       where s0.organization_id = %L
                         and s0.created_at >= %s and s0.created_at < %s
                         and s0.status in (''COMPLETED'',''PARTIALLY_PAID'',''PARTIALLY_REFUNDED'')%s
                     ) si
                     left join (
                       select sit.variant_id,
                              sum(sri.quantity)      as returned_qty,
                              round(sum(sri.refund_amount), 2) as returned_value
                         from public.sale_return_items sri
                         join public.sale_items sit on sit.id = sri.sale_item_id
                         join public.sale_returns sr on sr.id = sri.return_id
                        where sr.organization_id = %L
                          and sr.created_at >= %s and sr.created_at < %s
                        group by 1
                     ) ret on ret.variant_id = si.variant_id',
                     p_org, v_from_lit, v_to_lit,
                     case when p_branch is not null
                          then format(' and s0.branch_id = %L', p_branch) else '' end,
                     p_org, v_from_lit, v_to_lit),
      'search', 'si.product_name || '' '' || coalesce(si.sku, '''') || '' '' || coalesce(si.variant_name, '''')',
      'sort', jsonb_build_object('takings','takings','units_sold','units_sold','profit','profit',
                                 'cogs','cogs','margin','margin','returned_value','returned_value',
                                 'product_name','si.product_name'),
      'default_sort', 'takings',
      'grouped', 'si.product_id, si.variant_id, si.product_name, si.variant_name, si.sku,
                  ret.returned_qty, ret.returned_value',
      'totals', jsonb_build_array('units_sold','orders','takings','cogs','profit','returned_value')
    );

  when 'customer' then
    v_spec := jsonb_build_object(
      'title', 'Customers',
      'group', 'People',
      'description', 'Who buys, how much, and who still owes.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','name','label','Customer','type','text'),
        jsonb_build_object('key','phone','label','Phone','type','text'),
        jsonb_build_object('key','orders','label','Bills','type','int','align','right'),
        jsonb_build_object('key','takings','label','Takings','type','money','align','right'),
        jsonb_build_object('key','profit','label','Profit','type','money','align','right'),
        jsonb_build_object('key','avg_bill','label','Average bill','type','money','align','right'),
        jsonb_build_object('key','last_purchase','label','Last bought','type','date'),
        jsonb_build_object('key','balance','label','Owes us','type','money','align','right'),
        jsonb_build_object('key','store_credit','label','Store credit','type','money','align','right')
      ),
      'select', 'c.name, c.phone,
                 coalesce(a.orders, 0) as orders,
                 coalesce(a.takings, 0) as takings,
                 coalesce(a.profit, 0) as profit,
                 coalesce(a.avg_bill, 0) as avg_bill,
                 a.last_purchase,
                 c.balance, c.store_credit',
      'from', format('public.customers c
                      left join lateral (
                        select count(*) as orders,
                               round(sum(s.total), 2) as takings,
                               round(sum(s.profit), 2) as profit,
                               round(avg(s.total), 2) as avg_bill,
                               max(s.created_at) as last_purchase
                          from public.sales s
                         where s.organization_id = %L and s.customer_id = c.id
                           and s.created_at >= %s and s.created_at < %s
                           and s.status in (''COMPLETED'',''PARTIALLY_PAID'',''PARTIALLY_REFUNDED'')%s
                      ) a on true',
                     p_org, v_from_lit, v_to_lit,
                     case when p_branch is not null
                          then format(' and s.branch_id = %L', p_branch) else '' end),
      'where', format('c.organization_id = %L and c.deleted_at is null%s',
                      p_org,
                      case when v_type = 'owing' then ' and c.balance > 0' else '' end),
      'search', 'c.name || '' '' || coalesce(c.phone, '''') || '' '' || coalesce(c.email, '''')',
      'sort', jsonb_build_object('name','c.name','takings','coalesce(a.takings, 0)',
                                 'profit','coalesce(a.profit, 0)','orders','coalesce(a.orders, 0)',
                                 'balance','c.balance','last_purchase','a.last_purchase',
                                 'store_credit','c.store_credit'),
      'default_sort', 'takings',
      'totals', jsonb_build_array('orders','takings','profit','balance','store_credit')
    );

  when 'supplier' then
    v_spec := jsonb_build_object(
      'title', 'Suppliers',
      'group', 'People',
      'description', 'What we bought, what we paid, what is still owed.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','name','label','Supplier','type','text'),
        jsonb_build_object('key','phone','label','Phone','type','text'),
        jsonb_build_object('key','purchases','label','Orders','type','int','align','right'),
        jsonb_build_object('key','spend','label','Purchased','type','money','align','right'),
        jsonb_build_object('key','paid','label','Paid','type','money','align','right'),
        jsonb_build_object('key','due_in_period','label','Added to balance','type','money','align','right'),
        jsonb_build_object('key','balance','label','Owed now','type','money','align','right'),
        jsonb_build_object('key','last_purchase','label','Last order','type','date')
      ),
      'select', 'sup.name, sup.phone,
                 coalesce(a.purchases, 0) as purchases,
                 coalesce(a.spend, 0) as spend,
                 coalesce(a.paid, 0) as paid,
                 coalesce(a.due_in_period, 0) as due_in_period,
                 sup.balance,
                 a.last_purchase',
      'from', format('public.suppliers sup
                      left join lateral (
                        select count(*) as purchases,
                               round(sum(p.total), 2) as spend,
                               round(sum(p.paid_total), 2) as paid,
                               round(sum(p.total - p.paid_total), 2) as due_in_period,
                               max(p.created_at) as last_purchase
                          from public.purchases p
                         where p.organization_id = %L and p.supplier_id = sup.id
                           and p.status <> ''DRAFT''
                           and p.created_at >= %s and p.created_at < %s%s
                      ) a on true',
                     p_org, v_from_lit, v_to_lit,
                     case when p_branch is not null
                          then format(' and p.branch_id = %L', p_branch) else '' end),
      'where', format('sup.organization_id = %L and sup.deleted_at is null%s',
                      p_org,
                      case when v_type = 'owing' then ' and sup.balance > 0' else '' end),
      'search', 'sup.name || '' '' || coalesce(sup.phone, '''') || '' '' || coalesce(sup.email, '''')',
      'sort', jsonb_build_object('name','sup.name','spend','coalesce(a.spend, 0)',
                                 'paid','coalesce(a.paid, 0)','purchases','coalesce(a.purchases, 0)',
                                 'balance','sup.balance','last_purchase','a.last_purchase'),
      'default_sort', 'balance',
      'totals', jsonb_build_array('purchases','spend','paid','due_in_period','balance')
    );

  when 'expense' then
    v_spec := jsonb_build_object(
      'title', 'Expenses',
      'group', 'Money',
      'description', 'Every rupee that left the drawer that was not stock.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','expense_date','label','Date','type','date'),
        jsonb_build_object('key','category_name','label','Category','type','text'),
        jsonb_build_object('key','description','label','Description','type','text'),
        jsonb_build_object('key','method','label','Method','type','text'),
        jsonb_build_object('key','cashier','label','Recorded by','type','text'),
        jsonb_build_object('key','amount','label','Amount','type','money','align','right')
      ),
      'select', 'e.expense_date, coalesce(ec.name, ''Uncategorised'') as category_name,
                 e.description, pm.name as method,
                 app.actor_email(e.created_by) as cashier, e.amount',
      'from', 'public.expenses e
               left join public.expense_categories ec on ec.id = e.category_id
               left join public.payment_methods pm   on pm.id = e.method_id',
      'where', format('e.organization_id = %L and e.deleted_at is null
                       and e.expense_date >= (%s::timestamptz at time zone %L)::date
                       and e.expense_date <  (%s::timestamptz at time zone %L)::date%s',
                      p_org, v_from_lit, (select timezone from public.organizations where id = p_org),
                      v_to_lit, (select timezone from public.organizations where id = p_org),
                      case when p_branch is not null
                           then format(' and e.branch_id = %L', p_branch) else '' end),
      'search', 'coalesce(e.description, '''') || '' '' || coalesce(ec.name, '''')',
      'sort', jsonb_build_object('expense_date','e.expense_date','amount','e.amount',
                                 'category_name','coalesce(ec.name, '''')','description','e.description'),
      'default_sort', 'expense_date',
      'totals', jsonb_build_array('amount')
    );

  when 'payment' then
    v_spec := jsonb_build_object(
      'title', 'Payments',
      'group', 'Money',
      'description', 'Money received, by method — the drawer count starts here.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','created_at','label','When','type','date'),
        jsonb_build_object('key','invoice_no','label','Invoice','type','text'),
        jsonb_build_object('key','customer_name','label','Customer','type','text'),
        jsonb_build_object('key','method','label','Method','type','money_name'),
        jsonb_build_object('key','amount','label','Amount','type','money','align','right'),
        jsonb_build_object('key','reference','label','Reference','type','text'),
        jsonb_build_object('key','cashier','label','Taken by','type','text')
      ),
      'select', 'sp.received_at as created_at, s.invoice_no, c.name as customer_name,
                 pm.name as method, sp.amount, sp.reference,
                 app.actor_email(sp.received_by) as cashier',
      'from', 'public.sale_payments sp
               join public.sales s     on s.id = sp.sale_id
               left join public.customers c on c.id = s.customer_id
               join public.payment_methods pm on pm.id = sp.method_id',
      'where', format('sp.organization_id = %L
                       and sp.received_at >= %s and sp.received_at < %s%s%s',
                      p_org, v_from_lit, v_to_lit,
                      case when p_branch is not null
                           then format(' and s.branch_id = %L', p_branch) else '' end,
                      case when v_method is not null
                           then format(' and sp.method_id = %L', v_method) else '' end),
      'search', 's.invoice_no || '' '' || coalesce(c.name, '''') || '' '' || coalesce(sp.reference, '''')',
      'sort', jsonb_build_object('created_at','sp.received_at','amount','sp.amount',
                                 'method','pm.name','invoice_no','s.invoice_no'),
      'default_sort', 'created_at',
      'totals', jsonb_build_array('amount')
    );

  when 'cashier' then
    v_spec := jsonb_build_object(
      'title', 'Cashiers',
      'group', 'People',
      'description', 'Who sold what, and how their drawer reconciled.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','cashier','label','Cashier','type','text'),
        jsonb_build_object('key','orders','label','Bills','type','int','align','right'),
        jsonb_build_object('key','takings','label','Takings','type','money','align','right'),
        jsonb_build_object('key','avg_bill','label','Average bill','type','money','align','right'),
        jsonb_build_object('key','discount','label','Discount given','type','money','align','right'),
        jsonb_build_object('key','profit','label','Profit','type','money','align','right'),
        jsonb_build_object('key','refunds','label','Refunded','type','money','align','right'),
        jsonb_build_object('key','sessions','label','Drawers opened','type','int','align','right'),
        jsonb_build_object('key','variance','label','Cash variance','type','money','align','right')
      ),
      'select', 'a.cashier, a.orders, a.takings, a.avg_bill, a.discount, a.profit,
                 coalesce(r.refunds, 0) as refunds,
                 coalesce(rs.sessions, 0) as sessions,
                 coalesce(rs.variance, 0) as variance',
      'from', format('(select app.actor_email(s.created_by) as cashier,
                             count(*) as orders,
                             round(sum(s.total), 2) as takings,
                             round(avg(s.total), 2) as avg_bill,
                             round(sum(s.discount_total), 2) as discount,
                             round(sum(s.profit), 2) as profit,
                             s.created_by
                        from public.sales s
                       where s.organization_id = %L
                         and s.created_at >= %s and s.created_at < %s
                         and s.status in (''COMPLETED'',''PARTIALLY_PAID'',''PARTIALLY_REFUNDED'')
                         and s.created_by is not null%s
                       group by s.created_by, app.actor_email(s.created_by)
                     ) a
                     left join (
                       select sr.created_by,
                              round(sum(sr.refund_total), 2) as refunds
                         from public.sale_returns sr
                        where sr.organization_id = %L
                          and sr.created_at >= %s and sr.created_at < %s
                        group by 1
                     ) r on r.created_by = a.created_by
                     left join (
                       select opened_by,
                              count(*) as sessions,
                              round(sum(closing_cash - (opening_cash + cash_in - cash_out
                                    + sales_cash - refund_cash - expense_cash)), 2) as variance
                         from public.register_sessions
                        where organization_id = %L and closed_at is not null
                          and opened_at >= %s and opened_at < %s%s
                        group by 1
                     ) rs on rs.opened_by = a.created_by',
                     p_org, v_from_lit, v_to_lit,
                     case when p_branch is not null
                          then format(' and s.branch_id = %L', p_branch) else '' end,
                     p_org, v_from_lit, v_to_lit,
                     p_org, v_from_lit, v_to_lit,
                     case when p_branch is not null
                          then format(' and branch_id = %L', p_branch) else '' end),
      'search', 'a.cashier',
      'sort', jsonb_build_object('cashier','a.cashier','takings','a.takings','orders','a.orders',
                                 'profit','a.profit','refunds','coalesce(r.refunds, 0)',
                                 'discount','a.discount','variance','coalesce(rs.variance, 0)'),
      'default_sort', 'takings',
      'totals', jsonb_build_array('orders','takings','discount','profit','refunds','variance')
    );

  when 'low_stock' then
    v_spec := jsonb_build_object(
      'title', 'Reorder list',
      'group', 'Stock',
      'description', 'Everything at or below its reorder point, with how much is missing.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','product_name','label','Product','type','text'),
        jsonb_build_object('key','variant_name','label','Variant','type','text'),
        jsonb_build_object('key','sku','label','SKU','type','text'),
        jsonb_build_object('key','warehouse_name','label','Location','type','text'),
        jsonb_build_object('key','quantity','label','On hand','type','qty','align','right'),
        jsonb_build_object('key','reorder_point','label','Reorder at','type','qty','align','right'),
        jsonb_build_object('key','shortfall','label','Short by','type','qty','align','right'),
        jsonb_build_object('key','avg_unit_cost','label','Unit cost','type','money','align','right'),
        jsonb_build_object('key','restock_cost','label','Cost to restock','type','money','align','right')
      ),
      'select', 'ls.name as product_name, ls.name_suffix as variant_name, ls.sku,
                 ls.warehouse_name, ls.quantity, ls.reorder_point,
                 greatest(ls.reorder_point - ls.quantity, 0) as shortfall,
                 ls.avg_unit_cost,
                 round(greatest(ls.reorder_point - ls.quantity, 0) * ls.avg_unit_cost, 2) as restock_cost',
      'from', 'public.low_stock ls',
      'where', format('ls.organization_id = %L and ls.quantity <= ls.reorder_point', p_org),
      'search', 'ls.name || '' '' || coalesce(ls.sku, '''')',
      'sort', jsonb_build_object('product_name','ls.name','quantity','ls.quantity',
                                 'shortfall','shortfall','restock_cost','restock_cost',
                                 'sku','ls.sku'),
      'default_sort', 'shortfall',
      'totals', jsonb_build_array('quantity','shortfall','restock_cost')
    );

  when 'stock_movement' then
    v_spec := jsonb_build_object(
      'title', 'Stock movements',
      'group', 'Stock',
      'description', 'The ledger: every reason a quantity changed, and who changed it.',
      'columns', jsonb_build_array(
        jsonb_build_object('key','created_at','label','When','type','date'),
        jsonb_build_object('key','product_name','label','Product','type','text'),
        jsonb_build_object('key','variant_name','label','Variant','type','text'),
        jsonb_build_object('key','warehouse_name','label','Location','type','text'),
        jsonb_build_object('key','type','label','Reason','type','status'),
        jsonb_build_object('key','delta','label','Change','type','qty','align','right'),
        jsonb_build_object('key','before_quantity','label','Before','type','qty','align','right'),
        jsonb_build_object('key','after_quantity','label','After','type','qty','align','right'),
        jsonb_build_object('key','unit_cost','label','Unit cost','type','money','align','right'),
        jsonb_build_object('key','reference_type','label','Source','type','text'),
        jsonb_build_object('key','cashier','label','By','type','text'),
        jsonb_build_object('key','note','label','Note','type','text')
      ),
      'select', 'sh.created_at, sh.product_name, sh.variant_name, sh.warehouse_name,
                 sh.type, sh.delta, sh.before_quantity, sh.after_quantity, sh.unit_cost,
                 sh.reference_type, app.actor_email(sh.user_id) as cashier, sh.note',
      'from', 'public.stock_history sh',
      'where', format('sh.organization_id = %L
                       and sh.created_at >= %s and sh.created_at < %s%s',
                      p_org, v_from_lit, v_to_lit,
                      case when p_branch is not null
                           then format(' and sh.warehouse_id in
                                  (select id from public.warehouses where branch_id = %L)', p_branch)
                           else '' end),
      'search', 'sh.product_name || '' '' || coalesce(sh.note, '''') || '' '' || coalesce(sh.type, '''')',
      'sort', jsonb_build_object('created_at','sh.created_at','product_name','sh.product_name',
                                 'delta','sh.delta','type','sh.type'),
      'default_sort', 'created_at',
      'totals', jsonb_build_array('delta')
    );

  else
    raise exception 'unknown_report: %', p_report using errcode = '22023';
  end case;

  return v_spec || jsonb_build_object('key', p_report);
end
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Run a report
-- ══════════════════════════════════════════════════════════════════════════
--
-- Filters, search, sort and pagination are all server-side: a shop with two
-- years of bills must not wait for a phone to download them all in order to
-- show page one. The totals and the row count come from the same statement as
-- the rows, so "431 rows, ৳1,20,000" can never describe a different set from
-- the one on screen.

create or replace function public.report_rows(
  p_report    text,
  p_branch_id uuid  default null,
  p_period    text  default 'month',
  p_from      date  default null,
  p_to        date  default null,
  p_search    text  default null,
  p_sort      text  default null,
  p_dir       text  default 'desc',
  p_limit     int   default 25,
  p_offset    int   default 0,
  p_filters   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_win jsonb;
  v_org uuid;
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_spec jsonb;
  v_sort_key text;
  v_sort_expr text;
  v_dir text;
  v_where text;
  v_search text;
  v_limit int;
  v_offset int;
  v_rows jsonb;
  v_agg jsonb;
  v_aggs text := '';
  v_col text;
  v_row_sql text;
begin
  perform app.require_permission('reports.view');

  v_win := app.analytics_window(coalesce(p_branch_id, app.current_branch_id()), p_period, p_from, p_to);
  v_org := (v_win ->> 'org')::uuid;
  perform app.require_org(v_org);
  v_tz := v_win ->> 'timezone';

  -- The window arrives as branch-local dates and becomes instants here, so a
  -- "today" report means the shop's today (docs/09 #14).
  v_from := (((v_win ->> 'from')::date)::timestamp AT TIME ZONE v_tz);
  v_to   := (((v_win ->> 'to')::date)::timestamp AT TIME ZONE v_tz);

  v_spec := app.report_spec(p_report, v_org, p_branch_id, v_from, v_to, p_filters);

  v_sort_key  := coalesce(nullif(p_sort, ''), v_spec ->> 'default_sort');
  v_sort_expr := v_spec -> 'sort' ->> v_sort_key;
  if v_sort_expr is null then
    v_sort_key  := v_spec ->> 'default_sort';
    v_sort_expr := v_spec -> 'sort' ->> v_sort_key;
  end if;
  v_dir := case when lower(coalesce(p_dir, 'desc')) = 'asc' then 'asc' else 'desc' end;

  -- A report may carry its own filters inside FROM (product performance
  -- already windows by period there), so `where` can legitimately be empty.
  v_where  := coalesce(v_spec ->> 'where', '');
  v_search := nullif(trim(coalesce(p_search, '')), '');
  if v_search is not null and (v_spec ->> 'search') is not null then
    -- strpos, not LIKE: a search for "50%" must not become a wildcard, and a
    -- name with an underscore must match itself.
    v_where := v_where ||
      case when v_where = '' then '' else ' and ' end ||
      format('strpos(lower(%s), lower(%L)) > 0', v_spec ->> 'search', v_search);
  end if;

  v_limit  := least(greatest(coalesce(p_limit, 25), 1), 50000);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  -- `order by <key> <dir>, 1` — the tiebreak is the first selected column:
  -- a page of equal values (every row with the same total) must still come
  -- back in the same order when the offset moves, or pagination silently
  -- repeats rows and drops others.
  v_row_sql := format('select %s from %s%s%s order by %s %s, 1 asc',
                      v_spec ->> 'select', v_spec ->> 'from',
                      case when v_where = '' then '' else ' where ' || v_where end,
                      case when (v_spec ->> 'grouped') is not null
                           then ' group by ' || (v_spec ->> 'grouped') else '' end,
                      v_sort_expr, v_dir);

  -- Totals and row count over the whole filtered set: the row SQL without its
  -- page, wrapped so that a per-group report totals the groups.
  -- `jsonb_array_elements_text` gives the column names as text, which is what
  -- a jsonb_build_object key wants: `%L` quotes it, so a column name can never
  -- be read as SQL.
  for v_col in select * from jsonb_array_elements_text(v_spec -> 'totals') loop
    v_aggs := v_aggs || format('%L, coalesce(round(sum(t.%I)::numeric, 2), 0), ', v_col, v_col);
  end loop;
  v_aggs := v_aggs || '''total_rows'', count(*)::int';

  execute format(
    'select jsonb_build_object(%s) from (%s) t', v_aggs, v_row_sql
  ) into v_agg;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (%s limit %s offset %s) t',
    v_row_sql, v_limit, v_offset
  ) into v_rows;

  return jsonb_build_object(
    'key', p_report,
    'title', v_spec ->> 'title',
    'group', v_spec ->> 'group',
    'description', v_spec ->> 'description',
    'columns', v_spec -> 'columns',
    'rows', v_rows,
    'totals', coalesce(v_agg, '{}'::jsonb) - 'total_rows',
    'total_rows', coalesce((v_agg ->> 'total_rows')::int,
                           (select count(*) from jsonb_array_elements(v_rows))),
    'offset', v_offset,
    'limit', v_limit,
    'sort', v_sort_key,
    'dir', v_dir,
    'search', v_search,
    'period', p_period,
    'label', v_win ->> 'label',
    'from', v_win -> 'from',
    'to', v_win -> 'to',
    'currency', v_win ->> 'currency',
    'generated_at', now()
  );
end
$fn$;

-- The report library, from the same specs the runner uses: a report that
-- appears in this list is a report that runs, with exactly these columns.
create or replace function public.report_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_key text;
  v_out jsonb := '[]'::jsonb;
  v_spec jsonb;
begin
  perform app.require_permission('reports.view');
  v_org := (app.current_org_ids())[1];

  -- No window and no branch: a catalogue entry describes the columns and the
  -- description, and the period placeholders in a spec are never executed
  -- here. Asking for "the current branch" would make the library fail for a
  -- multi-branch owner who has not picked one yet — the screen would be empty
  -- for a reason that has nothing to do with reports.
  foreach v_key in array array['sales','profit','inventory','product_performance',
                               'customer','supplier','expense','payment','cashier',
                               'low_stock','stock_movement'] loop
    v_spec := app.report_spec(v_key, v_org, null,
                              (now() - interval '1 day'), now(), '{}'::jsonb);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', v_key,
      'title', v_spec ->> 'title',
      'group', v_spec ->> 'group',
      'description', v_spec ->> 'description',
      'columns', v_spec -> 'columns'
    ));
  end loop;

  return v_out;
end
$fn$;

-- ── Grants (018's rule) ───────────────────────────────────────────────────
revoke execute on function app.report_spec(text, uuid, uuid, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;

grant execute on function public.report_rows(text, uuid, text, date, date, text, text, text, int, int, jsonb)
  to authenticated;
grant execute on function public.report_catalog() to authenticated;

-- The views are read through the reporting functions, which filter by
-- organization explicitly. They are not part of the client API surface.
revoke all on public.inventory_valuation from anon, authenticated;
