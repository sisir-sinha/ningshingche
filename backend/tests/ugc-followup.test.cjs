'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const sql = read('backend/supabase/migrations/042_ugc_consent_reporting_audit.sql');
const dialog = read('app/src/main/java/com/ningshingche/app/ui/components/TermsConsentDialog.kt');
const client = read('app/src/main/java/com/ningshingche/app/data/remote/SupabaseClient.kt');
const host = read('app/src/main/java/com/ningshingche/app/ui/reader/ReaderNavHost.kt');
const queue = read('backend/assets/js/reports.js');
test('acceptance is bound to the version actually displayed', () => {
  const version = /const val TERMS_VERSION = "([^"]+)"/.exec(dialog)[1];
  assert.match(sql, new RegExp(`select '${version}'::text`));
  assert.match(sql, /p_terms_version is distinct from public\.current_terms_version\(\)/);
  assert.match(sql, /revoke execute on function public\.accept_current_terms\(\) from public, anon, authenticated/);
  assert.match(client, /put\("p_terms_version", TERMS_VERSION\)/);
  assert.match(client, /record\.termsVersion != TERMS_VERSION/);
});
test('article and user reports have distinct, authenticated routes', () => {
  assert.equal((host.match(/reportContent\("article", id, reason, note\)/g) || []).length, 2);
  assert.match(host, /reportContent\("profile", id, reason, note\)/);
  assert.match(sql, /kind in \('article','profile'\)[\s\S]*if me is null/);
  assert.match(sql, /where s\.converted_blog_id = target_id/);
  assert.match(sql, /owner_id := target_id/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /interval '1 day'/);
});
test('moderation records are server-attributed and private', () => {
  assert.match(sql, /content_report_audit enable row level security/);
  assert.match(sql, /moderator uuid := public\.dashboard_current_user_id\(\)/);
  assert.match(sql, /new\.handled_by := moderator::text/);
  assert.match(sql, /Report details are immutable/);
  assert.match(queue, /content_type === 'article'.*canAccess\('blogs'\)/);
});
test('terms route is a standalone page without a made-up response SLA', () => {
  const page = read('backend/terms-of-use/index.html');
  assert.match(page, /<!DOCTYPE html>/i);
  assert.match(page, /21 November 2026/);
  assert.doesNotMatch(page, /48 hours|৪৮ ঘণ্টা/);
});
