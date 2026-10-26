/**
 * The profile page's total view — the number the owner asked for, and asked
 * whether it is real.
 *
 * It was `article_views + music_views`, both summed by hand in `028`, and it had
 * two faults: **the forum was missing** (threads have been counted since 029, and
 * a reader whose work is mostly threads read ০ on their own page), and it was a
 * *second* sum — the database has had one counting engine since 036
 * (`user_view_totals`, which the app's dashboard reads), and two sums eventually
 * disagree.
 *
 * `037_profile_views.sql` replaces that one function so the page asks the engine,
 * adds up the three counts in one place (`total_views`, so the headline and the
 * parts beside it cannot drift), and falls back to the item counters when 036 is
 * not installed — a database the owner may well have.
 *
 * The checks below are about the four places the number passes through: the SQL,
 * the reply, the model, and the two screens.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app');
const MIGRATIONS = path.join(ROOT, 'backend', 'supabase', 'migrations');
// The app asks the language table for its copy now — `t("…")`, or `tNow("…")`
// where no composable may run — so these sources are read with that call lifted
// off: `tNow("মোটা")` reads as `"মোটা"`, and if the call filled slots, the
// arguments stay where they were. An assertion about a string does not care
// whether the call site asks for a translation, and this keeps every existing
// anchor honest rather than loosened: the string still has to be there, in that
// place, in that shape.
function unwrap(text) {
  const opener = /(?<![A-Za-z0-9_.])(?:t|tNow)\(\s*(?=")/g;
  let out = '';
  let i = 0;
  while (i < text.length) {
    opener.lastIndex = i;
    const match = opener.exec(text);
    if (!match) { out += text.slice(i); break; }
    out += text.slice(i, match.index);
    let j = match.index + match[0].length;
    const literalStart = j;
    j += 1;
    while (j < text.length) {
      if (text[j] === '\\') { j += 2; continue; }
      if (text[j] === '"') { j += 1; break; }
      j += 1;
    }
    const literal = text.slice(literalStart, j);
    // Skip the rest of the call: the closing paren of the one that wraps it.
    let depth = 0;
    let rest = '';
    while (j < text.length) {
      const ch = text[j];
      if (ch === '"') {
        let k = j + 1;
        while (k < text.length && text[k] !== '"') { if (text[k] === '\\') k += 1; k += 1; }
        rest += text.slice(j, k + 1);
        j = k + 1;
        continue;
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        if (depth === 0) { j += 1; break; }
        depth -= 1;
      }
      rest += ch;
      j += 1;
    }
    // One argument (the string itself) leaves nothing behind; a filled slot
    // keeps its arguments, minus the parens that only existed for the call.
    out += rest.trim() ? literal + rest : literal;
    i = j;
  }
  return out;
}
const read = (...parts) => unwrap(fs.readFileSync(path.join(APP, ...parts), 'utf8'));

const SQL = fs.readFileSync(path.join(MIGRATIONS, '037_profile_views.sql'), 'utf8');
const OLD_SQL = fs.readFileSync(path.join(MIGRATIONS, '028_public_profile_details.sql'), 'utf8');
const DTO = read('data', 'portal', 'PortalDtos.kt');
const MODELS = read('data', 'portal', 'PortalModels.kt');
const PUBLIC_SCREEN = read('ui', 'screens', 'PublicProfileScreen.kt');
const OWN_SCREEN = read('ui', 'screens', 'UserProfileScreen.kt');
const VIEW_MODEL = read('ui', 'viewmodel', 'ReaderWorkspaceViewModel.kt');
const RUN_SH = fs.readFileSync(path.join(ROOT, 'backend', 'tests', 'sql', 'run.sh'), 'utf8');

/** The function's declaration and its body, braces not needed — `$$` bounded. */
function functionBody(text, signature) {
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `not found: ${signature}`);
  const end = text.indexOf('\n$$;', start);
  return text.slice(start, end);
}

// ---------------------------------------------------------------------------
// The SQL
// ---------------------------------------------------------------------------

