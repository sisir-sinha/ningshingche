/**
 * Release signing: the key is not in the repository, and the build can find it.
 *
 * This exists because of a specific afternoon. A keystore and its passwords were
 * committed to a public repository, and the build script that was supposed to read
 * them from `key.properties` resolved the file one directory too high, so it read
 * nothing and failed later inside bundletool. Both halves of that are tested here:
 * the credentials stay out of git, and the paths that find them are the right ones.
 *
 * Nothing in this file reads a password; it reads the *shape* of the script.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const BUILD = read('app', 'build.gradle.kts');
const GITIGNORE = read('.gitignore');
const EXAMPLE = read('key.properties.example');

/**
 * The script with its comments removed — a string-aware stripper, because several
 * assertions below look for the *absence* of something, and the prose that explains
 * why it is absent would otherwise match. Quotes are respected so a `//` inside a
 * string (a URL, say) is not mistaken for a comment.
 */
function codeOnly(source) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      out += ch;
      if (ch === '\\') { out += source[i + 1] || ''; i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; i += 1; continue; }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const BUILD_CODE = codeOnly(BUILD);

/** The text before `android {` — where the properties are read. */
const PREAMBLE = BUILD.slice(0, BUILD.indexOf('\nandroid {'));

test('the credentials cannot be committed', async (t) => {
  await t.test('the root .gitignore covers the key, everywhere in the tree', () => {
    const lines = GITIGNORE.split('\n').map((line) => line.trim());
    // At the root these patterns match at any depth. The version that failed put
    // them in app/.gitignore, where `*.jks` only matched inside app/ — and the
    // keystore was at the root, so it was never ignored.
    assert.ok(lines.includes('key.properties'), 'key.properties is ignored');
    assert.ok(lines.includes('*.jks'), '*.jks is ignored');
    assert.ok(lines.includes('*.keystore'), '*.keystore is ignored');
  });

  await t.test('the example file is the one that gets committed', () => {
    assert.match(EXAMPLE, /^storeFile=/m);
    assert.match(EXAMPLE, /^storePassword=change-me$/m,
      'the example carries a placeholder, never a real password');
    assert.match(EXAMPLE, /^keyAlias=/m);
    assert.match(EXAMPLE, /^keyPassword=/m);
  });

  await t.test('and the build script itself holds no secret', () => {
    // The debug key's `"android"` password is the well-known AOSP default and is
    // not a secret; the release config is the one that must never carry a literal.
    const release = BUILD_CODE.slice(BUILD_CODE.indexOf('if (releaseSigningReady)'),
      BUILD_CODE.indexOf('val customDebugKey'));
    assert.ok(release.length > 0, 'the release config is where expected');
    assert.ok(!/storePassword\s*=\s*"/.test(release), 'no store password literal');
    assert.ok(!/keyPassword\s*=\s*"/.test(release), 'no key password literal');
  });
});

test('the properties file is found, at the path it actually lives at', async (t) => {
  await t.test('it is read with java.util.Properties', () => {
    assert.match(BUILD, /^import java\.util\.Properties$/m);
    assert.match(BUILD, /Properties\(\)\.apply\s*\{/);
    assert.match(BUILD, /\.inputStream\(\)\.use\s*\{\s*load\(it\)\s*\}/,
      'loaded through a stream that is closed');
  });

  await t.test('resolved against rootDir, not against the module or its parent', () => {
    assert.match(BUILD, /rootDir\.resolve\("key\.properties"\)/);
    // `rootDir` is the ROOT project directory even inside app/build.gradle.kts —
    // `projectDir` is app/. Someone believed otherwise, and `parentFile` took the
    // file one level above the repository, where nothing exists.
    assert.ok(!/rootDir\s*\.\s*parentFile/.test(BUILD_CODE),
      'rootDir.parentFile points above the repository');
    assert.ok(!/rootDir\s*\.\s*parent\b/.test(BUILD_CODE));
  });

  await t.test('and the keystore path is resolved the same way', () => {
    assert.match(BUILD, /releaseStorePath\?\.let\s*\{\s*rootDir\.resolve\(it\)\s*\}/,
      'storeFile is relative to the repository root, like the file that names it');
  });

  await t.test('no reference to rootProject survives', () => {
    // `rootProject` inside a properties read is what produced "Unresolved
    // reference 'rootProject'" in the attempt before this one; the same object is
    // reachable as `rootDir` with no receiver trouble.
    assert.ok(!/\brootProject\b/.test(BUILD_CODE), 'rootProject is not called in code');
  });

  await t.test('the imports are at the top, before any statement', () => {
    const firstNonImport = BUILD.split('\n').findIndex((line) => line.trim() && !line.startsWith('import '));
    const lastImport = BUILD.split('\n').reduce(
      (last, line, index) => (line.startsWith('import ') ? index : last), -1);
    assert.ok(lastImport < firstNonImport,
      'Kotlin allows imports only before the first declaration');
    assert.ok(lastImport < BUILD.split('\n').indexOf('plugins {'),
      'and before the plugins block, which has to come first in a script');
  });
});

test('the values are validated, and the messages do not leak them', async (t) => {
  await t.test('every required property is checked', () => {
    for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
      assert.match(PREAMBLE, new RegExp(`signingValue\\("${key}"`),
        `${key} is read from the properties file`);
    }
    assert.match(BUILD, /val missingSigningValues: List<String> = buildList \{/,
      'and the gaps are collected rather than thrown one at a time');
  });

  await t.test('the alias comes from the file, not from a guess', () => {
    // The original configuration hardcoded `keyAlias = "upload"` while the
    // keystore's entry is `my-key-alias`, which fails as "Cannot recover key".
    assert.ok(!/keyAlias\s*=\s*"upload"/.test(BUILD_CODE), 'no hardcoded alias');
    assert.match(BUILD, /keyAlias = releaseKeyAlias/, 'the alias is the one from key.properties');
  });

  await t.test('a release build without a key stops with instructions', () => {
    assert.match(BUILD_CODE, /throw GradleException\(/, 'it fails, it does not warn');
    assert.match(BUILD_CODE, /key\.properties at \$\{keyPropertiesFile\.absolutePath\}/,
      'and it names the file it looked for');
  });

  await t.test('and it stops before the compile, not after it', () => {
    // Verified by running it: with key.properties absent, `./gradlew
    // :app:bundleRelease` fails in about twenty seconds, long before Kotlin or R8.
    assert.match(BUILD_CODE, /gradle\.startParameter\.taskNames/,
      'the requested tasks are read at configuration time');
    assert.match(BUILD_CODE,
      /if \(requestedReleaseBuild && !releaseSigningReady\) \{\s*throw GradleException/,
      'and a release request without a key throws there');
  });

  await t.test('no task action lives in this script', () => {
    // This is the regression that cost a build. The first version of the check
    // above repeated itself in `doFirst { }` on bundleRelease; the configuration
    // cache then refused to store the graph, with
    //
    //   Task `:app:bundleRelease` of type `org.gradle.api.DefaultTask`:
    //   cannot serialize Gradle script object references
    //
    // because a lambda declared in a build script captures the script object.
    // gradle.properties enables the configuration cache, so any action here is a
    // build failure waiting for the next release.
    for (const action of ['doFirst', 'doLast', 'onlyIf', 'taskGraph']) {
      assert.ok(!new RegExp(`\\b${action}\\b`).test(BUILD_CODE),
        `${action} in a build script breaks the configuration cache this project enables`);
    }
  });

  await t.test('and the task names it watches include the bare commands', () => {
    // `build` and `assemble` build every variant, Release included; a guard that
    // only knew the two fully-qualified release task names would let those two
    // produce an unsigned bundle.
    assert.match(BUILD_CODE, /task\.contains\("release"\)/);
    assert.match(BUILD_CODE, /task == "build" \|\| task == "assemble" \|\| task == "bundle"/);
    assert.match(BUILD_CODE, /\.lowercase\(\)/,
      'compared case-insensitively, so bundleRelease and BundleRelease both count');
  });

  await t.test('nothing is printed that a password could hide in', () => {
    // Only the keys are named in the message, never `releaseStorePassword` or its value.
    const message = BUILD_CODE.slice(BUILD_CODE.indexOf('val missingSigningValues'));
    assert.ok(!/\$\{?release(Store|Key)Password/.test(message),
      'the password values never reach a log');
  });
});

test('the project it was changed inside still works', async (t) => {
  await t.test('the six plugins are untouched', () => {
    for (const plugin of [
      'libs.plugins.android.application',
      'libs.plugins.kotlin.compose',
      'libs.plugins.google.devtools.ksp',
      'libs.plugins.roborazzi',
      'libs.plugins.secrets',
      'libs.plugins.google.services'
    ]) {
      assert.match(BUILD, new RegExp(`alias\\(${plugin.replace(/\./g, '\\.')}\\)`),
        `${plugin} is still applied`);
    }
  });

  await t.test('shrinking and R8 are still on for release', () => {
    const release = BUILD_CODE.slice(BUILD_CODE.indexOf('buildTypes {'), BUILD_CODE.indexOf('packaging {'));
    assert.match(release, /isMinifyEnabled = true/);
    assert.match(release, /isShrinkResources = true/);
    assert.match(release, /proguard-android-optimize\.txt/);
    assert.match(release, /proguard-rules\.pro/);
  });

  await t.test('the release build type only takes a config that exists', () => {
    // `getByName("release")` throws at configuration time when the key is not on
    // the machine, which would make a plain `assembleDebug` impossible for anyone
    // who is not the release manager. `findByName` returns null instead.
    // Asserted on the call rather than on the lambda's layout: this line was
    // reformatted once already, and one-liner versus block is not what is being
    // protected here.
    assert.match(BUILD_CODE, /signingConfigs\.findByName\("release"\)\?\.let\s*\{/);
    assert.match(BUILD_CODE, /signingConfig = it/, 'and the found config is the one used');
    assert.ok(!/signingConfigs\.getByName\("release"\)/.test(BUILD_CODE),
      'getByName would break every debug build on a machine without the key');
  });

  await t.test('and debug keeps its own signing', () => {
    assert.match(BUILD, /rootDir\.resolve\("debug\.keystore"\)/);
    assert.match(BUILD, /create\("debugConfig"\)/);
  });
});
