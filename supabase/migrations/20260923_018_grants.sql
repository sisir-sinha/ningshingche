-- 018 — Function privileges.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default. Every
-- function above is therefore callable by any signed-in client unless that
-- is taken away. Several are internal building blocks with no permission
-- check of their own — apply_stock_movement in particular would let a client
-- write the stock ledger directly.
--
-- So: revoke everything, then grant back only the intended API surface.

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from authenticated;
revoke execute on all functions in schema app from public;
revoke execute on all functions in schema app from anon;
revoke execute on all functions in schema app from authenticated;

-- ── The client-facing API ─────────────────────────────────────────────────
-- Each of these performs its own app.require_permission() check, so granting
-- EXECUTE is not the authorization — it only makes the call reachable.

grant execute on function public.complete_sale(
  uuid, jsonb, jsonb, uuid, uuid, uuid, text, numeric, text
) to authenticated;

grant execute on function public.hold_sale(uuid, jsonb, uuid, text) to authenticated;
grant execute on function public.resume_sale(uuid) to authenticated;

grant execute on function public.refund_sale(uuid, jsonb, jsonb, text, boolean)
  to authenticated;

grant execute on function public.adjust_stock(uuid, uuid, numeric, text, smallint, text)
  to authenticated;

grant execute on function public.receive_purchase(uuid, jsonb, jsonb) to authenticated;

grant execute on function public.open_register(uuid, numeric, text) to authenticated;
grant execute on function public.close_register(uuid, numeric, text) to authenticated;
grant execute on function public.register_cash_movement(uuid, numeric, smallint, text)
  to authenticated;
grant execute on function public.record_expense(
  uuid, numeric, uuid, uuid, text, uuid, date
) to authenticated;

grant execute on function public.dashboard_summary(uuid, date) to authenticated;

-- Signup path: any authenticated user may provision their own organization.
-- The function itself enforces that the owner must be the caller.
grant execute on function public.provision_organization(
  uuid, text, text, text, char, text, text, text[], text[]
) to authenticated;

-- Read-only helpers used to build the UI.
grant execute on function app.current_org_ids() to authenticated;
grant execute on function app.current_branch_id() to authenticated;
grant execute on function app.has_permission(text) to authenticated;
grant execute on function app.visible_branch_ids(uuid) to authenticated;
grant execute on function app.in_org(uuid) to authenticated;

-- ── Deliberately NOT granted ──────────────────────────────────────────────
--   apply_stock_movement   internal ledger primitive; only callable from
--                          SECURITY DEFINER functions owned by postgres
--   next_sequence          internal counter
--   app.require_permission / app.require_org / app.in_visible_branch
--                          internal guards
--   app.tables_missing_rls CI-only introspection
--   set_updated_at, refresh_product_search_text, prevent_movement_mutation
--                          trigger functions
--
-- These stay reachable only to the function owner, which is what makes the
-- RPC layer the single write path.
