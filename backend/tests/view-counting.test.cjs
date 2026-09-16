/**
 * The counting rules — one view per visit, whoever the visitor is.
 *
 * Three counters grew up separately and each was wrong in a different direction:
 * articles and songs deduped a viewer for twenty hours (a reader who came back in
 * the evening counted nothing), forum threads had no dedupe at all (leaving and
 * re-tapping counted again), and a song was counted the moment it *started*, which
 * credited a track somebody skipped out of in three seconds.
 *
 * These tests pin the rules that replaced them, in the three places they have to
 * agree: the database that decides, the app that reports, and the dashboard that
 * shows it. Nothing here runs SQL — the migration is read as text — so the tests
 * state the contract, and the numbers in it are the ones the code uses.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app');
const read = (...parts) => fs.readFileSync(path.join(APP, ...parts), 'utf8');

const MIGRATION = fs.readFileSync(
  path.join(ROOT, 'backend', 'supabase', 'migrations', '036_view_logic.sql'),
  'utf8'
);
const VIEWS_025 = fs.readFileSync(
  path.join(ROOT, 'backend', 'supabase', 'migrations', '025_content_views.sql'),
  'utf8'
);
const MUSIC_CONTROLLER = read('playback', 'MusicController.kt');
const PORTAL_REPO = read('data', 'portal', 'PortalRepository.kt');
const PORTAL_API = read('data', 'portal', 'PortalApi.kt');
const DASHBOARD = fs.readFileSync(path.join(ROOT, 'backend', 'assets', 'js', 'dashboard.js'), 'utf8');

/** The body of a `create or replace function` in the migration, by dollar quoting. */
function functionBody(text, name) {
  const start = text.indexOf(`function public.${name}(`);
  assert.notEqual(start, -1, `${name} is not defined`);
  const tag = /as \$(\w*)\$/g;
  tag.lastIndex = start;
  const open = tag.exec(text);
  assert.ok(open, `${name} has no body`);
  const closing = `$${open[1]}$`;
  const end = text.indexOf(closing, tag.lastIndex);
  assert.notEqual(end, -1, `${name} never closes`);
  return text.slice(tag.lastIndex, end);
}

const RECORD = functionBody(MIGRATION, 'content_view_record');
const WINDOW = functionBody(MIGRATION, 'content_view_visit_window');
const VALID = functionBody(MIGRATION, 'music_valid_seconds');
const TRIGGER = functionBody(MIGRATION, 'content_views_sync_count');
const STATS = functionBody(MIGRATION, 'view_stats');
const OVERVIEW = functionBody(MIGRATION, 'view_overview');
const SUMMARY = functionBody(MIGRATION, 'view_summary');
const SERIES = functionBody(MIGRATION, 'user_view_series');

test('a visit is thirty minutes, named in one place', () => {
  assert.match(WINDOW, /interval '30 minutes'/);
  // The engine reads the window rather than repeating it: two copies of "half an
  // hour" is two chances to disagree.
  assert.match(RECORD, /content_view_visit_window\(\)/);
  assert.ok(!/interval '20 hours'/.test(MIGRATION), 'the old twenty-hour window is gone from the rule');
  // 025 keeps its own history — a migration is a record of what was run, not a
  // document that gets edited — so the check is that it is *superseded*, not that
  // it was rewritten.
  const migrations = fs.readdirSync(path.join(ROOT, 'backend', 'supabase', 'migrations'))
    .filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
  assert.ok(migrations.includes('025_content_views.sql'));
  // Re-anchored: 037 (the profile's total) is newer and builds on this file, so
  // what matters is that 036 is in the run and comes before it.
  assert.ok(migrations.includes('036_view_logic.sql'), '036 is in the migrations');
  assert.equal(migrations[migrations.length - 1], '037_profile_views.sql', '037 is the newest migration');
  assert.ok(migrations.indexOf('036_view_logic.sql') < migrations.indexOf('037_profile_views.sql'),
    'and 036 is the file 037 reads its numbers from');
});

