'use strict';

/**
 * The dashboard's Forum page (assets/js/forum.js, route `forum`) and the forum's
 * place on the index dashboard.
 *
 * Two things are worth guarding beyond "it renders":
 *
 *  * **A reader's post is never markup here.** The body is HTML written in the
 *    app; the dashboard shows it as text. The test plants a `<script>` and an
 *    `onerror` in a fixture body and asserts that neither survives as an element
 *    or an attribute — the same rule the app's own renderer keeps.
 *  * **Moderation is the database's own words.** Hiding is a PATCH of
 *    `status = 'Unpublish'` on the same table and column the app's RPCs filter
 *    on, and the answers come from the table the dashboard was granted, not from
 *    a view that is revoked.
 *
 * Needs jsdom and skips itself without it (see languages-page.test.cjs):
 *     npm install --no-save jsdom && node --test backend/tests/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let JSDOM = null;
try {
  // eslint-disable-next-line global-require
  ({ JSDOM } = require('jsdom'));
} catch {
  JSDOM = null;
}

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'assets', 'js', 'forum.js');
const DASHBOARD = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'dashboard.js'), 'utf8');
const CONFIG = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'config.js'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'api.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const DISCUSSIONS = [
  {
    id: 'd1', category_id: 'c1', user_id: 'u1', title: 'বিষ্ণুপ্রিয়া ভাষার বর্ণমালা',
    body: '<p>প্রথম লাইন</p><p>দ্বিতীয় লাইন</p><a href="https://example.test/a.pdf">উৎস.pdf</a>',
    status: 'Publish', views_count: 42, replies_count: 2, is_official: false,
    cover_image_url: '', cover_delete_url: '', created_at: '2026-09-10T04:00:00Z', last_reply_at: '2026-09-11T04:00:00Z'
  },
  {
    id: 'd2', category_id: 'c2', user_id: 'u2', title: 'উত্তর নেই',
    body: '<p>কেউ উত্তর দেয়নি</p>', status: 'Publish', views_count: 3, replies_count: 0,
    is_official: false, cover_image_url: '', cover_delete_url: '',
    created_at: '2026-09-12T04:00:00Z', last_reply_at: null
  },
  {
    id: 'd3', category_id: 'c1', user_id: 'u2', title: 'লুকানো আলোচনা',
    body: '<p>গোপন</p>', status: 'Unpublish', views_count: 9, replies_count: 1,
    is_official: true, cover_image_url: '', cover_delete_url: '',
    created_at: '2026-09-09T04:00:00Z', last_reply_at: '2026-09-09T06:00:00Z'
  }
];

const REPLIES = [
  {
    id: 'r1', discussion_id: 'd1', user_id: 'u2', status: 'Publish',
    body: '<p>ভালো লেখা</p>', parent_id: null, created_at: '2026-09-11T04:00:00Z'
  },
  {
    id: 'r2', discussion_id: 'd1', user_id: 'u3', status: 'Publish',
    // The dangerous body: a script tag and an attribute that runs on error.
    body: '<p>দেখুন<img src="x" onerror="window.__pwned = true"></p><script>window.__pwned = true;</script>',
    parent_id: null, created_at: '2026-09-11T05:00:00Z'
  }
];

function boot({ canAccess = () => true, list = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><div id="modal-root"></div></body></html>', {
    url: 'https://example.test/dashboard/#/forum',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const calls = [];
  const toasts = [];

  window.NC = {
    views: {},
    state: { session: { user: { id: 'me', name: 'Editor', role: 'Super Admin' } }, navigationId: 1 },
    config: { app: { locale: 'en-BD' } },
    utils: {
      escapeHTML: (value) => String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
      // The real ones: sanitising is half of what this file is about.
      sanitizeHTML: (value) => String(value || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/ onerror="[^"]*"/gi, ''),
      stripHTML: (value) => String(value || '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      truncate: (value, max = 90) => {
        const text = String(value || '').trim();
        return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
      },
      formatDateTime: (value) => String(value || '').replace('T', ' ').slice(0, 16),
      relativeTime: (value) => (value ? 'recently' : ''),
      debounce: (fn) => fn,
      number: (value) => Number(value || 0),
      initials: (value) => String(value || '').slice(0, 1),
      safeExternalUrl: (value) => (/^https?:\/\//i.test(String(value || '')) ? String(value) : ''),
      safeImage: (value) => (/^https?:\/\//i.test(String(value || '')) ? String(value) : ''),
      setButtonLoading: () => {}
    },
    auth: { canAccess: (route) => canAccess(route) },
    components: {
      // The real header renders its `actions` string; the Refresh button lives there.
      pageHeader: ({ title, actions = '' }) => `<header>${title}${actions}</header>`,
      notice: (message) => `<div class="notice">${message}</div>`,
      statusBadge: (status) => `<span class="status-badge">${status}</span>`,
      skeleton: () => '<div class="surface">Loading…</div>',
      emptyState: ({ title, action = '' }) => `<div class="empty">${title}${action}</div>`,
      pagination: ({ total }) => `<nav class="pagination" data-total="${total}"></nav>`,
      tableShell: ({ head, body }) => `<table><thead>${head}</thead><tbody>${body}</tbody></table>`,
      rowActions: (actions) => `<div class="row-actions">${actions.map((action) => `<button type="button" data-action="${action.action}" data-id="${action.id}"></button>`).join('')}</div>`,
      toast: (message) => toasts.push(message),
      closeModal: () => {},
      confirm: async () => true,
      openModal: (options) => {
        const wrapper = window.document.createElement('div');
        wrapper.className = 'modal-root';
        wrapper.innerHTML = `<div class="modal-head">${options.title || ''}</div><div class="modal-body">${options.content}</div><div class="modal-footer">${options.footer || ''}</div>`;
        window.document.body.appendChild(wrapper);
        options.onOpen?.(wrapper);
        return wrapper;
      }
    },
    crud: {
      ListState: class {
        constructor() {
          this.records = []; this.query = ''; this.page = 1; this.pageSize = 10;
          this.sortKey = 'created_at'; this.sortDirection = 'desc'; this.filters = {};
          this.searchFields = [];
        }
        setRecords(records) { this.records = records; return this; }
        setQuery(value) { this.query = String(value || '').toLowerCase(); return this; }
        setFilter(key, value) { this.filters[key] = value; return this; }
        setSort(key) { this.sortKey = key; return this; }
        // Mirrors crud.js: a string filter is compared with record[key], a function
        // filter gets (actual, record).
        filtered() {
          return this.records.filter((record) => {
            if (this.query) {
              const haystack = this.searchFields.map((field) => String(record[field] ?? '')).join(' ').toLocaleLowerCase();
              if (!haystack.includes(this.query)) return false;
            }
            return Object.entries(this.filters).every(([key, expected]) => {
              if (expected === '' || expected === 'all' || expected == null) return true;
              if (typeof expected === 'function') return expected(record[key], record);
              return String(record[key]).toLocaleLowerCase() === String(expected).toLocaleLowerCase();
            });
          });
        }
        paged() { const rows = this.filtered(); return { rows, total: rows.length, pages: 1, page: 1 }; }
      },
      renderActiveFilters: () => {},
      filterSelect: () => '<select data-forum-category></select>',
      sortIcon: () => '',
      bindPagination: () => {},
      bindSort: () => {},
      isStaleNavigation: () => false,
      handleLoadError: () => {},
      deleteRecord: async ({ table, record }) => { calls.push({ kind: 'delete', table, id: record.id }); return true; },
      save: async () => ({})
    },
    api: {
      list: async (table, options = {}) => {
        calls.push({ kind: 'list', table, options });
        if (list) return list(table, options);
        if (table === 'forum') {
          const rows = plain(DISCUSSIONS);
          return { data: rows, count: rows.length };
        }
        if (table === 'forumCategories') {
          return { data: [{ id: 'c1', title: 'ভাষা', slug: 'language', position: 1 }, { id: 'c2', title: 'সাহিত্য', slug: 'literature', position: 2 }] };
        }
        if (table === 'forumReplies') {
          return { data: plain(REPLIES).filter((reply) => reply.discussion_id === options.filters?.discussion_id) };
        }
        if (table === 'profiles') return { data: [{ id: 'u1', name: 'নবদ্বীপ সিংহ' }, { id: 'u2', name: 'পরীক্ষা পাঠক' }, { id: 'u3', name: 'তৃতীয় পাঠক' }] };
        return { data: [], count: 0 };
      },
      update: async (table, id, payload) => { calls.push({ kind: 'update', table, id, payload }); return { id }; },
      remove: async (table, id) => { calls.push({ kind: 'remove', table, id }); return true; },
      userMessage: (error, fallback) => error?.message || fallback
    }
  };

  if (JSDOM) {
    const source = fs.readFileSync(SCRIPT, 'utf8');
    vm.runInContext(source, dom.getInternalVMContext());
  }
  return { dom, window, root: window.document.getElementById('root'), calls, toasts };
}

/** Records and payloads cross the jsdom realm boundary; compare values, not prototypes. */
const plain = (value) => JSON.parse(JSON.stringify(value));

