'use strict';

/**
 * Tests for the shipped English and Bishnupriya Manipuri wording.
 *
 * `backend/assets/lang/{en,bpy}.csv` used to ship with every value blank, so the
 * app fell back to Bengali in both languages. They are filled now, and these
 * tests are what keeps them filled and keeps them honest:
 *
 *   - every key the app looks up has a value in both files (a blank value means
 *     "not translated", which silently shows Bengali to an English reader);
 *   - the `{1}` slots survive — a translation may move them, never drop them;
 *   - the Bengali source column is untouched while it is filled;
 *   - the Bishnupriya column uses the community's own words (the vocabulary
 *     Bishnupriya Manipuri Wikipedia is written in) rather than leaving the
 *     Bengali in place;
 *   - editing the files by hand survives `i18n/build_language_templates.py`,
 *     which is the script that owns their key list.
 *
 * Fixture-free: it reads the three CSVs and, for one case, runs the build script
 * in `--check` mode.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const LANG_DIR = path.join(REPO, 'backend', 'assets', 'lang');

/** A tiny `key,value` reader — quoting, CRLF and a BOM included. */
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
  if (rows.length && rows[0][0].trim().toLowerCase() === 'key') rows.shift();
  return rows.filter((entry) => entry.length >= 2);
}

const bn = parsePairs(fs.readFileSync(path.join(LANG_DIR, 'bn.csv'), 'utf8'));
const en = parsePairs(fs.readFileSync(path.join(LANG_DIR, 'en.csv'), 'utf8'));
const bpy = parsePairs(fs.readFileSync(path.join(LANG_DIR, 'bpy.csv'), 'utf8'));
const bnKeys = bn.map(([key]) => key);
const mapOf = (pairs) => new Map(pairs);
const EN = mapOf(en);
const BPY = mapOf(bpy);
const BN = mapOf(bn);

const SLOTS = ['{1}', '{2}', '{3}'];
/** Terms a translation keeps as it stands: names, and words the community uses in Bengali. */
const KEPT_AS_IS = new Set([
  'ইঞ্চৌঘর',          // the traditional house — the app's own spelling of the name
  'এলাহান বরিক',      // the label the community uses for the song file itself
  'পৌ',               // a category keyword, never shown
  'ফিচা / ড',          // website page title, not wording
  '{1}:{2}',
  'নিংশিং_চে_-_{1}',
  'Choose your language · লাউখোল',
]);

test('the English column is filled, key for key', () => {
  assert.equal(en.length, bnKeys.length, 'en.csv should carry every key');
  const blank = en.filter(([, value]) => !value.trim()).map(([key]) => key);
  assert.deepEqual(blank, [], 'a blank value falls back to Bengali, so there must be none');
  assert.deepEqual(en.map(([key]) => key).sort(), [...bnKeys].sort(), 'the same keys as bn.csv');
  assert.equal(new Set(bnKeys).size, bnKeys.length, 'and no key twice');
});

test('the Bishnupriya column is filled, key for key', () => {
  assert.equal(bpy.length, bnKeys.length, 'bpy.csv should carry every key');
  const blank = bpy.filter(([, value]) => !value.trim()).map(([key]) => key);
  assert.deepEqual(blank, [], 'a blank value falls back to Bengali, so there must be none');
  assert.deepEqual(bpy.map(([key]) => key).sort(), [...bnKeys].sort(), 'the same keys as bn.csv');
});

test('the Bengali key list itself is left alone', () => {
  // Filling the two translations must not rewrite the source column: Bengali is
  // the identity file, and the app looks its literals up by exactly these keys.
  assert.ok(bn.every(([key, value]) => value === key), 'bn.csv still maps every key to itself');
});

test('every {1} slot survives its translation', () => {
  const problems = [];
  for (const key of bnKeys) {
    for (const slot of SLOTS) {
      if (!key.includes(slot)) continue;
      if (!EN.get(key).includes(slot)) problems.push(`en ${key}`);
      if (!BPY.get(key).includes(slot)) problems.push(`bpy ${key}`);
    }
  }
  assert.deepEqual(problems, [], 'a dropped slot prints a sentence with a hole in it');
});

