# Ningshing Che — Project Study Report (Phase 9)
**Date:** 2026-09-22 | **Branch:** main | **HEAD:** 75d4364 (app 1.14.11 / 33, site 1.9.6)

---

## 1. Clone & Remote Verification — Complete

- **Repository:** `https://github.com/sisir-sinha/ningshingche.git` cloned into `/home/user/ningshingche`.
- **Working Tree:** Clean, synchronized with upstream `main`.
- **Remote Configuration:**
  - `origin` → `https://***@github.com/sisir-sinha/ningshingche.git`
  - `sisir` → `https://***@github.com/sisir-sinha/ningshingche.git`
  *(PAT token credential masked in all persistent logs and reports; configured for authenticated pushes).*
- **Push Pipeline Verification:**
  - Verified remote connectivity with `git push --dry-run origin main` and `git push --dry-run sisir main` (both reported clean & up-to-date).
- **Enforced Workflow (`AGENTS.md`):**
  - Every modification undergoes a descriptive git commit and is pushed immediately to both remotes (`origin main` and `sisir main`).
  - Note: As planned, remember to revoke the GitHub Personal Access Token once the work session concludes.

---

## 2. System Architecture

```
┌──────────────────────────────────────┐     ┌────────────────────────────────────────┐
│ Android Reader App                   │     │ Web Editorial Dashboard (CMS)          │
│ com.ningshingche.app                 │     │ backend/ (Vanilla JS ES modules SPA)   │
│ Kotlin 2.2.10 + Jetpack Compose 1.7  │     │ Tailwind CSS CDN + Chart.js + Quill    │
│ Anonymous Reader + Reader Workspace  │     │ Role-Based Access Control (RBAC)       │
│ Offline Room DB + Media3 ExoPlayer   │     │ Deployed via GitHub Pages Workflow     │
└──────────────────┬───────────────────┘     └───────────────────┬────────────────────┘
                   │ Supabase Anon Key / JWT                     │ Anon Key + x-dashboard-session
                   ▼                                             ▼
   ┌───────────────────────────────────────────────────────────────────────────────────┐
   │ Supabase Project (slcpvmpsynkqdozvlsii): PostgreSQL 15 + PostgREST + RLS + RPC    │
   │ Migrations: 002 → 037 (order-verified) | Storage buckets: pdf-books, music (32MB) │
   │ External Services: ImgBB (images), upload.satoru.click / Catbox (audio/docs),     │
   │ Google Identity Credential Manager (Supabase JWT), Gemini/OpenRouter (AI chat)    │
   └───────────────────────────────────────────────────────────────────────────────────┘
```

- **Target Website & Deep Links:** `https://ningshingche.com` (supported routes: `ningshingche.com/article/{slug}` and `ningshingche.com/{id}`).
- **Interface Internationalization (i18n):**
  - Source strings authored in Bengali across all call sites, wrapped with `t(...)`.
  - Offline packaged fallbacks (`app/src/main/assets/i18n/en.csv` & `bpy.csv`) ensure instant translation without server round-trip on first launch.
  - Remote translations synchronized from `public.app_language_files` (migration 023) and cached in `filesDir/i18n/`.
  - Dashboard Languages page enables live CMS translation edits for `bn`, `en`, and `bpy` (Bishnupriya Manipuri).
- **Storage Strategy:**
  - Images: ImgBB API with stored deletion hashes/URLs.
  - Reader audio: `upload.satoru.click` (Catbox backend, 200 MB limit, session-free).
  - PDFs & editorial media: Supabase Storage (`pdf-books` bucket) and external GitHub Pages hosted assets.
- **Analytics & Engagement:**
  - View tracking: 30-minute deduplication session window per content item (migration 036).
  - Differentiates anonymous visitors from authenticated readers.
  - Audio plays are counted only after meaningful listening duration, not on mere start.
  - Contributor leaderboard: calculated via `record_app_time` RPC and `get_contributor_leaderboard` (migrations 026, 027, 035).

---

## 3. Technology Stack & Environment Constraints

