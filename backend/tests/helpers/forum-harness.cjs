'use strict';

/**
 * One jsdom harness for the dashboard's Forum page, shared by the moderation
 * suite and the writing suite so the two cannot drift into testing different
 * pages.
 *
 * The stubs are deliberately faithful where the page's behaviour depends on the
 * real thing:
 *
 *  * `editor.mountEditor` keeps its text in the element it was mounted on, so a
 *    test types into a textarea and the page saves what it read from the editor;
 *  * `media.mountImageUploader` reads the URL field the same way;
 *  * `api` records every call and hands out **copies** of the fixtures, because a
 *    page that hides or edits a row mutates the record it was given.
 */

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

const BACKEND = path.join(__dirname, '..', '..');
const FORUM_JS = path.join(BACKEND, 'assets', 'js', 'forum.js');

const DISCUSSIONS = [
  {
    id: 'd1', category_id: 'c1', user_id: 'u1', title: 'বিষ্ণুপ্রিয়া ভাষার বর্ণমালা',
    body: '<p>প্রথম লাইন</p><p>দ্বিতীয় লাইন</p><a href="https://example.test/a.pdf">উৎস.pdf</a>',
    author_name: '', status: 'Publish', views_count: 42, replies_count: 2, is_official: false,
    cover_image_url: '', cover_delete_url: '', created_at: '2026-09-10T04:00:00Z', last_reply_at: '2026-09-11T04:00:00Z'
  },
  {
    id: 'd2', category_id: 'c2', user_id: 'u2', title: 'উত্তর নেই',
    body: '<p>কেউ উত্তর দেয়নি</p>', author_name: '', status: 'Publish', views_count: 3, replies_count: 0,
    is_official: false, cover_image_url: '', cover_delete_url: '',
    created_at: '2026-09-12T04:00:00Z', last_reply_at: null
  },
  {
    id: 'd3', category_id: 'c1', user_id: 'u2', title: 'লুকানো আলোচনা',
    body: '<p>গোপন</p>', author_name: '', status: 'Unpublish', views_count: 9, replies_count: 1,
    is_official: true, cover_image_url: '', cover_delete_url: '',
    created_at: '2026-09-09T04:00:00Z', last_reply_at: '2026-09-09T06:00:00Z'
  }
];

const REPLIES = [
  {
    id: 'r1', discussion_id: 'd1', user_id: 'u2', status: 'Publish', author_name: '',
    body: '<p>ভালো লেখা</p>', parent_id: null, is_official: false, created_at: '2026-09-11T04:00:00Z'
  },
  {
    id: 'r2', discussion_id: 'd1', user_id: 'u3', status: 'Publish', author_name: '',
    // The dangerous body: a script tag and an attribute that runs on error.
    body: '<p>দেখুন<img src="x" onerror="window.__pwned = true"></p><script>window.__pwned = true;</script>',
    parent_id: null, is_official: false, created_at: '2026-09-11T05:00:00Z'
  },
  {
    id: 'r3', discussion_id: 'd1', user_id: 'u3', status: 'Publish', author_name: '',
    body: '<p>একই কথা</p>', parent_id: 'r1', is_official: false, created_at: '2026-09-11T06:00:00Z'
  }
];

const REACTIONS = [
  { reply_id: 'r1', reactor_key: 'dashboard:someone-else', kind: 'like', user_id: null, created_at: '2026-09-11T07:00:00Z' },
  { reply_id: 'r1', reactor_key: 'u9', kind: 'agree', user_id: 'u9', created_at: '2026-09-11T07:01:00Z' }
];

const PROFILE_NAMES = { u1: 'নবদ্বীপ সিংহ', u2: 'পরীক্ষা পাঠক', u3: 'তৃতীয় পাঠক' };

/** Records and payloads cross the jsdom realm boundary; compare values, not prototypes. */
const plain = (value) => JSON.parse(JSON.stringify(value));

const needs = (t) => {
  if (!JSDOM) { t.skip('jsdom is not installed'); return true; }
  return false;
};

