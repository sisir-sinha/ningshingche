# Ningshing Che — Android App: UI Foundation & API Integration Guide

**Audience:** the engineer/AI agent implementing the app UI against the live API.
**Companion:** [`backend/API.md`](./backend/API.md) — the server-side contract (REST, RPC, Storage, RLS,
error codes). Read that first; this document explains *how the Kotlin app consumes it today* and
*what must change* so every screen is functional.

Everything below was read from `app/src/main/java/com/ningshingche/app/**`, `app/build.gradle.kts`, and
`gradle/libs.versions.toml`. Line references are to the current `main`.

---

## Table of contents

1. [Project facts](#1-project-facts)
2. [Architecture](#2-architecture)
3. [Composition root and DI](#3-composition-root-and-di)
4. [Navigation](#4-navigation)
5. [Theme and design tokens](#5-theme-and-design-tokens)
6. [Data layer — Supabase client](#6-data-layer--supabase-client)
7. [Data layer — models and column mapping](#7-data-layer--models-and-column-mapping)
8. [Data layer — Room cache](#8-data-layer--room-cache)
9. [Data layer — repositories](#9-data-layer--repositories)
10. [Image and PDF media](#10-image-and-pdf-media)
11. [ViewModel contracts](#11-viewmodel-contracts)
12. [UI inventory — screens and components](#12-ui-inventory--screens-and-components)
13. [API coverage matrix (implemented vs available)](#13-api-coverage-matrix-implemented-vs-available)
14. [Critical gaps and required changes](#14-critical-gaps-and-required-changes)
15. [Implementation recipes](#15-implementation-recipes)
16. [Definition of done](#16-definition-of-done)

---

## 1. Project facts

| Item | Value |
| --- | --- |
| Module | `app/` (single-module Gradle project, root `settings.gradle.kts` includes `:app`) |
| Namespace / packages | `com.ningshingche.app` (root), `com.ningshingche.app.data.*`, `com.ningshingche.app.ui.*`, `com.ningshingche.app.util.*` |
| `applicationId` | `com.ningshingche.app` |
| `minSdk` / `targetSdk` / `compileSdk` | 24 / 36 / 36.1 |
| Kotlin | 2.2.10, JVM target 11 |
| Compose | Material 3, BOM `2024.09.00`, `compose.compiler` via `org.jetbrains.kotlin.plugin.compose` |
| Navigation | `androidx.navigation:navigation-compose` 2.8.9 |
| Local DB | Room 2.7.0 (KSP) |
| Images | Coil 2.7.0 (`coil-compose`) |
| Networking | OkHttp 4.10.0 (used directly); **Retrofit 2.12.0 + Moshi 1.15.2 + logging-interceptor are already dependencies but unused** |
| Prefs | `androidx.datastore:datastore-preferences` 1.1.7 |
| AI | `firebase-ai` (Firebase AI Logic / Gemini), Firebase App Check reCAPTCHA |
| Secrets | `com.google.android.libraries.mapsplatform.secrets-gradle-plugin` — reads `.env`, falls back to `.env.example`, injects `BuildConfig.*` |
| Screenshots tests | Roborazzi 1.59.0 + Robolectric 4.16.1 |
| App entry | `NinghsingCheApp : Application` → `MainActivity : ComponentActivity` |
| Permissions | `INTERNET`, `ACCESS_NETWORK_STATE` |
| Fonts | `app/src/main/res/font/kalpurush.ttf` (Bengali) |

**Branded identity:** see [`app/BRANDING.md`](./app/BRANDING.md) for source-package migration, development-install implications, Firebase registrations, and verified App Links.

BuildConfig keys injected from `.env`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `IMGBB_API_KEY`,
`GEMINI_API_KEY`. Values starting with `MY_` are treated as unset and fall back to
`SupabaseConfig.DEFAULT_*`.

---

## 2. Architecture

```
ui/                         Jetpack Compose screens + reusable components
  ├── MainActivity.kt       NavHost, drawer, top bar, bottom bar, ViewModel wiring
  ├── screens/              Reader-side screens (Home, Explore, Search, Reader, ...)
  ├── dashboard/            In-app CMS (mirrors backend/ web dashboard)
  ├── components/           Shared editorial/portal components
  ├── viewmodel/            HomeViewModel, ExploreViewModel, ... + ViewModelFactory
  └── theme/                Color.kt, Type.kt, Theme.kt
        │
        ▼  (StateFlow / suspend calls)
data/
  ├── repository/
  │   ├── ArticleRepository     reader side: Room cache + Supabase + website fallback
  │   └── DashboardRepository   CMS side: in-memory StateFlows + Supabase writes
  ├── remote/
  │   ├── SupabaseConfig        base URLs + keys
  │   ├── SupabaseClient        OkHttp PostgREST CRUD + Supabase Auth
  │   ├── SupabaseModels        *Record data classes + UserProfile/UserRole
  │   ├── ImgBbUploader         multipart image upload
  │   └── NingshingCheWebsiteClient / WebsiteHtml / AuthorProfiles
  ├── local/                    Room entities, DAOs, AppDatabase
  ├── preferences/              UserPreferencesRepository (DataStore)
  ├── ai/                       NinghsingCheAiAssistant
  └── model/                    UI-facing domain models (Article, Author, Category, ...)
```

**Reader flow:** Room is the single source of truth for article lists (offline-first).
`ArticleRepository.syncFromSupabaseOrWebsite()` refreshes Room from Supabase, falling back to
scraping ningshingche.com, falling back to the shipped seed data in `NinghsingCheContentData`.

**CMS flow:** the editorial CMS is not in the app — it is the web SPA in `backend/` (see
`backend/API.md`). The app only reads: `PortalRepository` (Retrofit + Moshi, `Result`-based) for the
public portal data, and `ArticleRepository` (Room cache → Supabase → website-scraper fallback) for
the reader's articles.

---

## 3. Composition root and DI

`NinghsingCheApp.onCreate()` (`app/src/main/java/com/ningshingche/app/NinghsingCheApp.kt`):

```kotlin
preferencesRepository = UserPreferencesRepository(this)
commenterPreferencesRepository = CommenterPreferencesRepository(...)  // DataStore, noBackupFilesDir
database              = AppDatabase.getInstance(this)                 // Room: "ningshingche_database"
websiteClient         = NingshingCheWebsiteClient()
supabaseClient        = SupabaseClient(this)                          // SharedPrefs session restore
googleAuthRepository  = GoogleAuthRepository(supabaseClient)
articleRepository     = ArticleRepository(database, supabaseClient, websiteClient)
portalRepository      = PortalProvider.repository()
musicLibraryStore     = MusicLibraryStore(this, database, supabaseClient)
musicController       = MusicController(this, musicLibraryStore)
aiAssistant           = NinghsingCheAiAssistant(articleRepository, portalRepository)
appNotificationManager = AppNotificationManager(this).also { it.createChannels() }
contentUpdateNotifier = ContentUpdateNotifier(this, SeenContentStore(this), appNotificationManager, preferencesRepository)
ContentCheckWorker.schedule(this)
```

`ReaderNavHost` (`EditorialReaderApp`) builds the factories — `ViewModelFactory` for the main screens
plus `ReaderViewModelFactory` / `Category|Issue|AuthorViewModelFactory` for the portal ones — and
passes them to `viewModel(factory = …)`. **There is no Hilt/Koin**: to add a ViewModel, add a branch
to `ViewModelFactory.create()` (`ui/viewmodel/MainViewModels.kt:557`).

> If you add a dependency (e.g. a `SessionManager`), construct it in `NinghsingCheApp.onCreate()`
> and add it to the `ViewModelFactory` constructor.

---

## 4. Navigation

`ui/navigation/Screen.kt` — sealed class, one `data object` per destination:

| Route | Args | Notes |
| --- | --- | --- |
| `home` | — | start destination |
| `explore` | — | bottom bar |
| `search` | — | |
| `bookmarks` | — | bottom bar |
| `history` | — | |
| `ai_assistant` | — | |
| `settings` | — | |
| `dashboard` | — | In-app CMS. **Not** in the bottom bar; reachable from the drawer ("ড্যাশবোর্ড (CMS)") |
| `pdf_archive` | — | bottom bar |
| `featured` | — | bottom bar |
| `about`, `authors_directory` | — | portal pages |
| `forum` | — | the forum: rooms, latest discussions, search |
| `forum_room/{slug}` | `slug: String` | one room's threads, paged |
| `forum_thread/{discussionId}` | `discussionId: String` | one discussion and its replies |
| `forum_new?room={slug}` | `room: String` (optional) | the composer; `room` preselects the room |
| `pdf_viewer/{pdfId}` | `pdfId: String` | |
| `article/{articleId}` | `articleId: String` | deep links: `ningshingche.com/{articleId}`, `ningshingche.com/article/{articleId}` |
| `category/{categorySlug}` | `categorySlug: String` | |
| `author/{authorId}` | `authorId: String` | |
| `archive/{year}` | `year: Int` | |
| `web_article/{year}/{month}/{slug}` | three strings | deep link `ningshingche.com/{year}/{month}/{slug}`; `.kehem` suffix stripped |

Chrome is set in `ReaderNavHost.kt` (`EditorialReaderApp`):

- **Drawer** (`ModalNavigationDrawer` + `PortalDrawerContent`) wraps the whole nav host.
- **No shared top or bottom bar.** Each screen composes its own header from shared pieces such as
  `AccountHeaderButton`, and edge-to-edge screens clear the status bar with
  `Modifier.statusBarsPadding()`. The only bottom navigation is inside the signed-in user dashboard
  (`UserDashboardScreen.kt`: `NavigationBar` + four `NavigationBarItem`s).
- Transitions: 280 ms slide+fade in, 240 ms out, both directions.
- Drawer navigation uses `popUpTo(home) { saveState = true }`, `launchSingleTop`, `restoreState`.

The drawer's item list is built inside `PortalDrawerContent` (`ui/components/PortalDrawer.kt`). It is
flat by design — thin dividers, no collapsible groups: (1) Home, Featured, Explore, PDF archive,
Search, Saved; (2) Annual issues and Categories, both of which open Explore on the matching tab;
(3) About, Authors, **Forum**; (4) Settings, Share the app. The forum row replaced **সামাজিক কার্যকলাপ**,
whose page was a hard-coded gallery grid the home page already draws; its state and screen were
removed with it. The header carries the brand and
a theme button that cycles System → Light → Dark.

The old hard-coded `PortalNavigation` menu (`years` 2025 → 2014, 16 hand-written category pairs) no
longer exists. Those lists now come from the API: the Explore tabs load through `ExploreViewModel`
(`ReaderViewModels.kt`) → `PortalRepository` (`categories`, `authors`, `facets`, `issues`,
`specialArticles`, `featuredArticles`, `latestArticles`). Bengali-vs-ASCII spellings of one annual
issue are collapsed by `data/portal/IssueTags.kt`, the Kotlin twin of `backend/assets/js/tags.js`.

---

## 5. Theme and design tokens

`ui/theme/Color.kt` — portal palette:

| Token | Value |
| --- | --- |
| `PortalMaroon` | `0xFF6E2B19` |
| `PortalSaffron` | `0xFFFF8C00` |
| `PortalDeepBrown` | `0xFF4B2E2B` |
| `PortalCream1` | `0xFFF9F5E9` |
| `PortalCream2` | `0xFFFFFAF2` |
| `PortalGold` | `0xFFFFD700` |
| `PortalWhite` | `0xFFFFFFFF` |
| `PortalDarkBg` / `Surface` / `Variant` / `Border` / `Text` | `0xFF111827` / `0xFF1F2937` / `0xFF374151` / `0xFF4B5563` / `0xFFF9FAFB` |

Plus an amber ramp (`Amber50` … `Amber950`) and reader-only palettes: `SepiaCanvas`, `SepiaSurface`,
`SepiaText`, `PaperCanvasLight`, `PaperSurfaceLight`, `PaperSurfaceVariantLight`, `PaperCardBorderLight`.

`ui/theme/Theme.kt` — `MyApplicationTheme(darkTheme: Boolean, content)` builds
`LightPortalScheme` / `DarkPortalScheme` (`lightColorScheme` / `darkColorScheme`), applies
`MaterialTheme`, and uses `SideEffect` + `WindowCompat` for edge-to-edge status bar colour.
`MainActivity` selects dark mode from `AppThemeMode.SYSTEM | LIGHT | DARK` in DataStore.

Reader comfort modes (`ReaderThemeMode.PAPER | SEPIA | NIGHT | CRISP`) are separate from the app
theme and are driven by `ReaderPreferences` (font 12–26 sp, line spacing 1.2–2.4).

---

## 6. Data layer — Supabase client

`data/remote/SupabaseConfig.kt`:

```kotlin
restBaseUrl  = "$supabaseUrl/rest/v1"    // https://slcpvmpsynkqdozvlsii.supabase.co/rest/v1
authBaseUrl  = "$supabaseUrl/auth/v1"
imgbbUploadUrl = "https://api.imgbb.com/1/upload"
```

`data/remote/SupabaseClient.kt` — one `OkHttpClient` (connect 20 s, read/write 30 s), hand-built
`org.json` payloads, `Dispatchers.IO`, `Result<T>` returns.

### 6.1 Base headers (`createBaseRequestBuilder`)

```
apikey: <publishable key>
Content-Type: application/json
Prefer: return=representation
Authorization: Bearer <authToken ?: publishableKey>
```

⚠️ **The app never sends `x-dashboard-session`.** See [§14.1](#141-writes-will-be-rejected-by-rls-critical).

### 6.2 Method → HTTP call

| Kotlin method | HTTP | Query / body |
| --- | --- | --- |
| `signIn(email, pass)` | `POST /auth/v1/token?grant_type=password` | `{email, password}`; also accepts hard-coded `admin@ningshingche.com`/`admin123` or stored admin creds |
| `signUp(email, pass, name, role)` | `POST /auth/v1/signup` | `{email, password, data:{full_name, role}}`; falls back to a fake local session on failure |
| `signOut()` | — | clears SharedPrefs |
| `getAuthors()` | `GET /authors?select=*&order=created_at.desc` | no limit |
| `upsertAuthor(a)` | `POST /authors` | full row, `Prefer: resolution=merge-duplicates` |
| `deleteAuthor(id, imgbbDeleteUrl)` | `DELETE /authors?id=eq.{id}` | best-effort ImgBB delete first |
| `getCategories()` | `GET /categories?select=*&order=created_at.asc` | |
| `upsertCategory(c)` | `POST /categories` | merge-duplicates |
| `deleteCategory(id)` | `DELETE /categories?id=eq.{id}` | |
| `getBlogs(query, categoryId, authorId, status, limit=100, offset=0)` | `GET /blogs?select=*&order=created_at.desc&limit&offset` | optional `category_id=eq.`, `author_id=eq.`, `status=eq.`, `title=ilike.*q*` |
| `getBlogById(idOrSlug)` | `GET /blogs?or=(id.eq.X,slug.eq.X)&limit=1` | |
| `upsertBlog(b)` | `POST /blogs` | merge-duplicates |
| `deleteBlog(id)` | `DELETE /blogs?id=eq.{id}` | |
| `getComments(blogId, status)` | `GET /comments?select=*&order=created_at.desc` | optional `blog_id=eq.`, `status=eq.` |
| `upsertComment(c)` | `POST /comments` | merge-duplicates |
| `updateCommentStatus(id, status)` | `PATCH /comments?id=eq.{id}` | `{status}` |
| `deleteComment(id)` | `DELETE /comments?id=eq.{id}` | |
| `getGalleries(category)` | `GET /galleries?select=*&order=created_at.desc` | optional `category=eq.` |
| `upsertGallery(g)` / `deleteGallery(id, del)` | `POST` / `DELETE /galleries?id=eq.{id}` | |
| `getPdfBooks()` | `GET /pdf_books?select=*&order=created_at.desc` | |
| `upsertPdfBook(b)` / `deletePdfBook(id, del)` | `POST` / `DELETE /pdf_books?id=eq.{id}` | |
| `getSubmittedBlogs(status)` | `GET /submitted_blogs?select=*&order=created_at.desc` | optional `status=eq.` |
| `upsertSubmittedBlog(s)` | `POST /submitted_blogs` | |
| `updateSubmittedBlogStatus(id, status)` | `PATCH /submitted_blogs?id=eq.{id}` | `{status}` |
| `deleteSubmittedBlog(id, del)` | `DELETE /submitted_blogs?id=eq.{id}` | |
| `getVideos()` | `GET /videos?select=*&order=created_at.desc` | |
| `upsertVideo(v)` / `deleteVideo(id)` | `POST` / `DELETE /videos?id=eq.{id}` | |
| `getSettings()` | `GET /settings?id=eq.site_settings&limit=1` | returns defaults on any failure |
| `updateSettings(s)` | `POST /settings` | merge-duplicates |

Session persistence: `SharedPreferences("supabase_auth_session")` → `access_token`, `user_profile`,
`admin_email`, `admin_password`. Exposed as `currentUser: StateFlow<UserProfile?>`.

**Not implemented in `SupabaseClient` at all:** every RPC (`dashboard_login`, `dashboard_session`,
`approve_submission`, …), Storage upload/delete, `count`/`Content-Range` totals, `select`
projection, `imgbb_delete_url`/`image_meta`/`inline_media`/`pdf_storage_path` columns.

---

## 7. Data layer — models and column mapping

`data/remote/SupabaseModels.kt` holds the wire records (each with `toJson()` / `fromJson()`), and
`data/model/Models.kt` holds the UI domain models. `ArticleRepository` converts between them.

### 7.1 `BlogRecord` ↔ `blogs`

| `BlogRecord` field | `blogs` column | Notes |
| --- | --- | --- |
| `id` | `id` | defaults to a random UUID client-side |
| `title`, `subTitle` | `title`, `sub_title` | |
| `image` | `image` | |
| `content` | `content` | HTML |
| `categoryId`, `categoryTitle`, `categorySlug` | `category_id`, `category_title`, `category_slug` | snapshots are trigger-maintained server-side |
| `status` | `status` | `"Draft"` \| `"Publish"` |
| `tags: List<String>` | `tags text[]` | |
| `seoTitle` | `seo_title` | **`seo_description` is missing** |
| `videoLink`, `pdfBookLink` | `video_link`, `pdf_book_link` | |
| `slug` | `slug` | |
| `authorId`, `authorName`, `authorImage` | `author_id`, `author_name`, `author_image` | |
| `isSlider`, `isFeature`, `isSpecialArticle` | `is_slider`, `is_feature`, `is_special_article` | |
| `viewsCount`, `readingTimeMinutes` | `views_count`, `reading_time_minutes` | reading time is recomputed by trigger |
| `publishedDate` | `published_date` | |
| — | `imgbb_delete_url`, `image_meta`, `inline_media`, `pdf_file_provider`, `pdf_storage_path`, `pdf_file_size_mb` | **not modelled** |

`BlogRecord.fromJson` has tolerant fallbacks (`featured_image_url`, `category`, `author_avatar_url`,
`is_featured`, `view_count`) so older payloads still parse.

### 7.2 Other records

| Record | Table | Missing columns vs. schema |
| --- | --- | --- |
| `AuthorRecord` | `authors` | `image_meta` |
| `CategoryRecord` | `categories` | — |
| `CommentRecord` | `comments` | — |
| `GalleryRecord` | `galleries` | `image_meta` |
| `PdfBookRecord` | `pdf_books` | `image_meta`, `file_provider`, `file_storage_path` |
| `SubmittedBlogRecord` | `submitted_blogs` | `thumbnail_meta`, `writer_designation` ✅ / `writer_profile_delete_url`, `writer_profile_meta`, `writer_facebook` ✅, `inline_media`, `reviewed_at`, `converted_blog_id` |
| `VideoRecord` | `videos` | — (`platform` inferred from URL when absent) |
| `SiteSettingsRecord` | `settings` | `favicon_url`, `default_seo_title`, `default_seo_description` |
| `UserProfile` / `UserRole` | — | **not backed by any table**; the real model is `dashboard_users` + `dashboard_roles` |
| `DashboardSummaryStats`, `RecentActivityItem` | — | computed locally, not from an RPC |

### 7.3 Mapping to UI models (in `ArticleRepository`, private)

| Source | Target | Key rules |
| --- | --- | --- |
| `BlogRecord.toArticle()` | `Article` | `slug` falls back to `id`; `excerpt` from `subTitle`, else first 160 chars of HTML-stripped `content`; `year` from digits in `publishedDate` → `createdAt` → 2026; `isFeatured = isFeature \|\| isSlider`; `sourceUrl = https://ningshingche.com/article/{slug}` |
| `CategoryRecord.toCategory()` | `Category` | `name = title`, `description = subTitle` |
| `AuthorRecord.toAuthor()` | `Author` | `name = title`, `bio = description`, `avatarUrl = image` |
| `PdfBookRecord.toPdfDocument()` | `PdfDocument` | `categorySlug` = slugified `category`; `year` from `bookPublishedDate`; `downloadUrl = pdfUrl = link` |
| `ArticleEntity.toModel()` / `Article.toEntity()` | Room ↔ domain | `tags` and `relatedArticleIds` stored comma-separated |

⚠️ `DashboardRepository.syncBlogsToLocalRoom()` hard-codes `year = 2026` and
`publishedDate = b.publishedDate.ifBlank { "২০২৬" }`, so year/archive filtering breaks for older
posts. Fix by parsing `published_date` properly.

---

## 8. Data layer — Room cache

`AppDatabase` — `ningshingche_database`, **version 1**, `fallbackToDestructiveMigration()`.

| Entity / table | Columns |
| --- | --- |
| `ArticleEntity` / `articles` | `id` PK, `title`, `slug`, `excerpt`, `content`, `featuredImageUrl`, `authorId`, `authorName`, `authorAvatarUrl`, `category`, `categorySlug`, `tagsRaw`, `publishedDate`, `year`, `readingTimeMinutes`, `isFeatured`, `isEditorialPick`, `viewCount`, `sourceUrl`, `relatedArticleIdsRaw`, `cachedAt` |
| `BookmarkEntity` / `bookmarks` | `articleId` PK, `savedAtTimestamp`, `folder`, `note` |
| `HistoryEntity` / `reading_history` | `articleId` PK, `readAtTimestamp`, `scrollPosition`, `progressPercent` |
| `SearchHistoryEntity` / `search_history` | `id` auto PK, `query`, `timestamp` |

DAOs return `Flow<List<…>>` for lists and `suspend` for one-shots:
`ArticleDao.getAllArticles()`, `getArticleById`, `getArticleByIdOrSlug` (matches `id` **or** `slug`),
`getFeaturedArticles`, `getArticlesByCategory`, `getArticlesByAuthor`, `getArticlesByYear`,
`searchArticles` (LIKE over title/content/authorName/category), `insertArticles(REPLACE)`,
`deleteArticleById`, `clearAll`, `deleteSeedArticles()` (deletes ids `LIKE 'art-%'`), `countArticles`.
`BookmarkDao`, `HistoryDao`, `SearchDao` follow the same shape.

> Adding a column/entity requires bumping the DB version and providing a migration, otherwise
> `fallbackToDestructiveMigration()` wipes the offline cache on update.

---

## 9. Data layer — repositories

### 9.1 `ArticleRepository` (reader side)

```kotlin
class ArticleRepository(database, supabaseClient?, websiteClient)
```

Public surface:

| Member | Type | Purpose |
| --- | --- | --- |
| `categories`, `authors`, `yearArchives`, `pdfDocuments`, `pdfCategories` | `StateFlow<List<…>>` | seeded from `NinghsingCheContentData`, replaced after sync |
| `syncState` | `StateFlow<WebsiteSyncState>` | `{isSyncing, lastSuccessAt, lastMessage, liveArticleCount, usingLiveSite}` |
| `syncFromSupabaseOrWebsite()` | `suspend → Result<Int>` | **the** sync entry point |
| `syncFromWebsite()` / `refreshInBackground()` | fire-and-forget | launch the sync on the repo scope |
| `seedInitialArticles()` | `suspend` | load bundled seed data into Room |
| `getAllArticles()` / `getFeaturedArticles()` / `getArticlesByCategory` / `getArticlesByAuthor` / `getArticlesByYear` | `Flow<List<Article>>` | Room-backed |
| `getArticleById(idOrSlug)` | `suspend → Article?` | matches `id` or `slug` |
| `searchArticles(query, categorySlug, year)` | `Flow<List<Article>>` | Room LIKE + in-memory filters |
| `loadComments(articleUrlOrId)` | `suspend → List<ArticleComment>` | |
| `submitComment(urlOrId, name, address, email, phone, content)` | `suspend → Result<…>` | |
| `getCategories()`, `getCategoryBySlug()`, `getAuthors()`, `getAuthorById()`, `getYearArchives()`, `getYearArchiveByYear()` | sync snapshot | current `StateFlow` value |
| `getPdfCategories()`, `getPdfDocuments()`, `getPdfDocumentById()`, `getPdfDocumentsByCategory()` | sync snapshot | |
| `getAllBookmarks()`, `isBookmarked(id)`, `toggleBookmark(id)` | Flow / suspend | |
| `getReadingHistory()`, `saveReadingProgress(id, pos, pct)`, `clearHistory()` | Flow / suspend | |
| `getRecentSearches()`, `recordSearch(q)`, `removeSearch(q)`, `clearSearchHistory()` | Flow / suspend | |
| `clearAllCache()` | `suspend` | |

**Sync strategy** (`syncFromSupabaseOrWebsite`, guarded by a `Mutex`):
1. `supabaseClient.getBlogs(status = "Publish")` → map to `Article` → `upsertLiveArticles()` →
   `deleteSeedArticles()`; then refresh `categories`, `authors`, `pdf_books` from Supabase;
   rebuild `yearArchives`.
2. If Supabase fails or returns empty → `websiteClient.syncCatalog()` (scrape ningshingche.com) and
   use its categories/authors/pdfDocuments.
3. If both fail → keep the Room cache and set `lastMessage = "সিঙ্ক সম্পন্ন: অফলাইন আর্কাইভ প্রস্তুত।"`.

### 9.2 `DashboardRepository` (CMS side)

Holds `MutableStateFlow` for `authors, categories, blogs, comments, galleries, pdfBooks,
submittedBlogs, videos, settings, summaryStats, recentActivities, isLoading`. On `init` it seeds
everything from `NinghsingCheContentData` (+ hard-coded sample galleries, videos, comments, and one
submission) then calls `refreshAll()`.

`refreshAll()` pulls each table with the "ignore empty result" pattern:
`supabaseClient.getAuthors().onSuccess { if (it.isNotEmpty()) _authors.value = it }`.

Mutation pattern (**optimistic, error-swallowing**):

```kotlin
suspend fun saveAuthor(author: AuthorRecord): Result<AuthorRecord> {
    /* update StateFlow, recalculate stats */
    supabaseClient.upsertAuthor(author)     // result discarded
    Result.success(author)                  // always success
}
```

Actions: `saveAuthor/deleteAuthor`, `saveCategory/deleteCategory`, `saveBlog/deleteBlog`,
`saveComment/toggleCommentStatus/deleteComment`, `saveGallery/deleteGallery`,
`savePdfBook/deletePdfBook`, `saveSubmittedBlog/updateSubmissionStatus/deleteSubmittedBlog`,
`approveAndPublishSubmission`, `saveVideo/deleteVideo`, `saveSettings`.

`approveAndPublishSubmission()` is a **local** 3-step conversion (set status → find-or-create author
→ insert blog). It does **not** call `POST /rest/v1/rpc/approve_submission`, so it is not
transactional and will not set `converted_blog_id`.

Stats: `DashboardSummaryStats` is computed by counting the in-memory lists — because `refreshAll()`
is unpaginated this is only correct while every table is small.

### 9.3 `UserPreferencesRepository` (DataStore)

`readerPreferences: Flow<ReaderPreferences>` plus `updateFontSize`, `updateLineSpacing`,
`updateThemeMode`, `updateAppThemeMode`, `updateTtsSpeed`, `updateNotificationNew`,
`updateNotificationFeatured`.

### 9.4 AI

`NinghsingCheAiAssistant(repository).answerQuestion(q): AiChatMessage` — used by `AiViewModel`.
UI: `AiAssistantScreen` with `suggestedQuestions` and `AiSourceCitationCard`.

---

## 10. Image and PDF media

### Images — `ImgBbUploader`

```kotlin
data class ImgBbUploadResult(url, displayUrl, deleteUrl, title, sizeBytes, mimeType)

suspend fun uploadFromUri(context, uri, customName?): Result<ImgBbUploadResult>
suspend fun uploadBitmap(bitmap, customName?, format = JPEG, quality = 90): Result<ImgBbUploadResult>
suspend fun uploadBytes(bytes, fileName, mimeType): Result<ImgBbUploadResult>
suspend fun attemptDeleteImage(deleteUrl: String): Boolean
```

Multipart `POST https://api.imgbb.com/1/upload`, field `image` = base64, key in the query string.
Validates `image/*` MIME and the 32 MB cap. Error strings are Bengali.

UI: uploads are triggered from the signed-in workspace (`ui/screens/UserDashboardScreen.kt`) through
`ImgBbUploader` — gallery picker, preview, then `uploadBitmap` / `uploadFromUri`.

### Song files — `data/remote/SatoruUploadClient.kt`

```kotlin
fun describe(context, uri, fallbackName = "song.mp3"): SongFile   // name, mime, size
suspend fun uploadAudio(context, uri): Result<UploadedSong>       // publicUrl, "", sizeBytes
```

`POST https://upload.satoru.click/user/api.php`, multipart `reqtype=fileupload` +
`fileToUpload`; the response body **is** the public URL as plain text. Catbox-compatible,
200 MB ceiling, no auth. The request body streams the picked `content://` file in 64 KB
chunks instead of reading it into memory. `Add Song` tries this host first and falls back to
`SupabaseClient.uploadUserMusicFile` (Storage, 32 MB, user JWT) if it is unreachable.

### Attachments — `data/remote/ForumAttachmentUploader.kt`

A forum post carries files, and a file is one of two kinds: a picture, which goes
to ImgBB where the app's pictures already go, and a PDF, which goes to the
Catbox-compatible host [SatoruUploadClient] already uses for songs — ImgBB takes
images and nothing else, and Supabase Storage wants a session and a bucket policy
for the same result. `SatoruUploadClient.uploadAttachment` is the same multipart
POST as `uploadAudio` (they share `sendFile`), answering with a public URL *and*
the file's own name, because the thread has to draw a chip that says which
document it is.

The limits are the owner's: **five files**, pictures and PDFs. `PICKER_TYPES`
hands the system picker exactly those two types, `isSupported` checks the answer
again (some providers hand back `application/octet-stream` for a PDF, and the name
decides), and `MAX_FILES` stops the sixth at the moment it is picked rather than
after it has been uploaded. Pictures are capped at ImgBB's 32 MB and documents at
the host's 200 MB, both before anything is read into memory.

### Reader search — `data/portal/SearchQuery.kt`

`SearchViewModel` debounces the query and calls `PortalRepository.searchArticles(query, limit, offset)`,
which sends one PostgREST filter built by `SearchQuery`. The rules there are not stylistic:

| Rule | Why |
| --- | --- |
| Searches `title`, `sub_title`, `slug`, `author_name`, `content` | A reader searches for a word they read in a piece. `কমলগঞ্জ` is in three articles' bodies and in none of their titles. |
| `tags` / `tag_keys` are **not** searched | Both are `text[]`; `tags.ilike.…` is Postgres `42883` (`operator does not exist: text[] ~~* unknown`). |
| One word → `or=(col.ilike."*term*",…)`; two or more → `and=(or(…),or(…))` | `"মণিপুরী ব্যান্ড"` as a single pattern matches nothing; as two conditions it finds `বাংলাদেশে মণিপুরী যত ব্যান্ড`. |
| Values are double-quoted inside the expression, then the whole value percent-encoded once | PostgREST decodes the parameter *before* parsing it, so a comma or bracket typed by the reader used to return `PGRST100`. Quoting is the escaping PostgREST offers inside expressions. |

All five behaviours above were verified against production (`GET /rest/v1/blogs?status=eq.Publish&…`)
before the code was written, and are pinned by `app/src/test/.../portal/SearchQueryTest.kt`.

### Interface language files — `data/i18n/TranslationRepository.kt`

```kotlin
fun strings(language: ContentLanguage): StateFlow<Map<String, String>>  // cache first, then fetch
suspend fun refresh(language: ContentLanguage): Result<Map<String, String>>
companion object { fun parseCsv(text: String): Map<String, String> }
```

One `GET /rest/v1/app_language_files?select=csv&lang=eq.<bn|en|bpy>` per language with the
publishable key; the response is `[{"csv": "..."}]` and the CSV is cached at
`filesDir/i18n/<lang>.csv`, so a language survives offline launches and an unreachable network.
Bengali is fetched too, and its file is normally empty: it holds only the rows an editor rewrote
on the Languages page, and each of those replaces the compiled wording for the same key (`লেখক` ->
`লেখকবৃন্দ`) without changing the key itself, so the lookup cannot lose track of a string.

Wiring: `NinghsingCheApp.translations` is the single instance; `MainActivity` collects the flow for
the chosen language into `LocalTranslations`, and `t("বাংলা লেখা")` in `ui/i18n/Strings.kt` resolves
it, falling back to the Bengali source when a key is absent or its value is blank.

Lookup tries the exact Bengali string first and, on a miss, retries with `looseKey()` — trimmed,
whitespace collapsed, trailing `।`/`.`/`!`/`?` dropped — so a key typed by hand in the dashboard
(`অডিও ফাইল পড়া যায়নি`) still finds the string compiled into the app (`অডিও ফাইল পড়া যায়নি।`).
Those CSVs are written by the dashboard's **Languages** grid (one row per string, a column per
language, all three editable, Bengali doubling as the key the app looks a string up by) into
`app_language_files` from migration 023;
`TranslationTable.loose` is only consulted after the exact lookup misses, so a hand-typed key can
never shadow a real one. Switching
language in Settings calls `refresh`, as does the "অনুবাদ হালনাগাদ করুন" button.

First launch: `MainActivity` waits for the first DataStore emission, then the reader starts on
`ReaderRoute.Splash`. When `ReaderPreferences.onboardingComplete` is false the splash leads into
`ReaderRoute.FirstRun` — `ui/screens/FirstRunFlow.kt`, the three first-install steps on one screen,
one Next at the bottom of each:

| Step | Screen | Button |
| --- | --- | --- |
| 1 | `LanguageSetupScreen` — three cards, each named in its own script | `পরবর্তী` (Next) |
| 2 | `WelcomeLoginScreen` — Google sign-in, and `সাইন-ইন ছাড়া পরবর্তী` to move on without it | Next |
| 3 | `WelcomeNotificationsScreen` — what will be sent, then the Android permission dialog | `চালু করে শেষ করুন` (Finish) |

A row of dots at the top shows the step in hand. Choosing a language on step 1 already downloads its
file, so the later steps are translated rather than filling in as the reader watches. Finishing calls
`SettingsViewModel.completeOnboarding()`, which sets both `onboardingComplete` and `languageChosen`
and returns to `ReaderRoute.Home`; declining notifications finishes the flow too. Nothing here is
one-way: language, account and notifications are all editable afterwards in Settings.

The splash's loading bar fills once from left to right across its 1.5 s display. It used to be an
indeterminate `LinearProgressIndicator`, which swept right and snapped back — visible as a bounce on
the loading screen.

### PDFs — `util/PdfHelper.kt`

`getOrGeneratePdfFile(context, PdfDocument)`, `renderPdfPages(file): List<Bitmap>`,
`savePdfToDownloads(context, doc)`, `sharePdfFile(context, doc, file)`; `util/ApkManager.kt` for
app-update handling. PDFs are opened via the `link`/`pdfUrl` field; **the app never touches the
Supabase Storage `pdf-books` bucket**.

---

## 11. ViewModel contracts

All use `stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), …)`.

| ViewModel | Exposed state | Actions |
| --- | --- | --- |
| `HomeViewModel` | `allArticles`, `featuredArticles`, `categories`, `authors`, `yearArchives`, `pdfDocuments`, `syncState`, `readingHistory`, `scrollToTop: SharedFlow<Unit>` | `requestScrollToTop()`, `refreshFromWebsite()` |
| `ExploreViewModel` | `categories`, `authors`, `yearArchives`, `allArticles`, `selectedTab: Int` (0 Categories, 1 Authors, 2 Archives, 3 Popular) | `selectTab()` |
| `SearchViewModel` | `searchQuery`, `selectedCategorySlug`, `selectedYear`, `categories`, `yearArchives`, `recentSearches`, `searchResults`, `popularSuggestions` | `onQueryChange`, `setCategoryFilter`, `setYearFilter`, `executeSearch`, `removeRecentSearch`, `clearAllRecentSearches` |
| `ReaderViewModel` | `currentArticle`, `relatedArticles`, `isBookmarked`, `comments`, `commentStatus`, `isSubmittingComment`, `readerPreferences`, `isTtsPlaying`, `ttsProgressText` | `loadArticle(id)`, `submitComment(...)`, `toggleBookmark()`, `updateReadingProgress()`, `updateFontSize/LineSpacing/ThemeMode`, `toggleTts()`, `stopTts()` |
| `BookmarksViewModel` | `searchSavedQuery`, `selectedCategoryFilter`, `bookmarkedArticles` | `onSearchQueryChange`, `setCategoryFilter`, `removeBookmark` |
| `HistoryViewModel` | `historyItems: List<Pair<ReadingHistory, Article>>` | `clearAllHistory()` |
| `AiViewModel` | `messages: List<AiChatMessage>`, `isLoading`, `suggestedQuestions` | `sendQuestion()` |
| `SettingsViewModel` | `preferences` | `updateAppThemeMode`, `toggleNewArticlesNotif`, `toggleFeaturedNotif`, `clearCache`, `clearHistory` |
| `PdfArchiveViewModel` | `categories`, `allPdfDocuments`, `selectedCategoryId`, `filteredPdfs`, `isLoading` | `selectCategory()` |
| `PdfViewerViewModel` | `pdfDocument`, `pages: List<Bitmap>`, `currentPage`, `isLoading`, `downloadStatus` | `loadPdf(id)`, `setPage`, `downloadPdf`, `sharePdf`, `clearStatus` |
| `DashboardViewModel` | `currentSection: DashboardSection`, `isInitialSkeletonLoading`, all entity flows, `summaryStats`, `recentActivities`, `isLoading`, `currentUser` | `setSection`, `refreshData`, `save*/delete*` per entity, `toggleCommentStatus`, `approveAndPublishSubmission`, `rejectSubmission`, `saveSettings`, `updateCurrentUser`, `updateAdminCredentials`, `signOut` |

`DashboardSection` (in `ui/dashboard/components/DashboardSidebarDrawer.kt`):
`HOME, AUTHORS, BLOGS, CATEGORIES, COMMENTS, GALLERIES, PDF_BOOKS, SUBMIT_BLOGS, VIDEOS, SETTINGS`.

---

## 12. UI inventory — screens and components

**Reader screens** (`ui/screens/`): `HomeScreen`, `FeaturedScreen`, `ExploreScreen`, `SearchScreen`,
`BookmarksScreen`, `HistoryScreen`, `ArticleReaderScreen`, `PdfArchiveScreen`, `PdfViewerScreen`,
`AiAssistantScreen`, `SettingsScreen`, and in `PortalPages.kt`: `AboutScreen`,
`AuthorsDirectoryScreen`, `SocialActivitiesScreen`; in `DetailListScreens.kt`:
`CategoryDetailScreen`, `AuthorDetailScreen`, `ArchiveYearDetailScreen`.

**CMS**: not in the app. The editorial dashboard is the web SPA in `backend/`; the app ships only
the signed-in user workspace, `ui/screens/UserDashboardScreen.kt` (dashboard tabs, notices, inbox).
`ui/dashboard/` and its `views/` no longer exist.

### 12.3 Contributors

The owner asked for a contributor page that only registered readers can see, reachable from the
sidebar, with the month's best on the home page — as a list — and the reader's own points on their
dashboard.

| Where | What |
| --- | --- |
| `ui/screens/ContributorScreen.kt`, route `contributors`, drawer row **সেরা অবদানকারী** | The month's board: rank badge, 62 dp picture, name, article and song counts, then a row of its own carrying the points |
| `HomeScreen` — **সেরা অবদানকারী**, subtitle `{{currentMonth}} মাস` | The top five as a list, with **সব দেখুন**; only rendered for a signed-in reader, and set off from the music rail above it by `EditorialSpace.lg` |
| `UserDashboardScreen` — অবদান পয়েন্ট card | The reader's own lifetime and monthly points, with the parts they are made of |

**The gate is the database's, not the screen's.** `contributor_leaderboard` and `contributor_points`
are granted to `authenticated` alone and raise `42501` without an `auth.uid()`, so a guest's request
fails however it is made. The app then shows its own gate — a lock, an explanation and a sign-in
button — and `HomeViewModel.loadContributors(isSignedIn)` does not even issue the request when
signed out.

**Which is why the request must carry the reader's token** (§17.1): a signed-in reader is only
signed in to the database if the transport sends their JWT, and this screen is where that was
noticed — it answered "for signed-in readers" to a reader who was signed in. A `401`/`403` on this
screen is therefore a session problem, not a permission one, and the screen says so ("your session
has expired — sign in again") instead of printing the server's sentence.

**An empty board is not a failed board.** The home section renders when there are rows *or* when the
request failed, and a failure gets the reason plus an action rather than a section that quietly never
appears — **আবার চেষ্টা করুন** for a request that can simply be repeated, and **সাইন ইন করুন** when the
session itself was refused, because retrying a token that is gone cannot help.

**A refusal is a type, not a sentence.** `PortalError.SignedOut` is what a refused session becomes,
recognised in `PortalRepository.httpError` from the body's own `42501` (what migration 026 raises),
from a bare `401`, or from a `403` whose body says the call is "for signed-in readers" — whichever
shape PostgREST chooses. Screens answer the type; the English sentence the function raised is never
printed, because a reader who is signed in already reads it as a permission problem rather than as an
expired session.

**Tapping a card opens that reader's public page** (`ReaderRoute.publicProfile`), where their songs and
published articles are listed.

**Time in the app** is part of the score, and the database cannot know about time it never hears:
`analytics/AppTimeTracker.kt` measures foreground time (started and stopped by `MainActivity`) and
reports it every five minutes and on leaving. Seconds are held in preferences until the server takes
them, so an offline batch is folded into the next one instead of vanishing. Guests are dropped rather
than carried over — on a shared device their minutes would otherwise land on the next reader.

**The board shows points, not the arithmetic behind them.** The page used to open with a paragraph
explaining the weights and every card carried pills for articles, songs, views and minutes; the owner
asked for both to go. What a reader sees now is who they are, what they wrote, and what it earned —
minutes in the app are still counted by the database, they are simply not advertised back at the
reader. `MyStandingCard` replaced `PointsExplainer`: one line for the reader's own points, no lecture.
The month in the header comes from the board's own `monthKey`, not from the phone's clock, so the
label and the rows can never disagree; `monthNameOf` turns `2026-09` into সেপ্টেম্বর and falls back to
`java.util.Calendar` only until the first response arrives.

The weights (article 50, song 30, comment 5, view 1, two minutes 1) live in the database —
`contributor_points_from` — so the app never computes a score it can disagree with. The dashboard
shows the same board through a second door, `contributor_leaderboard_dashboard` (migration 027), which
is gated on the dashboard session instead; the page lives in the live dashboard's **Registered users →
সেরা অবদানকারী** menu and reads the identical numbers. The contributor
page prints the same table for the reader, in words.

### 12.4 Public user pages and view counting

Every registered reader has a public page: `ui/screens/PublicProfileScreen.kt`, route
`user/{userId}` (`ReaderRoute.PublicProfile`), reachable by tapping an uploader's name on a song. It
shows their name and avatar, their articles, their songs (tapping one starts playback with that list
as the queue) and their forum work. The identity card is one request —
`PortalRepository.publicProfile(userId)` → the `public_profile` RPC (**migration 028**, which replaces
024 and widens its answer) —
because `profiles` and `submitted_blogs` are both select-own and a submission row carries the
writer's contact details. It opens for guests too.

**The three lists are paged, five rows at a time.** `PortalRepository.profilePage(userId, kind,
offset)` → `profile_items` (**migration 033**) asks for one window of five for one kind —
`articles`, `songs`, `threads` or `answers` — and answers `{kind, total, items}`, so the screen
knows how many rows exist without holding them: it draws the first five, and **আরও দেখুন (n)** asks
for the next five at `offset = loaded` and appends them to what is on screen. The four counts the
tabs are labelled with come from a second door of the same function, `kind = 'counts'`
(`profileTotals`). Nothing is sliced in the app — a page is a page on both sides of the wire — and
the order is the database's: articles and songs by `views_count desc nulls last`, a reader's
discussions and answers newest first. A database without 033 fails the two list calls and nothing
else: the identity card and the statistics card still open, and the list says which file to run.

**The page is real data or nothing.** Three lines, in the order the owner asked for: the name, then
the designation (`profiles.designation`, shown as muted **পাঠক** when the reader has not written one),
then the first line of the address and only if there is an address. Nothing on the page is
placeholder text, so a reader with no designation and no address simply has a shorter card. Under it,
one statistics card — **মোট ভিউ / মোট পয়েন্ট / এই মাসের পয়েন্ট** — and then three tabs: **প্রবন্ধ (n)**,
**গান (n)** and **আলোচনা (n)**, whose counts are the database's totals. Every row carries its
published date through `formatBengaliDate`, and a forum row carries the date at its right-hand edge
and its three reactions as icons with their counts — the words লাইক / একমত / অপছন্দ are not written
on this page any more than they are on the forum's own cards. The app bar is transparent over a
scrolling list, so the content starts below the sticky back arrow rather than under it.

**Inside আলোচনা, two filters and no third.** **আলোচনা** is this reader's discussions and **উত্তর** is
the answers they wrote, one list at a time, each fetched for its own kind when it is picked. The
third tab of the first cut — **প্রতিক্রিয়া** — is deleted: it was a fourth list of the same reader's
work with the least to say, and the counts it showed are already on the answers themselves.

The statistics card is the database's own totals: `points` for life, `month_points` for this month,
both read through `contributor_score` with a `to_regprocedure` guard so the page still opens on a
database where 026 has not been pasted.

Views are counted in the database (migration 025), never in the app:

| What | Where it is recorded | How it is shown |
| --- | --- | --- |
| Article | `PortalRepository.article()` records the view once the article resolves, then folds the returned total into `ArticleDetail.summary.viewsCount` | The article screen's "বার পঠিত" line, one ahead of the row it fetched |
| Song | `MusicController.onTrackStarted` (wired in `NinghsingCheApp`) fires on a chosen track, an auto-advance and a press of next — `announceStarted` dedupes so one start is one count | The song row's "বার শোনা" and the player's "বার শোনা হয়েছে" line, which takes the RPC's total for the playing track and the row's own count for its neighbours |

`PortalRepository.guestViewerId` (set from `MusicLibraryStore.deviceId`) is what a signed-out reader
counts as, matching the guest love react. A failed count is never surfaced: the number simply stays
what the row carried. The reader's own totals — `SupabaseClient.userViewTotals` / `userViewSeries` —
feed the dashboard's ভিউ cards (total, plus the article/song split) and the **সময়ের সাথে ভিউ** chart
in `ui/screens/UserDashboardCharts.kt` (`ViewsOverTimeChart`, 30 days, empty days drawn as a dashed
zero line). The dashboard home no longer carries notice or message counters; the bell and the
bottom-bar tabs are the way in.

The workspace's **Content** tab lists the reader's own submissions (articles from `submitted_blogs`
and songs from `music_tracks`). Each card carries the piece's state on its right — `ContentStatusChip`
over the same `statusLabel` wording the rest of the screen uses — and tapping it does one of three
things:

* **Published** (`Published`/`Approved`) — opens in the app. A submission carries
  `converted_blog_id` once approval has turned it into a blog, so `onOpenArticle` opens that id
  directly and only falls back to a title search for rows from before the column existed. When
  nothing resolves — the conversion can still be sitting as a draft — the callback returns `false`
  and the dashboard shows the preview instead of an error screen.
* **Not published** — shows `ArticlePreviewDialog`, the submission drawn the way it will look when
  it is live (thumbnail, title, subtitle, byline, the same `RichHtmlArticleBody` the article screen
  uses). Links inside a preview do not navigate.
* **Songs** — the catalogue row is live in the music screen, so the tap opens the player with the
  dashboard's songs as the queue.

The bottom-bar tabs are swipeable, as they are everywhere else in the app. The reason swiping had
been switched off — a hand travelling across the notices page marked the whole inbox read — is
handled by waiting for the pager to settle (`restingOnNotices`), not by taking the gesture away.

### 12.5 Forum

A basic forum, in the shape the owner asked for and on the rails the rest of the reader already uses:
`ui/screens/ForumScreens.kt` (one file, four screens), `data/portal/ForumText.kt` (the character
counter), the models and DTOs in `data/portal/`, and migration 029 for everything the database owns.
**Guests read; the signed-in write.** No new client, no new store, no hard-coded room list — the rooms
are rows in `forum_categories`, seeded by the migration and editable from the dashboard.

| Screen | Route | What it is |
| --- | --- | --- |
| `ForumHomeScreen` | `forum` | **বিভাগসমূহ** as a sideways-scrolling rail, then **সাম্প্রতিক আলোচনা** with its three filters; the magnifier in the app bar opens the search field under it |
| `ForumCategoryScreen` | `forum_room/{slug}` | one room, paged 30 at a time, with **নতুন আলোচনা** |
| `ForumThreadScreen` | `forum_thread/{discussionId}` | the opening post, its answers with their reactions and their own answers, a composer, and — on a long tap — the reader's own two actions |
| `NewDiscussionScreen` | `forum_new?room=` | room (a row of `FilterChip`s, preselected when a room sent the reader here), title, an optional cover, and the body in the compact editor |

Every discussion shows its room, author and avatar, the date **as the reader reads it**
(`formatBengaliDate`), its views and its reply count. The reply counter is the one counter whose
colour means something: a thread nobody has answered yet is grey, one that has been answered takes
the accent colour.

**Six functions are the whole API** (`PortalApi`, all `@POST("rpc/…")`, all wrapped in a `Result` by
`PortalRepository`): `forum_overview`, `forum_category`, `forum_search`, `forum_discussion`,
`forum_create_discussion`, `forum_reply`. The app never names `forum_discussions` or `forum_replies`
as tables — migration 029 grants nothing on them to a client, and every read goes through the
security-definer functions, which is also what makes an unpublished thread disappear from the lists
while staying readable by id. Reads are granted to `anon` and `authenticated`; the two writes are
granted to `authenticated` alone and raise `42501` for a guest.

A row the dashboard wrote carries **অ্যাডমিন**, at the right-hand end of its own header, in the
accent colour on `accentSoft` with `Icons.Default.Verified` beside it. It reads `is_official`, which
`032` put on the view and `034` re-publishes on the function — the same fact as the অনুমোদিত badge on a
thread, in the place a reader looks for it on an answer. The badge is never about the reader: the
long press beside it is the thing that is (`is_mine`), and the two never stand in for each other.

**An answer of the reader's own carries two actions, behind a long tap.** A long tap on your own
answer opens **সম্পাদনা** and **মুছে ফেলুন** inside the answer itself — no window, no sheet — and a long
tap on anyone else's, or on one the dashboard wrote, does nothing at all. The whole screen shares one
`ForumReplyActions` holder (which answer is open, and which is asking to be confirmed), so a nested
reply is drawn by the same code as the answer over it. **সম্পাদনা** opens the thread's own composer with
the answer already in it: `HtmlContentEditor` takes its `value` from the screen, so the box is handed
`replyBody` and the editor follows — nothing reaches into the WebView. The line above the box says
**উত্তর সম্পাদনা** instead of naming somebody being answered, and while an edit is open the draft store
is left alone, because half an edit is not a draft and must not come back as one. **মুছে ফেলুন** asks
once (`হ্যাঁ` / `না`), then the answer leaves the screen at once and the thread is read again with
`countView = false`, because only the database knows which answers were handed up to the answer it
answered. A refusal is said in a toast: the row the reader was looking at is already gone.

**Which the app answers as a session problem, not a permission one** — the same call the contributor
board makes (§12.3): a refusal becomes `PortalError.SignedOut`, and the screens answer it with the way
back in. A guest is not refused at all: the reply box is replaced by a sign-in prompt and the
**নতুন আলোচনা** button leads to the sign-in screen, so the app never asks the database something it
knows will be refused.

**An open is a view, a refresh is not.** `forum_discussion(p_id, p_count_view)` bumps the counter, so
the app counts an open once, when the thread first loads, and re-reads after posting a reply with
`countView = false` — otherwise answering a thread would inflate the number the thread is measured by.

**The character rule lives in two places and they are kept in step.** Bengali "characters" are not
code points: `ছোট` measures 5 as written and 9 decomposed. Migration 029 counts with
`forum_text_units(text)` — non-whitespace, minus the combining marks — and `ForumText.units()` is the
same rule in Kotlin, so the field can warn before the button is pressed and the server can still be
the one that decides. The minimums use it (title 4 units, body 1); the maximums stay `char_length`
(title 160, body 8000, reply 4000), because a limit on what a client sends is a limit on bytes.

**Search waits.** Nothing is asked for a single character; from two characters on, the request waits
300 ms after the last keystroke, and the search is `strpos` in the database — so `%` searches for a
per cent sign rather than matching everything.

**The second pass (migration 030).** The forum the owner reviewed came back with ten corrections
and four extras; this is what was done with them, and why.

*বিভাগসমূহ is a rail, not a page.* The rooms are one row that scrolls sideways, above সাম্প্রতিক
আলোচনা — a reader reaches the discussions without scrolling past the rooms to get there. A room is
184 dp wide, carries its name, its description and its two counters, and keeps its
`forum_category_{slug}` tag, so a UI test that clicked a room card still finds its room.

*সাম্প্রতিক আলোচনা has three filters, and the database decides what they mean.* `সাম্প্রতিক` is the
newest activity, `জনপ্রিয়` is the most answers (ties broken on views), `অনুমোদিত` is the threads the
NingshingChe admin opened. `is_official` is a column, not a rule the app computes: 030's
`before insert` trigger sets it when the row arrives on a dashboard session, because the app cannot
know who is staff and a filter that asked it to guess would be a filter that lies. A chip carries the
count of official threads, and every card that is one wears a small **অনুমোদিত** badge.

*A cover, and an editor.* A new discussion can carry an ImgBB cover — optional, uploaded with the
uploader the article composer already uses, kept with its delete URL so the dashboard can clean up
after it. The body is written in `HtmlContentEditor`, in its **compact** shape: bold, italic,
underline, a bullet list and an image, and none of the article editor's other furniture (no HTML
switch, no height controls, no resize handle, no help text). The owner asked for the article editor's
idea without its selection popup, so the editor grew a `selectionPopup` switch and the forum passes
`false` — the little bar over a selected word is useful over a page of prose and in the way over
three lines of a reply. The list button was added to the shared toolbar, so the article composer has
one too. What is counted and refused is the *text*, not the markup: `forum_plain_text()` strips the
tags server-side (`<p></p>` is not a post) and the screens do the same before they enable a button.

*Drafts.* `ForumDraftStore` (`data/local/`, DataStore, `filesDir/forum_drafts`) remembers the
composer — room, title, body, cover and its delete URL — and one reply per thread, and clears an
entry only after the database has accepted the post. Preferences rather than the Room database
because a draft is a few hundred bytes that has to be readable the instant a composer opens and
nothing joins on it; per thread rather than one reply box because a reader may leave a half-written
answer in one thread, read another, and come back to the first one as they left it.

*Reactions, one tap, no popup.* `forum_reactions` holds one row per reactor per answer — `like`,
`dislike` or `agree` — and `forum_react(reply_id, kind, device_id)` toggles: the same tap takes the
reaction away, which is what 022's music love does and therefore what a reader already expects. A
guest may react, keyed by `md5('ningshingche-forum:' || device_id)` from the device id the transport
already carries for loved songs. Every answer comes back with its three counts and with the reader's
own reaction (`my_reaction`), and the counts feed (10). The three icons are the whole control: each
one sends its own kind, and nothing is asked twice — there is no `ForumReactionDialog` and no long
press left in the app.

*One step of indentation, and only the newest answer under each one.* A reply to a reply is folded
onto its own answer (`coalesce(parent.parent_id, parent.id)`), so a thread can be argued in but never
marches off the right of the screen. Under each answer the newest answer is drawn, with **সব উত্তর
দেখুন (n)** opening the rest.

*একটি ছোট «আরও দেখুন»* — no border, no fill, 13.5 sp, accent-coloured, on the opening post and on
any answer long enough to need it. "Long enough" is a hundred characters, decided from the string
rather than from a measurement (`FORUM_FOLD_CHARS = 100`, one constant the model and the screen
share); a card that had to be measured before it could decide would grow a "see more" on every short
answer that happened to wrap. Folded, three lines of the body are drawn (`FORUM_FOLD_LINES`) with the
renderer's own ellipsis on the last of them, and a discussion card's summary is cut at the same
hundred characters with a `…` — one rule, three places. Open, the body goes through the article
renderer, which is what knows how to draw the picture the editor can insert.

*উত্তরসমূহ has its own filter* — **শীর্ষ উত্তর** (most liked or agreed first, the owner's "top
answers") and **সাম্প্রতিক**. The sort is the sum of likes and agrees; a dislike is shown and never
subtracted, because an answer should not be buried by people who disagree with it, and never paid
for either (see the points below).

*The author is a door.* An answer's picture and name open that reader's public page
(§12.4), by the same `ReaderRoute.publicProfile` the contributor cards use.

*Notifications.* A new thread tells every reader who has notifications switched on, and a new answer
tells the thread's author and everyone else who has answered in it — in Bengali, with the post as the
body and the thread as the link. One row per reader per thread (`user_notifications` is unique on
`(user_id, kind, related_id)`), so a second answer re-arms the first row instead of stacking a second
one, and the writer is never told about their own post. The dashboard's `NotificationCard` gives the
two kinds their own icon and badge, and tapping one opens the thread.

*The bell replaces the search icon, and the search does not leave.* On the forum the app bar carries
the notification bell with the unread count; the magnifier is **not** deleted — it is still on the
home screen, and the forum is still searched, with the field that was already on the page. The owner
asked for the icon to move, not for the feature to go.

*ফোরাম is in the account menu*, on the home page's header, where the dashboard, profile and notices
already are.

*Forum work is on the reader's dashboard and on their public page.* The dashboard's home pane gains a
**ফোরামে আপনার কাজ** card (three counts and the recent threads and answers, each one a tap from the
thread), and the public page gains a third tab, **আলোচনা (n)**. The card's breakdown line now names
আলোচনা and উত্তর alongside articles, songs, comments, views and minutes.

*And the points include it*: a discussion is 20, an answer 5, a reaction received (`like` or `agree`)
1 — `contributor_forum_points_from`, summed with 026's `contributor_points_from` inside
`contributor_score`, whose five existing keys are unchanged and which now also answers
`discussions`, `replies` and `reactions`. The weights live in the database; the app shows the numbers
and never works the arithmetic out itself.

**The third pass (app 1.3 → 1.4).** Thirteen notes came back from reading the second pass on a
phone. None of them changed the database; all of them changed how the forum is drawn, and one of
them was a bug worth naming.

*A bug: `invalid input syntax for type uuid: ""`.* Answering a thread with no answer above it sent
`p_parent_id: ""`, and PostgREST casts an empty string to `uuid` and fails. `PortalRepository` now
sends `withoutBlanks()` — a parameter with nothing in it is a parameter the call does not need, and
the migration's default (a reply with no parent) is what an omitted argument becomes. It is applied
to every call that takes a uuid or an id.

*Spacing and the bar.* Every forum screen clears the app bar by `FORUM_TOP_SPACE`; the forum's own
bar carries a back arrow and a refresh, and **no bell** — notices are the dashboard's, and the home
page's own bell is untouched. The search field stays on the page, where it can be typed into.

*বিভাগসমূহ is one line* — `বিভাগসমূহ (৫)` and a chevron — and it starts zipped. Opening it animates
(`AnimatedVisibility` with `expandVertically`/`shrinkVertically` and a fade, 220 ms) and the chevron
turns as it goes. A room is 232 dp wide with its two lines tight together (`lineHeight = 13.5.sp`).

*Cards.* A discussion title is 17 sp (16 sp beside a cover, where the words have less width); the
author block is a **column** — a 34–38 dp face on the left, the name and then the date under it, the
two lines tight enough to be the height of the face beside them (`lineHeight = nameSize * 1.15f` for
the name, 12 sp for the date) — and a card with a cover puts the picture on the left at 104 dp with
everything else in the column beside it and the view/answer counters pinned to the card's top-right
corner. Answers and replies use the same block with `showTime`, so a thread reads `সিসির সিংহ` and
`১২ সেপ্টেম্বর, ৩:৪৫ অপরাহ্ণ` on two lines (`formatBengaliDateTime`, which parses the UTC the database
wrote and renders the reader's own zone, without `java.time`).

*Reactions are icons, and one tap counts.* `ThumbUp`, `CheckCircle`, `ThumbDown`, each with its count
and its own colour when it is the reader's; tapping the kind that is already there takes it back.
There is no popup and no long press: a tap that has to be repeated is a tap a reader stops making.

*One card per answer.* The replies are drawn inside the answer's card, indented 22 dp, with a 2 dp
line down their left (`drawBehind`), so an argument reads as the answer it belongs to. The database's
one-level fold is unchanged.

*The reply box* is the thread's `bottomBar`, not an item in the list: a strip with the editor at 96 dp
that grows to 240 dp and scrolls inside itself beyond that (the page reports its own `scrollHeight`
through the bridge), small 30 dp toolbar buttons, and `imePadding()` so the keyboard lifts it rather
than covering it. Back while the keyboard is up closes the keyboard first (`BackHandler` on
`WindowInsets.ime`), and a tap that no control claimed does the same (`detectTapGestures` on the
list, plus each card's own tap).

*Pictures are attached, not typed.* `HtmlContentEditor` takes `attachments`, `onAttachImage` and
`onRemoveAttachment`: thumbnails drawn above the box with a cross to take them back, and never an
image inside the body — the caller appends the URLs to the HTML as the post is sent
(`forumWithAttachments`). The compact editor's own picker is only ever used where the full editor is.
Attachments are part of the draft, so they survive a wrong turn like the text does.

**The fifth pass (app 1.4 → 1.5, and 1.5.1).** Eight more notes, and one of them was a bug the owner had
reported twice.

*Bold and italic "still did nothing".* Two causes, both fixed in `HtmlContentEditor`:

  * `document.execCommand` applies to the selection, and a tap on a Compose `IconButton` is a tap
    on a different view — the page may no longer hold the focus the selection lived in, and the
    command then does nothing at all, quietly. The page now keeps its last range
    (`saveSelection` on `keyup`/`mouseup`/`input`/`touchend`/`focus` and on `selectionchange`) and
    puts it back inside a single entry point, `window.command(cmd, arg)`, which also sets
    `styleWithCSS` to false so the markup is `<b>`/`<i>`/`<u>` — the tags both renderers
    (HtmlCompat and the WebView) already understand. `run()` calls `webView.requestFocus()` first,
    because the view has to be focused for the page to take the caret back.
  * The WebView's `@font-face` for Kalpurush declared `font-weight: 100 900`. Kalpurush ships one
    weight, and a face that claims a range tells the browser every weight is covered — so it drew
    bold text with the regular glyphs and bold looked like nothing had happened. It declares
    `font-weight: 400` now, which lets the browser synthesise the bold (and the oblique) the reader
    asked for.

**The composition rule (app 1.5.1).** The way bold and italic were fixed described above broke typing for
a Bengali keyboard, and the fix is worth stating as a rule rather than a patch: **while the reader's
IME is composing, the page must not touch the DOM or the selection at all.** Bengali is written by
composing — ক + ্ + ষ is one character to a reader and three keystrokes to the keyboard — and
`removeAllRanges()`/`addRange()` (or an `innerHTML` write) in the middle of one is a garbled word at
best and a keyboard that raises an error at worst. So `HtmlContentEditor`'s page now:

  * tracks `composing` (`compositionstart` / `compositionend`, and `ev.isComposing` on `input`,
    because some builds do not fire the former);
  * never reads the selection while it is true, and never listens for `input` to do it — the
    selection is remembered on `keyup`, `mouseup`, `touchend`, `focus` and `selectionchange` only;
  * runs a toolbar command without touching the selection when a composition is open;
  * refuses a value from outside the page while the page is composing *or* holds the caret, keeping
    it as `pendingHtml` and applying it on `blur`/`focusout`/`compositionend`. The app clears the
    reply box after blurring it, so the clear still lands;
  * raises the keyboard for a box that was just opened only when the reader is not already in it,
    and never moves a caret that is being typed at;
  * hides the article composer's selection bar while composing, because a composing region counts as
    a non-collapsed selection and the bar would otherwise appear over every Bengali word.

`run()` also only calls `requestFocus()` when the view is not focused already: asking a WebView for a
focus it has restarts the input connection, which a composing keyboard does not survive.

**The second hotfix (app 1.5.1 → 1.6).** Three things the owner found by using 1.5.1, and the first
of them was a hole in the composition rule above.

*A sent post left its text in the box.* Setting the value from the outside is refused while the page
holds the caret — that is the composition rule doing its job — and after a send the box **did** still
hold it for a moment, so the clear was deferred and no event ever came to flush it. A sent post is
not a draft arriving under someone's fingers, so it now has its own door: `HtmlEditorController.clear()`
→ `window.clearEditor()`, which drops the composition flag, the pending value and the remembered
range and empties the element outright. The screen calls it before `dismiss()`, in the same breath as
clearing its own state. `setHtml('')` is also treated as an instruction rather than a draft — an empty
value is applied at once, focused or not — and a deferred value is now flushed on `keyup` and
`touchend` as well as on `blur`/`focusout`, so nothing can be left waiting for a blur that never comes.

*A WebView inside a screen must never navigate.* The editor's page is a document, and a link in a
draft — or a drag Chromium reads as a link-drag — could take the box off to a website inside a 96 dp
text field, with the writing gone. Both `shouldOverrideUrlLoading` signatures return `true` (the
platform asks for one or the other depending on the API level), and popup windows are off
(`setSupportMultipleWindows(false)`, `javaScriptCanOpenWindowsAutomatically = false`).

*উত্তর যোগ করুন is a button, not a bar.* It is an `ExtendedFloatingActionButton` in the corner over the
page's own background — no `Surface`, no tone of its own, nothing covering the bottom of the page.
The scaffold still reserves its height, so no answer is ever underneath it.

**The third hotfix (app 1.6 → 1.7).** "It reload the page and show the skeleton min for 0.5s" — the
chat and a forum thread. Both were loading states tied to the *screen's lifetime* rather than to the
data, so a screen that was rebuilt showed a skeleton or a spinner over content that was still in
memory.

  * **The assistant** played its one-second skeleton from
    `remember { mutableStateOf(true) }`, which is `true` again every time the screen is composed — so
    opening it, or coming back to it, always cost a second of shimmer, conversation or no
    conversation. It is `rememberSaveable` now, and it never plays over a conversation that is already
    on screen (`showSkeleton = !introShown && messages.isEmpty()`).
  * **The thread** kept its answers in `remember`, so leaving the screen and coming back — an author's
    page, an activity rebuilt — dropped them and re-fetched with a spinner. They live in
    `ForumThreadHolder`, a `ViewModel` scoped to the destination: a return finds them, the screen
    paints instantly, and a refresh runs behind the content with a thin `LinearProgressIndicator`
    under the bar (`forum_thread_refreshing`) instead of a spinner over the page.
  * **And the view count is honest again.** It used to be "the screen has not loaded before", so a
    rebuilt screen counted the same reader a second time. The holder owns it: `counted` is set when
    the count has actually been sent, `countView = reloadToken == 0 && !holder.counted`.

**The seventh read (app 1.7 → 1.8).** Three corrections: the audio tabs did not work, the dashboard
home wanted its sections as tabs with the forum paged five at a time, and a successful submission
should land on the content tab instead of going back where it came from.

  * **A page state with no pager.** `MusicScreen` read its pane from `pagerState.currentPage` and its
    chips called `pagerState.animateScrollToPage`, and there was no `HorizontalPager` anywhere in the
    file. A `PagerState` on its own holds a page and changes a number; it scrolls nothing, and with the
    pane chosen from that number, tapping a chip moved the number the chips read their selection from
    and left the pane alone. The screen now composes one `HorizontalPager` over `MusicTab.entries`, so
    the number the chips animate *is* the page on screen, and swipes work for the same reason taps do.
    The lesson is general: **a derived state is only as live as the thing that drives it.**
  * **The dashboard's five sections are tabs.** Points, forum, views, কার্যক্রম and article analytics
    used to be one column of cards that had to be scrolled to find any one of them. They are a
    `HomeSection` enum, a row of `FilterChip`s (`dashboard_sections`, each chip
    `dashboard_section_<name>`) and a `when` over `rememberSaveable` state. The summary — the user
    card and the four metrics — stays above the tabs; the tabs trade places below it. The two graphs
    that shared one composable are two: `ActivityChart` (কার্যক্রম) and `ArticleStatusChart`
    (প্রবন্ধের অবস্থা), and ভিউ adds the split the database counts (`metric_article_views`,
    `metric_music_views`).
  * **Five, then load more.** `forum_activity` takes a limit and **no offset**, so paging is the same
    call asked for a bigger window: `forumLimit` starts at 5 and grows by 5 to the repository's own
    ceiling of 50 (`loadMoreForumActivity()`, `forumHasMore` from `ForumActivity.hasMoreThan(limit)` —
    the counters are the whole truth, the lists are the window). The initial `refresh()` reads the same
    window, so a reload does not shrink what the reader has already loaded. The card shows
    `dashboard_forum_more` only while the counts say there is more.
  * **A submit ends on the content tab.** The composer screens no longer decide where a send goes;
    they call `onSubmitted()` when the message says the submit succeeded — after the fields and the
    draft are cleared and after `clearMessage()`, so nothing is left to replay — and the nav host
    routes it: `forwardToSubmittedContent()` finds the dashboard in the back stack and drops its old
    entry (a pop restores an entry's *arguments*, so popping back would have re-shown the tab it was
    created with), then `openSubmittedContent()` navigates to
    `ReaderRoute.dashboard(tab = ReaderRoute.DASHBOARD_CONTENT)`. The intent itself travels in a
    `ReaderSubmission` note on `ReaderWorkspaceViewModel` — kind, row id, title, and the instant it was
    stamped (`isFresh()`, three minutes) — and the dashboard reads it **once**, on the way in:
    content tab, the new row focused via `contentFocus`, the note spent, and the confirmation snackbar
    the composer used to show repeated on the screen the reader is actually looking at.

**The build fix (app 1.8 → 1.8.1).** The owner ran `./gradlew assembleDebug` on this tree for the first time
and it did not compile — **twenty-four errors**, and only a handful of them from that morning's work: the
tree had not been compilable since the forum and dashboard batches, because every gate here is lexical and
none of them can see a name that is *used* without being imported or declared. The classes, and the rule
each one left behind:

  * **An icon is an extension property.** `Icons.Default.FormatListBulleted` was used with no import for it
    at all; the compiler wants `import androidx.compose.material.icons.filled.FormatListBulleted`. In icons
    1.7 the whole direction-sensitive family moved to `Icons.AutoMirrored.*` and the old ones are
    deprecated, so the import is
    `androidx.compose.material.icons.automirrored.filled.FormatListBulleted` now. **Rule: every
    `Icons.<Family>.<Name>` must have its matching import** — checked in
    `backend/tests/app-source-health.test.cjs`.
  * **A name from another package needs an import.** `Modifier.width(` without
    `androidx.compose.foundation.layout.width`; `rememberSaveable` without its runtime-saveable import;
    `ForumActivity` used as a parameter type with no import; `monthNameOf` called in `HomeScreen` while it
    is declared `internal` in `ui/screens/ContributorScreen.kt`. **Rule: the Compose names in that table,
    and every project declaration used across packages, are checked against the file's imports.**
  * **Two imports of the same name.** `EditorialSpace` was imported twice in `HomeScreen` — "imported name
    is ambiguous" — and `kotlinx.coroutines.launch` likewise. (Two *different* packages may legally share a
    simple name: an icon lives in both `filled` and `automirrored.filled`, and `items` belongs to both
    `lazy` and `lazy.grid`; only the identical pair is a conflict.) **Rule: no import written twice.**
  * **`@Composable` twice, and `@Composable` missing.** `ToolIcon` and `ContributorPointsCard` each carried
    the annotation above the KDoc *and* below it — "this annotation is not repeatable" — and `MetricCard`
    had none at all while its body composes `Surface`/`Text`/`Icon` (every call site of it then failed
    too). **Rule: one annotation per declaration, and one wherever the body composes.**
  * **A parameter that does not exist.** `shrinkVertically(shrinkFrom = …)` — renamed `shrinkTowards` in
    Compose animation 1.7. Checked against the 1.7 sources, not from memory.
  * **A composable read inside a derived state.** `derivedStateOf { WindowInsets.ime.getBottom(density) > 0 }`
    — `WindowInsets.ime` is a `@Composable` getter, so it cannot be read from a plain lambda. The insets are
    read in composition and the *plain* `getBottom` call is what the derived state watches, which is still
    reactive because the insets live in a `mutableStateOf`.
  * **A private API.** `NavController.backQueue` is private in navigation 2.8.9; the public stack is
    `currentBackStack: StateFlow<List<NavBackStackEntry>>`. The submit-forwarding helper now reads that and
    pops by **destination id** (`dashboard.destination.id`) — the `String` overload of `popBackStack`
    matches *routes*, and an entry's own id is a UUID no route will ever equal.
  * **A nullable that was treated as a Result.** `supabaseClient.userViewTotals(...)` answers with
    `ViewTotals?`, not with a `Result`, so there is no `getOrNull()` to unwrap.

*The formatting row is four buttons.* The compact editor no longer offers a picture button, and it
no longer draws attachments — `HtmlContentEditor` is an editor again. Files are attached on the row
under the box, which is also where they are previewed.

*The reply box is asked for.* The thread's bottom bar shows one button — **উত্তর যোগ করুন**, bottom
right — and the box expands out of the bottom of the screen when it is tapped and shrinks back into
it when it is done (`AnimatedVisibility` with `expandVertically`/`shrinkVertically` from
`Alignment.Bottom` and a fade, in both directions, the launcher animating the other way in the same
seat). The keyboard is asked for once the box has arrived (`FORUM_COMPOSER_APPEAR_MS`), the chevron
on the box's header puts it away without posting anything, and Back goes keyboard → box → screen
(the box's `BackHandler` is disabled while the IME is up, so the order cannot invert).

*The forum's cards are one shape.* On **সাম্প্রতিক আলোচনা** the view and answer counters sit inline
at the right of the category, with no pill, no border and no fill of their own — the owner's first
correction to that card, and where it started. The title keeps **two** lines on every card, cover or
no cover, with the description under it; beside a cover that description keeps **one** line, and two
without one. Every card is exactly `FORUM_CARD_HEIGHT` (**152 dp**) — the owner's third sentence, *the
items should be equal height* — so the words on it are capped rather than allowed to push the card
taller than its neighbours. The cover is a 116 dp column filling that height beside the words, with
the face, the name and the date on the floor of the card.

The same counters, in the thread, sit at the **right of the creator block**: the face on the left, the
name above its date, and the view and answer counts starting from the right-hand edge of that block —
`ForumOpeningMeta`, which is the one place a thread's numbers are drawn.

*Files are attached, previewed and opened.* `ForumAttachment` (a URL, a name, a type, a size) is
the model; `forumWithAttachments` appends `<p><img src="…" alt="…"></p>` for a picture and
`<p><a href="…">name</a></p>` for a document — **on the way out**, so nothing is ever inserted into
the middle of a sentence. A post's body is then read in two parts: `forumBodyMarkup` (the words,
with the attachments taken out) and `forumBodyImages`/`forumBodyDocs` (the files, drawn as previews
under it). That split is the fix for the second complaint of the same family: an `<img>` handed to
`HtmlCompat` becomes U+FFFC, the platform's "an object I cannot draw", which a reader sees as a
boxed **obj** — and a body used to fold on the strength of the tag, so the boxed obj was what the
folded copy showed until "see more" was tapped. Folding now counts the words
(`ForumReply.isLong` = `forumBodyText(body).length > FORUM_FOLD_CHARS`, and that constant is 100).

*And a tap opens it.* `AttachmentViewer` is a frame-less dialog: a picture fills the screen and can
be pinched (1×–5×, panning only once it is larger than the screen), a PDF is opened by the app's own
viewer library at its plainest setting — `pageFitPolicy(FitPolicy.WIDTH)`, a swipe between pages,
no settings sheet and no night mode, because the owner asked for no smart options here. Both kinds
carry a download button in the top right that writes to `Download/Ningshingche_PDFs` for a document
and `Download/Ningshingche` for a picture, and says so in a toast.

*A posted draft is gone.* The reply draft keeps words *and* files (a file is stored with its name
and type, and a draft written before this pass — a bare list of image URLs — is read back as what it
is). After a successful post the box empties, the files are dropped and the draft is cleared, all
after the database has answered. That last part needed a second fix in the editor: a WebView only
takes `value` on page load, so an emptied box stayed full on screen. `HtmlContentEditor` now pushes
an outside change into the page (`lastEmitted` / `lastPushed`: a value from the page is never pushed
back at it, one from anywhere else is) and `window.setHtml` leaves the caret at the end.

**The API is nine functions** — 029's six plus `forum_react`, with `forum_overview`,
`forum_discussion`, `forum_create_discussion` and `forum_reply` replaced on new signatures by 030, and
`forum_activity(user, limit)` reading one reader's forum work for their dashboard and their public
page. `034` adds the two that belong to the reader: `forum_edit_reply(p_id, p_body)` and
`forum_delete_reply(p_id)`, both granted to `authenticated` alone and both author-only, and re-states
`is_official` and `is_mine` on every reply `forum_discussion` and `forum_reply` hand back. 030 drops the four old signatures first (a new parameter makes a new function, and
`forum_overview(20)` was "not unique" until it did), re-grants them after creating them, and guards
the two grants that belong to 029 so it still applies to a database that has never seen it.

**Reusable components** — reuse these instead of writing new ones:

`ui/editorial/EditorialComponents.kt` (1,651 lines) is the reader's primary kit — 28 public
declarations: `Hairline`, `Eyebrow`, `SectionHeader`, `EditorialImage`, `rememberShimmerBrush`,
`formatBengaliDate`, `Byline`, `CategoryPill`, `HeroArticleCard`, `RailArticleCard`, `ArticleRow`,
`NumberedArticleCard`, `AnimatedHamburgerIcon`, `AiAssistantHomeBanner`, `CategoryVisualCard`,
`CategoryRail`, `GalleryModalDialog`, `ArticleRail`, `AuthorRail`, `AuthorChip`, `GalleryGrid`,
`PdfRail`, `VideoRail`, `MusicRail`, `LoadingFeed`, `EmptyState`, `ErrorState`, `teaserOf`.
Companions in the same package: `EditorialTheme.kt` (245 lines — `EditorialPalette`,
`EditorialType`, `EditorialSpace`, `EditorialShape`, `EditorialTheme`, `toBengaliNumeral`),
`LazyImage.kt` (47 — `ShimmerPlaceholder`, `ImagePlaceholder`), `SiteFooter.kt` (350 —
`EditorialFooter`, `SiteContact`), `VideoPlayer.kt` (250 — `VideoPlayerDialog`,
`SocialEmbedPlayer`, `embedUrlFor`).

`ui/components/EditorialComponents.kt` (762 lines): `NingshingCheBrandLogo`,
`FeaturedArticleHeroCard`, `ArticleListItemCard`, `BookmarkToggleButton`, `PdfDocumentCard`,
`AiSourceCitationCard`, `getCategoryIcon(slug)`, `categoryIconFor`.

Rest of `ui/components/`: `PortalDrawerContent` (PortalDrawer.kt), `PortalAsyncImage` +
`normalizePortalImageUrl` (PortalImages.kt), `MarkdownFormattedText`, `HtmlFormattedText`,
`parseInlineMarkdown`, `YouTubeEmbed` (MarkdownText.kt), `HomeSkeletonLayout`,
`ExploreSkeletonLayout`, `AiAssistantSkeletonLayout`, `ShimmerBox`, `shimmerEffect`
(SkeletonShimmer.kt), `VerifiedBadge`, `AppToastHost` + `AppToasts`, `AccountHeaderButton`,
`BookmarkController`, `connectivityStatus` (ConnectivityMonitor.kt), `GenreCombobox`,
`GoogleSignInButton`, `HtmlContentEditor`, `keyboardAvoidingPadding`, `DialogImeAdjustResize`,
`MusicMiniPlayerBar` + `MusicFullPlayerOverlay` (MusicPlayer.kt), `PlayingWaveBars` +
`PlayingWaveBlue` (PlayingWaveBars.kt).

### 12.1 The music player's gestures

The full player (MusicPlayer.kt) answers to these, and they are deliberately distinct:

| Gesture | Effect |
| --- | --- |
| Pull down anywhere off the artwork, past `PlayerMinimizeDrag` (110 dp) | Minimizes. The offset is released with an animation instead of snapping to zero, so the sheet continues from where the finger stopped rather than jumping back to the top and then sliding away. |
| Drag up/down **on the artwork** | Volume — the pull covers the full range over `CoverVolumeDrag` (260 dp), up is louder, down is quieter. A read-out says `ভলিউম <n>%` over a saffron bar while the finger is down. The drag is clamped to 0–100 % before it is shown, because a negative value is the read-out's own hidden state. |
| Pull down on the artwork past `CoverMinimizeDrag` (190 dp) | The same pull stops being a volume change and puts the player away: the level the drag had already changed is put back, the read-out switches to `ছেড়ে দিলে ছোট হয়ে যাবে`, and the sheet follows the finger from there. |
| Double tap on the artwork | Left third −5 s, right third +5 s, middle play/pause. |
| Tap the row of the song that is already loaded | Brings the player up and keeps its position. `MusicController.play` and `playQueueItem` both return early for the loaded track, so a second tap never rebuilds the media items (which used to restart the song at 0:00). |

A list row whose track is loaded wears `PlayingWaveBars` on its artwork — an animated bar indicator
(frozen mid-sweep while paused) on a light chip so the thin bars stay legible over a photograph. The
love control stays on **every** row, playing or not. Because a list of cards must not recompose on
every position tick, the row reads `MusicController.nowPlayingId` / `isPlayingNow`, which collapse the
player state to one emission per track change.

The card also names the uploader (`আপলোডার: <name>`, from `music_tracks.uploader_name`) and the play
count, and the player's credit line puts the uploader before the singer: `Uploader: … ◻ Singer: …`.
Tapping the uploader opens `ReaderRoute.publicProfile(uploaderId)`.

### 12.2 System-bar insets belong inside the surface

The app is edge-to-edge (`enableEdgeToEdge` in `MainActivity`), so a surface that touches the bottom
edge of the screen has to leave room for the gesture bar itself. The inset has to be applied **inside**
the surface, on its content:

```kotlin
Surface(modifier = Modifier.fillMaxWidth()) {          // background reaches the screen edge
    Column(modifier = Modifier.navigationBarsPadding()) { … }   // content clears the gesture bar
}
```

`Modifier.navigationBarsPadding()` in front of the surface is wrong even though it looks right: the
padding is applied before the background is drawn, so the background stops above the strip and the
screen behind shows through it as an empty band. `MusicMiniPlayerBar` and the article AI assistant
sheet both had that, and the assistant's is why the sheet's input row appeared to float above a gap.

Removed in the structure passes — do not reference: `ui/components/PortalHomeSections.kt` and its
`PortalSectionHeader`, `FeaturedPortalCard`, `SelectedEssayCard`, `CategoryImageTile`,
`AuthorRailCard`, `PdfBookRailCard`, `HorizontalCardsRow`, `SubmitWritingBanner`;
`PortalTopBar`, `EditorialTopHeader`, `EditorialBottomNavBar`, `HeroArticleCarousel`,
`CategoryFilterChip`, `AuthorCardItem`, `YearArchiveTimelineCard`, `PdfDocumentCardItem`,
`PdfCategoryFilterChip`, `EditorialNavigationDrawerContent`, and the legacy dashboard kit
(`DashboardStatCard`, `StatusBadge`, `ConfirmDeleteDialog`, `DashboardHeaderBar`, `EmptyStateView`,
`BlogPreviewDialog`, `DashboardImageUploader`, `DashboardRichTextEditor`, `DashboardTagInput`,
`DashboardSidebarContent`).

---

## 13. API coverage matrix (implemented vs available)

Legend: ✅ used · ⚠️ partially / incorrectly used · ❌ not used

| Capability | Web dashboard | Android app |
| --- | --- | --- |
| Read `authors`, `categories`, `blogs`, `comments`, `galleries`, `pdf_books`, `submitted_blogs`, `videos`, `settings` | ✅ | ✅ |
| Filter by `category_id` / `author_id` / `status` / `title ilike` | ✅ | ✅ (blogs only) |
| Pagination (`limit`/`offset` + `Content-Range` totals) | ✅ | ⚠️ `offset` param exists, never exercised; no counts |
| Column projection (`select=`) | ✅ | ❌ always `select=*` |
| Create / update (upsert) | ✅ | ⚠️ always upsert-with-client-UUID; no real `PATCH` except comment/submission status |
| Delete | ✅ | ✅ (+ ImgBB delete attempt) |
| Dashboard session RPCs (`dashboard_login`, `dashboard_session`, `dashboard_logout`) | ✅ | ❌ |
| Access-control RPCs (users/roles/credentials) | ✅ | ❌ |
| `approve_submission` RPC | ✅ | ❌ (local 3-step fallback only) |
| Supabase Storage PDF upload/delete | ✅ | ❌ |
| ImgBB upload | ✅ | ✅ |
| ImgBB delete | ✅ best-effort | ✅ best-effort |
| Global search across tables | ✅ | ❌ (Room-only LIKE search) |
| Forum (`forum_overview` / `_category` / `_search` / `_discussion`; create and reply) | ✅ reads the board | ✅ read for everyone, write for signed-in readers |
| Schema/health probe | ✅ | ❌ |
| Realtime subscriptions | ❌ | ❌ |

**Consequence:** today the app is a *reader* with a partially-wired CMS. Reads work because the
public `SELECT` policies allow anonymous access; **writes only work on installs that still have the
pre-migration-004 `is_dashboard_request()` digest path**, and never on a properly secured install.

---

## 14. Critical gaps and required changes

> Written against an earlier revision of the app. Entries below marked as resolved were re-checked
> against the current tree during the structure passes; treat any unmarked entry as unverified.

### 14.1 Writes will be rejected by RLS (critical)

`schema.sql` grants anonymous `SELECT` on content, but migration 004 replaces the write policies
with menu-permission checks driven by `public.dashboard_current_user_id()`, which reads the
`x-dashboard-session` header. `SupabaseClient` never sends it, so every `POST`/`PATCH`/`DELETE`
from the app returns `401`/`403` (`42501`).

**Fix:** add a session manager that stores the raw token from `dashboard_login` and injects
`x-dashboard-session: <token>` into `createBaseRequestBuilder()`. See [§15.1](#151-session-manager-and-auth-header).

### 14.2 Authentication is fake

`signIn()` accepts `admin@ningshingche.com` / `admin123` locally and stores the password in
plaintext SharedPrefs (`admin_password`). `UserRole` (`ADMINISTRATOR/EDITOR/MODERATOR/AUTHOR`) does
not exist in the database — the real roles are `dashboard_roles` rows with `menu_permissions`.

**Fix:** call `POST /rest/v1/rpc/dashboard_login` with `{p_username, p_password, p_remember,
p_user_agent}`, persist `{token, expires_at, user}` in **EncryptedSharedPreferences**, delete
`admin_password` storage, and gate UI with `user.permissions` instead of `UserRole`.
Persist sessions in `EncryptedSharedPreferences` or `crypto-ktx`-backed storage, not plain
SharedPreferences.

### 14.3 No pagination, no counts

Every list call is unpaginated (`limit=100` for blogs, unlimited elsewhere). `DashboardSummaryStats`
is therefore computed from a partial list, and large archives will OOM.

**Fix:** read `Content-Range` for exact totals (`Prefer: count=exact`, parse `*/N` or `a-b/N`) and
page with `limit`/`offset`; add a Paging 3 `PagingSource` for `blogs` and `comments`.

### 14.4 Missing columns

Add to the records and `toJson()`/`fromJson()`:
`BlogRecord` → `imgbb_delete_url`, `image_meta`, `inline_media`, `pdf_file_provider`,
`pdf_storage_path`, `pdf_file_size_mb`, `seo_description`.
`AuthorRecord`/`GalleryRecord` → `image_meta`. `PdfBookRecord` → `image_meta`, `file_provider`,
`file_storage_path`. `SubmittedBlogRecord` → `thumbnail_meta`, `writer_profile_delete_url`,
`writer_profile_meta`, `inline_media`, `reviewed_at`, `converted_blog_id`.

### 14.5 Hard-coded content

`NinghsingCheContentData` (753 lines) still seeds articles, authors, categories and PDF books as the
offline fallback. The drawer/archive/filter half of this item is resolved: categories, authors,
facets and annual issues come from the API (`ExploreViewModel` → `PortalRepository`), and
`PortalNavigation` no longer exists. `DashboardRepository.initializeDefaultsFromSeed()` went with
the app-side CMS.

Still hard-coded: the website-scraping fallback walks a fixed `(2014..2026)` year range
(`NingshingCheWebsiteClient.kt`), and the PDF path falls back to `?: 2026` when a published date is
missing (`ArticleRepository.kt`).

### 14.6 Optimistic writes swallow errors

`DashboardRepository` — the subject of this item — no longer exists in the app; the CMS is the web
SPA in `backend/`. The app's remaining write paths are the Supabase calls in `SupabaseClient`
(comments, submissions, profile, music). Re-audit those for the same pattern before closing this
item.

### 14.7 Other items

- Room DB is version 4 with `fallbackToDestructiveMigration()` — any schema change wipes the cache.
- No HTTP error taxonomy: failures surface as `Exception("Supabase error: 403 …")`. Map
  PostgREST codes as `backend/API.md` §13 does.
- No `Cache-Control`; a connectivity observer does exist for the UI (`connectivityStatus` in
  `ui/components/ConnectivityMonitor.kt`).
- `Retrofit` + `Moshi` are used for the portal read API only (`PortalConfig`, `PortalApi`,
  `PortalDtos`); the write paths in `SupabaseClient` are still hand-rolled OkHttp + `org.json`, so
  migrating those would remove boilerplate and give typed responses.
- No Supabase Realtime; new articles only appear after a manual pull-to-refresh.

---

## 15. Implementation recipes

### 15.1 Session manager and auth header

```kotlin
// data/remote/DashboardSession.kt
data class DashboardSession(
    val token: String,
    val expiresAtMillis: Long,
    val user: UserProfile,
    val permissions: List<String>
) {
    val isExpired get() = System.currentTimeMillis() >= expiresAtMillis
}

// data/remote/SessionManager.kt  (construct in NinghsingCheApp.onCreate)
class SessionManager(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        "nc_dashboard_session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    var session: DashboardSession?
        get() = prefs.getString("session", null)?.let { Json.decodeFromString(it) }
        private set(value) = prefs.edit {
            if (value == null) remove("session") else putString("session", Json.encodeToString(value))
        }

    fun hasPermission(menu: String) = session?.permissions?.contains(menu) == true
}
```

```kotlin
// patch SupabaseClient.createBaseRequestBuilder()
private fun createBaseRequestBuilder(url: String): Request.Builder {
    val key = SupabaseConfig.supabaseKey
    val builder = Request.Builder()
        .url(url)
        .addHeader("apikey", key)
        .addHeader("Content-Type", "application/json")
        .addHeader("Prefer", "return=representation")

    val dashboardToken = sessionManager?.session?.takeUnless { it.isExpired }?.token
    val token = authToken          // Supabase Auth JWT, if you keep it
    builder.addHeader("Authorization", "Bearer ${token ?: key}")
    if (dashboardToken != null) builder.addHeader("x-dashboard-session", dashboardToken)
    return builder
}
```

### 15.2 Login against the real RPC

```kotlin
suspend fun dashboardLogin(username: String, password: String, remember: Boolean): Result<UserProfile> =
    withContext(Dispatchers.IO) {
        val payload = JSONObject().apply {
            put("p_username", username.trim())
            put("p_password", password)
            put("p_remember", remember)
            put("p_user_agent", "NingshingCheAndroid/${BuildConfig.VERSION_NAME}")
        }
        val request = createBaseRequestBuilder("${SupabaseConfig.restBaseUrl}/rpc/dashboard_login")
            .post(payload.toString().toRequestBody(jsonMediaType))
            .build()
        val body = httpClient.newCall(request).execute().use { it.body?.string().orEmpty() }
        val result = JSONArray(body).optJSONObject(0)
            ?: return@withContext Result.failure(Exception(body))
        if (!result.optBoolean("ok")) {
            return@withContext Result.failure(Exception(result.optString("error", "Login failed.")))
        }
        val session = DashboardSession(
            token = result.getString("token"),
            expiresAtMillis = Instant.parse(result.getString("expires_at")).toEpochMilli(),
            user = UserProfile.fromRpcUser(result.getJSONObject("user")),
            permissions = result.getJSONObject("user")
                .optJSONArray("permissions")?.let { arr -> (0 until arr.length()).map { arr.getString(it) } }.orEmpty()
        )
        sessionManager.save(session)
        Result.success(session.user)
    }
```

Validate on cold start with `POST /rest/v1/rpc/dashboard_session` (no body) and log out with
`POST /rest/v1/rpc/dashboard_logout`. Full request/response shapes: `backend/API.md` §7.1–7.4.

### 15.3 Exact counts via `Content-Range`

```kotlin
suspend fun countBlogs(status: String?): Int = withContext(Dispatchers.IO) {
    val q = buildString {
        append("${SupabaseConfig.restBaseUrl}/blogs?select=id&limit=1")
        if (!status.isNullOrBlank()) append("&status=eq.$status")
    }
    val request = createBaseRequestBuilder(q)
        .addHeader("Prefer", "count=exact")
        .addHeader("Range", "0-0")
        .build()
    val response = httpClient.newCall(request).execute()
    val range = response.header("Content-Range") ?: return@withContext 0
    Regex("/(\\d+)$").find(range)?.groupValues?.get(1)?.toIntOrNull() ?: 0
}
```

### 15.4 Transactional submission approval

```kotlin
suspend fun approveSubmission(submissionId: String, categoryId: String, status: String = "Draft") =
    withContext(Dispatchers.IO) {
        val payload = JSONObject().apply {
            put("p_submission_id", submissionId)
            put("p_category_id", categoryId)
            put("p_status", status)
            put("p_slug", JSONObject.NULL)
        }
        val request = createBaseRequestBuilder("${SupabaseConfig.restBaseUrl}/rpc/approve_submission")
            .post(payload.toString().toRequestBody(jsonMediaType))
            .build()
        val body = httpClient.newCall(request).execute().use { it.body?.string().orEmpty() }
        runCatching { BlogRecord.fromJson(JSONArray(body).getJSONObject(0)) }
    }
```

Replace the local `DashboardRepository.approveAndPublishSubmission()` with this; it creates the
missing author, de-duplicates the slug, and sets `converted_blog_id` in one transaction.

### 15.5 PDF upload to Storage

```kotlin
suspend fun uploadPdf(context: Context, uri: Uri): Result<String> = withContext(Dispatchers.IO) {
    val bytes = context.contentResolver.openInputStream(uri)!!.use { it.readBytes() }
    val path = "${Calendar.getInstance().get(Calendar.YEAR)}/${UUID.randomUUID()}.pdf"
    val url = "${SupabaseConfig.supabaseUrl}/storage/v1/object/pdf-books/$path"
    val request = createBaseRequestBuilder(url)
        .addHeader("Content-Type", "application/pdf")
        .addHeader("x-upsert", "false")
        .post(bytes.toRequestBody("application/pdf".toMediaType()))
        .build()
    httpClient.newCall(request).execute().use { response ->
        if (!response.isSuccessful) return@withContext Result.failure(Exception("HTTP ${response.code}"))
        Result.success("${SupabaseConfig.supabaseUrl}/storage/v1/object/public/pdf-books/$path")
    }
}
```

Store the returned **path** in `pdf_books.file_storage_path` / `blogs.pdf_storage_path` and set
`file_provider` / `pdf_file_provider` to `"supabase-storage"`, otherwise the file becomes
undeletable. Requires the `books` or `blogs` menu permission.

---

## 16. Definition of done

Ordered task list for making every screen functional against the API:

1. **Auth** — `SessionManager` + `x-dashboard-session` header + `dashboard_login` /
   `dashboard_session` / `dashboard_logout`; encrypted token storage; delete the hard-coded
   `admin123` path and plaintext password storage.
2. **Permissions** — drive `DashboardSection` and drawer visibility from `user.permissions`
   (`dashboard, authors, blogs, categories, comments, galleries, books, submissions, videos,
   analytics, settings, access-control`); replace the local `UserRole` enum.
3. **Error handling** — map PostgREST codes to Bengali/English messages; surface failures from
   `DashboardRepository` to the UI; roll back optimistic updates.
4. **Pagination + counts** — `Content-Range` totals everywhere; Paging 3 for `blogs`/`comments`;
   fix `DashboardSummaryStats`.
5. **Model parity** — add the missing columns listed in [§14.4](#144-missing-columns); stop
   hard-coding `year = 2026`.
6. **Live navigation data** — drawer categories and years from the API; seed data demoted to an
   offline fallback.
7. **Submission workflow** — call `approve_submission`; render `reviewed_at` / `converted_blog_id`.
8. **Media** — PDF upload to Supabase Storage from `PdfBooksManagementView` and blog PDF fields;
   preserve `imgbb_delete_url` and `inline_media`.
9. **Refresh UX** — pull-to-refresh on Home/Explore/Dashboard, retry with backoff, offline banner
   driven by `syncState`.
10. **Optional hardening** — migrate `SupabaseClient` to Retrofit + Moshi (already on the
    classpath), add a Room migration instead of destructive migration, add Realtime for new
    articles.

---

## 17. The rebuilt public reader (current implementation)

The reader UI was rewritten against the live API. It lives in three new packages
and replaces the old reader navigation in `MainActivity`:

```
data/portal/     PortalConfig · PortalApi (Retrofit) · PortalDtos (Moshi)
                 PortalModels · PortalRepository · PortalProvider
ui/editorial/    EditorialTheme (tokens, type scale, spacing) · EditorialComponents
ui/reader/       HomeScreen · ArticleScreen · ListScreens (search/category/author)
                 ReaderViewModels · ReaderNavHost
```

| Concern | Where | Notes |
| --- | --- | --- |
| Transport | `PortalConfig.okHttpClient()` | TLS 1.2+, modern ciphers only, no cleartext (`res/xml/network_security_config.xml`), logging redacted and debug-only |
| Auth | none | Public reader uses only the publishable anon key. See [§17.1](#171-why-there-is-no-bearer-token) |
| Paging | `Page<T>` + `Content-Range` | Exact totals drive "load more" and the search result counter |
| Caching | `PortalRepository` | TTL in-memory cache for categories/authors/PDFs/videos/settings; last-good-wins on failure |
| Errors | `PortalError` | Bengali messages; `SchemaMissing` maps `PGRST205`/`PGRST204` to "run the migrations" |
| Deep links | `ReaderNavHost` | `ningshingche.com/article/{slug}` and `ningshingche.com/{id}`; Bengali slugs are percent-encoded |

### 17.1 The bearer: the publishable key, or the reader's own token

`apikey` is sent on every request and is the publishable key — it is **not** a secret and **not** a
credential, and it selects the `anon` Postgres role, whose powers are entirely defined by the RLS
policies in `schema.sql`: read published blogs, read reference tables, insert comments as `Unpublish`.

The `Authorization` bearer is the publishable key too — for a guest. Once a reader signs in, it is
**their** access token instead, installed at startup by
`PortalProvider.installReaderSession { supabaseClient.readerAuthToken() }` and read on every request
by the `PortalConfig` interceptor. Without that, every portal call arrived as `anon` even for a
signed-in reader, and the RPCs granted to `authenticated` — the contributor board
(`contributor_leaderboard`), the reader's own points (`contributor_points`) and the app-time report
(`record_app_time`) — refused them with "contributor board is for signed-in readers". The gate was
working; the app was simply never introducing itself.

Nothing else changes: the public reads are policies written `to anon, authenticated`, so a signed-in
reader sees exactly what a guest sees there, and the app-time/view attribution (migrations 025-026)
now lands on the reader's own id, which is what those migrations always intended.

That fix reached the sources as **app version 1.1** (`versionCode = 2`) — the builds before it say
`1.0`, and since Settings prints the installed APK's own version (`ApkManager`), a report of "the
board still says it is for signed-in readers" can now be answered by asking which version is on the
phone. A build older than 1.1 also has no contributor section on the home page at all, which is the
other half of that same report.

**1.2** (`versionCode = 3`) adds the forum, the public profile as it is now drawn and the lighter
contributor board (§12.3–12.5). Nothing in 1.1's fix changed; a report from a build before 1.2 simply
cannot be about the forum, because there is no forum in it.

What was hardened instead:

1. **TLS-only transport** — `network_security_config.xml` sets
   `cleartextTrafficPermitted="false"` globally and again for the Supabase,
   ningshingche.com and ImgBB hosts, so no code path can accidentally use HTTP.
2. **Modern TLS only** — `ConnectionSpec.MODERN_TLS` restricted to TLS 1.2/1.3.
3. **Keys injected at build time** — `BuildConfig.SUPABASE_PUBLISHABLE_KEY` from
   `.env` via the secrets plugin; staging and production can differ.
4. **Header redaction** in the debug logging interceptor.
5. **No `service_role` key, ever.** The dashboard-session header
   (`x-dashboard-session`) stays out of the reader entirely — it belongs to the CMS.

Certificate pinning was deliberately **not** added: Supabase serves projects from
behind a managed edge whose leaf certificates rotate, so a pin would brick every
installed app at the next rotation.

### Anonymous comment submission and remembered form details

The active article form now uses `PortalApi.postComment` with `Prefer: return=minimal` and `Response<Unit>`. An anonymous caller cannot read back a newly inserted `Unpublish` row, so `return=representation` is incorrect for this flow. Name/comment are required; email/phone are optional. Successful submissions cache **name, email and phone only** in a private, no-backup DataStore. Failed requests keep the draft and do not replace cached details; the comment body is never persisted locally.

See [`app/COMMENTING.md`](./app/COMMENTING.md) for the request contract, live non-persisting checks, moderation behavior, cache privacy, and regression tests.

### 17.2 Screens still to build

Gallery viewer, PDF archive + viewer, bookmarks, reading history, settings, and the
Room-backed offline cache are the next increment. The components in
`ui/editorial/EditorialComponents.kt` and the paging contract in
`ui/reader/ReaderViewModels.kt` are already shared, so those screens are mostly
layout.

---

*Generated from `app/` on branch `main`. Server contract: [`backend/API.md`](./backend/API.md).
Database schema: `backend/supabase/schema.sql` and
`backend/supabase/migrations/004_dashboard_access_control.sql`.*
