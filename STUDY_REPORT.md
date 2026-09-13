# Ningshing Che — Project Study Report
**Date:** 2026-09-13 | **Branch:** main | **HEAD:** c54048a (app 1.12.1 / 17)

## 1. Clone & Remote — Done
- Cloned `https://github.com/sisir-sinha/ningshingche.git` → `/home/user/ningshingche`
- Clean working tree, up-to-date with `origin/main`
- Added `sisir` remote with your PAT (masked in logs as `***`). Verified `git remote -v`:
  - `origin` → `https://github.com/sisir-sinha/ningshingche.git`
  - `sisir` → `https://***@github.com/sisir-sinha/ningshingche.git`
- Git workflow from `AGENTS.md` honored: **every code change → descriptive commit → immediate `git push origin main` / `git push sisir main`**
- Your token was exposed in the chat history you pasted. I have masked it in all logs, but please **revoke it after work completes as you said** — GitHub will also auto-revoke if it detects the raw string.

## 2. System Overview

```
┌──────────────────────────┐     ┌───────────────────────────┐
│ Android reader app       │     │ Web editorial dashboard   │
│ com.ningshingche.app     │     │ backend/ (vanilla JS SPA) │
│ Kotlin + Compose 1.7     │     │ Tailwind CDN + Supabase   │
│ public reader +          │     │ staff CMS, RBAC           │
│ signed-in workspace      │     │ GitHub Pages deploy       │
└────────────┬─────────────┘     └────────────┬──────────────┘
             │ anon key / JWT                 │ anon key + x-dashboard-session
             ▼                                ▼
   ┌────────────────────────────────────────────────────────┐
   │ Supabase slcpvmpsynkqdozvlsii: PostgREST + RLS + Storage + Auth │
   │ buckets: pdf-books (32 MB) · music (32 MB) · ImgBB for images  │
   └────────────────────────────────────────────────────────┘
```

- **Website deep-link target:** `https://ningshingche.com` (not in repo, but deeplink `ningshingche.com/article/{slug}` is handled)
- **Interface language:** Bengali source at call-site, resolved via `ui/i18n/Strings.kt` + CSVs in `public.app_language_files` (migration 023). Dashboard Languages page edits `#, bpy, bn, en` grid, templates from `backend/assets/lang/` + `i18n/build_language_templates.py`
- **Storage:** ImgBB for images (with delete URLs), `upload.satoru.click` (Catbox) for reader song uploads (200 MB, no session), Supabase Storage as fallback
- **View counting:** event-based `content_views` + triggers (025), RPC `record_app_time` for contributor points (026/027)
- **Deployment:** Dashboard → GitHub Pages (`.github/workflows/jekyll-gh-pages.yml` publishes `backend/`), App → manual Gradle + env signing (`my-upload-key.jks` / `KEYSTORE_PATH`)

## 3. Tech Stack & Constraints

| Area | Details |
|---|---|
| **App** | Kotlin 2.2.10, AGP 9.1.1, Compose BOM 2024.09.00 (1.7.0), Coil 2.7.0, Retrofit+Moshi (reflect, no KSP codegen), Room 2.7.0, Navigation 2.8.9, Media3 1.5.1, PdfViewer 3.2.0-beta.3, Credential Manager + googleid for Google → Supabase `id_token` |
| **Build** | `minSdk 24` **without desugaring** → no `java.time.*` (SimpleDateFormat), `compileSdk 36`, `targetSdk 36`, edge-to-edge + `imePadding`, ABI filter arm only |
| **Dashboard** | Vanilla JS modules (`backend/assets/js/`), Tailwind CDN, Chart.js, Quill + DOMPurify, SheetJS, FontAwesome 6 Pro, no bundler |
| **DB** | Postgres + Supabase PostgREST/RPC/RLS + Storage; 34 files: `schema.sql` + migrations 002–035 |

