'use strict';

/**
 * The reader's session, as the sources declare it.
 *
 * There is no JVM in this repository's checks, so the two mistakes that reached
 * the owner's phone are guarded here instead, by reading the Kotlin that
 * produced them:
 *
 *  1. `HomeContent` rendered the contributor board using `isSignedIn` and
 *     `contributors` — locals of `HomeScreen` — without taking them as
 *     parameters. Kotlin refuses to compile that; nothing else noticed, so the
 *     APK silently stopped building with the feature half-wired.
 *  2. The app's transport always sent the publishable key, so the RPCs granted
 *     to `authenticated` answered a signed-in reader with "for signed-in
 *     readers". The board, their own points and the app-time report were all
 *     unreachable in the app.
 *
 * These are source assertions: they cannot prove the app compiles, but they do
 * fail the moment either of those wiring mistakes comes back.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app');
const read = (...parts) => fs.readFileSync(path.join(APP, ...parts), 'utf8');

const PORTAL_CONFIG = read('data', 'portal', 'PortalConfig.kt');
const PORTAL_PROVIDER = read('data', 'portal', 'PortalProvider.kt');
const SUPABASE_CLIENT = read('data', 'remote', 'SupabaseClient.kt');
const APPLICATION = read('NinghsingCheApp.kt');
const HOME_SCREEN = read('ui', 'reader', 'HomeScreen.kt');
const READER_VIEW_MODELS = read('ui', 'reader', 'ReaderViewModels.kt');
const CONTRIBUTOR_SCREEN = read('ui', 'screens', 'ContributorScreen.kt');

/** The text inside a balanced `(` … `)` that starts at `openIndex`. */
function balanced(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, index);
    }
  }
  throw new Error('unbalanced parentheses');
}

/** The parameter list of a function, from its own `(` after `name`. */
function parametersOf(source, name) {
  const at = source.indexOf(`fun ${name}(`);
  assert.ok(at !== -1, `${name}() is declared`);
  return balanced(source, source.indexOf('(', at));
}

test('the app sends the reader\'s session, not just the publishable key', async (t) => {
  await t.test('the transport prefers an installed reader token', () => {
    assert.match(PORTAL_CONFIG, /fun installReaderSession\(provider: \(\) -> String\?\)/, 'there is a seam to install one');
    assert.match(PORTAL_CONFIG, /private var readerSession: \(\(\) -> String\?\)\?/, 'behind a nullable provider');
    assert.match(PORTAL_CONFIG, /readerSession\?\.invoke\(\)\?\.takeIf \{ it\.isNotBlank\(\) \}/, 'read on every request, so a sign-in takes effect at once');
    assert.match(PORTAL_CONFIG, /\.header\("Authorization", "Bearer \$\{readerToken \?: key\}"\)/,
      'the bearer is the reader when there is one, the key otherwise');
    assert.ok(!/addHeader\("Authorization"/.test(PORTAL_CONFIG), 'and exactly one Authorization header');
  });

  await t.test('the session comes from the reader\'s own sign-in', () => {
    assert.match(SUPABASE_CLIENT, /fun readerAuthToken\(\): String\? = sessionUserJwt\(\)/,
      'SupabaseClient offers the user JWT (never the key)');
    assert.match(APPLICATION, /PortalProvider\.installReaderSession \{ supabaseClient\.readerAuthToken\(\) \}/,
      'and the application installs it at startup');
    assert.match(PORTAL_PROVIDER, /fun installReaderSession\(provider: \(\) -> String\?\)/,
      'through the portal provider, which owns the transport');
    // Installed before anything can make a request.
    assert.ok(APPLICATION.indexOf('installReaderSession') < APPLICATION.indexOf('portalRepository = PortalProvider.repository()'),
      'and before the repository hands out its first request');
  });

  await t.test('the calls that need a session are the ones the transport now covers', () => {
    const api = read('data', 'portal', 'PortalApi.kt');
    for (const rpc of ['contributor_leaderboard', 'contributor_points', 'record_app_time']) {
      assert.match(api, new RegExp(`rpc/${rpc}`), `${rpc} goes through this transport`);
    }
  });
});

test('what a screen uses, it declares', async (t) => {
  await t.test('the contributor section is passed everything it renders', () => {
    const parameters = parametersOf(HOME_SCREEN, 'HomeContent');
    const used = ['contributors', 'contributorsError', 'isSignedIn',
      'onSeeAllContributors', 'onContributorClick', 'onRetryContributors'];
    for (const parameter of used) {
      assert.match(parameters, new RegExp(`\\b${parameter}:`),
        `HomeContent takes ${parameter} — it renders it, so it cannot borrow it from HomeScreen`);
    }
  });

  await t.test('and the call site supplies them', () => {
    const call = HOME_SCREEN.slice(HOME_SCREEN.indexOf('HomeContent(\n'), HOME_SCREEN.indexOf('onOpenLink = onOpenLink'));
    for (const argument of ['contributors =', 'contributorsError =', 'isSignedIn =',
      'onSeeAllContributors =', 'onContributorClick =', 'onRetryContributors =']) {
      assert.ok(call.includes(argument), `the call passes ${argument}`);
    }
  });
});

test('a board that cannot be read says so', async (t) => {
  await t.test('the view model keeps the failure', () => {
    assert.match(READER_VIEW_MODELS, /val contributorsError: StateFlow<String\?>/, 'the home page can see it');
    assert.match(READER_VIEW_MODELS, /_contributorsError\.value = \(failure as\? PortalError\)\.message\(\)/,
      'and it is set from the failure, not swallowed');
  });

  await t.test('the home section renders it with a retry', () => {
    assert.match(HOME_SCREEN, /contributors\.isNotEmpty\(\) \|\| contributorsError != null/,
      'the section appears for an error too, not only for rows');
    assert.match(HOME_SCREEN, /ContributorBoardNotice\(/, 'and shows the notice');
    assert.match(HOME_SCREEN, /viewModel\.loadContributors\(isSignedIn, force = true\)/, 'whose retry ignores the cache');
  });

  await t.test('a refused session is not described as "signed out" to a reader who is signed in', () => {
    assert.match(CONTRIBUTOR_SCREEN, /refused = failure is PortalError\.Http && failure\.code in 401\.\.403/,
      'a 401/403 is recognised as a session problem');
    assert.match(CONTRIBUTOR_SCREEN, /SignedOutGate\(onSignInClick, expired = refused\)/,
      'and turns into the gate, which explains the session');
    assert.match(CONTRIBUTOR_SCREEN, /সেশনের মেয়াদ শেষ/, 'with wording that says so');
  });
});
