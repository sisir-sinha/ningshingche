'use strict';

/**
 * Tests for the interface-language swap: picking English or Bishnupriya Manipuri
 * in Settings has to change what the app says, not only what it remembers.
 *
 * The wording itself lives in `backend/assets/lang/{en,bpy}.csv` (see
 * app-language-fill.test.cjs). This file is about the app *reaching* it. The
 * translations are packaged inside the APK as `app/src/main/assets/i18n/*.csv`,
 * so the swap works on a fresh install and offline — before anybody has pressed
 * Save on the dashboard's Languages page, which is the only other source.
 *
 * Two kinds of test here:
 *
 *   - the packaged copy is really the committed translation, byte for byte, so
 *     the two can never drift apart (the repository parses exactly this shape:
 *     `key,value`, header included, no blank values);
 *   - the repository reads them in the right order — a published file wins, the
 *     packaged copy answers when nothing is published, and an empty row (which
 *     is what every row in `app_language_files` looks like until it is saved)
 *     never blanks a table the app already has.
 *
 * Fixture-free: it reads the CSVs and the Kotlin source.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const LANG_DIR = path.join(REPO, 'backend', 'assets', 'lang');
const ASSET_DIR = path.join(REPO, 'app', 'src', 'main', 'assets', 'i18n');
const REPOSITORY = path.join(
  REPO, 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app', 'data', 'i18n',
  'TranslationRepository.kt'
);

const repository = fs.readFileSync(REPOSITORY, 'utf8');
const LANGUAGES = ['en', 'bpy'];

/** A tiny `key,value` reader, the same shape the app parses. */
function parsePairs(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const header = rows.length && rows[0][0].trim().toLowerCase() === 'key';
  if (header) rows.shift();
  return { header, rows: rows.filter((entry) => entry.length >= 2) };
}

test('the translations travel inside the app', () => {
  // The whole reason the swap did nothing: the files existed in the repository,
  // and the only copy the app could read was the one on the server, which was —
  // and until somebody presses Save, still is — empty.
  for (const code of LANGUAGES) {
    const asset = path.join(ASSET_DIR, `${code}.csv`);
    assert.ok(fs.existsSync(asset), `app/src/main/assets/i18n/${code}.csv is missing`);
    const packaged = fs.readFileSync(asset);
    const committed = fs.readFileSync(path.join(LANG_DIR, `${code}.csv`));
    assert.equal(
      Buffer.compare(packaged, committed), 0,
      `${code}.csv in the app differs from the committed translation — copy it again`
    );
  }
});

test('the packaged files are the shape the app parses', () => {
  for (const code of LANGUAGES) {
    const { header, rows } = parsePairs(fs.readFileSync(path.join(ASSET_DIR, `${code}.csv`), 'utf8'));
    // parseCsv() drops the header only when the first cell reads `key`; if the
    // header ever changed, `key` itself would become a translation.
    assert.equal(header, true, `${code}.csv should open with a key,value header row`);
    const source = parsePairs(fs.readFileSync(path.join(LANG_DIR, 'bn.csv'), 'utf8')).rows;
    assert.equal(rows.length, source.length, `${code}.csv should carry every key the app says`);
    const blank = rows.filter(([, value]) => !value.trim()).map(([key]) => key);
    assert.deepEqual(blank, [], 'a blank value is what makes the app fall back to Bengali');
    assert.equal(new Set(rows.map(([key]) => key)).size, rows.length, 'and no key twice');
  }
});

test('swapping languages actually changes the words', () => {
  // A file of 941 rows that all read as the Bengali source would parse cleanly
  // and swap nothing. Both packaged languages have to be doing real work.
  for (const code of LANGUAGES) {
    const rows = parsePairs(fs.readFileSync(path.join(ASSET_DIR, `${code}.csv`), 'utf8')).rows;
    const changed = rows.filter(([key, value]) => key !== value).length;
    assert.ok(changed > 500, `${code}.csv only differs from Bengali in ${changed} rows`);
  }
});

