# UGC implementation report

## Current continuation — 2026-11-21

**PARTIAL — requires additional fixes; not closed-testing-ready.** The historical
baseline below documents the earlier commit, not the final state after migration
043. Where it differs, this continuation section supersedes it. Nothing here was
applied to Supabase or confirmed deployed. Commits through `fd20f0b` were pushed to GitHub `main`; the Pages workflow may run automatically, but its outcome has not been verified.

| Area | Status | Current evidence and limitations |
|---|---|---|
| Account Terms and article submission | PARTIAL | 041/042 retain server-derived, version-bound acceptance and Pending article submission. Fixture passed; real Supabase and Android not verified. Authenticated comments, forum, replies and music are still not server Terms-gated. Anonymous comments retain their existing contract but do not yet have the requested server-verifiable guest consent design. |
| Blocks | PARTIAL | Existing private block/unblock and UI retained. Blocking does not comprehensively filter reads, caches, notifications, interactions or direct navigation; forum SECURITY DEFINER reads need specific attention. |
| Reports | PARTIAL | New 043 requires a signed-in JWT for every type, validates reasons/lengths and existing accessible database targets, derives authors, rejects self-reporting where attributed, serializes per-account duplicate/quota checks, and caps new reports at 30 per rolling 24 hours. Legacy guest reporting is disabled rather than trusting spoofable device IDs; app shows a sign-in error. The AI answer has no server record: its supplied ID cannot be verified and carries no answer text, so AI reporting is not fully hardened or reviewable. Some music visibility limitations depend on actual schema. Existing reports are retained without retroactive corrections. |
| Human moderation | PARTIAL | 043 adds an authorized dashboard RPC with review, dismissal, resolution and reason-required transactional unpublish of article, comment, discussion and reply; it records authenticated staff UUID, target, prior/new status, reason and server timestamp. Separate article/comment permissions required. Other editorial-page writes, pending rejection, warnings/restrictions and all approval actions are not comprehensively audited. No reliable staff-reader identity mapping/self-approval prevention exists. Profile, music and AI removal are unsupported. |
| Real Supabase/staging | NOT RUN | Only a simplified, disposable PostgreSQL 17 fixture with mocked identities. See `backend/tests/UGC_STAGING_RUNBOOK.md`; no staging credentials or authorized staging project were available. |
| Local PostgreSQL tests | PASS | Fresh fixture applied 040–042, passed previous checks, applied 043, tested report targets, impersonated owner, duplicate, invalid target/reason, guest and direct update denial, unauthorized moderator, reason enforcement, article-independent discussion unpublish/audit, status transition and sequential 30/day cap; 043 reapplied. It is not a real schema or real JWT test; concurrency and every content branch remain unverified. |
| Dashboard/Node regression | PASS | Full Node/jsdom suite: 677 tests passed, 0 failed, 0 skipped (source and mock tests; not real browser or Supabase end-to-end). |
| Android debug and unit tests | BLOCKED | The pre-existing worktree mode change makes `./gradlew` fail permission denied; preserved as requested. Running via `bash ./gradlew` failed because the current environment has Java 11 and Gradle 9.3.1 requires Java 17+. Android SDK is not present. The earlier environment with JDK/SDK reached Kotlin compilation but failed with a 512 MB heap OOM; no APK or unit test pass. |
| Android release and devices | BLOCKED | Earlier release AAB failed the existing signing guard: original signing configuration absent. No keys changed or created. Device/emulator tests NOT RUN. |
| Terms URLs | FAIL | Independently rechecked `https://ningshingche.com/terms-of-use/` and `https://sisir-sinha.github.io/ningshingche/terms-of-use/`: both HTTP 404. The workflow builds `backend/` as Pages root; custom-domain hosting is independent. Responsive/accessibility verification in a real browser NOT RUN. |
| Localization | PARTIAL | Five Bengali/English/Bishnupriya CSVs each have 1,016 unique keys, no duplicates, and matching key sets. Bengali fallback in Bishnupriya remains pending native-speaker review; equality is not translation quality. |
| Secret hygiene | PARTIAL | No values printed. Earlier exposed ImgBB credential remains in Git history; rotation is required. The PATs previously supplied must be revoked/rotated. Broad import-file scan hits were not matched by narrower GitHub PAT or quoted credential-assignment patterns; this is not proof those files or history contain no secrets. No history rewrite or force push. |
| Push / deployment | PARTIAL | Commits through `fd20f0b` were pushed to GitHub `main`. GitHub Pages may deploy from that push; deployment and public HTTP status after the push have not been verified. No database migrations were applied. |

### Continuation files

- `backend/supabase/migrations/043_report_validation_and_decisions.sql`: additive
  reporting validation, reasoned decision RPC, audited unpublish actions and
  removal of direct report-update grants. No automatic deletion.
- `backend/assets/js/reports.js`: calls the RPC, asks for a reason, offers
  explicit unpublish in the opened report and shows decision reason.
- `app/src/main/java/com/ningshingche/app/data/portal/PortalRepository.kt` and
  `app/src/main/java/com/ningshingche/app/ui/components/ContentSafetySheet.kt`:
  no report device ID; sign-in refusal shown with existing localized text.
- `backend/tests/sql/ugc-043-setup.sql`, `ugc-043-checks.sql`: disposable tests.
- `backend/tests/reports-queue.test.cjs`, `backend/tests/README.md`: updated
  server-attributed decision assertions and fixture instructions.
- `backend/tests/UGC_STAGING_RUNBOOK.md`: operator-only staging checklist.
- `UGC_IMPLEMENTATION_REPORT.md`: this continuation. The pre-existing mode-only
  `gradlew` modification is not part of the commit.

### Migration and release cautions

Apply 043 **only after** verifying prerequisites and actual schema in disposable
staging. The old dashboard's direct PATCH no longer works after 043; release the
matching dashboard in coordination. Older guest clients will no longer be able to
report; anonymous commenting is not changed by 043. 042's old consent RPC revocation
also requires coordinated app rollout. Reapplying 042 after 043 restores direct
report update grants, so do not do that; if testing, 043 must be re-applied last.
No production reset, content deletion, automatic moderation, signing-key change,
or history rewrite was performed. Real role grants, policies, JWT sessions,
trigger behavior and all branches require staging and device validation before
any production change.

### Required next actions

1. Complete server Terms enforcement for every UGC path and design explicit,
   secure guest comment consent without silently breaking anonymous commenting.
2. Implement comprehensive account-specific block filtering, cache invalidation,
   direct navigation and interactions, including SECURITY DEFINER forum paths.
3. Complete and test AI report validation/review, live concurrency and target
   checks; implement the missing moderation actions/audit and a proven identity
   mapping that prevents self-approval.
4. Run the staging runbook with authorized disposable Supabase identities; do not
   share secrets in chat. Rotate the exposed ImgBB key and all PATs shared in chat.
5. Deploy and independently verify both Terms URLs; review accessibility,
   responsiveness and native translations. Run the full Android build and device
   regression with JDK 17+, Android SDK, sufficient RAM and the original signing
   configuration. Google Play compliance has not been established.

---

## Historical baseline (before continuation / 043)


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
