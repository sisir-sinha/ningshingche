'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '../../app/src/main/java/com/ningshingche/app');
const read = p => fs.readFileSync(path.join(dir, p), 'utf8');
const editorial = read('ui/editorial/EditorialComponents.kt');
const theme = read('ui/editorial/EditorialTheme.kt');
const home = read('ui/reader/HomeScreen.kt');
const format = read('util/LocalizedFormatting.kt');
const translations = read('data/i18n/TranslationRepository.kt');

test('calendar dates and timestamps use the current language and separate cache keys', () => {
  assert.match(editorial, /LocalizedFormatting\.date\(iso,.*Translations\.current\.language\)/);
  assert.match(editorial, /LocalizedFormatting\.dateTime\(iso,.*Translations\.current\.language\)/);
  assert.match(format, /date\|\$language\|\$\{TimeZone\.getDefault\(\)\.id\}/);
  assert.match(format, /datetime\|\$language\|\$\{TimeZone\.getDefault\(\)\.id\}/);
  assert.match(format, /ContentLanguage\.ENGLISH/);
});
test('home sections and visible numbers use the selected language', () => {
  assert.match(editorial, /title = t\("ক্যাটাগরি"\)/);
  assert.doesNotMatch(editorial + home, /actionLabel = (?:if \([^\n]+\) )?"সব"/);
  assert.match(editorial, /text = toBengaliNumeral\(index\)/);
  assert.match(theme, /LocalizedFormatting\.digits\(number\.toString\(\),.*Translations\.current\.language\)/);
  for (const file of ['ui/reader/ListScreens.kt', 'ui/screens/ExploreScreen.kt', 'ui/screens/PortalPages.kt']) {
    assert.doesNotMatch(read(file), /IssueTags\.toBengaliDigits\(|issue\.bengaliYear/);
  }
  assert.match(read('ui/reader/MusicScreen.kt'), /MusicTabChip\(tNow\("সব"\)/);
  assert.match(read('ui/screens/BookmarksScreen.kt'), /label = t\("সব"\)/);
  assert.match(read('ui/screens/PortalPages.kt'), /tab.key == "all"\) t\("সব"\)/);
  assert.match(read('ui/screens/UserDashboardScreen.kt'), /Text\(t\("সব"\)/);
  assert.match(read('ui/screens/UserDashboardScreen.kt'), /formatBengaliDateTime\(item.createdAt\)/);
});
test('published translations win but older files cannot hide new packaged keys', () => {
  assert.match(translations, /val base = packaged\(language\) \+ readCache\(language\)/);
  assert.match(translations, /flow\.value = packaged\(language\) \+ published\.table/);
});
