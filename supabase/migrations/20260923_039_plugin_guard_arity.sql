-- 039 — two ways to call the same guard is one way too many.
--
-- 038 gave `app.plugin_assert_plugin_schema` a second argument (the tables the
-- package just created) with a default, so the old one-argument form is no
-- longer a separate function — but 031's one-argument version is still there,
-- and Postgres refuses to choose between `(text)` and `(text, text[] default)`
-- when a caller passes one argument. Every `plugin_enable` call would fail with
-- "function … is not unique", which is exactly what replaying the migrations
-- in the validator caught.
--
-- Dropping the old signature leaves the two-argument version, whose default
-- keeps the old call shape working.

drop function if exists app.plugin_assert_plugin_schema(text);