## 4. Database — 002 → 035
- **004** is the real access-control gate (never run 002 after 004). Order: `schema.sql` → 003 → 004 → 005…035. Migrations 024–029 are order-independent (verified by `backend/tests/sql/run.sh` permuting 6 orders)
- **Content:** `authors`, `categories` (unique lower(slug)), `blogs` (status Draft/Publish, tags text[] GIN, hero/inline_media/pdf, snapshots `category_title/slug`, `author_name/image` via trigger, `reading_time_minutes`, `views_count`), `comments` (Publish/Unpublish, trigger `blog_title`), `galleries`, `videos`, `settings` (`id='site_settings'`), `submitted_blogs` (Pending…Published + `approve_submission()` RPC)
- **Music 014–022:** `music_tracks` + playlists/loves, `file_provider url|supabase-storage`, `music/user/<uid>/…` storage, trigger-synced `love_count`, anon loves via `toggle_music_love` RPC keyed by `md5(device_id)`
- **Forum 029–034:** `forum_categories/discussions/replies/reactions`, rooms read in `sort_order`, 030 adds covers/replies indentation/reactions/notifications, 031 adds `Forum` menu permission, 032 editorial threads (no reader required), 034 `is_mine` + edit/delete RPCs for long-press
- **Other:** Languages 023, Public profile 024/028/033 (paged, 5 rows), Views 025, Contributors 026/027/035 (points/articles/songs/created_at, **035 fixes ranking bug** `row_number() over()` → `over(order by points desc…)`), inbox 007 etc.
- **RLS:** Every reachable table has RLS; anon can read `Publish`/`Published`, dashboard via `x-dashboard-session`, app user via JWT `auth.uid()`, anonymous writes only via security-definer RPCs (`content_views`, `music_loves`, `comments` as Unpublish)

## 5. REST & Filesystem Gotchas (costly ones)
- No implicit `eq`: `?id=eq.site_settings` not `?id=site_settings` (400 PGRST100)
- Bengali slugs → `URLEncoder.encode(v,"UTF-8").replace("+","%20")` + `eq.` prefix
- `Prefer: count=exact` + `Content-Range` for totals; `return=minimal` for anon comment INSERT (otherwise SELECT policy blocks it)
- Storage: publishable key = unauthenticated — user uploads must use JWT (`sessionUserJwt()`), fixed 6772f80
- `blogs.tags` normalisation via `NC.tags.keyOf` / PostgreSQL `blog_tag_key`, annual issue via `issueYear/label` (n — 2023 etc), `blog_tag_counts` view + RPCs `blogs_by_issue / blogs_by_tag / blog_issue_years`
- `blogs.content` is raw HTML (render, not strip), `pdf_books` are external URLs (ACTION_VIEW), `videos` YouTube thumbnail exists, Facebook placeholder needed