test('037 replaces the one function the page reads, and nothing else', () => {
  const body = functionBody(SQL, 'create or replace function public.public_profile(p_user_id uuid)');
  assert.match(body, /returns jsonb/);
  assert.match(body, /language plpgsql/);
  assert.match(body, /security definer/);
  assert.match(body, /set search_path = public/);
  // One transaction, run twice without harm, and reachable by the reader's page.
  assert.match(SQL, /^begin;/m);
  assert.match(SQL, /^commit;/m);
  assert.match(SQL, /grant execute on function public\.public_profile\(uuid\) to anon, authenticated;/);
  // No table of its own: this file is one function.
  assert.ok(!/create table/i.test(SQL), 'no table is created');
  assert.ok(!/alter table/i.test(SQL), 'and none is altered');
});

test('the total is the three counts added up in one place', () => {
  const body = functionBody(SQL, 'create or replace function public.public_profile(p_user_id uuid)');
  assert.match(body, /'article_views', article_views,/);
  assert.match(body, /'music_views', music_views,/);
  assert.match(body, /'forum_views', forum_views,/);
  // The headline is the parts, as SQL: the app never adds them itself on a
  // database that has this file.
  assert.match(body, /'total_views', article_views \+ music_views \+ forum_views,/);
  assert.match(body, /'visitors', visitors,/);
  assert.match(body, /'minutes_listened', minutes_listened,/);
});

test('the counts come from the engine when it is installed', () => {
  const body = functionBody(SQL, 'create or replace function public.public_profile(p_user_id uuid)');
  // Asked about, not assumed: the owner may not have run 036 yet.
  assert.match(body, /if to_regprocedure\('public\.user_view_totals\(uuid\)'\) is not null then/);
  assert.match(body, /execute format\('select public\.user_view_totals\(%L::uuid\)', p_user_id\) into totals;/);
  assert.match(body, /if totals is null then/);
  // …and read, never recomputed, when it is.
  assert.match(body, /article_views := coalesce\(\(totals ->> 'article_views'\)::bigint, 0\);/);
  assert.match(body, /visitors := coalesce\(\(totals ->> 'visitors'\)::bigint, 0\);/);
  assert.match(body, /minutes_listened := coalesce\(\(totals ->> 'minutes_listened'\)::bigint, 0\);/);
});

test('without 036 the item counters are summed, forum included', () => {
  const body = functionBody(SQL, 'create or replace function public.public_profile(p_user_id uuid)');
  // The fallback is the page's old behaviour with the one thing it was missing.
  assert.match(body, /select coalesce\(sum\(b\.views_count\), 0\) into article_views\s*\n\s*from public\.submitted_blogs s\s*\n\s*join public\.blogs b on b\.id = s\.converted_blog_id\s*\n\s*where s\.user_id = person\.id;/);
  assert.match(body, /select coalesce\(sum\(t\.views_count\), 0\) into music_views/);
  // The forum table is asked about too: a database can have the profile without
  // the forum, and naming a table that is not there is an error, not a zero.
  assert.match(body, /if to_regclass\('public\.forum_discussions'\) is not null then/);
  assert.match(body, /select coalesce\(sum\(d\.views_count\), 0\) into forum_views/);
  // The article rule matches 036's: every blog the reader's submissions became.
  assert.ok(!/status = any \(array\['Publish', 'Published'\]\)\s*\n\s*\)\s*into article_views/.test(body),
    'the total is not restricted to published articles, which is what 036 counts');
  // Visitors stay zero rather than being invented: nothing recorded who looked.
  assert.match(body, /visitors bigint := 0;/);
});

