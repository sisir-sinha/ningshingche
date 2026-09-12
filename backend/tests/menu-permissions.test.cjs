'use strict';

/**
 * Menu keys, on both sides of the wire.
 *
 * A dashboard menu has to exist twice: as a route in `config.js`, which draws
 * the sidebar, and as a key in the database's allow-list
 * `public.dashboard_valid_permissions()` (migration 004, extended by 008, 014,
 * and 031), which `dashboard_save_role` filters every requested permission
 * through. When the two drift apart the failure is silent and one-sided:
 *
 *  * the sidebar cannot show a route the role does not hold, so a menu whose
 *    key nobody can be granted is a menu nobody can see — which is how the
 *    Forum page shipped reachable-by-URL and absent from the sidebar;
 *  * and because the RPC drops an unknown key without an error, an editor ticked
 *    **Forum**, saved, saw a success toast, and had no forum.
 *
 * So: the first test walks the real route list against the newest allow-list in
 * the migrations, and the rest hold the file that closed the gap and the two
 * places the client now tells the truth about it.
 *
 * Needs jsdom for the last block and skips that block without it:
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

const BACKEND = path.join(__dirname, '..');
const MIGRATIONS = path.join(BACKEND, 'supabase', 'migrations');
const CONFIG = fs.readFileSync(path.join(BACKEND, 'assets', 'js', 'config.js'), 'utf8');
const ACCESS = fs.readFileSync(path.join(BACKEND, 'assets', 'js', 'access-control.js'), 'utf8');
const MENU_SQL = fs.readFileSync(path.join(MIGRATIONS, '031_forum_menu_permission.sql'), 'utf8');

/** The routes block of config.js, one route per line — the sidebar's own source. */
function configuredRoutes() {
  const start = CONFIG.indexOf('routes: Object.freeze([');
  const block = CONFIG.slice(start, CONFIG.indexOf('])', start));
  return block.split('\n')
    .filter((line) => /^\s*\{\s*id:\s*'/.test(line))
    .map((line) => ({
      id: /id:\s*'([^']+)'/.exec(line)[1],
      label: (/label:\s*'([^']+)'/.exec(line) || [])[1],
      parent: /parent:\s*'([^']+)'/.exec(line),
      permission: /permission:\s*'([^']+)'/.exec(line)
    }));
}

/** The menus a Super Admin can tick: top-level, and not borrowing a key. */
function grantableMenus() {
  return configuredRoutes()
    .filter((route) => !route.parent && !route.permission && route.id !== 'access-control')
    .map((route) => route.id);
}

/** The newest `dashboard_valid_permissions()` in the migrations, and its file. */
function newestAllowList() {
  const files = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  let found = null;
  files.forEach((name) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');
    const fn = sql.indexOf('function public.dashboard_valid_permissions()');
    if (fn === -1) return;
    const body = sql.slice(fn, sql.indexOf('$$;', fn));
    const keys = [...body.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
    if (keys.length) found = { file: name, keys };
  });
  return found;
}

const needs = (t) => {
  if (!JSDOM) { t.skip('jsdom is not installed'); return true; }
  return false;
};

// ---------------------------------------------------------------------------
// The two sides agree
// ---------------------------------------------------------------------------

test('every tickable menu is a key the database accepts', () => {
  const allow = newestAllowList();
  assert.ok(allow, 'a migration defines the allow-list');
  const menus = grantableMenus();
  const missing = menus.filter((id) => !allow.keys.includes(id));
  assert.deepEqual(missing, [],
    `${missing.join(', ')} can be ticked in Users & Roles, and dashboard_save_role would drop the key in silence`);
  const extra = allow.keys.filter((key) => !menus.includes(key) && key !== 'access-control');
  assert.deepEqual(extra, [], 'and the database accepts no key the client cannot offer');
});

test('031 is the file that added the Forum key', () => {
  const allow = newestAllowList();
  assert.equal(allow.file, '031_forum_menu_permission.sql', 'the newest allow-list is 031\'s');
  assert.ok(allow.keys.includes('forum'), 'and it names the forum');
  assert.ok(allow.keys.includes('registered-users'),
    '014\'s copy of the function had dropped the key 008 added; the newest copy carries it again');
  events: {
    const previous = fs.readFileSync(path.join(MIGRATIONS, '014_music_tracks.sql'), 'utf8');
    const body = previous.slice(previous.indexOf('function public.dashboard_valid_permissions()'));
    assert.ok(!body.slice(0, body.indexOf('$$;')).includes('forum'),
      'and 014 is where the key was still missing');
  }
});

