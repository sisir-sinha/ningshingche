# Advanced moderation implementation report — Phase 2

**Overall: PARTIAL. Do not deploy migrations 044–046 to production or treat this
as closed-testing-ready.** This is an extensible foundation, not completion of
all requested features. No Supabase project was changed. Google Play compliance
has not been independently assessed.

## Existing architecture and reuse

- **PASS — inspection:** read `UGC_IMPLEMENTATION_REPORT.md`, migrations 040–043
  (041 is `041_terms_acceptance_and_secure_article_submission.sql`), the current
  dashboard, Terms, forum/comment/music writes, notification schema and AI client.
- **PARTIAL — reuse:** report validation, queue, report moderation RPC, existing
  staff sessions/Forum permission, account consent/version, article Pending
  submission, block RPC and public anonymous comments remain in place. 043 is not
  duplicated or modified. New account decisions are separate from report status
  and never arise automatically from report volume.
- Dashboard sessions are not reader JWTs. New account/policy actions require the
  existing **super-admin** staff identity server-side; 043 report moderation still
  uses existing Forum permission and 043's target-specific permissions. No new
  role or authoritative staff-to-reader mapping is introduced.

## Implemented additions and limitations

| Feature | Status | Evidence and limitations |
|---|---|---|
| Central dashboard | PARTIAL | Existing Reports view adds evidence, super-admin account actions/history, paginated appeal queue and editable policy recommendations. Existing status filters/search/pagination remain. This is not the requested nine-section unified dashboard; the existing report list loads at most 2,000 rows, so its counts are not guaranteed global. Date-range filters, global aggregates, repeat-offender and resolution-time metrics are missing. UI is in existing portal English; real responsive/accessibility tests NOT RUN. |
| Content decisions | PARTIAL | 043's review/dismiss/resolve and transactionally audited unpublish of article/comment/discussion/reply remain. Restore, temporary hide, rejection/revision, retention/deletion and comprehensive auditing of older editorial routes are not implemented. |
| Warnings and restrictions | PARTIAL | 044 adds reasoned, actor-derived warnings; publication, comment, forum and broad **posting** restrictions with future expiry; and explicit lift by restriction event ID. Super-admin decisions use a request ID for safe same-payload retries and serialize per user. Active scope duplicates are refused. BEFORE INSERT guards cover article submissions, music, authenticated comments/discussions/replies. Existing edits, reactions, uploads/storage and all alternative workflows are not comprehensively restricted; “suspend” is a posting restriction, not account/login suspension. No automatic expiry notification. |
| Violation history | PARTIAL | Append-only to clients, bounded super-admin history and subject-only sanitized RPCs include action, target, moderator, reason, old/new status and expiry. Existing 043 removals and other historic actions are not incorporated; no retention or account-erasure policy has been implemented. Database owners can administer these tables, so client immutability is not protection from privileged database owners. |
| Appeals | PARTIAL | Owner-only submission/list RPCs for 044 warning/restriction events; one active appeal per decision, identical text returns the existing appeal, per-user rolling limit, staff-only review and reasoned accept/reject audit. Accepting an appeal does **not** automatically lift a restriction; a second explicit action is needed. The super-admin dashboard lists and decides them. Android appeal/decision UI is missing, and 043 content removals/other actions are not appealable through this layer. No appeal notifications. |
| Policy catalog | PARTIAL | 046 centrally stores 11 category recommendations, severity, applicable types, suggested action and recommended appeal eligibility. Super-admin updates require a reason and write old/new policy audit; dashboard settings use these RPCs. These are recommendations only: the Android report choices and 043 reason validation remain hardcoded, and appeal eligibility is not yet enforced. No automatic enforcement. |
| Evidence | PARTIAL | 045 snapshots up to 2,000 characters of selected database content for **new** report rows, plus target, server-derived author and time; no reporter identity or media file is copied. Forum-authorized staff retrieve the excerpt in the report modal, rendered as text. Existing reports have no backfill. No legal retention/deletion workflow, redaction, size/PII review or real Supabase verification exists. User-authored content may contain personal information; resolve retention and deletion before deployment. |
| Moderator permissions | PARTIAL | Existing server-authenticated dashboard session, existing super-admin role for new account/appeal/policy actions, existing Forum and content-specific permissions for 043. Separate granular moderator/appeal role and complete least-privilege redesign are missing. Existing migration 031 associates Forum with some Comments roles; review those assignments before granting report/evidence access. |
| Notifications | BLOCKED | No moderation/appeal/expiry notifications or deep links were added. Existing inbox behavior and preferences need product and device validation. Users cannot yet see a decision or appeal in the Android UI. Do not use enforcement in production until users have a tested way to receive and appeal decisions. |
| Blocking | PARTIAL | Existing block/unblock preserved. Feed/detail/profile/search/forum SECURITY DEFINER reads, replies/interactions, notification filtering, caches, account switching and both-direction behavior remain incomplete. No claim of consistent blocking. |
| Terms | PARTIAL | 044 guards authenticated inserts through direct tables and SECURITY DEFINER forum/article RPCs with current account acceptance and server-author identity; staff editorial inserts require existing target permission. Android adds account-version acceptance before new discussions, forum replies, authenticated comments and music; dialogs wait for server confirmation and key UI state to the account. The backend is final authority. Guest comments still use the prior local consent/anonymous insert contract, not verifiable server-side guest consent; a person may use the anonymous path. Existing edits and all other UGC paths require inventory and testing. Older clients and stale sessions may fail to post after 044. Android changes are uncompiled and untested on devices; coordinate migration and clients only after staging. |
| AI reports | PARTIAL | `NinghsingCheAiAssistant.kt`, `MainViewModels.kt` and `AiAssistantScreen.kt` use local answer IDs; no authoritative persistent answer source was found. 043 still accepts opaque AI IDs as **unverified reports**, not proof of an answer. 045 intentionally does not create verified AI evidence. No safe persistent server-backed AI answer/report workflow exists yet. |
| Data retention | BLOCKED | Account event/appeal/evidence records contain account IDs, explanations, reasons and potentially personal information. Define legal basis, retention, subject access, restricted operator deletion and account-deletion handling before use. No automatic deletion introduced. |

