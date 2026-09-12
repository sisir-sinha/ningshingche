/**
 * The ninth batch, second half: an answer that is the reader's own.
 *
 * Four things were asked for, and each one is a claim about a file:
 *
 *  * an answer written by the dashboard is marked অ্যাডমিন, on the right of its
 *    own header, with a background and in colour;
 *  * a reader can change or remove **their own** answer, by a long tap;
 *  * nobody else's answer offers either — not another reader's, and not the
 *    dashboard's, which has no reader behind it at all;
 *  * and the forum's cards are one shape: the counters inline at the right of the
 *    category, two lines of title and one of summary beside a picture, and every
 *    card the same height.
 *
 * The database half is `034_forum_reply_edit.sql`, which is read here the way the
 * app reads it: the same checks the function makes are asserted against the SQL,
 * and the app is asserted to send nothing it cannot make.
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
const PORTAL_MODELS = read('data', 'portal', 'PortalModels.kt');
const PORTAL_DTOS = read('data', 'portal', 'PortalDtos.kt');
const PORTAL_API = read('data', 'portal', 'PortalApi.kt');
const PORTAL_REPOSITORY = read('data', 'portal', 'PortalRepository.kt');
const NAV_HOST = read('ui', 'reader', 'ReaderNavHost.kt');
const MIGRATION = readBackend('supabase', 'migrations', '034_forum_reply_edit.sql');
const API_JS = readBackend('assets', 'js', 'api.js');

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

/** The slice of a screen between two landmarks, for a claim about one part of it. */
function between(source, from, to, name) {
  const at = source.indexOf(from);
  assert.ok(at !== -1, `${name}: ${from} is there`);
  const end = source.indexOf(to, at);
  assert.ok(end > at, `${name}: ${to} comes after it`);
  return source.slice(at, end);
}

// ---------------------------------------------------------------------------
// 1. The database: an answer is its author's
// ---------------------------------------------------------------------------

