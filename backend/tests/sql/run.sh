#!/usr/bin/env bash
# Runs the content migrations (024-029) against a throwaway PostgreSQL cluster,
# in several orders, twice each, and then exercises what they create.
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

# UTF8, like Supabase: the migrations carry Bengali literals and \uXXXX escapes,
# and a cluster in the machine's default encoding (often SQL_ASCII) cannot
# convert them.
initdb -D "$DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null 2>&1
pg_ctl -D "$DATA" -l "$LOG" -o "-k /tmp -p $PORT" start >/dev/null 2>&1
sleep 1

psql() { command psql -h /tmp -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

fail=0
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=1; }

# --- each migration on its own, from an empty fixture ------------------------
for file in 024_uploader_and_public_profile.sql 025_content_views.sql 026_contributors.sql 027_contributor_board_dashboard.sql 028_public_profile_details.sql 029_forum.sql; do
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
for order in "024 025 026 027 028 029" "025 024 026 027 028 029" "026 025 024 027 028 029" "027 026 025 024 028 029" "029 028 027 026 025 024" "028 029 024 025 026 027"; do
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

for n in 024 025 026 027 028 029; do
  psql -d behaviour -f "$MIGRATIONS/$(ls "$MIGRATIONS" | grep "^$n")" >/dev/null
done

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

# --- the lock on the new tables ----------------------------------------------
# Supabase's default privileges hand `anon` access to anything new in `public`,
# so a table that ends up here without RLS is exposed through the API. The SQL
# Editor warns about it when a create has no enable in the same script — this is
# the same check, run against the result instead of the text.
step "row level security"

for table in content_views reader_activity profile_locks forum_categories forum_discussions forum_replies; do
  [ "$table" = "profile_locks" ] && continue
  rls="$(psql -d ordered -tAc "select relrowsecurity from pg_class where relname = '$table' and relnamespace = 'public'::regnamespace")"
  [ "$rls" = "t" ] && ok "$table has RLS enabled" || bad "$table has RLS = '$rls'"
done

policies="$(psql -d ordered -tAc "select count(*) from pg_policies where schemaname = 'public' and tablename = 'content_views'")"
[ "$policies" = "0" ] && ok "content_views has no policies (definer functions only)" \
  || bad "content_views has $policies policies"

# --- contributors -------------------------------------------------------------
step "contributors"

as_anon() { psql -d behaviour -tAc "set role anon; set request.jwt.claim.sub = ''; select public.$1;" 2>&1; }
reader_call() { psql -d behaviour -tAc "set role authenticated; set request.jwt.claim.sub = '$READER'; select public.$1;" 2>&1; }

guest_result="$(as_anon "record_app_time(600)" || true)"
echo "$guest_result" | grep -qi "permission denied" && ok "a guest cannot report app time at all" \
  || bad "guest app time (got '$guest_result')"

recorded="$(reader_call "record_app_time(600)")"
[ "$recorded" = "600" ] && ok "a signed-in reader's time is recorded" || bad "record_app_time (got '$recorded')"

clamped="$(reader_call "record_app_time(99999)")"
[ "$clamped" = "4200" ] && ok "one call is clamped to an hour (600 + 3600)" || bad "clamp (got '$clamped')"

# The reader now has: 1 published article, 2 songs (the fixture's and the one the
# trigger test added), 1 comment, 2 views of their own work (the guest's article
# read and the reader's play both belong to the owner), 4200s of app time.
#   50 + 2x30 + 5 + 2x1 + 4200/120 = 50 + 60 + 5 + 2 + 35 = 152
psql -d behaviour -c "insert into public.comments (blog_id, content, user_id, status) values ('$BLOG', 'মন্তব্য', '$READER', 'Publish')" >/dev/null
points="$(reader_call "contributor_points('$READER')")"
for want in '"articles": 1' '"songs": 2' '"comments": 1' '"views": 2' '"seconds": 4200' '"points": 152'; do
  echo "$points" | grep -q "$want" && ok "score has $want" || bad "score missing $want: $points"
done

board="$(reader_call "contributor_leaderboard(20, null)")"
echo "$board" | grep -q 'নতুন নাম' && ok "the board names the reader" || bad "board: $board"
echo "$board" | grep -q '"points": 152' && ok "the board carries the monthly points" || bad "board points: $board"
echo "$board" | grep -q '"avatar_url"' && ok "the board carries the avatar for the card" || bad "board avatar missing"

gate="$(as_anon "contributor_leaderboard(20, null)" || true)"
echo "$gate" | grep -qi "permission denied\|signed-in" && ok "a guest is refused the board" || bad "gate (got '$gate')"

