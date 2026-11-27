'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const app = 'app/src/main/java/com/ningshingche/app/';
const screen = read(app + 'ui/reader/ArticleScreen.kt');
const nav = read(app + 'ui/reader/ReaderNavHost.kt');
const vm = read(app + 'ui/reader/ReaderViewModels.kt');
const config = read(app + 'data/portal/PortalConfig.kt');
const repo = read(app + 'data/portal/PortalRepository.kt');
const migration = read('backend/supabase/migrations/050_authenticated_article_comments.sql');
const schema = read('backend/supabase/schema.sql');

test('both article routes provide an actionable sign-in prompt; comments remain readable', () => {
  assert.equal((nav.match(/onSignInClick = \{ navController\.navigate\(ReaderRoute\.Login\) \}/g) || []).length >= 2, true);
  assert.match(screen, /if \(isSignedIn\) \{\s*ArticleCommentForm\(/);
  assert.match(screen, /CommentSignInPrompt\(onSignInClick\)/);
  assert.match(screen, /items\(comments, key = \{ it\.id \}\)/);
  assert.match(vm, /if \(account == null \|\| account\.id\.isBlank\(\)\)/);
  assert.match(vm, /userId = account\.id/);
});

test('client rejects missing and mismatched reader sessions before a POST', () => {
  assert.match(repo, /if \(userId\.isBlank\(\)\).*PortalError\.SignedOut/);
  assert.match(config, /canSendComment\(original\.header\(COMMENT_USER_HEADER\)/);
  assert.match(config, /throw CommentSessionRequired\(\)/);
  assert.match(config, /\.removeHeader\(COMMENT_USER_HEADER\)/);
});

test('migration closes permissive guest insert paths and retains authorized dashboard staff', () => {
  assert.match(migration, /as restrictive for insert to anon, authenticated/i);
  assert.match(migration, /auth\.uid\(\) is not null/i);
  assert.match(migration, /user_id = auth\.uid\(\)/i);
  assert.match(migration, /is_anonymous/);
  assert.match(migration, /status = 'Unpublish'/);
  assert.match(migration, /dashboard_has_permission\('comments'\)/);
  assert.doesNotMatch(migration, /delete from public\.comments|update public\.comments/i);
  assert.match(schema, /create policy comments_public_insert on public\.comments for insert to authenticated/i);
});
