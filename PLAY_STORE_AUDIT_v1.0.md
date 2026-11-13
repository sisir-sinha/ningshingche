# Play Store Readiness Audit — Ningshing Che v1.0

**Repo:** `sisir-sinha/ningshingche` · **Commit audited:** `0b9d15e`
**Package:** `com.ningshingche.app` · **versionName** `1.14.12` · **versionCode** `34` · **targetSdk** `36` · **minSdk** `24`
**Audit date:** 26 Oct 2026

Method: every tracked file reviewed (319 files), Android manifest/gradle/R8 config read, native
libraries extracted from the real Maven artifacts and inspected with `readelf`, live Supabase
endpoints probed, store links and policy pages checked over HTTP, and the current Play policy
text (2026 edition) checked against each feature.

---

## Verdict

**Do not upload yet.** Six code/asset items will block or reject the release, and one is a
dead link to another developer's package.

| # | Issue | Policy area | Severity |
|---|-------|-------------|----------|
| 1 | App lets users **save & share its own APK** | Device & Network Abuse | 🔴 Blocker |
| 2 | **PDF engine native libs are 4 KB aligned** (16 KB requirement) | Play technical requirement | 🔴 Blocker (upload) |
| 3 | **No account deletion** (app creates accounts) | User Data policy | 🔴 Blocker |
| 4 | **UGC with no report/block, no terms acceptance** | User Generated Content | 🔴 Blocker |
| 5 | **No privacy policy page exists** (link opens homepage) | User Data / Console field | 🔴 Blocker |
| 6 | **AI assistant with no in-app "report output"** | AI-Generated Content | 🔴 Blocker |
| 7 | **Play Store button opens a 404 of another developer's app** | Deceptive behaviour / broken functionality | 🔴 Blocker |
| 8 | FGS `mediaPlayback` declaration + video missing in Console | Foreground service policy | 🟠 Will stall review |
| 9 | Data safety form content not derivable from the app | User Data policy | 🟠 Must complete |
| 10 | Gemini/OpenRouter keys baked into the APK | Security / Data safety | 🟠 High risk |
| 11 | Music, PDFs and user-uploaded audio = IP exposure | Intellectual Property | 🟠 High risk |
| 12 | versionName `1.14.12` / code `34` vs the "v1.0" you're shipping | Release hygiene | 🟡 Fix before upload |

**Good news:** the technical floor is already met — `targetSdk 36` (required since 31 Aug 2026),
64-bit ABIs, no dangerous permissions, no cleartext, no ad SDK, no secrets or keystores in git.

---

## Remediation status

*Updated as each step lands. "Code" means written, tested and pushed; "you" means an action that can
only be taken in the Supabase dashboard, in Play Console, or on the host.*

| # | Code | What is left for you |
|---|------|----------------------|
| 1 | ✅ `06d67bd` — APK section and `ApkManager` removed, Play link behind `PLAY_LISTING_LIVE` | — |
| 2 | ✅ `androidPdfViewer = "3.2.0-beta06"` from `io.github.oothp` (natives verified 0x4000) | — |
| 3 | ✅ `e6a9ddf` — in-app deletion + `delete_my_account()`, `account-deletion.html` | Run `039_account_deletion.sql`, put the deletion URL in the Data safety form |
| 4 | ✅ report/block (migration `040`) + terms gate on every composer | Run `040_content_safety.sql`, redeploy Pages, moderate `content_reports` |
| 5 | ✅ `9164c80` — `privacy.html`, `terms.html` | Mirror both on `ningshingche.com`; the Console field must point there |
| 6 | ✅ in-app flag on every AI answer (type `ai_output`) | **App content → Generative AI** declaration; add the Gemini disclosure to Data safety |
| 7 | ✅ `06d67bd` | Flip `PLAY_LISTING_LIVE` to `true` once the listing exists |
| 8 | — | Console: `mediaPlayback` declaration + demo video |
| 9 | — | Data safety form (§9 has the table) |
| 10 | ✅ client-side keys stubbed to a placeholder | Move the AI call behind an Edge Function (§6, secondary) |
| 11 | — | Rights check on the music, PDFs and uploaded audio |
| 12 | ✅ `versionCode 35` / `versionName "1.0"` | — |

