-- 011 — Platform: plugin registry, transactional outbox, audit log, sequences.

create table public.plugins (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plugin_key      text not null,          -- 'pharmacy','loyalty','repair'
  version         text not null,
  enabled         boolean not null default false,
  config          jsonb not null default '{}'::jsonb,
  status          text not null default 'ok'
                    check (status in ('ok', 'error', 'incompatible')),
  last_error      text,
  enabled_at      timestamptz,
  enabled_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, plugin_key)
);

create trigger plugins_updated_at
  before update on public.plugins
  for each row execute function public.set_updated_at();

-- Plugin SQL is applied once per organization, verified by checksum so a
-- tampered or stale bundle cannot silently re-run (docs/05 §8).
create table public.plugin_migrations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plugin_key      text not null,
  version         text not null,
  filename        text not null,
  checksum        text not null,
  applied_at      timestamptz not null default now(),
  primary key (organization_id, plugin_key, filename)
);

-- Transactional outbox (docs/02 §3). Written inside the same transaction as
-- the business change, so the event exists if and only if the change does.
create table public.outbox (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type      text not null,
  aggregate_type  text not null,
  aggregate_id    uuid,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz
);

create index outbox_unprocessed_idx
  on public.outbox(created_at)
  where processed_at is null;
create index outbox_org_type_idx
  on public.outbox(organization_id, event_type, created_at desc);

-- Audit log (spec §31). bigint identity rather than uuid because this table
-- grows fast and is almost always scanned in insertion order.
create table public.audit_logs (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id        uuid references auth.users(id),
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  ip              inet,
  user_agent      text,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

create index audit_org_time_idx
  on public.audit_logs(organization_id, created_at desc);
create index audit_entity_idx
  on public.audit_logs(entity_type, entity_id);

-- Per-organization monotonic counters for invoice/return numbers.
-- UPDATE ... RETURNING takes a row lock, so concurrent cashiers get distinct
-- gap-free numbers (docs/04 §8).
create table public.sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope           text not null,          -- 'invoice:2026','return:2026'
  last_value      bigint not null default 0,
  primary key (organization_id, scope)
);

create or replace function public.next_sequence(p_org uuid, p_scope text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
begin
  -- Ensure the counter row exists. The ON CONFLICT is a no-op once it does,
  -- so this costs one index probe per call and never races.
  insert into public.sequences (organization_id, scope, last_value)
  values (p_org, p_scope, 0)
  on conflict (organization_id, scope) do nothing;

  -- UPDATE ... RETURNING takes the row lock, so concurrent callers are
  -- serialized here and receive distinct, gap-free numbers.
  update public.sequences
     set last_value = last_value + 1
   where organization_id = p_org
     and scope = p_scope
  returning last_value into v_next;

  return v_next;
end;
$$;
