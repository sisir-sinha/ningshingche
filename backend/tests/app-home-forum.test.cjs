/**
 * The home page's forum strip, and the order of three lists.
 *
 * Four things were asked for here:
 *
 *  * সেরা অবদানকারী in order of points, descending — on the home page and on the
 *    contributor page, which read the same board;
 *  * the forum's **জনপ্রিয়** tab in descending order too;
 *  * the verified mark: the tick alone, without the word অনুমোদিত, on the card's
 *    cover and in the thread's own row;
 *  * a cover on every thread — the reader's picture, or a stand-in built from the
 *    thread's id with the first letter of its title centred on it;
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
// 3. The verified mark: the tick, without the word
// ---------------------------------------------------------------------------

test('the verified mark is the tick alone, and it is on the picture', async (t) => {
  await t.test('there is one mark, and it says nothing in words', () => {
    assert.match(FORUM_SCREENS, /private fun VerifiedMark\(onImage: Boolean = false/,
      'one composable, for a picture and for a line of words');
    assert.ok(!/private fun OfficialBadge\(/.test(FORUM_SCREENS),
      'the labelled badge is gone');
    assert.ok(!FORUM_SCREENS.includes('ThumbnailOfficialBadge'),
      'and so is its on-the-thumbnail wrapper: one mark, not two');
    const mark = FORUM_SCREENS.slice(
      FORUM_SCREENS.indexOf('private fun VerifiedMark('),
      FORUM_SCREENS.indexOf('private fun ForumCountsRow(')
    );
    assert.match(mark, /Icons\.Default\.Verified/, 'what is left is the tick');
    assert.match(mark, /contentDescription = "অনুমোদিত"/,
      'and the word is only read out, for a screen reader');
    assert.match(mark, /background\(if \(onImage\) Color\(0xCC0E1A16\) else tokens\.accentSoft\)/,
      'a dark scrim over a picture, the pale chip against a page');
    assert.match(mark, /tint = if \(onImage\) Color\.White else tokens\.accent/);
    // The card and the thread are what the owner named: neither writes the word.
    const card = screen('ForumDiscussionCard');
    assert.ok(!card.includes('অনুমোদিত'), 'the card does not write it');
    const post = screen('ForumOpeningPost');
    assert.ok(!post.includes('অনুমোদিত'), 'and nor does the thread');
  });

  await t.test('the card carries it in the cover\'s top-right corner', () => {
    const card = screen('ForumDiscussionCard');
    const cover = card.slice(card.indexOf('.width(FORUM_CARD_COVER_WIDTH)'),
      card.indexOf('Spacer(Modifier.width(EditorialSpace.xs))'));
    assert.match(cover, /VerifiedMark\(\s*\n\s*onImage = true,\s*\n\s*modifier = Modifier\s*\n\s*\.align\(Alignment\.TopEnd\)/,
      'on the picture, in its other top corner — the counters have the left one');
    assert.match(cover, /forum_card_official_\$\{discussion\.id\}/, 'and reachable in a UI test');
    assert.ok(!/discussion\.isOfficial && !discussion\.hasCover/.test(card),
      'no branch left for a card without a picture: every card has one');
  });

  await t.test('the thread keeps it in its own row, under the cover', () => {
    const post = screen('ForumOpeningPost');
    assert.ok(!/VerifiedMark/.test(post), 'not on the cover: the owner took it off');
    const meta = screen('ForumOpeningMeta');
    assert.match(meta, /ForumCounters\([\s\S]{0,300}?if \(discussion\.isOfficial\) \{[\s\S]{0,120}?VerifiedMark\(/,
      'after the thread\'s numbers, at the end of the row');
    assert.match(meta, /testTag\("forum_thread_verified"\)/);
    const card = screen('ForumDiscussionCard');
    assert.match(card, /VerifiedMark\(\s*\n\s*onImage = true/,
      'while on a card it is drawn for a picture');
  });

  await t.test('and the home page\'s rows follow the same rule', () => {
    const row = screen('HomeForumRow');
    assert.match(row, /VerifiedMark\(\s*\n\s*onImage = true,\s*\n\s*modifier = Modifier\s*\n\s*\.align\(Alignment\.TopEnd\)/);
    assert.match(row, /home_forum_official_\$\{discussion\.id\}/);
    assert.ok(!row.includes('অনুমোদিত'), 'with no word on it either');
  });
});

// ---------------------------------------------------------------------------
// 4. সাম্প্রতিক আলোচনা on the home page
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 3b. Every thread has a cover
// ---------------------------------------------------------------------------

test('every thread has a cover, and a thread with no picture gets a stand-in', async (t) => {
  await t.test('the picture is one composable, used everywhere a thread is shown', () => {
    assert.match(FORUM_SCREENS, /private object ForumCover \{/,
      'the cover and its stand-in live together');
    // The card's cover column, the thread's own cover, the home page's thumbnail.
    const card = screen('ForumDiscussionCard');
    const post = screen('ForumOpeningPost');
    const row = screen('HomeForumRow');
    for (const [name, body] of [['the card', card], ['the thread', post], ['the home row', row]]) {
      assert.match(body, /ForumCover\.Photo\(/, `${name} draws the picture through it`);
      assert.match(body, /id = discussion\.id/, `${name} hands it the thread\'s id, for the colour`);
      assert.match(body, /title = discussion\.title/, `${name} hands it the title, for the letter`);
    }
    assert.ok(!/if \(discussion\.hasCover\) \{[\s\S]{0,200}?PortalAsyncImage/.test(card),
      'the card\'s cover is not conditional any more');
  });

  await t.test('the stand-in is coloured from the thread\'s own id', () => {
    const cover = FORUM_SCREENS.slice(FORUM_SCREENS.indexOf('private object ForumCover {'),
      FORUM_SCREENS.indexOf('private fun ForumDiscussionCard('));
    assert.match(cover, /fun fillFor\(id: String\): Color \{/);
    assert.match(cover, /var value = 0\n\s*id\.forEach \{ char -> value = \(value \* 31 \+ char\.code\) and 0x7FFFFFFF \}/,
      'a hash written out here, so the colour is this function\'s own property');
    assert.match(cover, /Color\.hsl\(\(value % 360\)\.toFloat\(\), PITCH, DEPTH\)/,
      'every id gets its own hue, at one pitch and one depth for the whole app');
    assert.ok(!/Math\.random|Random\(/.test(cover),
      'not a random number: the same thread keeps its colour on every device');
    assert.match(cover, /private const val PITCH = 0\.34f/);
    assert.match(cover, /private const val DEPTH = 0\.33f/);
  });

  await t.test('and the title\'s first letter sits in the middle of it', () => {
    const cover = FORUM_SCREENS.slice(FORUM_SCREENS.indexOf('private object ForumCover {'),
      FORUM_SCREENS.indexOf('private fun ForumDiscussionCard('));
    assert.match(cover, /fun initial\(title: String\): String \{/);
    assert.match(cover, /title\.trim\(\)\.firstOrNull \{ char ->/,
      'the first character of the title');
    assert.match(cover, /OPENING_PUNCTUATION\.indexOf\(char\) == -1/,
      'skipping punctuation a title may open with');
    assert.match(cover, /fontSize = glyphSize/, 'set at the size its caller asks for');
    assert.match(cover, /contentAlignment = Alignment\.Center/, 'centred on the cover canvas');
    assert.match(cover, /color = GLYPH_INK/, 'in the one ink the fills are chosen for');
    // Each surface sizes the letter for itself: the card\'s column, the thread\'s
    // whole cover, the home page\'s thumbnail.
    assert.match(screen('ForumDiscussionCard'), /glyphSize = 34\.sp/);
    assert.match(screen('ForumOpeningPost'), /glyphSize = 66\.sp/);
    assert.match(screen('HomeForumRow'), /glyphSize = 22\.sp/);
  });

  await t.test('a reader\'s own picture is still the one that is shown', () => {
    const cover = FORUM_SCREENS.slice(FORUM_SCREENS.indexOf('private object ForumCover {'),
      FORUM_SCREENS.indexOf('private fun ForumDiscussionCard('));
    const photo = cover.slice(cover.indexOf('fun Photo('));
    assert.match(photo, /val url = coverUrl\.trim\(\)\n\s*if \(url\.isNotEmpty\(\)\) \{/,
      'the uploaded cover wins whenever there is one');
    assert.match(photo, /PortalAsyncImage\(/);
    assert.match(photo, /Monogram\(id = id, title = title, glyphSize = glyphSize, modifier = modifier\)/,
      'and the stand-in is drawn only when there is none');
    // A stand-in has no picture to open on its own.
    assert.match(screen('ForumOpeningPost'), /\.clickable\(enabled = discussion\.hasCover, onClick = onCoverClick\)/,
      'tapping the cover opens a picture only when there is one');
  });

  await t.test('the counters are on the cover, in its top-left corner', () => {
    // The owner's other sentence about this card: views and comments move off the
    // category\'s line and onto the picture.
    const card = screen('ForumDiscussionCard');
    const cover = card.slice(card.indexOf('.width(FORUM_CARD_COVER_WIDTH)'),
      card.indexOf('Spacer(Modifier.width(EditorialSpace.xs))'));
    assert.match(cover, /ForumCounters\([\s\S]{0,400}?\.align\(Alignment\.TopStart\)/);
    assert.match(cover, /views = true,/, 'views and answers, as before');
    assert.match(cover, /tint = Color\.White/, 'white ink, readable on any photograph');
    assert.match(cover, /Brush\.verticalGradient\(\s*\n\s*colors = listOf\(Color\(0x8C000000\), Color\.Transparent\)/,
      'under a short scrim, so a pale photograph cannot swallow them');
    assert.ok(!/forum_card_counter_scrim[\s\S]{0,200}?(Surface|status-badge|chip)/i.test(cover),
      'the scrim is not a pill: no second fill behind the numbers');
    assert.match(FORUM_SCREENS, /private fun ForumCounters\([\s\S]{0,400}?tint: Color\? = null/,
      'the counters take an ink, and keep their own when nobody passes one');
  });
});

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
    assert.match(row, /ForumCover\.Photo\(/, 'a cover, always — the stand-in when there is none');
    assert.ok(!/ForumAvatar\(/.test(row),
      'and never the author\'s face in the picture\'s place: every thread has a picture');
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