Test suite: `cd backend && node --test tests/` → **576 pass, 0 fail**.

---

## 🔴 1. The app distributes its own APK (Device & Network Abuse)

**Where**

- `app/src/main/java/com/ningshingche/app/ui/screens/SettingsScreen.kt` lines **662–860** —
  a whole section titled **"নিংশিং চে APK ডাউনলোড (সরাসরি লোকাল প্যাকেজ)"** with
  **"APK সংরক্ষণ করুন"** and **"APK শেয়ার করুন"** buttons.
- `app/src/main/java/com/ningshingche/app/util/ApkManager.kt` — the whole file.
  `saveApkToDownloads()` writes `application/vnd.android.package-archive` into
  `Downloads/Ningshingche/`; `shareInstalledApk()` pushes it to WhatsApp/Telegram through the
  `FileProvider` (`app/src/main/res/xml/file_paths.xml`).

**Why it blocks**

> "An app distributed via Google Play may not modify, replace, or update itself using any method
> other than Google Play's update mechanism… Apps and app listings on Google Play must not
> provide any means to activate or access functionality that violate these terms, such as
> **linking to a non-compliant APK hosted outside Google Play**."
> — Device and Network Abuse policy

The installed `sourceDir` APK **is** the Play-signed artifact. Shipping a button that exports and
shares it is the classic "self-distribution" rejection. Reviewers test Settings screens.

**Fix for the Play build**

1. Delete the `// 2. Download Ningshingche APK` `item { … }` block in `SettingsScreen.kt`
   (662–860) plus the `import com.ningshingche.app.util.ApkManager`.
2. Delete `util/ApkManager.kt`.
3. Remove the `androidx.core.content.FileProvider` `<provider>` block from `AndroidManifest.xml`
   **only if** `file_paths.xml` is no longer used elsewhere (PDF share uses it too — check
   `PdfHelper.sharePdf`; if so, keep the provider, drop the `cache/apk_exports` path).
4. Remove the 14 "APK" strings from `UserDashboardCharts.kt` / `HtmlContentEditor.kt` if they
   are user-facing.

Sideload builds can keep this behind a product flavour (`sideloadRelease`) that never reaches Play.

---

## ✅ 2. Native libraries are 4 KB aligned — the 16 KB page-size block — **fixed**

**Where:** `gradle/libs.versions.toml`

```toml
androidPdfViewer = "3.2.0-beta.3"   # com.github.mhiew:android-pdf-viewer
```

which pulls `com.github.mhiew:pdfium-android:1.9.2` (published **May 2022**, last release).

**Verified by extracting the real artifact**

```
$ unzip -o pdfium-android-1.9.2.aar 'jni/arm64-v8a/*' -d pf
$ readelf -lW pf/jni/arm64-v8a/libmodpdfium.so | awk '/LOAD/{print $NF}'
0x1000
0x1000
```

`libmodpdfium.so`, `libjniPdfium.so`, `libmodpng.so`, `libmodft2.so`, `libc++_shared.so` are all
`p_align = 0x1000` (**4 KB**) on `arm64-v8a`. Play requires 16 KB (`0x4000`) support for 64-bit
libraries, and Play Console reports *"App does not support 16 KB page sizes"* — this is a release
**error**, not a warning. Enforcement has slipped more than once (Console currently shows
**1 Feb 2027**), but the check is live today and will bite on the first update.

Nothing else in the dependency tree ships `.so` files — Media3, Compose, Coil, OkHttp, Room and
Moshi are pure JVM — so this library is the only offender.

**Three ways out (pick one)**

| Option | Work | Result |
|---|---|---|
| **A. System PDF viewer** — replace the in-app reader with `Intent.ACTION_VIEW` (`application/pdf`) | ~1 day | Zero native code, smallest APK, guaranteed compliant. Loses custom reader UI. |
| **B. Migrate to `androidx.pdf:pdf-viewer:1.0.0-beta01`** (Google, Compose-native) | ~3–5 days | Modern API, maintained, 16 KB-safe. Beta, so pin the version. |
| **C. Rebuild pdfium yourself** with NDK r27+ and a `local` module, keeping `com.shockwave.pdfium` package names | ~2–3 days + CI | Keeps the current UI exactly. You own the native build forever. |

