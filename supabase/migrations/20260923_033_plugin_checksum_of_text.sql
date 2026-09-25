-- 028 — The plugin migration checksum must be the checksum *of the SQL text*.
--
-- 026 compared the checksum recorded in `plugin_migrations` with the checksum
-- column in `plugin_package_migrations`. Both are just data, so editing either
-- one — or editing the SQL while leaving the column alone — defeated the
-- check entirely. Found by tampering with a live row during the lifecycle
-- probe: the enable succeeded, which is precisely the silent drift the
-- checksum exists to catch.
--
-- Now the text is the source of truth: the checksum is computed from `sql` at
-- apply time and recomputed on every later enable. A changed file for an
-- organization that already applied it raises `plugin_migration_changed`, and
-- the enable rolls back.

create or replace function app.plugin_apply_migrations(
  p_org uuid,
  p_plugin_key text
)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_file record;
  v_applied integer := 0;
  v_seen text;
  v_checksum text;
begin
  for v_file in
    select m.filename, m.version, m.sql
      from public.plugin_package_migrations m
     where m.plugin_key = p_plugin_key
     order by m.ordinal, m.filename
  loop
    v_checksum := md5(v_file.sql);

    select pm.checksum into v_seen
      from public.plugin_migrations pm
     where pm.organization_id = p_org
       and pm.plugin_key = p_plugin_key
       and pm.filename = v_file.filename;

    if found then
      if v_seen <> v_checksum then
        raise exception
          'plugin_migration_changed: %.% differs from the file this shop applied',
          p_plugin_key, v_file.filename using errcode = 'P0001';
      end if;
      continue;
    end if;

    execute v_file.sql;

    insert into public.plugin_migrations
          (organization_id, plugin_key, version, filename, checksum)
    values (p_org, p_plugin_key, v_file.version, v_file.filename, v_checksum);

    v_applied := v_applied + 1;
  end loop;

  return v_applied;
end
$fn$;
