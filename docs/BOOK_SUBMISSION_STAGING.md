# Reader book submissions: staging and deployment checklist

**Not deployed.** The live project did not have `has_accepted_current_terms()` or
`submit_reader_article` when inspected. Do not run 052 in production yet. Before
any database change, obtain and verify a restorable backup, exercise the actual
migration order and rollback plan on a staging clone, review drift and grants,
and test the authenticated client plus dashboard. In particular, review 041 and
044 prerequisites and their compatibility with the real project's Terms RPCs.
The migration refuses to install if the required functions are absent.

The pending queue is hidden by RLS with no direct client grants. Submission RPCs
require a user session, current Terms, unrestricted publishing and a complete
profile. The books-permission dashboard RPC reviews the row under a lock and
publishes once into `pdf_books`. Self-approval is blocked when the account IDs
match. Database checks validate submitted URL hosts, not file bytes; the editor
must verify the PDF, rights, metadata and content before approval. The local
fixture exercises these boundaries using mocks, not real Supabase Auth or RLS.

**Hosting and privacy:** both requested hosts are public third parties. A pending
file is *not confidential*: anyone with its URL may access it before approval.
The client warns about this. ImgBB's published API is image-only; a small PDF is
attempted there but its returned URL is accepted only after a PDF signature
check; otherwise it falls back to Satoru. Satoru states a 200 MB service limit;
the app does not add a PDF size cap but must report host failures. This has not
been verified by uploading a real file to either service in this change.
Neither host provides a deletion mechanism in this workflow. Rejected books,
failed submissions, successful-but-unrecorded uploads, and deleted accounts can
leave externally hosted files behind. Do not treat this as privacy-safe storage
or enable it for sensitive documents. Review retention, account deletion, abuse,
copyright, orphan cleanup and administrative auditing before production launch.

Test: sign in and accept current Terms, send a small and a large valid PDF, verify
fallback and source bytes, reject a non-PDF, approve and reject with a permitted
other reviewer, confirm atomicity and no public listing before approval, retry a
lost response, exercise denied users and refreshed sessions, then verify the app
shows pending/published/rejected status. Also test private/offline cache boundaries.
The "25 MB" threshold is binary MiB, strictly below 25 × 1024 × 1024 bytes.

For a disposable local PostgreSQL instance, create a fresh empty database and run
`backend/tests/book-submissions-setup.sql`, then migration 052, then
`backend/tests/book-submissions-fixture.sql` using `psql -v ON_ERROR_STOP=1`.
The setup creates only mock tables, roles and auth functions; never run it on
Supabase. The test transaction rolls back its rows.