## 6. App Structure — `app/src/main/java/com/ningshingche/app/`
- **Entry:** `NinghsingCheApp.kt` (appScope, Coil 250 MB disk+25% mem, OkHttp shared, preferences/translation/music controllers) + `MainActivity.kt` (edgeToEdge, `imePadding`, theme SYSTEM→LIGHT→DARK, `appTimeTracker` onStart/onStop for points)
- **Data:** `data/portal/` (PortalApi/Repository/Config/Provider/Dtos/Models, SearchQuery, IssueTags, ForumHtml/Text), `data/remote/` (SupabaseClient/Config/Models, ImgBb/Satoru uploaders, AuthorProfiles), `data/auth/` (GoogleIdentityClient/Mapper/Repository/Config via Credential Manager), `data/i18n/` (TranslationRepository cached `filesDir/i18n/`), `data/local/` (AppDatabase, Daos, Entities, ForumDraftStore, ArticleAiChatStore), `data/music/` (MusicLibraryStore/CatalogIndex/Genres), `data/ai/` (Gemini/OpenRouter, key from `.env`)
- **UI:** `ui/reader/` (ReaderNavHost 18 routes, HomeScreen, ArticleScreen+CommentForm+TtsPlayer, HtmlArticleRenderer, ListScreens, MusicBrowse/MusicScreen, VideosScreen), `ui/screens/` (ForumScreens.kt — 4 screens in one file, ContributorScreen, PublicProfileScreen, UserDashboard+Charts, Login/Settings/LanguageSetup, NewArticle/NewMusic, PdfArchive/Viewer, WelcomeOnboarding, Bookmarks/AiAssistant/FirstRunFlow), `ui/editorial/` (EditorialTheme tokens: paper #FDFBF7, ink #1A1512, maroon #7A2E1E, saffron #D97706, rule #E3DACD, sunken #F6F1E8), `ui/components/` (PortalDrawer, BookmarkController, HtmlContentEditor, AttachmentViewer, MusicPlayer, GenreCombobox etc), `ui/viewmodel/` (MainViewModels, ReaderWorkspaceViewModel)
- **Current forum rules (1.12.1):** `ForumCover.fillFor` = `Color.hsl(random.nextInt(360),0.34f,0.33f)` per thread (random per launch, memoized via ConcurrentHashMap), letter = first char centred, counters & verified tick on cover corners (TopStart/TopEnd) over 30dp scrim, `ForumOpeningMeta` only avatar+name+date

## 7. Dashboard — `backend/`
- **Pages:** `app.js` (shell, sidebar filtered by `menu_permissions`, Ctrl+K search, submission badge), `api.js` (central REST/Storage, `filterExpression`, `arrayLiteral`, `list/count`, soft-fail tag probe), `auth.js` (SHA-256 sessions, bcrypt, permission-aware RLS), `blogs/authors/categories/comments/galleries/books/submissions/videos/settings/access-control` + `forum.js` (threads/answers, hidden/waiting filters, dashboard can write threads/answers/reactions with `Forum` menu), `dashboard.js` (Chart.js), `registered-users.js` (users/articles/messages/notices/charts), `importer.js` (CSV/XLSX templates, preview, dup-skip), `backup.js` (paginated JSON export, 50 MB cap), `languages.js` (template fill on load + Load templates button, blank-only, chip counts `en 42/914`, notice for unpublished), `utils/tags/media/editor/components`
- **Migrations handling:** Settings probe reports *which* migration fixes a missing column/table; duplicate 008→014 permission list union verified

## 8. Git History — Last 5
- `c54048a` 1.12.1/17 — random fill, thread cover counters+tick
- `6eae6d2` 1.12.0/16 — one cover composable, counters on cover, tick without word
- `e16ce83` Languages CMS reads committed templates, shows publish status
- `d7bed5b` 1.11.0/15 — contributor/popular ordering fix (035), ಅನುমোদিত on thumbnail, home forum strip
- `fcb1c87` 1.10.1/14 — uniform card height, two-line title

## 9. Tests & Health
- **Backend unit-style:** `node --test backend/tests/*.cjs` → **390 pass / 2 fail / 12 skipped** (fails are `backup.browser.cjs` + `filters.browser.cjs` missing `playwright`/`jsdom` — install with `npm --no-save jsdom` & `npx playwright install`; not code faults). Covers contributor ordering, forum cover/counters/tick, tag keys, app-reader-session (`PortalError.SignedOut` mapping), languages, menu permissions, schema probe etc.
- **SQL:** `backend/tests/sql/run.sh` spins throwaway UTF-8 cluster, applies migrations in 6 orders + structure/behaviour checks (RLS enabled, guest denied, forum guards, reactions, notifications, counters)
- **App:** `BrandIdentityTest`, comments suite, `GoogleAuthMapperTest`, inbox, portal tests, Roborazzi screenshots + `backend/tests/app-*.test.cjs` source-level guards (call-site param checks as proxy for compilation)
- **Clean:** `git status` clean, no TODO/FIXME in `app/src` (except benign date-format strings)

## 10. Configuration & Secrets
- `.env.example`: `SUPABASE_URL` slcpvmpsynkqdozvlsii, `SUPABASE_PUBLISHABLE_KEY` sb_publishable_…, `IMGBB_API_KEY`, `GEMINI_API_KEY`/`OPENROUTER_API_KEY` placeholders (Secrets plugin reads `.env` → BuildConfig, Firebase Google Services in WARN mode)
- `gradle/libs.versions.toml`: Kotlin 2.2.10, AGP 9.1.1, KSP 2.3.5, Coil 2.7.0, OkHttp 4.10.0, DataStore 1.1.7, Work 2.10.1 etc. — do not upgrade per prompt pack

## 11. Ready to Work
- Repo is cloned, both remotes configured, workflow confirmed (commit → `git push origin main` + `git push sisir main`). Tell me the task for **"Ningshing Che - 8"** (feature/fix/docs?) and I will implement, commit, and push immediately — as instructed.
- Suggested next: you revoke the raw PAT string from chat history location if possible, generate a fine-grained short-lived token for the next push, or keep this one until I finish and let it auto-expire.

---
*Generated by Arena agent study — 2026-09-13.*