| Layer | Specifications & Constraints |
|---|---|
| **Android Application** | Kotlin 2.2.10, AGP 9.1.1, Jetpack Compose BOM 2024.09.00 (Compose 1.7.0), Material 3, Coil 2.7.0, Retrofit 2.x + Moshi (reflection-based via `KotlinJsonAdapterFactory`), Room 2.7.0, Navigation Compose 2.8.9, Media3 ExoPlayer 1.5.1, Android PdfViewer 3.2.0-beta.3, Credential Manager + `googleid` for Google Sign-In. |
| **Android Build Rules** | `minSdk 24` **without core library desugaring** (strict constraint: **no `java.time.*`**; use `SimpleDateFormat` / `DateFormats.kt`), `compileSdk 36`, `targetSdk 36`, edge-to-edge layout via `enableEdgeToEdge()` + explicit `WindowInsets.ime` handling, ABI filters limited to `armeabi-v7a` and `arm64-v8a` for lean APK distribution. |
| **Editorial Dashboard** | Vanilla ES Modules (`backend/assets/js/`), Tailwind CSS CDN, Chart.js, Quill Editor with DOMPurify sanitization, SheetJS for spreadsheet import/export, FontAwesome 6 Pro icons, zero bundler footprint. |
| **Database & API** | PostgreSQL 15 on Supabase, PostgREST REST API, 36 sequential migrations (`002_production_rls.sql` through `037_profile_views.sql`) + `schema.sql`. RLS enabled across all user-accessible tables. |

---

## 4. Key Milestones & Upgrades (Evolution from 1.12.1 to 1.14.11)

Between version 1.12.1 and the current 1.14.11 release, significant architectural refinements and optimizations were delivered:

### A. Rendering & Scroll Performance Optimization (`a9cfe1a`)
- **Static Verified Badge:** Eliminated the infinite pulsing scale animation in `VerifiedBadge.kt` that was triggering re-composition every frame across all feed and author list rows.
- **Single-Instance Date Formatter Cache (`DateFormats.kt`):** Replaced per-row `SimpleDateFormat` instantiations with thread-local cached formatters and timestamp-keyed memoization.
- **Zero-Allocation Bengali Numerals (`BengaliNumerals.kt`):** Replaced multi-allocation digit conversion routines with a single-pass `buildString` algorithm.
- **Reader Audio State Decoupling:** Decoupled `ArticleScreen` bottom padding from the continuous 400ms audio player position ticks by observing an isolated boolean toggle (`isPlaying`), eliminating full-screen re-compositions during playback.
- **Immutable Article Model:** Annotated `Article` with `@Immutable` to allow Compose's compiler to skip redundant re-compositions of list items during scroll events.
- **Fast-Path Translation Lookup:** Added instant short-circuiting for empty translation tables and capped memoization (`looseKeyOf`) to avoid per-frame regex normalizations.

### B. Static Compilation & Architecture Safety Suite (`app-compiles.test.cjs`, `0b5b6c2`, `75d4364`)
- Built an AST-like static analyzer in Node.js test suite acting as a compilation validator in the absence of an Android SDK:
  - Verifies no function call passes duplicate named arguments (including nested invocations).
  - Asserts `lineHeight` is only assigned to supported typography composables.
  - Prohibits `const val` declarations initialized via runtime function calls.
  - Ensures spans never declare line-box heights.
  - Validates that `t(...)` remains a plain non-composable function for unrestricted ViewModel/coroutine usage.
  - Validates all internal package imports resolve to existing declarations.
  - Verifies member call references against type definitions and extension receivers across packages.

### C. Text Scaling & Tight Leading System (`TextScale.kt`, `3204b37`, `28c1f08`)
- Centralized font sizing dial: `APP_TEXT_SCALE = 1.12f` and `MIN_READABLE_SP = 12.5f` to ensure complex Bengali conjuncts and matras remain legible.
- Strict leading dial: `APP_LEADING = 1.45f` and `DISPLAY_LEADING = 1.3f` replacing loose default font metrics (1.575x line gaps in Kalpurush) to tighten layout air without clipping glyphs.
- Custom helpers `textSize(size)` and `leading(size)` enforced across all typography components.

