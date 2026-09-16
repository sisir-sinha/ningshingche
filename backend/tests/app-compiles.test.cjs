'use strict';

/**
 * The mistakes a compiler catches that a sweep can make.
 *
 * This suite cannot build the app — there is no Android SDK where it runs — so a
 * compile error reaches the owner instead of the tests. That happened: a batch
 * left a `lineHeight` on a `SpanStyle`, a `const val` holding a translation, and
 * the same named argument twice in one call, and the build failed on the first
 * `./gradlew assembleDebug`.
 *
 * These tests are the part of the compiler that can be written down: the checks
 * that are cheap to state and that an automated edit is likely to break. They are
 * deliberately about *syntax and shapes*, not about behaviour.
 *
 * Fixture-free: it reads the Kotlin sources.
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
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** The sources with comments and string bodies blanked out, so only code is read. */
function masked(text) {
  const out = [...text];
  const blank = (from, to) => { for (let i = from; i < Math.min(to, out.length); i += 1) if (out[i] !== '\n') out[i] = ' '; };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('//', i)) { const j = text.indexOf('\n', i); const end = j < 0 ? text.length : j; blank(i, end); i = end; continue; }
    if (text.startsWith('/*', i)) { const j = text.indexOf('*/', i + 2); const end = j < 0 ? text.length : j + 2; blank(i, end); i = end; continue; }
    // A raw string is one string: `"""` opens it and the next `"""` closes it,
    // whatever is inside — SQL, JSON, another language's punctuation.
    if (text.startsWith('"""', i)) {
      const j = text.indexOf('"""', i + 3);
      const end = j < 0 ? text.length : j + 3;
      blank(i + 3, end - 3);
      i = end;
      continue;
    }
    if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '"' || text[j] === '\n') break;
        j += 1;
      }
      blank(i + 1, j);      // keep the quotes, drop the body
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/**
 * Every call in the file: its callee, its argument text and where it starts.
 *
 * Walked by hand rather than matched with a regex, because a `)` inside a string
 * — `t("… (Font & Spacing)")` — is not a closing paren, and treating it as one
 * makes the scanner report arguments from three functions away as belonging to
 * the same call. Strings, raw strings and comments are skipped here, so the
 * parens that matter are the code's own.
 */
function callsOf(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (text.startsWith('//', i)) { const j = text.indexOf('\n', i); i = j < 0 ? text.length : j; continue; }
    if (text.startsWith('/*', i)) { const j = text.indexOf('*/', i + 2); i = j < 0 ? text.length : j + 2; continue; }
    if (text.startsWith('"""', i)) { const j = text.indexOf('"""', i + 3); i = j < 0 ? text.length : j + 3; continue; }
    if (ch === '"') { i = skipString(text, i); continue; }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_.]/.test(text[j])) j += 1;
      const callee = text.slice(i, j);
      let k = j;
      while (k < text.length && /\s/.test(text[k])) k += 1;
      if (text[k] === '(') {
        const close = matchingParen(text, k);
        if (close !== null) out.push({ callee, open: k, raw: text.slice(k + 1, close) });
        // Carry on *inside* the arguments: a call nested in another call's
        // arguments — `…bodySmall.copy(fontSize = …, lineHeight = …)` — is where
        // a repeated named argument actually hid, and skipping past it would
        // make this check quietly blind to the bug it exists for.
        i = k + 1;
      } else {
        i = j;
      }
      continue;
    }
    i += 1;
  }
  return out;
}

/** The index just past a string literal that starts at `from`. */
function skipString(text, from) {
  let i = from + 1;
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === '"') return i + 1;
    if (text[i] === '\n') return i;
    i += 1;
  }
  return i;
}

/** The index of the `)` that closes the `(` at `open`, skipping strings. */
function matchingParen(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    if (text.startsWith('//', i)) { const j = text.indexOf('\n', i); i = j < 0 ? text.length : j; continue; }
    if (text.startsWith('/*', i)) { const j = text.indexOf('*/', i + 2); i = j < 0 ? text.length : j + 2; continue; }
    if (text.startsWith('"""', i)) { const j = text.indexOf('"""', i + 3); i = j < 0 ? text.length : j + 3; continue; }
    if (text[i] === '"') { i = skipString(text, i); continue; }
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') { depth -= 1; if (depth === 0) return i; }
    i += 1;
  }
  return null;
}

