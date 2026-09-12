'use strict';

/**
 * Sidebar menu tests (assets/js/app.js → NC.nav.html).
 *
 * A route that declares `parent` inherits that item's permission, and the menu
 * used to drop every such route from the System/Content groups — which is how
 * the Languages page shipped invisible: it was reachable by URL, allowed by the
 * permission check, and simply absent from the sidebar.
 *
 * The guard against that coming back is the last test: every route in the real
 * config must appear in the rendered menu when every route is permitted.
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

const CONFIG = path.join(__dirname, '..', 'assets', 'js', 'config.js');
const APP = path.join(__dirname, '..', 'assets', 'js', 'app.js');

/** config.js + app.js in a jsdom page, with the app's own init() held back. */
function boot() {
  const dom = new JSDOM('<!doctype html><html><body><nav id="sidebar-navigation"></nav></body></html>', {
    url: 'https://example.test/dashboard/',
    runScripts: 'outside-only'
  });
  const { window } = dom;

  // app.js runs init() immediately unless the document is still loading; the
  // menu builder does not need any of that, so keep the page "loading" and drop
  // the DOMContentLoaded listener it then registers — otherwise jsdom fires it
  // after the test and init() trips over the missing login view.
  Object.defineProperty(window.document, 'readyState', { value: 'loading', configurable: true });
  const addListener = window.document.addEventListener.bind(window.document);
  window.document.addEventListener = (type, handler, options) => {
    if (type === 'DOMContentLoaded') return;
    addListener(type, handler, options);
  };

  window.NC = { views: {}, state: {} };
  window.NC.utils = {
    qs: (selector, scope = window.document) => scope.querySelector(selector),
    qsa: (selector, scope = window.document) => [...scope.querySelectorAll(selector)],
    escapeHTML: (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    debounce: (fn) => fn,
    getHashRoute: () => ({ route: 'dashboard', params: {} }),
    routeTo: () => {},
    readPreference: () => '',
    writePreference: () => {},
    initials: () => 'NN'
  };
  window.NC.auth = { canAccess: () => true, isAuthenticated: () => true, isLegacy: () => false };
  window.eval(fs.readFileSync(CONFIG, 'utf8'));
  window.eval(fs.readFileSync(APP, 'utf8'));
  return window;
}

const windows = [];
const bootTracked = () => { const window = boot(); windows.push(window); return window; };
test.after(() => windows.forEach((window) => window.close()));

const allowAll = () => true;
const allow = (...ids) => (id) => ids.includes(id);
/** The real check: a route is permitted by its own key or by its parent's. */
const allowKeys = (routes, ...keys) => (id) => {
  const route = routes.find((item) => item.id === id);
  const key = route?.permission || route?.parent || id;
  return keys.includes(id) || keys.includes(key);
};

test('sidebar menu', { skip: JSDOM ? false : 'jsdom is not installed (npm install --no-save jsdom)' }, async (t) => {
  const window = bootTracked();
  const { html } = window.NC.nav;
  const routes = window.NC_CONFIG.routes;

  await t.test('every route is offered when every permission is held', () => {
    const markup = html(routes, allowAll, 'dashboard');
    routes.forEach((route) => {
      assert.match(markup, new RegExp(`href="#/${route.id}"`), `${route.id} is missing from the sidebar`);
    });
  });

  await t.test('Languages is a first-class System entry, right after Settings', () => {
    const markup = html(routes, allowAll, 'dashboard');
    const settings = markup.indexOf('href="#/settings"');
    const languages = markup.indexOf('href="#/languages"');
    const roles = markup.indexOf('href="#/access-control"');
    assert.ok(settings > -1 && languages > -1, 'both Settings and Languages must render');
    assert.ok(settings < languages && languages < roles, 'it sits between Settings and Users & Roles');
    assert.doesNotMatch(markup, /data-nav-children="settings"/, 'it is not nested under Settings');
  });

  await t.test('a route that declares a parent is nested, not dropped', () => {
    // The real config nests only the Registered-users routes, and those render
    // inside that group's toggle. This covers the general path with a synthetic
    // pair, so a future `parent` route cannot disappear the way Languages did.
    const synthetic = [
      { id: 'dashboard', label: 'Dashboard', icon: 'fa-gauge-high', group: 'overview' },
      { id: 'settings', label: 'Settings', icon: 'fa-gear', group: 'system' },
      { id: 'plugin', label: 'Plugin', icon: 'fa-plug', group: 'system', parent: 'settings' }
    ];
    const markup = html(synthetic, allowAll, 'dashboard');
    const child = markup.indexOf('href="#/plugin"');
    const parentBlock = markup.indexOf('data-nav-children="settings"');
    assert.equal(markup.split('href="#/plugin"').length - 1, 1, 'the child is rendered exactly once');
    assert.ok(parentBlock > -1, 'the parent opens a children block');
    assert.ok(child > parentBlock, 'and the child is inside it, not a System sibling');
  });

  await t.test('the Settings permission carries Languages', () => {
    // What a non-super-admin role looks like: permissionKey('languages') is 'settings',
    // so a role granted Settings sees both entries.
    const markup = html(routes, allow('dashboard', 'settings', 'languages'), 'dashboard');
    assert.match(markup, /href="#\/settings"/);
    assert.match(markup, /href="#\/languages"/);
    assert.doesNotMatch(markup, /href="#\/authors"/, 'content the role cannot access stays out');
  });

  await t.test('without the permission neither entry appears', () => {
    const markup = html(routes, allow('dashboard', 'authors'), 'dashboard');
    assert.doesNotMatch(markup, /href="#\/settings"/);
    assert.doesNotMatch(markup, /href="#\/languages"/);
  });

  await t.test('the Registered-users submenu still works', () => {
    const markup = html(routes, allowAll, 'ru-users');
    assert.match(markup, /data-nav-toggle="registered-users"/);
    assert.match(markup, /data-nav-submenu="registered-users"[^>]*>[\s\S]*href="#\/ru-users"/, 'the community routes live in the submenu');
    assert.match(markup, /class="nav-submenu is-open" data-nav-submenu="registered-users"/, 'the submenu opens for the current route');
    assert.equal(markup.split('href="#/ru-users"').length - 1, 1, 'ru-users is listed exactly once');
  });

  await t.test('সেরা অবদানকারী sits in the Registered-users menu', () => {
    // The owner asked for the app's contributor page in this menu, so both
    // halves matter: it is in the submenu, and a role that can open Registered
    // users can open it (its permission key is its parent).
    const markup = html(routes, allowAll, 'dashboard');
    assert.match(markup, /href="#\/ru-contributors"/, 'the route is in the sidebar');
    assert.match(
      markup,
      /data-nav-submenu="registered-users"[\s\S]*href="#\/ru-contributors"/,
      'and inside the Registered-users submenu'
    );
    const withParent = html(routes, allowKeys(routes, 'dashboard', 'registered-users'), 'dashboard');
    assert.match(withParent, /href="#\/ru-contributors"/, 'the parent permission carries it');
    const withoutParent = html(routes, allowKeys(routes, 'dashboard', 'blogs'), 'dashboard');
    assert.doesNotMatch(withoutParent, /href="#\/ru-contributors"/, 'and nothing else does');
  });

  await t.test('groups stay ordered overview, community, content, system', () => {
    const markup = html(routes, allowAll, 'dashboard');
    const order = ['href="#/dashboard"', 'data-nav-toggle="registered-users"', 'href="#/authors"', 'href="#/settings"'];
    const positions = order.map((needle) => markup.indexOf(needle));
    assert.ok(positions.every((at) => at > -1), 'all four markers are present');
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'the sections render in order');
  });
});
