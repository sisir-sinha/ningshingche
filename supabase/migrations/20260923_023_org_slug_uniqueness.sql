-- 023 — Organization slugs must survive a name collision.
--
-- `organizations.slug` is unique, and `provision_organization` inserted the
-- caller's slug verbatim. Two shopkeepers calling their shop "Rahim Store" —
-- which in Bangladesh is not an edge case, it is Tuesday — meant the second
-- signup died on `organizations_slug_key` with a raw Postgres error and no
-- shop. The slug is a machine handle; the name is what the shopkeeper typed.
-- The handle has to give way.
--
-- Fixed with a BEFORE INSERT trigger rather than inside the RPC, so every
-- caller gets it: the web signup path, the onboarding form, the service role,
-- a future Android client, a manual insert. Same reasoning as §51 — a
-- universal rule lives in the platform, not in one screen's copy of it.
--
-- Normalising and de-conflicting happen in ONE function on purpose. Postgres
-- fires same-timing triggers in name order, so two triggers would have to be
-- named to sort correctly; one function cannot be ordered wrong.

create or replace function public.derive_organization_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_base text;
  v_slug text;
  v_n    int := 1;
begin
  -- Lowercase, non-alphanumerics collapsed to '-', trimmed. Bengali shop
  -- names reduce to nothing, which is why the name is only a fallback and
  -- 'shop' is the last resort — a slug nobody typed still beats a failed
  -- signup.
  v_base := btrim(regexp_replace(lower(coalesce(new.slug, '')), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base = '' then
    v_base := btrim(regexp_replace(lower(coalesce(new.name, '')), '[^a-z0-9]+', '-', 'g'), '-');
  end if;
  if v_base = '' then
    v_base := 'shop';
  end if;

  -- Serialise same-slug inserts. Without this the existence check below is a
  -- race: two concurrent signups for "Rahim Store" would both see the slug
  -- free and one would still fail the unique constraint. The lock is held
  -- until this transaction ends — exactly as long as it takes for the row to
  -- become visible to the other transaction.
  perform pg_advisory_xact_lock(hashtext('mekholi.organization_slug.' || v_base));

  v_slug := v_base;
  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  -- `security definer` matters here: the existence check must see *every*
  -- organization, and under RLS a plain authenticated caller would only see
  -- their own — which would let the trigger pick a slug another shop already
  -- holds, and the signup would fail anyway.
  new.slug := v_slug;
  return new;
end
$fn$;

drop trigger if exists organizations_derive_slug on public.organizations;
create trigger organizations_derive_slug
  before insert on public.organizations
  for each row execute function public.derive_organization_slug();
