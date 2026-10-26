/**
 * The formatter buttons, and the background that says what is already on.
 *
 * The owner's note: "App wysiwyg editor markup formatter options like bold,
 * italic need a bg on active." A formatter button has two states and had only
 * one: it looked the same whatever the caret was sitting in, so a reader could
 * not tell whether the word they were about to type would be bold.
 *
 * There are two toolbars over one document — the app's, and the little bar the
 * page draws over selected text — and both had to answer the same question. The
 * answer can only come from the page (`queryCommandState` at the caret), so it
 * is asked there, drawn locally on the little bar, and reported across the
 * bridge for the app's toolbar.
 *
 * These are static checks with one exception, and it is the point of the file:
 * the page's script is **extracted from the Kotlin and run** against a fake
 * document, so `reportFormats` is tested as it will run in the WebView rather
 * than as it is spelled.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app');
// The app asks the language table for its copy now — `t("…")`, or `tNow("…")`
// where no composable may run — so these sources are read with that call lifted
// off: `tNow("মোটা")` reads as `"মোটা"`, and if the call filled slots, the
// arguments stay where they were. An assertion about a string does not care
// whether the call site asks for a translation, and this keeps every existing
// anchor honest rather than loosened: the string still has to be there, in that
// place, in that shape.
function unwrap(text) {
  const opener = /(?<![A-Za-z0-9_.])(?:t|tNow)\(\s*(?=")/g;
  let out = '';
  let i = 0;
  while (i < text.length) {
    opener.lastIndex = i;
    const match = opener.exec(text);
    if (!match) { out += text.slice(i); break; }
    out += text.slice(i, match.index);
    let j = match.index + match[0].length;
    const literalStart = j;
    j += 1;
    while (j < text.length) {
      if (text[j] === '\\') { j += 2; continue; }
      if (text[j] === '"') { j += 1; break; }
      j += 1;
    }
    const literal = text.slice(literalStart, j);
    // Skip the rest of the call: the closing paren of the one that wraps it.
    let depth = 0;
    let rest = '';
    while (j < text.length) {
      const ch = text[j];
      if (ch === '"') {
        let k = j + 1;
        while (k < text.length && text[k] !== '"') { if (text[k] === '\\') k += 1; k += 1; }
        rest += text.slice(j, k + 1);
        j = k + 1;
        continue;
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        if (depth === 0) { j += 1; break; }
        depth -= 1;
      }
      rest += ch;
      j += 1;
    }
    // One argument (the string itself) leaves nothing behind; a filled slot
    // keeps its arguments, minus the parens that only existed for the call.
    out += rest.trim() ? literal + rest : literal;
    i = j;
  }
  return out;
}
const read = (...parts) => unwrap(fs.readFileSync(path.join(APP, ...parts), 'utf8'));

const EDITOR = read('ui', 'components', 'HtmlContentEditor.kt');
const THEME = read('ui', 'editorial', 'EditorialTheme.kt');
const PALETTE_TEST = fs.readFileSync(path.join(__dirname, 'app-theme-palette.test.cjs'), 'utf8');

const CMDS = ['bold', 'italic', 'underline', 'insertUnorderedList'];

/**
 * The declaration that starts at [signature], and its body — braces balanced.
 *
 * The body alone is what a check about the inside of a function wants; the whole
 * declaration is what has to be spliced into a harness, because a bare `{ … }`
 * is a block, not a function, and a harness built from one would test nothing.
 */
function sliceFrom(text, signature) {
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `not found: ${signature}`);
  const open = text.indexOf('{', start + signature.length - 1);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { declaration: text.slice(start, i + 1), body: text.slice(open, i + 1) };
    }
  }
  throw new Error(`unbalanced: ${signature}`);
}

const bodyFrom = (text, signature) => sliceFrom(text, signature).body;

/** The page's script, exactly as the WebView is handed it. */
const SCRIPT = EDITOR
  .slice(EDITOR.indexOf('<script>') + '<script>'.length, EDITOR.indexOf('</script>'))
  .replace('${selectionPopup}', 'true');

const REPORT_SRC = sliceFrom(SCRIPT, 'function reportFormats').declaration;
const CMDS_SRC = SCRIPT.slice(SCRIPT.indexOf('const FORMAT_CMDS'), SCRIPT.indexOf(';', SCRIPT.indexOf('const FORMAT_CMDS')) + 1);

/** The shipped `reportFormats`, with a document and a bridge supplied. */
function runReporter({ state = {}, composing = false, buttons = [] } = {}) {
  const asked = [];
  const reported = [];
  const document = {
    queryCommandState: (cmd) => {
      asked.push(cmd);
      return state[cmd] === true;
    },
    querySelectorAll: () => buttons
  };
  const window = { Android: { onFormats: (csv) => reported.push(csv) } };
  const build = new Function(
    'document', 'window', 'Android',
    `var composing = ${composing};
     var lastFormats = null;
     ${CMDS_SRC}
     ${REPORT_SRC}
     return { report: reportFormats, setComposing: function(v){ composing = v; } };`
  );
  const api = build(document, window, window.Android);
  return { ...api, asked, reported };
}