test('one view per visit: inside the window nothing is added, outside it counts once', () => {
  // The lookup is the newest counted view of this item by this viewer inside the
  // window, which is what "still the same visit" means.
  assert.match(RECORD, /from public\.content_views v\s*\n\s*where v\.content_type = kind\s*\n\s*and v\.content_id = p_id\s*\n\s*and v\.viewer_key = viewer\s*\n\s*and v\.created_at > timezone\('utc', now\(\)\) - public\.content_view_visit_window\(\)/);
  assert.match(RECORD, /order by v\.created_at desc\s*\n\s*limit 1/);
  // Same visit → no insert; new visit → exactly one insert.
  assert.equal((RECORD.match(/insert into public\.content_views/g) || []).length, 1, 'one insert path');
  assert.match(RECORD, /if visit_id is not null then[\s\S]*?else[\s\S]*?insert into public\.content_views/);
});

test('every view records whether the visitor was registered or anonymous', () => {
  assert.match(MIGRATION, /add column if not exists viewer_kind text not null default 'guest'/);
  assert.match(MIGRATION, /check \(viewer_kind in \('registered', 'guest'\)\)/);
  assert.match(RECORD, /account uuid := auth\.uid\(\)/);
  assert.match(RECORD, /visitor text := case when account is null then 'guest' else 'registered' end|visitor := case when account is null then 'guest' else 'registered' end/);
  // …and it is written on the row, not derived at read time.
  assert.match(RECORD, /insert into public\.content_views \(content_type, content_id, viewer_key, viewer_kind, seconds_listened\)/);
  // Rows written before this migration are read back off their key, which is the
  // only place the old rows say who they were.
  assert.match(MIGRATION, /set viewer_kind = case when viewer_key like 'device:%' then 'guest' else 'registered' end/);
});

test('a song counts once it has been listened to, not when it starts', () => {
  assert.match(VALID, /when coalesce\(p_duration, 0\) <= 0 then 30/);
  assert.match(VALID, /least\(30, greatest\(1, ceil\(p_duration \/ 2\.0\)::integer\)\)/);
  // The play is only inserted when the heard seconds reach the threshold — and
  // never for anything but music.
  assert.match(RECORD, /if kind <> 'music' or heard >= needed then[\s\S]*?insert into public\.content_views/);
  assert.match(RECORD, /needed := public\.music_valid_seconds\(duration\)/);
  assert.match(RECORD, /select coalesce\(m\.duration_seconds, 0\) into duration/);
  // The seconds are kept, so minutes listened is measured rather than inferred.
  assert.match(RECORD, /set seconds_listened = coalesce\(seconds_listened, 0\) \+ heard/);
  // …and seconds are a music column: a blog or forum caller cannot write them.
  assert.match(RECORD, /if kind = 'music' and heard > 0 then/);
  assert.match(RECORD, /if kind <> 'music' then\s*\n\s*heard := 0;/);
  assert.match(SUMMARY, /\(coalesce\(sum\(v\.seconds_listened\), 0\) \/ 60\)::bigint/);
});

test('the three counters write the same rows, and the trigger keeps the totals', () => {
  for (const kind of ['blog', 'music', 'forum']) {
    assert.match(MIGRATION, new RegExp(`check \\(content_type in \\('blog', 'music', 'forum'\\)\\)`), kind);
  }
  // One trigger, three branches: the totals follow the rows for every kind.
  for (const table of ['public.blogs', 'public.music_tracks', 'public.forum_discussions']) {
    assert.match(TRIGGER, new RegExp(`update ${table.replace('.', '\\.')}\\s`), `${table} totals`);
  }
  assert.match(TRIGGER, /greatest\(coalesce\(views_count, 0\) \+ delta, 0\)/);
  // The forum goes through the engine rather than adding one to a column, so it
  // is deduped per visit and carries the visitor kind like the others.
  const forum = MIGRATION.slice(MIGRATION.indexOf('$fn_discussion$'));
  assert.match(forum, /perform public\.content_view_record\('forum', p_id, device, null\)/);
  assert.ok(!/set views_count = d\.views_count \+ 1/.test(MIGRATION), 'the raw increment is gone from the forum');
  // And the function itself is 034's, not a rewrite: the reaction lookup is what
  // tells a rebuild from a different body.
  assert.match(forum, /v\.is_official,/, 'the reply columns 032/034 added are still there');
  assert.match(forum, /is_mine/, '034s own column survives the splice');
});