test('the app reads the copy it was shipped with', () => {
  // The packaged copy is read from assets under the language's own code, which
  // is the same `code()` the request uses — one name for a language everywhere.
  assert.match(repository, /private const val ASSET_DIR = "i18n"/);
  assert.match(repository, /assets\.open\("\$ASSET_DIR\/\$\{language\.code\(\)\}\.csv"\)/);
  assert.match(repository, /ContentLanguage\.ENGLISH -> "en"/);
  assert.match(repository, /ContentLanguage\.BISHNUPRIYA -> "bpy"/);
  assert.ok(
    fs.existsSync(path.join(ASSET_DIR, 'bn.csv')) === false,
    'Bengali needs no packaged copy: the compiled strings are already Bengali'
  );
});

test('the packaged copy is in place before the request goes out', () => {
  // Offline first: the swap shows the right language immediately, and the
  // network is only ever an improvement on it.
  const strings = repository.slice(repository.indexOf('fun strings('));
  const body = strings.slice(0, strings.indexOf('return flow'));
  assert.match(body, /val base = readCache\(language\)\.ifEmpty \{ packaged\(language\) \}/);
  assert.match(body, /if \(base\.isNotEmpty\(\)\) flow\.value = base/);
  assert.match(body, /refresh\(language\)/);
  assert.ok(
    body.indexOf('packaged(language)') < body.indexOf('refresh(language)'),
    'the packaged table has to land before the fetch, not after it'
  );
});

test('a published file wins over the packaged one, and a blank row changes nothing', () => {
  const refresh = repository.slice(repository.indexOf('suspend fun refresh('));
  const body = refresh.slice(0, refresh.indexOf('\n    }'));
  // Published first (with the freshness test on the row, not on the response):
  assert.match(body, /published != null && published\.csv\.isNotBlank\(\)/);
  assert.match(body, /writeCache\(language, published\.csv\)/);
  assert.match(body, /flow\.value = published\.table/);
  // And nothing is written to the flow from a blank row: the only other line
  // that assigns a table is the packaged fallback, and only when the app has none.
  const assignments = body.match(/flow\.value = /g) || [];
  assert.equal(assignments.length, 2, 'exactly two ways a table is put in force');
  assert.match(body, /flow\.value\.isEmpty\(\) -> flow\.value = packaged\(language\)/);

  // The blank has to survive the fetch as a blank, or the caller cannot tell
  // "this language has no strings" from "nobody has published it yet".
  assert.match(
    repository,
    /Result\.success\(Published\(csv, if \(csv\.isBlank\(\)\) emptyMap\(\) else parseCsv\(csv\)\)\)/
  );
});

test('the language switch keeps the flow Compose is collecting', () => {
  // Compose keys its collection on the StateFlow instance: a fresh wrapper per
  // recomposition would re-subscribe on every frame, and a swap would stutter.
  assert.match(repository, /private val flows = ConcurrentHashMap<ContentLanguage, MutableStateFlow<Map<String, String>>>\(\)/);
  assert.match(repository, /val flow = flows\.getOrPut\(language\) \{ MutableStateFlow<Map<String, String>>\(emptyMap\(\)\) \}/);
  assert.match(repository, /return flow$/m);
});

test('everything the reader can pick has a way to speak', () => {
  // Bengali is compiled in; the other two are only as good as their packaged
  // file. Both are in the APK, so all three choices show something.
  const files = fs.readdirSync(ASSET_DIR).sort();
  assert.deepEqual(files, ['bpy.csv', 'en.csv']);
  for (const code of LANGUAGES) {
    const size = fs.statSync(path.join(ASSET_DIR, `${code}.csv`)).size;
    assert.ok(size > 40000, `${code}.csv looks truncated (${size} bytes)`);
  }
});

