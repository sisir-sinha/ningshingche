-- 001 — Extensions and shared helpers.
--
-- pg_trgm powers fuzzy product search: "sam a15" must find "Samsung Galaxy A15"
-- (spec §55).
--
-- pgcrypto is deliberately NOT created. gen_random_uuid() has been a core
-- function since Postgres 13 and Supabase runs PG15, so the extension would
-- add nothing but a dependency.

create extension if not exists pg_trgm;

-- Every mutable table carries updated_at, maintained here rather than by
-- application code, so it cannot be forgotten on one write path.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- app.* holds the authorization helpers. A dedicated schema keeps them out of
-- the public API surface that PostgREST exposes.
create schema if not exists app;
