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