test('everything 028 put on the page is still there', () => {
  const body = functionBody(SQL, 'create or replace function public.public_profile(p_user_id uuid)');
  const previous = functionBody(OLD_SQL, 'create or replace function public.public_profile(p_user_id uuid)');
  for (const key of ["'id'", "'name'", "'avatar_url'", "'designation'", "'address'", "'joined_at'",
    "'points'", "'month_points'", "'articles'", "'songs'"]) {
    assert.ok(body.includes(key), `${key} is still in the reply`);
    assert.ok(previous.includes(key), `(and was in 028: ${key})`);
  }
  // The points still come from 026's scoring functions through the same guard.
  assert.match(body, /if to_regprocedure\('public\.contributor_score\(uuid, date, date\)'\) is not null/);
  assert.match(body, /contributor_month_range\(date\)/);
  // And the lists are the same lists: published articles, most read first, and
  // the songs by plays — with the same ceilings.
  assert.match(body, /and b\.status = any \(array\['Publish', 'Published'\]\)/);
  assert.match(body, /limit 60/);
  assert.match(body, /limit 120/);
  assert.match(body, /order by b\.views_count desc nulls last,/);
  assert.match(body, /order by t\.views_count desc nulls last, t\.created_at desc/);
});

test('the file says how to check it, and the harness checks it', () => {
  // The owner can run this by hand in the SQL Editor; the numbers must be equal.
  assert.match(SQL, /select public\.public_profile\('<user-id>'\) -> 'total_views',/);
  assert.match(SQL, /\+ \(public\.public_profile\('<user-id>'\) ->> 'forum_views'\)::bigint;/);
  // And the migration harness drives it with real visits, both ways.
  assert.match(RUN_SH, /step "the profile's total views"/);
  assert.match(RUN_SH, /the profile's article views counted three readers, not four opens/);
  assert.match(RUN_SH, /and its thread views are in the number, which is what 037 is for/);
  assert.match(RUN_SH, /the headline is the three parts added up, to the number/);
  assert.match(RUN_SH, /step "the profile before the counting engine \(037 without 036\)"/);
  assert.match(RUN_SH, /for want in '"article_views": 4' '"music_views": 2' '"forum_views": 7' '"total_views": 13' '"visitors": 0'; do/);
  assert.match(RUN_SH, /echo "\$old_profile" \| grep -q "\$want" && ok "without 036, \$want"/);
});

// ---------------------------------------------------------------------------
// The reply, and the model
// ---------------------------------------------------------------------------

test('the app reads the new fields, and copes without them', () => {
  for (const [json, field] of [
    ['article_views', 'articleViews'], ['music_views', 'musicViews'], ['forum_views', 'forumViews'],
    ['total_views', 'totalViews'], ['minutes_listened', 'minutesListened']
  ]) {
    assert.match(DTO, new RegExp(`@Json\\(name = "${json}"\\) val ${field}: Long\\? = null`),
      `${json} → ${field}, nullable for an older database`);
  }
  assert.match(DTO, /val visitors: Long\? = null/);
  assert.match(MODELS, /forumViews = \(forumViews \?: 0L\)\.coerceAtLeast\(0L\),/);
  assert.match(MODELS, /serverTotalViews = totalViews\?\.coerceAtLeast\(0L\),/);
  assert.match(MODELS, /visitors = \(visitors \?: 0L\)\.coerceAtLeast\(0L\),/);
  assert.match(MODELS, /minutesListened = \(minutesListened \?: 0L\)\.coerceAtLeast\(0L\),/);
});

test('the page’s total is the server’s, with the sum only as a fallback', () => {
  assert.match(MODELS, /val serverTotalViews: Long\? = null,/);
  assert.match(MODELS, /val totalViews: Long get\(\) = serverTotalViews \?: \(articleViews \+ musicViews \+ forumViews\)/);
  // Which means a database with 037 shows the server's number (forum in it), and
  // one without shows what it has instead of nothing.
  assert.match(MODELS, /val forumViews: Long = 0L,/);
});

// ---------------------------------------------------------------------------
// The two screens
// ---------------------------------------------------------------------------

test('the public profile shows the total and what it is made of', () => {
  const stats = PUBLIC_SCREEN.slice(
    PUBLIC_SCREEN.indexOf('private fun ProfileStatistics('),
    PUBLIC_SCREEN.indexOf('private fun StatisticDivider(')
  );
  assert.match(stats, /value = profile\.totalViews,/);
  assert.match(stats, /label = "মোট ভিউ",/);
  assert.match(stats, /ProfileViewBreakdown\(profile\)/, 'the split sits inside the same card');

  const breakdown = PUBLIC_SCREEN.slice(
    PUBLIC_SCREEN.indexOf('private fun ProfileViewBreakdown('),
    PUBLIC_SCREEN.indexOf('@Composable', PUBLIC_SCREEN.indexOf('private fun ProfileViewBreakdown('))
  );
  // Re-anchored for the language batch: each part is one string with a `{1}`
  // slot, so the label travels with its count in any word order.
  assert.match(breakdown, /add\("প্রবন্ধ \{1\}", toBengaliNumeral\(profile\.articleViews\)\)/);
  assert.match(breakdown, /add\("গান \{1\}", toBengaliNumeral\(profile\.musicViews\)\)/);
  assert.match(breakdown, /add\("আলোচনা \{1\}", toBengaliNumeral\(profile\.forumViews\)\)/);
  assert.match(breakdown, /add\("পাঠক \{1\}", toBengaliNumeral\(profile\.visitors\)\)/);
  assert.match(breakdown, /parts\.joinToString/);
  assert.match(breakdown, /testTag\("public_profile_view_breakdown"\)/);
  // Visitors are only claimed when they are known: a database without 036 would
  // otherwise show a confident ০ next to views that are not zero.
  assert.match(breakdown, /if \(profile\.visitors > 0L\)/);
});

test('the reader’s own প্রোফাইল shows the same total', () => {
  assert.match(OWN_SCREEN, /private fun ProfileViewsCard\(metrics: ReaderMetrics\)/);
  assert.match(OWN_SCREEN, /val metrics by viewModel\.metrics\.collectAsStateWithLifecycle\(\)/);
  assert.match(OWN_SCREEN, /ProfileViewsCard\(metrics\)/);
  assert.match(OWN_SCREEN, /text = toBengaliNumeral\(metrics\.totalViews\)/);
  assert.match(OWN_SCREEN, /text = "মোট ভিউ"/);
  assert.match(OWN_SCREEN, /testTag\("profile_views_card"\)/);
  const card = OWN_SCREEN.slice(
    OWN_SCREEN.indexOf('private fun ProfileViewsCard('),
    OWN_SCREEN.indexOf('@OptIn(ExperimentalMaterial3Api::class)')
  );
  for (const part of ['প্রবন্ধ', 'গান ', 'আলোচনা', 'পাঠক']) {
    assert.ok(card.includes(part), `${part.trim()} is on the breakdown line`);
  }
  assert.match(card, /metrics\.articleViews/);
  assert.match(card, /metrics\.musicViews/);
  assert.match(card, /metrics\.forumViews/);
  assert.match(card, /metrics\.visitors/);
  // And the minutes only when somebody actually listened.
  assert.match(card, /if \(metrics\.minutesListened > 0L\)/);
});

test('the profile asks the database, through the call the dashboard uses', () => {
  const refresh = VIEW_MODEL.slice(
    VIEW_MODEL.indexOf('fun refreshViews()'),
    VIEW_MODEL.indexOf('/**', VIEW_MODEL.indexOf('fun refreshViews()'))
  );
  assert.match(refresh, /val totals = supabaseClient\.userViewTotals\(user\.id\) \?: return@launch/);
  assert.match(refresh, /_metrics\.value = _metrics\.value\.copy\(/,
    'it adds to the metrics another screen may have loaded rather than clearing them');
  for (const field of ['articleViews', 'musicViews', 'forumViews', 'visitors', 'registeredViews',
    'guestViews', 'minutesListened']) {
    // No trailing comma: `minutesListened` is the last argument of the copy.
    assert.match(refresh, new RegExp(`${field} = totals\\.${field}`), `${field} is carried over`);
  }
  // Called when the page opens, which is the only moment the number can change.
  assert.match(OWN_SCREEN, /viewModel\.refreshViews\(\)/);
  // The dashboard's own numbers are the same call, so the two cannot disagree.
  const dashboardRefresh = VIEW_MODEL.slice(VIEW_MODEL.indexOf('fun refresh()'), VIEW_MODEL.indexOf('fun refreshViews()'));
  assert.match(dashboardRefresh, /val viewTotals = supabaseClient\.userViewTotals\(user\.id\)/);
});