test('031 teaches the key, grants it, and guards both sides of the install', () => {
  assert.match(MENU_SQL, /^begin;/m, 'one transaction');
  assert.match(MENU_SQL, /^commit;/m);
  assert.match(MENU_SQL, /create or replace function public\.dashboard_valid_permissions\(\)/,
    'the allow-list is replaced, not shadowed');
  assert.match(MENU_SQL, /revoke all on function public\.dashboard_valid_permissions\(\) from public;/);

  await_roles: {
    assert.match(MENU_SQL, /to_regclass\('public\.dashboard_roles'\) is not null/,
      'the role update needs the RBAC tables to exist');
    assert.match(MENU_SQL, /when slug = 'super-admin' then public\.dashboard_valid_permissions\(\)/,
      'the Super Admin\'s stored array follows the list');
    assert.match(MENU_SQL, /array_append\(menu_permissions, 'forum'\)/,
      'and the roles that hold the neighbouring menu gain it');
    assert.match(MENU_SQL, /'comments' = any\(menu_permissions\)/,
      'the forum sits with Comments in the sidebar, so a comments moderator gets it');
  }

  await_db: {
    assert.match(MENU_SQL, /to_regclass\('public\.forum_discussions'\) is not null/,
      'a database without 029 has no tables to guard');
    assert.match(MENU_SQL, /to_regprocedure\('public\.dashboard_has_permission\(text\)'\) is not null/,
      'a database without 004 has no permission function to name');
    assert.match(MENU_SQL, /using \(public\.is_dashboard_request\(\)\) with check \(public\.is_dashboard_request\(\)\)/,
      'and keeps the 029 policy it replaces when the RBAC layer is absent');
  }

  await_rls: {
    assert.match(MENU_SQL, /alter table public\.forum_discussions enable row level security/);
    assert.match(MENU_SQL, /if to_regclass\('public\.forum_replies'\) is not null then/,
      'restated behind a guard, so 031 alone is still runnable');
  }
});

test('the forum tables are guarded by the forum menu', () => {
  assert.match(MENU_SQL, /using \(public\.dashboard_has_any_permission\(array\['forum','analytics'\]::text\[\]\)\)/,
    'the index dashboard draws a forum panel with Analytics alone');
  ['forum_discussions', 'forum_replies', 'forum_categories'].forEach((table) => {
    assert.ok(MENU_SQL.includes(`${table}_dashboard_all`), `${table}'s blanket policy is dropped by name`);
    assert.ok(MENU_SQL.includes(`create policy ${table}_dashboard_update`), `${table} can be moderated`);
  });
  // insert (with check) + update (using and with check) + delete, on each table.
  const writes = MENU_SQL.match(/dashboard_has_permission\('forum'\)/g) || [];
  assert.equal(writes.length, 12, 'every write on all three tables names the Forum key');
  assert.ok(!/dashboard_has_permission\('comments'\)/.test(MENU_SQL),
    'the key is Forum, not the menu it sits beside');
});

// ---------------------------------------------------------------------------
// The client tells the truth about a key the server will not take
// ---------------------------------------------------------------------------

test('the dashboard offers to run the file and reports what the server kept', () => {
  assert.match(CONFIG, /forum: '031_forum_menu_permission\.sql'/,
    'the client knows which file adds the key');
  assert.match(ACCESS, /snapshot\.valid_permissions/,
    'the snapshot carries the database\'s own list');
  assert.match(ACCESS, /return menuRoutes\(\)\.filter\(\(route\) => !snapshot\.valid_permissions\.includes\(route\.id\)\)/,
    'a menu outside that list is marked');
  assert.match(ACCESS, /\$\{fixed \|\| unknown \? 'disabled' : ''\}/,
    'and cannot be ticked');
  assert.match(ACCESS, /const dropped = permissions\.filter\(\(id\) => !kept\.includes\(id\)\);/,
    'the save compares what was asked for with what came back');
  assert.match(ACCESS, /const kept = Array\.isArray\(saved\.permissions\) \? saved\.permissions : permissions;/,
    'reading `permissions`, the field dashboard_role_payload really returns');
});

