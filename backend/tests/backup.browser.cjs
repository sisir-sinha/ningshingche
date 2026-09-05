'use strict';

// All non-local traffic is intercepted. These tests never reach production Supabase.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { once } = require('node:events');

const backend = path.resolve(__dirname, '..');
const tableKeys = { authors: 'authors', categories: 'categories', blogs: 'blogs', comments: 'comments',
  galleries: 'galleries', books: 'pdf_books', submissions: 'submitted_blogs', videos: 'videos', settings: 'settings' };
const allPermissions = ['dashboard', ...Object.keys(tableKeys), 'analytics', 'access-control'];
const datasets = Object.fromEntries(Object.values(tableKeys).map((table) => [table, [{ id: `${table}-1`, title: table }]]));
datasets.settings = [{ id: 'site_settings', site_title: 'Ningshing Che', contact_email: 'editor@example.test' }];
datasets.blogs = Array.from({ length: 1205 }, (_, index) => ({
  id: String(index).padStart(6, '0'), title: `নিংশিং চে ${index}`, status: index % 2 ? 'Draft' : 'Publish',
  content: '<p>বিষ্ণুপ্রিয়া মণিপুরি তথ্যকোষ</p>', author_id: 'authors-1', category_id: 'categories-1'
}));

const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(backend, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${backend}${path.sep}`)) { response.writeHead(403).end(); return; }
    const content = await fs.readFile(file);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(content);
  } catch (_) { response.writeHead(404).end(); }
});

async function fixture(browser, base, { permissions = allPermissions, legacy = false, width = 1440 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [], calls = [], unexpected = [];
  const mode = { fail: false, missingCount: false, revoke: false, block: false, release: null, savePayloads: [] };
  const user = { id: 'backup-test-user', username: 'backup-test', name: 'Backup Test', role: 'Administrator',
    role_slug: permissions.includes('access-control') ? 'super-admin' : 'administrator', permissions };
  const expires = Date.now() + 3600000;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.addInitScript(({ user, expires, legacy }) => {
    sessionStorage.setItem('nc:admin-session', JSON.stringify({
      version: legacy ? 1 : 2, mode: legacy ? 'legacy-demo' : 'supabase-rbac',
      token: legacy ? undefined : 'fixture-token-not-a-real-session', dashboardToken: legacy ? 'fixture-legacy' : undefined,
      expiresAt: expires, issuedAt: Date.now(), user
    }));
  }, { user, expires, legacy });

  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === base) { await route.continue(); return; }
    const json = (body, headers = {}, status = 200) => route.fulfill({ status,
      contentType: 'application/json', body: JSON.stringify(body), headers: {
        'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers
      } });
    if (url.hostname.endsWith('.supabase.co')) {
      calls.push({ path: url.pathname, query: url.search, method: request.method() });
      if (url.pathname.endsWith('/rpc/dashboard_session')) {
        return legacy ? json({ code: 'PGRST202', message: 'Missing function' }, {}, 404)
          : json({ ok: true, user, expires_at: new Date(expires).toISOString() });
      }
      if (url.pathname.endsWith('/rpc/dashboard_has_permission')) {
        const key = request.postDataJSON().p_permission;
        return json(permissions.includes(key) && !(mode.revoke && key === 'blogs'));
      }
      const table = url.pathname.split('/').pop();
      if (request.method() === 'POST' && table === 'settings') {
        mode.savePayloads.push(request.postDataJSON());
        return json([request.postDataJSON()]);
      }
      if (request.method() !== 'GET' || !Object.values(tableKeys).includes(table)) {
        unexpected.push(`${request.method()} ${url.pathname}`);
        return json({ message: 'Unexpected test request' }, {}, 403);
      }
      const isBackup = url.searchParams.get('limit') === '500';
      if (mode.block && isBackup) {
        await new Promise((resolve) => { mode.release = resolve; });
      }
      if (mode.fail && isBackup && table === 'blogs') return json({ message: 'Simulated backup failure' }, {}, 503);
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Math.min(Number(url.searchParams.get('limit') || 200), 200);
      const all = datasets[table], rows = all.slice(offset, offset + limit);
      const headers = mode.missingCount && isBackup ? {} : { 'content-range': `${offset}-${offset + Math.max(0, rows.length - 1)}/${all.length}` };
      try { return await json(rows, headers); } catch (_) { /* A cancelled request may already be gone. */ }
      return;
    }
    // Deterministic CDN fallbacks exercise the dashboard without external network access.
    if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'text/javascript', body: 'window.tailwind = {};' });
    if (url.pathname.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: '' });
    if (url.pathname.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    return route.abort();
  });
  await page.goto(`${base}/#/settings`, { waitUntil: 'networkidle' });
  await page.locator('#settings-backup').waitFor();
  return { page, context, mode, calls, pageErrors, unexpected,
    async check() {
      assert.deepEqual(unexpected, []);
      assert.deepEqual(pageErrors, []);
      if (mode.release) mode.release();
      await context.close();
    } };
}