function boot({ canAccess = () => true, sessionUser = { id: 'me', name: 'Sisir Sinha' } } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.test/dashboard/#/forum',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  const calls = [];
  const toasts = [];
  const confirmations = [];

  window.NC = {
    views: {},
    state: { session: { user: sessionUser, roleSlug: 'super-admin' }, navigationId: 1 },
    config: { app: { locale: 'en-BD' } },

    utils: {
      escapeHTML: (value) => String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
      // The real ones: sanitising is half of what this page is about.
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
      setButtonLoading: () => {},
      formData: (form) => {
        const data = {};
        form.querySelectorAll('[name]').forEach((field) => { data[field.name] = field.value; });
        return data;
      },
      validateFields: (form, errors) => {
        let ok = true;
        form.querySelectorAll('[data-field-error]').forEach((node) => {
          const message = errors?.[node.dataset.fieldError] || '';
          node.textContent = message;
          node.classList.toggle('hidden', !message);
          if (message) ok = false;
        });
        return ok;
      }
    },

    auth: { canAccess: (route) => canAccess(route) },

    components: {
      // The real header renders its `actions` string; the buttons live there.
      pageHeader: ({ title, actions = '' }) => `<header>${title}${actions}</header>`,
      notice: (message) => `<div class="notice">${message}</div>`,
      statusBadge: (status) => `<span class="status-badge">${status}</span>`,
      skeleton: () => '<div class="surface">Loading…</div>',
      emptyState: ({ title, action = '' }) => `<div class="empty">${title}${action}</div>`,
      pagination: ({ total }) => `<nav class="pagination" data-total="${total}"></nav>`,
      tableShell: ({ head, body }) => `<table><thead>${head}</thead><tbody>${body}</tbody></table>`,
      rowActions: (actions) => `<div class="row-actions">${actions.map((action) => `<button type="button" data-action="${action.action}" data-id="${action.id}"></button>`).join('')}</div>`,
      toast: (message, tone) => toasts.push({ message, tone }),
      closeModal: () => {},
      confirm: (options) => {
        confirmations.push(options);
        return Promise.resolve(true);
      },
      openModal: (options) => {
        const wrapper = window.document.createElement('div');
        wrapper.className = 'modal-root';
        wrapper.innerHTML = `<div class="modal-head">${options.title || ''}</div><div class="modal-body">${options.content}</div><div class="modal-footer">${options.footer || ''}</div>`;
        window.document.body.appendChild(wrapper);
        options.onOpen?.(wrapper);
        return { element: wrapper, close: () => {}, body: wrapper.querySelector('.modal-body'), footer: wrapper.querySelector('.modal-footer') };
      }
    },

    // A rich text editor that keeps its words in the element it was mounted on,
    // so the page saves what a test typed.
    editor: {
      editorHTML: ({ id, label = 'Content', hint = '', required = false }) => `
        <div class="rich-editor-field" data-rich-editor id="${id}">
          <label class="field-label">${label}${required ? ' *' : ''}</label>
          <span class="field-hint">${hint}</span>
          <textarea data-editor-source spellcheck="false"></textarea>
          <p class="field-error hidden" data-editor-error></p>
        </div>`,
      mountEditor: (root, options = {}) => {
        const element = root?.matches?.('[data-rich-editor]') ? root : root.querySelector('[data-rich-editor]');
        const source = element.querySelector('[data-editor-source]');
        source.value = options.initial || '';
        return {
          getValue: () => source.value,
          setValue: (value) => { source.value = value || ''; },
          getMedia: () => [], getRemovedMedia: () => [], getSessionUploads: () => [],
          focus: () => {},
          validate: () => {
            const error = element.querySelector('[data-editor-error]');
            const empty = !String(source.value || '').replace(/<[^>]*>/g, '').trim();
            if (options.required && empty) {
              error.textContent = `${options.label || 'Content'} is required.`;
              error.classList.remove('hidden');
              return false;
            }
            error.classList.add('hidden');
            return true;
          }
        };
      }
    },

    // The uploader reads its own URL field, the way the real one does.
    media: {
      imageUploaderHTML: ({ id, label = 'Image', hint = '' }) => `
        <div class="image-uploader" data-image-uploader id="${id}">
          <label class="field-label" for="${id}-url">${label}</label>
          <span class="field-hint">${hint}</span>
          <input class="form-input" id="${id}-url" data-upload-url>
        </div>`,
      mountImageUploader: (root, options = {}) => {
        const element = root?.matches?.('[data-image-uploader]') ? root : root.querySelector('[data-image-uploader]');
        const input = element.querySelector('[data-upload-url]');
        const initial = options.initial || {};
        input.value = initial.url || '';
        return {
          getValue: () => ({
            url: input.value,
            display_url: input.value,
            delete_url: initial.delete_url || (input.value ? 'https://ibb.co/delete/old' : ''),
            provider: input.value ? 'imgbb' : ''
          }),
          setValue: (next) => { input.value = (next && next.url) || next || ''; }
        };
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
        if (table === 'forum') {
          const rows = plain(DISCUSSIONS);
          return { data: rows, count: rows.length };
        }
        if (table === 'forumCategories') {
          return { data: [
            { id: 'c1', title: 'ভাষা', slug: 'language', position: 1 },
            { id: 'c2', title: 'সাহিত্য', slug: 'literature', position: 2 }
          ] };
        }
        if (table === 'forumReplies') {
          const wanted = options.filters?.discussion_id;
          return { data: plain(REPLIES).filter((reply) => !wanted || reply.discussion_id === wanted) };
        }
        if (table === 'forumReactions') {
          const wanted = options.filters?.reply_id?.value || null;
          return { data: plain(REACTIONS).filter((row) => !wanted || wanted.includes(row.reply_id)) };
        }
        if (table === 'profiles') {
          return { data: Object.entries(PROFILE_NAMES).map(([id, name]) => ({ id, name })) };
        }
        return { data: [], count: 0 };
      },
      insert: async (table, payload) => { calls.push({ kind: 'insert', table, payload }); return { id: 'created-1', ...plain(payload) }; },
      update: async (table, id, payload) => { calls.push({ kind: 'update', table, id, payload }); return { id, ...plain(payload) }; },
      upsert: async (table, payload, conflict) => { calls.push({ kind: 'upsert', table, payload, conflict }); return plain(payload); },
      remove: async (table, id) => { calls.push({ kind: 'remove', table, id }); return true; },
      removeWhere: async (table, filters) => { calls.push({ kind: 'removeWhere', table, filters: plain(filters) }); return true; },
      userMessage: (error, fallback) => error?.message || fallback
    }
  };

  if (JSDOM) {
    vm.runInContext(fs.readFileSync(FORUM_JS, 'utf8'), dom.getInternalVMContext());
  }

  return {
    dom,
    window,
    root: window.document.getElementById('root'),
    calls,
    toasts,
    confirmations,
    /** Wait for the page's own awaits to settle. */
    settle: () => new Promise((resolve) => window.setTimeout(resolve, 0)),
    modal: () => window.document.querySelector('.modal-root'),
    of: (kind) => calls.filter((call) => call.kind === kind)
  };
}

module.exports = { boot, needs, plain, assert, DISCUSSIONS, REPLIES, REACTIONS };
