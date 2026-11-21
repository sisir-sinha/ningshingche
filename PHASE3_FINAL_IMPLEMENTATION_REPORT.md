# Phase 3 implementation and release-readiness report

Date: 2026-11-21. Repository: `ningshingche`. Classification: **PARTIAL — NOT
READY FOR CLOSED TESTING / PRODUCTION RELEASE.** This is not Play policy
certification and no Play declarations were submitted. Historical migrations
040–046 are preserved; **044–049 have not been applied to a live project**.
The local fixture is not Supabase. No production database, hosting, signing or
credential rotation was changed. This report updates, rather than replaces,
`UGC_IMPLEMENTATION_REPORT.md` and `ADVANCED_MODERATION_IMPLEMENTATION_REPORT.md`.

## What was implemented in this continuation

1. **047, partial forum blocking and publication visibility.** The existing
   privileged forum projection views exclude unpublished content, hidden parent
   discussions, and authors blocked by the current signed-in reader. Restrictive
   direct-table SELECT policies compose with existing permissions, retaining
   dashboard forum/analytics access. A reply-insert guard checks the authenticated
   author against either-direction blocks involving the thread or parent author.
   No client-provided actor ID is trusted for this check. This is not complete
   blocking: direct interaction other than reply, counters, activity, notification,
   cache, other UGC and identity-switch paths are not comprehensively covered.
2. **048, evidence access audit.** A successful 045 evidence RPC read inserts
   the actual dashboard staff ID, report ID and server time in the same transaction.
   The audit table and identity sequence have RLS and no anon/authenticated direct
   grants. No UI for reviewing the audit or legally approved retention schedule
   exists. Absent evidence and unauthorized calls do not produce an audit entry.
3. **049, selected forum edits.** JWT-authenticated reader changes to discussion
   title/body/cover and reply body, including 034's definer edit RPC, require the
   original reader, current account Terms and no active forum restriction. Staff
   with Forum access retain editing. Counter/status-only operations are not treated
   as content edits; no-JWT privileged maintenance remains controlled by existing
   privileges and therefore requires separate review. This is not a universal edit
   guard, and legitimate staff/deletion compatibility needs real-schema testing.
4. **Approval dashboard:** removed its multi-request direct-write fallback. An
   unavailable/failing approval RPC now fails rather than partially creating an
   author/blog/submission. The existing server RPC itself has not gained full
   self-approval protection, auditing or repeat-approval checks; rejection and other
   direct paths are still not unified. The client-side change alone is not security.
5. Extended disposable SQL fixture/reapplication tests, a dashboard source test,
   staging/rollback guidance and these reports. No translations were added, and
   existing Bengali/English localization does not constitute complete localization.

## Write-surface and moderation inventory (source review, not a live-schema proof)

| Surface | Current source boundary and unresolved work |
|---|---|
| Articles | 041 `submit_reader_article` binds account and consent; 044 guards inserts. Reader edits, staff/editorial conversion, rejection, revision, restore and unpublish need comprehensive enforcement/audit. 004 `approve_submission` locks a row but does not verify already-converted status or self-approval server-side. Separate dashboard staff and reader identity domains have no trustworthy mapping. |
| Comments | Direct REST insert, 044 guard for authenticated users; guests still have no server-verifiable explicit consent or meaningful replay/abuse control. Signed-in Authorization propagation and all edit/interaction paths need real testing. |
| Forum | 030/034 SECURITY DEFINER create/reply/edit and direct tables. 044 inserts, 047 reply block guard and 049 selected authenticated edits add defenses; reactions, guest identity, edit variants, counts, notification and caches remain incomplete. |
| Music | 044 insert guard; edits, upload/storage, direct reads, block enforcement and ownership transitions require review. |
| Profiles | Profile update paths and public-profile/profile-items RPCs are not comprehensively gated or filtered. Account deletion cascades/detaches specified objects under 039; moderation evidence/actions contain separate identity data without an agreed lifecycle policy. |
| AI | There is no provable server-generated persistent answer reference. Existing opaque client references are not verified evidence; no claim of server-validated AI reporting. |
| Reports/appeals | 043 has validated targets and decision audit for its supported workflow; 044 has own-history/appeal RPCs and staff decisions, but Android history/appeal UI and coherent 043/046 eligibility are missing. 045 evidence does not backfill old reports or verify AI references. |
| Other interactions | Reactions, likes, notifications, search, detail links, feeds, account-switch memory/cache and non-forum SECURITY DEFINER reads need an end-to-end RLS/definer review and tests. |

044 `suspend` is a time-limited **posting restriction**, not authentication/login
suspension. Warnings do not automatically restrict, policy 046 is advisory, and
appeal acceptance does not automatically lift a restriction. Reports are allegations,
not proof of a violation. Notification delivery for moderation events has not been
implemented. No server-aggregated complete statistics, unified paginated dashboard,
full browser accessibility testing or native Bishnupriya translation was added.

## Changed/new files in this continuation

* `backend/supabase/migrations/047_forum_visibility_and_interaction.sql` — forum
  views, restrictive SELECT policies and reply trigger.
* `backend/supabase/migrations/048_evidence_access_audit.sql` — protected access
  audit and transactional replacement of evidence RPC.
* `backend/supabase/migrations/049_forum_edit_guards.sql` — selective edit trigger.
* `backend/assets/js/submissions.js` — remove non-atomic approval fallback.
* `backend/tests/sql/run-ugc-phase2.sh`, `ugc-047-setup.sql`,
  `ugc-047-checks.sql`, `ugc-048-checks.sql`, `ugc-049-checks.sql` — isolated
  fixture additions and reapplication coverage.