Note: `io.legere:pdfiumandroid:1.0.35` **is** 16 KB-clean (`align=0x4000`, verified) but its
classes are `io.legere.pdfiumandroid.*`, so it is **not** a drop-in replacement for the mhiew
viewer — it would need its own viewer port (which is what `androidx.pdf` already is).

Whatever you choose, also delete the now-dead keep rules in `app/proguard-rules.pro`
(`com.shockwave.**`, `com.github.barteksc.**`) if the library goes.

**What was done (chosen over all three: none was needed)**

There is a fourth way, and it is a two-line change. `io.github.oothp` publishes a fork of
*both* libraries — the viewer and the pdfium engine — with the natives rebuilt:

```toml
androidPdfViewer = "3.2.0-beta06"
android-pdf-viewer = { group = "io.github.oothp", name = "android-pdf-viewer", version.ref = "androidPdfViewer" }
```

Verified rather than assumed, by extracting the artifact the same way the original finding was
made:

| Check | Result |
|---|---|
| `jni/arm64-v8a/lib*.so` — all five files | `PT_LOAD p_align = 0x4000` ✅ |
| `jni/armeabi-v7a/*` | `0x1000` — fine, the rule is 64-bit only |
| Classes of the engine | `com.shockwave.pdfium.*` — unchanged |
| Classes of the viewer | `com.github.barteksc.pdfviewer.*` — unchanged |
| Every method this app calls (`fromFile`, `swipeHorizontal`, `pageSnap`, `nightMode`, `pageFitPolicy`, `spacing`, `scrollHandle`, `jumpTo`, …) | present ✅ |
| `minSdk` of the fork | 21 (app is 24) ✅ |

So no Kotlin changed, no UI was lost, and the reader keeps its book view, page snapping and night
mode. The x86/x86_64 natives the fork also ships are stripped by `abiFilters`. A test
(`backend/tests/native-libraries.test.cjs`) now fails if the coordinate drifts back to `com.github.mhiew`,
because a silent "version upgrade" there would only surface as a Play upload rejection.

**Risk to watch:** the fork is one maintainer's repository. If it disappears, the audit's options
A–C are the fallbacks; the version is pinned, so the build keeps working from the Maven cache in
the meantime.

---

## 🔴 3. No account deletion (User Data policy)

The app creates accounts: **"Continue with Google"** → Supabase Auth
(`data/auth/GoogleAuthRepository.kt`, `GoogleIdentityClient.kt`). Play requires, for any app that
allows account creation:

1. an **in-app path** to delete the account **and its data**, and
2. a **web link** where deletion can be requested without reinstalling the app, entered in the
   Data safety form.

**Where it's missing:** nowhere in the repo. `grep -riE "delete.?account|deleteAccount"` across
`app/src/main/java` and `backend/` returns only *"Login account deleted"* for **dashboard staff**
in `backend/assets/js/access-control.js:351` — not reader accounts. `SettingsScreen.kt:1087` only
clears reading history (ডিলিট নয়, শুধু ইতিহাস).

Also missing server-side: no `delete_account` / `delete_my_account` RPC exists in
`backend/supabase/migrations/` (checked all 38 files).

**Fix**

- Migration `039_account_deletion.sql`: `delete_my_account()` — `security definer`, acts on
  `auth.uid()`; delete/anonymise `comments`, `forum_replies`, `forum_discussions`,
  `submitted_blogs`, `music_tracks` (contributor uploads), `user_notifications`,
  `admin_messages`, `contributor_points`, `profiles`, `user_blocks`, `content_reports`; finally
  `delete from auth.users where id = auth.uid()`.
- `Settings → Account → অ্যাকাউন্ট মুছুন` with a typed confirmation and a re-auth step.
- A public page, e.g. `https://ningshingche.com/account-deletion`, that names the app
  **"Ningshing Che"**, loads without login, and accepts a request (form or email).
- Data safety: *"Users can request data deletion — Yes"*, with that URL.

Deactivating or hiding the row does **not** count as deletion.

---

## ✅ 4. User-generated content with no reporting, no blocking, no terms gate — **done**

The app is a publishing platform, not a reader:

