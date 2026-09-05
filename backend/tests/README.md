# Dashboard backup tests

The dashboard itself remains a static, no-build app. These optional development tests require Node.js 20+.

## Unit and API transport tests (no install required)

From the repository root:

```sh
node --test backend/tests/backup.test.cjs
```

Covers the real `api.js` and `backup.js` with an in-memory fetch implementation: all nine tables, Unicode and relationships, selections, server-capped pagination beyond 1,000 rows, empty tables, strict exact counts, unexpected IDs, changing counts, missing migrations, denied/revoked permissions, session changes, network failures, cancellation, and ordinary request timeouts.

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
