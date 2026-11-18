'use strict';

/**
 * The published policy has to describe what the app actually does.
 *
 * Play checks two things against reality, and either mismatch is a rejection:
 * the privacy-policy URL must load without a login, and the policy must match the
 * Data safety declaration *and* the app's behaviour. Both have already gone wrong
 * once on this project:
 *
 *   - `PRIVACY_URL` pointed at the homepage for a release, and `/privacy` returned
 *     404 — a homepage is a standard rejection.
 *   - The policy described Google Sign-In only, and kept saying so after email and
 *     password accounts shipped. A policy that names one sign-in method while the
 *     app offers two is inaccurate in exactly the way reviewers read for.
 *
 * These are file checks, not a network check: whether the host is up is a deploy
 * question, and the URL shape is what this can guarantee.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const BACKEND = path.join(REPO, 'backend');
const FOOTER = path.join(
  REPO, 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app',
  'ui', 'editorial', 'SiteFooter.kt');

const policy = fs.readFileSync(path.join(BACKEND, 'privacy.html'), 'utf8');
const terms = fs.readFileSync(path.join(BACKEND, 'terms.html'), 'utf8');
const footer = fs.readFileSync(FOOTER, 'utf8');

function urlOf(constant) {
  const match = footer.match(new RegExp(`const val ${constant}\\s*=\\s*"([^"]+)"`));
  assert.ok(match, `${constant} is not declared in SiteFooter`);
  return match[1];
}

// ------------------------------------------------------------------ the URL ---

test('the privacy and terms links are real pages, not the homepage', () => {
  for (const name of ['PRIVACY_URL', 'TERMS_URL', 'ACCOUNT_DELETION_URL']) {
    const url = urlOf(name);
    assert.match(url, /^https:\/\//, `${name} must be https — Play refuses cleartext`);
    const file = url.split('/').pop();
    assert.ok(
      file && file.endsWith('.html'),
      `${name} points at "${url}", which is a directory, not a policy page`
    );
    assert.ok(
      fs.existsSync(path.join(BACKEND, file)),
      `${name} points at backend/${file}, which does not exist`
    );
  }
});

test('the three pages carry their own Bengali and English halves', () => {
  // A reader who cannot read English still has to be able to read what is done
  // with their data, and the community this app serves reads Bengali.
  for (const [file, text] of [['privacy.html', policy], ['terms.html', terms]]) {
    assert.match(text, /id="bn"/, `${file} has no Bengali section`);
    assert.match(text, /id="en"/, `${file} has no English section`);
    assert.ok(/[\u0980-\u09FF]/.test(text), `${file} has no Bengali text at all`);
  }
});

// ------------------------------------------------------------ the disclosures ---

test('the policy names both ways to sign in', () => {
  // The regression this exists for: the app grew email + password accounts and
  // the policy kept saying "Google Sign-In".
  assert.match(policy, /ইমেইল ও পাসওয়ার্ড/, 'the Bengali table does not mention email accounts');
  assert.match(policy, /email address and a password/i, 'the English section does not either');
  assert.match(policy, /Google/, 'and Google is still one of them');
});

test('the policy says a password is stored hashed, and by whom', () => {
  // A policy that collects a password and says nothing about it is the version a
  // reviewer stops on.
  assert.match(policy, /হ্যাশ/, 'the Bengali text does not mention hashing');
  assert.match(policy, /hash/i, 'the English text does not either');
  assert.match(policy, /Supabase/, 'the processor holding it is not named');
});

test('the third parties named are the ones the app really calls', () => {
  // These four are the processors the App content and Data safety answers depend
  // on, so a policy that drops one is a mismatch with the declaration.
  for (const name of ['Supabase', 'Google', 'OpenRouter', 'ImgBB']) {
    assert.ok(policy.includes(name), `the policy no longer names ${name}`);
  }
});

test('the terms describe the same sign-in methods as the policy', () => {
  assert.match(terms, /ইমেইল ও পাসওয়ার্ড/, 'the Bengali terms still say Google only');
  assert.match(terms, /email address and a password/i, 'and so does the English half');
});

test('the account-deletion page is offered from the policy', () => {
  // Play's User Data policy wants a web path that works without the app. The page
  // exists; a policy that never links it is a path nobody can find.
  assert.match(policy, /account-deletion\.html/, 'the policy does not link the deletion page');
});