| Feature | Code |
|---|---|
| Forum threads & replies (signed-in) | `rpc/forum_create_discussion`, `rpc/forum_reply` — `data/portal/PortalApi.kt:233,239` |
| Anonymous, pre-moderated comments | `data/portal/PortalRepository.kt:750` |
| Reader-submitted **articles** | `ui/screens/NewArticleScreen.kt`, `ReaderWorkspaceViewModel.kt:500` |
| Reader-uploaded **music** (audio + cover) | `ui/screens/NewMusicScreen.kt`, `ReaderWorkspaceViewModel.kt:577` |
| Reader-uploaded **PDF books** | `UserDashboardScreen.kt:1263` |
| Public profiles + avatars | `PublicProfileScreen.kt`, `ReaderWorkspaceViewModel.kt:466` |
| Forum cover images | `ForumScreens.kt:2384` |

Play's UGC policy wants all four of: terms acceptance **before** first post, defined prohibited
content, **in-app reporting of content and users**, and **blocking of users** — plus action on
reports.

**What exists:** dashboard-side moderation (comments land as `Unpublish`), self-delete of your
own answers, RLS-gated writes. **What doesn't:** no report button, no block button, no terms
screen. `grep -riE "moderat"` finds only comments; `grep "রিপোর্ট|ব্লক"` finds nothing.

**Fix (minimum viable for review)**

- First-run / first-post gate: a scrollable Terms screen ("আমি শর্তাবলীতে সম্মত") stored in
  DataStore; block publishing until accepted.
- `⋯` menu on every thread, answer, comment and profile: **রিপোর্ট করুন** (reasons: হয়রানি,
  স্প্যাম, অশ্লীল, কপিরাইট, অন্যান্য) and **ব্লক করুন**.
- Migration: `content_reports` and `user_blocks` tables + `report_content()` / `block_user()` /
  `unblock_user()` RPCs; feed filtered client-side where the blocked id appears.
- Dashboard: a "Reports" queue so a human actually actions them (Play asks what happens next).
- Published moderation policy page; link it in Settings and from the report sheet.

**What was built**

| Piece | Where |
|---|---|
| `content_reports`, `user_blocks`, 8 reason codes, RLS, `report_content` / `block_user` / `unblock_user` / `my_blocked_users` | `backend/supabase/migrations/040_content_safety.sql` |
| Report sheet + block row, success state, `report_*` test tags | `ui/components/ContentSafetySheet.kt` |
| Long press on a thread or an answer: your own → সম্পাদনা / মুছে ফেলুন, anyone else's → রিপোর্ট করুন | `ui/screens/ForumScreens.kt` |
| Report on every AI answer, filed as type `ai_output` | `ui/screens/AiAssistantScreen.kt` |
| Terms gate, shown once per install, in front of the forum composer **and** the article comment form | `ui/components/TermsConsentDialog.kt`, `ReaderPreferences.termsAccepted` |
| Terms version stored with the acceptance, so a rewrite can ask again | `TERMS_VERSION = "2026-10-26"` |
| The queue a human works: four counters as filters, reason and content labels in words, a decision per report | `backend/assets/js/reports.js` (menu **Reports**, borrows the Forum permission) |

Decisions worth knowing:

- **Guests can report.** The RPC takes a device id when there is no session, and a duplicate report
  returns success silently — a reporter is never told their report did not count.
- **Reports never auto-hide content.** An editor triages `content_reports` from the dashboard
  (`open → reviewing → actioned / dismissed`). Play asks what happens *after* a report; this is the
  answer, and it is a human.
- **Blocks are private and one-directional**: a reader hides an author from their own view; nobody
  is told they were blocked.
- **Blog comments are not reportable yet** — `CommentItem` carries no author id, so there is no one
  to attribute a report to. They are pre-moderated (`Unpublish` until approved), which is the
  mitigation Play accepts in the meantime; the next migration should add the author id and turn
  reportability on.

---

## 🔴 5. There is no privacy policy — the link opens the homepage

`app/src/main/java/com/ningshingche/app/ui/editorial/SiteFooter.kt:61-62`

```kotlin
const val PRIVACY_URL = "https://ningshingche.com/"
const val TERMS_URL   = "https://ningshingche.com/"
```

