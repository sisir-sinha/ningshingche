'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..', 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const cache = read('data/cache/PublicResponseCache.kt');
const worker = read('data/cache/PublicCacheWarmWorker.kt');
const provider = read('data/portal/PortalProvider.kt');
const config = read('data/portal/PortalConfig.kt');
const repo = read('data/portal/PortalRepository.kt');
const vm = read('ui/reader/ReaderViewModels.kt');
const app = read('NinghsingCheApp.kt');
const music = read('playback/MusicController.kt');

test('public cache is installed before the reader repository', () => {
  assert.ok(app.indexOf('PortalProvider.installPublicCache(this)') < app.indexOf('portalRepository = PortalProvider.repository()'));
  assert.match(config, /publicCache\?\.install\(builder\)/);
  assert.match(config, /if \(publicCache\?\.eligible\(chain\.request\(\)\) == true\) null/);
});

test('private and user-specific requests are excluded from disk caching', () => {
  assert.match(cache, /request\.method != "GET"/);
  assert.match(cache, /CacheControl\.Builder\(\)\.noStore\(\)/);
  assert.match(cache, /header\("Authorization", "Bearer \$publicKey"\)/);
  assert.match(cache, /table == "blogs" \|\| table == "comments"/);
  assert.match(cache, /listOf\("eq\.Publish"\)/);
  assert.doesNotMatch(provider, /"profiles" to|"rpc\//);
  assert.match(cache, /!cc\.noStore.*!cc\.noCache.*!cc\.mustRevalidate.*!cc\.isPrivate/);
});

test('cache-first reads revalidate independently and the reader can update', () => {
  assert.match(cache, /CacheControl\.FORCE_CACHE/);
  assert.match(cache, /CacheControl\.FORCE_NETWORK/);
  assert.match(cache, /pending\.add\(key\)/);
  assert.match(cache, /lastCheck/);
  assert.match(vm, /PortalProvider\.cacheChanges\(\)/);
  assert.match(vm, /repository\.invalidatePublicMemoryCache\(\)/);
  assert.match(repo, /status = "eq\.Publish"/);
  assert.match(vm, /repository\.recordArticleView\(article\.id\)/);
});

test('background warming respects Wi-Fi, battery and media opt-in', () => {
  assert.match(worker, /NetworkType\.UNMETERED/);
  assert.match(worker, /TRANSPORT_WIFI/);
  assert.match(worker, /NET_CAPABILITY_NOT_METERED/);
  assert.match(worker, /setRequiresBatteryNotLow\(true\)/);
  assert.match(worker, /take\(12\)/);
  assert.match(worker, /take\(30\)/);
  assert.doesNotMatch(worker, /downloadPdf|MusicStreamCache|audioUrl|fileUrl/);
  assert.doesNotMatch(music, /MusicStreamCache\.prefetch/);
});
