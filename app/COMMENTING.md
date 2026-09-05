# Android anonymous article comments

## Active path

`MainActivity` → `EditorialReaderApp` / `ReaderNavHost` → `ArticleScreen` → `ArticleCommentForm` → `ArticleViewModel` → `PortalRepository.postComment` → `PortalApi.postComment`.

The older `ui/screens/ArticleReaderScreen` and `ArticleRepository.submitComment` are not wired into the active public-reader navigation. Do not switch the current form back to that legacy upsert/website-scraping path.

## Correct public API contract

```http
POST https://<project>.supabase.co/rest/v1/comments
apikey: <Supabase publishable key>
Authorization: Bearer <same publishable key>
Content-Type: application/json
Prefer: return=minimal
```

```json
{
  "blog_id": "<existing published article UUID>",
  "blog_title": "Article title",
  "name": "Reader name",
  "address": "",
  "email": "",
  "phone": "",
  "content": "Comment text",
  "status": "Unpublish"
}
```

- No login, user ID, dashboard session, access token, or service-role key is needed. This is an INSERT, never an upsert/update.
- Name and comment are required. Email and phone are optional; a supplied email is validated. Whitespace is trimmed. Optional text columns use empty strings, matching the existing NOT NULL database defaults. No phone/contact-reading Android permission is requested.
- `blog_id` must be the loaded article's database UUID, not its title, slug or website URL. The database trigger maintains `blog_title`.
- The anonymous insert policy requires `status = 'Unpublish'`. A successful insert has an empty response (normally HTTP 201; HTTP 204 is also handled). The Retrofit return type is `Response<Unit>`.
- **Do not request `return=representation`.** Public readers can INSERT a pending comment but cannot SELECT it. Asking PostgREST to return the new pending row invokes that read policy and can reject/roll back the insert.
- Show “submitted, pending approval” after success. The comment will appear in the public list only after a dashboard moderator changes its status to `Publish`. Public comment reads select display fields only, not email/phone.
- Non-2xx responses use the PostgREST error message. A failed request preserves the entire in-memory draft for retry. A synchronous sending guard prevents repeated taps from sending duplicate requests.

## Remembered form details

After, and only after, a successful API response, the app writes `CommenterDetails(name, email, phone)` to a dedicated Preferences DataStore:

- Private file: `noBackupFilesDir/commenter_details.preferences_pb`.
- The file is outside Android cloud backup and device-transfer backup data.
- A newly opened article/restarted app pre-fills these three fields. The comment body starts blank.
- Empty email/phone values replace old cached values rather than resurrecting them.
- Comment text never enters DataStore, Room, SharedPreferences or SavedStateHandle. An unsubmitted draft exists only in the article ViewModel's memory (including across rotation), and is cleared after a successful response or when that ViewModel loads a different article.
- Form editing waits for the initial details read, preventing a late cache read from overwriting typed input. Storage-read failures fall back to a usable empty form.
- If the server accepts the comment but writing the local cache fails, the UI still reports the successful submission, with a separate “details could not be remembered” notice. It must not invite a duplicate submission.

**Contact-data privacy:** optional email/phone are also sent to the backend as comment metadata. Omitting these fields from the app's GET projection is not server-side confidentiality. The existing `comments_public_read` RLS policy grants public SELECT on published rows, including their contact columns to a caller that explicitly requests them. If contact details must be private to moderators, introduce a column-limited public view/RPC and restrict the base table in a separately reviewed database migration; do not assume this client change hides them from the API. No RLS policy is widened by this fix.

## Verification

Live, non-persisting checks on **2026-09-05** against the configured project:

- `GET /comments?select=id,blog_id,name,email,phone,content,status&limit=0` → HTTP 200: the endpoint and phone/email columns exist.
- `GET /settings?select=allow_comments&id=eq.site_settings` → HTTP 200 with `allow_comments: true`.
- A deliberately invalid UUID in an anonymous `POST /comments` using `return=minimal` → HTTP 400, PostgreSQL code `22P02`: the POST reaches the API and its UUID validation. This invalid payload cannot create a comment.

Positive insert, error, cache, and Compose UI tests use local fixtures—not production writes. No real/pending test comment was added to the live database. These checks do not replace a final smoke test on a device with an intentionally submitted comment/staging account.

## Automated regression tests

Requirements: JDK 17+, Gradle 9.3.1 (see `gradle/wrapper/gradle-wrapper.properties`), and Android SDK platform 36.1.

```sh
gradle :app:compileDebugKotlin
gradle :app:testDebugUnitTest --tests 'com.ningshingche.app.comments.*'
```

Validation on 2026-09-05: the Android sources compiled successfully and all **13** comment regression tests passed (including three Compose form tests).

Tests cover real Retrofit/Moshi POST construction and no-body responses, pending status, optional fields/Unicode, HTTP failures, DataStore reopening and its three-key allowlist, success-only caching, failed-draft retention, retry, duplicate taps, cache-write failures, and the actual Compose phone/form controls. MockWebServer uses a synthetic publishable key on localhost; Robolectric uses a plain `Application` to avoid initializing production services.

A pre-existing duplicated/incomplete Backup block in native `DashboardSettingsView` prevented compilation before this change. It referenced nonexistent settings properties and only displayed a fake “Backup started” toast. It is replaced with an informational pointer to the already-working **web dashboard → Settings → Backup**. The web backup implementation and database are unchanged.
