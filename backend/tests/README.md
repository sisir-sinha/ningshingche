# Dashboard backup tests

The dashboard itself remains a static, no-build app. These optional development tests require Node.js 20+.

## Unit and API transport tests (no install required)

From the repository root:

```sh
node --test backend/tests/backup.test.cjs
```

Covers the real `api.js` and `backup.js` with an in-memory fetch implementation: all nine tables, Unicode and relationships, selections, server-capped pagination beyond 1,000 rows, empty tables, strict exact counts, unexpected IDs, changing counts, missing migrations, denied/revoked permissions, session changes, network failures, cancellation, and ordinary request timeouts.

## Schema probe and banner tests

```sh
node --test backend/tests/schema-probe.test.cjs
```

Runs the real `api.js` against a fixture that models PostgREST: each probe request's `select` is
checked against the columns the table really has, so asking a table for a column it lacks fails with
`42703` exactly as the server does. Covers the healthy path — including `app_language_files`, keyed
on `lang` and with no `id` column — plus a missing Blog media column, a missing language column,
missing tables, a legacy login, the optional tag view, and a plain HTTP 500. It asserts that the
banner names the right table and the right migration file, and stays silent when there is nothing an
editor can fix by running SQL.

## Dashboard page tests (jsdom)

```sh
cd backend
npm install --no-save jsdom      # then rm -rf node_modules when finished
node --test tests/*.test.cjs
```

`nav`, `languages-page`, `contributors-page`, `forum-page`, `forum-cms`, and `menu-permissions` load
a real page script into a jsdom
document with a fixture `NC` namespace and assert what it renders and what it sends. `forum-page`
covers the Forum moderation page (the three granted forum tables, readers' names joined from
`profiles`, the counters, `?filter=Waiting` / `?filter=Unpublish` deep links, opening one thread
with its answers, and the exact `PATCH` each hide/restore sends) plus the forum's place on the index
dashboard. It also plants a `<script>` and an `onerror` in a fixture body to prove the page shows a
reader's post as text. `forum-page` and `forum-cms` share one harness — `tests/helpers/forum-harness.cjs` — so the
moderation suite and the writing suite cannot drift into testing two different pages. The editor and
uploader stubs keep their values in the elements they were mounted on, which is how a test types a
body or a cover URL and then asserts the exact payload the page sends.

`menu-permissions` is about the one thing a dashboard menu needs twice: a route in `config.js` and
a key in the database's `dashboard_valid_permissions()` allow-list. It walks the real route list
against the newest allow-list in the migrations, holds migration `031` (the guards either side of
its install, and the policies that name the Forum key), and renders Users & Roles against an older
allow-list to prove the page says *run 031* rather than reporting a save that dropped the key.

A suite that needs jsdom **skips itself** when the module is absent, so
`node --test tests/*.test.cjs` is safe to run with or without it.

## Isolated Chromium tests

```sh
cd backend/tests
npm ci
npx playwright install --with-deps chromium
npm run test:browser
```

The script starts a temporary local server and closes it after testing. **Every non-local request is intercepted**: Supabase calls use fixtures, CDN resources use deterministic fallbacks, and any other traffic is blocked. No real password, session, database write, or media upload is needed. Test settings-save requests are also intercepted, not sent to Supabase.

Checks actual Settings navigation, generated/downloaded JSON for 1,205 blog records, Unicode, all/selected exports, local metadata-only history, error/retry paths, cancellation, role restrictions, legacy login, existing Settings saves, route cleanup, and 320/375/768/1024/1440 px layouts in both themes. CDN fallbacks intentionally verify that the backup works without third-party JS libraries. The JSON backup feature has no new CDN dependency.

Optional diagnostic screenshots can be written outside the source tree:

```sh
BACKUP_SCREENSHOTS=/your/local/qa-folder npm run test:browser
```

All records and sessions in these tests are synthetic. Never replace the fixture session with a production token.

## Filter, tag, and registered-user smoke test

```sh
cd backend/tests
npm ci
npx playwright install --with-deps chromium
node filters.browser.cjs          # NC_OFFLINE=1 stubs the CDN libraries
```

Fixture-only (every `*.supabase.co` request is intercepted; PATCH/POST to `submitted_blogs` are recorded in memory). It drives the real pages and asserts: the `.form-select` chevron is rendered; Blogs issue/author/tag filters, chips, deep links (`?issue=২০২৪`, `?tag=…`, `?filter=Draft`), and the editor's issue picker; Comments blog-author and commenter filters; six Chart.js instances on the Registered users dashboard; the Articles user filter, full-page editor save (PATCH payload), *Add article* (POST payload with the chosen profile), and the approval modal; Messages user/unread filters; `NC.api.blogsByIssue/ blogsByTag` over both the migration-013 RPC path and the `tags=ov` fallback; and no horizontal overflow at 375 px. Screenshots are written to `tests/screenshots/` (git-ignored).

## UGC migration fixture (disposable PostgreSQL only)

`sql/ugc-fixture-setup.sql` supplies simplified `auth` and dashboard identities;
`sql/ugc-fixture-checks.sql` exercises migrations 040–042 against them.
**Never run either file against production or a shared Supabase project.** Use a
fresh isolated local PostgreSQL cluster (the setup creates global test roles):

```sh
createdb nc_ugc_fixture
psql -X -v ON_ERROR_STOP=1 -d nc_ugc_fixture -f backend/tests/sql/ugc-fixture-setup.sql
for n in 040_content_safety 041_terms_acceptance_and_secure_article_submission 042_ugc_consent_reporting_audit; do
  psql -X -v ON_ERROR_STOP=1 -d nc_ugc_fixture -f "backend/supabase/migrations/$n.sql"
done
psql -X -v ON_ERROR_STOP=1 -d nc_ugc_fixture -f backend/tests/sql/ugc-fixture-checks.sql
```

The fixture checks SQL execution, version gating, ownership, report attribution,
deduplication, RLS visibility, block RPCs, and server-attributed report status
changes. It does not replace staging tests against real Supabase authentication.

### 043 continuation fixture

After the 040–042 checks above in the same disposable database, apply
`sql/ugc-043-setup.sql`, then `../supabase/migrations/043_report_validation_and_decisions.sql`
(the path is relative to `backend/tests`), then `sql/ugc-043-checks.sql`. The
checks create synthetic rows and perform writes. The 043 migration was also
reapplied locally after checks; do not reapply 042 after 043 without restoring
043 because 042 re-grants UPDATE. For real staging use the separately reviewed
[staging runbook](UGC_STAGING_RUNBOOK.md), not these fixture setup files.

## Phase 2 isolated fixture (044–046)

Run `bash backend/tests/sql/run-ugc-phase2.sh` from the repository root. It
creates and deletes its own local PostgreSQL cluster in a private temporary
socket directory, disables TCP, applies the previous disposable fixture and
040–046 in order, tests 043/044/045/046, and reapplies 044–046. It requires
PostgreSQL binaries and a non-root account. It never connects to Supabase. The
fixture has mocked `auth.uid()` and dashboard sessions, simplified tables, and
cannot prove real Supabase RLS, triggers, deployed schema, clients or concurrency.
Never use the fixture SQL against a production or staging project.
