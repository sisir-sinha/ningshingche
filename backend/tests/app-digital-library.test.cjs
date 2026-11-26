'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../../app/src/main/java/com/ningshingche/app/ui');
const screen = fs.readFileSync(path.join(root, 'screens/PdfArchiveScreen.kt'), 'utf8');
const grouping = fs.readFileSync(path.join(root, 'screens/LibrarySections.kt'), 'utf8');
const vm = fs.readFileSync(path.join(root, 'viewmodel/MainViewModels.kt'), 'utf8');

test('library searches the full catalog and groups by dashboard category', () => {
  assert.match(vm, /val pdfDocuments = repository\.pdfDocuments/);
  assert.match(screen, /librarySections\(books, query\)/);
  assert.match(screen, /testTag\("library_search"\)/);
  assert.match(grouping, /book\.title, book\.authorOrEditor, book\.edition, book\.category/);
  assert.match(grouping, /normalizedLibraryText\(it\.category\)/);
  assert.match(grouping, /matching\.filterNot\(::isNingshingCheBook\)/);
});
test('official issues are first with a badge and fifth book opens see more', () => {
  assert.match(grouping, /LIBRARY_PREVIEW_COUNT = 4/);
  assert.match(grouping, /if \(official\.isNotEmpty\(\)\) add\(LibrarySection/);
  assert.match(screen, /ic_verified_badge/);
  assert.match(screen, /section\.books\.size > LIBRARY_PREVIEW_COUNT/);
  assert.match(screen, /if \(expanded\) section\.books else section\.books\.take\(LIBRARY_PREVIEW_COUNT\)/);
  assert.doesNotMatch(screen, /HorizontalDivider|VerticalDivider|Hairline|LibraryShelf/);
  assert.match(screen, /onOpen\(book\.id\)/);
  assert.match(screen, /PdfHelper\.savePdfToDownloads/);
});
