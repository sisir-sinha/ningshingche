# UGC implementation report

## A. Executive summary

This is a **partial implementation**, not a Google Play compliance certification.
The existing Terms/approval infrastructure was reused. The changes add a
version-bound account consent RPC, article and profile reporting, reporting
queue improvements, an audit of report status changes, and a blocked-user list.
The SQL was exercised against a disposable PostgreSQL fixture, not Supabase
production. Android runtime, full moderation workflows and consistent blocking
are not verified or complete. Do not submit this as closed-testing-ready.

## B. Feature status

| Feature | Status |
|---|---|
| Article Terms acceptance | Implemented in code; SQL fixture passed; Android end-to-end not verified. Existing server-side submission RPC still creates Pending submissions. |
| Account-level Terms | Existing 041 acceptance table reused; 042 binds consent to the version actually displayed, disables the old zero-argument RPC and requires renewed acceptance for 2026-11-21. Deploy together with the app. Other UGC types are **not** yet protected by server-side acceptance. |
| Article reporting | Implemented in both article navigation paths for signed-in users, with reasons and optional note; SQL fixture tested, device test outstanding. |
| User reporting | Implemented on public profiles for signed-in users, distinct from article reports. Author/byline surfaces are not comprehensively covered. |
| Block and unblock | Existing RPCs reused; profile/report-dialog blocking has confirmation; Settings includes a blocked-user list and unblocking. **This does not yet filter blocked users' content across feeds, profiles, discussions or comments.** The UI warns about the limitation. |
| Moderation queue | Existing queue supports the new article type and links to Blogs when permitted; report status changes receive a server-derived moderator ID and audit row. |
| Content moderation | Existing editorial pages handle content separately. Removal, article rejection and account restrictions have not been integrated with a comprehensive audit/decision workflow. |
| Abuse/security | Article/profile reports verify authenticated identity and actual target; report detail privacy, duplicate prevention, and a 30-per-day limit tested in an isolated fixture. Legacy report types and guest identity need further hardening. |

## C. Modified files

- `.env.example`: replaces the pre-existing real-looking ImgBB key with a placeholder; rotate the previously exposed key because Git history still contains it.
- `app/src/main/assets/i18n/en.csv` and `bpy.csv`: packaged strings for the new controls. Bengali is deliberately used as a fallback for the new Bishnupriya rows pending review by a speaker.
- `app/src/main/java/com/ningshingche/app/data/portal/PortalRepository.kt`: article/impersonation report codes and explicit errors when fetching blocks.
- `app/src/main/java/com/ningshingche/app/data/remote/SupabaseClient.kt`: calls the version-bound consent RPC and checks its returned version.
- `app/src/main/java/com/ningshingche/app/ui/components/ContentSafetySheet.kt`: optional notes, impersonation reason, accurate failure handling, block confirmation and limitation notice.
- `app/src/main/java/com/ningshingche/app/ui/components/TermsConsentDialog.kt`: current version updated.
- `app/src/main/java/com/ningshingche/app/ui/reader/ArticleScreen.kt`: article-report action/dialog.
- `app/src/main/java/com/ningshingche/app/ui/reader/ReaderNavHost.kt`: wires article/profile report and profile block callbacks; adds blocked-users route.
- `app/src/main/java/com/ningshingche/app/ui/screens/PublicProfileScreen.kt`: user-report and block actions.
- `app/src/main/java/com/ningshingche/app/ui/screens/SettingsScreen.kt`: blocked-users entry.
- `app/src/main/java/com/ningshingche/app/ui/viewmodel/ReaderWorkspaceViewModel.kt`: synchronous submit guard, retry request ID, saving cleanup and local consent-cache failure handling.
- `backend/assets/js/reports.js`: article/impersonation labels, article link and server-returned moderator values; no false success for an empty update.
- `backend/assets/lang/bn.csv`, `en.csv`, `bpy.csv`: refreshed language templates.
- `backend/terms.html`: updates consent language, review process, blocking limitation, account-deletion link, date; removes unsupported 48-hour promise.
- `backend/tests/README.md`: documents the isolated PostgreSQL fixture.
- `i18n/strings_inventory.csv`: refreshed UI string inventory.

## D. New files

- `app/src/main/java/com/ningshingche/app/ui/screens/BlockedUsersScreen.kt`: account block list/unblock UI.
- `backend/supabase/migrations/042_ugc_consent_reporting_audit.sql`: additive security changes.
- `backend/terms-of-use/index.html`: self-contained static route in the dashboard Pages artifact.
- `backend/tests/sql/ugc-fixture-setup.sql`, `ugc-fixture-checks.sql`: disposable PostgreSQL fixtures and behavioral checks.
- `backend/tests/ugc-followup.test.cjs`: source-contract and route checks.
- `UGC_IMPLEMENTATION_REPORT.md`: this report.

## E. Database changes and deployment

Migration **042**, after existing 040 and 041, adds `content_report_audit` with
an index and permission-gated RLS. It replaces `current_terms_version` and
`report_content`; adds `accept_terms_version(text)` and an audit trigger;
updates report type/reason constraints and report RLS to allow authorized
opaque dashboard sessions using the `anon` PostgREST role; and removes the
reader's old pending-submission update policy. Direct acceptance writes remain
revoked; old zero-argument consent RPC execute is revoked. Historical acceptance
records remain in the 041 table. Article ownership is derived from approved
converted submissions when the mapping is unambiguous, not from a supplied ID.
The report cap is 30 new reports per identity per rolling day; guest device IDs
are client supplied and thus not a strong abuse-control boundary.

