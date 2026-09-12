'use strict';

/**
 * The forum, the contributor cards and the public profile, as the sources
 * declare them.
 *
 * There is no JVM in this repository's checks, so what cannot be compiled here
 * is read instead. Every assertion below is about a connection that is easy to
 * leave half-made and impossible to notice afterwards: a screen that borrows a
 * value it was never handed, a route that is declared and never registered, a
 * drawer row pointing at a page that no longer exists, a list sorted in one
 * place and not in the other, a counter shown from the wrong field.
 *
 * The database half of the same work is exercised for real by
 * `bash backend/tests/sql/run.sh` (migration 029 and the forum's behaviour);
 * this file is the app half.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app');
const MIGRATIONS = path.join(ROOT, 'backend', 'supabase', 'migrations');

const read = (...parts) => fs.readFileSync(path.join(APP, ...parts), 'utf8');
const readRoot = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const PORTAL_API = read('data', 'portal', 'PortalApi.kt');
const PORTAL_REPOSITORY = read('data', 'portal', 'PortalRepository.kt');
const PORTAL_MODELS = read('data', 'portal', 'PortalModels.kt');
const PORTAL_DTOS = read('data', 'portal', 'PortalDtos.kt');
const FORUM_TEXT = read('data', 'portal', 'ForumText.kt');
const FORUM_SCREENS = read('ui', 'screens', 'ForumScreens.kt');
const CONTRIBUTOR_SCREEN = read('ui', 'screens', 'ContributorScreen.kt');
const PUBLIC_PROFILE = read('ui', 'screens', 'PublicProfileScreen.kt');
const HOME_SCREEN = read('ui', 'reader', 'HomeScreen.kt');
const READER_VIEW_MODELS = read('ui', 'reader', 'ReaderViewModels.kt');
const DRAWER = read('ui', 'components', 'PortalDrawer.kt');
const SCREEN = read('ui', 'navigation', 'Screen.kt');
const NAV_HOST = read('ui', 'reader', 'ReaderNavHost.kt');
const PORTAL_PAGES = read('ui', 'screens', 'PortalPages.kt');
const FORUM_SQL = fs.readFileSync(
  path.join(MIGRATIONS, '029_forum.sql'), 'utf8');
const PROFILE_SQL = fs.readFileSync(
  path.join(MIGRATIONS, '028_public_profile_details.sql'), 'utf8');

/** The text inside a balanced `(` … `)` that starts at `openIndex`. */
function balanced(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, index);
    }
  }
  throw new Error('unbalanced parentheses');
}

function parametersOf(source, name) {
  const at = source.indexOf(`fun ${name}(`);
  assert.ok(at !== -1, `${name}() is declared`);
  return balanced(source, source.indexOf('(', at));
}

/**
 * The whole declaration of a function: its parameters and its body.
 *
 * `parametersOf` answers only the `(…)` — which is what a "does it declare what
 * it uses" check wants, and exactly what a "how big is the picture in the card"
 * check does not.
 */
