'use strict';

/**
 * DOM-level tests for the dashboard's Languages page (assets/js/languages.js).
 *
 * The CSV reader is covered without a DOM in languages.test.cjs; these tests
 * cover the page wiring instead — tabs, template loading, the save payload —
 * because that is where a redraw can silently discard what the user just did
 * (the template loader shipped that bug once).
 *
 * They need jsdom, which the rest of this suite deliberately avoids:
 *
 *     npm install --no-save jsdom && node --test backend/tests/
 *
 * Without it the whole file is skipped rather than failing, so a plain
 * `node --test backend/tests/` stays dependency-free.
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

const SCRIPT = path.join(__dirname, '..', 'assets', 'js', 'languages.js');

// The committed templates, as the page fetches them: Bengali maps every key to
// itself, the other languages ship empty.
const TEMPLATES = {
  'bn.csv': 'key,value\nগান,গান\nশিরোনাম,শিরোনাম\n',
  'en.csv': 'key,value\nগান,\nশিরোনাম,\n',
  'bpy.csv': 'key,value\nগান,\nশিরোনাম,\n'
};

function boot() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.test/dashboard/',
    runScripts: 'outside-only'
  });
  const { window } = dom;
  const saved = [];
  const toasts = [];

  window.confirm = () => true; // jsdom implements neither window.confirm nor alert
  window.URL.createObjectURL = () => 'blob:stub';
  window.URL.revokeObjectURL = () => {};
  window.fetch = async (url) => {
    const name = String(url).split('/').pop();
    if (TEMPLATES[name] !== undefined) return { ok: true, text: async () => TEMPLATES[name] };
    return { ok: false, status: 404, text: async () => '' };
  };
  window.NC = {
    views: {},
    utils: {
      escapeHTML: (value) => String(value ?? ''),
      setButtonLoading: () => {},
      formatDate: (value) => `D(${String(value).slice(0, 10)})`
    },
    components: {
      pageHeader: () => '<header></header>',
      skeleton: () => '<div class="skeleton"></div>',
      emptyState: (options) => `<div class="empty">${options.title}</div>`,
      toast: (message, tone) => toasts.push({ message, tone })
    },
    api: {
      list: async () => ({
        data: [
          { lang: 'bn', label: 'বাংলা', csv: TEMPLATES['bn.csv'], row_count: 2, updated_at: '2026-09-01T00:00:00Z' },
          { lang: 'bpy', label: 'বিষ্ণুপ্রিয়া মণিপুরী', csv: 'key,value\nগান,Elahan\n', row_count: 1, updated_at: '2026-09-10T00:00:00Z' }
        ]
      }),
      upsert: async (table, payload, conflict) => {
        saved.push({ table, payload, conflict });
        return payload;
      },
      userMessage: (error, fallback) => `${fallback} [${error.message}]`
    }
  };

  window.eval(fs.readFileSync(SCRIPT, 'utf8'));
  return { window, root: window.document.querySelector('#root'), saved, toasts };
}

const metrics = (root) => [...root.querySelectorAll('.metric-value')].map((node) => node.textContent);
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test('languages page', { skip: JSDOM ? false : 'jsdom is not installed (npm install --no-save jsdom)' }, async (t) => {
  const { window, root, saved, toasts } = boot();
  await window.NC.views.languages.render(root);

  await t.test('renders a tab per language, with its translated/total badge', () => {
    assert.deepEqual([...root.querySelectorAll('[data-lang]')].map((b) => b.dataset.lang), ['bn', 'en', 'bpy']);
    assert.match(root.querySelector('[data-lang="bn"]').textContent, /2\/2/);
    assert.match(root.querySelector('[data-lang="bpy"]').textContent, /1\/1/);
    assert.match(root.querySelector('[data-lang="en"]').textContent, /empty/);
  });

  await t.test('opens on Bishnupriya with its file and metrics', () => {
    assert.match(root.querySelector('#lang-csv').value, /গান,Elahan/);
    // 1 row, 1 translated, 0 empty, 1 Bengali key it does not carry yet.
    assert.deepEqual(metrics(root), ['1', '1', '0', '1']);
  });

  await t.test('switching language keeps what was typed', () => {
    root.querySelector('[data-lang="en"]').click();
    const editor = root.querySelector('#lang-csv');
    assert.equal(editor.value, '');
    editor.value = 'key,value\nগান,Elahan\n';
    root.querySelector('[data-lang="bpy"]').click();
    assert.match(root.querySelector('#lang-csv').value, /গান,Elahan/);
    assert.match(root.querySelector('[data-lang="en"]').textContent, /1\/1/, 'the badge follows the stashed edit');
  });

  await t.test('loading a template fills the editor and recounts', async () => {
    root.querySelector('[data-lang="bpy"]').click();
    root.querySelector('[data-load-template]').click();
    await settle();
    assert.equal(root.querySelector('#lang-csv').value, TEMPLATES['bpy.csv'], 'the redraw must not wipe the template');
    assert.deepEqual(metrics(root), ['2', '0', '2', '0'], '2 rows, none translated, 2 empty, no missing keys');
  });

  await t.test('saving upserts the language row', async () => {
    root.querySelector('[data-save]').click();
    await settle();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].table, 'languageFiles');
    assert.equal(saved[0].conflict, 'lang');
    assert.equal(saved[0].payload.lang, 'bpy');
    assert.equal(saved[0].payload.label, 'বিষ্ণুপ্রিয়া মণিপুরী');
    assert.equal(saved[0].payload.row_count, 2);
    assert.match(saved[0].payload.csv, /^key,value/);
    assert.ok(toasts.some((toast) => toast.tone === 'success'));
  });

  await t.test('a key that is not in the Bengali list is reported', async () => {
    const editor = root.querySelector('#lang-csv');
    editor.value = 'key,value\nগান,Elahan\nভুল কী,Wrong\n';
    root.querySelector('[data-save]').click();
    await settle();
    assert.equal(saved.length, 2);
    assert.match(root.textContent, /not in the Bengali list/);
  });

  await t.test('a failed save surfaces the error instead of pretending', async () => {
    window.NC.api.upsert = async () => { throw new Error('permission denied'); };
    root.querySelector('[data-save]').click();
    await settle();
    assert.ok(toasts.some((toast) => toast.tone === 'error' && /could not be saved/.test(toast.message)));
  });
});
