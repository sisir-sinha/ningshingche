'use strict';

/**
 * Email and password sign-in, as the sources declare it.
 *
 * The Google flow is covered by `app-reader-session.test.cjs`. This is the second
 * way in, and it has its own ways to go wrong that no other gate would catch:
 *
 *  1. **The recovery step signs the reader in.** Accepting the six-digit code
 *     returns a session, so a screen that navigates on "currentUser != null"
 *     leaves for the app *before* the new password has been set — and the old
 *     password keeps working. The guard for that is asserted here.
 *  2. **A password in a URL.** `/auth/v1` takes a JSON body; a password appended
 *     to a query string lands in access logs and crash reports.
 *  3. **The eight-character rule leaking into sign-in.** A reader whose password
 *     predates the rule must still be able to get in.
 *  4. **An endpoint that no longer exists.** These four paths are the whole API
 *     surface of the feature; a rename in `SupabaseClient` is silent otherwise.
 *
 * Source assertions, like the rest of this folder: they cannot prove the app
 * compiles, and they do not replace a build.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(
  __dirname, '..', '..', 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app');
const read = (...parts) => fs.readFileSync(path.join(APP, ...parts), 'utf8');

const CLIENT = read('data', 'remote', 'SupabaseClient.kt');
const RULES = read('data', 'auth', 'EmailAuth.kt');
const VIEW_MODEL = read('ui', 'viewmodel', 'MainViewModels.kt');
const LOGIN = read('ui', 'screens', 'LoginScreen.kt');
const FORM = read('ui', 'components', 'EmailAuthForm.kt');

/** The body of a `suspend fun name(` … its closing brace, by brace counting. */
function bodyOf(source, name) {
  const start = source.indexOf(`suspend fun ${name}(`);
  if (start < 0) return null;
  let depth = 0;
  let i = source.indexOf('{', start);
  const from = i;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  return null;
}

// ------------------------------------------------------------- the endpoints ---

