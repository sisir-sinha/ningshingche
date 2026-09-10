# Ningshing Che — Architecture & Deep-Dive Notes

> Consolidated from a full read of `app/`, `backend/`, and the SQL migrations on branch `main`.
> Companion docs: [`ANDROID_API.md`](./ANDROID_API.md) (reader-app ↔ API contract),
> [`backend/API.md`](./backend/API.md) (dashboard REST/RPC/Storage reference),
> [`GEMINI_APP_BUILD_PROMPTS.md`](./GEMINI_APP_BUILD_PROMPTS.md) (build constraints & gotchas).
> Where this document and the code disagree, **the code wins** — update this file.

---

## 1. System overview

Three components share one Supabase project (`slcpvmpsynkqdozvlsii`):

```
┌──────────────────────────┐     ┌───────────────────────────┐
│  Android reader app      │     │  Web editorial dashboard  │
│  com.ningshingche.app    │     │  backend/ (vanilla JS SPA)│
│  Kotlin + Compose        │     │  Tailwind CDN + Supabase  │
│  public reader +         │     │  staff CMS, RBAC, imports,│
│  signed-in workspace     │     │  backups, registered users│
└────────────┬─────────────┘     └────────────┬──────────────┘
             │  publishable key (anon)        │  publishable key +
             │  or Supabase Auth JWT (user)   │  x-dashboard-session token
             ▼                                ▼
   ┌────────────────────────────────────────────────────────┐
   │  Supabase: PostgREST + RLS + Storage + Auth + triggers │
   │  buckets: pdf-books (32 MB PDF) · music (32 MB audio)  │
   └────────────────────────────────────────────────────────┘
```

- **Website** `https://ningshingche.com` (not in this repo) is the public reader's
  deep-link target and the provenance for the seed author data.
- **ImgBB** hosts all image uploads from both clients (hero, avatars, covers);
  delete URLs are persisted so staff can remove them later.
- **GitHub Pages** deploys `backend/` as a static site (`.github/workflows/jekyll-gh-pages.yml`).

---

## 2. The three identities (do not mix)

| Identity | Credential header | What it can do |
| --- | --- | --- |
| **Anonymous reader** | `apikey` + `Authorization: Bearer <publishable key>` | Read `status='Publish'` blogs, reference tables, published comments, settings; INSERT a `comments` row as `Unpublish`; INSERT `submitted_blogs` as `Pending` (public policy) |
| **App user (Google)** | Supabase Auth **JWT** (from Google ID token via `grant_type=id_token` + nonce) | Read own profile/articles/comments (migrations 005–006); write `profiles`, own inbox, `admin_messages` (sender='user'), own music rows + `music/user/<uid>/…` storage (016/021), music playlists/loves (015/020) |
| **Dashboard staff** | `x-dashboard-session: <opaque token>` (SHA-256 stored) | Menu-permission-gated CRUD on every content table + PDF/music storage + dashboard RPCs (migration 004). The token is **not** a JWT and never goes to `Authorization`. |

Key rules that bite if broken:
- The publishable key in `Authorization` selects the `anon` role — it is **not** a secret
  and grants nothing beyond the anon RLS policies.
- Storage treats the publishable key as **unauthenticated**: user uploads must send the
  user JWT (`sessionUserJwt()` in `SupabaseClient`); this is why reader MP3 uploads 403'd
  before the fix (commit `6772f80`).
- `x-dashboard-session` belongs to the web dashboard only; the reader app never sends it.

---

## 3. Database (Postgres)

Base: `backend/supabase/schema.sql` + numbered migrations `002`–`021` in `migrations/`.
Order matters: `schema.sql` (or 002 legacy, **never after 004**) → 003 → 004 → 005…021.

### 3.1 Content tables (public reads per RLS)