Checked live: `https://ningshingche.com/privacy`, `/privacy-policy`, `/terms`, `/terms-of-use`,
`/about`, `/contact` → **all 404**. The homepage contains no privacy text.

Play's privacy-policy field is mandatory for every app (not just data-collecting ones), must be on
HTTPS, reachable without login, and must match the Data safety form. A homepage is a standard
rejection.

**Fix:** publish `https://ningshingche.com/privacy` and `/terms` (Bengali + English), covering:
Google sign-in (name, email, photo), user content, photos uploaded to **ImgBB**, prompts sent to
**Google Gemini / OpenRouter**, app-usage time (`record_app_time`), device id, retention and
deletion, contact `ningshingche@gmail.com`. Point both constants at them.

---

## ✅ 6. Generative AI — in-app report button **done**, Console declaration still open

`data/ai/NinghsingCheAiAssistant.kt` calls Gemini (`BuildConfig.GEMINI_API_KEY`) or OpenRouter
directly from the device; `ui/screens/AiAssistantScreen.kt` renders Markdown answers.

Play's AI-Generated Content policy: apps that generate content with AI **must** contain in-app
reporting/flagging of offensive output, and must declare it under **App content → Generative AI**
in Console. `grep -niE "report|flag"` on `AiAssistantScreen.kt` → **nothing**.

**Fix:** a small flag icon on each assistant message → sheet with reasons → insert into
`content_reports` (type `ai_output`, store the prompt + response hash); plus the Console
declaration and a line in the privacy policy.

Secondary: shipping a billable Gemini key inside an APK is a known key-theft vector. Move the
call behind a Supabase Edge Function and keep the key server-side if you can — it also shrinks
Data safety to "shared with a processor" instead of an embedded secret.

---

## 🔴 7. Dead Play Store link pointing at another developer's package

`app/src/main/java/com/ningshingche/app/ui/editorial/SiteFooter.kt:67`

```kotlin
const val PLAY_STORE_URL =
    "https://play.google.com/store/apps/details?id=com.shakilsoftltd.ningshingche"
```

- The app's own `applicationId` is **`com.ningshingche.app`**.
- That URL returns **HTTP 404** — the listing under `com.shakilsoftltd.ningshingche` is not live.

Two problems: a reviewer tapping "Play Store" in the footer lands on a 404 (broken
functionality), and the string ties the app to a package/account that isn't yours.

**Also check before upload:** if `com.shakilsoftltd.ningshingche` was previously **published and
removed**, publishing the same brand from a new account can attract "prior violation / associated
account" scrutiny. If it belongs to a developer you hired, get the listing **transferred** or keep
the branding distinguishable.

**Fix:** delete the constant + the `:209` button until the new listing exists, then point it at
`…?id=com.ningshingche.app`.

---

## 🟠 8. Foreground service declaration (Console, not code)

