'use strict';

// Fixture-only browser smoke test for the filter / tag / registered-user
// features. Every *.supabase.co request is intercepted; nothing reaches
// production. CDN libraries (Tailwind, Quill, Chart.js, DOMPurify) are loaded
// for real so the editor and charts render; run with NC_OFFLINE=1 to stub them.
//
//   npx playwright install chromium   (once)
//   node filters.browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { chromium } = require('playwright');

const backend = path.resolve(__dirname, '..');
const shots = path.join(__dirname, 'screenshots');
const permissions = ['dashboard', 'authors', 'categories', 'blogs', 'comments', 'galleries', 'books', 'submissions', 'videos', 'settings', 'analytics', 'access-control', 'registered-users'];

const authors = [
  { id: 'author-1', title: 'সুকান্ত সিংহ', image: '' },
  { id: 'author-2', title: 'পলাশ সিংহ হিমাদ্র', image: '' },
  { id: 'author-3', title: 'কুঙ্গ থাঙ', image: '' }
];
const categories = [{ id: 'cat-1', title: 'সাহিত্য', slug: 'sahitya' }, { id: 'cat-2', title: 'সংস্কৃতি', slug: 'sanskriti' }];
const issueTags = ['নিংশিং চে - ২০২৩', 'নিংশিং চে-২০২৪', 'নিংশিং চে - ২০২২', 'নিংশিং চে-2016'];
const blogs = Array.from({ length: 40 }, (_, index) => ({
  id: `blog-${index}`, title: `নিংশিং চে প্রবন্ধ ${index}`, slug: `article-${index}`, status: index % 5 ? 'Publish' : 'Draft',
  content: '<p>বিষ্ণুপ্রিয়া মণিপুরি তথ্যকোষ</p>', author_id: authors[index % 3].id, author_name: authors[index % 3].title,
  category_id: categories[index % 2].id, category_title: categories[index % 2].title,
  tags: [issueTags[index % 4], index % 2 ? '৮ম সংখ্যা' : 'সাহিত্য', ...(index % 7 === 0 ? ['ভাষা আন্দোলন'] : [])],
  created_at: new Date(2026, 8 - (index % 6), 1 + (index % 20)).toISOString(), published_date: '2026-01-10'
}));
const profiles = [
  { id: 'user-1', name: 'রিতা সিংহ', email: 'rita@example.test', avatar_url: '', designation: 'Teacher', profile_completed: true, notifications_enabled: true, created_at: '2026-07-04T10:00:00Z' },
  { id: 'user-2', name: 'অমিত সিংহ', email: 'amit@example.test', avatar_url: '', designation: '', profile_completed: false, notifications_enabled: false, created_at: '2026-08-14T10:00:00Z' },
  { id: 'user-3', name: 'নীলা দেবী', email: 'nila@example.test', avatar_url: '', designation: 'Student', profile_completed: true, notifications_enabled: true, created_at: '2026-09-01T10:00:00Z' }
];
const submissions = [
  { id: 'sub-1', title: 'আমার গ্রাম', content_title: 'আমার গ্রাম', content: '<p>গ্রামের কথা</p>', status: 'Pending', user_id: 'user-1', writer_name: 'রিতা সিংহ', writer_email: 'rita@example.test', thumbnail: '', created_at: '2026-09-02T09:00:00Z' },
  { id: 'sub-2', title: 'ভাষা ও সংস্কৃতি', content_title: 'ভাষা ও সংস্কৃতি', content: '<p>ভাষার কথা</p>', status: 'Published', user_id: 'user-2', writer_name: 'অমিত সিংহ', writer_email: 'amit@example.test', thumbnail: '', created_at: '2026-08-20T09:00:00Z' },
  { id: 'sub-3', title: 'পুরনো লেখা', content_title: 'পুরনো লেখা', content: '<p>...</p>', status: 'Approved', converted_blog_id: 'blog-3', user_id: 'user-1', writer_name: 'রিতা সিংহ', writer_email: 'rita@example.test', thumbnail: '', created_at: '2026-07-20T09:00:00Z' }
];
const comments = Array.from({ length: 12 }, (_, index) => ({
  id: `comment-${index}`, blog_id: blogs[index % 6].id, blog_title: blogs[index % 6].title, name: index % 3 ? 'সংস্কৃতি অনুরাগী' : 'রিতা সিংহ',
  email: index % 3 ? `reader${index % 2}@example.test` : 'rita@example.test', user_id: index % 3 ? null : 'user-1',
  content: `মন্তব্য ${index}`, status: index % 4 ? 'Publish' : 'Unpublish', created_at: new Date(2026, 8, 1 + index).toISOString()
}));
const messages = [
  { id: 'm-1', user_id: 'user-1', sender: 'user', body: 'নমস্কার', is_read: false, created_at: '2026-09-05T10:00:00Z' },
  { id: 'm-2', user_id: 'user-1', sender: 'admin', body: 'নমস্কার, বলুন', is_read: true, created_at: '2026-09-05T10:05:00Z' },
  { id: 'm-3', user_id: 'user-2', sender: 'user', body: 'আমার লেখাটা কি পেয়েছেন?', is_read: true, created_at: '2026-09-04T10:00:00Z' }
];
const notices = [
  { id: 'n-1', user_id: 'user-1', kind: 'staff_notice', title: 'স্বাগতম', body: 'অ্যাপে স্বাগতম', is_read: true, related_id: 'r-1', created_at: '2026-09-01T10:00:00Z' },
  { id: 'n-2', user_id: 'user-2', kind: 'staff_notice', title: 'স্বাগতম', body: 'অ্যাপে স্বাগতম', is_read: false, related_id: 'r-1', created_at: '2026-09-01T10:00:00Z' }
];
const datasets = {
  authors, categories, blogs, comments, profiles, submitted_blogs: submissions, admin_messages: messages, user_notifications: notices,
  galleries: [], pdf_books: [], videos: [], settings: [{ id: 'site_settings', site_title: 'Ningshing Che' }]
};

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

