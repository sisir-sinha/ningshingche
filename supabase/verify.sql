-- Mekholi — "what state is this project in?" — READ-ONLY.
--
-- Paste this whole file into the Supabase SQL editor and run it. It writes
-- nothing to your schema: it counts what already exists and prints one row per
-- check. Use it before and after `npm run db:push`, or when a screen says
-- something is missing and you want to know whether the database or the app is
-- to blame.
--
-- Why it is written the long way round: on a project where the migrations were
-- never applied, `select count(*) from public.permissions` fails at *parse*
-- time — the SQL editor would show an error instead of an answer, and the
-- answer is exactly what you came for. So every table-dependent count is run
-- through dynamic SQL behind a `to_regclass` guard, and the structure checks
-- read `pg_catalog`, which always exists.

drop table if exists verify_results;

create temporary table verify_results (
  check_name text,
  status     text,
  detail     text
);

do $verify$
declare
  v_tables  integer;
  v_no_rls  integer;
  v_policies integer;
  v_count   integer;
  v_orgs    text;
begin
  -- ── Structure (pg_catalog: safe on an empty project) ───────────────────
  select count(*) into v_tables
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r';

  select count(*) into v_no_rls
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and not c.relrowsecurity;

  select count(*) into v_policies
    from pg_policies where schemaname = 'public';

  insert into verify_results
  select 'public tables',
         case when v_tables >= 40 then 'ok' else 'INCOMPLETE' end,
         v_tables || ' table(s) — a migrated project has 48';

  insert into verify_results
  select 'tables without row-level security',
         case when v_tables = 0 then 'INCOMPLETE'
              when v_no_rls = 0 then 'ok'
              else 'FAIL' end,
         case when v_tables = 0 then 'nothing to check — no tables exist yet'
              else v_no_rls || ' of ' || v_tables || ' (must be 0) — ' || v_policies || ' policies'
         end;

  -- ── Migrations ledger ──────────────────────────────────────────────────
  if to_regclass('supabase_migrations.schema_migrations') is null then
    insert into verify_results
    values ('migration ledger', 'MISSING',
            'supabase_migrations.schema_migrations does not exist — migrations were never applied');
  else
    execute 'select count(*) from supabase_migrations.schema_migrations' into v_count;
    insert into verify_results
    select 'migrations applied',
           case when v_count >= 51 then 'ok' else 'INCOMPLETE' end,
           v_count || ' of 51 recorded';
  end if;

  -- ── The two seeds ──────────────────────────────────────────────────────
  if to_regclass('public.permissions') is null then
    insert into verify_results
    values ('permission catalogue', 'MISSING',
            'public.permissions does not exist — run the migrations, not the seeds');
  else
    execute 'select count(*) from public.permissions' into v_count;
    insert into verify_results
    select 'permission catalogue',
           case when v_count >= 60 then 'ok' else 'INCOMPLETE' end,
           v_count || ' key(s) — the 001 seed inserts 67';
  end if;

  if to_regprocedure('public.provision_organization(uuid,text,text,text,char,text,text,text[],text[])') is null then
    insert into verify_results
    values ('provision_organization()', 'MISSING',
            'migration 017 has not been applied — a new signup cannot create a shop');
  else
    insert into verify_results
    values ('provision_organization()', 'ok', 'present (migration 017)');
  end if;

  -- ── What the shop actually has ─────────────────────────────────────────
  if to_regclass('public.organizations') is null then
    insert into verify_results
    values ('organizations', 'MISSING', 'no organizations — nothing has been provisioned');
  else
    execute $sql$
      select string_agg(name || ' (' || coalesce(shop_type, 'no type') || ')', ' | ' order by created_at)
        from public.organizations
    $sql$ into v_orgs;
    execute 'select count(*) from public.organizations' into v_count;
    insert into verify_results
    select 'organizations',
           case when v_count > 0 then 'info' else 'empty' end,
           v_count || ': ' || coalesce(v_orgs, '—');
  end if;

  if to_regclass('public.plugin_packages') is null then
    insert into verify_results
    values ('plugin packages', 'MISSING', 'migration 031 has not been applied');
  else
    execute 'select count(*) from public.plugin_packages' into v_count;
    insert into verify_results
    select 'plugin packages',
           case when v_count >= 7 then 'ok' else 'INCOMPLETE' end,
           v_count || ' package(s) — the bundle ships 7';
  end if;

  -- A package the server ships with no SQL file on disk is the drift the
  -- validator cannot see (docs/13 §P7-2): the row exists, the source is gone.
  if to_regclass('public.plugin_package_migrations') is not null then
    execute 'select count(*) from public.plugin_package_migrations' into v_count;
    insert into verify_results
    select 'plugin package files', 'info', v_count || ' SQL file(s) seeded';
  end if;
end
$verify$;

-- ── The answer ────────────────────────────────────────────────────────────

select check_name, status, detail from verify_results;

drop table if exists verify_results;
