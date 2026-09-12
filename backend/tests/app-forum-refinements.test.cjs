/**
 * The owner's third read of the forum, checked the same way as the first two.
 *
 * Thirteen notes came back after the second pass — spacing, a zipped room
 * section, bigger cards, icons instead of reaction words, a reply box that lives
 * at the bottom of the thread and grows with what is written in it, and pictures
 * that are attached rather than typed. Every one of them is a claim about a file,
 * and the rule for the checks is the one this repository has used throughout:
 * assert the thing that would be wrong if the work had not been done.
 *
 * The last test is the bug the owner found by using it — `invalid input syntax
 * for type uuid: ""` when an answer was sent with no answer above it. It was the
 * empty `p_parent_id` travelling to PostgREST, and it is fixed in one place.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app');
const read = (...parts) => fs.readFileSync(path.join(APP, ...parts), 'utf8');

const FORUM_SCREENS = read('ui', 'screens', 'ForumScreens.kt');
const FORUM_EDITOR = read('ui', 'components', 'HtmlContentEditor.kt');
const DRAFT_STORE = read('data', 'local', 'ForumDraftStore.kt');
const PORTAL_REPOSITORY = read('data', 'portal', 'PortalRepository.kt');
const PORTAL_MODELS = read('data', 'portal', 'PortalModels.kt');
const EDITORIAL = read('ui', 'editorial', 'EditorialComponents.kt');
const NAV_HOST = read('ui', 'reader', 'ReaderNavHost.kt');

/** A declaration's body, from its opening brace to the one that closes it. */
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

/**
 * The editor composable's own source.
 *
 * `bodyOf` starts at the first `{` after the parameter list, and the editor has a
 * default parameter that *is* a lambda — `onEditorHeightChange: (Int) -> {}` — so
 * the first brace it finds is that empty one. A slice does the job here.
 */
function editorSource() {
  const from = FORUM_EDITOR.indexOf("fun HtmlContentEditor(");
  const to = FORUM_EDITOR.indexOf("private fun ToolIcon(");
  assert.ok(from !== -1 && to > from, "the editor is declared, before its toolbar button");
  return FORUM_EDITOR.slice(from, to);
}

// ---------------------------------------------------------------------------
// 1–2. Room at the top, and the forum's own bar
// ---------------------------------------------------------------------------