## Files and migrations

- **New 044:** `backend/supabase/migrations/044_account_moderation_and_ugc_guards.sql` — private account events, appeals/audit, staff and subject RPCs, insertion guards.
- **New 045:** `backend/supabase/migrations/045_report_evidence.sql` — private bounded excerpts and permission-gated read RPC.
- **New 046:** `backend/supabase/migrations/046_moderation_policy_catalog.sql` — recommendations and server-attributed update audit.
- **Modified dashboard:** `backend/assets/js/reports.js` — evidence, account actions/history, appeal and policy panels; confirmation and server-side permission checks.
- **Modified Android:** `TermsConsentDialog.kt`, `ArticleScreen.kt`, `ReaderNavHost.kt`, `ForumScreens.kt`, `NewMusicScreen.kt`, `ReaderWorkspaceViewModel.kt` — explicit account acceptance and account-switch checks. Guest comment consent remains local.
- **Modified i18n:** `i18n/strings_inventory.csv`, `backend/assets/lang/{bn,en,bpy}.csv`, `app/src/main/assets/i18n/{en,bpy}.csv`. New English strings are translated; Bishnupriya uses Bengali fallback pending native review.
- **New tests:** `backend/tests/advanced-dashboard.test.cjs`, `advanced-moderation.test.cjs`, `sql/run-ugc-phase2.sh`, `sql/ugc-044-setup.sql`, `sql/ugc-044-checks.sql`, `sql/ugc-045-checks.sql`, `sql/ugc-046-checks.sql`; modified `backend/tests/README.md`.
- **Modified reports:** this document and `UGC_IMPLEMENTATION_REPORT.md`.
- Pre-existing `gradlew` mode-only modification is not part of this work.

