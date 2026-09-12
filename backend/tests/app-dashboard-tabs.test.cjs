/**
 * The owner's seventh read, three corrections:
 *
 *   1. "Audio tabs are not working." — `MusicScreen` selected its pane from
 *      `pagerState.currentPage` and its chips called `animateScrollToPage`, but
 *      no pager was ever composed, so there was no page to scroll to and no page
 *      to read: the chips looked dead because they were.
 *   2. "Points, forum, view, কার্যক্রম and article analytics should be views in
 *      tabs" — the dashboard home stacked all five down one column. They are
 *      tabs now, one section at a time, and the forum section is paged: five
 *      items, then "load more", because `forum_activity` takes a limit and the
 *      database has more than the app is showing.
 *   3. "After a successful article or song submission it should forward to the
 *      content tab" — a send used to end in a snackbar and a pop to the parent.
 *      It ends on the dashboard's content tab now, with the new row in front of
 *      the reader, and a note carries that intent from the composer to the
 *      dashboard.
 *
 * Static checks over the Kotlin sources, in the shape of the other app tests.
 * Everything here is a literal substring of the source — no regular expressions
 * — so the checks read the way the Kotlin does.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app');
const read = (...parts) => fs.readFileSync(path.join(APP, ...parts), 'utf8');

const MUSIC = read('ui', 'reader', 'MusicScreen.kt');
const DASHBOARD = read('ui', 'screens', 'UserDashboardScreen.kt');
const CHARTS = read('ui', 'screens', 'UserDashboardCharts.kt');
const FORUM = read('ui', 'screens', 'ForumScreens.kt');
const HOST = read('ui', 'reader', 'ReaderNavHost.kt');
const ARTICLES = read('ui', 'screens', 'NewArticleScreen.kt');
const SONGS = read('ui', 'screens', 'NewMusicScreen.kt');
const WORKSPACE = read('ui', 'viewmodel', 'ReaderWorkspaceViewModel.kt');
const MODELS = read('data', 'portal', 'PortalModels.kt');

/** Where a declaration's body begins, so its parameters can be read too. */
function bodyStart(source, at, name) {
  const open = source.indexOf('{', source.indexOf('(', at));
  assert.ok(open !== -1, `${name} has a body`);
  return open;
}

/** A declaration's body, from its opening brace to the one that closes it. */
function bodyAt(source, at, name) {
  const open = bodyStart(source, at, name);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`${name} is not closed`);
}

function bodyOf(source, name) {
  const at = source.indexOf(`fun ${name}(`);
  assert.ok(at !== -1, `${name}() is declared`);
  return bodyAt(source, at, name);
}

/** A declaration's parameters: everything between `fun name(` and its body. */
function signatureOf(source, name) {
  const at = source.indexOf(`fun ${name}(`);
  assert.ok(at !== -1, `${name}() is declared`);
  return source.slice(at, bodyStart(source, at, name));
}

/** Everything from a marker to the end of the thing it opens. */
const between = (source, from, to) => {
  const at = source.indexOf(from);
  assert.ok(at !== -1, `"${from}" is present`);
  const end = source.indexOf(to, at);
  assert.ok(end !== -1, `"${to}" follows it`);
  return source.slice(at, end);
};

const has = (source, text, what) => assert.ok(source.includes(text), what || `${text} is there`);

// ---------------------------------------------------------------------------
// 1. The audio tabs: a real pager, so tapping and swiping both move
// ---------------------------------------------------------------------------

