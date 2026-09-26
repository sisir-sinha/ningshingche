-- 052 — Staff access, invitations and business settings support.
--
-- Roles and the organization profile already exist in the core schema. This
-- migration adds the one server-side boundary the browser cannot provide:
-- auth.users is intentionally not readable to an authenticated client, so
-- staff listing and invitation acceptance happen here under SECURITY DEFINER.
-- The invitation is deliberately an application record, not a service-role
-- operation: the browser sends a Supabase magic-link sign-in to the invited
-- address, and the first authenticated session claims the matching invite.

create table public.organization_invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  role_id         uuid not null references public.roles(id) on delete cascade,
  branch_id       uuid references public.branches(id) on delete cascade,
  invited_by      uuid not null references auth.users(id),
  invited_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '7 days'),
  accepted_at     timestamptz,
  accepted_user_id uuid references auth.users(id),
  check (email = lower(email)),
  check (accepted_at is null or accepted_user_id is not null)
);

create index organization_invitations_lookup_idx
  on public.organization_invitations (lower(email), organization_id)
  where accepted_at is null;

create unique index one_pending_invitation_per_email
  on public.organization_invitations (organization_id, email)
  where accepted_at is null;

alter table public.organization_invitations enable row level security;
alter table public.organization_invitations force row level security;

create policy organization_invitations_select on public.organization_invitations
  for select using (app.in_org(organization_id) and app.has_permission('users.view'));

create or replace function public.list_staff(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_rows jsonb;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('users.view');

  select coalesce(jsonb_agg(row_data order by (row_data->>'email')), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
        'kind', 'member',
        'user_id', u.id,
        'email', u.email,
        'name', coalesce(
          nullif(u.raw_user_meta_data->>'full_name', ''),
          nullif(u.raw_user_meta_data->>'name', ''),
          split_part(coalesce(u.email, ''), '@', 1)
        ),
        'is_active', uo.is_active,
        'roles', coalesce((
          select jsonb_agg(jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name) order by r.name)
            from public.user_roles ur
            join public.roles r on r.id = ur.role_id
           where ur.user_id = u.id
             and ur.organization_id = p_organization_id
        ), '[]'::jsonb),
        'branches', coalesce((
          select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name)
            from public.user_roles ur
            join public.branches b on b.id = ur.branch_id
           where ur.user_id = u.id
             and ur.organization_id = p_organization_id
        ), '[]'::jsonb),
        'invitation_id', null,
        'invited_at', null,
        'expires_at', null
      ) as row_data
      from public.user_organizations uo
      join auth.users u on u.id = uo.user_id
      where uo.organization_id = p_organization_id

      union all

      select jsonb_build_object(
        'kind', 'pending',
        'user_id', null,
        'email', i.email,
        'name', split_part(i.email, '@', 1),
        'is_active', false,
        'roles', jsonb_build_array(jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name)),
        'branches', case when b.id is null then '[]'::jsonb
                         else jsonb_build_array(jsonb_build_object('id', b.id, 'name', b.name)) end,
        'invitation_id', i.id,
        'invited_at', i.invited_at,
        'expires_at', i.expires_at
      ) as row_data
      from public.organization_invitations i
      join public.roles r on r.id = i.role_id
      left join public.branches b on b.id = i.branch_id
      where i.organization_id = p_organization_id
        and i.accepted_at is null
        and i.expires_at > now()
    ) rows;

  return v_rows;
end;
$fn$;

comment on function public.list_staff(uuid) is
  'Lists organization members and pending email invitations without exposing auth.users to the browser.';

create or replace function public.invite_staff(
  p_organization_id uuid,
  p_email          text,
  p_role_id        uuid,
  p_branch_id      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_email text := lower(trim(p_email));
  v_invitation public.organization_invitations;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('users.create');

  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.roles
     where id = p_role_id and organization_id = p_organization_id
  ) then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;

  if p_branch_id is not null and not exists (
    select 1 from public.branches
     where id = p_branch_id and organization_id = p_organization_id and deleted_at is null
  ) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from public.user_organizations uo
      join auth.users u on u.id = uo.user_id
     where uo.organization_id = p_organization_id
       and uo.is_active
       and lower(u.email) = v_email
  ) then
    raise exception 'staff_already_member' using errcode = 'P0001';
  end if;

  select * into v_invitation
    from public.organization_invitations
   where organization_id = p_organization_id
     and email = v_email
     and accepted_at is null
   limit 1;

  if v_invitation.id is null then
    insert into public.organization_invitations
      (organization_id, email, role_id, branch_id, invited_by)
    values
      (p_organization_id, v_email, p_role_id, p_branch_id, auth.uid())
    returning * into v_invitation;
  else
    update public.organization_invitations
       set role_id = p_role_id,
           branch_id = p_branch_id,
           invited_by = auth.uid(),
           invited_at = now(),
           expires_at = now() + interval '7 days'
     where id = v_invitation.id
     returning * into v_invitation;
  end if;

  return jsonb_build_object(
    'id', v_invitation.id,
    'email', v_invitation.email,
    'role_id', v_invitation.role_id,
    'branch_id', v_invitation.branch_id,
    'expires_at', v_invitation.expires_at
  );
end;
$fn$;

comment on function public.invite_staff(uuid, text, uuid, uuid) is
  'Creates or refreshes a pending staff invitation. The client then sends a Supabase magic link.';

create or replace function public.accept_staff_invitations(p_user_id uuid default auth.uid())
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_email text;
  v_count integer := 0;
  v_invitation record;