### D. Complete Multi-Language i18n System (`51f6a86`, `e094e6e`, `95b3c7b`)
- Wired all **1,013 call sites** in UI screens, notifications, viewmodels, and playback controllers to `t(...)`.
- Packaged offline translations (`app/src/main/assets/i18n/en.csv` and `bpy.csv`) covering all 940 interface strings.
- Layered resolution hierarchy: (1) Dashboard published CSV → (2) Packaged assets CSV → (3) Compiled Bengali source string.
- Root navigation graph recomposition keyed directly on active `TranslationTable`.

### E. Theme Palettes & WCAG Contrast Engine (`EditorialPalettes.kt`, `c3e4242`, `36104f7`)
- Six distinct editorial palettes selectable in Settings:
  1. **নীলা-কালি (Indigo):** Default cool paper with indigo and gold accents.
  2. **চোখে-আরাম (EyeWarm):** Warm sepia paper with earthy tones for long reading sessions.
  3. **নিশীথ (Night):** Pure OLED black with high contrast.
  4. **বন (Forest):** Calming forest greens and olive gold.
  5. **গোলাপ (Rose):** Warm rose and muted blue.
  6. **নিজের রঙ (Custom):** Dynamic user-chosen hue wheel that calculates WCAG-compliant contrast ratios (4.5:1+ for text, 7:1+ for ink) via binary search.

### F. View Analytics & Listening Session Logic (Migrations 036 & 037, `a42c1e8`, `6a95fa9`)
- 30-minute deduplication window for content views.
- Audio play counts logged only when actual audio duration is consumed.
- Total public profile view aggregations calculated on the database level via RPC.

---

## 5. PostgREST & Data Access Rules

When interfacing with Supabase via PostgREST, the following rules must strictly be followed:
1. **Explicit Comparison Operator:** Always prepend the operator: `?id=eq.site_settings` (never `?id=site_settings` which returns HTTP 400 `PGRST100`).
2. **Bengali Slug Encoding:** Slugs and category parameters must be percent-encoded: `URLEncoder.encode(slug, "UTF-8").replace("+", "%20")` preceded by `eq.`.
3. **Compound Filters:** Use parentheses format for OR filters: `?or=(id.eq.X,slug.eq.Y)`.
4. **Exact Pagination Counts:** Pass `Prefer: count=exact` header and extract count from `Content-Range`.
5. **Anonymous Writes:** Anonymous public comment insertion must use `Prefer: return=minimal` because RLS inserts comments under `Unpublish` status which cannot be read back by anonymous users.

---

## 6. Test Suite & Validation Health

- **Node.js Automated Test Suite:**
  - Command: `node --test $(ls backend/tests/*.cjs | grep -v '\.browser\.cjs')`
  - Results: **575 passed / 0 failed / 0 skipped** across 234 test groups.
  - Verified areas:
    - Code compilation & reference safety (`app-compiles.test.cjs`)
    - Theme palettes & contrast ratios (`app-theme-palette.test.cjs`)
    - Font scale & leading dial consistency (`app-text-scale.test.cjs`)
    - Internationalization string inventory & offline fallbacks (`app-language-swap.test.cjs`, `app-language-fill.test.cjs`)
    - Scroll performance & animation guards (`app-scroll-performance.test.cjs`)
    - Audio tabs, dashboard navigation, and forum interaction suites (`app-forum*.test.cjs`, `app-dashboard-tabs.test.cjs`)
    - View counting logic & database triggers (`view-counting.test.cjs`)
    - Dashboard access control, menu permissions, and schema probe (`schema-probe.test.cjs`, `menu-permissions.test.cjs`)

---

## 7. Status & Readiness for Phase 9 Tasks

The repository is fully synchronized, both remotes (`origin` and `sisir`) are active and verified, all tests are passing, and the codebase architecture is documented and understood.

Ready to proceed with any specific feature, bug fix, or refactoring for **Ningshing Che - 9**. Please let me know the task requirements!