async function createBackup(h) {
  await h.page.locator('[data-backup-create]').click();
  try {
    await h.page.locator('[data-backup-result]').waitFor({ state: 'visible', timeout: 10000 });
  } catch (error) {
    throw new Error(`Backup did not complete: ${await h.page.locator('[data-backup-error]').textContent()} | ${await h.page.locator('[data-backup-progress-text]').textContent()} | page errors: ${h.pageErrors.join('; ')}`, { cause: error });
  }
}

async function download(h) {
  const pending = h.page.waitForEvent('download');
  await h.page.locator('[data-backup-download]').click();
  const file = await pending;
  assert.match(file.suggestedFilename(), /^ningshing-che-backup-.*\.json$/);
  const text = await fs.readFile(await file.path(), 'utf8');
  assert.equal(text.includes('fixture-token-not-a-real-session'), false);
  assert.equal(text.includes('backup-test-user'), false);
  return JSON.parse(text);
}

(async () => {
  server.listen(0, '0.0.0.0');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const h = await fixture(browser, base);
    await h.page.locator('.settings-nav a[href="#settings-backup"]').click();
    assert.equal(new URL(h.page.url()).hash, '#/settings', 'Section links must not trigger a 404 route');
    assert.equal(await h.page.locator('#settings-backup').evaluate((el) => el === document.activeElement), true);
    await createBackup(h);
    const backup = await download(h);
    assert.equal(Object.keys(backup.tables).length, 9);
    assert.equal(backup.tables.blogs.length, 1205);
    assert.equal(backup.tables.blogs[1].title, 'নিংশিং চে 1');
    assert.equal(backup.manifest.total_records, 1213);
    assert.equal(backup.manifest.scope, 'all-content');
    assert.equal(h.mode.savePayloads.length, 0, 'Creating/downloading never submits the settings form');
    const stored = await h.page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('nc:backup-downloads:')));
    assert.equal(stored.length, 1);
    const entries = JSON.parse(stored[0][1]);
    assert.deepEqual(Object.keys(entries[0]).sort(), ['bytes', 'filename', 'records', 'requested_at']);
    assert.equal(entries[0].records, 1213);
    await h.page.locator('[data-backup-download]').click();
    assert.equal(await h.page.locator('.backup-history-list li').count(), 1, 'Repeat downloads are deduplicated');
    if (process.env.BACKUP_SCREENSHOTS) {
      await fs.mkdir(process.env.BACKUP_SCREENSHOTS, { recursive: true });
      await h.page.locator('#settings-backup').screenshot({ path: path.join(process.env.BACKUP_SCREENSHOTS, 'backup-desktop.png') });
    }
    // Selection updates invalidate the old file, and zero selection disables export.
    await h.page.locator('input[name="backup_scope"][value="selected"]').check();
    assert.equal(await h.page.locator('[data-backup-result]').isVisible(), false);
    await h.page.locator('[data-backup-clear]').click();
    assert.equal(await h.page.locator('[data-backup-create]').isDisabled(), true);
    await h.page.locator('[data-backup-section][value="settings"]').check();
    await createBackup(h);
    assert.deepEqual(Object.keys((await download(h)).tables), ['settings']);
    // Existing settings save must remain independent of backup controls.
    await h.page.locator('#settings-site_title').fill('Edited site title');
    await h.page.locator('[data-save-settings]').first().click();
    await h.page.waitForFunction(() => document.querySelector('[data-save-settings]').disabled === false);
    assert.equal(h.mode.savePayloads.at(-1).site_title, 'Edited site title');
    assert.equal('backup_scope' in h.mode.savePayloads.at(-1), false);
    await h.check();
    console.log('PASS desktop: navigation, all tables, >1,000 rows, Unicode download, history, selected export, Settings save');

    for (const failure of ['fail', 'missingCount', 'revoke']) {
      const h = await fixture(browser, base);
      h.mode[failure] = true;
      await h.page.locator('[data-backup-create]').click();
      await h.page.locator('[data-backup-error]').waitFor({ state: 'visible' });
      assert.equal(await h.page.locator('[data-backup-result]').isVisible(), false);
      assert.equal(await h.page.locator('.backup-history-list li').count(), 0);
      assert.equal(await h.page.locator('[data-backup-create]').isEnabled(), true);
      h.mode[failure] = false;
      await createBackup(h); // Retry without a reload.
      await h.check();
    }
    console.log('PASS fail-closed errors and retry: server failure, missing counts, revoked permissions');

    const cancelled = await fixture(browser, base);
    cancelled.mode.block = true;
    await cancelled.page.locator('[data-backup-create]').click();
    await cancelled.page.locator('[data-backup-cancel]').click();
    await cancelled.page.locator('[data-backup-message]').filter({ hasText: 'cancelled' }).waitFor({ state: 'visible' });
    assert.equal(await cancelled.page.locator('[data-backup-result]').isVisible(), false);
    await cancelled.check();
    console.log('PASS cancellation: active request aborted, no file and no success history');

    const limited = await fixture(browser, base, { permissions: ['settings', 'blogs'] });
    assert.equal(await limited.page.locator('[data-backup-selection-summary]').textContent(), '2 of 9 sections selected · partial content backup');
    await limited.page.locator('input[name="backup_scope"][value="selected"]').check();
    assert.equal(await limited.page.locator('[data-backup-section][value="authors"]').isDisabled(), true);
    await createBackup(limited);
    assert.deepEqual(Object.keys((await download(limited)).tables).sort(), ['blogs', 'settings']);
    await limited.check();
    const legacy = await fixture(browser, base, { legacy: true });
    assert.equal(await legacy.page.locator('[data-backup-create]').isDisabled(), true);
    await legacy.check();
    console.log('PASS role restrictions and legacy-login guard');

    for (const width of [320, 375, 768, 1024, 1440]) {
      const h = await fixture(browser, base, { width });
      await h.page.goto(`${base}/#/settings?section=backup`);
      await h.page.locator('#settings-backup').waitFor();
      await createBackup(h);
      for (const theme of ['dark', 'light']) {
        await h.page.evaluate((theme) => window.NC.app.setTheme(theme), theme);
        const overflow = await h.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        assert.equal(overflow, false, `${width}px ${theme} layout should not overflow`);
      }
      if (process.env.BACKUP_SCREENSHOTS && width === 375) {
        await h.page.locator('#settings-backup').screenshot({ path: path.join(process.env.BACKUP_SCREENSHOTS, 'backup-mobile.png') });
      }
      // Destroying the view must remove the active result and permit a fresh visit.
      await h.page.goto(`${base}/#/blogs`);
      await h.page.locator('#settings-backup').waitFor({ state: 'detached' });
      await h.page.goto(`${base}/#/settings?section=backup`);
      await h.page.locator('#settings-backup').waitFor();
      assert.equal(await h.page.locator('[data-backup-result]').isVisible(), false);
      await h.check();
    }
    console.log('PASS 320/375/768/1024/1440px dark/light layouts and route cleanup');
    console.log('All browser checks passed. No production requests were made.');
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