First test on an isolated staging clone with a backup and real Supabase roles,
functions, policies and existing data. Confirm 040 and 041 are already applied.
Then an authorized operator can apply the additive migration using a secure
connection supplied outside chat:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/supabase/migrations/042_ugc_consent_reporting_audit.sql
```

This command is **not** evidence it has been run on production. Coordinate
application release, migration, and Terms deployment: old clients cannot accept
new Terms after 042 and the new client cannot record acceptance before 042.
Review 042 against the live policy inventory first; it was not tested against
production data. No database reset is needed or authorized.

## F. Security review and unresolved gaps

- Article submission is gated by the existing 041 RPC; local fixture verifies
  rejection without consent, stale-version rejection, Pending state, ownership,
  and repeat requests. A supplied version must match the server's current one.
- Other posting paths, including comments and forum, currently rely on local
  consent state rather than authoritative account-level server enforcement.
- The new article/profile reporting path rejects anonymous and self reports,
  validates target existence and derives the reported identity. Other legacy
  report types still allow guest reporting and accept client-supplied attribution.
- The report queue and audit were tested with mock dashboard authorization and
  database roles; real Supabase RLS/grants still require staging verification.
- Status audit covers the moderator UUID, target, previous/new status and time.
  It does **not** capture a moderator's reason or separately audit all content
  removal, warnings, account restrictions, or submission approvals.
- Blocking is persisted and can be undone, but visibility/interactions are not
  comprehensively filtered or protected; it is not a complete safety feature.
- Moderator/reader identities are separate systems. Prevention of a moderator
  approving their own reader submission remains unverified and unimplemented.
- Report count never automatically removes content. Existing publishing and
  editorial moderation still require an authorized human action.

## G. Test results

| Check | Result | Evidence / limitation |
|---|---|---|
| Node regression and source checks | PASS | `NODE_PATH=/tmp/nc-test-deps/node_modules node --test backend/tests/*.test.cjs`: 677 passed, 0 failed, 0 skipped. Includes jsdom tests; source checks are not a Kotlin compiler. |
| PostgreSQL syntax / fixture | PASS | Migrations 040, 041, 042 applied in a disposable PostgreSQL 17 database; `ugc-fixture-checks.sql` passed. Migration 042 also reapplied successfully. |
| Terms / article submission | PARTIAL | Fixture tests cover old/current version, no acceptance, Pending and duplicate ID. No real-device, cross-device, expired-session or real Supabase integration test. |
| Article/user report | PARTIAL | Fixture tests cover authenticated reports, attribution, duplicate, self/anonymous rejection and report privacy. Android UI/device not tested. |
| Block/unblock | PARTIAL | Fixture tests exercise RPCs; UI not device-tested and visibility filtering is incomplete. |
| Admin moderation | PARTIAL | Fixture tests cover report visibility, attribution, status audit and immutable report details. Removal/approval and live Supabase admin flows not validated. |
| Google/email authentication, navigation, comments, forum, music, account deletion | NOT RUN | No device or live/staging end-to-end tests. |
| Kotlin compilation / Android unit tests / debug APK | BLOCKED | The debug build reached `:app:compileDebugKotlin` but failed with Java heap exhaustion on this 2 GB machine, even with one worker. Android unit tests and APK packaging therefore did not run. An earlier attempt with a larger heap had to be stopped to recover the environment. |
| Instrumentation / app startup | NOT RUN | No Android device/emulator configured. |
| Release AAB | BLOCKED | `:app:bundleRelease` stopped at the existing signing guard because the release signing configuration is absent. No keystore was generated or changed. |
| Public Terms route | FAIL | Before deployment, both `https://ningshingche.com/terms-of-use/` and the existing GitHub Pages URL returned HTTP 404. The custom-domain website is not in this repository. |

## H. Remaining actions

1. Complete and test all-user block filtering, direct navigation and interaction
   enforcement, including previously cached data and account switching.
2. Add server-side current-Terms enforcement to the other UGC publishing paths;
   carefully preserve anonymous comments or redesign consent and attribution.
3. Complete report validation and abuse protection for legacy target types;
   implement full moderator decisions, reasons, content actions and audit, plus
   self-approval prevention across the two identity systems.
4. Stage and verify all migrations/RLS/role grants and all UI flows with real
   Supabase sessions; do not apply unreviewed changes to production.
5. Deploy the Terms page to the independently managed `ningshingche.com` host,
   check HTTP 200 at the requested route, and coordinate its URL/version with the
   database and app. Deploy the dashboard Pages route and verify it separately.
6. Configure the existing release signing and Google services privately in the
   build environment; run debug/unit/instrumentation and signed AAB builds on a
   machine with sufficient memory. Do not paste secrets into chat or replace the
   existing signing key. Run device and Google Play Console closed-test checks.
7. Rotate the previously committed ImgBB credential and the PATs shared in chat.
   Changing `.env.example` does not remove a credential from Git history.
8. Have a Bishnupriya speaker translate the new Bengali-fallback strings and
   publish the translations through the existing dashboard.

## I. Final release assessment

**Requires additional fixes.** The core blocking and moderation requirements
are incomplete, other UGC is not server Terms-gated, the required public URL is
currently unavailable, and Android builds/runtime have not been validated.
