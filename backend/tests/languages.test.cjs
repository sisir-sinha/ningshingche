'use strict';

/**
 * Tests for the Languages page CSV reader/writer (assets/js/languages.js).
 *
 * The parser is the part of that page that can silently corrupt a language
 * file, and the file it reads is edited in spreadsheets — so quoting, CRLF,
 * BOM and duplicate handling are pinned down here. Fixture-only: the module is
 * loaded with a stubbed window.NC and never touches the network.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCRIPT = path.join(__dirname, '..', 'assets', 'js', 'languages.js');

function load() {
  const sandbox = { window: { NC: { views: {}, utils: {} } }, document: { createElement: () => ({}) }, fetch: async () => ({ ok: false }), URL: { createObjectURL: () => '', revokeObjectURL: () => {} }, Blob: class {}, console };
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

test('parsePairs reads a plain key,value file and skips the header', () => {
  const pairs = pairsOf('key,value\nগান,Elahan\nশিরোনাম,Title\n');
  assert.deepEqual(pairs, [['গান', 'Elahan'], ['শিরোনাম', 'Title']]);
});

test('parsePairs keeps a comma inside a quoted value', () => {
  const pairs = pairsOf('key,value\n"শিরোনাম, বই","Title, book"\n');
  assert.deepEqual(pairs, [['শিরোনাম, বই', 'Title, book']]);
});

test('parsePairs handles doubled quotes and embedded newlines', () => {
  const pairs = pairsOf('key,value\n"বলো ""হ্যাঁ""","say\nhello"\n');
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0][0], 'বলো "হ্যাঁ"');
  assert.equal(pairs[0][1], 'say\nhello');
});

test('parsePairs tolerates CRLF, a BOM and blank trailing lines', () => {
  const pairs = pairsOf('\uFEFFkey,value\r\nগান,Elahan\r\n\r\n');
  assert.deepEqual(pairs, [['গান', 'Elahan']]);
});

test('parsePairs keeps an empty value instead of dropping the key', () => {
  const pairs = pairsOf('key,value\nগান,\nনতুন,New\n');
  assert.deepEqual(pairs, [['গান', ''], ['নতুন', 'New']]);
});

test('summarise counts translated and empty values', () => {
  assert.deepEqual(summaryOf('key,value\nএক,One\nদুই,\nতিন,Three\n'), { total: 3, translated: 2, missing: 1 });
});

test('reference comparison reports missing and extra keys', () => {
  const diff = api.compareWithReference(
    pairsOf('key,value\nগান,Elahan\nনতুন,Nokwa\n'),
    ['গান', 'শিরোনাম']
  );
  assert.deepEqual(Array.from(diff.missing), ['শিরোনাম']);
  assert.deepEqual(Array.from(diff.extra), ['নতুন']);
});

test('writeCSV quotes only the cells that need it and round-trips', () => {
  const csv = api.writeCSV([['গান', 'Elahan'], ['শিরোনাম, বই', 'Title, book'], ['লাইন', 'a\nb']]);
  assert.match(csv, /^key,value\n/);
  assert.match(csv, /গান,Elahan\n/);
  assert.match(csv, /"শিরোনাম, বই","Title, book"\n/);
  const back = pairsOf(csv);
  assert.deepEqual(back, [['গান', 'Elahan'], ['শিরোনাম, বই', 'Title, book'], ['লাইন', 'a\nb']]);
});

test('a row without a comma is reported rather than silently merged', () => {
  const pairs = pairsOf('key,value\nগান\n');
  assert.deepEqual(pairs, [['গান', '']]);
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
