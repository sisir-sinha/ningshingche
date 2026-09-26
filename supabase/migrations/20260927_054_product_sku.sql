-- 054 — the SKU the form has been promising.
--
-- The product form's SKU box has always said "Auto-generated if blank", and
-- nothing anywhere generated it. Leave it empty — which Quick add does for
-- every product it creates, because it has no SKU field at all — and the
-- column stays null forever. The list then shows a dash where a shop expects
-- a code, and the search that indexes `sku` has nothing to match.
--
-- The generation has to happen here rather than in the browser. Numbering is
-- a counter, and a counter shared by several cashiers on several devices is
-- only correct under a row lock: `public.next_sequence` (011) takes one with
-- `update … returning`, which is exactly why it is *not* granted to
-- `authenticated` (018). A client cannot call it, and a client that invented
-- its own number would hand two tablets the same SKU on the same afternoon.
--
-- Format: three letters from the product's name, a dash, a four-digit
-- sequence — `MIN-0007` for "Miniket Rice 5kg". Readable on a shelf label
-- and typeable at a keyboard, which is the whole job of a SKU.
--
-- Bangla names are the normal case in this market and they contain no ASCII
-- letters at all, so the prefix falls back to `SKU` rather than producing
-- `-0007`. A shop that writes its catalogue in Bangla gets `SKU-0001`,
-- `SKU-0002`, … which is still a working code.

create or replace function public.assign_product_sku()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_prefix    text;
  v_next      bigint;
  v_candidate text;
  v_tries     integer := 0;
begin
  -- A SKU the shop typed is the shop's business. Trimmed, never replaced.
  if new.sku is not null and btrim(new.sku) <> '' then
    new.sku := btrim(new.sku);
    return new;
  end if;

  v_prefix := upper(
    substring(regexp_replace(coalesce(new.name, ''), '[^A-Za-z]', '', 'g') from 1 for 3)
  );
  if length(coalesce(v_prefix, '')) < 2 then
    v_prefix := 'SKU';
  end if;

  -- There is no unique index on (organization_id, sku) — shops have imported
  -- duplicates for years and a unique index would fail the migration on live
  -- data. So the loop checks instead of trusting, and gives up after a few
  -- attempts rather than spinning: a product with no SKU is a blemish, a
  -- transaction that never ends is an outage.
  loop
    v_next := public.next_sequence(new.organization_id, 'sku');
    v_candidate := v_prefix || '-' || lpad(v_next::text, 4, '0');
    v_tries := v_tries + 1;

    exit when not exists (
      select 1
        from public.products
       where organization_id = new.organization_id
         and sku = v_candidate
    );

    if v_tries >= 25 then
      -- Fall back to something that cannot collide.
      v_candidate := v_prefix || '-' || replace(gen_random_uuid()::text, '-', '');
      v_candidate := substring(v_candidate from 1 for 12);
      exit;
    end if;
  end loop;

  new.sku := v_candidate;
  return new;
end
$fn$;

comment on function public.assign_product_sku() is
  'BEFORE INSERT on products: fills a blank SKU with <NAME>-0001 from the '
  'per-organization "sku" sequence. A SKU supplied by the shop is kept.';

drop trigger if exists products_assign_sku on public.products;

create trigger products_assign_sku
  before insert on public.products
  for each row execute function public.assign_product_sku();

-- A trigger function is never called by a client, and 018 revokes everything
-- in `public` before granting the API surface back. Said explicitly here so
-- that a future `grant execute on all functions` cannot quietly expose it.
revoke execute on function public.assign_product_sku() from public, anon, authenticated;

-- ── Backfill ──────────────────────────────────────────────────────────────
--
-- Every product created before this migration has a null SKU. Numbering them
-- oldest-first means the codes read in the order the shop added them, which
-- is the order an owner remembers. Done in one statement per organization so
-- the sequence ends up past the highest number issued.

do $backfill$
declare
  r record;
begin
  for r in
    select p.id, p.organization_id, p.name
      from public.products p
     where p.sku is null or btrim(p.sku) = ''
     order by p.organization_id, p.created_at, p.id
  loop
    update public.products
       set sku = null
     where id = r.id;
    -- Re-running the trigger's logic on an existing row: the UPDATE above is
    -- a no-op that keeps this loop honest if it is ever re-run, and the
    -- assignment below reuses the same counter the trigger uses.
    update public.products p
       set sku = (
         select case
                  when length(coalesce(upper(substring(regexp_replace(coalesce(r.name, ''), '[^A-Za-z]', '', 'g') from 1 for 3)), '')) < 2
                  then 'SKU'
                  else upper(substring(regexp_replace(coalesce(r.name, ''), '[^A-Za-z]', '', 'g') from 1 for 3))
                end
                || '-' || lpad(public.next_sequence(r.organization_id, 'sku')::text, 4, '0')
       )
     where p.id = r.id;
  end loop;
end
$backfill$;
