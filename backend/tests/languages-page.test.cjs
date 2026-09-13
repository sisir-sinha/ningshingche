'use strict';

/**
 * DOM-level tests for the dashboard's Languages page (assets/js/languages.js).
 *
 * The page shows the owner's sheet shape — one row per string, one column per
 * language (bpy · bn · en) — and saves one `key,value` file per language, so
 * these tests cover the wiring between the two: what a cell writes into which
 * file, what Save sends, what Import accepts, and that filtering does not
 * redraw the grid out from under the caret.
 *
 * Bengali is editable and is also the key the app looks a string up by, so the
 * tests cover both halves of that: a rewrite is saved against the app's own
 * string (`লেখক -> লেখকবৃন্দ`), and a sheet carrying a rewrite still imports onto
 * the right row.
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

// One key ends in a danda on purpose: the app's strings do, and a person typing
// the sheet will not reproduce it.
const SOURCE = ['গান', 'শিরোনাম', 'অনুসন্ধান', 'অন্বেষণ', 'অডিও ফাইল পড়া যায়নি।'];
const bnCsv = ['key,value', ...SOURCE.map((key) => `${key},${key}`)].join('\n') + '\n';
// The committed templates the page reads: Bengali is the key list, and the other
// two carry whatever a translator has already committed to the repository.
const templateBnCsv = bnCsv;
const templateEnCsv = 'key,value\nগান,Song\nশিরোনাম,Title\n';
const templateBpyCsv = 'key,value\nগান,Elahan\n';
// One heading row rides along in the stored file, as a file saved by an older
// build would carry: the page must not turn it into a row.
const bpyCsv = 'key,value\nগান,Elahan\n### «{1}» — নিবন্ধ বিশ্লেষণ,লেবেল\n';
const enCsv = 'key,value\nগান,Song\nগান,Song (duplicate wins)\n'.replace('গান,Song (duplicate wins)\n', '');

/**
 * The same page with more strings than fit on one page (the sheet is well past
 * that now), so the search can be asked about a row it cannot see.
 */
const LONG_SOURCE = Array.from({ length: 60 }, (_, index) => `${'স্ট্রিং'} ${index + 1}`);

function boot({ bn = bnCsv, stored = null, enTemplate = templateEnCsv, bpyTemplate = templateBpyCsv } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><div id="modal-root"></div></body></html>', {
    url: 'https://example.test/dashboard/',
    runScripts: 'outside-only'
  });
  const { window } = dom;
  const saved = [];
  const toasts = [];
  let failNext = false;

  window.confirm = () => true;
  window.URL.createObjectURL = () => 'blob:stub';
  window.URL.revokeObjectURL = () => {};
  window.fetch = async (url) => {
    const name = String(url).split('/').pop();
    if (name === 'bn.csv') return { ok: true, text: async () => bn };
    if (name === 'en.csv' && enTemplate !== null) return { ok: true, text: async () => enTemplate };
    if (name === 'bpy.csv' && bpyTemplate !== null) return { ok: true, text: async () => bpyTemplate };
    return { ok: false, status: 404, text: async () => '' };
  };
  window.NC = {
    views: {},
    utils: {
      escapeHTML: (value) => String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
      setButtonLoading: () => {},
      formatDate: (value) => `D(${String(value).slice(0, 10)})`
    },
    components: {
      pageHeader: ({ actions = '' } = {}) => `<header>${actions}</header>`,
      skeleton: () => '<div class="skeleton"></div>',
      emptyState: (options) => `<div class="empty">${options.title}</div>`,
      tableShell: ({ head = '', body = '', caption = '' } = {}) =>
        `<div class="table-shell"><table class="data-table"><caption>${caption}</caption><thead>${head}</thead><tbody>${body}</tbody></table></div>`,
      toast: (message, tone) => toasts.push({ message, tone }),
      notice: (message, tone) => `<div class="notice notice-${tone}">${message}</div>`,
      openModal: ({ content, footer, onOpen }) => {
        const modal = window.document.createElement('div');
        modal.innerHTML = `${content}${footer}`;
        window.document.querySelector('#modal-root').replaceChildren(modal);
        onOpen(modal);
        return modal;
      },
      closeModal: () => window.document.querySelector('#modal-root').replaceChildren()
    },
    api: {
      list: async () => ({
        data: stored || [
          { lang: 'bn', label: 'বাংলা', csv: bnCsv, row_count: SOURCE.length },
          { lang: 'bpy', label: 'বিষ্ণুপ্রিয়া মণিপুরী', csv: bpyCsv, row_count: 1, updated_at: '2026-09-11T00:00:00Z' },
          { lang: 'en', label: 'English', csv: enCsv, row_count: 1 }
        ]
      }),
      upsert: async (table, payload, conflict) => {
        if (failNext) { failNext = false; throw new Error('permission denied'); }
        saved.push({ table, payload, conflict });
        return payload;
      },
      userMessage: (error, fallback) => `${fallback} [${error.message}]`
    }
  };
  window.__failNextSave = () => { failNext = true; };

  window.eval(fs.readFileSync(SCRIPT, 'utf8'));
  return { window, root: window.document.querySelector('#root'), saved, toasts };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const cells = (root, lang) => [...root.querySelectorAll(`[data-entry][data-lang="${lang}"]`)];
