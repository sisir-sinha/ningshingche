/**
 * The home page's forum strip, and the order of three lists.
 *
 * Four things were asked for here:
 *
 *  * সেরা অবদানকারী in order of points, descending — on the home page and on the
 *    contributor page, which read the same board;
 *  * the forum's **জনপ্রিয়** tab in descending order too;
 *  * অনুমোদিত, wherever there is a thumbnail, on the thumbnail's bottom-right
 *    corner;
 *  * সাম্প্রতিক আলোচনা on the home page, under the header, as an inline list of
 *    the latest five, for registered readers only.
 *
 * The board's order was genuinely wrong, and the reason is in `035`: 026 ranked
 * the rows with `row_number() over ()` and ordered the query separately, and a
 * window function runs before the query's own `order by` — so the rank was the
 * table's physical order and the board came back scrambled. Both halves are
 * asserted here: the SQL that ranks it and the app that draws it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app');
const read = (...parts) => fs.readFileSync(path.join(APP, ...parts), 'utf8');
const readBackend = (...parts) => fs.readFileSync(path.join(ROOT, 'backend', ...parts), 'utf8');

const FORUM_SCREENS = read('ui', 'screens', 'ForumScreens.kt');
const HOME_SCREEN = read('ui', 'reader', 'HomeScreen.kt');
const HOME_VIEWMODEL = read('ui', 'reader', 'ReaderViewModels.kt');
const PORTAL_MODELS = read('data', 'portal', 'PortalModels.kt');
const NAV_HOST = read('ui', 'reader', 'ReaderNavHost.kt');
const CONTRIBUTOR_SCREEN = read('ui', 'screens', 'ContributorScreen.kt');
const ORDER_SQL = readBackend('supabase', 'migrations', '035_contributor_order.sql');
const CONTRIBUTORS_SQL = readBackend('supabase', 'migrations', '026_contributors.sql');

/** A function's body, from its opening brace to the one that closes it. */
function bodyOf(source, name) {
  const at = source.indexOf(`fun ${name}(`);
  assert.ok(at !== -1, `${name}() is declared`);
  const open = source.indexOf('{', source.indexOf('(', at));
  assert.ok(open !== -1, `${name}() has a body`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`${name}() is not closed`);
}

const screen = (name) => bodyOf(FORUM_SCREENS, name);

// ---------------------------------------------------------------------------
// 1. সেরা অবদানকারী: points, descending
// ---------------------------------------------------------------------------

