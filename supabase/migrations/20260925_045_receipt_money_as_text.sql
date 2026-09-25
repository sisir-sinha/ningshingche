-- 045 — the receipt's money is text, which is what every client is written for.
--
-- Found by the Android reference (`npm run e2e:android`), which decoded a live
-- response and refused it:
--
--     Unexpected JSON token at offset 8: Expected quotation mark '"',
--     but had '0' instead at path: $.tax
--
-- `app.sale_receipt` passed the `sales` columns straight into
-- `jsonb_build_object`, so `numeric` arrived as a JSON **number**. The
-- documented shape (`CompletedSale` in `src/shared/types/records.ts`: "Money as
-- strings, per PostgREST") and the Kotlin mirror both declare text, and the
-- browser only escaped notice because `Math.round(Number(value) * 100)` happens
-- to accept a number too. A strict client does not, and an offline till that
-- cannot decode the receipt of the sale it just queued has lost the sale's
-- printed total.
--
-- One place builds the receipt, so one change fixes both the fresh sale and the
-- replayed one: a replay cannot drift from a fresh receipt, which is the
-- property the offline queue compares.

create or replace function app.sale_receipt(p_sale_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'sale_id',    s.id,
    'invoice_no', s.invoice_no,
    'status',     s.status,
    'subtotal',   s.subtotal::text,
    'discount',   s.discount_total::text,
    'tax',        s.tax_total::text,
    'total',      s.total::text,
    'paid',       s.paid_total::text,
    'change_due', s.change_due::text
  )
    from public.sales s
   where s.id = p_sale_id;
$fn$;

-- Restated, not inherited: this function returns any sale in any shop by id, so
-- it is not client API. `create or replace` keeps the existing ACL, which is
-- exactly why the revoke is repeated here rather than assumed.
revoke execute on function app.sale_receipt(uuid) from public, anon, authenticated;

do $verify$
declare
  v_body text;
  v_casts integer;
begin
  v_body := pg_get_functiondef('app.sale_receipt(uuid)'::regprocedure);

  -- Six money fields, six casts. Counted rather than spot-checked, because the
  -- bug was exactly a *missing* cast on one field, and a receipt that is text
  -- except for `tax` is a receipt a client still cannot decode.
  v_casts := (length(v_body) - length(replace(v_body, '::text', ''))) / 6;
  if v_casts <> 6 then
    raise exception 'sale_receipt has % text casts, expected 6 (one per money field)', v_casts
      using errcode = 'P0001';
  end if;

  if position('s.total::text' in v_body) = 0 or position('s.tax_total::text' in v_body) = 0 then
    raise exception 'sale_receipt does not cast its totals to text' using errcode = 'P0001';
  end if;

  -- And it is still not reachable by a client, whatever else changed.
  if has_function_privilege('authenticated', 'app.sale_receipt(uuid)', 'EXECUTE') then
    raise exception 'sale_receipt became executable by authenticated' using errcode = 'P0001';
  end if;
end
$verify$;