function applyPostgrest(rows, params) {
  let result = rows;
  for (const [key, raw] of params.entries()) {
    if (['select', 'order', 'limit', 'offset', 'or'].includes(key)) continue;
    const [op, ...rest] = raw.split('.');
    const value = rest.join('.');
    if (op === 'eq') result = result.filter((row) => String(row[key]) === value);
    if (op === 'in') { const set = value.replace(/^\(|\)$/g, '').split(','); result = result.filter((row) => set.includes(String(row[key]))); }
    if (op === 'ov' || op === 'cs') {
      const wanted = [...value.matchAll(/"((?:[^"\\]|\\.)*)"|([^,{}"]+)/g)].map((m) => (m[1] ?? m[2]).replace(/\\"/g, '"'));
      result = result.filter((row) => Array.isArray(row[key]) && (op === 'ov' ? wanted.some((w) => row[key].includes(w)) : wanted.every((w) => row[key].includes(w))));
    }
  }
  return result;
}

async function main() {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  await fs.mkdir(shots, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const pageErrors = [], calls = [], unexpected = [], consoleErrors = [];
  const user = { id: 'smoke-user', username: 'smoke', name: 'Smoke Test', role: 'Administrator', role_slug: 'super-admin', permissions };
  const expires = Date.now() + 3600000;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await context.addInitScript(({ user, expires }) => {
    sessionStorage.setItem('nc:admin-session', JSON.stringify({ version: 2, mode: 'supabase-rbac', token: 'fixture-token', expiresAt: expires, issuedAt: Date.now(), user }));
  }, { user, expires });

  let tagEndpoints = false; // toggled to simulate migration 013 being installed
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === base) return route.continue();
    const json = (body, headers = {}, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers } });
    if (url.hostname.endsWith('.supabase.co')) {
      calls.push({ path: url.pathname, query: decodeURIComponent(url.search), method: request.method(), body: request.postData() });
      if (url.pathname.endsWith('/rpc/dashboard_session')) return json({ ok: true, user, expires_at: new Date(expires).toISOString() });
      if (url.pathname.endsWith('/rpc/dashboard_has_permission')) return json(permissions.includes(request.postDataJSON().p_permission));
      if (url.pathname.includes('/rpc/blogs_by_issue')) {
        if (!tagEndpoints) return json({ code: 'PGRST202', message: 'missing' }, {}, 404);
        const year = request.postDataJSON().p_year;
        return json(blogs.filter((blog) => blog.tags.some((tag) => tag.replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)).includes(String(year)))));
      }
      if (url.pathname.includes('/rpc/')) return json({ code: 'PGRST202', message: 'missing' }, {}, 404);
      const table = url.pathname.split('/').pop();
      if (table === 'blog_tag_counts') return tagEndpoints ? json([]) : json({ code: 'PGRST205', message: 'Could not find the table' }, {}, 404);
      if (request.method() === 'PATCH' && table === 'submitted_blogs') {
        const id = url.searchParams.get('id').replace('eq.', '');
        const row = submissions.find((item) => item.id === id);
        Object.assign(row, request.postDataJSON());
        return json([row]);
      }
      if (request.method() === 'POST' && table === 'submitted_blogs') {
        const row = { id: `sub-${submissions.length + 1}`, created_at: new Date().toISOString(), ...request.postDataJSON() };
        submissions.push(row);
        return json([row]);
      }
      if (request.method() !== 'GET' || !datasets[table]) { unexpected.push(`${request.method()} ${url.pathname}${url.search}`); return json({ message: 'Unexpected test request' }, {}, 403); }
      const rows = applyPostgrest(datasets[table], url.searchParams);
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Math.min(Number(url.searchParams.get('limit') || 200), 5000);
      const slice = rows.slice(offset, offset + limit);
      return json(slice, { 'content-range': `${offset}-${offset + Math.max(0, slice.length - 1)}/${rows.length}` });
    }
    if (process.env.NC_OFFLINE) {
      if (url.hostname === 'cdn.tailwindcss.com') return route.fulfill({ contentType: 'text/javascript', body: 'window.tailwind = {};' });
      if (url.pathname.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      if (url.pathname.endsWith('.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
      return route.abort();
    }
    if (/\.(png|jpe?g|webp|gif|woff2?|ttf)$/i.test(url.pathname) || url.hostname.includes('imgbb')) return route.abort();
    return route.continue();
  });

  const goto = async (hash) => {
    await page.goto(`${base}/#/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
  };
  const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
  const text = async (selector) => (await page.locator(selector).first().textContent())?.trim();
  const rowCount = () => page.locator('[data-blogs-content] tbody tr').count();
  const totalText = async (scope) => (await page.locator(`${scope} .pagination-summary, ${scope} [data-pagination-summary]`).first().textContent().catch(() => '')) || '';
  const listTotal = () => page.evaluate(() => {
    const el = document.querySelector('[data-blogs-content] .pagination, [data-blogs-content] nav[aria-label*="agination"]');
    const match = (el?.textContent || '').match(/of\s+(\d+)/i);
    return match ? Number(match[1]) : null;
  });

  // ---------------------------------------------------------------- Blogs: filters
  await goto('blogs');
  await page.locator('[data-blog-issue]').waitFor();
  const issueOptions = await page.locator('[data-blog-issue] option').allTextContents();
  console.log('issue options:', issueOptions);
  assert.equal(issueOptions.length, 5, 'four issue years (data-only) + placeholder');
  assert.ok(issueOptions[1].startsWith('নিংশিং চে-২০২৪'), 'newest issue first, canonical label');
  const tagOptions = await page.locator('[data-blog-tag] option').allTextContents();
  console.log('other tag options:', tagOptions);
  assert.ok(tagOptions.some((item) => item.startsWith('#৮ম সংখ্যা')) && !tagOptions.some((item) => item.includes('নিংশিং চে')), 'issue tags excluded from other tags');
  assert.equal((await page.locator('[data-blog-author] option').count()), 4);
  // chevron: computed background-image must be the inline SVG, not none
  const bg = await page.locator('[data-blog-status]').evaluate((el) => getComputedStyle(el).backgroundImage);
  assert.ok(bg.includes('data:image/svg+xml'), `select chevron missing: ${bg}`);
  const appearance = await page.locator('[data-blog-status]').evaluate((el) => getComputedStyle(el).appearance);
  assert.equal(appearance, 'none');
  await shot('blogs-list');

  await page.locator('[data-blog-issue]').selectOption('2023');
  await page.waitForTimeout(150);
  const issueRows = await rowCount();
  console.log('rows for issue 2023:', issueRows);
  assert.equal(issueRows, 10, 'blogs tagged "নিংশিং চে - ২০২৩" only');
  assert.ok(page.url().includes('issue=2023'), `url should carry issue param: ${page.url()}`);
  assert.equal((await text('[data-blog-active-filters]')).replace(/\s+/g, ' '), 'Filters Issue:নিংশিং চে-২০২৩', 'active filter chip rendered');
  await page.locator('[data-blog-author]').selectOption('author-1');
  await page.waitForTimeout(150);
  console.log('rows for issue 2023 + author 1:', await rowCount());
  assert.ok((await rowCount()) < issueRows && (await rowCount()) > 0);
  await shot('blogs-filtered');
  // chip click filters other tags
  await page.locator('[data-filter-clear]').click();
  await page.waitForTimeout(150);
  assert.equal(await rowCount(), 10, 'clear all returns to first page (10 per page) of full list');
  assert.equal(await page.locator('[data-blog-active-filters]').isVisible(), false);
  await page.locator('[data-tag-filter]').filter({ hasText: 'ভাষা আন্দোলন' }).first().click();
  await page.waitForTimeout(150);
  assert.equal(await rowCount(), 6, 'tag chip filters by normalised key');
  assert.equal(await page.locator('[data-blog-tag]').inputValue(), 'ভাষাআন্দোলন');

  // deep-link: ?tag=<issue spelling> becomes issue filter; ?issue=২০২৪ Bengali digits accepted
  await goto('blogs?issue=২০২৪');
  await page.locator('[data-blogs-content] tbody tr').first().waitFor();
  assert.equal(await page.locator('[data-blog-issue]').inputValue(), '2024');
  assert.equal(await rowCount(), 10);
  assert.equal(await page.evaluate(() => NC.tags.index(document.__blogs || []).issues.length), 0); // sanity: helper is exposed
  await goto('blogs?tag=নিংশিং চে-2022&filter=Draft');
  await page.locator('[data-blog-issue]').waitFor();
  assert.equal(await page.locator('[data-blog-issue]').inputValue(), '2022');
  assert.equal(await page.locator('[data-blog-status]').inputValue(), 'Draft');

  // ---------------------------------------------------------------- Blogs: editor issue picker
  await goto('blogs?action=edit&id=blog-1');
  await page.locator('#blog-issue').waitFor();
  assert.equal(await page.locator('#blog-issue').inputValue(), '2024', 'existing issue tag pre-selected');
  assert.equal(await page.locator('#blog-tags').inputValue(), '৮ম সংখ্যা', 'issue tag removed from free-text tags');
  const issueChoices = await page.locator('#blog-issue option').allTextContents();
  assert.ok(issueChoices.some((item) => item.includes('২০২৬')) && issueChoices.some((item) => item.includes('২০২৭')), 'current + next year offered');
  const heroChevron = await page.locator('#blog-status').evaluate((el) => getComputedStyle(el).backgroundImage);
  assert.ok(heroChevron.includes('svg'), 'editor select chevron');
  await shot('blogs-editor');
  await page.locator('#blog-issue').selectOption('__custom__');
  assert.ok(await page.locator('#blog-issue-custom').isVisible());

  // ---------------------------------------------------------------- Comments
  await goto('comments');
  await page.locator('[data-comment-author]').waitFor();
  await page.waitForTimeout(300);
  const authorOpts = await page.locator('[data-comment-author] option').allTextContents();
  const commenterOpts = await page.locator('[data-comment-commenter] option').allTextContents();
  console.log('comment author options:', authorOpts);
  console.log('commenter options:', commenterOpts);
  assert.equal(authorOpts.length, 4, 'three blog authors');
  assert.ok(commenterOpts.some((item) => item.includes('app user')), 'registered commenters flagged');
  await page.locator('[data-comment-author]').selectOption('author-1');
  await page.waitForTimeout(150);
  const byAuthor = await page.locator('[data-comments-content] tbody tr').count();
  console.log('comments for author-1 blogs:', byAuthor);
  assert.ok(byAuthor > 0 && byAuthor < 12);
  await page.locator('[data-comment-author]').selectOption('all');
  await page.locator('[data-comment-commenter]').selectOption({ index: 1 });
  await page.waitForTimeout(150);
  assert.ok((await page.locator('[data-comments-content] tbody tr').count()) > 0);
  await shot('comments-filtered');
  await goto('comments?user=user-1');
  await page.locator('[data-comments-content] tbody tr').first().waitFor();
  assert.equal(await page.locator('[data-comment-commenter]').inputValue(), 'user:user-1');
  assert.equal(await page.locator('[data-comments-content] tbody tr').count(), 4);
  assert.equal(await page.locator('[data-comment-active-filters] .filter-chip').count(), 1);

  // ---------------------------------------------------------------- Registered users home: charts
  await goto('registered-users');
  await page.locator('#ru-chart-growth').waitFor();
  await page.waitForTimeout(600);
  const chartCount = await page.evaluate(() => [...document.querySelectorAll('.ru-chart-grid canvas')].filter((canvas) => canvas.width > 0 && canvas.getContext('2d')).length);
  assert.equal(chartCount, 6, 'six chart canvases');
  const chartInstances = await page.evaluate(() => window.Chart ? Object.keys(window.Chart.instances).length : -1);
  console.log('chart instances:', chartInstances);
  assert.equal(chartInstances, 6);
  await shot('registered-users-home');

  // ---------------------------------------------------------------- ru-articles: filters, editor, add
  await goto('ru-articles');
  await page.locator('[data-ru-user-filter]').waitFor();
  assert.equal(await page.locator('[data-ru-user-filter] option').count(), 3, 'two users with articles');
  await page.locator('[data-ru-user-filter]').selectOption('user-1');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-ru-table] tbody tr').count(), 2);
  assert.ok((await page.locator('[data-ru-table] [data-action="approve"]').count()) === 1, 'pending article offers Approve & convert');
  await shot('ru-articles');
  await page.locator('[data-ru-table] [data-action="edit"]').first().click();
  await page.locator('#ru-article-editor').waitFor();
  await page.waitForTimeout(500);
  assert.ok(await page.locator('#ru-article-content .ql-editor').count(), 'Quill mounted in article editor');
  assert.equal(await page.locator('#ru-article-user').inputValue(), 'user-1');
  assert.ok(await page.locator('[data-article-approve]').isVisible());
  await shot('ru-article-editor');
  await page.locator('#ru-article-title').fill('আমার গ্রাম (সম্পাদিত)');
  await page.locator('[data-article-save="__keep__"]').click();
  await page.locator('[data-ru-table]').waitFor();
  await page.waitForTimeout(400);
  const patch = calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/submitted_blogs'));
  assert.ok(patch, 'article saved via PATCH');
  const patched = JSON.parse(patch.body);
  assert.equal(patched.title, 'আমার গ্রাম (সম্পাদিত)');
  assert.equal(patched.user_id, 'user-1');
  assert.ok(Array.isArray(patched.inline_media));
  assert.ok(!('id' in patched) && !('created_at' in patched), 'payload only carries editable columns');

  await page.locator('[data-ru-add-article]').first().click();
  await page.locator('#ru-article-editor').waitFor();
  await page.waitForTimeout(400);
  await page.locator('#ru-article-user').selectOption('user-3');
  assert.equal(await page.locator('#ru-article-writer').inputValue(), 'নীলা দেবী', 'writer fields follow selected profile');
  await page.locator('#ru-article-title').fill('নতুন লেখা');
  await page.locator('#ru-article-content .ql-editor').fill('নতুন লেখার বিষয়বস্তু');
  await page.locator('[data-article-save="Published"]').click();
  await page.locator('[data-ru-table]').waitFor();
  await page.waitForTimeout(400);
  const insert = calls.find((call) => call.method === 'POST' && call.path.endsWith('/submitted_blogs'));
  assert.ok(insert, 'article created via POST');
  const inserted = JSON.parse(insert.body);
  assert.equal(inserted.status, 'Published');
  assert.equal(inserted.user_id, 'user-3');
  assert.equal(inserted.writer_email, 'nila@example.test');
  assert.ok(inserted.content.includes('নতুন লেখার বিষয়বস্তু'));

  // approval modal opens from the list
  await page.locator('[data-ru-table] [data-action="approve"]').first().click();
  await page.locator('#ru-approval-form').waitFor();
  assert.equal(await page.locator('#ru-approval-category option').count(), 3);
  await shot('ru-article-approve');
  await page.locator('button[data-modal-close]').first().click();
  await page.waitForTimeout(300);

  // ---------------------------------------------------------------- ru-messages: user filter
  await goto('ru-messages');
  await page.locator('[data-ru-user-filter]').waitFor();
  assert.equal(await page.locator('[data-ru-user-filter] option').count(), 3);
  await page.locator('[data-ru-user-filter]').selectOption('user-2');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-ru-table] tbody tr').count(), 1);
  await page.locator('[data-ru-unread-filter]').selectOption('unread');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-ru-table] tbody tr').count(), 0, 'user-2 has no unread');
  await page.locator('[data-filter-clear]').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-ru-table] tbody tr').count(), 2);
  await goto('ru-messages?user=user-1');
  await page.locator('[data-ru-table] tbody tr').first().waitFor();
  assert.equal(await page.locator('[data-ru-table] tbody tr').count(), 1);
  await shot('ru-messages');

  // ---------------------------------------------------------------- server-side endpoints path (migration 013 present)
  tagEndpoints = true;
  assert.equal(await page.evaluate(() => NC.api.probeTagEndpoints()), true, 'probe detects migration 013');
  const rpcResult = await page.evaluate(() => NC.api.blogsByIssue('২০২৩').then((r) => r.data.length));
  assert.equal(rpcResult, 10, 'blogsByIssue via RPC');
  assert.ok(calls.some((call) => call.path.endsWith('/rpc/blogs_by_issue') && call.body.includes('"p_year":2023')));
  tagEndpoints = false;
  assert.equal(await page.evaluate(() => NC.api.probeTagEndpoints()), false, 'probe detects missing view');
  const fallback = await page.evaluate(() => NC.api.blogsByIssue(2024).then((r) => r.data.length));
  assert.equal(fallback, 10, 'blogsByIssue via tags=ov fallback');
  const ovCall = calls.filter((call) => call.query.includes('tags=ov.')).pop();
  assert.ok(ovCall && ovCall.query.replace(/\+/g, ' ').includes('"নিংশিং চে-২০২৪"'), `fallback overlaps issue spellings: ${ovCall?.query}`);
  const byTag = await page.evaluate(() => NC.api.blogsByTag('#সাহিত্য ').then((r) => r.count));
  assert.equal(byTag, 20, 'blogsByTag normalises the tag');

  // ---------------------------------------------------------------- mobile width: filters stack, no horizontal overflow
  await page.setViewportSize({ width: 375, height: 800 });
  await goto('blogs?issue=2023&author=author-2&tag=ভাষাআন্দোলন');
  await page.locator('[data-blog-issue]').waitFor();
  assert.ok(await page.locator('.migration-hint').isVisible(), 'migration hint shows while 013 is missing');
  assert.equal(await page.locator('[data-blog-active-filters] .filter-chip').count(), 3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow at 375px: ${overflow}px`);
  await shot('blogs-mobile');

  const ignorable = (message) => /favicon|net::ERR_FAILED|Failed to load resource/.test(message);
  assert.deepEqual(unexpected, []);
  assert.deepEqual(pageErrors, []);
  const realConsoleErrors = consoleErrors.filter((message) => !ignorable(message));
  assert.deepEqual(realConsoleErrors, []);
  await context.close();
  await browser.close();
  server.close();
  console.log(`\nAll filter/tag/registered-user smoke checks passed. Screenshots in ${shots}`);
}

main().catch(async (error) => {
  console.error(error);
  server.close();
  process.exit(1);
});