test('the whole interface speaks, and only names stay Bengali', () => {
  // The app says 1,144 strings. The inventory knows which of them are interface
  // and which are content — paper titles, author names, section headings that
  // come from the database and are the same in every language. Every interface
  // string has to resolve in both packaged files; if one does not, swapping the
  // language leaves a Bengali line in the middle of an English screen.
  const inventory = parsePairs(
    fs.readFileSync(path.join(REPO, 'i18n', 'strings_inventory.csv'), 'utf8')
      .replace(/^bengali,bishnupriya,/, 'key,value,')      // it has its own header
  ).rows.map((cells) => ({ key: cells[0], kind: cells[2] }));
  assert.ok(inventory.length > 1000, 'the inventory should still be the app-wide list');

  for (const code of LANGUAGES) {
    const table = new Map(parsePairs(fs.readFileSync(path.join(ASSET_DIR, `${code}.csv`), 'utf8')).rows);
    const missing = inventory.filter((row) => row.kind === 'ui' && !table.has(row.key));
    assert.deepEqual(
      missing.map((row) => row.key), [],
      `${code}: an interface string the app can never translate`
    );
    const content = inventory.filter((row) => row.kind !== 'ui');
    assert.ok(content.length > 0 && content.every((row) => !table.has(row.key)),
      'content strings (names, headings) are not the language file\'s business');
  }
});

/**
 * The swap only works where the app *asks* for a translation.
 *
 * A Bengali literal that is never passed through `t()` or `tNow()` is invisible
 * to the language files: the reader picks English and that line stays Bengali.
 * This is the guard for that — every Bengali literal in the interface is either
 * wired to the table or named here with the reason it is not.
 */
const APP_SRC = path.join(REPO, 'app', 'src', 'main', 'java');
const SWEEP_DIRS = ['ui/', 'notifications/', 'util/'];

/** Publication text: names and standing copy, the same in every language. */
const CONTENT_FILES = new Set(['NinghsingCheContentData.kt', 'AuthorProfiles.kt', 'SiteContact.kt']);

/** Bengali that is not copy a reader reads off a screen. */
const NOT_COPY = [
  'নমস্কার',                                   // the model's prompt, not a label
  'নিংশিং চে — বিষ্ণুপ্রিয়া মণিপুরি সাহিত্য ও সংস্কৃতি পোর্টাল',   // a share link's text
  'নিংশিং চে',                                 // the app's name, used as a value
  'নিংশিংচে',                                  // an issue key's prefix
  'সব সংরক্ষিত',                                // a folder name the code compares
  'পৌ', 'ফিচা / ড', 'এলাহান বরিক', 'ইঞ্চৌঘর', 'নিংশিং_চে_-_{1}',
];

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

/** Every string literal in a file, with what it sits inside. */
function bengaliLiterals(text) {
  const found = [];
  const source = text;
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('//', i)) { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (source.startsWith('/*', i)) { const j = source.indexOf('*/', i + 2); i = j < 0 ? source.length : j + 2; continue; }
    if (source[i] !== '"') { i += 1; continue; }
    let j = i + 1;
    let raw = '';
    let closed = false;
    while (j < source.length) {
      if (source[j] === '\\') { raw += source[j + 1]; j += 2; continue; }
      if (source[j] === '"') { closed = true; break; }
      if (source[j] === '\n') break;
      raw += source[j];
      j += 1;
    }
    if (!closed) { i = j + 1; continue; }
    if (/[\u0980-\u09FF]/.test(raw)) {
      const before = source.slice(Math.max(0, i - 120), i);   // a call may open a line above
      found.push({ raw, wrapped: /(?:^|[^A-Za-z0-9_.])(?:t|tNow)\(\s*$/.test(before),
                   line: source.slice(0, i).split('\n').length });
    }
    i = j + 1;
  }
  return found;
}