const rowFor = (root, key) => [...root.querySelectorAll('[data-entry-row]')]
  .find((row) => row.querySelector(`[data-key="${key}"]`) || row.textContent.includes(key));
const type = (window, input, value) => {
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};

test('languages page', { skip: JSDOM ? false : 'jsdom is not installed (npm install --no-save jsdom)' }, async (t) => {
  const { window, root, saved, toasts } = boot();
  await window.NC.views.languages.render(root);

  await t.test('shows one column per language, in sheet order: #, bpy, bn, en', () => {
    const heads = [...root.querySelectorAll('thead th')].map((th) => (th.firstChild.textContent || '').trim());
    assert.deepEqual(heads, ['#', 'bpy', 'bn', 'en']);
    const labels = [...root.querySelectorAll('thead th small')].map((node) => node.textContent.trim());
    assert.deepEqual(labels, ['বিষ্ণুপ্রিয়া মণিপুরী', 'বাংলা', 'English'], 'every column says which language it is');
  });

  await t.test('a stored heading or bullet row never becomes a row on the page', () => {
    // The fixture's Bengali list is five strings and the stored bpy file carries
    // a `### …` row, which the page leaves out of the grid entirely.
    assert.equal(root.querySelectorAll('[data-entry-row]').length, SOURCE.length);
    assert.equal([...root.querySelectorAll('[data-key]')].some((node) => node.dataset.key.startsWith('###')), false);
    assert.equal(root.querySelector('[data-entry-search]').placeholder.length > 0, true, 'the toolbar is still there');
  });

  await t.test('one row per string, with all three languages editable', () => {
    assert.equal(root.querySelectorAll('[data-entry-row]').length, SOURCE.length);
    const sourceRow = rowFor(root, 'শিরোনাম');
    assert.equal(sourceRow.querySelectorAll('input').length, 3, 'bpy, bn and en are all inputs');
    const bengali = sourceRow.querySelector('[data-entry][data-lang="bn"]');
    assert.equal(bengali.value, 'শিরোনাম', 'the Bengali column shows the app\'s own string');
    assert.ok(bengali, 'Bengali is editable');
    assert.equal(bengali.value, 'শিরোনাম', 'and starts as the app\'s own string');
    assert.equal(bengali.dataset.key, 'শিরোনাম', 'carrying the key the app looks it up by');
  });

  await t.test('an existing translation is loaded into its cell', () => {
    assert.equal(cells(root, 'bpy')[0].value, 'Elahan');
    assert.equal(cells(root, 'en')[0].value, 'Song');
    assert.equal(cells(root, 'bpy')[1].value, '', 'untranslated strings start blank');
  });

  await t.test('coverage is shown per language, and what is published beside it', () => {
    const chips = root.querySelector('[data-lang-chips]').textContent.replace(/\s+/g, ' ').trim();
    // Two numbers per language: what the grid holds, and what the app can read.
    // They differ the moment the repository translates something the dashboard has
    // not saved yet — which is the state this page exists to make visible.
    assert.match(chips, new RegExp(`bpy 1/${SOURCE.length} · 1 saved`));
    assert.match(chips, new RegExp(`en 2/${SOURCE.length} · 1 saved`),
      'শিরোনাম came from the committed template, so it is filled but not saved');
    assert.match(chips, /bn 0 edited · 5 saved/);
  });

  await t.test('typing in a cell keeps the caret and updates the counts', () => {
    const input = cells(root, 'bpy')[1];
    input.focus();
    type(window, input, 'নিংশিং চে');
    assert.equal(window.document.activeElement, input, 'the grid is not redrawn while typing');
    assert.equal(input.value, 'নিংশিং চে');
    assert.match(root.querySelector('[data-lang-chips]').textContent.replace(/\s+/g, ' '), new RegExp(`bpy 2/${SOURCE.length}`));
  });

  await t.test('filters narrow the rows without redrawing', () => {
    // Filtering hides rows in place (so typing in a cell is never interrupted),
    // so visibility — not presence in the DOM — is what these count.
    const rows = () => root.querySelectorAll('[data-entry-row]:not([hidden])').length;
    assert.equal(rows(), SOURCE.length, 'All shows every row');

    // গান has both from the stored files, and শিরোনাম has its English from the
    // committed template and its bpy from the cell typed in the test above.
    root.querySelector('[data-filter="missing"]').click();
    const missing = rows();
    assert.equal(missing, SOURCE.length - 2, 'Missing is everything but the complete rows');
    root.querySelector('[data-filter="complete"]').click();
    assert.equal(rows(), 2, 'Complete shows the rows that have both values');
    assert.equal(rows(), SOURCE.length - missing, 'and the two filters are complements');
    root.querySelector('[data-filter="all"]').click();
    assert.equal(rows(), SOURCE.length);

    const search = root.querySelector('[data-entry-search]');
    search.focus();
    type(window, search, 'অন্বেষণ');
    assert.equal(window.document.activeElement, search, 'the search box keeps focus');
    assert.equal(rows(), 1);
    type(window, search, '');
    assert.equal(rows(), SOURCE.length);
  });

  await t.test('the search looks at every string, not just the page on screen', async () => {
    // The sheet is several pages long and the search used to hide rows in place,
    // so it could only ever see the twenty-five in front of it: typing a string
    // that lived on another page answered "0 of 797" and the row looked missing.
    const NL = String.fromCharCode(10);
    const longCsv = ['key,value', ...LONG_SOURCE.map((key) => `${key},${key}`)].join(NL) + NL;
    const long = boot({ bn: longCsv });
    await long.window.NC.views.languages.render(long.root);
    assert.equal(long.root.querySelectorAll('[data-entry-row]').length, 25, 'page one shows one page of rows');
    assert.equal(long.root.querySelector('[data-entry-shown]').textContent, '25');

    // The last string is on the last page, and has never been rendered.
    const box = long.root.querySelector('[data-entry-search]');
    box.focus();
    type(long.window, box, LONG_SOURCE[LONG_SOURCE.length - 1]);
    assert.equal(long.window.document.activeElement, box, 'the search box keeps the caret');
    assert.equal(long.root.querySelector('[data-entry-shown]').textContent, '1', 'the match is found across all pages');
    assert.equal(long.root.querySelectorAll('[data-entry-row]').length, 1);
    assert.equal(
      long.root.querySelectorAll('[data-entry][data-lang="bn"]')[0].dataset.key,
      LONG_SOURCE[LONG_SOURCE.length - 1]
    );

    // A filter spans the whole sheet too, and clearing the search restores it.
    type(long.window, box, '');
    assert.equal(long.root.querySelector('[data-entry-shown]').textContent, '25');
    assert.equal(long.root.querySelectorAll('[data-entry-row]').length, 25);
  });

  await t.test('save writes one file per language, blanks dropped', async () => {
    root.querySelector('[data-save-all]').click();
    await settle();
    const byLang = Object.fromEntries(saved.map((entry) => [entry.payload.lang, entry.payload]));
    assert.deepEqual(Object.keys(byLang).sort(), ['bn', 'bpy', 'en'], 'one file per language, Bengali included');
    assert.equal(byLang.bpy.table, undefined);
    assert.equal(saved[0].table, 'languageFiles');
    assert.equal(saved[0].conflict, 'lang');
    // bpy: গান=Elahan (loaded) + শিরোনাম=নিংশিং চে (typed). Blank rows are not written.
    assert.match(byLang.bpy.csv, /^key,value\n/);
    assert.match(byLang.bpy.csv, /গান,Elahan\n/);
    assert.match(byLang.bpy.csv, /শিরোনাম,নিংশিং চে\n/);
    assert.equal(byLang.bpy.row_count, 2);
    assert.doesNotMatch(byLang.bpy.csv, /অনুসন্ধান/);
    assert.doesNotMatch(byLang.bpy.csv, /###/, 'and the stored heading is not written back either');
    assert.match(byLang.en.csv, /গান,Song\n/);
    // শিরোনাম was never typed here: it came in from the committed template, and
    // pressing Save is what publishes it — the road from the repository to the app.
    assert.match(byLang.en.csv, /শিরোনাম,Title\n/);
    assert.equal(byLang.en.row_count, 2);
    // Nobody has rewritten the Bengali yet, so its file holds no rows at all:
    // the app falls back to the string compiled into it.
    assert.equal(byLang.bn.csv, 'key,value\n');
    assert.equal(byLang.bn.row_count, 0);
    assert.ok(toasts.some((toast) => toast.tone === 'success' && /Saved/.test(toast.message)));
  });

  await t.test('rewriting the Bengali saves it against the app\'s own string', async () => {
    const input = cells(root, 'bn')[0];
    input.focus();
    type(window, input, 'গানবৃন্দ');
    assert.equal(window.document.activeElement, input, 'the grid is not redrawn while typing');
    const hint = input.closest('td').querySelector('[data-key-hint]');
    assert.equal(hint.textContent.trim(), 'মূল: গান', 'the app\'s own string stays visible under the rewrite');
    assert.match(root.querySelector('[data-lang-chips]').textContent.replace(/\s+/g, ' '), /bn 1 edited/);

    root.querySelector('[data-save-all]').click();
    await settle();
    const bn = saved.filter((entry) => entry.payload.lang === 'bn').pop();
    assert.match(bn.payload.csv, /^key,value\nগান,গানবৃন্দ\n$/, 'the key is the app\'s string, the value is the rewrite');
    assert.equal(bn.payload.row_count, 1);
    assert.doesNotMatch(bn.payload.csv, /শিরোনাম/, 'rows nobody rewrote are not written out again');

    // Put it back, so the later subtests read the sheet they started with.
    type(window, input, 'গান');
    assert.equal(input.closest('td').querySelector('[data-key-hint]').textContent.trim(), '');
  });

  await t.test('a value with a comma is quoted on the way out', async () => {
    const input = cells(root, 'en')[2];
    type(window, input, 'Search, find');
    root.querySelector('[data-save-all]').click();
    await settle();
    const en = saved.filter((entry) => entry.payload.lang === 'en').pop();
    assert.match(en.payload.csv, /অনুসন্ধান,"Search, find"\n/);
    assert.equal(window.NC.languageFiles.parsePairs(en.payload.csv)
      .filter(([key]) => key === 'অনুসন্ধান')[0][1], 'Search, find');
  });

  await t.test('import reads the sheet shape back in', async () => {
    // Filtering removes rows from the DOM, so start from a clean view.
    root.querySelector('[data-filter="all"]').click();
    root.querySelector('[data-import]').click();
    const textarea = window.document.querySelector('#import-csv');
    textarea.value = '#,bpy,bn,en\n'
      + '1,বিসারিক,অনুসন্ধান,Search\n'
      + '2,মাকরিক,অন্বেষণ,Exploration\n'
      + '3,নুৱা কথা,নতুন শব্দ,New word\n';
    window.document.querySelector('[data-apply-import]').click();
    await settle();
    assert.ok(toasts.some((toast) => /Imported 3 rows/.test(toast.message)), 'the toast reports the import');
    const cellFor = (code, key) => {
      const row = rowFor(root, key);
      return row ? row.querySelector(`[data-entry][data-lang="${code}"]`).value : undefined;
    };
    assert.equal(cellFor('bpy', 'অনুসন্ধান'), 'বিসারিক');
    assert.equal(cellFor('en', 'অন্বেষণ'), 'Exploration');

    // The new key is not in the Bengali list, so it is shown as extra and kept.
    const extraRow = rowFor(root, 'নতুন শব্দ');
    assert.ok(extraRow, 'a key the app does not know is still shown');
    assert.match(extraRow.textContent, /extra/);

    root.querySelector('[data-save-all]').click();
    await settle();
    const bpy = saved.filter((entry) => entry.payload.lang === 'bpy').pop();
    assert.match(bpy.payload.csv, /অন্বেষণ,মাকরিক\n/);
    assert.match(bpy.payload.csv, /নতুন শব্দ,নুৱা কথা\n/, 'extra keys survive a save');
  });

  await t.test('import lands on the app\'s key when the sheet carries rewritten Bengali', async () => {
    const before = root.querySelectorAll('[data-entry-row]').length;
    root.querySelector('[data-import]').click();
    window.document.querySelector('#import-csv').value =
      '#,bpy,bn,en,key\n1,Elahan,গানবৃন্দ,Song,গান\n';
    window.document.querySelector('[data-apply-import]').click();
    await settle();
    assert.equal(root.querySelectorAll('[data-entry-row]').length, before,
      'the rewritten Bengali did not become a new string of its own');
    const row = rowFor(root, 'গান');
    assert.equal(row.querySelector('[data-entry][data-lang="bn"]').value, 'গানবৃন্দ');
    assert.equal(row.querySelector('[data-entry][data-lang="bn"]').dataset.key, 'গান');
    // Back to the sheet the later subtests expect.
    root.querySelector('[data-import]').click();
    window.document.querySelector('#import-csv').value = '#,bpy,bn,en,key\n1,Elahan,গান,Song,\n';
    window.document.querySelector('[data-apply-import]').click();
    await settle();
  });

  await t.test('a typed key that differs only by punctuation lands on the real key', async () => {
    // The sheet says "অডিও ফাইল পড়া যায়নি", the app's string ends in "।".
    root.querySelector('[data-filter="all"]').click();
    root.querySelector('[data-import]').click();
    window.document.querySelector('#import-csv').value =
      '#,bpy,bn,en\n1,অডিও ফাইলগো তামকরানি নাকরের,অডিও ফাইল পড়া যায়নি,Audio file cannot read\n';
    window.document.querySelector('[data-apply-import]').click();
    await settle();
    assert.ok(toasts.some((toast) => /ignoring punctuation/.test(toast.message)),
      'the import says it matched a key loosely');
    // The row it landed on is the app's real key, danda included.
    assert.ok(rowFor(root, 'অডিও ফাইল পড়া যায়নি।'), 'the punctuation-less row found its key');
    const matched = rowFor(root, 'অডিও ফাইল পড়া যায়নি।').querySelector('[data-entry][data-lang="bn"]');
    assert.equal(matched.value, 'অডিও ফাইল পড়া যায়নি।',
      'a Bengali cell that only repeats the row is not read as a rewrite of it');
    root.querySelector('[data-save-all]').click();
    await settle();
    const bpy = saved.filter((entry) => entry.payload.lang === 'bpy').pop();
    assert.match(bpy.payload.csv, /শিরোনাম,নিংশিং চে|গান,Elahan/, 'the earlier rows are still there');
    assert.doesNotMatch(bpy.payload.csv, /পড়া যায়নি,/, 'it did not land on a near-miss key of its own');
  });

  // -------------------------------------------------------------------------
  // The road from the repository to the app
  // -------------------------------------------------------------------------

  await t.test('a translation committed in the repository reaches the grid', async () => {
    // The page is served from the same directory the templates are built into
    // (`i18n/build_language_templates.py` writes `assets/lang/*.csv`), so a
    // translator's sheet committed there is one press away from being published.
    // Before this the page read `bn.csv` for its key list and nothing else: the
    // other two files were invisible to it however full they were, which is why
    // the dashboard could look empty while the repository was translated.
    const fresh = boot({
      stored: [
        { lang: 'bn', label: 'বাংলা', csv: bnCsv, row_count: SOURCE.length },
        { lang: 'bpy', label: 'বিষ্ণুপ্রিয়া মণিপুরী', csv: '', row_count: 0 },
        { lang: 'en', label: 'English', csv: '', row_count: 0 }
      ],
      enTemplate: 'key,value\nগান,Song\nশিরোনাম,Title\n',
      bpyTemplate: 'key,value\nগান,Elahan\n'
    });
    await fresh.window.NC.views.languages.render(fresh.root);
    assert.equal(cells(fresh.root, 'en')[0].value, 'Song', 'the English template is read on load');
    assert.equal(cells(fresh.root, 'en')[1].value, 'Title');
    assert.equal(cells(fresh.root, 'bpy')[0].value, 'Elahan', 'and the Bishnupriya one too');
    assert.equal(fresh.saved.length, 0, 'reading a template writes nothing — Save publishes');

    fresh.root.querySelector('[data-save-all]').click();
    await settle();
    const en = fresh.saved.filter((entry) => entry.payload.lang === 'en').pop();
    assert.match(en.payload.csv, /গান,Song\n/);
    assert.match(en.payload.csv, /শিরোনাম,Title\n/);
    assert.equal(en.payload.row_count, 2, 'and the count is what the file the app reads holds');
  });

  await t.test('Load templates fills the blanks, and never a written cell', async () => {
    // The template is not always there — it deploys with the site, so a dashboard
    // opened while that deploy is running finds a 404 — and an editor may have
    // typed over a cell in the meantime. The button is the second attempt, and it
    // only ever writes into cells that are still empty.
    const fresh = boot({
      stored: [
        { lang: 'bn', label: 'বাংলা', csv: bnCsv, row_count: SOURCE.length },
        { lang: 'bpy', label: 'বিষ্ণুপ্রিয়া মণিপুরী', csv: '', row_count: 0 },
        { lang: 'en', label: 'English', csv: '', row_count: 0 }
      ],
      enTemplate: null,
      bpyTemplate: null
    });
    await fresh.window.NC.views.languages.render(fresh.root);
    assert.equal(cells(fresh.root, 'en').filter((input) => input.value).length, 0,
      'with no template to read, the English column is empty');

    // The editor types one cell before the template arrives.
    const typed = cells(fresh.root, 'en')[2];
    type(fresh.window, typed, 'Look for');

    // Now the deploy lands and the templates can be read.
    fresh.window.fetch = async (url) => {
      const name = String(url).split('/').pop();
      if (name === 'en.csv') return { ok: true, text: async () => 'key,value\nগান,Song\nশিরোনাম,Title\n' };
      if (name === 'bpy.csv') return { ok: true, text: async () => 'key,value\nগান,Elahan\n' };
      return { ok: false, status: 404, text: async () => '' };
    };
    const button = fresh.root.querySelector('[data-load-templates]');
    assert.ok(button, 'the button the i18n README tells an editor to press exists');
    button.click();
    await settle();
    assert.equal(cells(fresh.root, 'en')[0].value, 'Song', 'the blank cell takes the template');
    assert.equal(cells(fresh.root, 'en')[1].value, 'Title');
    assert.equal(fresh.root.querySelector('[data-entry][data-lang="en"][data-key="অনুসন্ধান"]').value,
      'Look for', 'the cell the editor wrote is left alone');
    assert.equal(cells(fresh.root, 'bpy')[0].value, 'Elahan');
    assert.ok(fresh.toasts.some((toast) => toast.message === 'Filled 3 empty cells from the committed templates (bpy 1, en 2). Press Save translations to publish.'),
      'and it says how many cells it filled, and from where');
    assert.equal(fresh.saved.length, 0, 'still nothing written: publishing is the Save button');

    // Pressed again with nothing left to fill, it says so rather than counting zero
    // silently.
    fresh.toasts.length = 0;
    button.click();
    await settle();
    assert.ok(fresh.toasts.some((toast) => /carry no wording the grid does not already have/.test(toast.message)));
  });

  await t.test('a language with nothing published says so, and says what to do', async () => {
    const empty = boot({
      stored: [
        { lang: 'bn', label: 'বাংলা', csv: '', row_count: 0 },
        { lang: 'bpy', label: 'বিষ্ণুপ্রিয়া মণিপুরী', csv: '', row_count: 0 },
        { lang: 'en', label: 'English', csv: '', row_count: 0 }
      ]
    });
    await empty.window.NC.views.languages.render(empty.root);
    const note = empty.root.querySelector('[data-publish-note]').textContent.replace(/\s+/g, ' ');
    assert.match(note, /Nothing has been published yet/,
      'the state the app is in when nobody has ever saved');
    assert.match(note, /app shows its own Bengali text whatever language a reader picks/);
    assert.match(note, /Load templates/);
    assert.match(note, /Save translations/, 'and the way out of it');

    // Half-published is its own sentence: a reader who picks the missing language
    // still sees Bengali, and the notice names which one that is.
    const half = boot({
      stored: [
        { lang: 'bn', label: 'বাংলা', csv: bnCsv, row_count: SOURCE.length },
        { lang: 'bpy', label: 'বিষ্ণুপ্রিয়া মণিপুরী', csv: '', row_count: 0 },
        { lang: 'en', label: 'English', csv: enCsv, row_count: 1 }
      ]
    });
    await half.window.NC.views.languages.render(half.root);
    const partly = half.root.querySelector('[data-publish-note]').textContent.replace(/\s+/g, ' ');
    assert.match(partly, /Not published yet: bpy/);
    assert.doesNotMatch(partly, /Nothing has been published yet/);

    // And a board with everything published says nothing at all.
    const done = boot();
    await done.window.NC.views.languages.render(done.root);
    assert.equal(done.root.querySelector('[data-publish-note]').textContent.trim(), '');
  });

  await t.test('saving updates what the page says is published', async () => {
    const fresh = boot({
      stored: [
        { lang: 'bn', label: 'বাংলা', csv: '', row_count: 0 },
        { lang: 'bpy', label: 'বিষ্ণুপ্রিয়া মণিপুরী', csv: '', row_count: 0 },
        { lang: 'en', label: 'English', csv: '', row_count: 0 }
      ]
    });
    await fresh.window.NC.views.languages.render(fresh.root);
    assert.match(fresh.root.querySelector('[data-publish-note]').textContent, /Nothing has been published yet/);
    // Type one English cell and publish: the notice stops saying "all three are
    // empty", because after this save it is no longer true.
    type(fresh.window, cells(fresh.root, 'en')[0], 'Song');
    fresh.root.querySelector('[data-save-all]').click();
    await settle();
    const note = fresh.root.querySelector('[data-publish-note]').textContent.replace(/\s+/g, ' ');
    // bpy came in from its committed template and was published by the same
    // press, so Bengali is the one still to do.
    assert.match(note, /Not published yet: bn\./, 'the empty one is named, not the published ones');
    assert.match(fresh.root.querySelector('[data-lang-chips]').textContent.replace(/\s+/g, ' '), /en 2\/5 · 2 saved/, 'the typed row and the template row are both published');
  });

  await t.test('a failed save surfaces the error instead of pretending', async () => {
    window.__failNextSave();
    root.querySelector('[data-save-all]').click();
    await settle();
    assert.ok(toasts.some((toast) => toast.tone === 'error' && /could not be saved/.test(toast.message)));
  });
});
