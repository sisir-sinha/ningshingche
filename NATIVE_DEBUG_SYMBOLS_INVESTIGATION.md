# Native debug symbols — investigation brief (§A–D)

**Status:** investigation complete, **no build change made**.
**Tree:** `1073e86` · versionCode 36 · ABI filters `armeabi-v7a` + `arm64-v8a` · `debugSymbolLevel = SYMBOL_TABLE`.
**Date:** 2026-10-26

---

## §A — What was observed

Two separate things, with two different severities:

**A1. Gradle warning (build machine)**

> `Unable to strip the following libraries, packaging them as they are: …`

Emitted at **warning** level by `StripDebugSymbolsDelegate` (verified in the AGP 9.1.1 jar). Warning only — the build succeeds and the libraries are packaged unchanged.

**A2. Play Console message (upload)**

> **1 MESSAGE FOR VERSION CODE 35**
> ⚠ Warning — *"This App Bundle contains native code, and you've not uploaded debug symbols. We recommend you upload a symbol file to make your crashes and ANRs easier to analyze and debug."*

Also warning-level, not an error. Play's footer on that screen still says *"ready for you to send for review"*.

⚠️ **That screenshot is for versionCode 35.** The repository is at versionCode 36, so the message was raised against a stale draft — see §D4.

**A3. Empty staging directory**

`app/build/intermediates/native_symbol_tables/release/` exists but contains nothing.

---

## §B — Evidence

### B1. Every shipped `.so` is pre-stripped, in **all four** ABIs

Read with `readelf -SW` on the originals extracted straight out of the published AARs (not the app's build output, so this is the publisher's state, before AGP touched anything):

| ABI | libs | `.symtab` | `.debug_info` | `.debug_line` | `.dynsym` |
|---|---|---|---|---|---|
| armeabi-v7a | 7 | **absent** | **absent** | **absent** | present |
| arm64-v8a | 7 | **absent** | **absent** | **absent** | present |
| x86 | 7 | **absent** | **absent** | **absent** | present |
| x86_64 | 7 | **absent** | **absent** | **absent** | present |

Same result on all 28 binaries. (Only the two filtered ABIs ship in the bundle, but the check covered all four because the brief forbids assuming from one.)

### B2. The extraction has nothing to extract

`ExtractNativeDebugMetadataTask` shells out to `objcopy` (`--only-keep-debug` semantics) to lift symbol/DWARF content out of each library. Run on these exact files:

| library (arm64-v8a) | input | extracted debug payload |
|---|---|---|
| `libmodpdfium.so` | 4,844,960 B | **0 B** |
| `libjniPdfium.so` | 29,488 B | **0 B** |
| `libandroidx.graphics.path.so` | 10,096 B | **0 B** |
| `libdatastore_shared_counter.so` | 7,112 B | **0 B** |
| *control:* `/bin/ls` (has `.symtab`) | 158,632 B | **44,640 B** |

The control run proves the method works — the tool is fine. These inputs simply contain no symbol data to give up. This is the direct, mechanical cause of both A1 and A3: stripping a stripped file has nothing to do, and extracting from a stripped file yields an empty set.

### B3. The publisher does not ship symbols anywhere

- **Maven Central**, `io.github.oothp:pdfium-android:1.9.5-beta01` — published files are exactly: `.aar`, `-sources.jar`, `-javadoc.jar`, `.pom` (+ signatures/checksums). **No classifier, no `.so.dbg`, no `-symbols`, no `-debug` artifact.** Same for `android-pdf-viewer:3.2.0-beta06`.
- **GitHub**, `oothp/PdfiumAndroid` release `1.9.5-beta01` — **zero release assets**.
- Upstream `barteksc/PdfiumAndroid` and `AhmerAfzal1/AhmerPdfium` publish **no releases at all**.

There is no source from which to obtain a matching symbol file for these binaries.

### B4. What AGP actually does with the setting (AGP 9.1.1, read from its jar)

- `ndk { debugSymbolLevel }` is valid inside `buildTypes.release` — the impl `BuildType` exposes `getNdk(): NdkOptions`. The setting is **not** a no-op and is placed correctly.
- Allowed values via `HelpfulEnumConverter`: `NONE`, `SYMBOL_TABLE`, `FULL`.
- Pipeline: `ExtractNativeDebugMetadataTask` (objcopy) → `MergeNativeDebugMetadataTask` → `native-debug-symbols.zip` → `PackageBundleTask` packs it at `BUNDLE-METADATA/com.android.tools.build.debugsymbols/`, but **only from entries in `getNativeDebugMetadataFiles`**.
- Both the strip task and the extract task resolve their tool through `NdkHandlerInput` / `VersionedNdkHandler` → **an installed NDK is required**; without one there is no `objcopy` and no extraction. (A second, independent reason the staging dir can end up empty — worth checking with `ls $ANDROID_HOME/ndk` on the build machine.)
- `SYMBOL_TABLE` is the documented lower-size alternative to `FULL`; Play's limit on the zip is 800 MB. Neither is relevant here, because the input payload is zero.

### B5. Size of the affected payload in the bundle

7 libraries × 2 shipped ABIs = **14 `.so` files, 11.5 MB** (armeabi-v7a 4,740 KB + arm64-v8a 7,030 KB), out of an 8.62 MB *download* for a 32-bit-family device.

Provenance:

| AAR | ships |
|---|---|
| `io.github.oothp:pdfium-android:1.9.5-beta01` | `libc++_shared`, `libjniPdfium`, `libmodft2`, `libmodpdfium`, `libmodpng` |
| `androidx.graphics:graphics-path:1.0.1` | `libandroidx.graphics.path.so` |
| `androidx.datastore:datastore-core-android:1.1.7` | `libdatastore_shared_counter.so` |
| `io.github.oothp:android-pdf-viewer:3.2.0-beta06` | none |