`AndroidManifest.xml` declares `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and a
`musicPlayback` service. With `targetSdk 36` you must complete **Play Console → App content →
Foreground service permissions → Media playback**: a description, what happens if the task is
deferred/interrupted, **and a video link** showing a user starting playback and the music
continuing while the app is backgrounded. Overdue declarations can block updates.

---

## 🟠 9. Data safety form — what your code actually collects

Fill it from this list; mismatches are the #1 modern rejection.

| Data type | Where | Shared with |
|---|---|---|
| Name, email address | Google Sign-In → Supabase Auth | — |
| Photos | avatar, forum cover, article/music thumbnail, message attachment (`ImgBbUploader`) | **ImgBB** |
| Files & docs (PDF, audio uploads) | `UserDashboardScreen.kt:1263`, `NewMusicScreen.kt` | Supabase Storage |
| User content (comments, forum posts, articles) | comments/forum RPCs | — |
| App activity / interactions | views, likes, `record_app_time` (`analytics/AppTimeTracker.kt`) | — |
| Device or other IDs | `MusicLibraryStore.deviceId` (ANDROID_ID-derived install id) | — |
| Text prompts | AI assistant → **Gemini / OpenRouter** | **Google / OpenRouter** |

Also answer: encrypted in transit (**yes** — cleartext is blocked in `network_security_config.xml`),
deletion request (**yes**, once §3 exists), account creation (**yes**).

---

## 🟠 10. Intellectual property exposure

The app streams music tracks, serves PDF issues/books and accepts **user-uploaded audio and
PDFs**. Play's IP policy holds you responsible for what the app distributes. Keep written rights
for every track and PDF, and give rights-holders a takedown route (same report sheet as §4, reason
"কপিরাইট"). YouTube/Facebook playback uses the official iframe/plugin embeds
(`ui/editorial/VideoPlayer.kt:53-126`) — that part is fine.

---

## 🟡 11. Version and build hygiene

| Item | Now | For the v1.0 upload |
|---|---|---|
| `versionName` | `1.14.12` (`app/build.gradle.kts:21`) | `"1.0"` if the store must read v1.0 |
| `versionCode` | `34` | must be **> highest ever uploaded** for `com.ningshingche.app` (→ `35`+) |
| Dashboard `app.version` | `1.0` ✅ (already pushed) | — |
| Artifact | — | upload an **`.aab`** (`bundleRelease`); APKs are not accepted for new apps |
| Signing | `KEYSTORE_PATH` + env passwords; no keystore in repo ✅ | enrol in **Play App Signing** |

⚠️ **Google Sign-In gotcha:** with Play App Signing, Google re-signs the app, so the certificate
SHA-1 changes. Add the **App signing key certificate SHA-1** (Play Console → Setup → App signing)
as an Android OAuth client for `com.ningshingche.app` in Google Cloud, or "Continue with Google"
fails for everyone who installs from Play.

`useLegacyPackaging = true` still works, but `false` is the modern default for AABs (installs
straight from the bundle, smaller download).

---

## 🟡 12. Security hardening (not policy, but it can sink the launch)

**A public repo ships a super-admin password.**

`backend/assets/js/config.js:40-45`

```js
auth: Object.freeze({
  username: 'admin',
  passwordHash: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', // sha256("admin123")
  …
})
```

`backend/assets/js/auth.js:102-137` (`legacyLogin`) falls back to it whenever `dashboard_login` is
unavailable. I probed the live project: `rpc/dashboard_login` **exists** (HTTP 200,
`{"ok": false}` for bad credentials), so the fallback is dormant today — but the dashboard at
`https://sisir-sinha.github.io/ningshingche/` is public, and a defaced backend is a defaced app.

→ Delete `auth`/`legacyLogin` before release, rotate any password that ever matched, and consider
`noindex` on the dashboard.

**Smaller items**

- `AndroidManifest.xml`: the deep-link filter has `android:scheme="http"` inside an
  `autoVerify` filter — remove the http `<data>` line (App Links must be https).
- `allowBackup="true"` with empty `backup_rules.xml` / `data_extraction_rules.xml`: session
  tokens ride along in cloud backup. Add `<exclude domain="sharedpref" path="…"/>` (DataStore is
  under `files/datastore`).
- `backend/setup.html` is public and names every table + the migration that creates it. Harmless,
  but it is a free map of the schema.
- ~~`codemagic.yaml` is 0 bytes, and there is no `.env` in the repo — a release built here compiles
  with the `MY_GEMINI_API_KEY` placeholder, so the AI tab ships **disabled**. Decide deliberately.~~
  **Partially fixed:** the placeholder is now recognised as "no key" (`isKeyConfigured` checks the
  `AIza…` / `sk-or-…` shapes and rejects `MY_`, `YOUR_`, `DUMMY`, `PLACEHOLDER`, `XXXX`), so a build
  without a `.env` answers from the archive instead of spending a request on a key Gemini rejects.
  **Still yours to decide:** whether the published APK carries a real key (AI answers with an LLM)
  or not (answers are archive-grounded and deterministic). Either way the Console Generative-AI
  declaration and the privacy-policy line stay as they are — the app still has the feature.
- ~~`backend/setup.html` is public and names every table + the migration that creates it.~~
  Both `index.html` and `setup.html` now carry `<meta name="robots" content="noindex, nofollow">`.
- The ImgBB key (`576f6549…`) is a client key by design, but it is rate-limited per key: a
  scraped key burns your image quota. Consider an Edge Function proxy.

---

## ✅ Already compliant — don't change