test('every forum screen has room at the top, and its own back arrow', async (t) => {
  await t.test('the space is one constant, used by all four screens', () => {
    assert.match(FORUM_SCREENS, /private val FORUM_TOP_SPACE = EditorialSpace\.lg/,
      'the space is named, not a number typed four times');
    const uses = FORUM_SCREENS.match(/top = FORUM_TOP_SPACE/g) || [];
    assert.ok(uses.length >= 4,
      `the search box, a room, a thread and the composer all clear the app bar (${uses.length})`);
  });

  await t.test('ফোরাম is a page: a back arrow, and no bell', () => {
    const scaffold = screen('ForumScaffold');
    assert.match(scaffold, /testTag\("forum_back"\)/, 'the bar carries a back arrow');
    assert.match(scaffold, /onBackClick != null/, 'and shows it when the screen has somewhere to go back to');
    assert.ok(!/Notifications/.test(scaffold),
      'the bell is gone from the forum — the owner took it away');
    assert.ok(!/unreadCount|ForumUnreadBadge/.test(scaffold),
      'and the count that fed it went with it');
    assert.match(NAV_HOST, /onBackClick = \{ navController\.popBackStack\(\) \}/,
      'the forum home is handed the way back');
    assert.ok(!/onNotificationsClick = \{\s*navController\.navigate\(ReaderRoute\.dashboard\("notices"\)\)\s*\}/.test(
      NAV_HOST.slice(NAV_HOST.indexOf('ForumHomeScreen('), NAV_HOST.indexOf('ForumHomeScreen(') + 900)
    ), 'and the forum is no longer handed the dashboard notices');
  });

  await t.test('the bell itself is not deleted from the app', () => {
    // What the owner asked for was for the forum to stop carrying it — the home
    // page still has its own, and so does the account menu.
    assert.match(read('ui', 'reader', 'HomeScreen.kt'), /onNotificationsClick/,
      'the home page still knows about notices');
    const account = read('ui', 'components', 'AccountHeaderButton.kt');
    assert.match(account, /Icons\.Default\.Notifications|unreadCount/, 'and the account menu still counts them');
  });

  await t.test('the search is an icon in the bar, and the field slides out under it', () => {
    // The owner's third correction to this screen: the field was a full-width box
    // with type bigger than the page's own. The bar carries the magnifier now, and
    // the field it opens is a 48 dp line with the forum's body size.
    assert.match(FORUM_SCREENS, /testTag\("forum_search_toggle"\)/, 'the icon in the bar');
    assert.match(FORUM_SCREENS, /onSearchClick: \(\(\) -> Unit\)\? = null/,
      'which the scaffold takes');
    assert.match(FORUM_SCREENS, /searchField: \(@Composable \(\) -> Unit\)\? = null/,
      'and a slot for the field itself');
    const scaffold = screen('ForumScaffold');
    assert.match(scaffold, /AnimatedVisibility\(\s*\n\s*visible = searchOpen/, 'and what it opens animates');
    assert.match(scaffold, /expandVertically\(/, 'out from the bar');
    assert.match(scaffold, /shrinkVertically\(/, 'and back into it');
    assert.match(scaffold, /Icons\.Default\.Close/, 'the icon becomes a way to put it away');
    // Order in the actions row: the magnifier, then the reload icon.
    const search = scaffold.indexOf('forum_search_toggle');
    const refresh = scaffold.indexOf('forum_refresh');
    assert.ok(search !== -1 && refresh !== -1 && search < refresh,
      'the search sits before the reload icon, as the owner asked');
    const field = screen('ForumSearchField');
    assert.match(field, /testTag\("forum_search"\)/, 'the field is still the field');
    assert.match(field, /fontSize = 13\.sp/, 'with the forum page\'s own size, not a size above it');
    assert.ok(!/leadingIcon/.test(field), 'and no second magnifier inside it');
  });
});

// ---------------------------------------------------------------------------
// 3–4. বিভাগসমূহ: wider rooms, zipped behind a chevron
// ---------------------------------------------------------------------------

test('বিভাগসমূহ is one line that opens into wider rooms', async (t) => {
  await t.test('a room is wider than it was, and every room is the same height', () => {
    assert.match(FORUM_SCREENS, /private const val FORUM_ROOM_WIDTH = 240/,
      'the room is 240 dp across, not 184');
    assert.match(FORUM_SCREENS, /\.width\(FORUM_ROOM_WIDTH\.dp\)/);
    // The owner's correction: the cards in this rail each ended somewhere else,
    // because the descriptions are not the same length. One height, held by a
    // two-line description, is what makes the row read as a row.
    assert.match(FORUM_SCREENS, /private val FORUM_ROOM_HEIGHT = 128\.dp/,
      'and one height for all of them');
    const chip = screen('ForumRoomChip');
    assert.match(chip, /\.height\(FORUM_ROOM_HEIGHT\)/, 'which the card takes');
    assert.match(chip, /minLines = 2/, 'a short description keeps the space two lines need');
    assert.match(chip, /Spacer\(Modifier\.weight\(1f\)\)/, 'and the counters stay on the floor of the card');
  });

  await t.test('the section is zipped until it is asked for', () => {
    const section = screen('ForumRoomsSection');
    assert.match(section, /var expanded by remember \{ mutableStateOf\(false\) \}/,
      'closed on the first load, which is what the owner asked for');
    assert.match(section, /testTag\("forum_category_toggle"\)/, 'the heading is the control');
    assert.match(section, /AnimatedVisibility\(/, 'and the rooms are inside an animated section');
    assert.match(section, /expandVertically\(/, 'opening');
    assert.match(section, /shrinkVertically\(/, 'and closing');
    assert.match(section, /fadeIn\(|fadeOut\(/, 'with the display transition the owner asked for');
  });

  await t.test('the chevron points down when shut and turns as it opens', () => {
    const section = screen('ForumRoomsSection');
    assert.match(section, /Icons\.Default\.KeyboardArrowDown/, 'the chevron the owner asked for');
    assert.match(section, /graphicsLayer\(rotationZ = arrow\)/, 'and it turns rather than swapping icons');
    assert.match(section, /animateFloatAsState\(/, 'smoothly');
  });

  await t.test('the heading counts the rooms in Bengali numerals', () => {
    assert.match(FORUM_SCREENS,
      /text = "বিভাগসমূহ \(\$\{toBengaliNumeral\(categories\.size\)\}\)"/,
      'বিভাগসমূহ (৫), not a separate number floating in the row');
  });

  await t.test('the room card\'s two lines sit close, and read a size bigger', () => {
    const chip = screen('ForumRoomChip');
    assert.match(chip, /lineHeight = 15\.sp/, 'the description sets its own line height');
    assert.match(chip, /\.padding\(top = 2\.dp\)/, 'and starts a hair under the title');
    assert.match(chip, /fontSize = 16\.sp/, 'the room\'s own name, scaled up with the page');
    assert.match(chip, /fontSize = 12\.5\.sp/, 'and so is its description');
    assert.ok(!/verticalArrangement = Arrangement\.spacedBy\(EditorialSpace\.xxs\)/.test(chip),
      'the loose column spacing is gone from the card');
  });

  await t.test('a collapsed section takes more room from the top', () => {
    // The owner asked for more air above the heading when the rooms are shut: the
    // section used to start against the app bar.
    const section = screen('ForumRoomsSection');
    assert.match(section, /top = EditorialSpace\.md/, 'more above the heading');
    assert.match(section, /bottom = EditorialSpace\.xs/, 'than below it');
    assert.match(section, /fontSize = 17\.sp/, 'and the heading is a size up with the rest of the page');
  });
});

// ---------------------------------------------------------------------------
// 5–6. No explaining text, bigger titles, tighter authors
// ---------------------------------------------------------------------------

test('the filters speak for themselves, and a card reads at a glance', async (t) => {
  await t.test('the two lines of explanation are gone', () => {
    assert.ok(!FORUM_SCREENS.includes('কোন আলোচনা দেখাবে'),
      'the discussion filter says nothing under itself');
    assert.ok(!FORUM_SCREENS.includes('বেশি লাইক বা একমত'),
      'and neither does the answer filter');
  });

  await t.test('a discussion title is bigger', () => {
    const card = screen('ForumDiscussionCard');
    // A card with a picture beside it has less width for its words, so its title
    // is a size down from a full-width card's — both are bigger than the old 15.
    assert.match(card, /fontSize = if \(discussion\.hasCover\) 16\.sp else 17\.sp/,
      'the title a reader scans for');
    assert.ok(!/fontSize = 15\.sp[^]*maxLines = 2/.test(card),
      'and the old size is not left on the title');
  });

  await t.test('the face is on the left and the date is on the line under the name', () => {
    // Re-anchored for the owner's correction: the date used to sit inline beside
    // the name. It is a second line under it now, and the two lines together are
    // the height of the face they stand beside — that is what "one unit" means.
    const card = screen('ForumDiscussionCard');
    assert.match(card, /avatarSize = if \(discussion\.hasCover\) 30 else 34/,
      'a face worth looking at, a size down when a cover shares the row');
    const author = screen('ForumAuthorRow');
    const lines = author.split('\n').length;
    assert.ok(lines < 70, `the author block is small (${lines} lines)`);
    assert.match(author, /Column\(\s*\n\s*modifier = Modifier\.weight\(1f\)/,
      'the name and the date are a column, not a row');
    assert.match(author, /testTag\("forum_author_date"\)/, 'the date has a line of its own');
    assert.match(author, /lineHeight = nameSize \* 1\.15f/, 'the name sets a tight line height');
    assert.match(author, /lineHeight = 12\.sp/, 'and so does the date');
    assert.ok(!/Spacer\(Modifier\.width\(6\.dp\)\)/.test(author),
      'the inline gap is gone with the inline date');
  });

  await t.test('the same author block is on the thread, with the clock', () => {
    const answers = screen('ForumAnswerCard');
    assert.match(answers, /showTime = true/, 'an answer is read within the hour it was written');
    assert.match(screen('ForumNestedReply'), /showTime = true/, 'and so is a reply');
    assert.match(EDITORIAL, /fun formatBengaliDateTime\(iso: String\): String/,
      'the date and the clock come from one helper');
    assert.match(EDITORIAL, /১২ সেপ্টেম্বর, ৩:৪৫ অপরাহ্ণ|date\}, \$clock/, 'which reads as Bengali');
    assert.match(EDITORIAL, /if \(hour < 12\) "পূর্বাহ্ণ" else "অপরাহ্ণ"/, 'morning and afternoon named');
    const dt = bodyOf(EDITORIAL, 'formatBengaliDateTime');
    assert.match(dt, /TimeZone\.getTimeZone\("UTC"\)/, 'parsed as the UTC the database wrote');
    assert.ok(!/java\.time/.test(dt), 'and without java.time, which minSdk 24 does not have');
  });
});

// ---------------------------------------------------------------------------
// 7. Reactions are icons
// ---------------------------------------------------------------------------

test('reactions are icons on the card, and one tap counts', async (t) => {
  await t.test('the card shows the three as icons with their counts', () => {
    const row = screen('ForumReactionRow');
    for (const icon of ['Icons.Default.ThumbUp', 'Icons.Default.CheckCircle', 'Icons.Default.ThumbDown']) {
      assert.ok(row.includes(icon), `the row draws ${icon}`);
    }
    assert.match(row, /ForumReactionCount\(/, 'each one is a count beside an icon');
    const count = screen('ForumReactionCount');
    assert.match(count, /text = toBengaliNumeral\(count\)/, 'the number is shown');
    assert.match(count, /contentDescription = label/, 'and the word survives for a screen reader');
  });

  await t.test('no reaction is written out as a word on the page', () => {
    const row = screen('ForumReactionRow');
    assert.ok(!/Text\(\s*text = "(লাইক|অপছন্দ|একমত)"/.test(row),
      'the icon is the label; a row of three words under every answer is not');
    assert.ok(!FORUM_SCREENS.includes('চেপে ধরে প্রতিক্রিয়া দিন'),
      'and the hint about long-pressing is gone');
  });

  await t.test('there is no popup left to open, and no long press either', () => {
    // The owner's ninth correction, and the last word on this control: a tap on a
    // reaction is a count, not a question. The dialog and its three choices are
    // gone from the app entirely.
    assert.ok(!FORUM_SCREENS.includes('ForumReactionDialog'), 'the dialog is deleted');
    assert.ok(!FORUM_SCREENS.includes('ReactionChoice'), 'and so are its choices');
    // Re-anchored for the ninth batch, which brought a long press back for a
    // different job — see the correction's own file: it opens সম্পাদনা and মুছে ফেলুন
    // on the reader's own answer, and it never counts a reaction.
    assert.ok(!/onLongClick = \{ onReact/.test(FORUM_SCREENS),
      'nothing reacts to a long press any more');
    assert.match(FORUM_SCREENS, /onLongClick = if \(answer\.isMine\)/,
      'the long press belongs to the author of the answer');
    assert.ok(!/reactionTarget/.test(FORUM_SCREENS), 'and the screen keeps no reaction to open');
    assert.ok(!/import androidx\.compose\.ui\.window\.Dialog/.test(FORUM_SCREENS),
      'the dialog import went with it');
  });
});

// ---------------------------------------------------------------------------
// 8. The reply box, at the bottom, and the keyboard
// ---------------------------------------------------------------------------

test('the reply box is a strip at the bottom of the thread', async (t) => {
  await t.test('it is the screen\'s bottomBar, not an item in the list', () => {
    assert.match(FORUM_SCREENS, /bottomBar = \{/, 'the thread passes a bottom bar');
    assert.match(FORUM_SCREENS, /bottomBar: \(@Composable \(\) -> Unit\)\? = null/,
      'and the scaffold knows how to place one');
    assert.match(FORUM_SCREENS, /ForumReplyComposer\(/, 'the composer is what it draws');
  });

  await t.test('it rises with the keyboard', () => {
    const composer = screen('ForumReplyComposer');
    assert.match(composer, /\.imePadding\(\)/, 'the keyboard lifts the strip rather than covering it');
    assert.match(composer, /\.navigationBarsPadding\(\)/, 'and the gesture bar does not sit on it');
    assert.match(composer, /shadowElevation = 8\.dp|tonalElevation = 3\.dp/,
      'it is visibly above the thread it belongs to');
  });

  await t.test('it starts small, not the height of a page', () => {
    assert.match(FORUM_SCREENS, /private const val FORUM_COMPOSER_HEIGHT = 96/,
      'a reply is usually a line or two');
    assert.match(FORUM_SCREENS, /private const val FORUM_COMPOSER_MAX = 240/,
      'and it stops growing well before the thread does');
    const composer = screen('ForumReplyComposer');
    assert.match(composer, /editorHeight = FORUM_COMPOSER_HEIGHT/);
    assert.match(composer, /maxGrow = FORUM_COMPOSER_MAX/);
  });

  await t.test('the toolbar buttons are smaller in the strip', () => {
    const tool = FORUM_EDITOR.slice(
      FORUM_EDITOR.indexOf('private fun ToolIcon('),
      FORUM_EDITOR.indexOf('private class HtmlBridge(')
    );
    assert.match(tool, /compact: Boolean = false/, 'the button knows its shape');
    assert.match(tool, /Modifier\.size\(if \(compact\) 30\.dp else 40\.dp\)/, 'a 30 dp button');
    assert.match(tool, /Modifier\.size\(if \(compact\) 16\.dp else 20\.dp\)/, 'with a 16 dp icon');
  });

  await t.test('Back puts the keyboard away first', () => {
    assert.match(FORUM_SCREENS, /BackHandler\(enabled = keyboardUp\) \{ editor\.dismiss\(\) \}/,
      'the thread intercepts Back only while the keyboard is up');
    // Re-anchored: `WindowInsets.ime` is a composable getter, so it is read in
    // composition and the plain `getBottom` call is what the derived state sees.
    assert.match(FORUM_SCREENS, /val ime = WindowInsets\.ime/,
      'the insets are read where a composable read is allowed');
    assert.match(FORUM_SCREENS, /derivedStateOf \{ ime\.getBottom\(density\) > 0 \}/,
      'and only then');
  });

  await t.test('and a tap outside the editor does the same', () => {
    assert.match(FORUM_SCREENS, /detectTapGestures\(onTap = \{ editor\.dismiss\(\) \}\)/,
      'a tap no control claimed');
    const cards = (FORUM_SCREENS.match(/onClick = onCardClick/g) || []).length;
    assert.ok(cards >= 2, 'and a tap on a card, which does claim its own taps');
  });

  await t.test('the editor can actually put the keyboard away', () => {
    const controller = FORUM_EDITOR.slice(
      FORUM_EDITOR.indexOf('class HtmlEditorController'),
      FORUM_EDITOR.indexOf('private const val EDITOR_MIN_HEIGHT')
    );
    assert.match(controller, /fun dismiss\(\)/, 'the handle the screen holds');
    const hide = FORUM_EDITOR.slice(
      FORUM_EDITOR.indexOf('controller?.hideKeyboard = {'),
      FORUM_EDITOR.indexOf('controller?.hideKeyboard = {') + 700
    );
    assert.match(hide, /document\.activeElement\.blur/, 'the page lets go of the caret');
    assert.match(hide, /hideSoftInputFromWindow/, 'and the input method is told to go');
  });
});

// ---------------------------------------------------------------------------
// 9–11. One card per answer, and room above the box
// ---------------------------------------------------------------------------

test('an answer and its replies are one card', async (t) => {
  await t.test('the replies are drawn inside the answer', () => {
    const card = screen('ForumAnswerCard');
    assert.ok(card.includes('ForumNestedReply('),
      'the answers to an answer are drawn by the answer card itself');
    assert.match(card, /Hairline\(\)/, 'under a hairline, so the two are still distinct');
  });

  await t.test('the indent is deeper, named once, and applied once', () => {
    assert.match(FORUM_SCREENS, /private val FORUM_REPLY_INDENT = 22\.dp/,
      'the owner asked for more indent than the first pass had');
    const card = screen('ForumAnswerCard');
    assert.equal((card.match(/padding\(start = FORUM_REPLY_INDENT\)/g) || []).length, 2,
      'the replies block and its "more answers" line both step in');
    const nested = screen('ForumNestedReply');
    assert.ok(!/padding\(start =/.test(nested),
      'and a nested reply never steps in again — one step is the rule, in the database too');
  });

  await t.test('a line down their left says they belong to the answer', () => {
    const card = screen('ForumAnswerCard');
    assert.match(card, /drawBehind \{/, 'a drawn line');
    assert.match(card, /drawRoundRect\(/, 'down the left of the reply block');
    assert.match(card, /color = tokens\.accentSoft/, 'in the app\'s own muted accent');
  });

  await t.test('the thread leaves room between the answers and the box', () => {
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /bottom = EditorialSpace\.lg/,
      'the last answer clears the strip that is about to rise under it');
    assert.match(thread, /item \{ Spacer\(Modifier\.height\(EditorialSpace\.sm\)\) \}/,
      'and there is a closing gap above it');
  });
});

// ---------------------------------------------------------------------------
// 12–13. The editor grows, and pictures are attached
// ---------------------------------------------------------------------------

test('the editor grows with the writing and pictures are attached, not typed', async (t) => {
  await t.test('the box measures the writing and grows to fit it', () => {
    assert.match(FORUM_EDITOR, /var contentHeight by remember \{ mutableIntStateOf\(0\) \}/,
      'the measured height is state');
    assert.match(FORUM_EDITOR, /val height = maxOf\(baseHeight, contentHeight\)\.coerceAtMost\(maxGrow\)/,
      'the box is the taller of what the caller asked for and what has been written');
    assert.match(FORUM_EDITOR, /if \(autoGrow\) contentHeight = measured\.coerceIn\(0, 720\)/,
      'fed by the page');
    assert.match(FORUM_EDITOR, /function grow\(\)\{ if \(window\.Android && Android\.onHeight\)/,
      'which reports it as it is typed');
    // The listener takes the event now — it reads `isComposing` off it — and does
    // the same two things it always did: report the words, report the height.
    assert.match(FORUM_EDITOR, /e\.addEventListener\('input', function\(ev\)\{[\s\S]{0,420}emit\(\);\s*grow\(\);\s*\}\)/,
      'on every keystroke');
    assert.match(FORUM_EDITOR, /fun onHeight\(px: Int\)/, 'across the bridge');
  });

  await t.test('and it scrolls inside itself beyond the ceiling', () => {
    assert.match(FORUM_EDITOR, /#e \{ min-height:100%; padding:14px 14px 56px; outline:none; line-height:1\.65;/,
      'the writing area is the whole page');
    assert.match(FORUM_EDITOR, /html,body \{ margin:0; padding:0; background:\$bg; color:\$fg; font-size:16px; height:100%;/,
      'inside a viewport that scrolls');
    assert.match(FORUM_EDITOR, /maxGrow: Int = if \(compact\) 260 else 720/, 'with a ceiling per shape');
  });

  await t.test('a file is attached on the row under the box, never over it', () => {
    const editor = editorSource();
    // The editor is an editor: the strip that used to sit above its toolbar is
    // gone, and with it the parameters that fed it.
    assert.ok(!/attachments: List<String>/.test(editor), 'the editor holds no files of its own');
    assert.ok(!/onAttachImage/.test(editor), 'and does not open the picker');
    assert.ok(!/editor_attachment/.test(editor), 'so nothing is drawn over the formatting row');
  });

  await t.test('the compact editor never inserts a file into the body', () => {
    const editor = editorSource();
    assert.ok(!/compact[\s\S]{0,200}insertImageUrl/.test(
      editor.slice(0, editor.indexOf('fun insertImageUrl'))
    ), 'nothing in the compact path inserts an image');
    assert.ok(!/ছবি সংযুক্ত করুন/.test(editor), 'and the compact row has no picture button at all');
    const row = screen('ForumAttachmentRow');
    assert.match(row, /Icons\.Default\.AttachFile/, 'the paperclip is where files are added');
    assert.ok(!/Text\(\s*text = "ছবি"/.test(row), 'with no word beside it');
    assert.match(row, /ForumAttachmentUploader\.canAdd\(attachments\.size\)/,
      'and it stops at the fifth file');
  });

  await t.test('the post carries its files out through one door', () => {
    // An expression body, so the slice runs from the declaration to what follows
    // it; `bodyOf` would have stopped at the `if`'s own brace.
    const forumHtml = read('data', 'portal', 'ForumHtml.kt');
    const from = forumHtml.indexOf('fun forumWithAttachments(');
    const attach = forumHtml.slice(from, forumHtml.indexOf('/**', from));
    assert.match(attach, /"<p><img src=/, 'an image tag is built on the way out');
    assert.match(attach, /"<p><a href=/, 'and a document is a labelled link');
    assert.match(attach, /attachment\.label\.replace\("\\"", ""\)/,
      'named by the file the reader picked');
    assert.match(FORUM_SCREENS,
      /postReply\(discussionId, forumWithAttachments\(body, attachments\), replyTarget\)/,
      'and that is what the database is handed');
    assert.match(FORUM_SCREENS,
      /post\(\s*categorySlug,\s*title,\s*forumWithAttachments\(body, attachments\),/,
      'a new thread sends its files the same way');
  });

  await t.test('the attachments survive a wrong turn', () => {
    assert.match(DRAFT_STORE, /val attachments: List<ForumAttachment> = emptyList\(\)/,
      'they are part of the draft');
    assert.match(DRAFT_STORE, /put\("attachments", draft\.attachments\.toJsonArray\(\)\)/, 'written with it');
    assert.match(DRAFT_STORE, /json\.optJSONArray\("attachments"\)\.toAttachments\(\)/, 'and read back');
    assert.match(DRAFT_STORE, /optJSONArray\("images"\)\.toStringList\(\)\.map\(::attachmentFromUrl\)/,
      'including a draft written before the app took PDFs');
    assert.match(PORTAL_MODELS, /val sizeBytes: Long = 0L/,
      'and the name and the size a chip is drawn from are on the model');
  });

  await t.test('the toolbar is the four the owner listed', () => {
    const editor = editorSource();
    for (const button of ['মোটা', 'বাঁকা', 'তালিকা']) {
      assert.ok(editor.includes(`ToolIcon("${button}",`), `${button} is in the toolbar`);
    }
    // Re-anchored for the AutoMirrored icon (icons 1.7 deprecates the filled one).
    assert.match(editor, /Icons\.AutoMirrored\.Filled\.FormatListBulleted, compact\) \{\s*run\("insertUnorderedList"\)\s*\}/,
      'the list button inserts a list');
    assert.match(editor, /Icons\.Default\.FormatBold, compact\)/,
      'the bold button is the small one when the box is the small one');
  });
});

// ---------------------------------------------------------------------------
// The bug the owner found: `invalid input syntax for type uuid: ""`
// ---------------------------------------------------------------------------

test('an empty uuid is never sent to PostgREST', async (t) => {
  await t.test('one rule, next to the transport', () => {
    assert.match(PORTAL_REPOSITORY,
      /private fun Map<String, String>\.withoutBlanks\(\): Map<String, String> =\s*\n\s*filterValues \{ it\.isNotBlank\(\) \}/,
      'a parameter with nothing in it is a parameter the call does not need');
    assert.match(PORTAL_REPOSITORY, /uuid = ''` is a cast error,\s*\n\s*\/\/ not a missing parent/,
      'and the reason is written where the next reader will find it');
  });

  await t.test('the reply drops its empty parent — this is the bug', () => {
    const reply = PORTAL_REPOSITORY.slice(
      PORTAL_REPOSITORY.indexOf('suspend fun forumReply('),
      PORTAL_REPOSITORY.indexOf('suspend fun forumReply(') + 1400
    );
    assert.match(reply, /"p_parent_id" to parentId\.trim\(\)/,
      'a parent is still sent when the answer has one');
    assert.match(reply, /\)\.withoutBlanks\(\)/, 'and an empty one is dropped');
  });

  await t.test('and so does every other call that takes a uuid or an id', () => {
    for (const call of ['forumDiscussion', 'forumReact', 'forumCreateDiscussion']) {
      const at = PORTAL_REPOSITORY.indexOf(`api.${call}(`);
      assert.ok(at !== -1, `${call} is called`);
      const dropped = PORTAL_REPOSITORY.indexOf('withoutBlanks()', at);
      assert.ok(dropped !== -1 && dropped - at < 600,
        `${call} drops its blanks too (${dropped - at} characters after the call)`);
    }
  });

  await t.test('the models still carry what the fix depends on', () => {
    assert.match(PORTAL_MODELS, /val parentId: String,/, 'an answer knows its parent');
    assert.match(PORTAL_MODELS, /val isTopLevel: Boolean get\(\) = parentId\.isBlank\(\)/);
  });
});
