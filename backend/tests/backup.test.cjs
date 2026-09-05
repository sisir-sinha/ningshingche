'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup({ datasets = {}, cap = 500, permissions, legacy = false, respond } = {}) {
  const tables = { authors: 'authors', categories: 'categories', blogs: 'blogs', comments: 'comments',
    galleries: 'galleries', books: 'pdf_books', submissions: 'submitted_blogs', videos: 'videos', settings: 'settings' };
  const calls = [], preferences = new Map();
  const auth = { token: 'fixture-session-secret', allowed: new Set(permissions || Object.keys(tables)), legacy };
  const config = { app: { name: 'Ningshing Che', version: 'test', websiteUrl: 'https://example.test',
    requestTimeoutMs: 1000, locale: 'en-BD' }, supabase: { url: 'https://fixture.supabase.invalid',
    restPath: '/rest/v1', storagePath: '/storage/v1', publishableKey: 'fixture-publishable-secret' }, tables,
    imgbb: { apiKey: 'fixture-imgbb-secret' } };
  const json = (value, total, status = 200) => new Response(JSON.stringify(value), { status,
    headers: { 'content-type': 'application/json', ...(total !== undefined ? { 'content-range': `0-0/${total}` } : {}) } });
  const sandbox = {
    NC_CONFIG: config, console, setTimeout, clearTimeout, AbortController, DOMException, TextEncoder,
    Blob, FormData, URL, URLSearchParams, Intl,
    localStorage: { getItem: (key) => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) },
    NC: { state: { session: { user: { id: 'fixture-user' } } },
      auth: { canAccess: (key) => auth.allowed.has(key), getSessionToken: () => auth.token, isLegacy: () => auth.legacy } },
    fetch: async (address, options) => {
      const url = new URL(address), call = { url, options };
      calls.push(call);
      if (respond) {
        const response = await respond(call, { calls, auth, json });
        if (response) return response;
      }
      if (url.pathname.endsWith('/rpc/dashboard_has_permission')) {
        assert.equal(options.method, 'POST');
        return json(auth.allowed.has(JSON.parse(options.body).p_permission));
      }
      assert.equal(options.method, 'GET', 'Content must only be read, never changed');
      const table = url.pathname.split('/').pop();
      assert.ok(Object.values(tables).includes(table), 'Only allowlisted tables may be requested');
      const rows = datasets[table] || [];
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Math.min(Number(url.searchParams.get('limit')), cap);
      return json(rows.slice(offset, offset + limit), rows.length);
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const name of ['utils', 'api', 'backup']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../assets/js/${name}.js`), 'utf8'), sandbox);
  }
  return { ...sandbox, calls, auth, preferences, tables };
}

const rows = (count) => Array.from({ length: count }, (_, index) => ({
  id: String(index).padStart(6, '0'), title: `নিংশিং চে ${index}`, content: '<p>বিষ্ণুপ্রিয়া মণিপুরি তথ্যকোষ</p>'
}));
const plain = (value) => JSON.parse(JSON.stringify(value));

test('exports all nine tables, Unicode, relationships and explicit scope without credentials', async () => {
  const h = setup({ datasets: { blogs: [{ id: 'blog', author_id: 'author', title: 'নিংশিং চে',
    image: { url: 'https://example.test/image.jpg' }, status: 'Draft' }], settings: [{ id: 'site_settings', site_title: 'নিংশিং চে' }] } });
  const backup = await h.NC.backup.collect(Object.keys(h.tables));
  assert.equal(backup.format, 'ningshing-che-dashboard-backup');
  assert.equal(backup.version, 1);
  assert.equal(backup.manifest.scope, 'all-content');
  assert.equal(backup.manifest.total_records, 2);
  assert.deepEqual(Object.keys(backup.tables).sort(), Object.values(h.tables).sort());
  assert.equal(backup.tables.blogs[0].author_id, 'author');
  assert.equal(backup.tables.blogs[0].title, 'নিংশিং চে');
  assert.equal(backup.tables.blogs[0].status, 'Draft');
  assert.equal(backup.manifest.media, 'references-only');
  assert.deepEqual(plain(backup.manifest.omitted_tables), []);
  const text = JSON.stringify(backup);
  for (const secret of ['fixture-session-secret', 'fixture-publishable-secret', 'fixture-imgbb-secret', 'fixture-user']) {
    assert.equal(text.includes(secret), false);
  }
  assert.equal(h.preferences.size, 0, 'No records should be put in browser storage');
  assert.equal(h.calls.filter(({ options }) => options.method === 'POST').length, 11, 'Only read-only permission RPCs');
});

test('continues beyond 1,000 rows and short server-capped pages in stable ID order', async () => {
  const h = setup({ datasets: { blogs: rows(1205) }, cap: 123 });
  const progress = [];
  const backup = await h.NC.backup.collect(['blogs'], { onProgress: (state) => progress.push(state) });
  assert.equal(backup.tables.blogs.length, 1205);
  assert.equal(new Set(backup.tables.blogs.map((row) => row.id)).size, 1205);
  assert.equal(backup.manifest.scope, 'selected-content');
  assert.equal(backup.manifest.omitted_tables.length, 8);
  const reads = h.calls.filter(({ options }) => options.method === 'GET');
  assert.equal(reads.length, 10);
  assert.deepEqual(reads.map(({ url }) => Number(url.searchParams.get('offset') || 0)), [0, 123, 246, 369, 492, 615, 738, 861, 984, 1107]);
  reads.forEach(({ url, options }) => {
    assert.equal(url.searchParams.get('order'), 'id.asc');
    assert.equal(options.headers.Prefer, 'count=exact');
    assert.equal(options.headers['x-dashboard-session'], 'fixture-session-secret');
  });
  assert.equal(progress.at(-1).records, 1205);
});

test('empty tables still produce a valid zero-record backup', async () => {
  const h = setup();
  const backup = await h.NC.backup.collect(['settings']);
  assert.equal(backup.manifest.total_records, 0);
  assert.deepEqual(plain(backup.tables), { settings: [] });
});

test('deduplicates selected sections and preserves real Supabase table names', async () => {
  const h = setup();
  const backup = await h.NC.backup.collect(['submissions', 'books', 'books']);
  assert.deepEqual(Object.keys(backup.tables).sort(), ['pdf_books', 'submitted_blogs']);
});

test('rejects empty or unsupported selections before any API call', async () => {
  const h = setup();
  await assert.rejects(h.NC.backup.collect([]), /at least one/);
  await assert.rejects(h.NC.backup.collect(['dashboard_users']), /not supported/);
  await assert.rejects(h.NC.backup.collect(['__proto__']), /not supported/);
  assert.equal(h.calls.length, 0);
});

test('requires Settings and matching menu permissions and secure login', async () => {
  for (const options of [{ permissions: ['blogs'] }, { permissions: ['settings'] }, { legacy: true }]) {
    const h = setup(options);
    await assert.rejects(h.NC.backup.collect(['blogs']), /session or permissions|secure login/);
    assert.equal(h.calls.length, 0);
  }
});

test('server revocation fails closed even when public tables are readable', async () => {
  const h = setup({ datasets: { blogs: rows(1) }, respond: ({ url, options }, { json }) => {
    if (url.pathname.endsWith('/rpc/dashboard_has_permission') && JSON.parse(options.body).p_permission === 'blogs') {
      return json(false);
    }
  } });
  await assert.rejects(h.NC.backup.collect(['blogs']), /could not confirm/);
});

test('permission-check network failures never count as validated access', async () => {
  const h = setup({ respond: () => { throw new Error('Offline'); } });
  await assert.rejects(h.NC.backup.collect(['blogs']), /Unable to reach Supabase/);
  assert.equal(h.calls.length, 1);
});

test('missing access-control migration provides an actionable error', async () => {
  const h = setup({ respond: (_, { json }) => json({ code: 'PGRST202', message: 'Function not found' }, undefined, 404) });
  await assert.rejects(h.NC.backup.collect(['blogs']), /migration 004/);
});

test('missing exact Content-Range fails rather than silently truncating the backup', async () => {
  const h = setup({ respond: ({ options }, { json }) => options.method === 'GET' ? json(rows(2)) : undefined });
  await assert.rejects(h.NC.backup.collect(['blogs']), /exact record count/);
  const page = await h.NC.api.list('blogs');
  assert.equal(page.hasExactCount, false);
  assert.equal(page.count, 2, 'Existing list consumers retain their fallback count');
});

test('count changes, empty intermediate pages and repeated IDs abort with no partial result', async () => {
  for (const kind of ['changed', 'empty', 'duplicate', 'missing-id', 'excess']) {
    const h = setup({ cap: 1, datasets: { blogs: rows(3) }, respond: ({ url, options }, { json }) => {
      if (options.method !== 'GET') return;
      if (kind === 'missing-id') return json([{ title: 'invalid' }], 1);
      if (kind === 'excess') return json(rows(2), 1);
      if (!url.searchParams.has('offset')) return;
      if (kind === 'changed') return json(rows(1), 4);
      if (kind === 'empty') return json([], 3);
      if (kind === 'duplicate') return json(rows(1), 3);
    } });
    await assert.rejects(h.NC.backup.collect(['blogs']), /changed during|incomplete page|missing or duplicate/);
  }
});

test('local logout/account switch while reading aborts the export', async () => {
  const h = setup({ datasets: { blogs: rows(1) }, respond: ({ options }, { auth }) => {
    if (options.method === 'GET') auth.token = 'a-different-session';
  } });
  await assert.rejects(h.NC.backup.collect(['blogs']), /session or permissions changed/);
});

test('cancelled exports stop before requests and cancel in-flight fetches without a timeout message', async () => {
  const first = setup();
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(first.NC.backup.collect(['blogs'], { signal: cancelled.signal }), { name: 'AbortError' });
  assert.equal(first.calls.length, 0);

  const controller = new AbortController();
  let started;
  const waitForRequest = new Promise((resolve) => { started = resolve; });
  const h = setup({ respond: ({ options }) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    started();
  }) });
  const pending = h.NC.backup.collect(['blogs'], { signal: controller.signal });
  await waitForRequest; controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(h.calls.length, 1);
});

test('ordinary API timeouts remain distinct from user cancellation', async () => {
  const h = setup({ respond: ({ options }) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) });
  await assert.rejects(h.NC.api.request('https://fixture.supabase.invalid/test', { timeout: 5 }),
    (error) => error.code === 'TIMEOUT' && /timed out/.test(error.message));
});
