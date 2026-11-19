'use strict';

/**
 * No real API key in the source.
 *
 * The ImgBB key was committed to a public repository and compiled into every APK.
 * One key, used by everyone who cloned the project, is the pattern ImgBB's abuse
 * detection blocks — and it did: uploads began answering
 *
 *     code 103, "You have been forbidden to use this website."
 *
 * Note what that code means. A malformed key answers `100, Invalid API v1 key`;
 * `103` means the key was recognised and the account behind it was banned. The
 * same mistake is sitting in the git history of both the keystore and this key,
 * so the check below is deliberately strict about the shapes that leak.
 *
 * The same reasoning applies to GEMINI_API_KEY and OPENROUTER_API_KEY: a billable
 * key inside an APK is a key somebody else can spend.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const APP = path.join(REPO, 'app', 'src', 'main', 'java');

function kotlinFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...kotlinFiles(full));
    else if (entry.name.endsWith('.kt')) out.push(full);
  }
  return out;
}

/** Real-looking secrets, by shape. A placeholder cannot match these. */
const SHAPES = [
  ['ImgBB key', /["']([0-9a-f]{32})["']/g],
  ['Google API key', /["'](AIza[0-9A-Za-z_-]{30,})["']/g],
  ['OpenRouter key', /["'](sk-or-v1-[0-9a-f]{32,})["']/g],
  ['long hex secret', /["']([0-9a-f]{40,})["']/g],
];

/** Files allowed to name a key: none. A comment cannot match these shapes. */
test('no source file carries a real-looking API key', () => {
  const problems = [];
  for (const file of kotlinFiles(APP)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [label, pattern] of SHAPES) {
      for (const match of text.matchAll(pattern)) {
        // The published Supabase publishable key is designed to be public — it is
        // the "anon" credential, safe in a client, and RLS is what protects data.
        if (match[1].includes('jqJACnQHmCMcGjt0kG6Sug')) continue;
        const line = text.slice(0, match.index).split('\n').length;
        problems.push(`${path.relative(REPO, file)}:${line}  ${label}`);
      }
    }
  }
  assert.deepEqual(problems, [], 'a real key is committed to the source');
});

test('the ImgBB default is empty, so a build without one says so', () => {
  const config = fs.readFileSync(
    path.join(APP, 'com', 'ningshingche', 'app', 'data', 'remote', 'SupabaseConfig.kt'), 'utf8');
  assert.match(config, /const val DEFAULT_IMGBB_API_KEY = ""/,
    'DEFAULT_IMGBB_API_KEY must be empty — the key belongs in .env');
  const uploader = fs.readFileSync(
    path.join(APP, 'com', 'ningshingche', 'app', 'data', 'remote', 'ImgBbUploader.kt'), 'utf8');
  assert.match(uploader, /apiKey\.isBlank\(\)/, 'an unset key is not refused before the call');
});

test('.env.example ships placeholders, never a working key', () => {
  const example = fs.readFileSync(path.join(REPO, '.env.example'), 'utf8');
  assert.ok(!/IMGBB_API_KEY=[0-9a-f]{32}/.test(example), '.env.example carries a real ImgBB key');
  assert.ok(!/GEMINI_API_KEY=AIza/.test(example), '.env.example carries a real Gemini key');
  assert.match(example, /IMGBB_API_KEY=MY_/, 'the ImgBB line is not a placeholder');
});

test('a blocked key is reported as blocked, not as invalid', () => {
  // The two ImgBB answers mean different things (§ above), and the wrong one sends
  // the owner to regenerate a key that is already fine.
  const uploader = fs.readFileSync(
    path.join(APP, 'com', 'ningshingche', 'app', 'data', 'remote', 'ImgBbUploader.kt'), 'utf8');
  assert.match(uploader, /== 103/, 'nothing distinguishes a blocked account from a bad key');
  assert.match(uploader, /ব্লক/, 'and the message does not say the key was blocked');
});
