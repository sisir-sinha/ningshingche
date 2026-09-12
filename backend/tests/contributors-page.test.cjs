'use strict';

/**
 * The dashboard's সেরা অবদানকারী screen (assets/js/registered-users.js, route
 * `ru-contributors`).
 *
 * Two things are worth guarding here beyond "it renders": that the numbers come
 * from the RPC and are shown as they arrive (the dashboard must not do its own
 * arithmetic — the weights live in the database), and that the Lifetime switch
 * asks for a different window rather than filtering what it already has.
 *
 * Needs jsdom and skips itself without it (see languages-page.test.cjs):
 *     npm install --no-save jsdom && node --test backend/tests/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM = null;
try {
  // eslint-disable-next-line global-require
  ({ JSDOM } = require('jsdom'));
} catch {
  JSDOM = null;
}

const SCRIPT = path.join(__dirname, '..', 'assets', 'js', 'registered-users.js');
const CONFIG = path.join(__dirname, '..', 'assets', 'js', 'config.js');
const APP = path.join(__dirname, '..', 'assets', 'js', 'app.js');

const MONTH = {
  month_key: '2026-09',
  contributors: [
    { user_id: 'u1', name: 'নবদ্বীপ সিংহ', email: 'a@example.test', avatar_url: '', articles: 4, songs: 2, comments: 9, views: 120, seconds: 5400, points: 428 },
    { user_id: 'u2', name: 'পরীক্ষা পাঠক', email: 'b@example.test', avatar_url: '', articles: 1, songs: 1, comments: 0, views: 12, seconds: 600, points: 91 }
  ]
};

function boot({ failRpc = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><div id="modal-root"></div><nav id="sidebar-navigation"></nav></body></html>', {
    url: 'https://example.test/dashboard/#/ru-contributors',
    runScripts: 'outside-only'
  });
  const { window } = dom;
  const calls = [];

  window.NC = {
    views: {},
    state: { session: {} },
    utils: {
      escapeHTML: (value) => String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      avatarHTML: (name) => `<span class="av">${String(name || '').slice(0, 1)}</span>`,
      formatDateTime: (value) => String(value || '').slice(0, 10),
      // The real debounce waits 220 ms; a test should not.
      debounce: (fn) => fn,
      formData: () => ({}),
      number: (value) => Number(value) || 0,
      relativeTime: () => '',
      routeTo: () => {},
      safeImage: (url) => url || '',
      slugify: (value) => String(value || ''),
      readPreference: () => null,
      writePreference: () => {},
      initials: () => ''
    },
    components: {
      pageHeader: (options) => `<header data-page-title="${options.title}">${options.title}</header>`,
      skeleton: () => '<div class="skeleton"></div>',
      emptyState: (options) => `<div class="empty">${options.title} ${options.description || ''}</div>`,
      tableShell: ({ head = '', body = '', caption = '' }) =>
        `<table><caption>${caption}</caption><thead>${head}</thead><tbody>${body}</tbody></table>`,
      statusBadge: (value) => `<span>${value}</span>`,
      rowActions: () => '',
      pagination: () => '',
      openModal: () => {},
      closeModal: () => {},
      filterSelect: () => ''
    },
    crud: {
      ListState: class {
        constructor() { this.page = 1; this.pageSize = 25; }
        setRecords(records) { this.records = records; }
        paged() { return { rows: this.records || [], total: (this.records || []).length }; }
        setQuery() {}
      },
      sortIcon: () => '',
      bindPagination: () => {},
      bindSort: () => {},
      isStaleNavigation: () => false,
      handleLoadError: (container, error) => { container.innerHTML = `ERR: ${error.message}`; },
      filterSelect: () => ''
    },
    api: {
      list: async () => ({ data: [] }),
      rpc: async (name, payload) => {
        calls.push({ name, payload });
        assert.equal(name, 'contributor_leaderboard_dashboard', 'the screen asks for the dashboard door');
        if (failRpc) throw new Error('function does not exist');
        return MONTH;
      },
      userMessage: (error, fallback) => `${fallback} [${error.message}]`
    },
    toasts: { push: () => {} }
  };

  window.eval(fs.readFileSync(SCRIPT, 'utf8'));
  return { window, root: window.document.querySelector('#root'), calls };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const text = (root) => root.textContent.replace(/\s+/g, ' ').trim();

test('dashboard contributor board', { skip: JSDOM ? false : 'jsdom is not installed (npm install --no-save jsdom)' }, async (t) => {
  await t.test('the route lives in the Registered-users menu, and a test can render it', () => {
    const { window } = boot();
    assert.ok(window.NC.views['ru-contributors'], 'the screen registers itself under its route');

    // The sidebar is built from the config, so the route entry is what puts the
    // page in the menu; the nav test checks where it lands.
    const config = fs.readFileSync(CONFIG, 'utf8');
    assert.match(config, /id: 'ru-contributors'/, 'the route is declared');
    assert.match(config, /parent: 'registered-users'/, 'and nested under Registered users');
    const app = fs.readFileSync(APP, 'utf8');
    assert.match(app, /childrenOf\('registered-users'\)/, 'which is the list the menu renders');
  });

  await t.test('the board is drawn from the RPC, points and all', async () => {
    const { window, root, calls } = boot();
    await window.NC.views['ru-contributors'].render(root, { route: 'ru-contributors' });
    await settle();

    assert.equal(calls.length, 1, 'one request for the board');
    // The payload was built inside the jsdom realm, so it is copied before it is
    // compared — deepStrictEqual also checks the prototype.
    assert.deepEqual({ ...calls[0].payload }, { p_limit: 200, p_all: false }, 'this month, not lifetime');
    assert.equal(root.querySelector('[data-page-title]').dataset.pageTitle, 'সেরা অবদানকারী');
    assert.match(text(root), /নবদ্বীপ সিংহ/, 'the name is on the card');
    assert.match(text(root), /428/, 'and the points the database computed');
    assert.match(text(root), /1h 30m/, 'app time is readable, not raw seconds');
    assert.equal(root.querySelectorAll('tbody tr').length, 2);
    assert.match(text(root), /2 contributors · 519 points in total/, 'the totals add up');
  });

  await t.test('Lifetime asks the database for everything, not a re-filter', async () => {
    const { window, root, calls } = boot();
    await window.NC.views['ru-contributors'].render(root, { route: 'ru-contributors' });
    await settle();
    root.querySelector('[data-scope="all"]').click();
    await settle();
    assert.equal(calls.length, 2, 'a second request');
    assert.equal(calls[1].payload.p_all, true, 'for the whole history');
  });

  await t.test('the search narrows what is on screen without another request', async () => {
    const { window, root, calls } = boot();
    await window.NC.views['ru-contributors'].render(root, { route: 'ru-contributors' });
    await settle();
    const box = root.querySelector('[data-ru-search]');
    box.value = 'পরীক্ষা';
    box.dispatchEvent(new window.Event('input', { bubbles: true }));
    await settle();
    assert.equal(root.querySelectorAll('tbody tr').length, 1);
    assert.match(text(root), /পরীক্ষা পাঠক/);
    assert.equal(calls.length, 1, 'the board is already loaded');
  });

  await t.test('a missing migration names the file to run', async () => {
    const { window, root } = boot({ failRpc: true });
    await window.NC.views['ru-contributors'].render(root, { route: 'ru-contributors' });
    await settle();
    assert.match(text(root), /027_contributor_board_dashboard\.sql/, 'the hint names the migration');
  });
});