* `backend/tests/submission-atomicity.test.cjs` — source-level fallback regression.
* `backend/tests/UGC_STAGING_RUNBOOK.md` — prerequisites, staging/rollback matrix.
* `UGC_IMPLEMENTATION_REPORT.md`, `ADVANCED_MODERATION_IMPLEMENTATION_REPORT.md`,
  `PHASE3_FINAL_IMPLEMENTATION_REPORT.md` — preserved history and current status.

The pre-existing mode-only worktree change to `gradlew` was left unstaged and
uncommitted. No package/version/signing settings or keystore were changed.

## Migration, RLS, grants and rollback

Review and stage only with authorization and prerequisites 029–036 and 040–046
confirmed against the **actual** schema, in numeric order. The new migrations use
transaction boundaries, explicit `pg_catalog, public` search paths on new definer
functions, explicit function grants/revokes, restrictive policies or ungranted
views, RLS for the audit table, and PostgREST schema refresh. Restrictive policies
cannot grant access. Review effective pre-existing permissive policies, view owner
semantics, security-definer callers and staff permission behavior on real Supabase.
No claim is made that all existing functions have safe grants/search paths. 047
intentionally changes reader-visible forum results and may affect legacy clients;
049 may alter previously permitted edits. 048 introduces retained audit data.

Rehearse data-preserving rollback on disposable staging: restore pre-047 effective
view definitions and grants, remove 047 policies/trigger; restore the 045 RPC while
retaining 048 audit rows; remove 049 triggers to recover previous edit behavior.
These rollbacks deliberately remove safeguards. Preserve consent, audit, evidence,
actions, appeals and user content; 044–046 need separate compatibility/security
rollback design. See the staging runbook for detailed verification and caveats.

## Test and verification results

| Requested check | Status | Evidence / limits |
|---|---|---|
| Prior history 040–046 preserved | PASS | Files unchanged; no migration reset. |
| Disposable PostgreSQL 040–049 and 044–049 reapplication | PASS | `bash backend/tests/sql/run-ugc-phase2.sh`; mocked auth/staff/partial schemas, not Supabase. |
| Forum RLS/view/interaction and selected edits | PARTIAL | Synthetic fixture covers blocked/unblocked/guest, unpublished, both-direction reply denial, selected edits and staff; not actual RPC integration, all surfaces, concurrency or devices. |
| Evidence audit privacy/authorization | PARTIAL | Fixture checks denial, staff attribution, absent evidence and reapplication. Retention/deletion and real JWT/RLS untested. |
| Backend/dashboard Node suite | PASS | 683 tests passed, 0 failed, 0 skipped; includes mocks, source tests and jsdom, not deployed browser E2E. |
| Dashboard atomic approval fallback | PARTIAL | Source regression verifies fallback removal. Server-side concurrent/repeat approval and independent direct API paths remain unprotected. |
| Real Supabase migration/RLS/grants/concurrency, rollback and representative existing data | NOT RUN | No authorized disposable staging supplied. |
| Android debug APK and unit tests | BLOCKED | JDK 17 and Android SDK installed. The build reached `compileDebugKotlin` but was stopped after severe memory pressure and a metaspace warning; no packaged APK or unit-test result was verified. Missing `google-services.json` was reported as a warning (the configured strategy is WARN), not established as the build failure. KSP also emitted an AWT exception. |
| Android device, account switches, notifications and accessibility | NOT RUN | No connected device or live service. |
| Signed release AAB | BLOCKED | Requires original authorized signing material; none created or replaced. |
| Website custom Terms | FAIL | 2026-11-21 HTTP `https://ningshingche.com/terms-of-use/` returned 404. GitHub Pages `https://sisir-sinha.github.io/ningshingche/terms-of-use/` returned 200. HTTP status is not legal or accessibility validation. |
| Secret hygiene | PARTIAL | Tracked filenames and limited token/private-key patterns checked without displaying values; not an exhaustive history or credential scan. Previously exposed GitHub PATs and ImgBB credential still require owner rotation/revocation. Service-role label hits alone do not establish secret exposure. No force-push/history rewrite. |
| Bengali/English/Bishnupriya | PARTIAL | Existing strings preserved; complete translations/device verification and native Bishnupriya review not performed. |
| Play declarations / external compliance | NOT RUN | No submissions or certification made. |

## Privacy, retention and operator actions

Evidence snapshots are bounded but may still contain personal information; older
reports lack snapshots. 048 logs successful evidence reads, but failed attempts are
not audited and privileged database access is outside its scope. Before deployment,
owner and counsel must choose a legal basis, retention/access schedule, deletion and
appeal/audit preservation design, including account deletion and staff identity
mapping. Do not automatically delete evidence or invent a legal retention period.
Use only synthetic test data and secure credential handling in staging.

Required before a closed test: complete server-authoritative consent/guest abuse
handling; comprehensive bidirectional blocking, interactions and cache isolation;
atomic audited moderation plus fail-safe server-enforced self-approval prevention;
Android history/appeals, moderation notifications, coherent policy catalog and
localization; evidence privacy/lifecycle design; safe AI provenance; accurate unified
admin UX; verified real staging, rollback, devices and build/signing; publish and
independently verify custom-domain Terms; revoke/rotate exposed credentials via
owner-authorized channels; address any Play policy requirements with the owner.
Never reuse an exposed token or overwrite original signing files.

## Git and delivery

After workspace restoration the Phase 3 changes were consolidated on the existing
GitHub Phase 2 commit `fa075a1` as `9507b6d`. That commit was pushed to GitHub
`main` and the remote tip was independently checked on 2026-11-21. Production
migrations were not run: the owner identified the project as live production and
has not verified a restorable backup. The unrelated `gradlew` mode change remains
uncommitted. Any later documentation-only commit follows `9507b6d` in Git history.