test('the audio tabs have pages to move between', async (t) => {
  await t.test('a pager is composed, and it owns the page count', () => {
    has(MUSIC, 'val pagerState = rememberPagerState(pageCount = { MusicTab.entries.size })',
      'one page per tab');
    has(MUSIC, 'val tab = MusicTab.entries[pagerState.currentPage]',
      'and the screen reads the tab off the pager, as it always did');
    has(MUSIC, 'HorizontalPager(\n                state = pagerState,',
      'the pager the chips have been scrolling all along');
    assert.ok(!MUSIC.includes('loading && tracks.isEmpty() && tab == MusicTab.All'),
      'the pane is no longer a `when` over a page number with nothing to back it');
  });

  await t.test('every tab has a page, and the pages are the panes', () => {
    const pager = between(MUSIC, 'HorizontalPager(', '\n    if (creating) {');
    for (const tab of ['All', 'Genres', 'Artists', 'Albums', 'Playlists', 'Loved', 'Offline']) {
      has(pager, `MusicTab.${tab} ->`, `${tab} is a page`);
    }
    has(pager, 'tracks = filtered', 'with the search result on the first page');
    has(pager, 'tracks = offline', "the device's MP3s on the last");
  });

  await t.test('the chips still scroll the pager, which is what makes them work now', () => {
    const goTo = bodyOf(MUSIC, 'goToTab');
    has(goTo, 'pagerState.animateScrollToPage(target.ordinal)', 'a chip animates to its page');
    for (const chip of ['MusicTab.All', 'MusicTab.Offline']) {
      has(MUSIC, `goToTab(${chip})`, `${chip} has a chip`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The dashboard home: five sections, one view at a time
// ---------------------------------------------------------------------------

test('the dashboard home shows its sections as tabs', async (t) => {
  await t.test('the five the owner named are the five there are', () => {
    const enumAt = DASHBOARD.indexOf('private enum class HomeSection(');
    assert.ok(enumAt !== -1, 'the section enum is declared');
    const enumBody = DASHBOARD.slice(enumAt, DASHBOARD.indexOf('\n}', enumAt));
    const labels = ['পয়েন্ট', 'ফোরাম', 'ভিউ', 'কার্যক্রম', 'বিশ্লেষণ'];
    for (const label of labels) has(enumBody, `"${label}"`, `${label} is a section`);
    // Five entries, one label each: `Points("পয়েন্ট"),` and no sixth.
    assert.equal((enumBody.match(/\("/g) || []).length, labels.length, 'and nothing else is');
    assert.equal((enumBody.match(/\n    [A-Z][a-z]+\("/g) || []).length, labels.length,
      'each one an entry of the enum');
  });

  await t.test('the row of chips is built from the enum, not from a hand-written list', () => {
    const tabs = bodyOf(DASHBOARD, 'HomeSectionTabs');
    has(tabs, 'items(HomeSection.entries.toList(), key = { it.name })',
      'one chip per section, keyed so a selection survives recomposition');
    has(tabs, 'entry == selected', 'the selected one is marked');
    has(tabs, 'testTag("dashboard_section_${entry.name.lowercase()}")',
      'and each chip can be found by name');
    has(tabs, 'FilterChip(', 'a chip, as the content tab already uses');
  });

  await t.test('the sections trade places instead of stacking down the page', () => {
    const home = bodyOf(DASHBOARD, 'HomePane');
    has(home, 'var section by rememberSaveable { mutableStateOf(HomeSection.Points) }',
      'the chosen section lives outside the composition');
    has(home, 'HomeSectionTabs(selected = section, onSelect = { section = it })',
      'and the chips are the only thing that sets it');
    const switched = between(home, 'when (section) {', 'Spacer(Modifier.height(24.dp))');
    for (const branch of [
      'HomeSection.Points',
      'HomeSection.Forum',
      'HomeSection.Views',
      'HomeSection.Activity',
      'HomeSection.Analytics'
    ]) {
      has(switched, branch, `${branch} has a branch`);
    }
    // The cards, each in its own branch and nowhere else in the pane.
    const above = home.slice(0, home.indexOf('when (section) {'));
    for (const card of [
      'ContributorPointsCard(',
      'ForumCard(',
      'ViewsOverTimeChart(',
      'ActivityChart(',
      'ArticleStatusChart(',
      'ArticleAnalyticsList('
    ]) {
      has(switched, card, `${card} moved into a section`);
      assert.ok(!above.includes(card), `${card} is not also above the tabs`);
    }
  });

  await t.test('the two graphs that used to share a card are two cards now', () => {
    has(bodyOf(CHARTS, 'ActivityChart'), 'title = "কার্যক্রম"', 'কার্যক্রম is its own composable');
    has(bodyOf(CHARTS, 'ArticleStatusChart'), 'title = "প্রবন্ধের অবস্থা"',
      'and so is the state of the articles');
    assert.ok(!CHARTS.includes('ContributionCharts'),
      'the stacked pair is gone rather than left behind');
    has(bodyOf(DASHBOARD, 'ViewSplit'), 'metrics.articleViews',
      'ভিউ reads the split the database counts');
  });
});

// ---------------------------------------------------------------------------
// 3. The forum section: five, then load more, from the API
// ---------------------------------------------------------------------------

test('the forum section loads five and then more', async (t) => {
  await t.test('a page is five, and the window is the RPC own ceiling', () => {
    has(WORKSPACE, 'private const val FORUM_ACTIVITY_PAGE = 5');
    has(WORKSPACE, 'private const val FORUM_ACTIVITY_MAX = 50');
    has(WORKSPACE, 'private var forumLimit: Int = FORUM_ACTIVITY_PAGE',
      'the window starts at one page');
  });

  await t.test('load more asks the database again, for a bigger page', () => {
    const load = bodyOf(WORKSPACE, 'loadMoreForumActivity');
    has(load, 'if (_forumLoadingMore.value) return', 'one request at a time');
    has(load, '(forumLimit + FORUM_ACTIVITY_PAGE).coerceAtMost(FORUM_ACTIVITY_MAX)',
      'five at a time, up to the ceiling');
    has(load, 'portalRepository.forumActivity(user.id, limit = forumLimit)',
      'the same call with the new window — `forum_activity` takes a limit, not an offset');
    has(load, '_forumActivity.value = forum', 'the list is replaced by the wider read');
    has(load, '_forumHasMore.value = forum.hasMoreThan(forumLimit)',
      'and the button follows the counts');
    has(load, 'if (next <= forumLimit) {\n            _forumHasMore.value = false\n            return',
      'at the ceiling there is nothing left to ask for');
  });

  await t.test('refresh reads the same window, so the button survives a reload', () => {
    has(WORKSPACE, 'forumActivity(user.id, limit = forumLimit)',
      'the initial read is the window, not a fixed 20');
    has(WORKSPACE, 'if (forum != null) _forumHasMore.value = forum.hasMoreThan(forumLimit)');
  });

  await t.test('"more" is the counters being bigger than the lists', () => {
    // A one-line expression body, so it is read where it is written rather than
    // by brace-walking into whatever declaration comes next.
    has(MODELS,
      'fun hasMoreThan(limit: Int): Boolean =\n        discussions > threads.size || replies > answers.size',
      'a limit smaller than the counts is what "more" means');
  });

  await t.test('the card offers the button only when it is asked for', () => {
    has(signatureOf(FORUM, 'ForumCard'), 'onLoadMore: (() -> Unit)? = null', 'the section decides');
    const card = bodyOf(FORUM, 'ForumCard');
    has(card, 'if (onLoadMore != null)');
    has(card, 'if (!loadingMore) onLoadMore()', 'a second tap does not re-ask');
    has(card, 'testTag("dashboard_forum_more")');
    has(card, 'text = "আরও লোড করুন"');
    // And the dashboard is the caller that hands it over.
    has(DASHBOARD, 'onLoadMore = if (forumHasMore || forumLoadingMore) onLoadMoreForum else null');
    has(DASHBOARD, 'onLoadMoreForum = { viewModel.loadMoreForumActivity() }');
  });
});

// ---------------------------------------------------------------------------
// 4. A successful submit lands on the content tab
// ---------------------------------------------------------------------------

test('a successful submission forwards to the content tab', async (t) => {
  await t.test('both composers hand the success to the host', () => {
    for (const [source, word, screen] of [
      [ARTICLES, 'লেখা জমা হয়েছে', 'NewArticleScreen'],
      [SONGS, 'গান জমা হয়েছে', 'NewMusicScreen']
    ]) {
      const fn = bodyOf(source, screen);
      const success = between(fn, `text.startsWith("${word}")`, 'return@LaunchedEffect');
      has(success, 'viewModel.clearMessage()\n            onSubmitted()',
        `${screen}: the message is spent, then the screen says where it goes`);
      has(signatureOf(source, screen), 'onSubmitted: () -> Unit',
        'the screen takes the decision as a parameter');
      assert.ok(!source.includes('navController'), 'and keeps no navigation of its own');
      if (screen === 'NewArticleScreen') {
        has(success, 'draftStore.clear()', 'the draft is still cleared on the way out');
      }
    }
  });

  await t.test('the content tab is a named thing, not a string in two places', () => {
    has(HOST, 'const val DASHBOARD_CONTENT = "content"');
    has(HOST, '"content" -> 3', 'and it is a tab the dashboard recognizes');
  });

  await t.test('the host forwards, whichever screen the composer was opened from', () => {
    const forward = bodyAt(HOST, HOST.indexOf('.forwardToSubmittedContent()'), 'the forward helper');
    // Re-anchored: `backQueue` is private in navigation 2.8, so the stack is
    // read through the public `currentBackStack`.
    has(forward, 'currentBackStack.value.lastOrNull { entry ->', 'the stack is searched');
    has(forward, 'route.startsWith("${ReaderRoute.UserDashboard}?")',
      'for either dashboard route — plain or with a tab');
    has(forward, 'return popBackStack(dashboard.destination.id, inclusive = true)',
      'and the old entry goes, so the tab cannot be restored behind the new one');
    has(forward, 'if (dashboard == null) {', 'and when there is no dashboard underneath');
    has(forward, 'popBackStack()', 'there is only the composer to close');
    has(forward, 'return false');

    const open = bodyAt(HOST, HOST.indexOf('.openSubmittedContent()'), 'the open helper');
    has(open, 'forwardToSubmittedContent()');
    has(open, 'navigate(ReaderRoute.dashboard(tab = ReaderRoute.DASHBOARD_CONTENT))',
      'one trip, to the content tab');
    const callers = HOST.split('onSubmitted = { navController.openSubmittedContent() }').length - 1;
    assert.equal(callers, 2, 'both new-article and new-song routes use it');
  });

  await t.test('the dashboard lands on the tab the note names, once', () => {
    has(DASHBOARD, 'val landing = remember { submission?.takeIf { it.isFresh() } }',
      'the note is read once, on the way in');
    const landing = between(DASHBOARD, 'LaunchedEffect(initialTab, landing) {', 'LaunchedEffect(onContentTab) {');
    has(landing, 'if (note.id.isNotBlank()) contentFocus = note.id',
      'the row that was just written is highlighted');
    has(landing, 'pagerState.scrollToPage(TAB_CONTENT)', 'and the content tab is where it lands');
    has(landing, 'viewModel.clearSubmission()', 'the note is spent');
    has(landing, 'snackbarHostState.showSnackbar(note.confirmation)',
      'with the confirmation the composer used to show');
    has(landing, 'pagerState.scrollToPage(initialTab.coerceIn(0, TAB_COMMENTS))',
      'the ordinary visit still goes where its route said');
    assert.ok(landing.indexOf('viewModel.clearSubmission()') < landing.indexOf('showSnackbar'),
      'cleared before the suspending snackbar, not after it');
  });

  await t.test('the note is stamped, so an old one cannot move the reader', () => {
    has(WORKSPACE,
      'fun isFresh(now: Long = System.currentTimeMillis()): Boolean = now - at in 0..SUBMISSION_FRESH_MS',
      'freshness is a fact about the note, not about the screen');
    has(WORKSPACE, 'const val SUBMISSION_FRESH_MS = 3L * 60L * 1000L');
    has(WORKSPACE, 'const val KIND_ARTICLE = "article"');
    has(WORKSPACE, 'const val KIND_SONG = "song"');
    const article = bodyOf(WORKSPACE, 'submitArticle');
    has(article, '_submission.value = ReaderSubmission(\n                    kind = ReaderSubmission.KIND_ARTICLE,\n                    id = record.id',
      'an article knows its row');
    const song = bodyOf(WORKSPACE, 'submitMusic');
    has(song, 'kind = ReaderSubmission.KIND_SONG',
      "a song knows its tab — the row id is the database's to make");
  });
});
