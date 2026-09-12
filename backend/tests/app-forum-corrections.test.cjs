/**
 * The owner's second pass over the forum, checked the way the first pass was.
 *
 * Ten points plus four extras arrived after the 1.2 push, and every one of them
 * is a claim about a file: a rail that scrolls sideways, three filters, an ImgBB
 * cover, drafts that outlive a wrong turn, notifications for a new thread and a
 * new answer, a long-press reaction popup, a "see more" with no box around it,
 * one step of indentation with only the newest answer shown under it, a composer
 * with a toolbar, a top-answers filter, and a face that opens its public page.
 *
 * The checks are lexical, like every other check in this repository, and the
 * rule for writing them is the same: assert the thing that would be wrong if the
 * work were not done, not the string that happens to be in the file. Where a
 * screen and a migration have to agree — the reaction kinds, the story depth,
 * the points weights — both halves are read and compared here.
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
const FORUM_EDITOR = read('ui', 'components', 'HtmlContentEditor.kt');
const DRAFT_STORE = read('data', 'local', 'ForumDraftStore.kt');
const PORTAL_MODELS = read('data', 'portal', 'PortalModels.kt');
// The forum's HTML knowledge — what a body's words are, and what its files are —
// lives in one place of its own since the fifth pass.
const FORUM_HTML = read('data', 'portal', 'ForumHtml.kt');
const PORTAL_DTOS = read('data', 'portal', 'PortalDtos.kt');
const PORTAL_API = read('data', 'portal', 'PortalApi.kt');
const PORTAL_REPOSITORY = read('data', 'portal', 'PortalRepository.kt');
const INBOX_MODELS = read('data', 'remote', 'InboxModels.kt');
const DASHBOARD = read('ui', 'screens', 'UserDashboardScreen.kt');
const PUBLIC_PROFILE = read('ui', 'screens', 'PublicProfileScreen.kt');
const ACCOUNT_BUTTON = read('ui', 'components', 'AccountHeaderButton.kt');
const HOME_SCREEN = read('ui', 'reader', 'HomeScreen.kt');
const NAV_HOST = read('ui', 'reader', 'ReaderNavHost.kt');
const APP_MODULE = read('NinghsingCheApp.kt');
const WORKSPACE = read('ui', 'viewmodel', 'ReaderWorkspaceViewModel.kt');
const MIGRATION = readBackend('supabase', 'migrations', '030_forum_answers.sql');
const RUN_SH = readBackend('tests', 'sql', 'run.sh');
// The paging function the public profile reads its lists from (migration 033).
const PROFILE_PAGING_SQL = readBackend(
  'supabase', 'migrations', '033_profile_paging.sql');

/** The body of a data class or an object, for the few that carry derived rules. */
function typeBodyOf(source, name) {
  const at = source.indexOf(`class ${name}(`);
  assert.ok(at !== -1, `${name} is declared`);
  const open = source.indexOf('{', at);
  assert.ok(open !== -1, `${name} has a body`);
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

/** The parameter list of a declaration or a call. */
function parametersOf(source, name) {
  const at = source.indexOf(`fun ${name}(`);
  assert.ok(at !== -1, `${name}() is declared`);
  const open = source.indexOf('(', at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`${name}() has no parameter list`);
}

// ---------------------------------------------------------------------------
// 1. বিভাগসমূহ, inline
// ---------------------------------------------------------------------------

test('বিভাগসমূহ is a rail that scrolls, not a page of cards', async (t) => {
  await t.test('the rooms are drawn inside one sideways-scrolling row', () => {
    assert.match(FORUM_SCREENS, /testTag\("forum_category_rail"\)/,
      'the rail has a name a UI test can reach');
    const rail = FORUM_SCREENS.slice(
      FORUM_SCREENS.indexOf('testTag("forum_category_rail")') - 600,
      FORUM_SCREENS.indexOf('testTag("forum_category_rail")') + 200
    );
    assert.match(rail, /horizontalScroll\(rememberScrollState\(\)\)/,
      'and scrolls sideways rather than down the page');
    assert.match(rail, /categories\.forEach/,
      'one chip per room, from the overview the database sent');
  });

  await t.test('the old stack of room cards is gone, not left unused', () => {
    assert.ok(!/private fun ForumCategoryCard\(/.test(FORUM_SCREENS),
      'the card that used to stack the rooms no longer exists');
    assert.match(FORUM_SCREENS, /private fun ForumRoomChip\(/,
      'its replacement is the chip the rail draws');
  });

  await t.test('a chip carries the room and what is in it', () => {
    const chip = bodyOf(FORUM_SCREENS, 'ForumRoomChip');
    for (const field of ['category.title', 'category.description', 'category.discussions',
      'category.replies']) {
      assert.ok(chip.includes(field), `the chip shows ${field}`);
    }
    assert.match(chip, /testTag\("forum_category_\$\{category\.slug\}"\)/,
      'and is reachable by its slug');
  });
});

// ---------------------------------------------------------------------------
// 2. the three filters over সাম্প্রতিক আলোচনা
// ---------------------------------------------------------------------------

test('সাম্প্রতিক আলোচনা has its three filters', async (t) => {
  await t.test('the app knows the same three words the database does', () => {
    const orders = typeBodyOf(PORTAL_MODELS, 'ForumOverview');
    assert.match(orders, /const val ORDER_RECENT = "recent"/);
    assert.match(orders, /const val ORDER_POPULAR = "popular"/);
    assert.match(orders, /const val ORDER_OFFICIAL = "official"/);
    assert.match(orders, /val orders = listOf\(ORDER_RECENT, ORDER_POPULAR, ORDER_OFFICIAL\)/,
      'and the list is the one the transport checks against');
  });

  await t.test('the filter travels to the database, which decides what it means', () => {
    assert.match(PORTAL_REPOSITORY,
      /suspend fun forumOverview\(\s*limit: Int = 20,\s*order: String = ForumOverview\.ORDER_RECENT\s*\): Result<ForumOverview>/,
      'the call takes the order');
    assert.match(PORTAL_REPOSITORY, /"p_order" to wanted/,
      'and sends it as a word the function knows');
    assert.match(PORTAL_REPOSITORY,
      /\.takeIf \{ it in ForumOverview\.orders \}\s*\n?\s*\?\: ForumOverview\.ORDER_RECENT/,
      'an unknown word falls back to recent rather than being sent on');
    assert.match(MIGRATION, /p_order text default 'recent'/,
      'the migration takes it too');
  });

  await t.test('popular means the most answers, and the count is on the card', () => {
    assert.match(MIGRATION,
      /case when wanted = 'popular' then v\.replies_count end desc nulls last/,
      'popular orders by the number of answers');
    assert.match(MIGRATION,
      /case when wanted = 'popular' then v\.views_count end desc nulls last/,
      'and breaks a tie on the views');
    assert.match(FORUM_SCREENS, /loaded\.latest, key = \{ "latest-\$\{it\.id\}" \}/,
      'the list is the filtered one');
    const card = bodyOf(FORUM_SCREENS, 'ForumDiscussionCard');
    assert.match(card, /replies = discussion\.replies/,
      'and every card carries its answer count');
  });

  await t.test('authorised means the admin\'s own threads', () => {
    assert.match(MIGRATION, /and \(wanted <> 'official' or v\.is_official\)/,
      'the filter is a column the trigger owns');
    assert.match(MIGRATION, /create trigger forum_discussions_mark_official/,
      'set before the row is written, because a dashboard session cannot be');
    assert.match(MIGRATION, /if public\.is_dashboard_request\(\) then/,
      'sampled once, at insert');
    assert.match(PORTAL_DTOS, /@Json\(name = "is_official"\) val isOfficial: Boolean\? = null/,
      'the app reads the badge');
    assert.match(FORUM_SCREENS, /private fun OfficialBadge\(\)/,
      'and shows it');
  });

  await t.test('each filter is a chip with its own name', () => {
    for (const tag of ['forum_order_recent', 'forum_order_popular', 'forum_order_official']) {
      assert.ok(FORUM_SCREENS.includes(`testTag("${tag}")`), `${tag} exists`);
    }
    assert.match(FORUM_SCREENS, /onRefreshClick = \{ reloadToken \+= 1 \}/,
      'and there is a refresh that re-reads without leaving the screen');
  });
});

// ---------------------------------------------------------------------------
// 3. the ImgBB cover and the compact editor
// ---------------------------------------------------------------------------

test('a new thread can carry a cover, and its body has a toolbar', async (t) => {
  await t.test('the cover travels as a URL, and only as a URL', () => {
    assert.match(MIGRATION, /p_cover_image_url text default ''/,
      'the function takes it');
    assert.match(MIGRATION, /p_cover_delete_url text default ''/,
      'and the delete url the dashboard uses to clean up');
    assert.match(MIGRATION, /cover !~\* '\^https\?:\/\/'|-?/,
      'anything that is not http(s) is refused');
    assert.match(MIGRATION, /char_length\(cover\) > 600/,
      'and a URL longer than the column is refused');
  });

  await t.test('the composer uploads to ImgBB, exactly as the article composer does', () => {
    const composer = bodyOf(FORUM_SCREENS, 'NewDiscussionScreen');
    assert.match(composer, /ImgBbUploader\.uploadFromUri\(context, uri, "forum_cover_/,
      'one uploader, not a second one for the forum');
    assert.match(composer, /coverImageUrl = coverUrl/,
      'the picture is posted with the thread');
    assert.match(composer, /coverDeleteUrl = coverDeleteUrl/,
      'and its delete url is kept');
  });

  await t.test('the editor takes the two shapes it now has to take', () => {
    const params = parametersOf(FORUM_EDITOR, 'HtmlContentEditor');
    assert.match(params, /selectionPopup: Boolean = true/,
      'the article composer keeps the selection popup by default');
    assert.match(params, /compact: Boolean = false/, 'and the forum asks for the small one');
    assert.match(params, /testTag: String = "article_content"/,
      'the tag is the caller\'s now, so two editors on one screen stay distinct');
  });

  await t.test('the popup is a switch, and the forum switches it off', () => {
    assert.match(FORUM_EDITOR, /if \(\$\{selectionPopup\}\) document\.addEventListener\('selectionchange'/,
      'the page decides whether to listen for a selection at all');
    assert.match(FORUM_SCREENS, /selectionPopup = false/, 'the forum says no');
    assert.ok(!/forum.*#selbar/.test(FORUM_SCREENS), 'and never mentions the bar');
  });

  await t.test('the toolbar has the five the owner asked for, and the rest is gone', () => {
    for (const button of ['মোটা', 'বাঁকা', 'নিচে দাগ', 'তালিকা', 'ছবি যোগ']) {
      assert.ok(FORUM_EDITOR.includes(`ToolIcon("${button}"`), `${button} is in the toolbar`);
    }
    // Re-anchored for the AutoMirrored icon (icons 1.7 deprecates the filled one).
    assert.match(FORUM_EDITOR, /Icons\.AutoMirrored\.Filled\.FormatListBulleted, compact\) \{\s*run\("insertUnorderedList"\)\s*\}/,
      'the list button inserts a list');
    const compact = FORUM_EDITOR.slice(FORUM_EDITOR.indexOf('if (!compact) {'));
    assert.match(compact, /if \(!compact\)/, 'the article-only controls are conditional');
    for (const control of ['মোটা', 'বাঁকা', 'নিচে দাগ']) {
      assert.ok(FORUM_EDITOR.includes(`ToolIcon("${control}"`), `${control} stays in both`);
    }
  });

  await t.test('and the forum composer uses the compact shape', () => {
    assert.match(FORUM_SCREENS, /HtmlContentEditor\(\s*value = body,[\s\S]{0,400}?compact = true,/,
      'the new-thread editor');
    assert.match(FORUM_SCREENS, /HtmlContentEditor\(\s*value = body,[\s\S]{0,400}?compact = true,/g,
      'and the reply editor');
    const uses = FORUM_SCREENS.match(/compact = true/g) || [];
    assert.ok(uses.length >= 2, 'both composers, not just one');
  });
});

// ---------------------------------------------------------------------------
// 4. drafts
// ---------------------------------------------------------------------------

test('both composers remember what was typed until it posts', async (t) => {
  await t.test('there is one store, in the app\'s own data layer', () => {
    assert.match(DRAFT_STORE, /class ForumDraftStore\(private val context: Context\)/,
      'a store, not a field on a screen');
    assert.match(DRAFT_STORE, /data class ComposerDraft\(/);
    assert.match(DRAFT_STORE, /data class ReplyDraft\(/);
    assert.match(APP_MODULE, /lateinit var forumDraftStore: ForumDraftStore/,
      'built once with the app');
    assert.match(APP_MODULE, /forumDraftStore = ForumDraftStore\(this\)/);
  });

  await t.test('a draft survives the screen, and is cleared only by a post', () => {
    const composer = bodyOf(FORUM_SCREENS, 'NewDiscussionScreen');
    assert.match(composer, /draftStore\.composer\(\)/, 'the composer reads it back on open');
    assert.match(composer, /draftStore\.saveComposer\(/, 'and saves as it is typed');
    assert.match(composer, /draftStore\.clearComposer\(\)/, 'clearing it is a deliberate act');
    const clearAt = composer.indexOf('draftStore.clearComposer()');
    const postAt = composer.indexOf('.onSuccess { created ->');
    assert.ok(postAt !== -1 && clearAt > postAt,
      'and it happens after the database has answered, not when the button is pressed');
  });

  await t.test('the reply box is remembered per thread', () => {
    const thread = bodyOf(FORUM_SCREENS, 'ForumThreadScreen');
    assert.match(thread, /draftStore\.reply\(discussionId\)/, 'read per thread');
    assert.match(thread, /draftStore\.saveReply\(\s*discussionId,\s*ForumDraftStore\.ReplyDraft\(replyBody, replyTarget, attachments\)\s*\)/,
      'saved with the answer it was answering, and with its files');
    assert.match(thread, /draftStore\.clearReply\(discussionId\)/);
    assert.match(DRAFT_STORE, /fun reply\(discussionId: String\)/, 'the key is the thread');
  });

  await t.test('the pictures are remembered too', () => {
    for (const field of ['coverImageUrl', 'coverDeleteUrl']) {
      assert.ok(DRAFT_STORE.includes(field), `${field} is part of the draft`);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. notifications
// ---------------------------------------------------------------------------

test('a new thread and a new answer reach the bell', async (t) => {
  await t.test('the database writes both kinds', () => {
    assert.match(MIGRATION, /'forum_thread'/);
    assert.match(MIGRATION, /'forum_reply'/);
    assert.match(MIGRATION, /'নতুন আলোচনা: ' \|\| left\(new\.title, 120\)/,
      'with a Bengali title, not an English one');
    assert.match(MIGRATION, /'নতুন উত্তর: ' \|\| left\(coalesce\(thread_title, ''\), 120\)/);
    assert.match(MIGRATION, /left\(regexp_replace\(new\.body, '<\[\^>\]\*>', ' ', 'g'\), 160\)/,
      'and the post itself as the body, tags stripped');
  });

  await t.test('one row per reader per thread, and never to the author', () => {
    assert.match(MIGRATION, /p\.id <> coalesce\(new\.user_id, '00000000-0000-0000-0000-000000000000'::uuid\)/,
      'the writer is not told about their own thread');
    assert.match(MIGRATION, /who\.id <> coalesce\(new\.user_id, '00000000-0000-0000-0000-000000000000'::uuid\)/,
      'nor about their own answer');
    assert.match(MIGRATION, /and exists \(\s*select 1 from public\.profiles p\s*where p\.id = who\.id and p\.notifications_enabled/,
      'and only a reader who asked for notifications is written to');
    assert.match(MIGRATION, /on conflict \(user_id, kind, related_id\) do update/,
      'and a second answer re-arms the first row instead of adding one');
    assert.match(RUN_SH, /one row per thread/,
      'which the behaviour block in run.sh measures');
  });

  await t.test('the app knows the two kinds by name', () => {
    assert.match(INBOX_MODELS, /const val KIND_FORUM_THREAD = "forum_thread"/);
    assert.match(INBOX_MODELS, /const val KIND_FORUM_REPLY = "forum_reply"/);
    assert.match(INBOX_MODELS, /val isForum: Boolean get\(\) = isForumThread \|\| isForumReply/);
    assert.match(INBOX_MODELS, /val forumDiscussionId: String get\(\) = if \(isForum\) relatedId else ""/,
      'and the related id is the thread to open');
  });

  await t.test('a forum notice is a thread to open, not a tab to scroll', () => {
    assert.match(DASHBOARD, /if \(notice\.isForum && notice\.forumDiscussionId\.isNotBlank\(\)\) \{/,
      'openNotice hands forum notices their own route');
    assert.match(DASHBOARD, /onOpenForumThread\(notice\.forumDiscussionId\)/);
    assert.match(DASHBOARD, /notice\.isForum -> Icons\.Default\.Forum/, 'with its own icon');
    assert.match(DASHBOARD, /notice\.isForumReply -> "ফোরাম · উত্তর"/, 'and its own label');
    assert.match(DASHBOARD, /notice\.isForumThread -> "ফোরাম · আলোচনা"/);
    assert.match(NAV_HOST, /onOpenForumThread = \{ id -> navController\.navigate\(ReaderRoute\.forumThread\(id\)\) \}/,
      'and the route is wired');
  });
});

// ---------------------------------------------------------------------------
// 6. reactions
// ---------------------------------------------------------------------------

test('one tap on a reaction counts it', async (t) => {
  await t.test('the gesture is a tap on the reaction itself', () => {
    // This reverses what this file asserted in the first pass. Both the long press
    // and the popup it raised are gone: the owner's ninth correction was that
    // "reactions must not open a modal — one tap counts it, plain and simple".
    assert.ok(!FORUM_SCREENS.includes('combinedClickable'),
      'no card reacts to a long press any more');
    assert.match(FORUM_SCREENS, /\.clickable\(onClick = onCardClick\)/,
      'a tap on the card is a tap on the card');
    const row = bodyOf(FORUM_SCREENS, 'ForumReactionRow');
    for (const kind of ['REACTION_LIKE', 'REACTION_AGREE', 'REACTION_DISLIKE']) {
      assert.ok(row.includes(`onReact(ForumReply.${kind})`), `${kind} is sent by its own icon`);
    }
    // The parameter is on the signature, which `bodyOf` does not return.
    const signature = FORUM_SCREENS.slice(
      FORUM_SCREENS.indexOf('private fun ForumReactionRow('),
      FORUM_SCREENS.indexOf('private fun ForumReactionCount(')
    );
    assert.match(signature, /onReact: \(String\) -> Unit/, 'and each icon sends its kind straight out');
  });

  await t.test('there is nothing left to dismiss', () => {
    assert.ok(!FORUM_SCREENS.includes('ForumReactionDialog'), 'the popup is deleted');
    assert.ok(!FORUM_SCREENS.includes('ReactionChoice'), 'with its three choices');
    assert.ok(!/reactionTarget/.test(FORUM_SCREENS), 'and the state that held the target');
    assert.ok(!/import androidx\.compose\.ui\.window\.Dialog/.test(FORUM_SCREENS),
      'and the dialog import');
    assert.match(FORUM_SCREENS, /val reactTo: \(ForumReply, String\) -> Unit = \{ reply, kind ->\s*\n\s*scope\.launch \{/,
      'the handler goes straight to the call');
  });

  await t.test('the kinds are the three words the database knows', () => {
    for (const kind of ['REACTION_LIKE = "like"', 'REACTION_DISLIKE = "dislike"',
      'REACTION_AGREE = "agree"']) {
      assert.ok(PORTAL_MODELS.includes(kind), `${kind} is the app's`);
      assert.ok(MIGRATION.includes(`'${kind.split('"')[1]}'`), 'and the database\'s');
    }
    assert.match(MIGRATION, /if clean not in \('like', 'dislike', 'agree'\) then/,
      'which the function refuses anything else against');
  });

  await t.test('the same tap takes it back, and the counters are the database\'s', () => {
    assert.match(MIGRATION, /if existing = clean then\s*delete from public\.forum_reactions/,
      'a second tap on the same kind clears it');
    assert.match(MIGRATION, /on conflict \(reply_id, reactor_key\) do update/,
      'and another kind replaces the first');
    assert.match(PORTAL_MODELS, /val mine: String/,
      'and the app is handed back what the reader now has');
    assert.match(PORTAL_REPOSITORY, /suspend fun reactToForumReply\(/);
    assert.match(PORTAL_API, /suspend fun forumReact\(/);
  });

  await t.test('a guest may react, keyed by their device, as they may love a song', () => {
    assert.match(MIGRATION, /p_device_id text default null/);
    assert.match(MIGRATION, /md5\('ningshingche-forum:' \|\| device\)/,
      'the same shape the music love uses');
    assert.match(MIGRATION, /return md5\('ningshingche-forum:' \|\| device\);/, 'in one place');
    assert.match(MIGRATION, /if length\(coalesce\(device, ''\)\) < 8 then/,
      'and a device id too short to be one is refused');
    assert.match(PORTAL_REPOSITORY, /"p_device_id" to guestViewerId/,
      'the transport carries it, never the screen');
  });
});

// ---------------------------------------------------------------------------
// 7. আরও দেখুন, without a box
// ---------------------------------------------------------------------------

test('a long body folds behind a plain "আরও দেখুন"', async (t) => {
  await t.test('the fold is one control, drawn small and plain', () => {
    const body = bodyOf(FORUM_SCREENS, 'ForumBody');
    assert.match(body, /text = if \(expanded\) "কম দেখান" else "আরও দেখুন"/,
      'the words the owner asked for');
    const line = body.slice(body.indexOf('if (canExpand)'), body.indexOf('if (canExpand)') + 700);
    assert.ok(!/Surface\(|border\(|background\(/.test(line),
      'no surface, no border, no fill around it');
    assert.match(line, /fontSize = 13\.5\.sp/, 'and small enough not to shout');
  });

  await t.test('the fold is decided before anything is measured, at a hundred', () => {
    // The length is the length of the words: a picture used to make a body "long"
    // on the strength of its markup alone, and a post with one picture and one line
    // was folded behind a control it did not need. The number itself is the owner's
    // sixth correction: a hundred characters, which is where the ellipsis is now
    // written, not two hundred and forty.
    assert.match(PORTAL_MODELS, /internal const val FORUM_FOLD_CHARS = 100/,
      'one number for the whole app');
    assert.match(PORTAL_MODELS,
      /val isLong: Boolean get\(\) = forumBodyText\(body\)\.length > FORUM_FOLD_CHARS/,
      'a length, so a short answer never grows a control it does not need');
    assert.match(FORUM_SCREENS, /import com\.ningshingche\.app\.data\.portal\.FORUM_FOLD_CHARS/,
      'and the opening post uses the same rule');
    assert.match(FORUM_SCREENS, /private const val FORUM_FOLD_LINES = 3/,
      'three folded lines, which is about a hundred characters of Bengali');
  });

  await t.test('open, it is the article renderer — the one that can draw a picture', () => {
    assert.match(FORUM_SCREENS, /RichHtmlArticleBody\(/,
      'the same renderer the articles use');
    assert.match(FORUM_SCREENS, /HtmlFormattedText\(/,
      'and folded it is the cheap annotated string');
  });
});

// ---------------------------------------------------------------------------
// 8. one step in, and only the newest answer under it
// ---------------------------------------------------------------------------

test('answers nest one step, newest first, and fold behind a control', async (t) => {
  await t.test('the database folds a reply-to-a-reply onto its own answer', () => {
    assert.match(MIGRATION, /root := coalesce\(parent\.parent_id, parent\.id\)/,
      'so a third level can never be stored');
    assert.match(MIGRATION, /foreign key \(parent_id\)\s*references public\.forum_replies\(id\) on delete set null/,
      'even though the column is a real foreign key');
    assert.match(MIGRATION, /create index if not exists forum_replies_parent_idx/,
      'and it is indexed, because the nesting reads by it');
  });

  await t.test('the thread groups itself and shows the last answer under each one', () => {
    const thread = typeBodyOf(PORTAL_MODELS, 'ForumThread');
    assert.match(thread, /val answers: List<ForumReply> get\(\) = replies\.filter \{ it\.isTopLevel \}/);
    assert.match(thread, /fun repliesUnder\(answerId: String\)/);
    assert.match(FORUM_SCREENS, /val shown = if \(showAll\) replies else replies\.takeLast\(1\)/,
      'and the rest are behind a tap');
    assert.match(FORUM_SCREENS, /"সব উত্তর দেখুন \(\$\{toBengaliNumeral\(replies\.size\)\}\)"/,
      'which counts them');
  });

  await t.test('the indentation is one step, and it is measured once', () => {
    const nested = bodyOf(FORUM_SCREENS, 'ForumNestedReply');
    const card = bodyOf(FORUM_SCREENS, 'ForumAnswerCard');
    assert.match(card, /padding\(start = FORUM_REPLY_INDENT\)/,
      'one step in, from the answer that owns the replies');
    assert.match(FORUM_SCREENS, /private val FORUM_REPLY_INDENT = 22\.dp/, 'and it is measured once');
    assert.ok(!/padding\(start =/.test(nested),
      'the reply inside the step never steps in again');
    assert.ok(!/ForumNestedReply\(/.test(nested), 'and it never draws answers of its own');
  });
});

// ---------------------------------------------------------------------------
// 9. the composer's toolbar, and where it lives
// ---------------------------------------------------------------------------

test('the reply box is an editor, not a one-line field', async (t) => {
  await t.test('a reply is written in the editor, in its compact shape', () => {
    const composer = bodyOf(FORUM_SCREENS, 'ForumReplyComposer');
    assert.match(composer, /HtmlContentEditor\(/);
    assert.match(composer, /compact = true/);
    assert.match(composer, /testTag = "forum_reply_field"/,
      'under the name the existing UI tests use');
    assert.match(composer, /testTag\("forum_reply_submit"\)/);
  });

  await t.test('what is counted is the text, not the markup', () => {
    assert.match(FORUM_HTML, /fun forumBodyText\(html: String\): String =/,
      'one way to ask what the reader typed');
    assert.match(FORUM_HTML, /fun forumBodyMarkup\(html: String\): String =/,
      'and one way to ask what to draw, with the files taken out of it');
    assert.match(FORUM_SCREENS, /val bodyProblem = ForumText\.bodyProblem\(forumPlainText\(body\)\)/,
      'the length the database will judge is the length of the text');
    assert.match(FORUM_SCREENS, /ForumText\.replyProblem\(forumPlainText\(body\)\) == null/,
      'and the send button is enabled by the text too');
    assert.match(FORUM_SCREENS, /if \(!forumHasText\(body\)\) return@submit/,
      'so a post of empty paragraphs cannot be sent');
  });

  await t.test('the draft note and the target line are on the composer', () => {
    // The note under the box went with the second pass, which made the composer
    // a strip at the bottom of the thread; what it promised is still true, and
    // the reply list's own checks hold the draft to it.
    assert.match(FORUM_SCREENS, /draftStore\.saveReply\(/,
      'the reader is never told the draft is lost, because it is not');
    assert.match(FORUM_SCREENS, /targetName\?\.let \{ "\$it কে উত্তর" \}/,
      'and who they are answering');
    assert.match(FORUM_SCREENS, /testTag\("forum_reply_target_clear"\)/, 'with a way to take it back');
  });
});

// ---------------------------------------------------------------------------
// 10. উত্তরসমূহ, its filter, and the face that opens a page
// ---------------------------------------------------------------------------

test('উত্তরসমূহ has its own filter and its authors have pages', async (t) => {
  await t.test('শীর্ষ sorts by what the answer earned', () => {
    assert.match(PORTAL_MODELS, /const val ANSWER_TOP = "top"/);
    assert.match(PORTAL_MODELS, /const val ANSWER_RECENT = "recent"/);
    assert.match(PORTAL_MODELS, /answers\.sortedWith\(\s*compareByDescending<ForumReply> \{ it\.reactionScore \}/,
      'most liked or agreed first');
    assert.match(PORTAL_MODELS, /val reactionScore: Int get\(\) = likes \+ agrees/,
      'and disagreeing does not subtract — it is a reaction, not a vote');
    assert.match(FORUM_SCREENS, /testTag\("forum_answers_top"\)/);
    assert.match(FORUM_SCREENS, /testTag\("forum_answers_recent"\)/);
  });

  await t.test('a picture and a name open the reader\'s public page', () => {
    const author = bodyOf(FORUM_SCREENS, 'ForumAuthorRow');
    assert.match(author, /clickable\(onClick = onClick\)/, 'the whole block is the target');
    assert.match(author, /testTag\("forum_author_\$name"\)/);
    assert.match(NAV_HOST,
      /onAuthorClick = \{ id -> navController\.navigate\(ReaderRoute\.publicProfile\(id\)\) \}/,
      'and the forum sends it to the page the contributor cards already use');
    const calls = FORUM_SCREENS.match(/onAuthorClick\(/g) || [];
    assert.ok(calls.length >= 3, 'from the cards, the answers and the opening post');
  });

  await t.test('the answer card carries its author, date and reactions', () => {
    const card = bodyOf(FORUM_SCREENS, 'ForumAnswerCard');
    for (const field of ['answer.authorName', 'answer.authorAvatarUrl', 'answer.createdAt']) {
      assert.ok(card.includes(field), `the card shows ${field}`);
    }
    assert.match(card, /ForumReactionRow\(/, 'and the three counts');
    assert.match(bodyOf(FORUM_SCREENS, 'ForumAuthorRow'), /formatBengaliDate\(date\)/,
      'with the reader\'s own date format, in the shared author block');
  });
});

// ---------------------------------------------------------------------------
// The extras
// ---------------------------------------------------------------------------

test('the extras the owner asked for alongside the ten', async (t) => {
  await t.test('ফোরাম is in the account menu, and the home screen passes it on', () => {
    assert.match(ACCOUNT_BUTTON, /onForumClick: \(\) -> Unit = \{\}/, 'the menu takes it');
    assert.match(ACCOUNT_BUTTON, /testTag\("account_menu_forum"\)/, 'and it is reachable');
    assert.match(ACCOUNT_BUTTON, /Text\("ফোরাম"/, 'under its own name');
    assert.match(HOME_SCREEN, /onForumClick: \(\) -> Unit = \{\}/, 'the home screen carries it');
    assert.match(HOME_SCREEN, /onForumClick = onForumClick/, 'and hands it to the menu');
    assert.match(NAV_HOST, /onForumClick = \{ navController\.navigate\(ReaderRoute\.Forum\) \}/,
      'which opens the forum');
  });

  await t.test('the forum\'s bar is the forum\'s, and carries no bell', () => {
    // The owner first asked for the bell here and then asked for it gone; the
    // third pass is what stands, and the third pass's own file checks it in
    // detail. What matters here is that the search did not go with it.
    const scaffold = bodyOf(FORUM_SCREENS, 'ForumScaffold');
    assert.ok(!/Notifications/.test(scaffold), 'no bell on the forum');
    assert.match(scaffold, /forum_refresh/, 'a refresh instead, which a forum needs more');
  });

  await t.test('the search is not deleted — it is an icon that opens a smaller field', () => {
    assert.match(FORUM_SCREENS, /testTag\("forum_search"\)/, 'the forum is still searched');
    assert.match(FORUM_SCREENS,
      /placeholder = \{ Text\("আলোচনা খুঁজুন", fontFamily = Kalpurush, fontSize = 13\.sp\) \}/,
      'in the forum page size, not a size above it');
    assert.match(FORUM_SCREENS, /testTag\("forum_search_toggle"\)/, 'behind a magnifier in the bar');
    assert.match(NAV_HOST, /search = \{ term -> app\.portalRepository\.forumSearch\(term\) \}/,
      'through the RPC that already existed');
  });

  await t.test('the forum\'s work is on the dashboard and on the public page', () => {
    // Re-anchored for the paged section: the dashboard asks for a window it can
    // grow — five items, then "load more" — through the same call.
    assert.match(WORKSPACE, /val forum = portalRepository\.forumActivity\(user\.id, limit = forumLimit\)\.getOrNull\(\).*/,
      'the dashboard reads it with everything else it reads');
    assert.match(WORKSPACE, /_forumActivity\.value = forum/);
    assert.match(DASHBOARD, /ForumCard\(\s*activity = forumActivity,/,
      'and shows it in a card of its own');
    assert.match(FORUM_SCREENS, /fun ForumCard\(/);
    assert.match(FORUM_SCREENS, /fun ForumActivityBlock\(/, 'which the public page shares');
    // Re-anchored for the paged profile: the public page no longer takes the whole
    // activity in one call — it takes four totals and one page of five at a time,
    // which is the owner's first correction.
    assert.match(NAV_HOST, /loadTotals = \{ userId -> app\.portalRepository\.profileTotals\(userId\) \}/,
      'the public page is handed its totals');
    assert.match(NAV_HOST, /loadPage = \{ userId, kind, offset ->/,
      'and the way to ask for one page');
    assert.ok(!/loadForumActivity = \{ userId/.test(NAV_HOST),
      'and the whole-activity call is gone from the profile route');
    assert.match(PROFILE_PAGING_SQL, /create or replace function public\.profile_items\(/,
      'through a function of its own');
    assert.match(PROFILE_PAGING_SQL,
      /grant execute on function public\.profile_items\(uuid, text, integer, integer\) to anon, authenticated/,
      'which is public: a profile is readable by anyone');
    assert.match(MIGRATION, /create or replace function public\.forum_activity\(/);
    assert.match(MIGRATION, /grant execute on function public\.forum_activity\(uuid, integer\) to anon, authenticated/,
      'the function is public: a profile is readable by anyone');
  });

  await t.test('the points are the database\'s, and the forum is in them', () => {
    assert.match(MIGRATION, /greatest\(p_discussions, 0\) \* 20/,
      'a discussion is worth 20');
    assert.match(MIGRATION, /greatest\(p_replies, 0\) \* 5/, 'an answer 5');
    assert.match(MIGRATION, /greatest\(p_reactions, 0\) \* 1/, 'a reaction received 1');
    assert.match(MIGRATION, /'discussions', discussion_count\.n/);
    assert.match(MIGRATION, /'replies', forum_reply_count\.n/);
    assert.match(MIGRATION, /'reactions', reaction_count\.n/);
    assert.match(MIGRATION, /public\.contributor_points_from\(\s*article_count\.n, song_count\.n, comment_count\.n, view_count\.n, time_count\.n\s*\)/,
      'the five original inputs are still the five the app knows');
    assert.match(MIGRATION, /and x\.kind in \('like', 'agree'\)/,
      'and a dislike is shown but never paid for');
  });

  await t.test('the app shows the three new numbers without inventing weights', () => {
    assert.match(PORTAL_MODELS, /val discussions: Int = 0,\s*\n\s*val replies: Int = 0,\s*\n\s*val reactions: Int = 0/);
    assert.match(PORTAL_DTOS, /val discussions: Int\? = null/);
    assert.match(DASHBOARD, /BreakdownItem\("আলোচনা", stats\.discussions, Icons\.Default\.Forum/,
      'the dashboard names them');
    assert.match(DASHBOARD, /BreakdownItem\("উত্তর", stats\.replies, Icons\.Default\.Reply/);
    assert.ok(!/\* 20|\* 5/.test(PORTAL_MODELS),
      'and never works the arithmetic out itself');
  });

  await t.test('every table the migration can create is created behind RLS', () => {
    // The Supabase SQL editor asks before it will run a script that creates a
    // table without enabling row level security. Every table in §0 is guarded by
    // `if not exists` and exists already on a real database — but a database
    // where this file is the one that creates them must not be the one database
    // where a client can read a forum table directly.
    const created = [...MIGRATION.matchAll(/create table if not exists public\.([a-z_]+)/g)]
      .map((match) => match[1]);
    assert.ok(created.length >= 6, `the file guards the tables it reads (${created.join(', ')})`);
    for (const table of new Set(created)) {
      assert.ok(MIGRATION.includes(`alter table public.${table} enable row level security;`),
        `${table} is created with RLS enabled`);
    }
  });

  await t.test('and the drops it makes are the ones that cannot be avoided', () => {
    // The SQL editor also warns about "destructive operations". This file's are
    // four old function signatures (a new parameter makes a new function, so the
    // old ones have to go or PostgREST cannot choose) and three triggers, all
    // `if exists`, none of them touching a row.
    const drops = [...MIGRATION.matchAll(/^drop (\w+) if exists/gm)].map((match) => match[1]);
    assert.ok(drops.length > 0, 'there are drops, and they are all guarded');
    assert.deepEqual([...new Set(drops)].sort(), ['function', 'trigger'],
      'no table, view, column or policy is dropped');
    for (const table of ['forum_discussions', 'forum_replies', 'forum_categories']) {
      assert.ok(!new RegExp(`drop table[^;]*${table}`).test(MIGRATION),
        `${table} is never dropped — a drop of it would take every thread with it`);
    }
  });

  await t.test('the behaviour the migration promises is measured, not assumed', () => {
    for (const check of ['forum answers', 'official', 'forum_react', 'forum_activity',
      'one row per thread']) {
      assert.ok(RUN_SH.includes(check), `run.sh checks ${check}`);
    }
    assert.ok(RUN_SH.includes('030_forum_answers.sql'), 'the migration is in the harness');
  });
});
