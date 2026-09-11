'use strict';

/**
 * Tests for the Languages page's CSV layer (assets/js/languages.js).
 *
 * The page edits a grid (#, bpy, bn, en) and stores one `key,value` file per
 * language, which is what the app downloads — so the two shapes have to convert
 * cleanly in both directions, and the reader has to survive what a spreadsheet
 * produces: quoting, CRLF, a BOM, embedded newlines.
 *
 * Fixture-only: the module is loaded with a stubbed window.NC, no network.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPT = path.join(__dirname, '..', 'assets', 'js', 'languages.js');

function load() {
  const sandbox = {
    window: { NC: { views: {}, utils: {} } },
    document: { createElement: () => ({}) },
    fetch: async () => ({ ok: false }),
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    Blob: class {},
    console
  };
  sandbox.window.NC.utils = { escapeHTML: (value) => String(value ?? '') };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SCRIPT, 'utf8'), sandbox, { filename: 'languages.js' });
  return sandbox.window.NC.languageFiles;
}

const api = load();

/**
 * The sandbox has its own Array/Object prototypes, and `assert.deepEqual` from
 * `node:assert/strict` compares prototypes — so every value crossing the vm
 * boundary is rebuilt with the host's `Array.from` before it is asserted on.
 */
const pairsOf = (csv) => Array.from(api.parsePairs(csv), (pair) => Array.from(pair));
const summaryOf = (csv) => ({ ...api.summarise(api.parsePairs(csv)) });
const matrixOf = (csv) => Array.from(api.buildMatrix(['গান', 'শিরোনাম'], { en: { গান: 'Elahan' } }))
  .map((entry) => ({ ...entry, values: { ...entry.values } }));

test('parsePairs reads a plain key,value file and skips the header', () => {
  assert.deepEqual(pairsOf('key,value\nগান,Elahan\nশিরোনাম,Title\n'), [['গান', 'Elahan'], ['শিরোনাম', 'Title']]);
});

test('parsePairs keeps a comma inside a quoted value', () => {
  assert.deepEqual(pairsOf('key,value\n"শিরোনাম, বই","Title, book"\n'), [['শিরোনাম, বই', 'Title, book']]);
});

test('parsePairs handles doubled quotes and embedded newlines', () => {
  const pairs = pairsOf('key,value\n"বলো ""হ্যাঁ""","say\nhello"\n');
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0][0], 'বলো "হ্যাঁ"');
  assert.equal(pairs[0][1], 'say\nhello');
});

test('parsePairs tolerates CRLF, a BOM and blank trailing lines', () => {
  assert.deepEqual(pairsOf('\uFEFFkey,value\r\nগান,Elahan\r\n\r\n'), [['গান', 'Elahan']]);
});

test('parsePairs keeps an empty value instead of dropping the key', () => {
  assert.deepEqual(pairsOf('key,value\nগান,\nনতুন,New\n'), [['গান', ''], ['নতুন', 'New']]);
});

test('summarise counts translated and empty values', () => {
  assert.deepEqual(summaryOf('key,value\nএক,One\nদুই,\nতিন,Three\n'), { total: 3, translated: 2, missing: 1 });
});

test('writeCSV quotes only the cells that need it and round-trips', () => {
  const csv = api.writeCSV([['গান', 'Elahan'], ['শিরোনাম, বই', 'Title, book'], ['লাইন', 'a\nb']]);
  assert.match(csv, /^key,value\n/);
  assert.match(csv, /গান,Elahan\n/);
  assert.match(csv, /"শিরোনাম, বই","Title, book"\n/);
  assert.deepEqual(pairsOf(csv), [['গান', 'Elahan'], ['শিরোনাম, বই', 'Title, book'], ['লাইন', 'a\nb']]);
});

test('buildMatrix lines a key list up with one value per language', () => {
  const matrix = matrixOf('key,value\n');
  assert.deepEqual(Array.from(matrix, (entry) => entry.key), ['গান', 'শিরোনাম']);
  assert.equal(matrix[0].values.en, 'Elahan');
  assert.equal(matrix[0].values.bpy, '');
  assert.equal(matrix[1].values.en, undefined === '' ? undefined : '');
  assert.equal(typeof matrix[0].values.bn, 'string');
});

test('matrixCsv writes the sheet shape — #, bpy, bn, en — with quoting', () => {
  const csv = api.matrixCsv([
    { key: 'গান', known: true, values: { bpy: 'এলাহান', bn: 'গান', en: 'Song' } },
    { key: 'শিরোনাম, বই', known: true, values: { bpy: '', bn: 'শিরোনাম, বই', en: 'Title, book' } }
  ]);
  const lines = csv.split('\n');
  assert.equal(lines[0], '#,bpy,bn,en,key', 'the app’s own string rides along in one extra column');
  assert.equal(lines[1], '1,এলাহান,গান,Song,', 'untouched Bengali leaves the key column empty');
  assert.equal(lines[2], '2,,"শিরোনাম, বই","Title, book",');
});

