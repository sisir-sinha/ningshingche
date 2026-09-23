-- 014 — Register session and expense RPCs (spec §24, §25).

create or replace function public.open_register(
  p_register_id  uuid,
  p_opening_cash numeric(14,2) default 0,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org     uuid;
  v_branch  uuid;
  v_id      uuid := gen_random_uuid();
begin
  select organization_id, branch_id into v_org, v_branch
    from public.registers where id = p_register_id and is_active;
  if v_org is null then
    raise exception 'register_not_found: %', p_register_id using errcode = 'P0002';
  end if;

  perform app.require_org(v_org);
  perform app.require_permission('register.open');

  if p_opening_cash < 0 then
    raise exception 'opening_cash_negative' using errcode = '22023';
  end if;

  -- The partial unique index one_open_session_per_register is what actually
  -- prevents a second open; this check only exists to produce a friendlier
  -- message. The race is closed by the index, not by this SELECT.
  if exists (select 1 from public.register_sessions
              where register_id = p_register_id and closed_at is null) then
    raise exception 'register_already_open: %', p_register_id using errcode = '23505';
  end if;

  insert into public.register_sessions
        (id, organization_id, register_id, branch_id, opened_by, opening_cash, note)
  values (v_id, v_org, p_register_id, v_branch, auth.uid(), p_opening_cash, p_note);

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'register.opened', 'register_session', v_id,
          jsonb_build_object('session_id', v_id, 'register_id', p_register_id,
                             'opening_cash', p_opening_cash));

  return v_id;
end;
$fn$;

create or replace function public.close_register(
  p_session_id   uuid,
  p_closing_cash numeric(14,2),
  p_note         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_session  public.register_sessions;
  v_expected numeric(14,2);
  v_variance numeric(14,2);
begin
  select * into v_session from public.register_sessions where id = p_session_id;
  if v_session.id is null then
    raise exception 'session_not_found: %', p_session_id using errcode = 'P0002';
  end if;
  if v_session.closed_at is not null then
    raise exception 'session_already_closed' using errcode = '22023';
  end if;

  perform app.require_org(v_session.organization_id);
  perform app.require_permission('register.close');

  if p_closing_cash < 0 then
    raise exception 'closing_cash_negative' using errcode = '22023';
  end if;

  v_expected := v_session.opening_cash
              + v_session.cash_in
              - v_session.cash_out
              + v_session.sales_cash
              - v_session.refund_cash
              - v_session.expense_cash;

  v_variance := p_closing_cash - v_expected;

  update public.register_sessions
     set closed_at     = now(),
         closed_by     = auth.uid(),
         closing_cash  = p_closing_cash,
         expected_cash = v_expected,
         variance      = v_variance,
         note          = coalesce(p_note, note)
   where id = p_session_id;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_session.organization_id, 'register.closed', 'register_session',
          p_session_id,
          jsonb_build_object('session_id', p_session_id,
                             'expected_cash', v_expected,
                             'closing_cash', p_closing_cash,
                             'variance', v_variance));

  return jsonb_build_object(
    'session_id',    p_session_id,
    'expected_cash', v_expected,
    'closing_cash',  p_closing_cash,
    'variance',      v_variance
  );
end;
$fn$;

-- Cash in / cash out against an open session (manual drawer movements).
create or replace function public.register_cash_movement(
  p_session_id uuid,
  p_amount     numeric(14,2),
  p_direction  smallint,             -- 1 = cash in, -1 = cash out
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_session public.register_sessions;
begin
  select * into v_session from public.register_sessions where id = p_session_id;
  if v_session.id is null or v_session.closed_at is not null then
    raise exception 'session_not_open: %', p_session_id using errcode = '22023';
  end if;

  perform app.require_org(v_session.organization_id);
  perform app.require_permission('register.adjust_cash');

  if p_amount <= 0 or p_direction not in (1, -1) then
    raise exception 'invalid_cash_movement' using errcode = '22023';
  end if;

  update public.register_sessions
     set cash_in  = cash_in + case when p_direction = 1 then p_amount else 0 end,
         cash_out = cash_out + case when p_direction = -1 then p_amount else 0 end
   where id = p_session_id;

  return jsonb_build_object(
    'session_id', p_session_id,
    'cash_in',  (select cash_in  from public.register_sessions where id = p_session_id),
    'cash_out', (select cash_out from public.register_sessions where id = p_session_id),
    'note',     p_note
  );
end;
$fn$;

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

  insert into public.expenses (
    id, organization_id, branch_id, category_id, session_id, amount,
    method_id, description, expense_date, created_by
  ) values (
    v_id, v_org, p_branch_id, p_category_id, p_session_id, p_amount,
    p_method_id, p_description, p_expense_date, auth.uid()
  );

  select is_cash into v_is_cash from public.payment_methods where id = p_method_id;

  if v_session_id is not null and coalesce(v_is_cash, false) then
    update public.register_sessions
       set expense_cash = expense_cash + p_amount
     where id = v_session_id and closed_at is null;
  end if;

  insert into public.outbox
        (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (v_org, 'expense.recorded', 'expense', v_id,
          jsonb_build_object('expense_id', v_id, 'amount', p_amount,
                             'branch_id', p_branch_id));

  return v_id;
end;
$fn$;