test('Users & Roles shows the missing key instead of a false success', async (t) => {
  if (needs(t)) return;

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><div id="modal-root"></div></body></html>', {
    url: 'https://example.test/dashboard/#/access-control',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const toasts = [];
  const rpcCalls = [];

  window.NC = {
    views: {},
    state: { session: { user: { id: 'me', name: 'Editor', username: 'admin', role: 'Super Admin', roleSlug: 'super-admin' } } },
    utils: {
      escapeHTML: (value) => String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
      initials: (value) => String(value || '').slice(0, 1),
      formatDateTime: (value) => String(value || ''),
      qs: (selector, scope = window.document) => scope.querySelector(selector),
      qsa: (selector, scope = window.document) => [...scope.querySelectorAll(selector)],
      validateFields: () => true,
      formData: (form) => ({ name: form.querySelector('#access-role-name').value, description: '' }),
      setButtonLoading: () => {}
    },
    auth: { isSuperAdmin: () => true, isLegacy: () => false },
    crud: { isStaleNavigation: () => false, handleLoadError: () => {} },
    components: {
      pageHeader: ({ title, actions = '' }) => `<header>${title}${actions}</header>`,
      notice: (message) => `<div class="notice">${message}</div>`,
      errorState: (error) => `<div class="error">${error.message}</div>`,
      skeleton: () => '<div class="surface">Loading…</div>',
      emptyState: ({ title }) => `<div class="empty">${title}</div>`,
      tableShell: ({ head, body }) => `<table><thead>${head}</thead><tbody>${body}</tbody></table>`,
      statusBadge: (status) => `<span class="status-badge">${status}</span>`,
      toast: (message, tone) => toasts.push({ message, tone }),
      confirm: async () => true,
      closeModal: () => {},
      openModal: (options) => {
        const wrapper = window.document.createElement('div');
        wrapper.className = 'modal-root';
        wrapper.innerHTML = `<form id="access-role-form">
          <input id="access-role-name" value="New role">
          <div class="modal-body">${options.content}</div>
          <div class="modal-footer">${options.footer || ''}</div>
        </form>`;
        window.document.body.appendChild(wrapper);
        return { element: wrapper };
      }
    },
    api: {
      rpc: async (name, params) => {
        rpcCalls.push({ name, params });
        if (name === 'dashboard_access_snapshot') {
          return {
            // The list as 014 left it: no forum, which is what the owner's
            // database said while the sidebar had no row to give them.
            valid_permissions: ['dashboard', 'registered-users', 'authors', 'blogs', 'categories', 'comments', 'galleries', 'books', 'submissions', 'videos', 'music', 'analytics', 'settings', 'access-control'],
            roles: [{ id: 'role-1', name: 'Editor', slug: 'editor', description: '', permissions: ['dashboard', 'comments'], is_system: true, user_count: 2 }],
            users: [],
            active_sessions: 1
          };
        }
        if (name === 'dashboard_save_role') {
          // The server keeps what its allow-list knows and drops the rest.
          return { id: 'role-1', name: params.p_name, permissions: params.p_menu_permissions.filter((id) => id !== 'forum') };
        }
        return {};
      },
      userMessage: (error, fallback) => error?.message || fallback
    }
  };

  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync(path.join(BACKEND, 'assets', 'js', 'config.js'), 'utf8'), context);
  window.NC_CONFIG = window.NC_CONFIG || window.NC.config;
  Object.assign(window.NC, { config: window.NC_CONFIG });
  vm.runInContext(ACCESS, context);

  const root = window.document.getElementById('root');
  await window.NC.views['access-control'].render(root, { route: 'access-control', params: new URLSearchParams() });

  await t.test('the page says the database does not know the Forum', () => {
    assert.match(root.textContent, /The database does not recognise this menu yet: Forum/);
    assert.match(root.textContent, /031_forum_menu_permission\.sql/);
  });

  await t.test('the Forum checkbox is offered, disabled, and explained', async () => {
    root.querySelector('[data-add-role]').dispatchEvent(new window.Event('click', { bubbles: true }));
    const modal = window.document.querySelector('.modal-root');
    const forum = modal.querySelector('[data-menu-permission][value="forum"]');
    assert.ok(forum, 'the menu is still listed — a missing row would be its own puzzle');
    assert.ok(forum.disabled, 'and cannot be ticked');
    assert.match(forum.closest('.permission-option').textContent, /Not yet in the database — run 031_forum_menu_permission\.sql/);
    assert.ok(modal.querySelector('[data-menu-permission][value="comments"]'), 'while a known menu stays tickable');
  });

  await t.test('saving a role reports the key the server refused', async () => {
    const modal = window.document.querySelector('.modal-root');
    const forum = modal.querySelector('[data-menu-permission][value="forum"]');
    forum.disabled = false;           // as an older bundle would have left it
    forum.checked = true;
    modal.querySelector('#access-role-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const save = rpcCalls.find((call) => call.name === 'dashboard_save_role');
    assert.ok(save.params.p_menu_permissions.includes('forum'), 'the request did ask for it');
    const toast = toasts.at(-1);
    assert.equal(toast.tone, 'warning');
    assert.match(toast.message, /the database refused Forum/);
    assert.match(toast.message, /031_forum_menu_permission\.sql/);
  });
});
