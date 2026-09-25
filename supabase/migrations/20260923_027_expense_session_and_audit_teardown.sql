-- 027 — Two faults found by driving the deployed app, not by reading it.
--
-- Both were invisible to the migration validator because of *how* it tested:
-- it applies migrations as the owner (so privileges never bound) and it
-- asserted the register's expense figure from rows it had inserted itself
-- rather than through the RPC a shopkeeper actually calls. A function that
-- exists but is never executed has never been tested.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. `record_expense` could never record an expense
-- ══════════════════════════════════════════════════════════════════════════
--
-- The body tested `if v_session_id is not null` and updated
-- `where id = v_session_id`, but no such variable was ever declared — the
-- parameter is `p_session_id`. PL/pgSQL resolves identifiers at execution, so
-- the function compiled cleanly, was granted, shipped, and then answered every
-- call with
--
--     column "v_session_id" does not exist   (SQLSTATE 42703)
--
-- That is not an edge case: it is rent, electricity, transport and tea, which
-- is the whole of §24. The fix is the parameter's own name, and the drawer
-- effect is what the register's expected-cash figure depends on.

create or replace function public.record_expense(
  p_branch_id   uuid,
  p_amount      numeric(14,2),
  p_category_id uuid default null,
  p_method_id   uuid default null,
  p_description text default null,
  p_session_id  uuid default null,
  p_expense_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_id  uuid := gen_random_uuid();
  v_is_cash boolean := false;
begin
  select organization_id into v_org from public.branches where id = p_branch_id;
  if v_org is null then
    raise exception 'branch_not_found: %', p_branch_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('expenses.create');

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_must_be_positive' using errcode = '22023';
  end if;

  -- A session that is already closed cannot take an expense: the drawer has
  -- been counted, and adding to it afterwards would make the closing figure
  -- unreconcilable.
  if p_session_id is not null then
    if not exists (select 1 from public.register_sessions
                    where id = p_session_id and closed_at is null) then
      raise exception 'session_not_open: %', p_session_id using errcode = 'P0001';
    end if;
  end if;

  insert into public.expenses (
    id, organization_id, branch_id, category_id, session_id, amount,
    method_id, description, expense_date, created_by
  ) values (
    v_id, v_org, p_branch_id, p_category_id, p_session_id, p_amount,
    p_method_id, p_description, p_expense_date, auth.uid()
  );

  select is_cash into v_is_cash from public.payment_methods where id = p_method_id;

  if p_session_id is not null and coalesce(v_is_cash, false) then
    update public.register_sessions
       set expense_cash = expense_cash + p_amount
     where id = p_session_id and closed_at is null;
  end if;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'expense.recorded', 'expense', v_id,
          jsonb_build_object('expense_id', v_id, 'amount', p_amount,
                             'branch_id', p_branch_id));

  return v_id;
end
$fn$;

grant execute on function public.record_expense(uuid, numeric, uuid, uuid, text, uuid, date)
  to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. The audit trigger fought a shop's teardown
-- ══════════════════════════════════════════════════════════════════════════
--
-- Deleting an organization cascades into every table the trigger watches, and
-- each cascaded delete fired the trigger, which tried to write an audit row
-- naming an organization whose row had already gone:
--
--     insert or update on table "audit_logs" violates foreign key constraint
--     "audit_logs_organization_id_fkey"
--
-- The trail for a shop cannot outlive the shop, so the trigger now checks that
-- the organization still exists and stays quiet when it does not. Nothing else
-- changes: within a live organization, every insert, real update and delete is
-- still recorded.

create or replace function app.record_audit()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $fn$
declare
  v_new      jsonb;
  v_old      jsonb;
  v_org      uuid;
  v_entity   uuid;
  v_action   text;
  v_entity_t text := tg_table_name;
  v_actor    uuid := auth.uid();
begin
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;

  -- A no-op update is not an audited event. `updated_at` is excluded because
  -- the BEFORE trigger has already touched it, so every save would otherwise
  -- look like a change.
  if tg_op = 'UPDATE' and (v_new - 'updated_at') = (v_old - 'updated_at') then
    return null;
  end if;

  -- Every audited table carries organization_id; a row without one cannot be
  -- attributed to a shop, and writing it would corrupt the tenancy scope the
  -- view is filtered by.
  v_org := coalesce(v_new ->> 'organization_id', v_old ->> 'organization_id')::uuid;
  if v_org is null then
    return null;
  end if;

  -- Torn down shop: the cascade is removing this row because the organization
  -- is going. There is no one left to read the trail, and writing it would
  -- abort the delete with a foreign-key violation mid-cascade.
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;

  v_entity := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  v_action := case tg_op
    when 'INSERT' then 'create'
    when 'UPDATE' then 'update'
    else 'delete'
  end;

  insert into public.audit_logs
        (organization_id, actor_id, action, entity_type, entity_id, before, after)
  values (v_org, v_actor, v_action, v_entity_t, v_entity, v_old, v_new);

  return null;
end
$fn$;
