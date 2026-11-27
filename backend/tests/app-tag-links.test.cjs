'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = path.join(__dirname, '../../app/src/main/java/com/ningshingche/app');
const read = file => fs.readFileSync(path.join(app, file), 'utf8');

test('article tags open a tag destination, not a category', () => {
  const nav = read('ui/reader/ReaderNavHost.kt');
  assert.match(nav, /const val Tag = "tag\/\{tag\}"/);
  assert.match(nav, /fun tagResults\(value: String\) = "tag\/\$\{encode\(value\)\}"/);
  assert.match(nav, /fun forTag\(tag: String\): String \{\s*IssueTags\.parseYear\(tag\)\?\.let \{ return issue\(it\) \}\s*return tagResults\(tag\)/);
  assert.equal((nav.match(/navigate\(ReaderRoute\.forTag\(tag\)\)/g) || []).length, 2);
  assert.match(nav, /route = ReaderRoute\.Tag[\s\S]*?TagViewModelFactory\(app\.portalRepository, tag\)[\s\S]*?TagScreen\(/);
});

test('tag results are paged published articles, with an older-schema fallback', () => {
  const repo = read('data/portal/PortalRepository.kt');
  const tag = repo.slice(repo.indexOf('suspend fun articlesByTag('), repo.indexOf('suspend fun articlesByIssue('));
  assert.match(tag, /IssueTags\.keyOf\(tag\)/);
  assert.match(tag, /tagKeys = "cs\." \+ encodeArrayLiteral\(listOf\(key\)\)/);
  assert.match(tag, /status = "eq\.Publish"/);
  assert.match(tag, /PortalError\.SchemaMissing/);
  assert.match(tag, /api\.blogFacets\(select = "id,tags", limit = scanSize, offset = scanOffset, order = "id\.asc"\)/);
  assert.match(tag, /IssueTags\.keyOf\(raw\) == key/);
  assert.match(tag, /scanOffset \+= rows\.size/);
  assert.match(tag, /tags = "ov\." \+ encodeArrayLiteral\(rawTags\)/);
  const vm = read('ui/reader/ReaderViewModels.kt');
  assert.match(vm, /repository\.articlesByTag\(tag, limit = limit, offset = offset\)/);
  const screen = read('ui/reader/ListScreens.kt');
  assert.match(screen, /fun TagScreen\([\s\S]*?ArticleList\([\s\S]*?onRetry = viewModel::load/);
});