empty_month="$(reader_call "contributor_leaderboard(20, (timezone('utc', now())::date - 400))")"
echo "$empty_month" | grep -q '"contributors": \[\]' && ok "a month with no work is an empty board" || bad "empty month: $empty_month"

# --- what the public profile now carries --------------------------------------
step "profile details"

profile="$(psql -d behaviour -tAc "select public.public_profile('$READER')")"
echo "$profile" | grep -q '"designation"' && ok "the profile carries a designation" || bad "designation: $profile"
echo "$profile" | grep -q '"address"' && ok "the profile carries an address" || bad "address missing"
echo "$profile" | grep -q '"points": 152' && ok "the profile carries the lifetime points" || bad "profile points: $profile"
echo "$profile" | grep -q '"month_points"' && ok "and this month's" || bad "month points missing"

# most-read first — a second reader, so this adds nothing to the first one's
# score and the contributor checks further down still read their own numbers.
SECOND=66666666-6666-6666-6666-666666666666
psql -d behaviour <<SQL >/dev/null
insert into public.profiles (id, name) values ('$SECOND', 'দ্বিতীয় পাঠক');
insert into public.blogs (id, title, slug, status, image, views_count, published_date) values
  ('55555555-5555-5555-5555-555555555555', 'কম পঠিত', 'less-read', 'Publish', '', 5, current_date),
  ('66666666-6666-6666-6666-666666666666', 'বেশি পঠিত', 'most-read', 'Publish', '', 900, current_date);
insert into public.submitted_blogs (user_id, converted_blog_id, status) values
  ('$SECOND', '55555555-5555-5555-5555-555555555555', 'Published'),
  ('$SECOND', '66666666-6666-6666-6666-666666666666', 'Published');
SQL
first="$(psql -d behaviour -tAc "select public.public_profile('$SECOND') -> 'articles' -> 0 ->> 'title'")"
[ "$first" = "বেশি পঠিত" ] && ok "the article list leads with the most read" \
  || bad "views-first ordering (got '$first')"

# --- the forum ----------------------------------------------------------------
step "forum"

as_anyone() { psql -d behaviour -tAc "set role $2; set request.jwt.claim.sub = $3; select public.$1;"; }

overview="$(as_anyone "forum_overview(20)" anon "''")"
echo "$overview" | grep -q 'সাধারণ আলোচনা' && ok "a guest reads the categories" || bad "overview: $overview"
echo "$overview" | grep -q '"latest": \[\]' && ok "an empty forum says so honestly" || bad "empty latest"

posted="$(as_anyone "forum_create_discussion('general', 'পরীক্ষামূলক আলোচনা', 'আলোচনার মূল লেখা।')" authenticated "'$READER'")"
echo "$posted" | grep -q 'পরীক্ষামূলক আলোচনা' && ok "a signed-in reader opens a thread" || bad "create: $posted"
echo "$posted" | grep -q '"author_name": "নতুন নাম"' && ok "the thread carries its author" || bad "author missing: $posted"

refused="$(as_anyone "forum_create_discussion('general', 'অতিথির আলোচনা', 'হবে না।')" anon "''" 2>&1 || true)"
echo "$refused" | grep -qi "permission denied" && ok "a guest cannot open a thread" || bad "guest create (got '$refused')"

DISCUSSION="$(psql -d behaviour -tAc "select (public.forum_overview(20) -> 'latest' -> 0 ->> 'id')")"
units="$(psql -d behaviour -tAc "select public.forum_text_units(normalize('ছোট', NFC)) || ' ' || public.forum_text_units(normalize('ছোট', NFD))")"
[ "$units" = "2 2" ] && ok "a Bengali word counts the same however it is composed (NFC and NFD agree)" \
  || bad "text units (got '$units')"
short="$(as_anyone "forum_create_discussion('general', 'ক', 'লেখা')" authenticated "'$READER'" 2>&1 || true)"
echo "$short" | grep -qi "at least 4 characters" && ok "a one-character title is refused" || bad "title guard (got '$short')"
missing="$(as_anyone "forum_create_discussion('nonexistent', 'শিরোনাম লেখা', 'লেখা')" authenticated "'$READER'" 2>&1 || true)"
echo "$missing" | grep -qi "no such forum category" && ok "an unknown category is refused" || bad "category guard (got '$missing')"

reply="$(as_anyone "forum_reply('$DISCUSSION', 'প্রথম উত্তর।')" authenticated "'$READER'")"
echo "$reply" | grep -q 'প্রথম উত্তর' && ok "a signed-in reader replies" || bad "reply: $reply"