test('numbers, emoji and markdown markers come through', () => {
  // The emoji bullets and the markdown markers are part of the string, not
  // decoration around it: drop one and the sentence changes shape. Bengali
  // digits stay digits in the bpy column (it counts in Bengali too); English is
  // allowed to spell a number out — "three" is a translation of ৩, not a loss.
  const emoji = /📌|❓|🎯|💡|📎/;
  const markdown = /\*\*|_/;
  const digit = /[\u09e6-\u09ef\d]/;
  const problems = [];
  for (const key of bnKeys) {
    if (emoji.test(key) && (!emoji.test(EN.get(key)) || !emoji.test(BPY.get(key)))) problems.push(`emoji ${key}`);
    if (markdown.test(key) && (!markdown.test(EN.get(key)) || !markdown.test(BPY.get(key)))) problems.push(`markdown ${key}`);
    if (digit.test(key) && !digit.test(BPY.get(key))) problems.push(`digit ${key}`);
  }
  assert.deepEqual(problems, [], 'digits, the emoji bullets and the markdown markers stay');
});

test('the English column is English', () => {
  const bengali = (value) => value.replace(/[\s\p{P}\d{}]/gu, '').length > 0
    && [...value].filter((ch) => '\u0980' <= ch && ch <= '\u09ff').length / value.length > 0.6;
  const left = en.filter(([key, value]) => bengali(value) && !KEPT_AS_IS.has(key))
    .map(([key]) => key);
  assert.deepEqual(left, [], 'only the named terms are allowed to stay in Bengali script');
});

test('the Bishnupriya column reads as Bishnupriya, not as Bengali', () => {
  // The community's own vocabulary, taken from Bishnupriya Manipuri Wikipedia's
  // interface and articles. If a row falls back to the Bengali word, these catch it.
  const words = [
    ['য়্যারী', /য়্যারী|আলোচনা/],           // discussion
    ['সব → হাবি', /হাবি|সব/],                // all
    ['নাম → নাঙ', /নাঙ|নাম/],                // name
    ['write → ইকর', /ইকর|লিখ/],              // write
    ['save → ইতু', /ইতু|সংরক্ষণ/],           // save / keep
    ['error → লালুইসে', /লালুইসে|ত্রুটি/],    // error
    ['next → থাংনাত', /থাংনাত|পরবর্তী/],      // next
    ['search → বিসারা', /বিসারা|খোঁজ|অনুসন্ধান/], // search
    ['login → হমানি', /হমানি|প্রবেশ|সাইন ইন/],   // sign in
    ['about → বারে', /বারে|সম্পর্কে/],        // about
    ['link → মিলাপ', /মিলাপ|লিংক/],          // link
    ['user → আতাকুরা', /আতাকুরা|ব্যবহারকারী/], // user
    ['language → ঠার', /ঠার|ভাষা/],          // language
    ['category → বিভাগ', /বিভাগ|ক্যাটাগরি/],  // category
  ];
  const bengaliOnly = [];
  for (const [name, either] of words) {
    const usesBpy = bpy.some(([, value]) => either.test(value));
    assert.ok(usesBpy, `the bpy column should use ${name}`);
    // And the file as a whole should prefer the bpy form over the Bengali one.
    const count = (re) => bpy.reduce((n, [, value]) => n + (re.test(value) ? 1 : 0), 0);
    if (name === 'সব → হাবি') {
      assert.ok(count(/হাবি/) > 20, `the bpy column uses হাবি throughout, got ${count(/হাবি/)}`);
    }
    if (name === 'link → মিলাপ') bengaliOnly.push(count(/লিংক/));
  }
  assert.ok(bengaliOnly.every((n) => n <= 6), 'মিলাপ is the word for a link, with লিংক only in file names');
});

test('filling by hand survives the script that owns the key list', () => {
  // `build_language_templates.py` regenerates these files from the string
  // inventory and carries existing wording over. Run its check: a filled file
  // that the script would rewrite means the next regeneration would drop it.
  const out = execFileSync('python3', ['i18n/build_language_templates.py', '--check'],
    { cwd: REPO, encoding: 'utf8' });
  assert.equal(out.trim(), '', 'the templates are exactly what the script would write');
});
