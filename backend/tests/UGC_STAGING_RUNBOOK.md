# UGC staging validation — operator procedure

**NOT RUN.** This procedure is for an independently provisioned, disposable
Supabase staging project, never production. The local fixture in README.md is
not a Supabase integration test. Obtain authorization, verify the staging project
reference in the Supabase console, confirm a tested backup/restore plan, and
isolate synthetic identities and content. Do not paste tokens, connection strings,
passwords or staff sessions into chat, logs, shell history, screenshots or issues.
Use secure local credential handling, turn shell tracing off, and do not use
service-role credentials in the app. Do not run fixture setup files in Supabase:
they create simplified auth objects and roles.

1. Inventory the staging schema and migration history without making changes.
   Confirm the project has the actual prerequisite migrations and schema, current
   status constraints, RLS, grants, dashboard roles and staff-session functions.
   Capture policy/function definitions securely, excluding identity data and secrets.
   Do not reapply 040/041 indiscriminately: older migrations can change grants or
   policies and 042 deliberately revokes the earlier acceptance RPC.
2. Review 040, 041, 042 and 043 as a chain against the staging inventory. Apply
   missing migrations in numeric order only after review, using the Supabase
   migration tooling/SQL editor with operator-managed credentials. Stop on any
   error. Reapplying 042 **after 043** re-grants report updates, so do not do so;
   if testing reapplication, reapply 043 last and recheck effective privileges.
   Coordinate 042+043, dashboard, Android and hosted Terms releases: older clients
   cannot accept the new Terms or submit guest reports after the changes, and the
   old dashboard cannot update the queue after 043. Keep a tested rollback plan
   that does not delete reports, content, acceptance or audit history. Migration
   043 has not been applied to a live project.
3. With synthetic users A and B and separate reader JWTs, verify direct REST as
   anon and authenticated: current/stale Terms acceptance, spoofed consent user
   and timestamp, direct article insert/update bypass, Pending status and author
   attribution, and legacy client behavior. Check comments, discussion, reply and
   music separately: their server-side Terms gates are currently **not complete**;
   do not record a pass just because the UI blocks posting. Check anonymous
   commenting still works according to `app/COMMENTING.md`.
4. File reports for each real synthetic target with A's JWT, including malformed,
   unpublished, missing, self-owned, forged target/reporter IDs, long note and
   invalid reason. Verify one duplicate, a rolling 30-per-24-hour limit (including
   concurrent calls), no report or audit reads by ordinary/anonymous users, and
   rejected anonymous writes. AI output is only a client-local opaque reference;
   existence/content cannot currently be verified, and AI report detail is not
   captured. Verify moderation staff understand this limitation.
5. Test separately a valid dashboard staff session with Forum permission, a
   staff session without it, an expired/revoked session and a fabricated header.
   Verify direct table PATCH fails, review requires open status, terminal decisions
   require a reason, and removal requires the target-specific Blogs/Comments
   permission where relevant. Check unpublish and audit commit together, with
   actor, target, before/after, reason and server timestamp; test rollback on
   errors and competing decisions. Repeat across article, comment, discussion
   and reply. Music/profile/AI removal is not supported by this RPC. Audit past
   actions separately: 043 only records decisions made through the new workflow.
6. With A and B, test private block/unblock and inspect all read surfaces, direct
   URLs, cross-account caches and notifications. These are known incomplete;
   record each failure rather than assuming RLS protects SECURITY DEFINER reads.
   Test submission approval and self-approval only after a proven authoritative
   mapping exists between dashboard staff and reader identities; no mapping exists
   yet and this requirement is not met.
7. Exercise Android auth, consent, publishing, comments, forum, music, profiles,
   reports, blocks, bookmarks, notifications, reader and deletion on actual
   devices; test language changes, account switching and offline/cache behavior.
   Separately test dashboard accessibility/responsive views and audit history.
   Capture status/evidence without personal data. Remove only synthetic staging
   data after the owner authorizes cleanup; never delete production data.

Record PASS, PARTIAL, FAIL, BLOCKED or NOT RUN for each item, with exact versions,
role and timestamp, and treat incomplete paths as release blockers. Validate the
custom domain and Pages URL independently with HTTP 200 after deployment.

## Phase 3 addendum (2026-11-21; supersedes the old 044-unaware notes)

**NOT RUN on Supabase.** 044–049 remain undeployed and are **not release-ready**.
The old step 3's statement that no forum/music/comment insert gate exists predates
044. 044 enforces current account Terms and posting restrictions on its covered
inserts, but deliberately permits anonymous comments without server-verifiable
consent; signed-in JWT propagation, edit coverage and old-client behavior still
need real integration testing. No claim of full UGC coverage follows from 044.