begin
  if auth.uid() is null or p_user_id <> auth.uid() then
    raise exception 'cannot accept invitations for another user' using errcode = '42501';
  end if;

  select lower(email) into v_email from auth.users where id = p_user_id;
  if v_email is null then return 0; end if;

  for v_invitation in
    select i.*
      from public.organization_invitations i
     where i.email = v_email
       and i.accepted_at is null
       and i.expires_at > now()
  loop
    insert into public.user_organizations (user_id, organization_id)
    values (p_user_id, v_invitation.organization_id)
    on conflict (user_id, organization_id)
    do update set is_active = true;

    insert into public.user_roles
      (user_id, organization_id, branch_id, role_id, granted_by)
    values
      (p_user_id, v_invitation.organization_id, v_invitation.branch_id,
       v_invitation.role_id, v_invitation.invited_by)
    on conflict (user_id, organization_id, branch_id, role_id) do nothing;

    update public.organization_invitations
       set accepted_at = now(), accepted_user_id = p_user_id
     where id = v_invitation.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$fn$;

comment on function public.accept_staff_invitations(uuid) is
  'Claims all unexpired invitations matching the signed-in email address.';

create or replace function public.remove_staff(
  p_organization_id uuid,
  p_user_id         uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('users.delete');

  if p_user_id = auth.uid() then
    raise exception 'cannot_remove_self' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
     where ur.user_id = p_user_id
       and ur.organization_id = p_organization_id
       and r.key = 'owner'
  ) then
    raise exception 'cannot_remove_owner' using errcode = '42501';
  end if;

  update public.user_organizations
     set is_active = false
   where user_id = p_user_id and organization_id = p_organization_id;
  delete from public.user_roles
   where user_id = p_user_id and organization_id = p_organization_id;

  return jsonb_build_object('user_id', p_user_id, 'removed', true);
end;
$fn$;

comment on function public.remove_staff(uuid, uuid) is
  'Revokes organization access without deleting the auth account.';

-- New RPCs are reachable only through the authenticated API and still enforce
-- their own permission or identity checks.
revoke all on function public.list_staff(uuid) from public, anon, authenticated;
revoke all on function public.invite_staff(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.accept_staff_invitations(uuid) from public, anon, authenticated;
revoke all on function public.remove_staff(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_staff(uuid) to authenticated;
grant execute on function public.invite_staff(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.accept_staff_invitations(uuid) to authenticated;
grant execute on function public.remove_staff(uuid, uuid) to authenticated;

-- Sanity check the new server surface exists with the intended permissions.
do $$
begin
  if not has_function_privilege('authenticated', 'public.list_staff(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.invite_staff(uuid,text,uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.accept_staff_invitations(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.remove_staff(uuid,uuid)', 'EXECUTE') then
    raise exception 'staff RPC grants are incomplete';
  end if;
end;
$$;

create or replace function public.set_staff_roles(
  p_organization_id uuid,
  p_user_id         uuid,
  p_role_ids        uuid[],
  p_branch_id       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_valid integer;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('users.edit');

  if exists (
    select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
     where ur.user_id = p_user_id
       and ur.organization_id = p_organization_id
       and r.key = 'owner'
  ) then
    raise exception 'cannot_change_owner_roles' using errcode = '42501';
  end if;

  if p_branch_id is not null and not exists (
    select 1 from public.branches
     where id = p_branch_id and organization_id = p_organization_id and deleted_at is null
  ) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;

  select count(*) into v_valid
    from public.roles
   where organization_id = p_organization_id
     and id = any(coalesce(p_role_ids, '{}'));
  if v_valid <> cardinality(coalesce(p_role_ids, '{}')) then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;

  delete from public.user_roles
   where user_id = p_user_id and organization_id = p_organization_id;

  insert into public.user_roles
    (user_id, organization_id, branch_id, role_id, granted_by)
  select p_user_id, p_organization_id, p_branch_id, role_id, auth.uid()
    from unnest(coalesce(p_role_ids, '{}')) as requested(role_id);

  return jsonb_build_object('user_id', p_user_id, 'role_count', cardinality(coalesce(p_role_ids, '{}')));
end;
$fn$;

comment on function public.set_staff_roles(uuid, uuid, uuid[], uuid) is
  'Replaces a staff member''s role assignment using users.edit without exposing a bulk write to the browser.';

revoke all on function public.set_staff_roles(uuid, uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.set_staff_roles(uuid, uuid, uuid[], uuid) to authenticated;

create or replace function public.set_role_permissions(
  p_organization_id uuid,
  p_role_id         uuid,
  p_permission_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_valid integer;
begin
  perform app.require_org(p_organization_id);
  perform app.require_permission('roles.edit');

  if not exists (
    select 1 from public.roles
     where id = p_role_id and organization_id = p_organization_id
  ) then
    raise exception 'role_not_found' using errcode = 'P0002';
  end if;

  select count(*) into v_valid
    from public.permissions
   where key = any(coalesce(p_permission_keys, '{}'));
  if v_valid <> cardinality(coalesce(p_permission_keys, '{}')) then
    raise exception 'permission_not_found' using errcode = 'P0002';
  end if;

  delete from public.role_permissions
   where organization_id = p_organization_id and role_id = p_role_id;

  insert into public.role_permissions (organization_id, role_id, permission_id)
  select p_organization_id, p_role_id, p.id
    from public.permissions p
   where p.key = any(coalesce(p_permission_keys, '{}'));

  return jsonb_build_object('role_id', p_role_id, 'permission_count', cardinality(coalesce(p_permission_keys, '{}')));
end;
$fn$;

comment on function public.set_role_permissions(uuid, uuid, text[]) is
  'Replaces a role permission set under roles.edit, including system-role grants without exposing junction-table deletes.';

revoke all on function public.set_role_permissions(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.set_role_permissions(uuid, uuid, text[]) to authenticated;