/** Named arguments written at the top level of an argument list. */
function namedArguments(raw) {
  const names = [];
  let depth = 0;
  let buf = '';
  const push = () => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=[^=]/.exec(buf);
    if (m) names.push(m[1]);
    buf = '';
  };
  for (const ch of raw) {
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) push();
    else buf += ch;
  }
  push();
  return names;
}

test('no call passes the same named argument twice', () => {
  // `Text(style = …, lineHeight = leading(12), … fontWeight = …, lineHeight = …)`
  // is what a sweep that adds a line height produces when a line height was
  // already there, three lines further down.
  const problems = [];
  for (const file of kotlinFiles(APP)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const call of callsOf(text)) {
      const names = namedArguments(call.raw);
      for (const name of new Set(names)) {
        if (names.filter((n) => n === name).length > 1) {
          problems.push(`${rel(file)}:${lineOf(text, call.open)}  ${call.callee}(…)  ${name}`);
        }
      }
    }
  }
  assert.deepEqual(problems, [], 'a named argument is given twice in one call');
});

test('a line height is only given to something that has one', () => {
  // The sweep writes `lineHeight = leading(N)` after a size. Five things in this
  // app take a line height; anything else is a compile error waiting.
  const TAKES_LINE_HEIGHT = new Set([
    'Text', 'BasicText', 'copy', 'TextStyle', 'HtmlFormattedText', 'MarkdownFormattedText',
    'bengaliTextStyle', 'ParagraphStyle',
  ]);
  const problems = [];
  for (const file of kotlinFiles(APP)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const call of callsOf(text)) {
      if (!namedArguments(call.raw).includes('lineHeight')) continue;
      const last = call.callee.split('.').pop();
      if (!TAKES_LINE_HEIGHT.has(last)) {
        problems.push(`${rel(file)}:${lineOf(text, call.open)}  ${call.callee}(…)`);
      }
    }
  }
  assert.deepEqual(problems, [], 'a line height is handed to a call that has no such parameter');
});

test('a compile-time constant is never built from a function call', () => {
  // `const val TAGLINE = tNow("…")` is not a constant: the value has to be known
  // to the compiler. A translated constant is a property that asks at the moment
  // it is read, which is also the only version that follows the language.
  const problems = [];
  for (const file of kotlinFiles(APP)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of masked(text).matchAll(/\bconst\s+val\s+([A-Za-z0-9_]+)[^\n=]*=\s*([^\n]*)/g)) {
      if (/[A-Za-z_][A-Za-z0-9_.]*\s*\(/.test(match[2])) {
        problems.push(`${rel(file)}:${lineOf(text, match.index)}  const val ${match[1]}`);
      }
    }
  }
  assert.deepEqual(problems, [], 'a const val is initialised by a call');
});

test('the translation call is a plain function, so it works in a handler', () => {
  // It is called from click handlers, coroutines and view models as well as from
  // screens. A composable cannot be called in those places, and getting it wrong
  // is a build failure rather than a fallback — so the function is plain, and the
  // app redraws on a swap by keying the navigation graph on the table.
  const strings = fs.readFileSync(
    path.join(APP, 'ui', 'i18n', 'Strings.kt'), 'utf8');
  const declaration = strings.slice(strings.indexOf('fun t('), strings.indexOf('fun t(') + 200);
  assert.match(declaration, /^fun t\(bengali: String, vararg args: Any\?\): String/,
    't() is declared without an annotation');
  assert.ok(!/@Composable\s*\nfun t\(/.test(strings), 'and is not a composable');
  assert.match(strings, /fun t\(bengali: String, vararg args: Any\?\): String = tNow\(bengali, \*args\)/);
  // The table has to be installed from the root, or a handler would read nothing.
  const main = fs.readFileSync(path.join(APP, 'MainActivity.kt'), 'utf8');
  assert.match(main, /Translations\.install\(table\)/);
});

test('nothing draws a line box inside a text span', () => {
  // `SpanStyle` styles a run inside a paragraph; the line box belongs to the
  // paragraph. Passing one there does not compile.
  const problems = [];
  for (const file of kotlinFiles(APP)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const call of callsOf(text)) {
      if (call.callee.split('.').pop() !== 'SpanStyle') continue;
      if (/lineHeight/.test(call.raw)) problems.push(`${rel(file)}:${lineOf(text, call.open)}`);
    }
  }
  assert.deepEqual(problems, [], 'a span was given a line box');
});