## Automated tests and validation

| Check | Status | Result |
|---|---|---|
| Local SQL fixture | PASS | `bash backend/tests/sql/run-ugc-phase2.sh`: private temporary PostgreSQL cluster, prior 040–043 tests, 044–046 checks and reapplication. Covers server consent/no-consent, forged ID, guest compatibility, warning/restriction/lift/expiry, account permissions, appeal duplicate/decision/audit, snapshot/privacy, policy permissions/audit. Schema and identities are simplified mocks, not real Supabase; no concurrency stress test. |
| Dashboard and regression | PASS | `NODE_PATH=/tmp/nc-test-deps/node_modules node --test backend/tests/*.test.cjs`: 682 passed, 0 failed, 0 skipped. Includes jsdom/mocked RPC and source checks, not live browser/Supabase. |
| Android debug and unit tests | BLOCKED | `bash ./gradlew ... :app:assembleDebug :app:testDebugUnitTest` failed before compilation: installed Java 11; Gradle 9.3.1 requires JDK 17+. Android SDK is absent. The direct `./gradlew` attempt also hit the pre-existing mode-only permission change. No Kotlin compile, APK or unit test pass. Earlier environment exhausted heap during Kotlin compilation. |
| Android device/emulator | NOT RUN | No connected device/emulator. Account-switch races, consent UX, music upload and actual restrictions need device tests. |
| Real Supabase | NOT RUN | No staging project or authenticated real JWT/staff-session integration. Follow `backend/tests/UGC_STAGING_RUNBOOK.md`, extend it for 044–046, and validate real schema, function owners, policies, grants, transactions, concurrency, notifications and existing-data compatibility. Never run fixture setup on a shared project. |
| Terms URLs | PARTIAL | On 2026-11-21, Pages URL `https://sisir-sinha.github.io/ningshingche/terms-of-use/` returned HTTP 200; `https://ningshingche.com/terms-of-use/` returned HTTP 404. HTTP status is not accessibility or content/legal validation. |
| Signed AAB | BLOCKED | Original signing configuration is unavailable; no key was created or replaced. |

## Deployment and outstanding work

1. Finish secure guest consent, all authenticated UGC/update paths, every blocking
   surface and account/cache separation; make policy/appeal eligibility coherent.
2. Deliver Android decision/appeal screens, accessible/responsive admin sections,
   all requested statistics and moderation actions, appropriate notifications,
   evidence retention/privacy and AI-report provenance. Map staff and reader
   accounts safely to prevent self-approval. Add comprehensive device and direct
   API abuse tests.
3. Stage 040–046 on an authorized disposable real Supabase project only after
   schema/grant review and backup/rollback planning. 044–046 require prior schema,
   compatible app/dashboard rollout and privacy decisions; old clients can break.
   Never reapply 042 after 043 without reapplying the newer security changes and
   checking effective grants. Do not apply to production based on fixture results.
4. Validate Android compilation, unit tests, instrumented flows and signed build
   with original signing material. Publish the custom Terms route and verify it.
5. Revoke/rotate the PAT and ImgBB key previously exposed in chat/history. No
   secrets should be posted to chat, committed, or written to repository URLs.

## Phase 3 continuation — 2026-11-21

Undeployed 047–049 add partial forum visibility and reply-interaction safeguards,
transactional staff evidence-read auditing, and selected reader forum-edit guards.
The dashboard no longer falls back to multi-request article conversion when its
approval RPC fails. Existing 043/044 decision/audit boundaries and all documented
limitations remain; in particular this is not comprehensive moderation, identity
mapping, retention, notifications, appeals UX or block enforcement. The isolated
fixture passed; no live Supabase deployment has occurred. Detailed verification,
remaining work and rollback guidance are in `PHASE3_FINAL_IMPLEMENTATION_REPORT.md`
and `backend/tests/UGC_STAGING_RUNBOOK.md`.
