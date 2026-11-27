'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, 'app/src/main/java/com/ningshingche/app', p), 'utf8');

test('dashboard uses every server metric and treats absent fields as failures', () => {
  const parser = read('data/remote/ViewStatsJson.kt');
  for (const name of ['article_views', 'music_views', 'forum_views', 'visitors', 'registered_views', 'guest_views', 'minutes_listened'])
    assert.match(parser, new RegExp(`getLong\\("${name}"\\)`));
  const api = read('data/remote/SupabaseClient.kt');
  assert.match(api, /parseViewTotals\(json\)/);
  assert.match(api, /parseViewDay\(array.getJSONObject\(i\)\)/);
  assert.match(api, /if \(!response.isSuccessful\) return@withContext Result.failure\(Exception\("View history failed/);
});
test('dashboard gets paged lists and does not confuse request failures with zero', () => {
  const api = read('data/remote/SupabaseClient.kt');
  assert.match(api, /limit=\$pageSize&offset=\$offset/);
  assert.match(api, /if \(page.length\(\) < pageSize\) return all/);
  assert.equal((api.match(/val rows = dashboardRows\(/g) || []).length, 3);
  const model = read('ui/viewmodel/ReaderWorkspaceViewModel.kt');
  for (const flag of ['articlesAvailable', 'commentsAvailable', 'songsAvailable', 'viewsAvailable'])
    assert.match(model, new RegExp(`${flag} =`));
  assert.match(model, /currentUser.value\?\.id != user.id/);
  assert.match(model, /seriesResult.isFailure/);
  const screen = read('ui/screens/UserDashboardScreen.kt');
  assert.match(screen, /if \(metrics.viewsAvailable\) toBengaliNumeral\(metrics.minutesListened\) else "—"/);
  assert.match(screen, /আপনার গানে শ্রোতাদের মোট শোনার সময়/);
});
test('splash only contains requested text and progress', () => {
  const splash = read('ui/screens/SplashScreen.kt');
  assert.match(splash, /নিংশিং চে/);
  assert.match(splash, /বিষ্ণুপ্রিয়া মণিপুরি ডিজিটাল কমিউনিটি/);
  assert.match(splash, /splash_progress/);
  assert.doesNotMatch(splash, /NingshingCheBrandLogo|Canvas\(|AutoAwesome|সংস্করণের|tagline/i);
});

test('creation actions are confined to Home and Content and close on tab change', () => {
  const dashboard = read('ui/screens/UserDashboardScreen.kt');
  assert.match(dashboard, /if \(pagerState.currentPage == TAB_HOME \|\| onContentTab\)/);
  assert.match(dashboard, /LaunchedEffect\(pagerState.currentPage\) \{ fabOpen = false \}/);
});