guest_reply="$(as_anyone "forum_reply('$DISCUSSION', 'অতিথির উত্তর')" anon "''" 2>&1 || true)"
echo "$guest_reply" | grep -qi "permission denied" && ok "a guest cannot reply" || bad "guest reply (got '$guest_reply')"

detail="$(as_anyone "forum_discussion('$DISCUSSION', true)" anon "''")"
echo "$detail" | grep -q '"views_count": 1' && ok "opening a thread counts one view" || bad "view count: $detail"
echo "$detail" | grep -q '"replies_count": 1' && ok "the reply counter is kept by the trigger" || bad "reply count: $detail"
echo "$detail" | grep -q 'প্রথম উত্তর' && ok "the replies come back with the thread" || bad "replies missing"

again="$(as_anyone "forum_discussion('$DISCUSSION', false)" anon "''")"
echo "$again" | grep -q '"views_count": 1' && ok "a refresh can decline to count" || bad "no-count refresh: $again"

found="$(as_anyone "forum_search('পরীক্ষামূলক', 30)" anon "''")"
echo "$found" | grep -q '"total": 1' && ok "search finds the thread" || bad "search: $found"
wild="$(as_anyone "forum_search('%', 30)" anon "''")"
echo "$wild" | grep -q '"total": 0' && ok "a % in the query is a character, not a wildcard" || bad "wildcard leak: $wild"
empty="$(as_anyone "forum_search('', 30)" anon "''")"
echo "$empty" | grep -q '"total": 1' && ok "an empty query is the latest list" || bad "empty search: $empty"

# the category door
category="$(as_anyone "forum_category('general', 30, 0)" anon "''")"
echo "$category" | grep -q '"discussions": 1' && ok "the category carries its count" || bad "category: $category"
echo "$category" | grep -q 'পরীক্ষামূলক আলোচনা' && ok "and its threads" || bad "category threads missing"
absent="$(as_anyone "forum_category('nope', 30, 0)" anon "''" | tr -d '\n')"
[ "$absent" = "" ] && ok "an unknown category is null, not an error" || bad "absent category (got '$absent')"

# moderation: the dashboard sees unpublished rows, the reader does not
psql -d behaviour -c "update public.forum_discussions set status = 'Unpublish' where id = '$DISCUSSION'" >/dev/null
hidden="$(as_anyone "forum_discussion('$DISCUSSION', false)" anon "''")"
echo "$hidden" | grep -q '"status": "Unpublish"' && ok "a hidden thread still opens by id (the app decides)" \
  || bad "hidden thread: $hidden"
visible="$(as_anyone "forum_overview(20)" anon "''" | grep -c 'পরীক্ষামূলক' || true)"
[ "$visible" = "0" ] && ok "but it is gone from the public lists" || bad "hidden thread is listed"
psql -d behaviour -c "update public.forum_discussions set status = 'Publish' where id = '$DISCUSSION'" >/dev/null

# --- the dashboard's door -----------------------------------------------------
step "dashboard board"

as_dashboard() {
  psql -d behaviour -tAc "set role anon; set request.jwt.claim.sub = ''; set test.dashboard = 'on'; select public.$1;" 2>&1
}

board="$(as_dashboard "contributor_leaderboard_dashboard(50, null, false)")"
echo "$board" | grep -q 'নতুন নাম' && ok "the dashboard reads the board" || bad "dashboard board: $board"
echo "$board" | grep -q '"points": 152' && ok "the dashboard sees the same points as the app" || bad "dashboard points: $board"

forum_board="$(as_dashboard "forum_overview(20)")"
echo "$forum_board" | grep -q 'সাধারণ আলোচনা' && ok "the dashboard reads the forum too" || bad "dashboard forum: $forum_board"
echo "$board" | grep -q '"email"' && ok "each row carries the e-mail the dashboard links on" || bad "email missing: $board"

lifetime="$(as_dashboard "contributor_leaderboard_dashboard(50, null, true)")"
echo "$lifetime" | grep -q '"points": 152' && ok "the Lifetime switch spans everything" || bad "lifetime: $lifetime"
echo "$lifetime" | grep -q '"month_key": ""' && ok "and reports no month when it is asked for everything" || bad "lifetime key: $lifetime"

no_session="$(as_anon "contributor_leaderboard_dashboard(50, null, false)" || true)"
echo "$no_session" | grep -qi "permission denied\|available to the dashboard" && ok "without a dashboard session the door is shut" || bad "no session (got '$no_session')"

plain_reader="$(reader_call "contributor_leaderboard_dashboard(50, null, false)" || true)"
echo "$plain_reader" | grep -qi "dashboard" && ok "a reader session is not a dashboard session" || bad "reader on dashboard door (got '$plain_reader')"

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
