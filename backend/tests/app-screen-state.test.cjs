/**
 * The owner's sixth read: "it reload the page and show the skeleton min for 0.5s".
 *
 * Two screens were named — the chat, and a forum thread — and the same two things
 * were wrong on both: the loading state belonged to the *screen's lifetime*
 * rather than to the data, so a screen that was rebuilt (leaving the thread for an
 * author's page and coming back, an activity being re-created, the assistant being
 * reopened) showed a skeleton or a spinner over content that was still in memory.
 *
 * The fix is the same shape on both: the state is hoisted out of the composition
 * — `rememberSaveable` for the assistant's one-second intro, a destination-scoped
 * `ViewModel` for the thread — and a loading state is only allowed to take the
 * screen when there is genuinely nothing to show.
 *
 * The second half of the thread test is a bug the same change fixes: the view used
 * to be counted once per *screen*, so a rebuilt screen counted the same reader
 * twice. It is counted once per discussion per visit now, which is what
 * `forum_discussion(p_count_view := true)` was always meant to mean.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app');
const read = (...parts) => fs.readFileSync(path.join(APP, ...parts), 'utf8');

const FORUM_SCREENS = read('ui', 'screens', 'ForumScreens.kt');
const AI_SCREEN = read('ui', 'screens', 'AiAssistantScreen.kt');

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

// ---------------------------------------------------------------------------
// 1. The assistant: the skeleton is a first impression, not a tax
// ---------------------------------------------------------------------------

test('the assistant does not replay its skeleton on every visit', async (t) => {
  await t.test('the flag survives a rebuild instead of starting true again', () => {
    assert.match(AI_SCREEN, /var introShown by rememberSaveable \{ mutableStateOf\(false\) \}/,
      'held outside the composition, like the question that was already asked');
    assert.ok(!/var isSkeletonLoading by remember \{ mutableStateOf\(true\) \}/.test(AI_SCREEN),
      'and not a fresh `true` every time the screen is composed');
  });

  await t.test('and it never covers a conversation that is already there', () => {
    assert.match(AI_SCREEN, /val showSkeleton = !introShown && messages\.isEmpty\(\)/);
    assert.match(AI_SCREEN, /if \(showSkeleton\) \{\s*AiAssistantSkeletonLayout\(\)\s*return\s*\}/,
      'the skeleton is asked for by that one condition');
    assert.match(AI_SCREEN, /delay\(1000L\)[\s\S]{0,60}introShown = true/,
      'the second is still the owner\'s second, and it still ends');
  });
});

// ---------------------------------------------------------------------------
// 2. The thread: nothing flashes over answers that are still in memory
// ---------------------------------------------------------------------------

test('a rebuilt thread screen keeps its answers', async (t) => {
  await t.test('the thread lives in a view model scoped to the destination', () => {
    assert.match(FORUM_SCREENS, /class ForumThreadHolder : ViewModel\(\) \{/);
    const holder = FORUM_SCREENS.slice(FORUM_SCREENS.indexOf('class ForumThreadHolder'), FORUM_SCREENS.indexOf('fun ForumThreadScreen('));
    assert.match(holder, /var thread: ForumThread\? by mutableStateOf\(null\)/, 'the state Compose reads');
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /val holder: ForumThreadHolder = viewModel\(\)/,
      'asked for from the entry\'s own store, so a return finds it again');
    assert.match(thread, /val thread = holder\.thread/, 'and the screen reads it, not a copy of its own');
    assert.ok(!/var thread by remember \{ mutableStateOf<ForumThread\?>\(null\) \}/.test(thread),
      'there is no second copy to go blank');
  });

  await t.test('a spinner is only for a thread there is nothing to show of', () => {
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /var loading by remember \{ mutableStateOf\(holder\.thread == null\) \}/,
      'the first composition asks the holder, not itself');
    assert.match(thread, /if \(holder\.thread == null\) loading = true else refreshing = true/,
      'and a reload behind content is not a loading state at all');
    assert.match(FORUM_SCREENS, /loading && thread == null -> ForumLoading/,
      'the whole-screen spinner is still gated on the thread being absent');
    assert.match(FORUM_SCREENS, /if \(refreshing\) \{\s*LinearProgressIndicator\(/, 'the line instead');
    assert.match(FORUM_SCREENS, /testTag\("forum_thread_refreshing"\)/);
    assert.match(FORUM_SCREENS, /refreshing: Boolean = false/, 'the scaffold takes the flag');
    // It has to be *inside* the top bar's lambda — a composable in an argument
    // list does not compile, and one drawn over the page is what the owner found.
    assert.match(FORUM_SCREENS, /if \(refreshing\) \{\s*LinearProgressIndicator\(\s*modifier = Modifier\s*\.fillMaxWidth\(\)\s*\.testTag\("forum_thread_refreshing"\)\s*\)\s*\}\s*\},\s*bottomBar = \{ bottomBar\?\.invoke\(\) \},/,
      'and draws the line inside the bar, under it, not over the page');
  });

  await t.test('every write goes back into the holder', () => {
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /holder\.thread = loaded/, 'a fresh read');
    assert.match(thread, /holder\.thread = holder\.thread\?\.with\(posted\)/, 'the answer just posted');
    assert.match(thread, /holder\.thread = loadThread\(discussionId, false\)\.getOrNull\(\) \?: holder\.thread/,
      'the counts after it');
    assert.match(thread, /holder\.thread = holder\.thread\?\.with\(/, 'and a reaction');
    const stripped = thread
      .replace(/holder\.thread = /g, '')
      .replace(/val thread = holder\.thread/g, '');
    assert.ok(!/\bthread = /.test(stripped),
      'with nothing left writing to a screen-local copy');
  });
});

// ---------------------------------------------------------------------------
// 3. And the view is counted once, not once per rebuild
// ---------------------------------------------------------------------------

test('one visit counts one view', async (t) => {
  await t.test('the count belongs to the visit, not to the composition', () => {
    assert.match(FORUM_SCREENS, /var counted: Boolean = false\s*private set/);
    assert.match(FORUM_SCREENS, /fun markCounted\(\) \{\s*counted = true\s*\}/);
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /val countView = reloadToken == 0 && !holder\.counted/,
      'the first load of a visit, and only if it has not already happened');
    assert.match(thread, /if \(countView\) holder\.markCounted\(\)/, 'marked when it has');
    assert.match(thread, /loadThread\(discussionId, countView\)/);
    assert.ok(!/loadThread\(discussionId, reloadToken == 0\)/.test(thread),
      'the old rule — the screen\'s own lifetime — is gone');
  });

  await t.test('and a refresh still never counts', () => {
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /reloadToken \+= 1/, 'the refresh button still walks the token');
    assert.match(thread, /if \(countView\) holder\.markCounted\(\)/,
      'while the count stays where the first load put it');
  });
});
