'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('share uses source website slug and published date, with created date fallback', () => {
  const screen = read('app/src/main/java/com/ningshingche/app/ui/reader/ArticleScreen.kt');
  const models = read('app/src/main/java/com/ningshingche/app/data/portal/PortalModels.kt');
  assert.match(screen, /websiteArticleUrl\(article\.summary\.websiteSlug, article\.summary\.websiteDate\)/);
  assert.match(screen, /listOfNotNull\(article\.title, url\)/);
  assert.match(models, /websiteSlug = slug\.orEmpty\(\)/);
  assert.match(models, /websiteDate = publishedDate \?: createdAt\.orEmpty\(\)/);
  assert.match(read('app/src/main/java/com/ningshingche/app/notifications/LaunchRoute.kt'), /articleIdFromWebsiteUrl\(data\.toString\(\)\)/);
});

test('top and bottom actions use the article list, remain outside the keyboard, and preserve comments navigation', () => {
  const screen = read('app/src/main/java/com/ningshingche/app/ui/reader/ArticleScreen.kt');
  assert.match(screen, /Modifier\.align\(Alignment\.BottomEnd\)/);
  assert.match(screen, /article_jump_toggle/);
  assert.doesNotMatch(screen, /article_jump_(top|bottom)/);
  assert.match(screen, /val jumpUp = listState.canScrollBackward/);
  assert.match(screen, /listState\.scrollToItem\(0\)/);
  assert.match(screen, /listState\.layoutInfo\.totalItemsCount - 1/);
  assert.match(screen, /listState\.canScrollForward && listState\.scrollBy/);
  assert.match(screen, /state is ArticleUiState\.Ready && !keyboardVisible/);
  assert.match(screen, /scrollToComments = scrollToComments/);
});