function fakeButton(cmd) {
  const classes = new Set();
  return {
    cmd,
    classes,
    getAttribute: (name) => (name === 'data-cmd' ? cmd : null),
    classList: {
      toggle: (name, force) => { if (force) classes.add(name); else classes.delete(name); }
    }
  };
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

test('the page’s script is valid JavaScript', () => {
  // 200-odd lines of JavaScript live inside a Kotlin string. Nothing else in the
  // repository compiles them, and a stray brace would take the whole editor down.
  assert.doesNotThrow(() => new Function(SCRIPT), 'the editor is script is parseable');
  assert.match(SCRIPT, /function reportFormats\(\)\{/);
});

test('what is on at the caret is what the page reports', () => {
  const plain = runReporter({ state: {} });
  plain.report();
  assert.deepEqual(plain.reported, [''], 'nothing on, and it says so');
  assert.deepEqual(plain.asked, CMDS, 'by asking about the four formats');

  const bold = runReporter({ state: { bold: true } });
  bold.report();
  assert.deepEqual(bold.reported, ['bold']);

  const both = runReporter({ state: { bold: true, italic: true, underline: true } });
  both.report();
  assert.deepEqual(both.reported, ['bold,italic,underline'], 'and all of them when they are all on');

  // A caret inside a <b> with nothing selected is bold — which is the whole
  // reason this is asked of the page rather than of the last selection.
  assert.match(SCRIPT, /active = document\.queryCommandState\(FORMAT_CMDS\[i\]\)/);
  assert.match(SCRIPT, /catch \(err\) \{ active = false; \}/, 'and an unsupported command is not an error');
});

test('the same answer is not reported twice', () => {
  const reporter = runReporter({ state: { bold: true } });
  reporter.report();
  reporter.report();
  reporter.report();
  assert.deepEqual(reporter.reported, ['bold'], 'one crossing of the bridge, not one per keystroke');
  assert.match(SCRIPT, /if \(csv === lastFormats\) return;/);
});

test('nothing is read while a Bengali word is being composed', () => {
  const composing = runReporter({ state: { bold: true }, composing: true });
  composing.report();
  assert.deepEqual(composing.reported, [], 'the toolbar is left as it was');
  assert.deepEqual(composing.asked, [], 'and the document is not read underneath the keyboard');
  // The same rule the rest of the page follows, and the same reason: the DOM and
  // the selection belong to the IME until the word is finished.
  const body = bodyFrom(SCRIPT, 'function reportFormats');
  assert.match(body, /if \(composing\) return;/);
  // And it is asked again the moment the word is over.
  assert.match(SCRIPT, /compositionend', function\(\)\{\s*\n\s*composing = false;\s*\n\s*flushPending\(\);\s*\n\s*saveSelection\(\);/);
});

test('only a format button can light up', () => {
  const bold = fakeButton('bold');
  const copy = fakeButton('copy');
  const cut = fakeButton('cut');
  const paste = fakeButton('paste');
  const reporter = runReporter({ state: { bold: true }, buttons: [bold, copy, cut, paste] });
  reporter.report();
  assert.equal(bold.classes.has('on'), true, 'bold is on, so bold is filled');
  for (const button of [copy, cut, paste]) {
    assert.equal(button.classes.has('on'), false, `${button.cmd} is an action, not a state`);
  }
  // And with the formats off, the same button is not filled.
  const offButton = fakeButton('bold');
  const off = runReporter({ state: {}, buttons: [offButton] });
  off.report();
  assert.equal(offButton.classes.has('on'), false, 'a caret outside bold is not bold');
  assert.deepEqual(off.reported, [''], 'and the toolbar is told');
});

test('the little bar answers when the caret moves, and after every command', () => {
  assert.match(SCRIPT, /function saveSelection\(\)\{[\s\S]*?reportFormats\(\);\s*\n\s*\}/,
    'a caret that moves, a selection that changes, a box that takes the focus');
  assert.match(SCRIPT, /if \(!composing\) saveSelection\(\);[\s\S]{0,400}?reportFormats\(\);/,
    'and right after a formatter button has done its work');
  const apply = bodyFrom(SCRIPT, 'function applyHtml');
  assert.match(apply, /reportFormats\(\)/, 'a value pushed in from the app is a new place for the caret');
  const clear = bodyFrom(SCRIPT, 'window.clearEditor = function');
  assert.match(clear, /reportFormats\(\)/, 'and an emptied box has nothing on anywhere');
});

// ---------------------------------------------------------------------------
// The app’s toolbar
// ---------------------------------------------------------------------------

test('a formatter button says which format is on', () => {
  const { declaration: tool, body } = sliceFrom(EDITOR, 'private fun ToolIcon(');
  assert.match(tool, /active: Boolean = false/, 'the button is told');
  assert.match(body, /if \(active\) \{[\s\S]*?\.background\(MaterialTheme\.colorScheme\.primary\)/,
    'and fills only when the format is on');
  assert.match(body, /tint = if \(active\) \{\s*MaterialTheme\.colorScheme\.onPrimary/,
    'with the ink that goes on the accent');
  assert.match(body, /else \{\s*MaterialTheme\.colorScheme\.onSurfaceVariant/,
    'and the ordinary icon colour when it is not');
  assert.match(body, /else \{\s*Modifier\s*\}/, 'nothing is drawn when the format is not on');

  const toolbar = EDITOR.slice(EDITOR.indexOf('fun HtmlContentEditor('), EDITOR.indexOf('private fun ToolIcon('));
  for (const cmd of CMDS) {
    assert.match(toolbar, new RegExp(`"${cmd}" in activeFormats`), `${cmd} reads the reported state`);
  }
  assert.match(toolbar, /ToolIcon\("মোটা", Icons\.Default\.FormatBold, compact, "bold" in activeFormats\)/,
    'bold, spelled out');
  assert.match(toolbar, /"নিচে দাগ",\s*\n\s*Icons\.Default\.FormatUnderlined,\s*\n\s*compact,\s*\n\s*"underline" in activeFormats/,
    'and underline');
  // Undo, paste, image and the HTML switch are not toggles: nothing to be on.
  assert.ok(!/"undo" in activeFormats|"paste" in activeFormats/.test(toolbar),
    'no button lights up for an action');
});

test('the state crosses the bridge on the main thread', () => {
  assert.match(EDITOR, /var activeFormats by remember \{ mutableStateOf\(emptySet<String>\(\)\) \}/);
  assert.match(EDITOR, /emitFormats = \{ csv ->\s*\n\s*post \{[\s\S]*?activeFormats = csv\.split\(','\)/,
    'the list the page sent, kept as a set');
  const bridge = bodyFrom(EDITOR, 'private class HtmlBridge(');
  assert.match(bridge, /@JavascriptInterface\s*\n\s*fun onFormats\(csv: String\) \{/,
    'the page has one way to say it');
  assert.match(bridge, /host\.post \{ emitFormats\(csv\) \}/, 'and it is done on the UI thread');
  assert.match(SCRIPT, /if \(window\.Android && Android\.onFormats\) Android\.onFormats\(csv\);/,
    'guarded, the way every other call into the app is');
});

test('the fill is the palette’s own accent pair, which the palette test computes', () => {
  // The theme builds primary/onPrimary from the palette's accent and its ink.
  assert.match(THEME, /primary = side\.accent/);
  assert.match(THEME, /onPrimary = side\.onAccent/);
  // …and that pair is the one `app-theme-palette.test.cjs` holds to 4.5:1 for
  // every preset and every position of the custom wheel.
  assert.match(PALETTE_TEST, /\['what is written on the accent', 'onAccent', 'accent', 4\.5\]/,
    'the pair used here is the pair that is measured there');
  const { body: tool } = sliceFrom(EDITOR, 'private fun ToolIcon(');
  assert.ok(!/accentSoft|primaryContainer|secondaryContainer/.test(tool),
    'and not the soft tint, which is prettier and reads worse');
  // The softer fill was measured and rejected, and the number is written down so
  // nobody re-derives it: over the wheel it falls to 4.27:1 against the accent.
  assert.match(EDITOR, /4\.27:1/);
});

test('the little bar’s active state is the accent and its ink', () => {
  assert.match(EDITOR, /onAccentArgb: Int,/);
  assert.match(EDITOR, /val onAccent = hexColor\(onAccentArgb\)/);
  assert.match(EDITOR, /#selbar button\.on \{ background:\$accent; color:\$onAccent; \}/);
  assert.match(EDITOR, /onAccent\.toArgb\(\)/, 'and the caller passes it in');
  assert.match(EDITOR, /val onAccent = MaterialTheme\.colorScheme\.onPrimary/);
  // Two states, two rules: a button that is being pressed is not a format that is on.
  assert.match(EDITOR, /#selbar button:active \{ background:rgba\(255,255,255,\.15\); \}/);
  assert.ok(
    EDITOR.indexOf('#selbar button:active') < EDITOR.indexOf('#selbar button.on {'),
    'and the pressed wash is written first, so an active button keeps its fill under a finger'
  );
});
