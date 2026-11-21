'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const migration = read('backend', 'supabase', 'migrations', '041_terms_acceptance_and_secure_article_submission.sql');
const dialog = read('app', 'src', 'main', 'java', 'com', 'ningshingche', 'app', 'ui', 'components', 'TermsConsentDialog.kt');
const screen = read('app', 'src', 'main', 'java', 'com', 'ningshingche', 'app', 'ui', 'screens', 'NewArticleScreen.kt');
const client = read('app', 'src', 'main', 'java', 'com', 'ningshingche', 'app', 'data', 'remote', 'SupabaseClient.kt');
const workspace = read('app', 'src', 'main', 'java', 'com', 'ningshingche', 'app', 'ui', 'viewmodel', 'ReaderWorkspaceViewModel.kt');

test('Terms acceptance is explicit and cannot be inferred from opening a link', () => {
  assert.match(dialog, /Checkbox\(/);
  assert.match(dialog, /enabled = checked && !accepting/);
  assert.match(dialog, /terms_consent_checkbox/);
  assert.match(dialog, /terms_open_link/);
  assert.match(screen, /onDismiss = \{ showTerms = false \}/);
  assert.match(screen, /if \(viewModel\.acceptCurrentTerms\(\)\)/);
  assert.match(screen, /viewModel\.submitArticle\(title, content, thumbnail, context\)/);
});

test('account acceptance is immutable, versioned and server timed', () => {
  assert.match(migration, /create table if not exists public\.user_terms_acceptances/);
  assert.match(migration, /user_id\s+uuid not null references auth\.users\(id\)/);
  assert.match(migration, /accepted_at\s+timestamptz not null default timezone\('utc', now\(\)\)/);
  assert.match(migration, /unique \(user_id, terms_version\)/);
  assert.match(migration, /using \(user_id = auth\.uid\(\)\)/);
  assert.match(migration, /revoke insert, update, delete/);
  assert.match(migration, /on conflict \(user_id, terms_version\) do nothing/);
  assert.match(migration, /me uuid := auth\.uid\(\)/);
});

test('direct article REST inserts cannot bypass the Terms gate', () => {
  assert.match(migration, /create or replace function public\.submit_reader_article/);
  assert.match(migration, /if not public\.has_accepted_current_terms\(\)/);
  assert.match(migration, /'Pending'/);
  assert.match(migration, /drop policy if exists submissions_public_insert/);
  assert.match(migration, /drop policy if exists submitted_blogs_insert_own/);
  assert.doesNotMatch(client, /restBaseUrl}\/submitted_blogs"[\s\S]{0,350}\.post\(/);
  assert.match(client, /restBaseUrl}\/rpc\/submit_reader_article/);
});

test('identity and moderation state are assigned by PostgreSQL', () => {
  const fn = migration.slice(migration.indexOf('create or replace function public.submit_reader_article'));
  assert.match(fn, /me uuid := auth\.uid\(\)/);
  assert.match(fn, /status, converted_blog_id, user_id/);
  assert.match(fn, /'Pending',\s*null,\s*me/);
  assert.doesNotMatch(fn.slice(0, fn.indexOf('returns setof')), /p_user_id|p_status|p_terms_version/);
});

test('outdated, missing and failed acceptance remain fail closed', () => {
  assert.match(migration, /a\.terms_version = public\.current_terms_version\(\)/);
  assert.match(workspace, /TermsAcceptanceState\.ERROR/);
  assert.match(workspace, /TermsAcceptanceState\.REQUIRED/);
  assert.match(workspace, /is TermsAcceptanceRequiredException/);
  assert.match(client, /ReaderSessionRequiredException/);
  assert.match(screen, /termsState == TermsAcceptanceState\.ACCEPTED/);
});

test('submission retry is idempotent and never auto-publishes', () => {
  assert.match(migration, /on conflict \(id\) do nothing/);
  assert.match(migration, /where s\.id = p_id\s+and s\.user_id = me/);
  assert.doesNotMatch(migration, /status[^\n]*Published/);
  assert.match(workspace, /status = "Pending"/);
});