test('the contributor board is a ranking, most points first', async (t) => {
  await t.test('the database ranks with the order it is ranked by', () => {
    // The bug: `row_number() over ()` numbers rows in the executor's order, and
    // the query's `order by` is applied after the window is computed — so the
    // aggregate's `order by rank` restored the table's own order.
    assert.match(ORDER_SQL,
      /row_number\(\) over \(\s*\n\s*order by \(score ->> 'points'\)::integer desc,/,
      'the rank comes from the points, inside the window');
    // The file explains the bug it fixes, so the old form appears in a comment:
    // what matters is that no statement uses it.
    const statements = ORDER_SQL.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    assert.ok(!/row_number\(\) over \(\)/.test(statements),
      'and never from nothing');
    assert.match(ORDER_SQL,
      /order by \(score ->> 'points'\)::integer desc nulls last,\s*\n\s*\(score ->> 'articles'\)::integer desc nulls last,\s*\n\s*\(score ->> 'songs'\)::integer desc nulls last,\s*\n\s*p\.created_at asc/,
      'with the tie-breakers spelled out, newest reader last');
    assert.match(ORDER_SQL, /coalesce\(jsonb_agg\(entry order by rank\), '\[\]'::jsonb\)/,
      'and the rows leave in rank order');
    assert.match(ORDER_SQL,
      /to_regprocedure\('public\.contributor_board\(integer, date, boolean\)'\) is not null/,
      'silent on a database that has not run 026 and 027');
    assert.match(ORDER_SQL, /^begin;/m);
    assert.match(ORDER_SQL, /^commit;/m, 'one transaction');
  });

  await t.test('and the old file keeps its evidence', () => {
    // 026 is history now — the migration after it is what the database runs —
    // but the assertion records what was wrong, so nobody reintroduces it.
    assert.match(CONTRIBUTORS_SQL, /row_number\(\) over \(\) as rank/,
      '026 numbered the rows without an order');
  });

  await t.test('the app sorts the board it is handed, both pages', () => {
    assert.match(PORTAL_MODELS,
      /\.sortedWith\(\s*\n\s*compareByDescending<Contributor> \{ it\.points \}\s*\n\s*\.thenByDescending \{ it\.stats\.articles \}\s*\n\s*\.thenByDescending \{ it\.stats\.songs \}/,
      'the mapping is where the order is decided');
    // Both pages draw the same list from the same board, so one sort serves both.
    const home = HOME_SCREEN.slice(HOME_SCREEN.indexOf('contributors = contributors'));
    assert.match(home, /ContributorList\(\s*\n\s*contributors = contributors/,
      'the home page draws the board through ContributorList');
    assert.match(CONTRIBUTOR_SCREEN, /itemsIndexed\(rows, key = \{ _, row -> row\.userId \}\)/,
      'and the contributor page draws the rows it was handed, in the order it was handed them');
    assert.ok(!/sortedBy|sortedWith|reversed\(\)/.test(CONTRIBUTOR_SCREEN),
      'restoring an order there would be the screen second-guessing the role it should draw');
  });

  await t.test('the rank drawn is the position in that list', () => {
    assert.match(CONTRIBUTOR_SCREEN, /rank = index \+ 1/,
      'first on the page is first on the board');
    assert.match(CONTRIBUTOR_SCREEN, /RANK_MEDALS|medal = when \(rank\)/,
      'with the medal following the same number');
  });
});

// ---------------------------------------------------------------------------
// 2. জনপ্রিয়: descending
// ---------------------------------------------------------------------------

test('the forum\'s জনপ্রিয় tab is most answered first', async (t) => {
  await t.test('the app orders the popular list itself', () => {
    assert.match(PORTAL_MODELS,
      /latest = if \(wanted == ForumOverview\.ORDER_POPULAR\) \{\s*\n\s*rows\.sortedWith\(\s*\n\s*compareByDescending<ForumDiscussion> \{ it\.replies \}\s*\n\s*\.thenByDescending \{ it\.views \}/,
      'most answers first, then most reads');
    assert.match(PORTAL_MODELS, /val wanted = order\.orEmpty\(\)\.ifBlank \{ ForumOverview\.ORDER_RECENT \}/,
      'and the order the app reports is the one it sorted by');
    assert.match(PORTAL_MODELS, /order = wanted,/);
  });

  await t.test('and the database orders the same way', () => {
    const sql = readBackend('supabase', 'migrations', '030_forum_answers.sql');
    assert.match(sql,
      /case when wanted = 'popular' then v\.replies_count end desc nulls last,\s*\n\s*case when wanted = 'popular' then v\.views_count end desc nulls last,/,
      'replies, then views, descending');
  });

  await t.test('the tab still asks the database for it by name', () => {
    assert.match(NAV_HOST, /loadOverview = \{ order -> app\.portalRepository\.forumOverview\(order = order\) \}/);
    assert.match(FORUM_SCREENS, /ForumOverview\.ORDER_POPULAR/);
    assert.match(FORUM_SCREENS, /forum_order_popular/);
  });
});

// ---------------------------------------------------------------------------
// 3. অনুমোদিত, over the thumbnail's bottom-right corner
// ---------------------------------------------------------------------------

test('অনুমোদিত sits on the picture, in its corner', async (t) => {
  await t.test('there is one badge, and one place it is pinned', () => {
    const declaration = FORUM_SCREENS.slice(
      FORUM_SCREENS.indexOf('private fun OfficialBadge('),
      FORUM_SCREENS.indexOf('private fun ThumbnailOfficialBadge(')
    );
    assert.match(declaration, /onImage: Boolean = false/,
      'the flat form and the on-image form');
    const badge = screen('OfficialBadge');
    assert.match(badge, /background\(if \(onImage\) tokens\.accent else tokens\.accentSoft\)/,
      'solid on a picture, pale on a page');
    assert.match(badge, /val ink = if \(onImage\) Color\.White else tokens\.accent/,
      'white on the solid fill, so it reads over any photograph');
    const pinned = screen('ThumbnailOfficialBadge');
    assert.match(pinned, /OfficialBadge\(onImage = true\)/);
    assert.match(pinned, /\.shadow\(2\.dp, RoundedCornerShape\(EditorialShape\.chip\)\)/,
      'with a soft shadow under it');
  });

  await t.test('the card puts it on the cover, at BottomEnd', () => {
    const card = screen('ForumDiscussionCard');
    const cover = card.slice(card.indexOf('if (discussion.hasCover)'),
      card.indexOf('Spacer(Modifier.width(EditorialSpace.xs))'));
    assert.match(cover, /Box\(/);
    assert.match(cover, /ThumbnailOfficialBadge\(\s*\n\s*modifier = Modifier\s*\n\s*\.align\(Alignment\.BottomEnd\)/,
      'aligned to the corner of the picture');
    assert.match(cover, /forum_card_official_\$\{discussion\.id\}/, 'and reachable in a UI test');
    assert.match(card, /if \(discussion\.isOfficial && !discussion\.hasCover\)/,
      'the category row only carries it when there is no picture to carry it');
  });

  await t.test('the thread\'s own cover carries it too', () => {
    const post = screen('ForumOpeningPost');
    assert.match(post,
      /if \(discussion\.isOfficial\) \{[\s\S]{0,400}?ThumbnailOfficialBadge\(\s*\n\s*modifier = Modifier\s*\n\s*\.align\(Alignment\.BottomEnd\)/,
      'in the cover\'s bottom-right corner');
    assert.match(post, /testTag\("forum_thread_official"\)/);
    // The first badge in the opening post is the one on the picture: nothing
    // above it — the caption over the gradient — carries a badge any more. (The
    // flat form is later, in the branch for a thread with no cover at all.)
    const beforeThePictureBadge = post.slice(0, post.indexOf('ThumbnailOfficialBadge'));
    assert.ok(!/OfficialBadge/.test(beforeThePictureBadge),
      'and the words over the gradient carry no badge any more');
  });

  await t.test('and the home page\'s rows follow the same rule', () => {
    const row = screen('HomeForumRow');
    assert.match(row, /ThumbnailOfficialBadge\(\s*\n\s*modifier = Modifier\s*\n\s*\.align\(Alignment\.BottomEnd\)/);
    assert.match(row, /home_forum_official_\$\{discussion\.id\}/);
  });
});

// ---------------------------------------------------------------------------
// 4. সাম্প্রতিক আলোচনা on the home page
// ---------------------------------------------------------------------------

test('the home page shows the forum\'s five newest threads', async (t) => {
  await t.test('the strip is a list of five, and each row is a thread', () => {
    const block = screen('HomeForumBlock');
    assert.match(block, /text = "সাম্প্রতিক আলোচনা"/, 'under its own heading');
    assert.match(block, /text = "সব দেখুন"/, 'with one way into the forum');
    assert.match(block, /testTag\("home_forum_see_all"\)/);
    assert.match(block, /discussions\.forEachIndexed \{ index, discussion ->/,
      'the rows are an inline list, not a sideways rail');
    assert.ok(!/horizontalScroll|LazyRow/.test(block),
      'nothing on this card scrolls sideways');
    assert.match(block, /Hairline\(Modifier\.padding\(horizontal = EditorialSpace\.md\)\)/,
      'with a hairline between the rows');
    assert.match(block, /HomeForumRow\(/, 'and one row composable, used once per thread');
  });

  await t.test('a row says what the thread is, and where it is', () => {
    const row = screen('HomeForumRow');
    assert.match(row, /maxLines = 2,/);
    assert.match(row, /text = discussion\.categoryTitle/, 'the room');
    assert.match(row, /ForumCounters\(/, 'how many have read it and answered it');
    assert.match(row, /formatBengaliDate\(discussion\.lastActivityAt\)/, 'and when it last moved');
    assert.match(row, /forum_card|testTag\("home_forum_thread_\$\{discussion\.id\}"\)/);
    assert.match(row, /if \(discussion\.hasCover\)/, 'a cover when there is one');
    assert.match(row, /ForumAvatar\(/, 'and the face of who wrote it when there is not');
  });

  await t.test('five, asked for by the view model', () => {
    assert.match(HOME_VIEWMODEL, /private const val HOME_FORUM_COUNT = 5/);
    const loader = bodyOf(HOME_VIEWMODEL, 'loadForumLatest');
    assert.match(loader, /if \(!isSignedIn\) \{[\s\S]{0,200}return\s*\n\s*\}/,
      'a guest never asks: the gate is on the request');
    assert.match(loader, /repository\.forumOverview\(limit = HOME_FORUM_COUNT, order = ForumOverview\.ORDER_RECENT\)/,
      'the five that moved last');
    assert.match(loader, /\.take\(HOME_FORUM_COUNT\)/,
      'and never more than five, whatever the database sends');
  });

  await t.test('it is on the page after the header, and only for a registered reader', () => {
    const feed = HOME_SCREEN.slice(HOME_SCREEN.indexOf('LazyColumn('),
      HOME_SCREEN.indexOf('// 2. AI Assistant Banner'));
    assert.match(feed, /HeroCarousel\(/, 'the header comes first');
    assert.match(feed, /if \(isSignedIn\) \{\s*\n\s*item \{\s*\n\s*HomeForumBlock\(/,
      'and the strip is the very next item, gated on the session');
    assert.match(HOME_SCREEN, /viewModel\.loadForumLatest\(isSignedIn\)/,
      'loaded beside the contributor board');
    assert.ok(!/HomeForumBlock\([\s\S]{0,300}\n\}/.test(HOME_SCREEN.slice(0, HOME_SCREEN.indexOf('LazyColumn('))),
      'and not drawn anywhere before the list');
  });

  await t.test('a tap opens the thread; সব দেখুন opens the forum', () => {
    assert.match(NAV_HOST,
      /onForumDiscussionClick = \{ id -> navController\.navigate\(ReaderRoute\.forumThread\(id\)\) \}/);
    assert.match(NAV_HOST, /onSeeAllForum = \{ navController\.navigate\(ReaderRoute\.Forum\) \}/);
    assert.match(HOME_SCREEN, /onForumDiscussionClick = onForumDiscussionClick/);
    assert.match(HOME_SCREEN, /onSeeAllForum = onSeeAllForum/);
    assert.match(screen('HomeForumBlock'), /onClick = \{ onDiscussionClick\(discussion\.id\) \}/);
  });

  await t.test('a failure is one quiet line, not an empty card', () => {
    const block = screen('HomeForumBlock');
    assert.match(block, /loading && discussions\.isEmpty\(\) ->/, 'fetching says so, first');
    assert.match(block, /discussions\.isEmpty\(\) && error != null ->/, 'the failure is its own case');
    assert.match(block, /testTag\("home_forum_retry"\)/, 'with a way to try again');
    assert.match(block, /discussions\.isEmpty\(\) ->/, 'and an empty forum says so in words');
    assert.match(block, /"ফোরামে এখনো কোনো আলোচনা নেই।"/);
    // The three empty cases are told apart in this order: loading, failed, empty.
    const order = ['loading && discussions', 'error != null', '"ফোরামে এখনো কোনো আলোচনা নেই।"']
      .map((token) => block.indexOf(token));
    assert.ok(order.every((at, i) => at !== -1 && (i === 0 || at > order[i - 1])),
      'and never mistaken for each other');
  });
});
