'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../app/src/main/java/com/ningshingche/app/ui/editorial/EditorialComponents.kt'), 'utf8');
test('featured card allows title and byline to determine height', () => {
  const card = source.slice(source.indexOf('fun RailArticleCard('), source.indexOf('fun ArticleRow('));
  assert.ok(card.includes('modifier = modifier.width(268.dp)'));
  assert.doesNotMatch(card, /\.height\(260\.dp\)|maxLines\s*=\s*3/);
  assert.match(card, /maxLines\s*=\s*Int\.MAX_VALUE/);
});