function bodyOf(source, name) {
  const at = source.indexOf(`fun ${name}(`);
  assert.ok(at !== -1, `${name}() is declared`);
  const open = source.indexOf('{', source.indexOf(')', source.indexOf('(', at)));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(at, index + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}()`);
}

/** What a composable is handed must include everything it reads. */
function assertDeclares(source, name, parameters) {
  const declared = parametersOf(source, name);
  for (const parameter of parameters) {
    assert.match(declared, new RegExp(`\\b${parameter}:`),
      `${name} takes ${parameter} — it uses it, so it cannot borrow it`);
  }
}

/**
 * The composables this batch wrote or rewrote. Each one is called by name at
 * least once, and each call is compared against the declaration.
 */
const CALL_SITE_TARGETS = [
  'ForumHomeScreen', 'ForumCategoryScreen', 'ForumThreadScreen', 'NewDiscussionScreen',
  'PublicProfileScreen', 'ContributorCard', 'ContributorMiniRow', 'ContributorList',
  'HomeContent',
];

/** Every Kotlin file under `app/src/main/java`, with its path for messages. */
function kotlinSources(dir = APP) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...kotlinSources(full));
    else if (entry.name.endsWith('.kt')) found.push({ path: path.relative(ROOT, full), text: fs.readFileSync(full, 'utf8') });
  }
  return found;
}

/** The arguments of a call: top-level commas only, `->` is not a bracket. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  // A lambda arrow would count as a closing generic bracket and swallow the
  // rest of the argument list, so it is taken out of the scan first.
  for (const character of text.replace(/->/g, '\u2192')) {
    if ('([{<'.includes(character)) depth += 1;
    if (')]}>'.includes(character)) depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// The doors
// ---------------------------------------------------------------------------

test('the forum speaks through the app\'s own transport', async (t) => {
  await t.test('six RPCs, named as the migration names them', () => {
    for (const rpc of ['forum_overview', 'forum_category', 'forum_search',
      'forum_discussion', 'forum_create_discussion', 'forum_reply']) {
      assert.match(PORTAL_API, new RegExp(`rpc/${rpc}`), `${rpc} is declared`);
      assert.match(PORTAL_API, new RegExp(`suspend fun ${rpc.replace(/_(.)/g, (m, c) => c.toUpperCase())}\\(`),
        `${rpc}'s function is declared`);
    }
  });

  await t.test('and the repository wraps each one in a Result', () => {
    for (const method of ['forumOverview', 'forumCategory', 'forumSearch',
      'forumDiscussion', 'createForumDiscussion', 'forumReply']) {
      assert.match(PORTAL_REPOSITORY,
        new RegExp(`suspend fun ${method}\\([^)]*\\): Result<`),
        `${method} answers with a Result, like every other call on this transport`);
    }
  });

  await t.test('no screen talks to the tables directly', () => {
    // The six functions are the only door: a screen that called `forum_discussions`
    // as a table would bypass the grants the migration sets.
    assert.ok(!/@GET\("forum_/.test(PORTAL_API), 'reads go through the RPCs, not the tables');
    assert.ok(!/forum_discussions|forum_replies/.test(PORTAL_API),
      'the tables are never named by the app');
  });

  await t.test('the view counter is a parameter, not an accident', () => {
    assert.match(PORTAL_API, /suspend fun forumDiscussion\(\s*@Body body: Map<String, String>\s*\)/,
      'the discussion call takes the flag among its parameters');
    assert.match(PORTAL_REPOSITORY, /"p_count_view" to countView\.toString\(\)/,
      'and the app decides whether an open counts as a view');
    assert.match(PORTAL_REPOSITORY, /fun forumDiscussion\(id: String, countView: Boolean = true\)/,
      'and defaults to counting, because that is what an open is');
  });
});