test('the old entry point still works, and cannot mint a play it never heard', () => {
  const legacy = functionBody(MIGRATION, 'record_content_view');
  assert.match(legacy, /select public\.content_view_record\(p_type, p_id, p_device_id, null\)/);
  // No seconds from the old path means the music branch can never pass its check:
  // heard is 0 and the threshold is at least 1.
  assert.match(RECORD, /heard integer := greatest\(coalesce\(p_seconds, 0\), 0\)/);
  assert.match(VALID, /greatest\(1, ceil\(p_duration \/ 2\.0\)::integer\)/);
  // So the only music view the old path can ever write is one whose seconds were
  // reported by the engine's own caller.
  assert.ok(!/p_seconds/.test(legacy), 'the old entry point takes no seconds');
});

test('the reads answer who, not only how many', () => {
  // One item: visits, people, and the split.
  assert.match(STATS, /'views', count\(\*\)/);
  assert.match(STATS, /'visitors', count\(distinct v\.viewer_key\)/);
  assert.match(STATS, /'registered', count\(\*\) filter \(where v\.viewer_kind = 'registered'\)/);
  assert.match(STATS, /'guest', count\(\*\) filter \(where v\.viewer_kind = 'guest'\)/);
  // The window: distinct people across the whole period, which is not the sum of
  // the days' uniques and must not be presented as if it were.
  assert.match(SUMMARY, /'visitors', count\(distinct v\.viewer_key\)/);
  assert.match(SUMMARY, /'registered_visitors', count\(distinct v\.viewer_key\) filter \(where v\.viewer_kind = 'registered'\)/);
  assert.match(SUMMARY, /'guest_visitors', count\(distinct v\.viewer_key\) filter \(where v\.viewer_kind = 'guest'\)/);
  assert.match(SUMMARY, /make_interval\(days => greatest\(coalesce\(p_days, 30\), 1\)\)/);
  // The daily series carries both, so the chart can draw visits against visitors.
  assert.match(OVERVIEW, /count\(v\.id\)::bigint,\s*\n\s*count\(distinct v\.viewer_key\)::bigint/);
  assert.match(MIGRATION, /returns table \(day date, views bigint, visitors bigint, minutes_listened bigint\)/);
  // A changed return type has to be dropped first, or `create or replace` refuses.
  assert.match(MIGRATION, /drop function if exists public\.user_view_series\(uuid, integer\);/);
});

test('nothing is readable except through a function', () => {
  // content_views stays closed: no grants, and the reads are security definer.
  const table = MIGRATION.slice(MIGRATION.indexOf('alter table public.content_views'));
  assert.ok(!/grant .*on table public\.content_views/i.test(table), 'the table itself is not granted');
  for (const name of ['view_stats', 'view_overview', 'view_summary', 'content_view_record']) {
    assert.match(MIGRATION, new RegExp(`grant execute on function public\\.${name}\\(`), `${name} is granted`);
  }
  assert.match(MIGRATION, /grant execute on function public\.view_summary\(integer\) to anon, authenticated;/);
});

// ---------------------------------------------------------------------------
// The app side
// ---------------------------------------------------------------------------