test('an answer belongs to the reader who wrote it', async (t) => {
  await t.test('the migration needs the two migrations under it, and says so', () => {
    assert.match(MIGRATION, /to_regclass\('public\.forum_replies'\) is not null/,
      'the table is checked before it is used');
    assert.match(MIGRATION, /a\.attname = 'is_official'/,
      'and the editorial column with it');
    assert.match(MIGRATION,
      /raise notice '034_forum_reply_edit\.sql needs 029_forum\.sql, 030_forum_answers\.sql and 032_forum_editorial\.sql first/,
      'a database that has not run them is told, not half-changed');
    assert.match(MIGRATION, /^begin;/m, 'and the whole file is one transaction');
    assert.match(MIGRATION, /^commit;/m, 'which is closed');
  });

  await t.test('the thread hands back what is the reader\'s', () => {
    assert.match(MIGRATION,
      /\(v\.author_id is not null and v\.author_id = auth\.uid\(\)\) as is_mine,/,
      'is_mine is asked of the row, not guessed by the app');
    const mentions = MIGRATION.match(/as is_mine/g) || [];
    assert.ok(mentions.length >= 3,
      `every reply the app reads carries it (${mentions.length} of them)`);
    assert.match(MIGRATION, /v\.is_official,/,
      'and the editorial mark comes from the view that has had it since 032');
    assert.match(PORTAL_MODELS, /val isOfficial: Boolean = false/,
      'the app models it');
    assert.match(PORTAL_MODELS, /val isMine: Boolean = false/,
      'and models this too');
    assert.match(PORTAL_MODELS, /isMine = isMine == true/,
      'mapped strictly: a missing field is not a claim');
    assert.match(PORTAL_DTOS, /@Json\(name = "is_official"\) val isOfficial: Boolean\? = null/,
      'from a nullable DTO field');
    assert.match(PORTAL_DTOS, /@Json\(name = "is_mine"\) val isMine: Boolean\? = null/,
      'for both of them');
  });

  await t.test('only the author may change it, and the database is the one who says so', () => {
    assert.match(MIGRATION, /if auth\.uid\(\) is null then/,
      'a signed-out reader cannot reach either function');
    const refusals = MIGRATION.match(/reply\.user_id is null or reply\.user_id <> auth\.uid\(\)/g) || [];
    assert.equal(refusals.length, 2, 'both functions refuse anybody else\'s answer');
    assert.match(MIGRATION, /errcode = '42501'/, 'with the permission error');
    assert.match(MIGRATION,
      /an answer is edited by the reader who wrote it/,
      'and a message that says which one it was');
    assert.match(MIGRATION,
      /an answer is deleted by the reader who wrote it/);
    assert.match(MIGRATION,
      /execute 'grant execute on function public\.forum_edit_reply\(uuid, text\) to authenticated'/,
      'the grant is to signed-in readers');
    assert.match(MIGRATION,
      /execute 'revoke execute on function public\.forum_edit_reply\(uuid, text\) from anon'/,
      'and the anonymous key is refused');
    assert.match(MIGRATION,
      /execute 'revoke execute on function public\.forum_delete_reply\(uuid\) from anon'/);
  });

  await t.test('an edit changes the words and nothing else', () => {
    assert.match(MIGRATION, /set body = clean_body/,
      'the body, and nothing beside it');
    assert.match(MIGRATION, /-- `author_name` and `is_official` are not touched here/,
      'the name and the mark are the guard trigger\'s, from 032');
    assert.match(MIGRATION,
      /public\.forum_text_units\(public\.forum_plain_text\(clean_body\)\) < 1/,
      'an answer of empty paragraphs is not an answer');
    assert.match(MIGRATION, /char_length\(public\.forum_plain_text\(clean_body\)\) > 4000/,
      'and the length is the text\'s, not the markup\'s');
    assert.match(MIGRATION, /create or replace function public\.forum_edit_reply\(\s*p_id uuid,\s*p_body text\s*\)/,
      'two arguments: which answer, and what it now says');
  });

  await t.test('a delete is a removal, and the argument under it stays whole', () => {
    assert.match(MIGRATION, /set status = 'Removed'/,
      'the row is kept, so the dashboard can still see it');
    assert.match(MIGRATION,
      /update public\.forum_replies c\s*\n\s*set parent_id = reply\.parent_id/,
      'the answers written under it are handed to the answer it answered');
    assert.match(MIGRATION, /where c\.parent_id = reply\.id\s*\n\s*and c\.status = 'Publish'/,
      'only the ones still in the thread');
    assert.match(MIGRATION, /'answers_moved', moved/,
      'and the answer says how many moved');
    assert.match(MIGRATION, /create or replace function public\.forum_delete_reply\(p_id uuid\)/,
      'one argument: which answer');
  });

  await t.test('the dashboard is told to run it', () => {
    assert.match(API_JS, /forum: \['backend\/supabase\/migrations\/029_forum\.sql', 'backend\/supabase\/migrations\/030_forum_answers\.sql', 'backend\/supabase\/migrations\/032_forum_editorial\.sql', 'backend\/supabase\/migrations\/034_forum_reply_edit\.sql'\]/,
      'the forum probe carries the file that adds the two marks');
    assert.equal((API_JS.match(/034_forum_reply_edit\.sql/g) || []).length, 2,
      'and so does the replies probe');
  });
});

// ---------------------------------------------------------------------------
// 2. The app: the two doors
// ---------------------------------------------------------------------------