---

## §C — Diagnosis

**The Play message is a recommendation, not a blocker.** Play's own wording is *"We recommend"*, it is listed under warnings, and the release remains sendable for review. It does not gate the rollout.

**Root cause is entirely upstream, and it is not fixable from this repository.** All 14 shipped native libraries arrive pre-stripped from their publishers, and none of those publishers distributes unstripped versions. AGP's job is to *extract and strip* symbols from what it is given; when the publisher has already done the stripping, AGP has nothing to extract and says so. `debugSymbolLevel = SYMBOL_TABLE` is therefore **correct and already set, but cannot manufacture what was never shipped.**

Consequences, stated precisely:

- **Java/Kotlin crashes are unaffected.** R8's `mapping.txt` is packed into the bundle by the same `PackageBundleTask` and Play consumes it automatically — deobfuscated Kotlin/Java stack traces work today. This is the large majority of this app's surface.
- **Native frames will show as addresses only** — frames inside `libmodpdfium` / `libjniPdfium` / `libmodft2` / `libmodpng` (i.e. crashes inside the PDF renderer), and inside the two AndroidX libraries. These are third-party binaries the app does not compile; a crash there is reported to Play unsymbolicated, but the crash *location* is still evident from the frame order, and the same crash is reproducible on a build machine where the unstripped original could be rebuilt if ever needed.
- **The Gradle message A1 will keep appearing** on every release build. It is cosmetic: it means "these were already stripped", not "symbols were thrown away".

**What would not help — explicitly rejected:**

- Shipping the pre-stripped `.so` files again as a "symbol zip", or zipping an empty/unstripped copy to silence Play. That produces a file that looks like symbols and symbolizes nothing — forbidden by the brief, and worse than the warning because it would make a real native crash silently mis-symbolicate (or fail to) while appearing handled.
- `packaging { doNotStrip }` / `keepDebugSymbols += "**/*.so"` — there are no symbols in these files to keep; it would only inflate the bundle by zero.
- Raising `debugSymbolLevel` to `FULL` — extraction source is empty; the output is identical (empty) and would only add build time.
- Switching the PDF viewer to another library purely for symbols — no such library was found to publish symbols, and the brief forbids replacing it without proven necessity.

**What would remove the warning (all outside this repository's control):**

1. The publisher (or anyone rebuilding `pdfium-android` from source at that exact revision) publishes a matching unstripped or `.so.dbg` artifact. Then it is a one-line `packaging { jniLibs.keepDebugSymbols }` or a `native-debug-symbols.zip` upload — the plumbing already exists.
2. Rebuilding pdfium with symbols ourselves — a multi-hour NDK cross-compile for a warning that is advisory, and it would still only cover the pdfium libraries, not the two AndroidX ones.

---

## §D — Recommendation

**D1. Change nothing in the build.** The current state is the correct state for this dependency set: `debugSymbolLevel = SYMBOL_TABLE` is valid, correctly scoped to the release build type, costs nothing (empty output), and becomes effective automatically the day a publisher ships symbols. No Gradle/AGP/versionCode/dependency change is warranted.

**D2. Accept the Play warning and ship.** It is advisory, it does not block review or rollout, and the crash-trace path that matters most (Kotlin/Java) is already fully symbolicated via R8's `mapping.txt` inside the bundle. Do not spend release time on it.

**D3. The Gradle "Unable to strip" message can be silenced but should not be.** Silencing requires `packaging { doNotStrip }`, which misrepresents intent and would mask a genuine future problem (a library that *does* ship symbols and silently keeps them, inflating the bundle). Leave it visible.

**D4. Re-upload a fresh 36 AAB and re-read the message.** The observed warning is attached to **versionCode 35**. Build, upload the 36 bundle, and check whether Play raises it again for 36. Two possible outcomes, both fine:
- message reappears → expected, per §C; ship anyway;
- message does not reappear → Play may only warn when *no* metadata entry exists at all (an empty entry can satisfy the check). Do **not** rely on this and do **not** attempt to force it.

Either way the conclusion is the same: **this is not a release blocker.**

**D5. Precondition to verify on the build machine (not done here):** confirm an NDK is installed (`ls "$ANDROID_HOME/ndk"`). If none is present, AGP cannot run `objcopy` at all — a second, independent reason the staging directory is empty. Installing one would not produce symbols here (§B1–B2), so it changes nothing about the outcome; it only removes an ambiguity about *which* of the two causes fired.

---

### Appendix — reproducible checks

```bash
# 1. is the library pre-stripped?  (expect: no .symtab, no .debug_info)
unzip -o -q pdfium-android-1.9.5-beta01.aar -d x
readelf -SW x/jni/arm64-v8a/libmodpdfium.so | grep -E '\.symtab|\.debug'

# 2. is there anything to extract?  (expect: 0 bytes; /bin/ls control gives ~44 KB)
objcopy --only-keep-debug x/jni/arm64-v8a/libmodpdfium.so /tmp/a.debug; stat -c%s /tmp/a.debug
objcopy --only-keep-debug /bin/ls /tmp/b.debug;                               stat -c%s /tmp/b.debug

# 3. does the publisher ship symbols?  (expect: only aar/sources/javadoc/pom)
curl -s https://repo1.maven.org/maven2/io/github/oothp/pdfium-android/1.9.5-beta01/
```

*Side note, not load-bearing:* `libmodpdfium.so`'s `NT_GNU_BUILD_ID` note is 8 bytes while the other six are 20 — consistent with the artifact having been post-processed after linking. It supports, but does not prove, the conclusion in §B1 that stripping happened publisher-side.