test('the app reports listening, not starts', () => {
  // The callback the player offers carries seconds.
  assert.match(MUSIC_CONTROLLER, /var onListened: \(\(String, Int\) -> Unit\)\? = null/);
  assert.ok(!/onTrackStarted/.test(MUSIC_CONTROLLER), 'the start-counting callback is gone');
  // The threshold is the same number the database uses, computed from the
  // catalogue duration so the two cannot disagree about a file's length.
  assert.match(MUSIC_CONTROLLER, /private const val VALID_LISTEN_MS = 30_000L/);
  assert.match(MUSIC_CONTROLLER, /val half = \(\(seconds \+ 1\) \/ 2\)\.toLong\(\) \* 1000L/);
  assert.match(MUSIC_CONTROLLER, /minOf\(VALID_LISTEN_MS, half\)/);
  // Only movement while playing counts, and only as much as a tick can play.
  assert.match(MUSIC_CONTROLLER, /if \(player\.isPlaying && delta in 0\.\.MAX_TICK_ADVANCE_MS\) listenedMs \+= delta/);
  // A song is judged by its own length when its listening is flushed.
  assert.match(MUSIC_CONTROLLER, /meterValidMs = validListenMs\(track\)/);
  assert.match(MUSIC_CONTROLLER, /if \(reportedMs == 0L && listenedMs < meterValidMs\) return/);
  // The meter runs off the ticker that already draws the progress bar.
  assert.match(MUSIC_CONTROLLER, /meterListening\(player, _state\.value\.track\)/);
});

test('the app sends the seconds and the engine answers with the total', () => {
  assert.match(PORTAL_API, /@POST\("rpc\/content_view_record"\)/);
  assert.match(PORTAL_API, /suspend fun contentViewRecord\(/);
  assert.match(PORTAL_REPO, /suspend fun recordMusicListen\(trackId: String, seconds: Int\): Result<Long>/);
  assert.match(PORTAL_REPO, /"p_seconds" to \(seconds \?: 0\)\.coerceAtLeast\(0\)\.toString\(\)/);
  assert.match(PORTAL_REPO, /"p_device_id" to guestViewerId/);
  // A reader is still identified by their account when they have one: the kind on
  // the row is the database's reading of the same session.
  assert.match(PORTAL_REPO, /suspend fun recordArticleView\(articleId: String\): Result<Long> = recordView\("blog", articleId\)/);
});

test('the recorder is wired to the player and the dashboard shows who read', () => {
  const app = read('NinghsingCheApp.kt');
  assert.match(app, /musicController\.onListened = \{ trackId, seconds ->/);
  assert.match(app, /recordMusicListen\(trackId, seconds\)/);
  // The reader's own numbers gain the split and the listening time.
  assert.match(read('ui', 'viewmodel', 'ReaderWorkspaceViewModel.kt'), /val visitors: Long = 0L/);
  const screen = read('ui', 'screens', 'UserDashboardScreen.kt');
  for (const label of ['আলোচনা ভিউ', 'পাঠক', 'নিবন্ধিত ভিউ', 'অতিথি ভিউ', 'শোনা মিনিট']) {
    assert.ok(screen.includes(label), `${label} is on the reader's dashboard`);
  }
  // The dashboard's Readers panel asks the two read functions, and says which file
  // to run when the database has not heard of them.
  assert.match(DASHBOARD, /NC\.api\.rpc\('view_summary', \{ p_days: 30 \}\)/);
  assert.match(DASHBOARD, /NC\.api\.rpc\('view_overview', \{ p_days: 30 \}\)/);
  assert.match(DASHBOARD, /036_view_logic\.sql/);
  assert.match(DASHBOARD, /logical/ === '' ? /x/ : /isRpcMissing/);
  // …and it never tells an editor to run schema.sql for a function that is missing.
  const panel = DASHBOARD.slice(DASHBOARD.indexOf('function readersMissing'), DASHBOARD.indexOf('function readerStat'));
  assert.ok(!/schema\.sql/.test(panel), 'the panel names the migration, not the base schema');
});

test('the reader-facing strings the split needs are in the inventory', () => {
  const inventory = fs.readFileSync(path.join(ROOT, 'i18n', 'strings_inventory.csv'), 'utf8');
  for (const label of ['পাঠক', 'নিবন্ধিত ভিউ', 'অতিথি ভিউ', 'শোনা মিনিট', 'আলোচনা ভিউ']) {
    assert.ok(inventory.includes(label), `${label} should be translatable`);
  }
});