test('the app can change and remove one of its reader\'s answers', async (t) => {
  await t.test('the call goes to the function by name', () => {
    assert.match(PORTAL_API, /@POST\("rpc\/forum_edit_reply"\)/);
    assert.match(PORTAL_API, /@POST\("rpc\/forum_delete_reply"\)/);
    assert.match(PORTAL_API, /suspend fun forumEditReply\(\s*@Body body: Map<String, String>\s*\): Response<ForumReplyDto\?>/,
      'an edit answers with the answer as it now is');
    assert.match(PORTAL_API, /suspend fun forumDeleteReply\(\s*@Body body: Map<String, String>\s*\): Response<ForumReplyDeletionDto\?>/,
      'a delete answers with what the database did');
  });

  await t.test('the repository sends the id and the body, never the author', () => {
    const edit = bodyOf(PORTAL_REPOSITORY, 'editForumReply');
    assert.match(edit, /"p_id" to clean/, 'which answer');
    assert.match(edit, /"p_body" to body\.trim\(\)/, 'and what it now says');
    assert.ok(!/user_id|author_name/.test(edit),
      'the author is the database\'s to check, not the app\'s to claim');
    assert.match(PORTAL_REPOSITORY, /suspend fun editForumReply\(\s*replyId: String,\s*body: String\s*\): Result<ForumReply>/);
    const remove = bodyOf(PORTAL_REPOSITORY, 'deleteForumReply');
    assert.match(remove, /"p_id" to clean/);
    assert.match(PORTAL_REPOSITORY, /suspend fun deleteForumReply\(replyId: String\): Result<Boolean>/);
    assert.match(remove, /dto\?\.id\?\.isNotBlank\(\) == true/,
      'true only when the database named the answer it removed');
  });

  await t.test('what the delete did is a type of its own', () => {
    assert.match(PORTAL_DTOS, /data class ForumReplyDeletionDto\(/);
    assert.match(PORTAL_DTOS, /@Json\(name = "discussion_id"\) val discussionId: String\? = null/);
    assert.match(PORTAL_DTOS, /@Json\(name = "parent_id"\) val parentId: String\? = null/);
    assert.match(PORTAL_DTOS, /@Json\(name = "answers_moved"\) val answersMoved: Int\? = null/,
      'including how many answers were handed up');
    assert.match(PORTAL_MODELS, /fun without\(replyId: String\): ForumThread =\s*\n\s*copy\(replies = replies\.filterNot \{ it\.id == replyId \}\)/,
      'and the thread can drop one without reading itself again');
  });

  await t.test('the screen is handed both, and the nav host is where they come from', () => {
    assert.match(FORUM_SCREENS, /editReply: suspend \(String, String\) -> Result<ForumReply>,/,
      'the screen takes an edit');
    assert.match(FORUM_SCREENS, /deleteReply: suspend \(String\) -> Result<Boolean>,/,
      'and a delete');
    assert.match(NAV_HOST,
      /editReply = \{ replyId, body ->\s*\n\s*app\.portalRepository\.editForumReply\(replyId, body\)\s*\n\s*\}/,
      'wired to the repository');
    assert.match(NAV_HOST,
      /deleteReply = \{ replyId -> app\.portalRepository\.deleteForumReply\(replyId\) \}/);
  });
});

// ---------------------------------------------------------------------------
// 3. The gesture: a long tap on your own answer
// ---------------------------------------------------------------------------

test('the long tap is the author\'s, and it opens two actions', async (t) => {
  await t.test('the card offers it only on the reader\'s own answer', () => {
    const card = screen('ForumAnswerCard');
    assert.match(card, /\.combinedClickable\(\s*\n\s*onLongClick = if \(answer\.isMine\) \{/,
      'the long press is answered by what the database said was ours');
    assert.match(card, /onClick = onCardClick/,
      'and a tap on the card is still only a tap');
    const nested = screen('ForumNestedReply');
    assert.match(nested, /onLongClick = if \(reply\.isMine\) \{/,
      'a reply is the same answer, one indent down');
    assert.ok(!/onLongClick = \{ onReact/.test(FORUM_SCREENS),
      'and nothing reacts from a long press');
  });

  await t.test('what opens is two rows inside the answer, not a window', () => {
    const actions = screen('ForumAnswerActions');
    assert.match(actions, /testTag\("forum_answer_actions"\)/);
    assert.match(actions, /testTag\("forum_answer_edit"\)/, 'সম্পাদনা');
    assert.match(actions, /testTag\("forum_answer_delete"\)/, 'মুছে ফেলুন');
    assert.match(actions, /testTag\("forum_answer_delete_yes"\)/, 'হ্যাঁ');
    assert.match(actions, /testTag\("forum_answer_delete_no"\)/, 'না');
    assert.match(actions, /confirming/,
      'the second press is what removes it');
    assert.ok(!/AlertDialog|Dialog\(/.test(actions), 'and it is not a dialog');
    assert.match(screen('ForumAnswerCard'), /if \(replyActions\.openId == answer\.id\) \{/,
      'the answer draws it under itself');
  });

  await t.test('the thread keeps one holder for who may act, and what is open', () => {
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /var actionsOpen by remember \{ mutableStateOf\(""\) \}/);
    assert.match(thread, /var confirmDelete by remember \{ mutableStateOf\(""\) \}/);
    assert.match(thread, /val replyActions = ForumReplyActions\(/);
    assert.match(thread, /onLongPress = \{ reply -> actionsOpen = if \(actionsOpen == reply\.id\) "" else reply\.id \}/,
      'a second long press puts the actions away again');
    assert.match(thread, /replyActions = replyActions/, 'handed to the answer cards');
  });
});

// ---------------------------------------------------------------------------
// 4. The edit: the same box, with the answer in it
// ---------------------------------------------------------------------------

test('an edit is written in the thread\'s own box', async (t) => {
  await t.test('the box opens with the answer already in it', () => {
    const start = between(FORUM_SCREENS, 'val startEditing: (ForumReply) -> Unit = { reply ->',
      'val closeComposer', 'startEditing');
    assert.match(start, /editing = reply/, 'the answer is the box\'s subject');
    assert.match(start, /replyBody = reply\.body/, 'with its words in it');
    assert.match(start, /attachments = emptyList\(\)/, 'and no files carried over');
    assert.match(start, /composerOpen = true/, 'and the box is out');
    assert.match(FORUM_SCREENS, /body = replyBody,/,
      'and the box holds it the way it holds anything typed: as its value, which the'
      + ' editor takes when the reader is not in it');
    assert.ok(!/editor\.setHtml|webView\.evaluateJavascript/.test(FORUM_SCREENS),
      'never by reaching into the page');
  });

  await t.test('the box knows what it is doing, and says so', () => {
    assert.match(FORUM_SCREENS, /fun ForumReplyComposer\(/);
    assert.match(FORUM_SCREENS, /editing -> "উত্তর সম্পাদনা"/,
      'the line above the box names the job');
    assert.match(FORUM_SCREENS, /testTag\("forum_reply_box_label"\)/,
      'and a UI test can read it');
    assert.match(FORUM_SCREENS, /editing = editing != null,/,
      'the box is told, by the screen, whether this is an edit');
  });

  await t.test('sending an edit goes through its own door', () => {
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /editing\?\.let \{ target ->/,
      'the submit knows an edit when it has one');
    assert.match(thread, /editReply\(target\.id, forumWithAttachments\(body, attachments\)\)/,
      'and calls the edit, with the words the reader typed');
    assert.match(thread, /holder\.thread = holder\.thread\?\.with\(changed\)/,
      'the answer the database answered with replaces the one on the screen');
    assert.match(thread, /replyError = failure\.message \?: "সম্পাদনা সংরক্ষণ হয়নি।"/,
      'a refusal is said where the reader is typing');
    assert.ok(!/draftStore\.clearReply\(discussionId\)[\s\S]{0,200}editing/.test(thread),
      'and an edit is not a post: nothing is cleared as if one had been made');
  });

  await t.test('the draft store is left alone while an answer is being edited', () => {
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /if \(editing != null\) return@LaunchedEffect/,
      'half an edit is not a draft, and must not come back as one');
    assert.match(thread, /LaunchedEffect\(replyBody, replyTarget, attachments, discussionId, isSignedIn, editing\)/,
      'the effect is keyed on it, so the guard is read again');
    assert.match(thread, /val openComposer: \(String\) -> Unit = \{ parentId ->[\s\S]{0,200}editing = null/,
      'and opening the box fresh always drops the edit that was in it');
  });
});

// ---------------------------------------------------------------------------
// 5. The delete: off the screen first, the truth behind it
// ---------------------------------------------------------------------------

test('removing an answer takes it off the screen and reads the thread again', async (t) => {
  await t.test('the answer goes, and the thread is asked the shape it left', () => {
    const remove = between(FORUM_SCREENS, 'val removeAnswer: (ForumReply) -> Unit = { reply ->',
      'val replyActions = ForumReplyActions(', 'removeAnswer');
    assert.match(remove, /deleteReply\(reply\.id\)/);
    assert.match(remove, /holder\.thread = holder\.thread\?\.without\(reply\.id\)/,
      'off the screen at once: the reader pressed a button');
    assert.match(remove, /loadThread\(discussionId, false\)\.getOrNull\(\)/,
      'then read again, because only the database knows where the answers under it went');
    assert.match(remove, /loadThread\(discussionId, false\)/,
      'and the re-read does not count a second view');
    assert.match(remove, /if \(!deleting\)/, 'two presses are still one removal');
    assert.match(remove, /Toast\.makeText\(/, 'a refusal is said out loud, where the row was');
  });

  await t.test('removing the answer being edited closes the box', () => {
    const remove = between(FORUM_SCREENS, 'val removeAnswer: (ForumReply) -> Unit = { reply ->',
      'val replyActions = ForumReplyActions(', 'removeAnswer');
    assert.match(remove, /if \(editing\?\.id == reply\.id\) closeComposer\(\)/,
      'there is nothing left to edit');
    const close = FORUM_SCREENS.slice(
      FORUM_SCREENS.indexOf('val closeComposer: () -> Unit = {'),
      FORUM_SCREENS.indexOf('val closeComposer: () -> Unit = {') + 400
    );
    assert.match(close, /composerOpen = false/);
    assert.match(close, /editing = null/);
    assert.match(close, /editor\.dismiss\(\)/);
  });
});

// ---------------------------------------------------------------------------
// 6. অ্যাডমিন on the right of the header
// ---------------------------------------------------------------------------

test('an answer the dashboard wrote says so', async (t) => {
  await t.test('the mark is a badge, in colour, on a background', () => {
    const badge = screen('AdminBadge');
    assert.match(badge, /text = "অ্যাডমিন"/, 'the word the owner asked for');
    assert.match(badge, /\.background\(tokens\.accentSoft\)/, 'on a fill of its own');
    assert.match(badge, /tint = tokens\.accent/, 'in the accent colour');
    assert.match(badge, /Icons\.Default\.Verified/, 'with a mark a reader reads at a glance');
    assert.match(badge, /testTag\("forum_admin_badge"\)/);
  });

  await t.test('it is drawn on the right of the answer\'s own header', () => {
    const header = between(screen('ForumAnswerCard'), 'ForumAuthorRow(', 'ForumBody(',
      'an answer');
    assert.match(header, /if \(answer\.isOfficial\) \{\s*\n\s*AdminBadge\(\)/,
      'after the face and the name');
    assert.match(header, /modifier = Modifier\.weight\(1f\)/,
      'which is what puts the badge at the far end of the row');
    const nested = between(screen('ForumNestedReply'), 'ForumAuthorRow(', 'ForumBody(',
      'a reply');
    assert.match(nested, /if \(reply\.isOfficial\) \{\s*\n\s*AdminBadge\(\)/,
      'and a reply it wrote carries it too');
  });

  await t.test('it is not the reader\'s own mark, and the two never mix', () => {
    const badge = screen('AdminBadge');
    assert.ok(!/isMine/.test(badge),
      'the badge is about who wrote it, not about who is reading');
    assert.match(screen('ForumAnswerCard'), /answer\.isOfficial/,
      'drawn from the editorial fact');
    assert.match(screen('ForumAnswerCard'), /answer\.isMine/,
      'while the actions are drawn from the reader\'s');
  });
});

// ---------------------------------------------------------------------------
// 6b. A name with no reader behind it
// ---------------------------------------------------------------------------

test('an editorial name is drawn but never opens anything', async (t) => {
  await t.test('the guard is at the call, because the parameter is not the same shape', () => {
    // The opening post takes a click with no argument — it draws one face and
    // knows whose it is — while an answer card takes the reader's id. Handing the
    // same lambda to both is a compile error, which is how the owner's build
    // found this; the assertion is here so the next edit finds it first.
    assert.match(FORUM_SCREENS,
      /onAuthorClick = \{ openAuthor\(loaded\.discussion\.authorId\) \}/,
      'the opening post guards the call it can make');
    assert.equal((FORUM_SCREENS.match(/onAuthorClick = openAuthor,/g) || []).length, 1,
      'and the answer cards are the one place the lambda itself is handed down');
    assert.match(FORUM_SCREENS,
      /val openAuthor: \(String\) -> Unit = \{ id -> if \(id\.isNotBlank\(\)\) onAuthorClick\(id\) \}/,
      'which refuses an empty id — an editorial row has no reader behind it');
  });
});

// ---------------------------------------------------------------------------
// 7. The cards: one shape
// ---------------------------------------------------------------------------

test('every card on the forum page is the same card', async (t) => {
  await t.test('the counters sit inline, at the right of the category', () => {
    const card = screen('ForumDiscussionCard');
    const categoryRow = between(card, 'text = discussion.categoryTitle', 'Spacer(Modifier.weight(1f))\n\n',
      'the category line');
    assert.match(categoryRow, /ForumCounters\(/, 'the counters are on the category line');
    assert.ok(!/Surface\(|\.background\(/.test(categoryRow),
      'with no pill, no border and no background of their own');
    assert.match(card, /testTag\("forum_card_counters_\$\{discussion\.id\}"\)/,
      'the row is reachable in a UI test');
  });

  await t.test('a card beside a picture folds its words sooner', () => {
    const card = screen('ForumDiscussionCard');
    assert.match(card, /maxLines = if \(discussion\.hasCover\) 2 else 3/,
      'two lines of title beside a cover, three without one');
    assert.match(card, /maxLines = if \(discussion\.hasCover\) 1 else 2/,
      'one line of summary beside it, two without');
    assert.match(card, /fontSize = if \(discussion\.hasCover\) 16\.sp else 17\.sp/,
      'a size down for the narrower column');
  });

  await t.test('the cover is the height of the card, and the card is a floor', () => {
    const card = screen('ForumDiscussionCard');
    assert.match(FORUM_SCREENS, /private val FORUM_CARD_COVER_WIDTH = 116\.dp/);
    assert.match(FORUM_SCREENS, /private val FORUM_CARD_HEIGHT = 140\.dp/,
      'one height for every card on the page');
    assert.match(card, /\.width\(FORUM_CARD_COVER_WIDTH\)\s*\n\s*\.fillMaxHeight\(\)/,
      'a cover fills the card beside the words');
    assert.match(card, /\.defaultMinSize\(minHeight = FORUM_CARD_HEIGHT\)/,
      'a floor rather than a lid: a card that needs more grows');
    assert.ok(!/FORUM_CORNER_RESERVE/.test(FORUM_SCREENS),
      'and the corner the counters used to be pinned in is gone with them');
  });

  await t.test('the author block is the floor of the card, at one size', () => {
    const card = screen('ForumDiscussionCard');
    assert.match(card, /avatarSize = if \(discussion\.hasCover\) 30 else 34/,
      'a face worth looking at, a size down when a cover shares the row');
    assert.match(card, /date = discussion\.lastActivityAt/,
      'the date it was last alive');
    assert.match(card, /nameSize = if \(discussion\.hasCover\) 12\.5\.sp else 13\.5\.sp/);
  });

  await t.test('one excerpt length, decided once', () => {
    assert.match(PORTAL_MODELS, /const val FORUM_FOLD_CHARS = 100/,
      'a hundred characters, on the model');
    assert.match(FORUM_SCREENS, /private fun forumExcerpt\(text: String, limit: Int = FORUM_FOLD_CHARS\): String/,
      'and one place that folds a card\'s words to it');
    assert.ok(!/FORUM_FOLD_CHARS = \d+/.test(FORUM_SCREENS),
      'the screen no longer keeps a second copy of the number');
  });
});