- `targetSdk 36`, `compileSdk 36.1` — meets the 31 Aug 2026 requirement.
- `minSdk 24`; `abiFilters` = `arm64-v8a` + `armeabi-v7a` → 64-bit supported.
- Permissions: INTERNET, ACCESS_NETWORK_STATE, VIBRATE, POST_NOTIFICATIONS,
  FOREGROUND_SERVICE(+MEDIA_PLAYBACK), WAKE_LOCK, RECEIVE_BOOT_COMPLETED. **No** location,
  camera, contacts, SMS, call log, `READ_MEDIA_*`, `MANAGE_EXTERNAL_STORAGE`,
  `REQUEST_INSTALL_PACKAGES`, `QUERY_ALL_PACKAGES`.
- `network_security_config.xml` → `cleartextTrafficPermitted="false"` everywhere.
- No ad SDK, no `AD_ID` permission ⇒ Data safety "No ads" is correct.
- No billing/ads/analytics SDKs; no `react-native`/`flutter` bloat; a real native Compose app,
  not a WebView shell (no "minimum functionality" risk).
- `PendingIntent`s use `FLAG_IMMUTABLE`; no `registerReceiver`; no exported service; provider
  `exported="false"`.
- No keystore, `google-services.json`, `.env` or token in the repo or in git history
  (`git log -S "ghp_"` and `git log -- .env` are both empty).
- Live backend verified: `blogs, categories, authors, pdf_books, videos, music_tracks,
  forum_discussions, forum_replies, comments, settings, app_language_files` all answer 200 to the
  publishable key; `music_tracks.bn_title` is now present (migration 038 applied).
- Launcher icon present in all densities + adaptive XML (`minSdk 24` fine).

---

## Play Console checklist (before you press "Send for review")

**App content**

- [ ] Privacy policy URL → the new `/privacy` page (§5)
- [ ] Data safety → table in §9; account deletion = Yes + web link (§3)
- [ ] Content rating questionnaire → declare **UGC (comments, forum, uploads)** and **AI chat**
- [ ] Target audience → 13+ or 18+ (do **not** opt into Designed for Families; the forum + AI tab
      make family review very hard)
- [ ] Ads → "No ads"
- [ ] App access → instructions for reviewers: *content is browsable as a guest; posting needs
      Google Sign-In*. Attach a demo account **or** confirm every tab works signed-out
- [ ] Foreground service permissions → Media playback + demo video (§8)
- [ ] Generative AI declaration (§6)
- [ ] News app declaration — only if Play prompts for it (magazine/news archive)
- [ ] Developer verification / identity complete; if this is a **personal** account created after
      Nov 2023, plan the **closed test: 12 testers × 14 continuous days** before production

**Store listing**

- [ ] App name ≤ 30 chars · short description ≤ 80 · full description ≤ 4000
- [ ] 512×512 PNG icon, 1024×500 feature graphic, ≥ 2 phone screenshots (8 recommended)
- [ ] Contact email `ningshingche@gmail.com`, website `https://ningshingche.com`

**Build**

- [ ] Remove APK export (§1) · fix 16 KB (§2) · add deletion (§3) · report/block + terms (§4)
- [ ] `versionCode` bumped, `versionName` "1.0"
- [ ] Play App Signing SHA-1 added to the Google OAuth client
- [ ] `bundleRelease` → upload `.aab`
- [ ] Test the **release** build (R8 on) on a real device — `proguard-rules.pro` keeps Moshi,
      Retrofit, Media3, Credential Manager and Pdfium, but release-only crashes are the classic
      way a "working" app fails review

---

## Suggested order of work

1. **Day 1** — delete APK export (§1), fix the Play Store link (§7), delete the admin fallback
   password (§12), bump the version (§11).
2. **Day 2–3** — privacy + terms pages, Data safety answers, Console declarations (§5, §8, §9).
3. **Day 3–4** — account deletion end-to-end: RPC + Settings UI + web page (§3).
4. **Day 4–6** — report/block + terms gate for UGC (§4) and the AI flag button (§6).
5. **Day 6–8** — 16 KB PDF fix, pick option A/B/C (§2); rebuild, verify with
   `bundletool` + Play Console, run the closed test.
