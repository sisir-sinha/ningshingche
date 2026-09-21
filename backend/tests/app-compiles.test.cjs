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
const os = require('node:os');

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

// ---------------------------------------------------------------------------
// References that point at something the app no longer has.
//
// This is the shape of the two errors the owner hit next, both of them mine:
// `ArticleRepository` called `NingshingCheWebsiteClient.toBengaliDigits(...)`
// after the numeral helpers moved to `util/`, and three screens imported the
// skeleton layouts from a file that had been deleted on the belief that nothing
// called it. Neither was visible to any test we had, and both stopped the build
// dead. The compiler would have caught them in a second — so this is that second.
//
// A Kotlin file can only mean three things by a name: something declared in its
// own package, something it imported, or a member of a type it imported. The
// first two need the declaration to exist at the top level of some file in that
// package; the third needs the member to exist somewhere in the file that
// declares the type. Both are checked here, on the masked sources.

const KOTLIN_MODIFIERS =
  '(?:@\\w+(?:\\([^()]*\\))?\\s+)*(?:(?:public|internal|private|protected|open|abstract|sealed|data|value|expect|actual|external|inline|operator|infix|suspend|tailrec|const|annotation|enum|companion|lateinit|override|final|vararg|noinline|crossinline)\\s+)*';

function declarationRegex(topLevelOnly) {
  return new RegExp(
    '^' + (topLevelOnly ? '' : '\\s*') + KOTLIN_MODIFIERS +
    '(?:fun|val|var|class|object|interface|typealias)\\s+(?:<[^>]*>\\s*)?(?:[\\w.<>,?\\[\\] ]*?\\.)?(\\w+)\\s*[(:<>{,=]',
    'gm');
}

/**
 * Everything a Kotlin file in `rootDir` names that nothing there declares.
 * Returns `[]` for a tree that compiles.
 */
