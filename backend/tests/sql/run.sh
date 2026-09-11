#!/usr/bin/env bash
# Runs migrations 024 and 025 against a throwaway PostgreSQL cluster, in both
# orders, twice each, and then exercises what they create.
#
#   bash backend/tests/sql/run.sh
#
# Needs a local PostgreSQL (`initdb`, `pg_ctl`, `psql`). Nothing here touches the
# production database: the cluster lives in a temp directory and is stopped on
# exit. This is not part of `node --test` — it is the check to run after editing
# anything in `backend/supabase/migrations/`.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS="$HERE/../../supabase/migrations"
FIXTURE="$HERE/fixture.sql"
PORT="${PG_TEST_PORT:-55432}"
DATA="$(mktemp -d)/pgdata"
LOG="$(mktemp -d)/pg.log"

if ! command -v initdb >/dev/null && [ -d /usr/lib/postgresql ]; then
  PATH="$PATH:$(ls -d /usr/lib/postgresql/*/bin | tail -1)"
  export PATH
fi

cleanup() { pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; }
trap cleanup EXIT

initdb -D "$DATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATA" -l "$LOG" -o "-k /tmp -p $PORT" start >/dev/null 2>&1
sleep 1

psql() { command psql -h /tmp -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

fail=0
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=1; }

# --- each migration on its own, from an empty fixture ------------------------
for file in 024_uploader_and_public_profile.sql 025_content_views.sql; do
  step "$file alone"
  psql -c "drop database if exists alone" >/dev/null 2>&1 || true
  psql -c "create database alone" >/dev/null
  psql -d alone -f "$FIXTURE" >/dev/null
  if psql -d alone -f "$MIGRATIONS/$file" >/dev/null 2>&1; then
    ok "applies without the other file"
  else
    bad "applies without the other file"
    psql -d alone -f "$MIGRATIONS/$file" 2>&1 | tail -4 | sed 's/^/        /' || true
  fi
done

# --- both orders, then both again (idempotency) ------------------------------
for order in "024 025" "025 024"; do
  for pass in 1 2; do
    step "order $order (pass $pass)"
    psql -c "drop database if exists ordered" >/dev/null 2>&1 || true
    psql -c "create database ordered" >/dev/null
    psql -d ordered -f "$FIXTURE" >/dev/null
    for n in $order; do
      file="$(ls "$MIGRATIONS" | grep "^$n")"
      if psql -d ordered -f "$MIGRATIONS/$file" >/dev/null 2>&1; then
        ok "$file"
      else
        bad "$file"
        psql -d ordered -f "$MIGRATIONS/$file" 2>&1 | tail -4 | sed 's/^/        /' || true
      fi
    done
  done
done

# --- what the migrations are for --------------------------------------------
# Rows that already exist before the migration (the backfill case) are inserted
# first; the rows the trigger has to serve are inserted afterwards.
step "behaviour"

psql -c "drop database if exists behaviour" >/dev/null 2>&1 || true
psql -c "create database behaviour" >/dev/null
psql -d behaviour -f "$FIXTURE" >/dev/null

READER=11111111-1111-1111-1111-111111111111
BLOG=22222222-2222-2222-2222-222222222222
TRACK=33333333-3333-3333-3333-333333333333
NEW_TRACK=44444444-4444-4444-4444-444444444444

psql -d behaviour <<SQL >/dev/null
insert into public.profiles (id, name, avatar_url) values ('$READER', 'পরীক্ষা পাঠক', 'https://example.test/a.png');
insert into public.blogs (id, title, slug, status, image, published_date) values ('$BLOG', 'পাঠকের নিবন্ধ', 'reader-article', 'Publish', 'https://example.test/c.png', current_date);
insert into public.submitted_blogs (user_id, converted_blog_id, status) values ('$READER', '$BLOG', 'Published');
insert into public.music_tracks (id, title, artist, file_storage_path, duration_seconds, love_count, user_id) values ('$TRACK', 'পাঠকের গান', 'গায়ক', 'reader/track.mp3', 200, 3, '$READER');
SQL

