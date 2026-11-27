#!/usr/bin/env bash
# Creates its own isolated cluster; never use this on Supabase or shared data.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../../supabase/migrations"
if ! command -v initdb >/dev/null; then
  PATH="$PATH:$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
fi
WORK="$(mktemp -d "${TMPDIR:-/tmp}/nc-phase2.XXXXXXXX")"
mkdir "$WORK/socket"
cleanup() { pg_ctl -D "$WORK/db" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
initdb -D "$WORK/db" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
# A private socket and no TCP listener prevent accidental contact with another DB.
pg_ctl -D "$WORK/db" -l "$WORK/server.log" -o "-c listen_addresses='' -k $WORK/socket -p 55462" -w start >/dev/null
export PGHOST="$WORK/socket" PGPORT=55462 PGUSER=postgres PGDATABASE=postgres
for file in \
  "$HERE/ugc-fixture-setup.sql" \
  "$MIG/040_content_safety.sql" \
  "$MIG/041_terms_acceptance_and_secure_article_submission.sql" \
  "$MIG/042_ugc_consent_reporting_audit.sql" \
  "$HERE/ugc-fixture-checks.sql" \
  "$HERE/ugc-043-setup.sql" \
  "$MIG/043_report_validation_and_decisions.sql" \
  "$HERE/ugc-043-checks.sql" \
  "$HERE/ugc-044-setup.sql" \
  "$MIG/044_account_moderation_and_ugc_guards.sql" \
  "$HERE/ugc-044-checks.sql" \
  "$MIG/045_report_evidence.sql" \
  "$HERE/ugc-045-checks.sql" \
  "$MIG/046_moderation_policy_catalog.sql" \
  "$HERE/ugc-046-checks.sql" \
  "$MIG/046_moderation_policy_catalog.sql" \
  "$MIG/044_account_moderation_and_ugc_guards.sql" \
  "$MIG/045_report_evidence.sql" \
  "$HERE/ugc-047-setup.sql" \
  "$MIG/047_forum_visibility_and_interaction.sql" \
  "$HERE/ugc-047-checks.sql" \
  "$MIG/047_forum_visibility_and_interaction.sql" \
  "$MIG/048_evidence_access_audit.sql" \
  "$HERE/ugc-048-checks.sql" \
  "$MIG/048_evidence_access_audit.sql" \
  "$MIG/049_forum_edit_guards.sql" \
  "$HERE/ugc-049-checks.sql" \
  "$MIG/049_forum_edit_guards.sql" \
  "$HERE/ugc-050-setup.sql" \
  "$MIG/050_authenticated_article_comments.sql" \
  "$MIG/050_authenticated_article_comments.sql" \
  "$HERE/ugc-050-checks.sql" \
  "$MIG/051_profile_identity_requirement.sql" \
  "$MIG/051_profile_identity_requirement.sql" \
  "$HERE/ugc-051-checks.sql"; do
  printf 'Testing %s\n' "$(basename "$file")"
  psql -X -q -v ON_ERROR_STOP=1 -f "$file" > /dev/null
done
echo 'PASS: disposable Phase 2–3 PostgreSQL fixture (not Supabase)'