test('matrixCsv names the app’s own string once the Bengali has been rewritten', () => {
  const csv = api.matrixCsv([
    { key: 'লেখক', known: true, values: { bpy: 'লেকক', bn: 'লেখকবৃন্দ', en: 'Authors' } }
  ]);
  const lines = csv.split('\n');
  assert.equal(lines[1], '1,লেকক,লেখকবৃন্দ,Authors,লেখক', 'the rewrite and its key are both on the sheet');
  // And the sheet reads back as the same row, not as a new string called
  // "লেখকবৃন্দ" — which is what would happen if the Bengali cell were the key.
  const parsed = api.parseMatrix(csv);
  assert.deepEqual(Array.from(parsed.keys), ['লেখক']);
  assert.equal(parsed.values.bn['লেখক'], 'লেখকবৃন্দ');
  assert.equal(parsed.values.en['লেখক'], 'Authors');
});

test('import falls back to the Bengali column when the sheet has no key column', () => {
  // The owner's own sheet: four columns, the Bengali cell doubling as the key.
  const parsed = api.parseMatrix('#,bpy,bn,en\n1,লেকক,লেখক,Authors\n');
  assert.deepEqual(Array.from(parsed.keys), ['লেখক']);
  assert.equal(parsed.values.bn['লেখক'], 'লেখক');
  assert.equal(parsed.values.bpy['লেখক'], 'লেকক');
});

test('a sheet written by the page imports back unchanged', () => {
  const rows = [
    { key: 'অন্য শব্দে চেষ্টা করুন', values: { bpy: 'আরাক ওয়াহিদ, চেষ্টা করিক', bn: 'অন্য শব্দে চেষ্টা করুন', en: 'Try another word' } },
    { key: 'অনুসন্ধান', values: { bpy: 'বিসারিক', bn: 'অনুসন্ধান', en: 'Search' } }
  ];
  const parsed = api.parseMatrix(api.matrixCsv(rows));
  assert.deepEqual(Array.from(parsed.keys), ['অন্য শব্দে চেষ্টা করুন', 'অনুসন্ধান']);
  assert.equal(parsed.values.bpy['অনুসন্ধান'], 'বিসারিক');
  assert.equal(parsed.values.en['অনুসন্ধান'], 'Search');
  assert.equal(parsed.values.bn['অনুসন্ধান'], 'অনুসন্ধান');
});

test('import accepts the owner’s sheet, commas and all', () => {
  // The screenshot's columns — #, bpy, bn, en — including a value with a comma in
  // it, which is how a spreadsheet exports it.
  const parsed = api.parseMatrix(
    '#,bpy,bn,en\n' +
    '1,"আরাক ওয়াহিদ, চেষ্টা করিক",অন্য শব্দে চেষ্টা করুন,Try another word\n' +
    '2,বিসারিক,অনুসন্ধান,Search\n'
  );
  assert.equal(parsed.values.bpy['অন্য শব্দে চেষ্টা করুন'], 'আরাক ওয়াহিদ, চেষ্টা করিক');
  assert.equal(parsed.values.bpy['অনুসন্ধান'], 'বিসারিক');
  assert.equal(parsed.values.en['অন্য শব্দে চেষ্টা করুন'], 'Try another word');
});

test('import matches columns by name, in any order, ignoring extras', () => {
  const parsed = api.parseMatrix('en,notes,bn\nSong,ignore me,গান\n');
  assert.deepEqual(Array.from(parsed.keys), ['গান']);
  assert.equal(parsed.values.en['গান'], 'Song');
  assert.equal(parsed.values.bn['গান'], 'গান');
});

test('import accepts a single language’s key,value file', () => {
  const parsed = api.parseMatrix('key,value\nগান,Elahan\n');
  assert.equal(parsed, null, 'a bare key,value file names no language');

  const named = api.parseMatrix('key,en\nগান,Song\n');
  assert.equal(named.values.en['গান'], 'Song');
  assert.equal(named.values.bn['গান'], 'গান', 'the key is the Bengali source');
});

test('a sheet with no Bengali column and no language header is rejected', () => {
  assert.equal(api.parseMatrix('foo,bar\n1,2\n'), null);
  assert.equal(api.parseMatrix(''), null);
});

test('the shipped templates parse and keep every key', () => {
  const dir = path.join(__dirname, '..', 'assets', 'lang');
  ['bn.csv', 'en.csv', 'bpy.csv'].forEach((name) => {
    const pairs = pairsOf(fs.readFileSync(path.join(dir, name), 'utf8'));
    assert.ok(pairs.length > 500, `${name} should carry the full key list, got ${pairs.length}`);
    assert.equal(new Set(pairs.map(([key]) => key)).size, pairs.length, `${name} has duplicate keys`);
    if (name === 'bn.csv') {
      assert.ok(pairs.every(([key, value]) => key === value), 'bn.csv should map every key to itself');
    } else {
      assert.ok(pairs.every(([, value]) => value === ''), `${name} should ship empty values`);
    }
  });
});