test('guests read, signed-in readers write', async (t) => {
  await t.test('the migration grants the reads to anon as well', () => {
    for (const fn of ['forum_overview(integer)', 'forum_category(text, integer, integer)',
      'forum_search(text, integer)', 'forum_discussion(uuid, boolean)']) {
      assert.ok(FORUM_SQL.includes(`grant execute on function public.${fn} to anon, authenticated;`),
        `${fn} is readable by a guest`);
    }
  });

  await t.test('and the writes to authenticated alone', () => {
    assert.ok(FORUM_SQL.includes(
      'grant execute on function public.forum_create_discussion(text, text, text) to authenticated;'));
    assert.ok(FORUM_SQL.includes('grant execute on function public.forum_reply(uuid, text) to authenticated;'));
    assert.ok(!/grant execute on function public\.forum_(create_discussion|reply)[^;]*anon/.test(FORUM_SQL),
      'a guest is never granted a write');
  });

  await t.test('which the app recognises as a session problem', () => {
    assert.match(FORUM_SQL, /using errcode = '42501'/,
      'both writes raise the code the transport already classifies');
    assert.match(FORUM_SCREENS, /failure is PortalError\.SignedOut/,
      'and the screens answer it with the way back in');
    assert.match(FORUM_SCREENS, /PortalError\.SignedOut\.SESSION_EXPIRED/,
      'in the app\'s words, never the database\'s English');
  });

  await t.test('a guest is offered sign-in, not an error', () => {
    assert.match(FORUM_SCREENS, /if \(!isSignedIn\) \{\s*ForumSignInPrompt\(onSignInClick\)/,
      'the reply box becomes the prompt for a guest');
    assert.match(FORUM_SCREENS, /if \(isSignedIn\) onNewDiscussion\(\) else onSignInClick\(\)/,
      'and the new-discussion button leads to sign-in instead of a refusal');
  });
});

// ---------------------------------------------------------------------------
// The screens
// ---------------------------------------------------------------------------

test('every forum screen is handed what it renders', async (t) => {
  await t.test('the home page', () => {
    assertDeclares(FORUM_SCREENS, 'ForumHomeScreen',
      ['isSignedIn', 'loadOverview', 'search', 'onCategoryClick', 'onDiscussionClick',
        'onNewDiscussion', 'onSignInClick']);
  });

  await t.test('one room', () => {
    assertDeclares(FORUM_SCREENS, 'ForumCategoryScreen',
      ['slug', 'isSignedIn', 'loadCategory', 'onDiscussionClick', 'onNewDiscussion', 'onSignInClick']);
  });

  await t.test('one discussion', () => {
    assertDeclares(FORUM_SCREENS, 'ForumThreadScreen',
      ['discussionId', 'isSignedIn', 'loadThread', 'postReply', 'onSignInClick']);
  });

  await t.test('the composer', () => {
    assertDeclares(FORUM_SCREENS, 'NewDiscussionScreen',
      ['preselectSlug', 'isSignedIn', 'loadCategories', 'post', 'onPosted', 'onSignInClick']);
  });

  await t.test('and each route is registered, with its arguments', () => {
    for (const route of ['Forum', 'ForumRoom', 'ForumThread', 'ForumNewPattern']) {
      assert.match(NAV_HOST, new RegExp(`route = ReaderRoute\\.${route}|composable\\(ReaderRoute\\.${route}`),
        `${route} has a destination`);
    }
    assert.match(NAV_HOST, /navArgument\("slug"\) \{ type = NavType\.StringType \}/,
      'a room route carries its slug');
    assert.match(NAV_HOST, /navArgument\("discussionId"\) \{ type = NavType\.StringType \}/,
      'a discussion route carries its id');
    assert.match(NAV_HOST, /navArgument\("room"\) \{ type = NavType\.StringType; defaultValue = "" \}/,
      'and the composer accepts a room it may already be in');
  });

  await t.test('the room list the composer shows is the forum\'s own', () => {
    assert.match(NAV_HOST, /loadCategories = \{ slug ->\s*app\.portalRepository\.forumOverview\(limit = 1\)\.map \{ it\.categories \}/,
      'one source for the rooms: the same RPC the home page reads');
  });
});

test('a discussion can be read from the list to the last reply', async (t) => {
  await t.test('the card carries its category, author, date, views and replies', () => {
    const card = bodyOf(FORUM_SCREENS, 'ForumDiscussionCard');
    for (const field of ['categoryTitle', 'authorName', 'authorAvatarUrl',
      'lastActivityAt', 'views', 'replies']) {
      assert.ok(card.includes(field), `the card shows ${field}`);
    }
    assert.match(card, /formatBengaliDate\(/, 'the date is the reader\'s, not ISO text');
  });

  await t.test('the thread shows the opening post and every reply', () => {
    const thread = bodyOf(FORUM_SCREENS, 'ForumThreadScreen');
    assert.match(thread, /ForumOpeningPost\(loaded\.discussion\)/, 'the opening post');
    assert.match(thread, /items\(loaded\.replies/, 'and the answers');
    assert.match(thread, /ForumReplyComposer\(/, 'with a box to add one');
  });

  await t.test('posting re-reads the thread without counting a second view', () => {
    assert.match(FORUM_SCREENS, /loadThread\(discussionId, false\)/,
      'the refresh after a reply does not inflate the view count');
  });

  await t.test('search waits for a word, not a letter', () => {
    assert.match(FORUM_SCREENS, /if \(term\.length < 2\) \{/, 'one keystroke asks nothing');
    assert.match(FORUM_SCREENS, /delay\(300\)/, 'and typing pauses before the request');
  });

  await t.test('paging a room is not cached as its first page', () => {
    assert.match(PORTAL_REPOSITORY, /if \(safeOffset == 0 && !forceRefresh\) \{/,
      'only the first page is remembered');
  });
});

test('the app counts characters the way the database counts them', async (t) => {
  await t.test('the server strips the marks before counting', () => {
    assert.match(FORUM_SQL, /create or replace function public\.forum_text_units\(p_text text\)/,
      'there is one definition of a character');
    assert.match(FORUM_SQL, /E'\[.+u0981-.+u0983/, 'and it is the Bengali combining ranges');
    assert.match(FORUM_SQL, /public\.forum_text_units\(clean_title\) < 4/,
      'the title guard uses it');
    assert.match(FORUM_SQL, /public\.forum_text_units\(clean_body\) < 1/,
      'and so do the body guards');
  });

  await t.test('and the app mirrors it, so the field can warn first', () => {
    assert.match(FORUM_TEXT, /fun units\(text: String\): Int = text\.count \{ !it\.isWhitespace\(\) && it !in MARKS \}/,
      'the same rule, in Kotlin');
    for (const mark of ['\\u0981', '\\u09BC', '\\u09BE', '\\u09CD', '\\u200C']) {
      assert.ok(FORUM_TEXT.includes(mark), `the mark set includes ${mark}`);
    }
  });

  await t.test('the limits are the ones the server enforces', () => {
    for (const [name, value] of [['TITLE_MIN', '4'], ['TITLE_MAX', '160'],
      ['BODY_MAX', '8000'], ['REPLY_MAX', '4000']]) {
      assert.match(FORUM_TEXT, new RegExp(`const val ${name} = ${value}`), `${name} matches the SQL`);
    }
    assert.match(FORUM_SQL, /char_length\(clean_title\) > 160/, 'the SQL refuses an over-long title');
    assert.match(FORUM_SQL, /char_length\(clean_body\) > 8000/, 'and an over-long body');
    assert.match(FORUM_SQL, /char_length\(clean_body\) > 4000/, 'and an over-long reply');
  });

  await t.test('and the field says so before the button is pressed', () => {
    assert.match(FORUM_SCREENS, /val canPost = isSignedIn && categorySlug\.isNotBlank\(\) && titleProblem == null/,
      'the button is disabled while the form is not acceptable');
    assert.match(FORUM_SCREENS, /toBengaliNumeral\(ForumText\.units\(title\)\)/,
      'the counter shows what the server will count');
  });
});

// ---------------------------------------------------------------------------
// The drawer and the page it replaced
// ---------------------------------------------------------------------------

test('the sidebar row is the forum, and only the forum', async (t) => {
  await t.test('the row is there, pointing at the forum', () => {
    assert.match(DRAWER, /DrawerRow\("ফোরাম", Icons\.Default\.Forum, currentRoute == Screen\.Forum\.route\)/,
      'the drawer has a ফোরাম row');
    assert.match(DRAWER, /onNavigate\(Screen\.Forum\.route\)/, 'which navigates to it');
  });

  await t.test('সামাজিক কার্যকলাপ is gone from the app, not merely hidden', () => {
    assert.ok(!/SocialActivities/.test(SCREEN), 'the Screen object is gone');
    assert.ok(!/SocialActivities/.test(NAV_HOST), 'the route and its destination are gone');
    assert.ok(!/SocialActivitiesScreen/.test(PORTAL_PAGES), 'the page itself is gone');
    assert.ok(!/social_activities/.test(DRAWER), 'no drawer row points at the old route');
  });

  await t.test('and the state only that page read went with it', () => {
    assert.ok(!/SocialUiState/.test(READER_VIEW_MODELS), 'the UI state is gone');
    assert.ok(!/fun loadSocial\(/.test(READER_VIEW_MODELS), 'and the loader');
    assert.ok(!/SOCIAL_CATEGORY_TITLE/.test(READER_VIEW_MODELS), 'and the constant it matched on');
  });

  await t.test('but the content it showed is still reachable', () => {
    assert.match(PORTAL_REPOSITORY, /suspend fun galleries\(/,
      'the gallery call stays: home uses it');
    assert.match(PORTAL_REPOSITORY, /suspend fun articlesByCategory\(/,
      'and the category listing does too: Explore and Home read it');
  });
});

// ---------------------------------------------------------------------------
// Home: the contributor rail
// ---------------------------------------------------------------------------

test('the home contributor rail matches what was asked for', async (t) => {
  await t.test('five at most', () => {
    assert.match(READER_VIEW_MODELS, /HOME_CONTRIBUTOR_COUNT = 5/,
      'the home asks for five');
    assert.match(READER_VIEW_MODELS, /repository\.contributorBoard\(limit = HOME_CONTRIBUTOR_COUNT\)/,
      'and uses it as the limit');
  });

  await t.test('titled সেরা অবদানকারী, with this month under it', () => {
    assert.match(HOME_SCREEN, /title = "সেরা অবদানকারী"/, 'the title');
    assert.match(HOME_SCREEN, /subtitle = "\$\{monthNameOf\(contributorsMonth\)\} মাস"/,
      'and the month, from the board the database sent');
    assert.match(READER_VIEW_MODELS, /val contributorsMonth: StateFlow<String>/,
      'which the view model keeps');
    assert.match(CONTRIBUTOR_SCREEN, /internal fun monthNameOf\(monthKey: String\): String \{/,
      'a `2026-09` becomes সেপ্টেম্বর, not a date string');
  });

  await t.test('spoken for by its own space after the song rail', () => {
    const from = HOME_SCREEN.indexOf('if (isSignedIn && (contributors.isNotEmpty()');
    // The first `SectionHeader(` in the file belongs to a rail further up, so
    // the search starts where the board does.
    const section = HOME_SCREEN.slice(from, HOME_SCREEN.indexOf('SectionHeader(', from));
    assert.match(section, /Spacer\(Modifier\.height\(EditorialSpace\.lg\)\)/,
      'the board no longer runs into the section above it');
  });

  await t.test('faces are larger and the time indicators are gone', () => {
    const row = bodyOf(CONTRIBUTOR_SCREEN, 'ContributorMiniRow');
    assert.match(row, /\.size\(48\.dp\)/, 'the picture is 48dp, not 34');
    assert.ok(!/minutes|seconds|মি\b/.test(row), 'no time in the app');
    assert.ok(!/views/.test(row), 'and no view count on a rail row');
    assert.match(row, /toBengaliNumeral\(contributor\.points\)/, 'the points are the number shown');
  });

  await t.test('and nothing in the app shows minutes any more', () => {
    assert.ok(!/stats\.minutes/.test(CONTRIBUTOR_SCREEN), 'the minute pill is gone');
    assert.ok(!/stats\.views/.test(CONTRIBUTOR_SCREEN), 'and the view pill with it');
    assert.ok(!/Icons\.Default\.Timer/.test(CONTRIBUTOR_SCREEN), 'the clock icon has no caller');
  });
});

// ---------------------------------------------------------------------------
// The board page
// ---------------------------------------------------------------------------

test('the contributor page explains less and shows more', async (t) => {
  await t.test('the point-calculation paragraph is gone', () => {
    assert.ok(!/পয়েন্ট কীভাবে জমে/.test(CONTRIBUTOR_SCREEN), 'the explainer heading is gone');
    assert.ok(!/প্রতিটি প্রকাশিত প্রবন্ধ ৫০ পয়েন্ট/.test(CONTRIBUTOR_SCREEN),
      'and the weights sentence with it');
    assert.ok(!/fun PointsExplainer\(/.test(CONTRIBUTOR_SCREEN), 'the card itself is removed');
  });

  await t.test('the reader\'s own points remain, without the lecture', () => {
    assert.match(CONTRIBUTOR_SCREEN, /private fun MyStandingCard\(points: Int\)/,
      'one compact card');
    assert.match(CONTRIBUTOR_SCREEN, /testTag\("contributor_my_points"\)/, 'that can be found in a UI test');
  });

  await t.test('a bigger picture, and the points on a row of their own', () => {
    const card = bodyOf(CONTRIBUTOR_SCREEN, 'ContributorCard');
    assert.match(card, /\.size\(62\.dp\)/, 'the picture is 62dp');
    assert.match(card, /Column \{/, 'the card is stacked, not one cramped row');
    assert.match(card, /Hairline\(Modifier\.padding\(horizontal = EditorialSpace\.md\)\)/,
      'a rule separates the two rows');
    assert.match(card, /text = "পয়েন্ট"/, 'and the points row is labelled');
    assert.match(card, /RankBadge\(/, 'the medal or number is its own piece');
  });

  await t.test('the app bar still names the month the board covers', () => {
    assert.match(CONTRIBUTOR_SCREEN, /monthLabel\(month\)/, 'september plus the year');
  });
});

// ---------------------------------------------------------------------------
// The public profile
// ---------------------------------------------------------------------------

test('a public profile is real data, in the order asked for', async (t) => {
  await t.test('name, then designation, then a short address', () => {
    assert.match(PUBLIC_PROFILE, /testTag\("public_profile_name"\)/, 'the name');
    assert.match(PUBLIC_PROFILE, /testTag = "public_profile_designation"/, 'the designation');
    assert.match(PUBLIC_PROFILE, /testTag = "public_profile_address"/, 'the address');
    assert.match(PUBLIC_PROFILE, /profile\.designation\.ifBlank \{ "পাঠক" \}/,
      'or the one thing every account here is');
    assert.match(PUBLIC_PROFILE, /if \(profile\.shortAddress\.isNotBlank\(\)\)/,
      'the address is shown only when there is one');
    assert.match(PORTAL_MODELS, /val shortAddress: String\s*\n?\s*get\(\) = address\.trim\(\)\.lineSequence\(\)\.firstOrNull\(\)/,
      'and it is the first line of the real address');
  });

  await t.test('no placeholder people anywhere on the page', () => {
    for (const fake of ['example.com', 'Lorem', 'unsplash', 'John Doe', 'placeholder']) {
      assert.ok(!PUBLIC_PROFILE.includes(fake), `the page does not invent a ${fake}`);
    }
    assert.ok(!/address = "/.test(PUBLIC_PROFILE), 'no address is written in the source');
    assert.ok(!/designation = "/.test(PUBLIC_PROFILE), 'and no designation either');
  });

  await t.test('the statistics card is views, points, and this month\'s points', () => {
    const stats = bodyOf(PUBLIC_PROFILE, 'ProfileStatistics');
    for (const label of ['মোট ভিউ', 'মোট পয়েন্ট', 'এই মাসের পয়েন্ট']) {
      assert.ok(stats.includes(label), `the card shows ${label}`);
    }
    assert.match(stats, /profile\.totalViews/, 'views are the database\'s totals');
    assert.match(stats, /profile\.points\.toLong\(\)/, 'points are the board\'s points');
    assert.match(stats, /profile\.monthPoints\.toLong\(\)/, 'and the month\'s are the month\'s');
    assert.ok(!/profile\.articles\.size|profile\.songs\.size/.test(stats),
      'the old article/song counts are not in the statistics card');
  });

  await t.test('two tabs, each with its count', () => {
    assert.match(PUBLIC_PROFILE, /val tabs = listOf\(\s*"প্রবন্ধ" to articles\.size,\s*"গান" to songs\.size\s*\)/,
      'the two tabs and their counters');
    assert.match(PUBLIC_PROFILE, /TabRow\(/, 'rendered as tabs');
    assert.match(PUBLIC_PROFILE, /text = "\$label \(\$\{toBengaliNumeral\(count\)\}\)"/,
      'with the count in Bengali numerals');
    assert.match(PUBLIC_PROFILE, /testTag\("public_profile_tabs"\)/, 'and reachable in a UI test');
  });

  await t.test('most-read first, and sorted in the app as well as the database', () => {
    assert.match(PROFILE_SQL, /order by b\.views_count desc nulls last/,
      'the SQL orders articles by views');
    assert.match(PROFILE_SQL, /order by t\.views_count desc nulls last, t\.created_at desc/,
      'and songs the same way');
    assert.match(PORTAL_MODELS, /val articlesByViews: List<PublicArticle>\s*\n\s*get\(\) = articles\.sortedWith\(/,
      'the app sorts too, so a cached page cannot disagree');
    assert.match(PORTAL_MODELS, /compareByDescending<MusicTrack> \{ it\.viewsCount \}/,
      'the songs by their play count');
    assert.match(PUBLIC_PROFILE, /val articles = remember\(loaded\) \{ loaded\.articlesByViews \}/,
      'and the page reads the sorted lists');
  });

  await t.test('every row carries a published date', () => {
    const article = bodyOf(PUBLIC_PROFILE, 'PublicArticleCard');
    const song = bodyOf(PUBLIC_PROFILE, 'PublicSongCard');
    assert.match(article, /date = formatBengaliDate\(article\.publishedAt\)/, 'the article\'s date');
    assert.match(song, /date = formatBengaliDate\(track\.createdAt\)/, 'the song\'s upload date');
    assert.match(PORTAL_MODELS, /createdAt = row\.createdAt\.orEmpty\(\)/, 'which the mapper fills in');
  });

  await t.test('the back arrow has room above the content', () => {
    assert.match(PUBLIC_PROFILE,
      /contentPadding = PaddingValues\(top = EditorialSpace\.sm, bottom = 96\.dp\)/,
      'the first card no longer starts under the app bar');
  });

  await t.test('and the three fields the RPC sends are mapped, null-safe', () => {
    for (const field of ['designation', 'address', 'points', 'monthPoints']) {
      assert.match(PORTAL_DTOS, new RegExp(`val ${field}: (String|Int)\\? = null`),
        `the DTO carries ${field}`);
    }
    assert.match(PORTAL_DTOS, /@Json\(name = "month_points"\) val monthPoints: Int\? = null/,
      'month_points is the wire name');
    assert.match(PORTAL_MODELS, /points = \(points \?\: 0\)\.coerceAtLeast\(0\)/,
      'a missing count is zero, never a crash');
  });
});

// ---------------------------------------------------------------------------
// Sorting and counters, from the wire to the card
// ---------------------------------------------------------------------------

test('counters and lists arrive with the right numbers', async (t) => {
  await t.test('the board keeps its own counts, not the app\'s arithmetic', () => {
    assert.match(PORTAL_MODELS, /val points: Int get\(\) = stats\.points/,
      'a card\'s points are the database\'s points');
    assert.ok(!/stats\.articles \* 50|stats\.songs \* 30/.test(PORTAL_MODELS),
      'the weights are not recomputed in the app');
  });

  await t.test('an unanswered thread is drawn differently, from its own count', () => {
    assert.match(PORTAL_MODELS, /val hasReplies: Boolean get\(\) = replies > 0/,
      'the model says whether anyone answered');
    assert.match(FORUM_SCREENS, /answered = discussion\.hasReplies/,
      'and the card asks it');
    assert.match(FORUM_SCREENS, /tint = if \(answered\) tokens\.accent else tokens\.inkMuted/,
      'so the reply counter means something');
  });

  await t.test('a thread with no replies falls back to its own post date', () => {
    assert.match(PORTAL_MODELS,
      /lastActivityAt = lastReplyAt\.orEmpty\(\)\.ifBlank \{ createdAt\.orEmpty\(\) \}/,
      'last activity is the last reply, or the post itself');
  });

  await t.test('counts never come back negative or null', () => {
    assert.match(PORTAL_MODELS, /replies = \(replies \?\: 0\)\.coerceAtLeast\(0\)/,
      'a null count is zero');
    assert.match(PORTAL_MODELS, /views = \(views \?\: 0L\)\.coerceAtLeast\(0L\)/,
      'and a null view total too');
    assert.match(PORTAL_MODELS, /title = title\.orEmpty\(\)\.trim\(\)\.ifBlank \{ "শিরোনামহীন আলোচনা" \}/,
      'a thread with no title still has something to show');
  });

  await t.test('the tables are locked even though the RPCs are not', () => {
    for (const table of ['forum_categories', 'forum_discussions', 'forum_replies']) {
      assert.ok(FORUM_SQL.includes(`alter table public.${table} enable row level security;`),
        `${table} has RLS`);
    }
    assert.ok(FORUM_SQL.includes('revoke all on public.forum_discussion_rows from anon, authenticated;'),
      'and the view every read goes through is not itself a door');
  });
});

test('every call site matches the declaration it calls', () => {
  // The one class of mistake a lexical sweep cannot see: a composable that was
  // rewritten while a caller kept the old shape — a parameter renamed, an
  // argument left behind, a call to a function that no longer exists. This walks
  // the declarations and the call sites and compares them by name, which is as
  // close to a compiler as this repository's checks get.
  const declarations = new Map();
  for (const name of CALL_SITE_TARGETS) {
    for (const source of kotlinSources()) {
      const at = source.text.indexOf(`fun ${name}(`);
      if (at === -1) continue;
      declarations.set(name, splitTopLevel(balanced(source.text, source.text.indexOf('(', at)))
        .map((arg) => {
          const colon = arg.indexOf(':');
          const head = arg.slice(0, colon).trim().split(/\s+/).pop();
          return { name: head, optional: arg.slice(colon).includes('=') };
        }));
      break;
    }
    assert.ok(declarations.has(name), `${name}() is declared somewhere in the app`);
  }

  let checked = 0;
  for (const name of CALL_SITE_TARGETS) {
    const params = declarations.get(name);
    const names = new Set(params.map((param) => param.name));
    const required = params.filter((param) => !param.optional).map((param) => param.name);

    for (const source of kotlinSources()) {
      let from = 0;
      for (;;) {
        const at = source.text.indexOf(`${name}(`, from);
        if (at === -1) break;
        from = at + 1;
        if (source.text.slice(Math.max(0, at - 4), at).endsWith('fun ')) continue;
        const args = splitTopLevel(balanced(source.text, source.text.indexOf('(', at)));
        const labels = args
          .filter((arg) => /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(arg))
          .map((arg) => arg.split('=')[0].trim());
        const positional = args.filter((arg) => !/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(arg));
        checked += 1;

        const unknown = labels.filter((label) => !names.has(label));
        assert.deepEqual(unknown, [],
          `${source.path} calls ${name}() with ${unknown.join(', ')} — the declaration has no such parameter`);

        const unfilled = required.filter((param) => !labels.includes(param)).slice(positional.length);
        assert.deepEqual(unfilled, [],
          `${source.path} calls ${name}() without ${unfilled.join(', ')}`);
      }
    }
  }
  assert.ok(checked >= CALL_SITE_TARGETS.length,
    `every screen has at least one caller (checked ${checked})`);
});

test('the profile RPC keeps its promises when migration 026 is absent', async (t) => {
  await t.test('points are read defensively, not assumed', () => {
    assert.match(PROFILE_SQL, /if to_regprocedure\('public\.contributor_score\(uuid, date, date\)'\) is not null/,
      'the page works before the contributors migration is pasted');
    assert.match(PROFILE_SQL, /month_points integer := 0;/,
      'and answers zero rather than failing');
  });

  await t.test('and the two new columns are added if missing', () => {
    assert.match(PROFILE_SQL,
      /alter table public\.profiles add column if not exists designation text not null default '';/);
    assert.match(PROFILE_SQL,
      /alter table public\.profiles add column if not exists address text not null default '';/);
  });

  await t.test('no contact details are exposed by the page', () => {
    assert.ok(!/person\.email/.test(PROFILE_SQL), 'the email is not returned');
    assert.ok(!/person\.phone/.test(PROFILE_SQL), 'nor the phone');
    assert.ok(!/person\.website/.test(PROFILE_SQL), 'nor the website');
  });
});
