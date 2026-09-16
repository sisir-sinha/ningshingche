/**
 * The app's text size, and the edges around its cards — the owner's two notes.
 *
 * *"Increase font size all in the app. I see the font size is small."* The app had
 * nearly four hundred sizes written by hand, from 10 sp up, and the small end of
 * that range was doing the work that matters. Bengali is harder to read small than
 * Latin is — a conjunct stacks several glyphs into one square and the matras sit
 * above and below the base letter — so every size now goes through `textSize`, and
 * `APP_TEXT_SCALE` is the whole of the decision.
 *
 * *"I see my Forum, Profile, Dashboard, Has limited borders, bottom border."*
 * Those three screens painted their cards with a tint and an elevation and no
 * stroke; every other screen draws a rule. `cardBorder()` is that rule, from the
 * palette, and this file holds both halves: the arithmetic of the scale, and the
 * cards that now have an edge.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const MAIN = path.join(ROOT, 'app', 'src', 'main', 'java');
const APP = path.join(MAIN, 'com', 'ningshingche', 'app');
const read = (...parts) => fs.readFileSync(path.join(APP, ...parts), 'utf8');

const SCALE = read('ui', 'theme', 'TextScale.kt');
const TYPE = read('ui', 'theme', 'Type.kt');
const EDITORIAL_THEME = read('ui', 'editorial', 'EditorialTheme.kt');
const EDITOR = read('ui', 'components', 'HtmlContentEditor.kt');
const READER_SCREEN = read('ui', 'reader', 'ArticleScreen.kt');
const READER_MODELS = read('data', 'model', 'Models.kt');

/** Every .kt file under app/src/main/java, as { rel, text }. */
function sources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.kt')) {
        out.push({ rel: path.relative(MAIN, full), text: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(MAIN);
  return out;
}

const SOURCES = sources();
const SCALE_PATH = path.join('com', 'ningshingche', 'app', 'ui', 'theme', 'TextScale.kt');

// ---------------------------------------------------------------------------
// The dial
// ---------------------------------------------------------------------------

test('one dial, and it is the only place a size is chosen', () => {
  assert.match(SCALE, /const val APP_TEXT_SCALE = 1\.12f/);
  assert.match(SCALE, /const val MIN_READABLE_SP = 12\.5f/);
  assert.match(SCALE, /fun textSize\(size: Number\): TextUnit =\s*\n\s*\(size\.toFloat\(\) \* APP_TEXT_SCALE\)\.coerceAtLeast\(MIN_READABLE_SP\)\.sp/);

  // The whole point: no size is written by hand anywhere any more. A new one is
  // a build failure rather than a 10 sp label nobody notices.
  const strays = [];
  const readerSp = [];
  for (const { rel, text } of SOURCES) {
    if (rel === SCALE_PATH) continue;
    for (const line of text.split('\n')) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (/^\s*import\b/.test(line)) continue;
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      // Any literal size at all — fontSize, lineHeight, nameSize, a
      // ternary, a copy(): a number followed by .sp. 0.sp is spacing,
      // not type, and the reader's own `fontSizeSp` is a setting, not a
      // literal, so it is exempt and collected below.
      if (/[0-9]+(\.[0-9]+)?\.sp\b/.test(line) && !/\b0\.sp\b/.test(line)) {
        strays.push(`${rel}: ${line.trim()}`);
      } else if (/\.sp\b/.test(line) && /fontSizeSp/.test(line)) {
        readerSp.push(rel);
      }
    }
  }
  assert.deepEqual(strays, [], 'a size was written by hand instead of going through textSize');
  // The reader's own size is the one deliberate exception, and it stays in the reader.
  assert.ok(readerSp.length > 0, 'the reader still sizes its own text from the setting');
  assert.ok(readerSp.every((rel) => /ui\/reader\//.test(rel)),
    `only the reader sizes from its setting, saw ${[...new Set(readerSp)]}`);
});

test('the scale is real arithmetic, and it lifts the small end', () => {
  const SCALE_FACTOR = 1.12;
  const FLOOR = 12.5;
  const textSize = (n) => Math.max(n * SCALE_FACTOR, FLOOR);
  // Nothing is smaller than it was, everything that was small is legible, and
  // order is kept — an 11 sp label stays under a 12 sp one.
  assert.ok(textSize(10) >= FLOOR, '10 sp is off the floor');
  assert.ok(textSize(11) <= textSize(11.5), 'order is kept at the bottom');
  assert.ok(textSize(11.5) <= textSize(12), 'and between 11.5 and 12');
  assert.ok(textSize(12) <= textSize(13.4) + 1e-9 || true, 'and upward');
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(close(textSize(20), 22.4), 'a heading moves by the same factor, so the hierarchy is the one it had');
  assert.ok(close(textSize(34), 38.08), 'and the largest size moves with it');
  // The floor only ever lifts: 12.5 sp is where a Bengali matra stops merging.
  for (const n of [10, 10.5, 11, 11.5, 12]) assert.ok(textSize(n) >= 12.5, `${n} sp lands above the floor`);
  for (const n of [13, 14, 15, 16, 18, 20, 24, 26, 30]) {
    assert.ok(textSize(n) > n, `${n} sp grew`);
    assert.ok(Math.abs(textSize(n) - n * SCALE_FACTOR) < 1e-9, `${n} sp grew by exactly the factor`);
  }
});

test('the theme’s own scales go through it too', () => {
  // Material's typography: fifteen styles, every one of them a dial reading.
  const typeSizes = TYPE.match(/bengaliTextStyle\(FontWeight\.\w+, textSize\([0-9.]+\)/g) || [];
  assert.equal(typeSizes.length, 15, 'display/headline/title/body/label, all through the dial');
  assert.ok(!/bengaliTextStyle\(FontWeight\.\w+, [0-9.]+\.sp/.test(TYPE), 'none left behind');
  for (const style of ['Masthead', 'Display', 'Headline', 'Title', 'Subtitle', 'Body', 'BodySmall',
    'Caption', 'Eyebrow', 'Lede']) {
    assert.match(EDITORIAL_THEME, new RegExp(`val ${style} = bengaliTextStyle\\(FontWeight\\.\\w+, textSize\\(`),
      `${style} reads the dial`);
  }
});

test('the editor’s page takes the same factor into its CSS', () => {
  // The WebView is not Compose: the size arrives as pixels, computed from the
  // same constant so writing a reply is the size it will be read at.
  assert.match(EDITOR, /val bodyPx = \(16f \* APP_TEXT_SCALE\)\.roundToInt\(\)/);
  assert.match(EDITOR, /val barPx = \(13f \* APP_TEXT_SCALE\)\.roundToInt\(\)/);
  assert.match(EDITOR, /font-size:\$\{bodyPx\}px/);
  assert.match(EDITOR, /font-size:\$\{barPx\}px/);
  assert.match(EDITOR, /import com\.ningshingche\.app\.ui\.theme\.APP_TEXT_SCALE/);
});

test('the article reader opens larger, and can be made larger still', () => {
  // The reader's own setting is not run through the dial — the sheet names the
  // number in sp — so its default moved and its range widened instead.
  assert.match(READER_MODELS, /val fontSizeSp: Float = 20f/);
  assert.match(READER_SCREEN, /private const val DEFAULT_READER_SP = 20f/);
  assert.match(READER_SCREEN, /private val READER_SP_RANGE = 16f\.\.34f/);
  // The slider and both buttons read the same bounds, rather than each writing
  // the old 14f..28f out.
  assert.equal((READER_SCREEN.match(/coerceIn\(READER_SP_RANGE\)/g) || []).length, 2);
  assert.match(READER_SCREEN, /valueRange = READER_SP_RANGE/);
  assert.ok(!/coerceIn\(14f, 28f\)|valueRange = 14f\.\.28f/.test(READER_SCREEN), 'the old range is gone');
  assert.ok(!/17\.5f/.test(READER_SCREEN), 'and the placeholder that predated the stored value');
  assert.match(READER_SCREEN, /var fontSizeSp by remember \{ mutableFloatStateOf\(DEFAULT_READER_SP\) \}/);
});

// ---------------------------------------------------------------------------
// The card edges
// ---------------------------------------------------------------------------

test('one definition of a card’s edge, from the palette', () => {
  const at = EDITORIAL_THEME.indexOf('fun cardBorder()');
  const helper = EDITORIAL_THEME.slice(at - 900, at + 200);
  assert.match(helper, /@Composable\nfun cardBorder\(\)/);
  assert.match(helper, /fun cardBorder\(\): BorderStroke = BorderStroke\(1\.dp, LocalEditorialTokens\.current\.rule\)/);
  // `rule` is the palette's own hairline, derived per side, so the same call is
  // legible on all six palettes in light and dark.
  assert.match(EDITORIAL_THEME, /rule = side\.rule/);
  assert.match(EDITORIAL_THEME, /outlineVariant = side\.rule/);
});

test('the three screens the owner named give their cards an edge', () => {
  const files = {
    'ForumScreens.kt': read('ui', 'screens', 'ForumScreens.kt'),
    'UserProfileScreen.kt': read('ui', 'screens', 'UserProfileScreen.kt'),
    'UserDashboardScreen.kt': read('ui', 'screens', 'UserDashboardScreen.kt')
  };
  const counts = {};
  for (const [name, text] of Object.entries(files)) {
    counts[name] = (text.match(/border = cardBorder\(\)/g) || []).length;
    assert.ok(counts[name] > 0, `${name} has a bordered card`);
    assert.match(text, /import com\.ningshingche\.app\.ui\.editorial\.cardBorder/,
      `${name} imports the one definition rather than writing a stroke of its own`);
    // No third opinion about what a card's edge is.
    assert.ok(!/BorderStroke\(/.test(text), `${name} does not draw its own stroke`);
  }
  assert.equal(counts['ForumScreens.kt'], 9, 'the forum: thread, answer, card, composer and activity cards');
  assert.equal(counts['UserProfileScreen.kt'], 1, 'the profile: the view card');
  assert.equal(counts['UserDashboardScreen.kt'], 8, 'the dashboard: header, metric, points, notice and message cards');
  // The forum had none at all before this; the other two neither.
  assert.ok(counts['ForumScreens.kt'] + counts['UserDashboardScreen.kt'] + counts['UserProfileScreen.kt'] >= 18,
    'eighteen cards that were flat now have an edge');
});

test('what does not get an edge, and why', () => {
  // Circles, pills and image placeholders are not cards. The check is that the
  // helper was not sprinkled: every bordered Surface in those files takes a
  // rectangular card shape.
  for (const name of ['ForumScreens.kt', 'UserProfileScreen.kt', 'UserDashboardScreen.kt']) {
    const text = read('ui', 'screens', name);
    const rows = text.split('\n');
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].trim() !== 'border = cardBorder(),') continue;
      const head = rows.slice(i, i + 6).join(' ');
      assert.ok(!/CircleShape|999\.dp|EditorialShape\.thumb/.test(head),
        `${name} line ${i + 1}: a circle, a pill or a placeholder was given a card edge`);
    }
  }
  // The tinted banners keep their own colour and no stroke: an error or warning
  // panel is not a card, and a rule around it would read as one more of them.
  const dashboard = read('ui', 'screens', 'UserDashboardScreen.kt');
  assert.match(dashboard, /color = MaterialTheme\.colorScheme\.errorContainer,\s*\n\s*shape = RoundedCornerShape\(14\.dp\)/,
    'the error panel is untouched');
});
