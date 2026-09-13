'use strict';

/**
 * The dashboard's schema probe and the banner it produces.
 *
 * The probe reads one column from every table the dashboard knows about, and the
 * banner tells the editor which migration to run. It used to blame migration 003
 * whatever had failed — and to ask `app_language_files` (keyed on `lang`, migration
 * 023) for an `id` column, which PostgREST answers with "column does not exist".
 * A healthy database therefore announced that Blog uploads were broken.
 *
 * The fixture below models PostgREST closely enough to catch that class of bug: the
 * `select` on each request is checked against the columns the table really has, and
 * an unknown column fails with 42703 exactly as the server does. No network here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TABLES = {
  authors: 'authors', categories: 'categories', blogs: 'blogs', comments: 'comments',
  galleries: 'galleries', books: 'pdf_books', submissions: 'submitted_blogs', videos: 'videos',
  music: 'music_tracks', settings: 'settings', profiles: 'profiles',
  notifications: 'user_notifications', messages: 'admin_messages',
  languageFiles: 'app_language_files',
  // The forum, which config.js has carried since 029: the dashboard's overview reads
  // the threads and answers, which is how a database without 029 raises the banner.
  forum: 'forum_discussions', forumReplies: 'forum_replies', forumCategories: 'forum_categories'
};

const PROBED = Object.values(TABLES);

// What production actually has. `app_language_files` has no `id` column — its key is
// `lang` — and that is the whole point of the regression this file guards.
const SCHEMA = {
  authors: ['id', 'title', 'designation', 'image', 'created_at'],
  categories: ['id', 'title', 'sub_title', 'slug'],
  blogs: ['id', 'title', 'sub_title', 'slug', 'content', 'image', 'image_meta', 'imgbb_delete_url',
    'inline_media', 'pdf_book_link', 'pdf_file_provider', 'pdf_storage_path', 'pdf_file_size_mb',
    'status', 'tags', 'tag_keys'],
  comments: ['id', 'name', 'content', 'blog_title', 'created_at'],
  galleries: ['id', 'title', 'description'],
  pdf_books: ['id', 'title', 'author_or_editor'],
  submitted_blogs: ['id', 'title', 'writer_name', 'content_title', 'inline_media'],
  videos: ['id', 'title', 'description'],
  music_tracks: ['id', 'title', 'artist', 'album'],
  settings: ['id', 'site_title'],
  profiles: ['id', 'name', 'email'],
  user_notifications: ['id', 'user_id', 'title'],
  admin_messages: ['id', 'sender_id', 'body'],
  app_language_files: ['lang', 'label', 'csv', 'row_count', 'updated_at'],
  forum_discussions: ['id', 'title', 'status', 'category_id', 'user_id', 'views_count', 'replies_count',
    'is_official', 'created_at', 'last_reply_at', 'author_name'],
  forum_replies: ['id', 'discussion_id', 'user_id', 'status', 'parent_id', 'author_name', 'is_official', 'created_at'],
  forum_categories: ['id', 'slug', 'title'],
  blog_tag_counts: ['tag_key', 'issue_year', 'total'] // optional view, migration 013
};

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json', 'content-range': '0-0/*' }
});

function setup({ drop = {}, fail = {}, legacy = false, tagView = true } = {}) {
  const calls = [];
  const config = {
    app: { name: 'Ningshing Che', version: 'test', websiteUrl: 'https://example.test', requestTimeoutMs: 1000 },
    supabase: { url: 'https://fixture.supabase.invalid', restPath: '/rest/v1', storagePath: '/storage/v1', publishableKey: 'fixture-publishable-secret' },
    tables: TABLES
  };
  const sandbox = {
    NC_CONFIG: config, console, setTimeout, clearTimeout, AbortController, DOMException,
    TextEncoder, Blob, FormData, URL, URLSearchParams, Intl,
    NC: { auth: { isLegacy: () => legacy, getSessionToken: () => 'fixture-session' } },
    fetch: async (address, options) => {
      const url = new URL(address);
      const table = url.pathname.split('/').pop();
      const select = url.searchParams.get('select') || '*';
      calls.push({ url, table, select, method: options?.method || 'GET' });
      if (fail[table]) return json(fail[table].body, fail[table].status);
      if (table === 'blog_tag_counts' && !tagView) {
        return json({ code: 'PGRST205', message: "Could not find the table 'public.blog_tag_counts' in the schema cache" }, 404);
      }
      const columns = SCHEMA[table];
      if (!columns) return json({ code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` }, 404);
      const available = columns.filter((column) => !(drop[table] || []).includes(column));
      for (const column of select.split(',')) {
        if (column === '*') continue;
        if (!available.includes(column)) {
          return json({ code: '42703', message: `column ${table}.${column} does not exist` }, 400);
        }
      }
      return json([]);
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/api.js'), 'utf8'), sandbox);
  return { NC: sandbox.NC, calls, probe: (options) => sandbox.NC.api.schemaProbe(options) };
}

const probeCall = (calls, table) => calls.filter((call) => call.table === table);
// api.js runs inside a vm context, so its arrays carry that realm's prototype and
// deepStrictEqual rejects them for prototype identity alone: copy into host arrays.
const keys = (items) => Array.from(items, (item) => item.key);
const empty = (items) => Array.from(items).length === 0;

test('a healthy database reports ready — including the id-less language table', async () => {
  const { probe, calls, NC } = setup();
  const result = await probe();
  assert.equal(result.ok, true, 'nothing should be reported ready while a table looks broken');
  assert.equal(empty(result.missing), true);
  assert.equal(empty(result.mismatched), true);
  assert.equal(NC.api.schemaBanner(result), null, 'a healthy database must not raise the banner');

  // The bug: app_language_files has no `id`, so probing it with `id` failed with 42703
  // and the banner claimed Blog media columns were missing.
  const language = probeCall(calls, 'app_language_files');
  assert.equal(language.length, 1);
  assert.equal(language[0].select, 'lang,label,csv,row_count');
  assert.equal(calls.some((call) => call.table === 'app_language_files' && call.select === 'id'), false);
});

test('every table is probed once, read-only, one row, with the columns its screen needs', async () => {
  const { probe, calls } = setup();
  await probe();
  for (const table of PROBED) {
    const hits = probeCall(calls, table);
    assert.equal(hits.length, 1, `${table} should be probed exactly once`);
    assert.equal(hits[0].method, 'GET', 'the probe must never write');
    assert.equal(hits[0].url.searchParams.get('limit'), '1');
  }
  assert.equal(probeCall(calls, 'blogs')[0].select,
    'id,imgbb_delete_url,image_meta,inline_media,pdf_file_provider,pdf_storage_path,pdf_file_size_mb');
  assert.equal(probeCall(calls, 'submitted_blogs')[0].select, 'id,inline_media');
  assert.equal(probeCall(calls, 'authors')[0].select, 'id', 'tables keyed on id fall back to id');
  assert.equal(probeCall(calls, 'blog_tag_counts')[0].select, 'tag_key');
});

test('a missing Blog media column names that column and migration 003', async () => {
  const { probe, NC } = setup({ drop: { blogs: ['inline_media'] } });
  const result = await probe();
  assert.equal(result.ok, false);
  assert.deepEqual(keys(result.mismatched), ['blogs']);
  const issue = NC.api.schemaBanner(result);
  assert.equal(issue.title, 'Database update required');
  assert.match(issue.message, /`blogs`/);
  assert.match(issue.message, /column blogs\.inline_media does not exist/);
  assert.match(issue.message, /003_blog_media_uploads\.sql/);
  assert.doesNotMatch(issue.message, /023_/);
});

test('a language-table problem names migration 023, never 003', async () => {
  const { probe, NC } = setup({ drop: { app_language_files: ['csv'] } });
  const result = await probe();
  assert.deepEqual(keys(result.mismatched), ['languageFiles']);
  const issue = NC.api.schemaBanner(result);
  assert.match(issue.message, /`app_language_files`/);
  assert.match(issue.message, /023_app_language_files\.sql/);
  assert.doesNotMatch(issue.message, /003_blog_media_uploads/);
});

test('missing tables are reported with the schema file, not a migration', async () => {
  const { probe, NC } = setup({
    fail: { authors: { status: 404, body: { code: 'PGRST205', message: "Could not find the table 'public.authors' in the schema cache" } } }
  });
  const result = await probe();
  assert.deepEqual(keys(result.missing), ['authors']);
  const issue = NC.api.schemaBanner(result);
  assert.equal(issue.title, 'Database setup required');
  assert.match(issue.message, /1 required database table is missing/);
  assert.match(issue.message, /`authors`/);
  assert.match(issue.message, /backend\/supabase\/schema\.sql/);
});

test('the hint names the table and the migration that adds it, not schema.sql', () => {
  // The dashboard's overview does not run the probe; it learns which tables are missing
  // from its own failed reads and knows them by key. Its banner used to be one hardcoded
  // sentence — run backend/supabase/schema.sql — which is impossible advice when the
  // missing table is music_tracks (014) or profiles (005), and which is why an editor
  // could run schema.sql, reload, and meet the same banner again.
  const { NC } = setup();
  const hint = NC.api.schemaHint(['music']);
  assert.equal(hint.title, 'Database setup required');
  assert.match(hint.message, /`music_tracks`/, 'the table by its database name');
  assert.match(hint.message, /014_music_tracks\.sql/, 'and the file that adds it');
  assert.match(hint.message, /schema\.sql builds the base tables only/,
    'while saying where the rest of them live');

  // A table the base schema really does create still points at the base schema.
  const base = NC.api.schemaHint(['authors']);
  assert.match(base.message, /backend\/supabase\/schema\.sql/);
  assert.doesNotMatch(base.message, /migrations\/005/);

  // Several at once: every table named, every file named once.
  const many = NC.api.schemaHint(['profiles', 'notifications', 'messages', 'forum']);
  for (const name of ['profiles', 'user_notifications', 'admin_messages', 'forum_discussions']) {
    assert.match(many.message, new RegExp('`' + name + '`'), `${name} should be named`);
  }
  for (const file of ['005_reader_profiles.sql', '007_user_inbox.sql', '029_forum.sql']) {
    assert.match(many.message, new RegExp(file.replace('.', '\\.')));
  }
  assert.equal((many.message.match(/007_user_inbox\.sql/g) || []).length, 1,
    'two tables from one file is still one file to run');
  assert.equal(NC.api.schemaHint([]), null, 'nothing missing, nothing to say');
  assert.equal(
    NC.api.schemaHint(['music'], { purpose: 'so this page can load real data' })
      .message.includes('so this page can load real data'),
    true, 'the caller can say what the tables are for');
});

test('a failed save sends the editor to the check, not to schema.sql', () => {
  // userMessage is what every failed save and every failed page load says. Its
  // missing-table line was the overview banner's sentence — run schema.sql — which is
  // the advice that trapped an editor in a loop.
  const { NC } = setup();
  const missing = new NC.api.ApiError('Could not find the table in the schema cache',
    { status: 404, code: 'PGRST205' });
  const text = NC.api.userMessage(missing);
  assert.match(text, /Run check/, 'the check names the table and the file');
  assert.match(text, /migrations\//, 'and where the rest of the files are');
  assert.doesNotMatch(text, /Run backend\/supabase\/schema\.sql first/,
    'never the sentence that cannot be followed');

  const api = fs.readFileSync(path.join(__dirname, '../assets/js/api.js'), 'utf8');
  assert.doesNotMatch(api, /not installed yet\. Run backend\/supabase\/schema\.sql first/,
    'and it does not come back');
});

test('the overview banner is built from the hint, and no longer hardcodes schema.sql', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '../assets/js/dashboard.js'), 'utf8');
  assert.match(dashboard, /NC\.api\.schemaHint\(missingTables\.map\(\(item\) => item\.key\)/,
    'the banner asks what is missing');
  assert.doesNotMatch(dashboard, /Run backend\/supabase\/schema\.sql in the Supabase SQL Editor/,
    'the sentence that could not be followed is gone');
  assert.match(dashboard, /item\.error\?\.isSchemaMissing/, 'only a missing table raises it');
});

test('a legacy login asks for the access-control migration', async () => {
  const { probe, NC } = setup({ legacy: true });
  const result = await probe();
  assert.equal(result.accessControlMissing, true);
  const issue = NC.api.schemaBanner(result);
  assert.equal(issue.title, 'Security migration required');
  assert.match(issue.message, /004_dashboard_access_control\.sql/);
});

test('the optional tag view never raises the banner on its own', async () => {
  const { probe, calls, NC } = setup({ tagView: false });
  const result = await probe();
  assert.equal(result.ok, true, 'migration 013 is optional — the dashboard filters client-side');
  assert.equal(NC.api.schemaBanner(result), null);
  assert.equal(probeCall(calls, 'blog_tag_counts').length, 1, 'the view is still worth checking');
});

test('an ordinary server error is not mistaken for a missing migration', async () => {
  const { probe, NC } = setup({ fail: { galleries: { status: 500, body: { code: 'XX000', message: 'internal error' } } } });
  const result = await probe();
  assert.equal(result.ok, false);
  assert.equal(empty(result.missing), true);
  assert.equal(empty(result.mismatched), true);
  assert.equal(NC.api.schemaBanner(result), null, 'a 500 is not something an editor can fix by running SQL');
});

test('a write-time column error points at the migrations folder', () => {
  const { NC } = setup();
  const error = new NC.api.ApiError('column blogs.inline_media does not exist', { status: 400, code: '42703' });
  assert.equal(error.isSchemaMismatch, true);
  assert.match(NC.api.userMessage(error), /backend\/supabase\/migrations/);
});
