'use strict';

/**
 * What makes the app stutter while scrolling.
 *
 * The owner: "Why the app is going slow down. This app gets stuck or lags while
 * scrolling down." Every cause found was one of five shapes, and every one of
 * them was sitting in a list row or on the path of every row:
 *
 *   1. an *infinite* animation in a row — `VerifiedBadge` pulsed for ever, so a
 *      list of verified authors never let the frame clock idle;
 *   2. a formatter built per row — `SimpleDateFormat` compiled its pattern and
 *      loaded locale data twice per date, and dates are drawn in every card;
 *   3. a conversion that allocated three objects per call — the numeral
 *      converter, called from rows across the app;
 *   4. a state object with a clock in it, collected high in the tree — the
 *      reader redrew everything two and a half times a second while a song
 *      played, for a bottom padding;
 *   5. a lookup that normalised the string before answering — the translation
 *      table, asked about a thousand times per screen pass.
 *
 * These tests hold each of those shut. They are structural, like the rest of the
 * suite: there is no device here to profile on, so what can be proven by reading
 * the sources is proven by reading the sources.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const APP = path.join(REPO, 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app');

function kotlinFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.kt')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const rel = (file) => path.relative(APP, file).split(path.sep).join('/');
const read = (...parts) => fs.readFileSync(path.join(APP, ...parts), 'utf8');

test('no badge or row animates for ever', () => {
  // An infinite animation is a promise to redraw for as long as the composable
  // is on screen. In a row that is the wrong place for one: dozens of visible
  // rows, one frame's work each, on top of the scroll itself. The places an
  // infinite animation is still allowed are named here, with the reason.
  const ALLOWED = {
    'ui/components/PlayingWaveBars.kt': 'the playing wave, and only while playing',
    'ui/screens/SplashScreen.kt': 'the splash, which leaves',
    'ui/editorial/EditorialComponents.kt': 'LoadingFeed, which exists only while loading',
    'ui/editorial/LazyImage.kt': 'an image placeholder, which ends when the image arrives',
  };
  const found = [];
  for (const file of kotlinFiles(APP)) {
    const text = fs.readFileSync(file, 'utf8');
    if (!/rememberInfiniteTransition\s*\(/.test(text)) continue;
    const key = rel(file);
    if (!(key in ALLOWED)) found.push(key);
  }
  assert.deepEqual(found, [], 'an infinite animation somewhere nobody expected one');

  // The badge is the one that was in every row: it must not animate at all.
  const badge = read('ui', 'components', 'VerifiedBadge.kt');
  assert.doesNotMatch(badge, /rememberInfiniteTransition|infiniteRepeatable|animateFloat/,
    'the verification mark is drawn still');
  assert.doesNotMatch(badge, /animated/, 'and has no switch that could turn it back on');

  // And the wave must not build its transition while it is standing still.
  const wave = read('ui', 'components', 'PlayingWaveBars.kt');
  const gate = wave.indexOf('val sweep = if (animated) {');
  const call = wave.indexOf('rememberInfiniteTransition(');     // the call, not the import
  assert.ok(gate >= 0 && call > gate,
    'the wave animation is created only inside the playing branch');
});

test('a date is formatted once, not once per row per frame', () => {
  // `SimpleDateFormat` is the expensive part: the pattern is compiled and the
  // locale's month names are loaded. Built inside a row it is rebuilt for every
  // visible card on every pass of a scroll.
  const formats = read('util', 'DateFormats.kt');
  assert.match(formats, /internal object DateFormats/);
  assert.match(formats, /ThreadLocal\.withInitial/, 'one set per thread: SimpleDateFormat is not thread-safe');
  assert.match(formats, /mine\[key\]\?\.let \{ return it \}/, 'and reused after the first call');

  const editorial = read('ui', 'editorial', 'EditorialComponents.kt');
  assert.match(editorial, /private fun memoisedDate\(/, 'the result of an unchanged date is kept');
  assert.match(editorial, /DateFormats\.of\(/, 'and the formatters come from the cache');

  // One construction in the whole app: the one inside the cache.
  const builders = [];
  for (const file of kotlinFiles(APP)) {
    if (rel(file) === 'util/DateFormats.kt') continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/SimpleDateFormat\s*\(/g)) {
      builders.push(`${rel(file)}:${text.slice(0, match.index).split('\n').length}`);
    }
  }
  assert.deepEqual(builders, [], 'a date formatter built outside the cache');
});

test('the numeral converter does not build a list to read a number', () => {
  // `number.toString().map { … }.joinToString("")` allocates a list, a boxed
  // character per digit and a string — three objects, from rows all over the app.
  const numerals = read('util', 'BengaliNumerals.kt');
  assert.match(numerals, /fun bengaliDigits\(text: String\): String \{/);
  assert.match(numerals, /buildString/, 'one pass, one string');
  // The comment explaining the old shape must not be what the check reads.
  const code = numerals.split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  assert.doesNotMatch(code, /joinToString|\.map \{/, 'and no list in between');
  // Every caller reaches that one implementation: the theme's own name delegates
  // to it, so the 81 call sites did not have to move.
  const theme = read('ui', 'editorial', 'EditorialTheme.kt');
  assert.match(theme, /fun toBengaliNumeral\(number: Number\): String = bengaliDigits\(number\.toString\(\)\)/);

  const offenders = [];
  for (const file of kotlinFiles(APP)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\.map \{ ch[^\n]*joinToString/g)) {
      offenders.push(`${rel(file)}:${text.slice(0, match.index).split('\n').length}`);
    }
  }
  assert.deepEqual(offenders, [], 'the same conversion written the slow way somewhere else');
});

test('the reader watches a boolean, not the player clock', () => {
  // The player state carries `positionMs`, which moves every 400 ms while a song
  // plays. Collecting it at the top of the reader redrew every screen below it
  // for a bottom padding — and every row inside those screens with it.
  const host = read('ui', 'reader', 'ReaderNavHost.kt');
  assert.doesNotMatch(host, /musicController\.state\.collectAsState\(\)/,
    'the whole player state is not collected in the host');
  assert.match(host, /val showMiniBar by remember\(app\.musicController\) \{/);
  assert.match(host, /\.map \{ it\.visible && !it\.expanded \}/, 'only the two facts the padding needs');
  assert.match(host, /\.distinctUntilChanged\(\)/, 'and the host hears about it only when it flips');
});

test('the translation lookup answers an empty file without normalising anything', () => {
  // Every string in the app is a call to this function; a screen asks it about a
  // thousand times. Normalising the string first — a regex and two allocations —
  // to look in a map that is empty is the definition of avoidable work.
  const strings = read('ui', 'i18n', 'Strings.kt');
  assert.match(strings, /else if \(table\.loose\.isEmpty\(\)\) \{\s*bengali\s*\}/,
    'an empty language file answers before the loose lookup');
  assert.match(strings, /problem|/ , 'and the exact match is tried first');
  assert.match(strings, /private val looseKeys = java\.util\.concurrent\.ConcurrentHashMap/,
    'the normalised form of a string is computed once');
  assert.match(strings, /if \(looseKeys\.size < 4096\) looseKeys\[text\] = key/,
    'with a cap, so a runtime-built string cannot grow it for ever');
});

test('an article can be skipped when nothing about it changed', () => {
  // `Article` carries two `List` fields, so Compose cannot prove it unchanging;
  // without a promise, the card for every visible row is re-executed whenever
  // anything above it changes — which is every scroll tick that loads a page.
  const models = read('data', 'model', 'Models.kt');
  assert.match(models, /@Immutable\s*\n(?:@\w+\s*\n)*data class Article\(/,
    'Article promises it never changes in place');
  assert.match(models, /import androidx\.compose\.runtime\.Immutable/);
});

test('the shimmer that was never used is gone', () => {
  // A whole file of skeleton placeholders, none of them called, with an infinite
  // animation in each — dead code that would have cost a frame every frame the
  // day somebody wired it up.
  assert.equal(fs.existsSync(path.join(APP, 'ui', 'components', 'SkeletonShimmer.kt')), false);
  const leftovers = [];
  for (const file of kotlinFiles(APP)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const name of ['HeroCarouselSkeleton', 'ArticleCardSkeleton', 'CategoryChipSkeleton', 'ShimmerBox']) {
      if (new RegExp(`\\b${name}\\b`).test(text)) leftovers.push(`${rel(file)}: ${name}`);
    }
  }
  assert.deepEqual(leftovers, [], 'a skeleton component came back without a caller');
});