test('sign-up posts to the auth signup endpoint', () => {
  const body = bodyOf(CLIENT, 'signUpWithEmail');
  assert.ok(body, 'signUpWithEmail is missing from SupabaseClient');
  assert.match(body, /\/signup"/, 'must post to /auth/v1/signup');
  assert.match(body, /EmailAuthRules\.emailProblem\(/, 'validates the address before the call');
  assert.match(body, /EmailAuthRules\.passwordProblem\(/, 'and applies the password rule');
});

test('sign-in uses the password grant, not the signup endpoint', () => {
  const body = bodyOf(CLIENT, 'signInWithEmail');
  assert.ok(body, 'signInWithEmail is missing from SupabaseClient');
  assert.match(body, /grant_type=password/, 'the grant type decides which endpoint answers');
  assert.ok(
    !body.includes('/signup"'),
    'signing in must never hit the signup endpoint — that would create the account instead'
  );
});

test('recovery asks for a code, then exchanges it for a session', () => {
  const send = bodyOf(CLIENT, 'sendPasswordResetCode');
  const verify = bodyOf(CLIENT, 'verifyPasswordResetCode');
  assert.ok(send && verify, 'both recovery steps must exist');
  assert.match(send, /\/recover"/, 'the code is requested from /auth/v1/recover');
  assert.match(verify, /\/verify"/, 'and exchanged at /auth/v1/verify');
  assert.match(verify, /"recovery"/, 'the verify type must be recovery, or it answers 403');
  assert.match(verify, /"token"/, 'the code travels as `token`');
});

test('the new password is written to the user endpoint', () => {
  const body = bodyOf(CLIENT, 'updatePassword');
  assert.ok(body, 'updatePassword is missing');
  assert.match(body, /authBaseUrl\}\/user/, 'PUT /auth/v1/user is what changes a password');
  assert.match(body, /\.put\(/, 'and it is a PUT, not a POST');
  assert.match(body, /NoSession/, 'without a session there is nothing to update');
});

// ---------------------------------------------------------------- passwords ---

test('a password never travels in a URL', () => {
  // `/auth/v1` takes JSON. A password in a query string is a password in every
  // access log and every crash report that carries the request.
  const offenders = [];
  for (const [file, source] of [['SupabaseClient.kt', CLIENT]]) {
    for (const match of source.matchAll(/"[^"\n]*\$\{[^}]*password[^}]*\}[^"\n]*"/gi)) {
      offenders.push(`${file}: ${match[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, [], 'a password is being interpolated into a string');
});

test('nothing logs a password', () => {
  const offenders = [];
  for (const [file, source] of [
    ['SupabaseClient.kt', CLIENT], ['EmailAuth.kt', RULES],
    ['MainViewModels.kt', VIEW_MODEL], ['LoginScreen.kt', LOGIN], ['EmailAuthForm.kt', FORM]
  ]) {
    for (const match of source.matchAll(/(?:println|Log\.[dviwe]|System\.out)[^\n]*password[^\n]*/gi)) {
      offenders.push(`${file}: ${match[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, [], 'a password reaches a log line');
});

test('sign-in does not apply the eight-character rule', () => {
  // The rule is for passwords the app creates. An older password is shorter, and
  // refusing it here would lock its owner out of their own account.
  const body = bodyOf(CLIENT, 'signInWithEmail');
  assert.ok(body, 'signInWithEmail is missing');
  assert.ok(
    !/passwordProblem\(/.test(body),
    'signInWithEmail validates the password against minLength — it must only check for empty'
  );
  assert.match(body, /password\.isEmpty\(\)/, 'an empty password is still refused before the call');
});

test('the rules keep the contract the rest of the app assumes', () => {
  assert.match(RULES, /const val MIN_PASSWORD = 8/, 'eight characters');
  assert.match(RULES, /const val CODE_LENGTH = 6/, 'a six-digit code');
  assert.match(RULES, /fun cleanCode\(/, 'the code is stripped to digits, so a pasted code works');
  assert.match(RULES, /fun isEmail\(/, 'and the address is checked before a round trip');
  assert.match(RULES, /lowercase\(\)/, 'addresses are compared lowercase');
});

// -------------------------------------------------------------- the screens ---

test('the login screen offers both ways in', () => {
  assert.match(LOGIN, /EmailAuthSection\(/, 'the email form is on the login screen');
  assert.match(LOGIN, /GoogleSignInButton\(/, 'and Google is still there beside it');
});

test('recovery holds the navigation back until the new password is saved', () => {
  // The whole reason `passwordResetActive` exists. Verifying the code starts a
  // session; without this the screen leaves for the app and the old password
  // still works.
  assert.match(
    LOGIN,
    /if \(currentUser != null && !passwordResetActive\) onSignedIn\(\)/,
    'the login screen navigates on a user alone'
  );
  assert.match(
    VIEW_MODEL,
    /val passwordResetActive: StateFlow<Boolean>/,
    'the view model has to expose the flag for the screen to read'
  );
  const verify = VIEW_MODEL.slice(
    VIEW_MODEL.indexOf('fun verifyResetCode('),
    VIEW_MODEL.indexOf('fun saveNewPassword(')
  );
  assert.match(verify, /_passwordResetActive\.value = true/, 'accepting the code raises the flag');
  const save = VIEW_MODEL.slice(
    VIEW_MODEL.indexOf('fun saveNewPassword('),
    VIEW_MODEL.indexOf('fun cancelPasswordReset(')
  );
  assert.match(save, /_passwordResetActive\.value = false/, 'saving the password lowers it');
});

test('the recovery flow has all three steps on screen', () => {
  assert.match(FORM, /passwordResetActive/, 'the new-password step is driven by the flag');
  assert.match(FORM, /resetCodeSent/, 'so is the code step');
  // The tags are passed into the field/button helpers as arguments, so the
  // literal appears once, in the call site, rather than inside a `testTag(…)`.
  assert.match(FORM, /"email_send_code"/, 'a way to request the code');
  assert.match(FORM, /"email_verify_code"/, 'a way to submit it');
  assert.match(FORM, /"email_new_password"/, 'a way to set the new password');
});

test('creating an account asks for the password twice', () => {
  // A typo in a masked field is unrecoverable — there is no "show password" on
  // the sign-in screen, and the account would be created against a password
  // nobody knows.
  // Registration moved to its own form (RegisterForm.kt) so an account can ask for
  // names and a picture; the sign-in section hands off rather than duplicating it.
  assert.match(FORM, /testTag\("email_open_registration"\)/, 'no way to reach registration');
  assert.match(FORM, /onClick = onOpenRegistration/, 'and the hand-off is not wired');
  const register = fs.readFileSync(
    path.join(APP, 'ui', 'components', 'RegisterForm.kt'), 'utf8');
  assert.match(register, /"register_password_confirm"/, 'the second field exists');
  assert.match(register, /password == confirmPassword/, 'and the submit waits for a match');
  assert.match(register, /password\.length >= EmailAuthRules\.MIN_PASSWORD/,
    'registration is refused below the minimum length');
});

test('every failed call becomes a sentence in Bengali', () => {
  assert.match(RULES, /object EmailAuthMessages/, 'the message mapper exists');
  for (const kind of ['InvalidEmail', 'WeakPassword', 'WrongCredentials',
                      'AlreadyRegistered', 'RateLimited', 'Network']) {
    assert.match(RULES, new RegExp(`is EmailAuthException\\.${kind} ->`),
      `${kind} has no message of its own`);
  }
  assert.match(VIEW_MODEL, /EmailAuthMessages\.userMessage\(/,
    'and the view model actually asks for it');
});
