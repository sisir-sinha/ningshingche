/**
 * The one place the app ships native code, and the rule it has to keep.
 *
 * Play requires 16 KB page-size support from every 64-bit `.so` in the APK —
 * Android 15+ devices may use 16 KB pages, and a library built for 4 KB cannot
 * be mapped there. The app's only natives come from the PDF reader, so this file
 * exists to keep that one dependency honest: `com.github.mhiew` stopped at
 * 3.2.0-beta.3 with a 4 KB-aligned pdfium, and an "upgrade" back to it would be
 * invisible until Play Console rejected the upload.
 *
 * The alignment itself was checked by extracting the artifact and reading the
 * program headers (arm64-v8a, all five .so files: `p_align = 0x4000`). That is
 * not repeatable offline, so what is asserted here is the coordinate, the reason
 * it is written down, and the keep rules that still have to match the packages.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const VERSIONS = read('gradle', 'libs.versions.toml');
const BUILD = read('app', 'build.gradle.kts');
const PROGUARD = read('app', 'proguard-rules.pro');

/** One `[libraries]` line, by its accessor. */
function library(accessor) {
  const line = VERSIONS.split('\n').find((item) => item.trim().startsWith(`${accessor} =`));
  assert.ok(line, `${accessor} is declared in libs.versions.toml`);
  return line;
}

test('the PDF reader is the 16 KB build, and says why', async (t) => {
  await t.test('it is the fork with the rebuilt natives', () => {
    const line = library('android-pdf-viewer');
    assert.match(line, /group = "io\.github\.oothp"/,
      "com.github.mhiew's pdfium is 4 KB aligned and Play rejects it");
    assert.match(line, /name = "android-pdf-viewer"/);
  });

  await t.test('the reason is written where the next person will look', () => {
    // A version bump with no note is how the 4 KB library comes back.
    assert.match(VERSIONS, /16 KB/);
    assert.match(VERSIONS, /p_align 0x4000/,
      'the measurement, not just the claim');
    assert.match(VERSIONS, /com\.github\.barteksc\.pdfviewer and com\.shockwave\.pdfium/,
      'and that the packages did not move, which is why no Kotlin changed');
  });

  await t.test('the version is pinned, not a range', () => {
    const pinned = /androidPdfViewer = "([^"]+)"/.exec(VERSIONS);
    assert.ok(pinned, 'the version is declared once');
    assert.match(pinned[1], /^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/,
      'a beta that ships natives is a beta to pin exactly');
    assert.ok(!/[+[\]]/.test(pinned[1]), 'no dynamic version');
  });
});

test('the keep rules still match the packages that ship', async (t) => {
  await t.test('the viewer and the engine are both kept', () => {
    assert.match(PROGUARD, /-keep class com\.shockwave\.\*\* \{ \*; \}/);
    assert.match(PROGUARD, /-keep class com\.github\.barteksc\.\*\* \{ \*; \}/);
  });

  await t.test('and the engine is excused from missing references', () => {
    // pdfium references platform classes only some devices carry; without the
    // dontwarn the R8 step fails rather than strips.
    assert.match(PROGUARD, /-dontwarn com\.shockwave\.\*\*/);
    assert.match(PROGUARD, /-dontwarn com\.github\.barteksc\.\*\*/);
  });

  await t.test('the app ships only the two architectures it supports', () => {
    const filters = /abiFilters[^\n]*/.exec(BUILD);
    assert.ok(filters, 'abiFilters is declared');
    assert.match(filters[0], /arm64-v8a/, 'the 64-bit target, which is what the rule is about');
    assert.match(filters[0], /armeabi-v7a/);
    assert.ok(!/x86/.test(filters[0]),
      'the x86 builds the fork also ships are stripped, so they cannot regress the check');
  });
});