const needs = (t) => {
  if (!JSDOM) { t.skip('jsdom is not installed'); return true; }
  return false;
};

// ---------------------------------------------------------------------------
// The page itself
// ---------------------------------------------------------------------------

test('the Forum page lists what readers wrote, as text', async (t) => {
  if (needs(t)) return;
  const { window, root, calls } = boot();
  await window.NC.views.forum.render(root, { route: 'forum', params: new URLSearchParams() });

  await t.test('it reads the three granted tables and the names it joins', () => {
    const tables = calls.filter((call) => call.kind === 'list').map((call) => call.table);
    assert.deepEqual([...new Set(tables)].sort(), ['forum', 'forumCategories', 'profiles'],
      'the tables migration 029 grants the dashboard — not the revoked views');
    const forum = calls.find((call) => call.table === 'forum');
    assert.ok(!forum.options.select.includes('body_text'), 'no such column is asked for');
    assert.ok(forum.options.select.includes('body'), 'the body is, because the modal shows it');
  });

  await t.test('every discussion is a row, with its category and reader', () => {
    const rows = root.querySelectorAll('tbody tr');
    assert.equal(rows.length, 3, 'all three fixtures');
    assert.match(root.innerHTML, /বিষ্ণুপ্রিয়া ভাষার বর্ণমালা/);
    assert.match(root.innerHTML, /নবদ্বীপ সিংহ/, 'the reader\'s name, joined from profiles');
    assert.match(root.innerHTML, /ভাষা/, 'and the category it was filed under');
  });

  await t.test('the counters say what the forum needs answering', () => {
    const stats = [...root.querySelectorAll('.forum-stat')].map((node) => node.textContent.trim());
    assert.deepEqual(stats.map((text) => String(text)), ['3Discussions', '3Answers', '1Waiting for an answer', '1Hidden from readers']);
  });

  await t.test('no reader markup is ever a node', () => {
    assert.equal(root.querySelectorAll('script').length, 0);
    assert.equal(root.querySelectorAll('img').length, 0);
    assert.ok(!/onerror/i.test(root.innerHTML), 'the attribute is not carried through');
  });
});

