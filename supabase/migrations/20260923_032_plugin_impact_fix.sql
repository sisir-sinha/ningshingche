-- 027 — Fix plugin_impact: the wildcard query referenced a table it never
-- joined (`p.key` inside the lateral), so the §4 preview raised 42P01 the
-- moment the Plugins screen asked for it. Found by probing the live database
-- immediately after 026 rather than by reading it — the same class of mistake
-- 026 exists to prevent, one layer up.
--
-- The question the function answers is unchanged: for each role in this shop,
-- which of this plugin's permissions would it gain *without anyone granting
-- anything*, because it already holds `*` or `<plugin>.*`?

create or replace function public.plugin_impact(
  p_organization_id uuid,
  p_plugin_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org uuid := p_organization_id;
begin
  perform app.require_org(v_org);
  perform app.require_permission('plugins.view');

  return coalesce((
    select jsonb_agg(entry order by entry ->> 'role_name')
      from (
        select jsonb_build_object(
                 'role_id', r.id,
                 'role_key', r.key,
                 'role_name', r.name,
                 'wildcard', w.card,
                 'permissions', w.keys) as entry
          from public.roles r
          cross join lateral (
            select min(g.key) as card,
                   coalesce(jsonb_agg(pp.key order by pp.key), '[]'::jsonb) as keys
              from public.plugin_package_permissions pp
              join lateral (
                select p2.key
                  from public.role_permissions rp2
                  join public.permissions p2 on p2.id = rp2.permission_id
                 where rp2.role_id = r.id
                   and p2.key in ('*', split_part(pp.key, '.', 1) || '.*')
              ) g on true
             where pp.plugin_key = p_plugin_key
          ) w
         where r.organization_id = v_org
           and jsonb_array_length(w.keys) > 0
      ) entries
  ), '[]'::jsonb);
end
$fn$;

grant execute on function public.plugin_impact(uuid, text) to authenticated;