function danglingReferences(rootDir) {
  const problems = [];
  const files = kotlinFiles(rootDir).map((file) => ({ file, text: masked(fs.readFileSync(file, 'utf8')) }));
  const declared = new Map();      // "pkg.Name" -> file
  const membersOfFile = new Map();
  const typeMembers = new Map();   // app type name -> every name declared in its file
  const extensionMembers = new Map();  // receiver -> extension names (membership only)
  const localTypes = new Map();    // file -> type names declared inside another type there

  for (const { file, text } of files) {
    const pkg = /^package\s+([\w.]+)/m.exec(text);
    if (!pkg) continue;
    let m;
    const members = new Set();
    const memberRe = declarationRegex(false);
    while ((m = memberRe.exec(text)) !== null) members.add(m[1]);
    membersOfFile.set(file, members);

    const topRe = declarationRegex(true);
    while ((m = topRe.exec(text)) !== null) declared.set(`${pkg[1]}.${m[1]}`, file);

    // A type at the left margin is reachable as `Type.member` from another file:
    // an `object`, or a `class`/`interface` whose companion holds the member.
    const global = [];
    for (const re of [/^(?:internal\s+|private\s+|abstract\s+|open\s+|sealed\s+|data\s+)*(?:class|interface)\s+(\w+)/gm,
                      /^(?:internal\s+|private\s+)*object\s+(\w+)(?!\s*:)/gm]) {
      while ((m = re.exec(text)) !== null) global.push(m[1]);
    }
    for (const name of global) {
      if (!typeMembers.has(name)) typeMembers.set(name, new Set());
      for (const member of members) typeMembers.get(name).add(member);
    }

    // `fun BlogDto.toSummary()`, `val ColorScheme.PanelInk` — as far as `Type.name(`
    // is concerned an extension is a member, and it may live in any file. It is
    // recorded separately: the receiver of an extension is often a library type
    // (`Modifier`, `ColorScheme`), and the app cannot know all of such a type's
    // members, so it must never become a receiver to check against.
    for (const re of [/\bfun\s+(?:<[^>]*>\s*)?([\w.]+)\.(\w+)\s*\(/g,
                      /\bval\s+([\w.]+)\.(\w+)\b/g,
                      /\bvar\s+([\w.]+)\.(\w+)\b/g]) {
      while ((m = re.exec(text)) !== null) {
        const receiver = m[1].split('.').pop();
        if (!extensionMembers.has(receiver)) extensionMembers.set(receiver, new Set());
        extensionMembers.get(receiver).add(m[2]);
      }
    }

    // Anything declared *inside* something else is reachable by its simple name
    // only from within this file — `Thread` is both a `data class` here and the
    // system's thread, and only the file that declares it may read it that way.
    const locals = [];
    for (const re of [/^\s+(?:private\s+|internal\s+)*(?:class|interface)\s+(\w+)/gm,
                      /^\s+(?:private\s+|internal\s+)*object\s+(\w+)(?!\s*:)/gm]) {
      while ((m = re.exec(text)) !== null) locals.push(m[1]);
    }
    localTypes.set(file, locals);
  }

  for (const { file, text } of files) {
    const importRe = /^import\s+(com\.ningshingche\.app\.[\w.]+)(?:\s+as\s+\w+)?\s*$/gm;
    let m;
    while ((m = importRe.exec(text)) !== null) {
      const fq = m[1];
      const leaf = fq.split('.').pop();
      if (fq === 'com.ningshingche.app.R' || leaf === 'BuildConfig') continue;   // generated by Gradle
      if (!declared.has(fq)) {
        problems.push(`${relFrom(rootDir, file)}:${lineOf(text, m.index)}: import ${fq} -> nothing declares it`);
      }
    }
    const receivers = new Set([...typeMembers.keys(), ...(localTypes.get(file) || [])]);
    for (const name of receivers) {
      const callRe = new RegExp(`(?<![\\w.])${name}\\.(\\w+)\\s*[(\\{]`, 'g');
      while ((m = callRe.exec(text)) !== null) {
        const member = m[1];
        if (member.startsWith('get') || member.startsWith('set')) continue;      // property accessors
        // `fun BlogDto.toSummary()` declares a usable member; it is not a call on the type.
        const before = text.slice(Math.max(0, m.index - 40), m.index);
        if (/\b(fun|val|var)\s+(?:<[^>]*>\s*)?[\w.]*\.?$/.test(before)) continue;
        if (member === 'valueOf' || member === 'values') continue;              // enum statics Kotlin adds
        const known = new Set([
          ...(typeMembers.get(name) || []),
          ...(extensionMembers.get(name) || []),
          ...((localTypes.get(file) || []).includes(name) ? membersOfFile.get(file) : []),
        ]);
        if (name in {}) continue;
        if (!known.has(member)) {
          problems.push(`${relFrom(rootDir, file)}:${lineOf(text, m.index)}: ${name}.${member}( -> the type has no such member`);
        }
      }
    }
  }
  return problems;
}

function relFrom(rootDir, file) {
  return path.relative(rootDir, file).split(path.sep).join('/');
}

test('every import names something the app still declares', () => {
  // The build stops dead on one of these; the message is the compiler's, given
  // early. Two batches in a row shipped one.
  const problems = danglingReferences(APP).filter((p) => p.includes('-> nothing declares it'));
  assert.deepEqual(problems, []);
});

test('every call on an app object names a member it still has', () => {
  const problems = danglingReferences(APP).filter((p) => p.includes('the type has no such member'));
  assert.deepEqual(problems, []);
});

test('the reference checker finds a dangling import and a removed member', () => {
  // The self-test: a fixture that breaks in exactly the two ways the app broke,
  // so the checker above is never quietly blind. A checker that finds nothing is
  // worthless, and this is the only way to tell the difference from inside a file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apprefs-'));
  try {
    fs.mkdirSync(path.join(dir, 'a'));
    fs.mkdirSync(path.join(dir, 'b'));
    fs.writeFileSync(path.join(dir, 'a', 'Thing.kt'), [
      'package com.ningshingche.app.a',
      '',
      'fun present() = 1',
      '',
      'object Thing {',
      '    fun alive() = 2',
      '}',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'b', 'Use.kt'), [
      'package com.ningshingche.app.b',
      '',
      'import com.ningshingche.app.a.present',       // fine
      'import com.ningshingche.app.a.Gone',          // the deleted file
      'import com.ningshingche.app.a.Thing',
      '',
      'fun use() {',
      '    present()',
      '    Thing.alive()',                            // fine
      '    Thing.removed()',                          // the removed member
      '}',
      '',
    ].join('\n'));

    const problems = danglingReferences(dir);
    assert.equal(problems.length, 2, `expected exactly the two planted breaks, got:\n${problems.join('\n')}`);
    assert.ok(problems.some((p) => p.includes('import com.ningshingche.app.a.Gone')), 'the dangling import is reported');
    assert.ok(problems.some((p) => p.includes('Thing.removed(')), 'the removed member is reported');
    assert.ok(!problems.some((p) => p.includes('present') || p.includes('Thing.alive')), 'the good references are not');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