test('the answers are read from the table, and dangerous markup stays text', async (t) => {
  if (needs(t)) return;
  const { window, root, calls } = boot();
  await window.NC.views.forum.render(root, { route: 'forum', params: new URLSearchParams() });

  // Open the first discussion from its row action.
  root.querySelector('tbody tr [data-action="view"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  await t.test('the modal shows the thread and asks for its answers', () => {
    const modal = window.document.querySelector('.modal-root');
    assert.ok(modal, 'a modal opened');
    assert.match(modal.textContent, /বিষ্ণুপ্রিয়া ভাষার বর্ণমালা/);
    assert.match(modal.textContent, /প্রথম লাইন/);
    assert.match(modal.textContent, /পরীক্ষা পাঠক/, 'an answer is signed with its reader’s name');
    assert.match(modal.textContent, /তৃতীয় পাঠক/);
    assert.match(modal.textContent, /দ্বিতীয় লাইন/, 'the block tags became line breaks, not one run-on line');
    const replies = calls.filter((call) => call.table === 'forumReplies');
    assert.equal(replies.length, 1);
    assert.equal(replies[0].options.filters.discussion_id, 'd1');
    assert.match(replies[0].options.order, /created_at\.asc/, 'answers read oldest first');
  });

  await t.test('the attachment the reader put in the markup is a link', () => {
    const link = window.document.querySelector('.forum-attachment');
    assert.ok(link, 'the link is offered');
    assert.equal(link.getAttribute('href'), 'https://example.test/a.pdf');
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(link.getAttribute('target'), '_blank');
  });

  await t.test('a script tag in an answer is text, and its onerror is gone', () => {
    const answers = window.document.querySelectorAll('.forum-answer');
    assert.equal(answers.length, 2, 'both answers are listed');
    assert.equal(window.document.querySelectorAll('.forum-answer script').length, 0, 'no script element');
    assert.equal(window.__pwned, undefined, 'and nothing ran');
    assert.ok(!/onerror/i.test(window.document.querySelector('.modal-root').innerHTML), 'no handler attribute');
    assert.match(window.document.querySelector('.modal-root').textContent, /দেখুন/, 'the words themselves are kept');
  });
});

