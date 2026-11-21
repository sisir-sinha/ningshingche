'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const sql = read('backend/supabase/migrations/044_account_moderation_and_ugc_guards.sql');
const evidence = read('backend/supabase/migrations/045_report_evidence.sql');
const reports = read('backend/assets/js/reports.js');
const nav = read('app/src/main/java/com/ningshingche/app/ui/reader/ReaderNavHost.kt');
const article = read('app/src/main/java/com/ningshingche/app/ui/reader/ArticleScreen.kt');
const forum = read('app/src/main/java/com/ningshingche/app/ui/screens/ForumScreens.kt');
const music = read('app/src/main/java/com/ningshingche/app/ui/screens/NewMusicScreen.kt');
test('account actions and appeals use bounded server-side authorization and no direct write grants', () => {
  assert.match(sql,/dashboard_is_super_admin\(\)/);
  assert.match(sql,/revoke all on public\.moderation_account_events from public, anon, authenticated/);
  assert.match(sql,/revoke all on public\.moderation_appeals from public, anon, authenticated/);
  assert.match(sql,/moderation_appeals_one_active_idx/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/a\.user_id=auth\.uid\(\)/);
  assert.match(sql,/action='lift'/);
});
test('insert guards cover the existing UGC tables and the version-bound acceptance', () => {
  for(const table of ['comments','forum_discussions','forum_replies','music_tracks','submitted_blogs']) {
    assert.match(sql,new RegExp(`before insert on public\\.${table}`));
  }
  assert.match(sql,/has_accepted_current_terms\(\)/);
  assert.match(sql,/new\.user_id := me/);
  assert.match(sql,/tg_table_name='comments' and new\.user_id is null/);
});
test('the consent dialog waits for the account acceptance rather than racing the write', () => {
  assert.match(article,/onAcceptTerms\?\.invoke\(\) == true/);
  assert.match(forum,/onAcceptTerms\?\.invoke\(\) == true/);
  assert.match(forum,/onAcceptTerms\(\)/);
  assert.match(music,/viewModel\.acceptCurrentTerms\(\)/);
  assert.match(nav,/consentKey = currentUser\?\.id\.orEmpty\(\)/);
});
test('verified snapshot excludes AI, is bounded, and is shown as text', () => {
  assert.match(evidence,/new\.content_type='ai_output' then return new/);
  assert.match(evidence,/left\(coalesce\(excerpt,''\),2000\)/);
  assert.match(evidence,/dashboard_has_permission\('forum'\)/);
  assert.match(reports,/evidenceHost\.textContent/);
  assert.match(reports,/window\.confirm/);
});