| Table | Notes |
| --- | --- |
| `authors` | `title`, `image`, `imgbb_delete_url`, `image_meta jsonb`, `designation`, `description` (Quill HTML), `is_verified`, `location` |
| `categories` | unique `lower(slug)`; `icon_name` = Font Awesome name |
| `blogs` | the core table. `status in ('Draft','Publish')`, `tags text[]` (GIN), `is_slider/is_feature/is_special_article`, `views_count`, `reading_time_minutes` (trigger), `published_date date`, media: `image`, `imgbb_delete_url`, `image_meta`, `inline_media jsonb`, `video_link`, `pdf_book_link`, `pdf_file_provider ('url'/'supabase-storage')`, `pdf_storage_path`, `pdf_file_size_mb`. **Compatibility snapshots** `category_title/slug`, `author_name/image` are trigger-maintained for the Android client; FKs are truth. |
| `comments` | `blog_id` FK, `blog_title` (trigger), `status in ('Publish','Unpublish')`, contact fields, `user_id`, `avatar_url` (012) |
| `galleries`, `videos`, `settings` (`id='site_settings'` single row, incl. `allow_comments`, `allow_user_submissions`) | simple catalogs |
| `submitted_blogs` | reader submissions. `status in ('Pending','Reviewed','Approved','Rejected','Published')`, `converted_blog_id`, `user_id` (006). `approve_submission()` RPC (004) atomically converts → blog + author de-dup. |
| `music_tracks` (014–021) | `title/artist/album/genre/description`, `thumbnail_url`, `audio_url`, `file_provider ('url'/'supabase-storage')`, `file_storage_path`, `duration_seconds`, `file_size_mb`, `sort_order`, `lyrics` (015), `video_link` (017), `user_id` (018), artist/album images+bios (019), `love_count` (020, trigger-synced from `music_loves`) |
| `music_playlists` / `music_playlist_tracks` (015) | per user (`kind in ('custom','loved')`; loved is unique per user) |
| `music_loves` (020) | `(track_id, user_id)` PK; public read; triggers update `music_tracks.love_count` |

### 3.2 App-user workspace tables

| Table | Migration | RLS shape |
| --- | --- | --- |
| `profiles` | 005, 006, 011 | PK = `auth.users.id`; own read/write; +`first/last_name, about, phone, address, facebook_id, designation, location, website, imgbb_delete_url, profile_completed, notifications_enabled` |
| `user_notifications` | 007 | `(user_id, kind, related_id)` unique; kinds `article_published`, `comment_published`, `admin_message`; created by DB triggers `notify_user_on_publish` / `notify_user_on_admin_message`; staff can insert (009) and read with `registered-users`/`analytics` permission (008) |
| `admin_messages` | 007, 010 | `sender in ('user','admin')`; user inserts own 'user' rows; staff insert 'admin' rows (008); both sides mark read |

### 3.3 Dashboard RBAC (migration 004 — 1,102 lines)

- `dashboard_roles` (5 seeded: super-admin, administrator, editor, moderator, analyzer;
  `menu_permissions text[]`, `is_system`), `dashboard_users` (bcrypt `password_hash`,
  `is_active`, `must_change_password`, lockout fields), `dashboard_sessions`
  (SHA-256 `token_hash` only, 8 h standard / 7 d remembered, revocable).
- Helper functions (called inside RLS): `dashboard_request_session_token()` (reads
  `x-dashboard-session` from `request.headers`), `dashboard_current_user_id()`,
  `dashboard_has_permission(text)`, `dashboard_has_any_permission(text[])`,
  `dashboard_is_super_admin()`, `is_dashboard_request()` (legacy digest path — superseded).
- RPCs: `dashboard_login` (bcrypt check in Postgres, 5-attempt/15-min lockout),
  `dashboard_session` (validate), `dashboard_logout` (revoke), `dashboard_access_snapshot`,
  `dashboard_save_role` / `dashboard_delete_role`, `dashboard_save_user` /
  `dashboard_delete_user`, `dashboard_update_own_credentials` — all Super-Admin-gated,
  last-active-super-admin protected via advisory locks.