test('every Bengali literal in the interface is wired to the language files', () => {
  const unwired = [];
  let wired = 0;
  for (const file of kotlinFiles(APP_SRC)) {
    const rel = path.relative(path.join(APP_SRC, 'com', 'ningshingche', 'app'), file).split(path.sep).join('/');
    const name = path.basename(file);
    if (CONTENT_FILES.has(name) || !SWEEP_DIRS.some((dir) => rel.startsWith(dir))) continue;
    for (const found of bengaliLiterals(fs.readFileSync(file, 'utf8'))) {
      if (found.wrapped) { wired += 1; continue; }
      if (NOT_COPY.some((kept) => found.raw.includes(kept))) continue;
      // Single letters, digit tables and digests are values, not copy.
      if (found.raw.trim().length <= 2) continue;
      if (/^[\u09E6-\u09EF\s]+$/.test(found.raw)) continue;
      unwired.push(`${rel}:${found.line}  ${found.raw.slice(0, 60)}`);
    }
  }
  assert.ok(wired > 900, `only ${wired} literals reach the language files`);
  assert.deepEqual(unwired, [], 'a screen still shows a Bengali literal no language file can change');
});

test('every wired string has somewhere to be translated', () => {
  // A call site with no row falls back to Bengali for ever, silently.
  const rows = new Map(parsePairs(fs.readFileSync(path.join(LANG_DIR, 'bn.csv'), 'utf8')).rows);
  const missing = [];
  for (const file of kotlinFiles(APP_SRC)) {
    const name = path.basename(file);
    const rel = path.relative(path.join(APP_SRC, 'com', 'ningshingche', 'app'), file).split(path.sep).join('/');
    if (CONTENT_FILES.has(name) || !SWEEP_DIRS.some((dir) => rel.startsWith(dir))) continue;
    for (const found of bengaliLiterals(fs.readFileSync(file, 'utf8'))) {
      if (!found.wrapped) continue;
      const key = found.raw.replace(/\$\{([^}]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
        (() => { let n = 0; return () => `{${++n}}`; })()).trim();
      // A string with no letters in it — a time like `{1}:{2}`, a bare number — has
      // nothing to translate and needs no row.
      if (!/[\p{L}]/u.test(key)) continue;
      if (!rows.has(key)) missing.push(`${rel}:${found.line}  ${key.slice(0, 60)}`);
    }
  }
  assert.deepEqual(missing, [], 'wired to a key the language files do not carry');
});

test('a language swap rebuilds the screens, not only the strings it happens to redraw', () => {
  // Strings looked up with tNow() come from click handlers and view models, where
  // no composable may run. The graph is keyed on the table so those screens are
  // rebuilt when the language changes, and the controller is remembered above it
  // so the reader's place in the app survives.
  const host = fs.readFileSync(path.join(SWEEP_DIRS.length ? APP_SRC : APP_SRC,
    'com', 'ningshingche', 'app', 'ui', 'reader', 'ReaderNavHost.kt'), 'utf8');
  const controller = host.indexOf('val navController = rememberNavController()');
  const table = host.indexOf('val translations = LocalTranslations.current');
  const keyed = host.indexOf('key(translations) {');
  assert.ok(controller >= 0 && table >= 0 && keyed >= 0, 'the graph reads and keys on the table');
  assert.ok(controller < keyed && table < keyed, 'both are read above the keyed graph');
  assert.match(host, /import androidx\.compose\.runtime\.key/);
});

test('a wired string has no template left inside it', () => {
  // `t("গান ${count}টি")` would interpolate before the lookup, so the key it asks
  // for is one no row can carry — it looks wired and translates nothing. The slots
  // have to be written as `{1}` with the value passed as an argument.
  const problems = [];
  for (const file of kotlinFiles(APP_SRC)) {
    const rel = path.relative(path.join(APP_SRC, 'com', 'ningshingche', 'app'), file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?<![A-Za-z0-9_.])(?:t|tNow)\(\s*"((?:[^"\\\n]|\\.)*)"/g)) {
      if (match[1].includes('$')) problems.push(`${rel}  ${match[1].slice(0, 60)}`);
    }
  }
  assert.deepEqual(problems, [], 'a string that is filled in before it is looked up');
});