psql -d behaviour -f "$MIGRATIONS/$(ls "$MIGRATIONS" | grep '^024')" >/dev/null
psql -d behaviour -f "$MIGRATIONS/$(ls "$MIGRATIONS" | grep '^025')" >/dev/null

# the uploader name is backfilled onto a row that predates the migration
name="$(psql -d behaviour -tAc "set request.jwt.claim.sub = '$READER'; set role anon; select uploader_name from public.music_tracks where id = '$TRACK'")"
[ "$name" = "পরীক্ষা পাঠক" ] && ok "uploader name backfilled for an upload that predates it" \
  || bad "backfill (got '$name')"

# a new upload is credited without the client sending anything
psql -d behaviour -c "insert into public.music_tracks (id, title, user_id) values ('$NEW_TRACK', 'নতুন গান', '$READER')" >/dev/null
new_name="$(psql -d behaviour -tAc "select uploader_name from public.music_tracks where id = '$NEW_TRACK'")"
[ "$new_name" = "পরীক্ষা পাঠক" ] && ok "a new upload is credited by the trigger" \
  || bad "new upload credit (got '$new_name')"

# and a rename follows through to what was already uploaded
psql -d behaviour -c "update public.profiles set name = 'নতুন নাম' where id = '$READER'" >/dev/null
renamed="$(psql -d behaviour -tAc "select uploader_name from public.music_tracks where id = '$TRACK'")"
[ "$renamed" = "নতুন নাম" ] && ok "renaming a reader renames their uploads" \
  || bad "rename follow-through (got '$renamed')"

# a guest counts once per item, a signed-in reader once per item
as_guest() { psql -d behaviour -tAc "set role anon; set request.jwt.claim.sub = ''; select public.$1;"; }
as_reader() { psql -d behaviour -tAc "set role anon; set request.jwt.claim.sub = '$READER'; select public.$1;"; }

first="$(as_guest "record_content_view('blog', '$BLOG', 'device-abc-123')")"
second="$(as_guest "record_content_view('blog', '$BLOG', 'device-abc-123')")"
[ "$first" = "1" ] && [ "$second" = "1" ] && ok "a repeat view is not counted twice" \
  || bad "repeat view dedupe (got $first then $second)"

reader_first="$(as_reader "record_content_view('music', '$TRACK', '')")"
[ "$reader_first" = "1" ] && ok "a signed-in play counts" || bad "signed-in play (got $reader_first)"

totals="$(psql -d behaviour -tAc "select public.user_view_totals('$READER')")"
echo "$totals" | grep -q '"article_views": 1' && ok "totals sum the article view" || bad "totals: $totals"

series="$(psql -d behaviour -tAc "select count(*) from public.user_view_series('$READER', 30)")"
[ "$series" = "30" ] && ok "series returns every day, empty ones included" || bad "series rows (got $series)"

profile="$(psql -d behaviour -tAc "select public.public_profile('$READER')")"
echo "$profile" | grep -q 'নতুন নাম' && ok "public profile returns the current name" || bad "profile: $profile"
echo "$profile" | grep -q 'reader-article' && ok "public profile lists the published article" || bad "profile article missing"
echo "$profile" | grep -q 'পাঠকের গান' && ok "public profile lists the song" || bad "profile song missing"

# the trigger has to survive a delete, and only a delete
psql -d behaviour -c "delete from public.content_views where content_type = 'blog' and content_id = '$BLOG'" >/dev/null
after="$(psql -d behaviour -tAc "select views_count from public.blogs where id = '$BLOG'")"
[ "$after" = "0" ] && ok "deleting a view decrements the total" || bad "delete branch of the trigger (got $after)"

printf '\n'
if [ "$fail" = "0" ]; then
  printf '\033[32mAll migration checks passed.\033[0m\n'
else
  printf '\033[31mSome migration checks FAILED.\033[0m\n'
fi
exit "$fail"
