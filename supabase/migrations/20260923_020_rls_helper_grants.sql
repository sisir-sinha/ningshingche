-- ═══════════════════════════════════════════════════════════════════════
-- Mekholi — 020: RLS helper grants for the anon role
--
-- WHY THIS EXISTS
--
-- Migration 018 revoked EXECUTE on every function from `anon` and
-- `authenticated`, then granted back only the intended API surface. That was
-- right for the RPCs and right for the internal helpers — but it also
-- removed `anon`'s ability to call the three `app.*` helpers that RLS policy
-- expressions invoke:
--
--     app.in_org(uuid)              127 policy references
--     app.has_permission(text)       65 policy references
--     app.visible_branch_ids(uuid)    4 policy references
--
-- A policy expression runs as the *querying* role, not the table owner, so
-- `anon` needs EXECUTE to evaluate it. Without it, every anonymous read of a
-- protected table failed with:
--
--     42501 permission denied for function in_org
--
-- instead of simply returning no rows.
--
-- WHY THIS IS SAFE
--
-- All three are keyed on `auth.uid()`, which is NULL for an anonymous
-- caller:
--
--     app.current_org_ids()      → '{}'      (where user_id = NULL matches nothing)
--     app.in_org(x)              → false     (x = any('{}'))
--     app.has_permission(k)      → false     (where user_id = NULL)
--     app.visible_branch_ids(o)  → '{}'
--
-- They are SECURITY DEFINER with a pinned search_path, so the caller gains no
-- access to the underlying tables — only the boolean/array answer, which for
-- an anonymous caller is always empty. RLS then filters to zero rows, which
-- is the correct answer.
--
-- The internal helpers (`apply_stock_movement`, `next_sequence`,
-- `app.require_*`) stay revoked from both roles. Those are not referenced by
-- any policy and must remain unreachable.
--
-- Found by applying the schema to a live Supabase project: PGlite runs as a
-- superuser, so GRANT/REVOKE are not enforced during local validation and
-- this class of bug is invisible there. tools/validate-migrations.mjs now
-- checks it statically instead.
-- ═══════════════════════════════════════════════════════════════════════

grant execute on function app.in_org(uuid)              to anon;
grant execute on function app.has_permission(text)      to anon;
grant execute on function app.visible_branch_ids(uuid)  to anon;

comment on function app.in_org(uuid) is
  'Safe for anon: returns false when auth.uid() is null. RLS policies call it, so both roles need EXECUTE.';