- Content write policies are **menu-specific** (e.g. blogs needs `blogs`; PDF storage needs
  `blogs` or `books`); private reads need the matching menu or `analytics`.
- Migration 014 adds the `music` menu; 008 adds `registered-users` to the valid-permission
  list — note `dashboard_valid_permissions()` is redefined in both (014's list has `music`
  but not `registered-users`; 008's has the opposite). **Run 008 after 014 and re-check
  role menus if both are applied** — a known sharp edge.

### 3.4 Tag normalisation (migration 013)

Annual issues are blog tags of the form `নিংশিং চে-YYYY` in many spellings (Bengali vs ASCII
digits, dash styles, spaces). Migration 013 installs the canonical normalisation:

- `blog_tag_normalize(tag)` → lower, NFC, Bengali→ASCII digits, plain hyphen, no `#`/space
- `blog_tag_issue_year(tag)` → 4-digit year for issue tags
- `blog_tag_key(tag)` → issue tags collapse to `নিংশিংচে-YYYY`; generated column `blogs.tag_keys text[]` (GIN)
- view `blog_tag_counts`, RPCs `blogs_by_issue(p_year, p_status)`, `blogs_by_tag(p_tag, p_status)`, `blog_issue_years()`

**Client fallbacks** (both dashboard `tags.js` and app `IssueTags.kt` mirror this in
code): try `tag_keys` / RPCs; on `PGRST205/PGRST204` (migration missing) fall back to
`tags=ov.{…every known spelling…}` + client-side key matching.

### 3.5 Storage buckets

| Bucket | Contents | Policies |
| --- | --- | --- |
| `pdf-books` | PDFs ≤ 32 MB, `application/pdf` | public read; dashboard write with `blogs`/`books` permission (004) |
| `music` | audio ≤ 32 MB, mp3/m4a/ogg/wav/flac/webm (014, MIME list extended 021) | public read; **app users** may write only under `user/<auth.uid()>/…` (016, 021); staff via dashboard `music` permission |

---

## 4. Android app deep-dive

Single-module Gradle project (`app/`), Kotlin 2.2.10, Compose BOM 2024.09.00,
minSdk 24 / target 36, `applicationId com.ningshingche.app`, Bengali UI, Kalpurush font.

### 4.1 Entry & DI

`NinghsingCheApp : Application, ImageLoaderFactory` constructs everything (no Hilt/Koin):
DataStore prefs → Room `AppDatabase` → `SupabaseClient` → `GoogleAuthRepository` →
`ArticleRepository` (legacy) → `PortalProvider.repository()` (active reader) →
`MusicLibraryStore` → `MusicController` (ExoPlayer session; guarded for Robolectric) →
`NinghsingCheAiAssistant` → `AppNotificationManager` + `ContentUpdateNotifier` +
`SeenContentStore` → `ContentCheckWorker.schedule()` (WorkManager periodic 15 min +
one-shot after 5 min).

Coil uses a shared OkHttp client (25 % heap memory cache, 250 MB disk cache, crossfade).

`MainActivity` is a thin host: theme mode (System/Light/Dark from DataStore),
edge-to-edge + `imePadding`, and renders `EditorialReaderApp`.

### 4.2 Two data stacks (important!)

1. **`data/portal/` — the ACTIVE reader stack** (Retrofit + Moshi, KSP codegen):
   `PortalConfig` (TLS 1.2+, publishable key via OkHttp interceptor, `buildConfig` from
   `.env` secrets plugin with `MY_`-prefixed values treated as unset) → `PortalApi`
   (PostgREST interface: list projections exclude `content`; `Prefer: count=exact` for
   paging; `postComment` uses `return=minimal` because anon cannot SELECT its own
   Unpublish row) → `PortalDtos` (Moshi) → `PortalRepository`:
   - batched parallel `homeFeed()` (any section degrades independently; only a total
     failure throws),
   - `Page<T>` with exact totals from `Content-Range`,
   - TTL in-memory caches (10 min reference, 1 h settings) with **last-good-wins** on error,
   - tag/issue logic with migration-013 probe (`tagEndpointsAvailable` tri-state),
   - `PortalError` taxonomy: `SchemaMissing` (PGRST204/205), `Http`, `NotFound`, `Unknown`
     with Bengali messages.
2. **`data/remote/SupabaseClient` — the hand-rolled OkHttp stack** (org.json), used for
   **signed-in user** flows and the legacy CMS: Supabase Auth (password, Google ID token
   with nonce, refresh-token rotation 2 min before expiry via `sessionBearer()`),
   profiles CRUD, own submitted blogs/comments, inbox (notifications + admin messages),
   music upload (Storage `music/user/<uid>/<uuid>.<ext>`, ≤ 32 MB, extension sniffed from
   MIME) + `music_tracks` insert, view counts per author name, plus all legacy content
   CRUD (authors/blogs/…) used by the in-app CMS paths.

   ⚠️ Legacy CMS writes (dashboard-style) only succeed where RLS allows; on a
   migration-004-secured install the reader app's `SupabaseClient` writes are **not**
   dashboard sessions. The active app surface uses the portal stack + user flows.

### 4.3 Navigation (`ui/reader/ReaderNavHost.kt`)

`EditorialReaderApp` = ModalNavigationDrawer (Bengali portal menu, live unread badge) +
NavHost. Start: `splash` → onboarding (`welcome_login` → `welcome_notifications`) or `home`
when `onboardingComplete`. Routes: home, search, `article/{id}` (+`?focus=comments`),
category, author, `issue/{year}`, ai_assistant (+`?q=`), settings, login,
user_dashboard (+`?tab=0..4&focus=`), user_profile, new_article, new_music, bookmarks,
pdf_archive, `pdf_viewer/{id}`, explore (`?tab=`), featured, videos, music (+
`music_genre/{name}`, `music_artist/{name}`, `music_album/{name}`), about,
authors_directory, social_activities.

- Deep links: `https://ningshingche.com/article/{slug}`, `https://ningshingche.com/{id}`
  (http too); notification intents carry `EXTRA_ROUTE`/`EXTRA_TARGET_ID` and are resolved
  in `routeFromLaunchIntent`.
- Top-level drawer navigation: `popUpTo(home){saveState}` + `launchSingleTop` + `restoreState`.
- **Route transitions** (all 32 destinations): slide + fade via `navEnter`/`navExit`/
  `navPopEnter`/`navPopExit` vals — 280 ms in, 240 ms out, combined with the `+` operator
  on compose `EnterTransition`/`ExitTransition` (type:
  `AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition`).
- Notice taps are handled **inside** `UserDashboardScreen` (`openNotice`): the pager
  animates to the target tab (like a manual swipe) and the focused card scrolls into
  view + highlights; no second dashboard screen is pushed.
- Global overlays at the root: `MusicMiniPlayerBar`, `MusicFullPlayerOverlay`
  (composition-local `LocalMusicController`), `AppToastHost`, connectivity toasts
  (offline/weak via `ConnectivityMonitor`).
- ViewModels: `ReaderViewModelFactory` (portal: Home/Article/Category/Author/Issue/
  Explore/Search) and `ViewModelFactory` (main: workspace, bookmarks, AI, settings, PDF,
  music via legacy repos).

### 4.4 Reader feature inventory

- **Home** (`HomeScreen`): hero carousel (sliders, topped up from latest to ≥3 panels),
  featured, special, latest, categories, authors, gallery, PDF rail, videos, music,
  settings-driven toggles; AI entry; account header (avatar → profile, bell → inbox).
- **Article** (`ArticleScreen`, 1,629 lines): HTML renderer (`HtmlArticleRenderer`),
  related articles, view-count increment, bookmark/share, TTS (`ArticleTtsPlayer`),
  comments list (published only, avatars), `ArticleCommentForm` (anon or signed-in;
  cached name/email/phone in no-backup DataStore `commenter_details.preferences_pb` after
  success only; draft is in-memory; never `return=representation`).
- **Search**: server-side `or=(title.ilike.*,sub_title.ilike.*,slug.ilike.*)` with exact
  totals; recent searches; music artist/album/genre suggestions.
- **Explore**: tabs categories/authors/annual-issues/popular with **real counts from
  `blogFacets()`** (one light ~5 KB request) instead of hard-coded numbers.
- **Music** (`MusicScreen`, `MusicBrowseScreens`): catalog from `music_tracks`
  (progressive `select` fallback for missing columns: love → meta → video → lyrics → base),
  genre/artist/album shelves, player: `MusicController` + foreground
  `MusicPlaybackService` (ExoPlayer + MediaSession, video renderer for `video_link`
  embeds), shared `SimpleCache` (256 MB) with prefetch heads (1.5 MB current / 6 MB next),
  shuffle/repeat/loop/autoplay/lyrics/sleep-timer, **loved songs** (Room playlist +
  `music_loves` remote sync + `love_count`), custom playlists (Room + `music_playlists`/
  `music_playlist_tracks` best-effort sync), **offline downloads** (Room `music_offline`
  + file). `MusicTrack.streamUrl()` prefers public Storage when the URL is signed or
  `file_provider=supabase-storage`.
- **PDF**: archive (category filter) → in-app viewer (Pdfium via `android-pdf-viewer`),
  download/share via FileProvider; GitHub-Pages PDFs open externally.
- **AI assistant** (`NinghsingCheAiAssistant`, 991 lines): local ranked search over
  synced content as fallback; online via **direct HTTP** — Gemini
  (`gemini-3.5-flash:generateContent`, keys from `BuildConfig.GEMINI_API_KEY`) and
  OpenRouter (`OPENROUTER_API_KEY` fallback); article-specific Q&A with a system
  instruction built from the article; suggested follow-up questions; chat history in Room
  (`ai_chat_messages`) via `ArticleAiChatStore`; image lightbox with pinch/double-tap zoom.
- **PDF/Video**: `VideosScreen` with provider-aware iframes; `PdfViewerScreen` renders
  pages to bitmaps.

### 4.5 Signed-in user workspace (`ReaderWorkspaceViewModel` + `UserDashboardScreen`)

Google sign-in flow: Credential Manager (SIWG → OneTap fallbacks, nonce hashing) →
`SupabaseClient.signInWithGoogleIdToken(idToken, rawNonce)` → `upsertReaderProfile`
(merge existing row, preserve email). Profile must be **complete** (first+last name,
about, phone, address, facebook id, avatar) before article/music submission —
`profile_completed` flag enforced app-side.

`UserDashboardScreen` = HorizontalPager, 5 tabs:

| Tab | Content |
| --- | --- |
| 0 Home | `UserInfoCard` + `MetricsGrid` (articles total/pending/published/rejected, comments, songs, article views via `sumBlogViewsForAuthor(name)`) + speed dial (new article / new music) |
| 1 Notices | `user_notifications` (bell, read state). Tapping a notice sends the pager to the matching bottom tab — admin/staff → বার্তা (tab 2), comment-published → মন্তব্য (tab 4), article-published → কন্টেন্ট (tab 3) — with a smooth in-screen slide (internal `openNotice` in `UserDashboardScreen`), then focuses/highlights the matching card. Focus ids flow in via route args (`user_dashboard?tab=…&focus=…`) when the dashboard is opened from another screen. The user then acts on the card itself (e.g. open the article); notices never jump straight to an article page |
| 2 Messages | `admin_messages` chat bubbles (user ↔ admin), image attachments parsed from body URLs, zoomable preview, mark-read |
| 3 Content | own `submitted_blogs` + own `music_tracks` (status chips; opens published articles via portal fallback search) |
| 4 Comments | own `comments` with status + link to `article/{blog_id}?focus=comments` |

- Inbox sync: `InboxSync.noticesFromPublished` generates local notices for
  Published/Approved articles and published comments, upserts them to
  `user_notifications` (DB also creates them via triggers — idempotent via unique key),
  dedups on `kind:relatedId`.
- Unread badge = unread notices + unread **admin** messages; shown on home header bell
  and drawer.
- `submitArticle`: optional thumbnail → ImgBB (delete URL persisted), HTML content,
  `status='Pending'`, `user_id` set → `submitted_blogs`.
- `submitMusic`: audio → Storage `music/user/<uid>/…` (user JWT!), optional cover →
  ImgBB, duration via `MediaMetadataRetriever` → `music_tracks` insert (021 RLS).
- Avatar upload → ImgBB → `profiles.avatar_url` + `imgbb_delete_url`.
- `notifications_enabled` syncs to `profiles` (011) so staff can broadcast responsibly.

### 4.6 Local notification stack (reader-facing, no FCM)

`ContentCheckWorker` (WorkManager, 15 min periodic + one-shot) → `homeFeed()` + inbox →
`ContentUpdateNotifier.ingest/ingestInbox` → compares against `SeenContentStore`
(DataStore `ningshingche_seen_content`: seen keys capped at 4000/3000, baseline flag,
version code, settings hash) → posts Android notifications via
`AppNotificationManager` (channels: new content, featured, inbox; tap intents carry
route + target id). `LaunchRoute.routeFromLaunchIntent` maps notification extras to
nav routes. User opt-outs: DataStore prefs + `profiles.notifications_enabled`.

### 4.7 Local storage (Room, `AppDatabase` v4)

`articles` (legacy cache), `bookmarks`, `reading_history`, `search_history`,
`ai_chat_messages`, `music_playlists`, `music_offline`. `fallbackToDestructiveMigration`
still in use — schema changes wipe the cache (known gap).

### 4.8 Build & secrets

- `.env` via Google secrets Gradle plugin (`MY_`-prefixed = unset → fallbacks in
  `SupabaseConfig`/`PortalConfig`). Keys: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `IMGBB_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`.
- Release: R8 minify + resource shrink, `my-upload-key.jks` (env-overridable path),
  ABI filters arm only, legacy-packaged .so (Pdfium/ExoPlayer compressed).
- `google-services.json` optional (`missingGoogleServicesStrategy = WARN`) — Firebase
  Auth is **not** used; Gemini is plain HTTP.
- Tests: Robolectric + Roborazzi; suites under `app/src/test`: brand identity, Google
  auth mapper, comments (MockWebServer + Compose form), inbox sync, content-update
  policy, portal, issue tags.

---

## 5. Web dashboard deep-dive (`backend/`)

No-build SPA: `index.html` + `assets/js/*` (~9,800 lines) + Tailwind CDN, Chart.js,
Quill, DOMPurify, SheetJS, Font Awesome 6 Pro. Global `NC` namespace; hash routing
(`#/route`), dark-first theme.

| File | Role |
| --- | --- |
| `config.js` | `NC_CONFIG`: Supabase URL/publishable key, buckets, ImgBB key, routes (21 menu entries incl. `registered-users` + 6 `ru-*` sub-routes), table names, session params |
| `utils.js` | format/validate/sanitize helpers |
| `tags.js` | mirrors migration-013 normalisation in JS (issue detection, keys, spellings) |
| `auth.js` | `dashboard_login`/`dashboard_session`/`dashboard_logout` RPCs, token in session/localStorage, `canAccess(route)`, legacy demo-login fallback (migration-compat only) |
| `api.js` | `NC.api`: central REST layer (headers incl. `x-dashboard-session`, list/count/insert/upsert/update/remove, `rpc()`, tag-endpoint probing + client fallback, `uploadPdf`/`uploadAudio` (Storage, progress), `deleteStorageObject`, `attemptImgBBDelete`, global `searchAll`, `schemaProbe`, Bengali/English error mapping) |
| `components.js`, `crud.js` | modals, toasts, tables, shared list/CRUD |
| `editor.js` | Quill abstraction + DOMPurify + ImgBB image action |
| `media.js` | ImgBB uploader (metadata + delete-URL preservation), PDF upload, safe video iframes |
| `importer.js` | CSV/XLS/XLSX templates, validation preview, create-only bulk import, first-row form fill |
| `dashboard.js` | metrics + charts (Dashboard and Analytics views share a renderer) |
| `registered-users.js` (1,985 lines) | the whole `registered-users` area: users list (profiles), ru-articles (full blog editor + approve&convert), ru-music, ru-comments, ru-messages (staff reply + read ticks), ru-notifications (send in-app notice), growth/status charts |
| entity views | `authors`, `blogs` (634 lines; issue/tag filters, hero, PDF, sliders), `categories`, `comments`, `galleries`, `books`, `submissions` (approve via RPC), `videos`, `music`, `settings` (site settings + **Backup** + database check), `access-control` (users/roles/self credentials) |
| `backup.js` | permission-aware paginated JSON export (50 MB cap, cancellation, manifest, download history) |
| `app.js` | shell: login gate, sidebar filtered by role, global search (Ctrl+K), theme/density prefs, submission count badge, mandatory password-change dialog |

Dashboard-specific conventions:
- Writes always carry `x-dashboard-session`; RLS re-checks menu permission server-side.
- PATCH only known fields; media replaced upload-first (old file deleted only after save).
- Duplicate-skip import semantics; relationships resolved by id/slug/name before import.
- `settings` row id is always `site_settings`.

---

## 6. Cross-cutting contracts & gotchas (learned the hard way)

1. PostgREST has **no implicit `eq`** — every filter needs `col=op.value`;
   `encoded=true` does not add it.
2. Bengali slugs everywhere → percent-encode (`URLEncoder.encode(v).replace("+","%20")`).
3. Exact counts: `Prefer: count=exact` + parse `Content-Range` (`a-b/N`).
4. Anonymous comment insert: `Prefer: return=minimal`; requesting representation
   triggers the SELECT policy and rejects the insert.
5. minSdk 24 **without** desugaring → no `java.time.*` (use `SimpleDateFormat`).
6. Compose 1.7 (BOM 2024.09.00) — nothing newer than that.
7. Cleartext disabled globally; no cert pinning (Supabase edge certs rotate).
8. `blogs.content` is raw HTML — render, don't strip.
9. `settings` non-title columns are empty in production — consumers fall back to
   ningshingche.com values; the four feature toggles are all true.
10. `published_date` spans mid-2025 only (per build-prompt notes) — never hard-code years;
    derive from data (facets/RPC).
11. `pdf_books` are all external URLs (GitHub Pages) — open via `ACTION_VIEW`.
12. Facebook video thumbnails are absent — derive/placeholder; YouTube thumbnails exist.
13. Music: prefer `file_storage_path` public URL over signed `audio_url` (expiry);
    32 MB upload cap; user files live under `music/user/<uid>/…`.
14. The `dashboard_valid_permissions()` redefinitions in 008 vs 014 — after applying
    both, verify `dashboard_roles.menu_permissions` still contains the union you expect.

---

## 7. Deployment & CI

- **Dashboard**: GitHub Pages (static `backend/`), on push to `main`.
- **App**: manual Gradle builds; release signing via env (`KEYSTORE_PATH`,
  `STORE_PASSWORD`, `KEY_PASSWORD`) or `my-upload-key.jks`; Codemagic config file is
  present but empty (`codemagic.yaml`).
- **Database changes**: publishable key cannot run DDL — every migration is applied by a
  human in the Supabase SQL Editor in numbered order.

## 8. Test map

- App: `BrandIdentityTest`, comments suite (API construction, cache, Compose form),
  `GoogleAuthMapperTest`, inbox sync, content-update policy, issue tags, portal tests,
  Roborazzi screenshots.
- Dashboard: `backend/tests/` — fixture-only node unit tests + Playwright browser checks
  (backup, filters); no production Supabase writes.