test('moderating a thread writes the column the app filters on', async (t) => {
  if (needs(t)) return;

  await t.test('hiding is status = Unpublish on forum_discussions', async () => {
    const { window, root, calls } = boot();
    await window.NC.views.forum.render(root, { route: 'forum', params: new URLSearchParams() });
    const toggle = root.querySelector('tbody tr [data-action="toggle"]');
    toggle.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const write = calls.find((call) => call.kind === 'update');
    assert.deepEqual(plain({ table: write.table, id: write.id, payload: write.payload }), {
      table: 'forum', id: 'd1', payload: { status: 'Unpublish' }
    });
  });

  await t.test('restoring is the same write the other way', async () => {
    const { window, root, calls } = boot();
    await window.NC.views.forum.render(root, { route: 'forum', params: new URLSearchParams() });
    // The third fixture is already hidden; its action shows it again.
    const rows = [...root.querySelectorAll('tbody tr')];
    const hiddenRow = rows.find((row) => row.textContent.includes('লুকানো আলোচনা'));
    hiddenRow.querySelector('[data-action="toggle"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const write = calls.find((call) => call.kind === 'update');
    assert.deepEqual(plain({ id: write.id, payload: write.payload }), { id: 'd3', payload: { status: 'Publish' } });
  });

  await t.test('deleting a discussion deletes the row it belongs to', async () => {
    const { window, root, calls } = boot();
    await window.NC.views.forum.render(root, { route: 'forum', params: new URLSearchParams() });
    root.querySelector('tbody tr [data-action="delete"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const removal = calls.find((call) => call.kind === 'delete');
    assert.deepEqual(plain({ table: removal.table, id: removal.id }), { table: 'forum', id: 'd1' });
  });

  await t.test('hiding an answer is a write on forum_replies', async () => {
    const { window, root, calls } = boot();
    await window.NC.views.forum.render(root, { route: 'forum', params: new URLSearchParams() });
    root.querySelector('tbody tr [data-action="view"]').dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const button = window.document.querySelector('[data-answer-toggle]');
    button.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const write = calls.find((call) => call.kind === 'update');
    assert.deepEqual(plain({ table: write.table, id: write.id, payload: write.payload }), {
      table: 'forumReplies', id: 'r1', payload: { status: 'Unpublish' }
    });
  });
});

test('the queues a moderator is sent to are the page\'s own filters', async (t) => {
  if (needs(t)) return;

  await t.test('?filter=Unpublish opens on the hidden threads', async () => {
    const { window, root } = boot();
    await window.NC.views.forum.render(root, { route: 'forum', params: new URLSearchParams('filter=Unpublish') });
    const rows = [...root.querySelectorAll('tbody tr')];
    assert.equal(rows.length, 1);
    assert.match(rows[0].textContent, /লুকানো আলোচনা/);
  });

  await t.test('?filter=Waiting opens on the threads nobody answered', async () => {
    const { window, root } = boot();
    await window.NC.views.forum.render(root, { route: 'forum', params: new URLSearchParams('filter=Waiting') });
    const rows = [...root.querySelectorAll('tbody tr')];
    assert.equal(rows.length, 1);
    assert.match(rows[0].textContent, /উত্তর নেই/);
  });

  await t.test('?action=view&id=… opens that discussion', async () => {
    const { window, root } = boot();
    await window.NC.views.forum.render(root, { route: 'forum', params: new URLSearchParams('action=view&id=d2') });
    const modal = window.document.querySelector('.modal-root');
    assert.ok(modal, 'the discussion a notification pointed at is open');
    assert.match(modal.textContent, /উত্তর নেই/);
  });
});

// ---------------------------------------------------------------------------
// The index dashboard
// ---------------------------------------------------------------------------

test('the index dashboard carries the forum', async (t) => {
  await t.test('the menu and the config know the page', () => {
    assert.match(CONFIG, /\{ id: 'forum', label: 'Forum', icon: 'fa-comment-dots', group: 'content' \}/,
      'a Forum row in the Content group');
    assert.match(CONFIG, /forum: 'forum_discussions'/, 'and the tables behind it');
    assert.match(CONFIG, /forumReplies: 'forum_replies'/);
    assert.match(CONFIG, /forumCategories: 'forum_categories'/);
    assert.match(INDEX, /<script defer src="assets\/js\/forum\.js\?v=[\d.]+"><\/script>/, 'the script is loaded');
    assert.match(API, /\['forum', 'Forum', 'comment-dots', \['title', 'body'\]\]/, 'and the global search finds threads');
    assert.match(API, /forum: 'id,status,replies_count,last_reply_at,is_official'/, 'the probe asks for real columns');
    assert.match(API, /forum: 'backend\/supabase\/migrations\/029_forum\.sql'/, 'and names the migration that adds them');
  });

  await t.test('the overview shows threads and answers, under the forum\'s own permission', () => {
    assert.match(DASHBOARD, /\['discussions', 'Forum Threads', 'fa-comment-dots', 'cyan'\]/);
    assert.match(DASHBOARD, /\['answers', 'Forum Answers', 'fa-message', 'violet'\]/);
    assert.match(DASHBOARD, /if \(key === 'discussions' \|\| key === 'answers'\) return 'forum';/,
      'a forum moderator sees them without analytics access');
    assert.match(DASHBOARD, /\['forum', 'id,title,status,category_id,user_id,views_count,replies_count,is_official,created_at,last_reply_at'\]/,
      'read with a narrow select — the thread bodies are not downloaded to draw a number');
  });

  await t.test('both queues are offered, and both point at a filter the page has', () => {
    assert.match(DASHBOARD, /label: 'forum discussions waiting for an answer', route: 'forum', filter: 'Waiting'/);
    assert.match(DASHBOARD, /label: 'forum threads hidden from readers', route: 'forum', filter: 'Unpublish'/);
    assert.match(DASHBOARD, /\['forumHidden', 'forum', \{ status: 'Unpublish' \}\]/, 'hidden comes from an exact count');
    assert.match(DASHBOARD, /item\.status === 'Publish' && Number\(item\.replies_count \|\| 0\) === 0/,
      'and "waiting" is published with no answers');
  });

  await t.test('the live feed carries discussions and answers', () => {
    assert.match(DASHBOARD, /\['forum', 'Discussion', 'comment-dots'/);
    assert.match(DASHBOARD, /\['forumAnswers', 'Answer', 'message'/, 'answers are a type of their own');
    assert.match(DASHBOARD, /data\.forum\.find\(\(thread\) => thread\.id === item\.discussion_id\)\?\.title/,
      'an answer is shown under the thread it answers');
  });

  await t.test('five discussions, and a way to the rest', () => {
    const panel = DASHBOARD.slice(DASHBOARD.indexOf('function forumPanel('), DASHBOARD.indexOf('function latestCards('));
    assert.match(panel, /const threads = \(data\.forum \|\| \[\]\)\.slice\(0, 5\)/,
      'five on the overview — the rest live on the page, which has its own paging');
    assert.match(panel, /data-forum-thread="\$\{escapeHTML\(thread\.id\)\}"/, 'each row opens its discussion');
    assert.match(panel, /data-forum-open/, 'and the panel links to the page');
    assert.match(DASHBOARD, /routeTo\('forum', \{ action: 'view', id: button\.dataset\.forumThread \}\)/);
    assert.match(DASHBOARD, /container\.querySelectorAll\('\[data-forum-open\]'\)/);
    assert.match(DASHBOARD, /\$\{forumPanel\(data\)\}/, 'and the panel is on the page');
  });

  await t.test('the forum is a content type everywhere else too', () => {
    assert.match(DASHBOARD, /\['Threads', 'forum', '#06b6d4'\]/, 'a bar in the distribution chart');
    assert.match(DASHBOARD, /\['forum', '', 'Review the forum', 'fa-comment-dots', ''\]/, 'a quick action');
  });
});
