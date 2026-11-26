'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../../app/src/main/java/com/ningshingche/app/ui');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const bar = read('reader/ReaderBottomNavigation.kt');
const host = read('reader/ReaderNavHost.kt');

test('bottom navigation has four ordered destinations and defaults to home', () => {
  const tags = [...bar.matchAll(/testTag\("bottom_(menu|home|music|forum)"\)/g)].map(m => m[1]);
  assert.deepEqual(tags, ['menu', 'home', 'music', 'forum']);
  assert.match(bar, /ReaderRoute\.Home\s*->\s*ReaderBottomTab\.Home/);
  assert.match(bar, /ReaderRoute\.MusicGenre/);
  assert.match(bar, /ReaderRoute\.ForumThread/);
  assert.match(host, /onMenu\s*=\s*\{\s*coroutineScope\.launch\s*\{\s*drawerState\.open\(\)/);
  for (const route of ['Home', 'Music', 'Forum']) {
    assert.ok(host.includes(`requestTopLevel(ReaderRoute.${route})`));
  }
});

test('top menu is removed and mini player respects the bottom bar', () => {
  for (const file of ['reader/HomeScreen.kt', 'screens/ExploreScreen.kt', 'screens/AiAssistantScreen.kt']) {
    const source = read(file);
    assert.doesNotMatch(source, /onMenuClick|hamburger_menu_button|ai_menu_button/);
  }
  assert.match(host, /currentRoute != ReaderRoute\.Splash/);
  assert.match(host, /currentRoute != ReaderRoute\.FirstRun/);
  assert.match(host, /!keyboardVisible/);
  assert.match(host, /aboveBottomNavigation\s*=\s*showBottomNavigation/);
  assert.match(host, /pendingNavigation/);
  assert.match(read('components/MusicPlayer.kt'), /if \(aboveBottomNavigation\) Modifier else Modifier\.navigationBarsPadding\(\)/);
});