Before any authorized disposable staging experiment, inventory the effective
functions/views/policies, status constraints, dashboard session roles, historical
migrations 029–036 and 040–043, and representative synthetic pre-existing rows.
Review and apply 044, 045, 046, 047, 048, 049 in numeric order; coordinate client
and dashboard versions and stop on incompatibility. Never apply the fixture SQL
in Supabase. Check `pgrst` schema refresh and effective grants after each step.

* 044: test own and forged identities, stale/current consent and every insert;
  authorized staff exemptions, `suspend` meaning **posting restriction, not login
  suspension**, scopes/expiry/lift, race/idempotency and accepted appeal with no
  implicit lift. Verify legitimate staff and account-deletion operations.
* 045/048: report synthetic content then edit it; ensure bounded historical
  evidence is staff-only. A successful staff evidence read must atomically record
  the real dashboard actor and report in 048; unauthorized reads and no-evidence
  results must not expose snapshots. Check RLS, sequence privileges, transaction
  rollback and concurrent reads. This audit has no staff-facing viewer or approved
  retention/deletion policy. Test privacy, retention and deletion with counsel;
  do not invent a retention period or purge records.
* 046: check versioned, audited settings and permissions. Policy values are
  advisory, not enforcement or unified reason/appeal validation.
* 047: with separate A/B JWTs, check published/unpublished and blocked/unblocked
  rows through direct REST and every forum definer RPC, pagination/search and
  detail links; verify replies to a thread or parent blocked in **either**
  direction fail, while authorized staff and own content work. Test reaction,
  analytics/counts, activity and notifications separately: these are not fully
  filtered by 047. Test account switches and cached UI data. Non-forum paths are
  not covered. Never call this complete blocking.
* 049: stale/current Terms and active/expired/lifted restrictions for reader
  discussion title/body/cover and reply body edits via direct REST and the 034
  definer RPC; test staff edits, counter updates, moderation, and account deletion.
  This does not cover all UGC/profile/AI edits or non-JWT privileged code paths.
* Verify approval with a missing/erroring RPC produces no client fallback writes.
  004's RPC still needs server-side eligibility, repeat/concurrency protection,
  audited decisions and a trustworthy staff-reader mapping for self-approval.
  Reject and other editorial paths remain direct/unified audit incomplete.

Rollback must be rehearsed on disposable staging and independently reviewed:
047's named restrictive policies and reply trigger can be removed and its two
views restored from the matching effective pre-047 definitions (032) only after
backup and dependency/grant review; this intentionally removes protections. 048
can restore the 045 `dashboard_report_evidence` function while **retaining** its
audit table/data. 049's named triggers can be disabled/removed without deleting
rows, restoring the previous edit behavior. Never blindly drop evidence, audit,
consent, content, action or appeal data. Rollback of 044–046 requires a separately
reviewed compatibility/security plan and preservation of their records. Record
who approved the plan, before/after definitions and results securely; no production
rollback, migration or credential action has been performed here.

## Migration 050: authenticated article comments

Migration 050 supersedes the earlier Phase 2 guest-comment behavior described
above **only after it is deployed**. It leaves old comments and public reading
untouched and keeps the dashboard's authorized comments staff exception. Do not
apply it to production without a verified, restorable backup, a recovery plan,
and staging review. It requires migrations 004 and 006; if 044 is deployed,
its terms and moderation guards remain in force.

Before staging, inventory actual `pg_policies`, table grants, triggers and any
SECURITY DEFINER comment-writing functions, including any added outside this
repository. Preserve the exact existing policy definitions for an approved
rollback; do not assume repository migrations match production. Verify the app
version and dashboard permissions on staging. Test with real Supabase JWTs and
RLS, not only the disposable fixture:

1. Guests can read approved historical comments, but anonymous direct REST
   inserts and anonymous-auth JWT inserts are denied, including with a forged
   `user_id` or an extra permissive policy.
2. A signed-in reader can insert their own `Unpublish` comment, but cannot
   publish directly, omit/forge `user_id`, or bypass existing terms/restriction
   guards. Confirm session expiry and sign-out during a submission fail safely.
3. An authorized dashboard operator retains intended comments permissions;
   guests and dashboard operators without that permission cannot use the staff
   exception. Test old app versions and any non-app clients.
4. Apply the migration twice on staging, review effects and logs, and exercise
   the backup restore and approved rollback plan before production deployment.

`backend/tests/sql/comment-login-fixture.sql` exercises the migration twice in a
throwaway PostgreSQL with simplified auth/dashboard functions and a deliberately
broad old policy. It does not prove real Supabase grants, JWT verification,
dashboard sessions, triggers or application behavior.
