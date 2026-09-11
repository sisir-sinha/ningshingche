(function (NC) {
  'use strict';

  /**
   * Interface language files.
   *
   * One row per language in public.app_language_files holds that language's
   * CSV, and the Android app fetches the row for the language its reader picked
   * (then caches it). Keys are the Bengali source strings written in the app,
   * so the Bengali template doubles as the key list: "Load template" starts
   * from it, and the page reports how far the chosen language has got.
   *
   * A language file is text, so the editor is a textarea with CSV validation
   * rather than a per-row table: translators work in bulk, and a pasted CSV
   * from any spreadsheet keeps working.
   */

  const { escapeHTML } = NC.utils;
  const LANGS = [
    { code: 'bn', label: 'বাংলা', hint: 'Keys themselves; used as the reference list.' },
    { code: 'en', label: 'English', hint: 'English wording for each Bengali key.' },
    { code: 'bpy', label: 'বিষ্ণুপ্রিয়া মণিপুরী', hint: 'Bishnupriya Manipuri wording for each Bengali key.' }
  ];
  const TEMPLATE_BASE = 'assets/lang';

  let root;
  let rows = {};
  let active = 'bpy';
  let referenceKeys = null;
  let view = 'table';      // 'table' = per-string list, 'csv' = whole file
  let query = '';          // search across key and value
  let filter = 'all';      // all | empty | translated
  let page = 1;
  const PAGE_SIZE = 25;

  /** Minimal RFC4180 reader: quoted fields, escaped quotes, CRLF, embedded newlines. */
  function parseCSV(text) {
    const clean = String(text || '').replace(/^\uFEFF/, '');
    const records = [];
    let field = '';
    let record = [];
    let quoted = false;
    for (let index = 0; index < clean.length; index += 1) {
      const char = clean[index];
      if (quoted) {
        if (char === '"') {
          if (clean[index + 1] === '"') { field += '"'; index += 1; }
          else quoted = false;
        } else field += char;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === ',') { record.push(field); field = ''; continue; }
      if (char === '\n') { record.push(field); records.push(record); record = []; field = ''; continue; }
      if (char === '\r') continue;
      field += char;
    }
    if (field.length || record.length) { record.push(field); records.push(record); }
    while (records.length && records[records.length - 1].every((cell) => !cell.trim())) records.pop();
    return records;
  }

  function writeCSV(pairs) {
    const cell = (value) => {
      const text = String(value ?? '');
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return `key,value\n${pairs.map(([key, value]) => `${cell(key)},${cell(value)}`).join('\n')}\n`;
  }

  function parsePairs(csvText) {
    const records = parseCSV(csvText);
    if (records.length) records.shift();
    const pairs = [];
    records.forEach((cells) => {
      if (cells.length < 1) return;
      const key = (cells[0] || '').trim();
      if (!key) return;
      pairs.push([key, cells.slice(1).join(',')]);
    });
    return pairs;
  }

  function summarise(pairs) {
    const translated = pairs.filter(([, value]) => value.trim()).length;
    return { total: pairs.length, translated, missing: Math.max(0, pairs.length - translated) };
  }

  /** Keys the Bengali template has but this file does not, and the reverse. */
  function compareWithReference(pairs, reference = referenceKeys) {
    if (!reference) return { missing: [], extra: [] };
    const here = new Set(pairs.map(([key]) => key));
    const reference2 = new Set(reference);
    return {
      missing: reference.filter((key) => !here.has(key)),
      extra: pairs.map(([key]) => key).filter((key) => !reference2.has(key))
    };
  }

  async function loadTemplate(lang) {
    const response = await fetch(`${TEMPLATE_BASE}/${lang}.csv`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.text();
  }

  async function ensureReference() {
    if (referenceKeys) return referenceKeys;
    const text = await loadTemplate('bn');
    referenceKeys = parsePairs(text).map(([key]) => key);
    return referenceKeys;
  }

  function renderTabs() {
    const tabs = LANGS.map((lang) => {
      const state = summarise(parsePairs(rows[lang.code]?.csv || ''));
      const badge = state.total ? `${state.translated}/${state.total}` : 'empty';
      return `<button type="button" class="btn ${lang.code === active ? 'btn-primary' : 'btn-secondary'}" data-lang="${lang.code}">
        <i class="fa-regular fa-language" aria-hidden="true"></i>${escapeHTML(lang.label)}
        <span class="status-badge status-neutral">${escapeHTML(badge)}</span>
      </button>`;
    }).join('');
    root.querySelector('[data-lang-tabs]').innerHTML = tabs;
    root.querySelectorAll('[data-lang-tabs] [data-lang]').forEach((button) => {
      button.addEventListener('click', () => {
        stashEditor();
        active = button.dataset.lang;
        query = '';
        filter = 'all';
        page = 1;
        renderTabs();
        renderPanel();
      });
    });
  }

  /** Rows of the active language as { index, key, value } for the table view. */
  /** The CSV textarea, but only while the CSV view is on screen. */
  function csvEditor() {
    return root ? root.querySelector('#lang-csv') : null;
  }

  /** The file text the page is working with, from the editor if it is open. */
  function currentCsv() {
    const textarea = csvEditor();
    return textarea ? textarea.value : (rows[active]?.csv || '');
  }

  function entryRows() {
    return parsePairs(currentCsv()).map(([key, value], index) => ({ index, key, value }));
  }

  function visibleEntries(entries) {
    const search = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const filled = entry.value.trim().length > 0;
      if (filter === 'empty' && filled) return false;
      if (filter === 'translated' && !filled) return false;
      if (!search) return true;
      return entry.key.toLowerCase().includes(search) || entry.value.toLowerCase().includes(search);
    });
  }

  /**
   * Replace one key's value inside the file text, touching nothing else — the
   * comments, quoting and row order of a hand-edited CSV are all preserved.
   * A key that is not in the file yet is appended.
   */
  function withValue(csv, key, value) {
    const lines = String(csv || '').split('\n');
    const cell = (text) => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].trim()) continue;
      const parsed = parseCSV(lines[index])[0];
      if (!parsed || parsed.length < 2) continue;
      if (parsed[0].trim() !== key) continue;
      lines[index] = `${cell(key)},${cell(value)}`;
      return lines.join('\n');
    }
    // Not in this file yet: the dashboard's own readers accept extra rows, and a
    // key outside the Bengali list is reported separately on screen.
    lines.push(`${cell(key)},${cell(value)}`);
    return lines.join('\n');
  }

  function updateCsv(mutate) {
    const next = mutate(currentCsv());
    rows[active] = { ...(rows[active] || {}), csv: next };
    const textarea = csvEditor();
    if (textarea) textarea.value = next;
    return next;
  }

  function viewTabsMarkup() {
    const state = summarise(parsePairs(currentCsv()));
    const tabs = [
      ['table', 'Strings', 'fa-table-list', `${state.total}`],
      ['csv', 'Whole file (CSV)', 'fa-file-code', '']
    ];
    return tabs.map(([id, label, icon, badge]) => `<button type="button" class="btn ${view === id ? 'btn-primary' : 'btn-secondary'}" data-view="${id}">
      <i class="fa-regular ${icon}" aria-hidden="true"></i>${escapeHTML(label)}${badge ? `<span class="status-badge status-neutral">${escapeHTML(badge)}</span>` : ''}</button>`).join('');
  }

  function tableMarkup() {
    const entries = entryRows();
    const state = summarise(entries.map((entry) => [entry.key, entry.value]));
    const filtered = visibleEntries(entries);
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(1, page), pages);
    page = safePage;
    const slice = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const body = slice.map((entry) => `<tr data-entry-row data-translated="${entry.value.trim() ? 'true' : 'false'}" data-search-text="${escapeHTML(`${entry.key} ${entry.value}`)}">
        <td data-label="#"><span class="text-faint">${entry.index + 1}</span></td>
        <td data-label="Bengali source (key)"><strong dir="auto">${escapeHTML(entry.key)}</strong></td>
        <td data-label="Translation"><input class="form-input" data-entry="${entry.index}" dir="auto" spellcheck="false" placeholder="Empty keeps the Bengali text" value="${escapeHTML(entry.value)}"></td>
      </tr>`).join('');
    return `
      <div class="list-toolbar">
        <label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search strings</span><input type="search" placeholder="Search Bengali or translation…" data-entry-search value="${escapeHTML(query)}"></label>
        <div class="button-row">
          ${[['all', 'All'], ['empty', 'Empty only'], ['translated', 'Translated only']].map(([id, label]) => `<button type="button" class="btn ${filter === id ? 'btn-primary' : 'btn-secondary'}" data-filter="${id}">${label}</button>`).join('')}
        </div>
      </div>
      ${body ? NC.components.tableShell({
        caption: `Strings in ${active}`,
        minWidth: '760px',
        head: '<tr><th style="width:64px">#</th><th>Bengali source (key)</th><th>Translation</th></tr>',
        body
      }) : NC.components.emptyState({ icon: 'fa-inbox', title: 'Nothing matches', description: 'Clear the search or switch the filter to see the other rows.' })}
      <div class="list-toolbar">
        <p class="text-muted-foreground toolbar-note" data-entry-summary>Showing <span data-entry-shown>${slice.length}</span> of ${state.total} rows · ${state.translated} translated · ${state.missing} empty<span data-entry-filtered>${query || filter !== 'all' ? ' · filtered' : ''}</span></p>
        <div class="button-row">
          <button type="button" class="btn btn-secondary" data-page="prev" ${safePage <= 1 ? 'disabled' : ''}><i class="fa-regular fa-chevron-left" aria-hidden="true"></i>Previous</button>
          <span class="status-badge status-neutral">Page ${safePage} / ${pages}</span>
          <button type="button" class="btn btn-secondary" data-page="next" ${safePage >= pages ? 'disabled' : ''}>Next<i class="fa-regular fa-chevron-right" aria-hidden="true"></i></button>
        </div>
      </div>`;
  }

  function csvMarkup(text) {
    return `<div class="field">
        <label class="field-label" for="lang-csv">CSV (key,value)</label>
        <textarea class="form-textarea" id="lang-csv" rows="18" spellcheck="false" dir="auto">${escapeHTML(text)}</textarea>
        <p class="field-hint">Blank values keep the app's own Bengali text. Blank lines, duplicate keys and rows without a comma are reported on save and skipped.</p>
      </div>`;
  }

  /** Hide/show the already-rendered rows for the current search + filter. */
  function applyRowFilter(scope) {
    const search = query.trim().toLowerCase();
    let shown = 0;
    scope.querySelectorAll('[data-entry-row]').forEach((row) => {
      const haystack = (row.dataset.searchText || '').toLowerCase();
      const filled = row.dataset.translated === 'true';
      const matches = (!search || haystack.includes(search))
        && (filter === 'all' || (filter === 'empty' ? !filled : filled));
      row.hidden = !matches;
      if (matches) shown += 1;
    });
    const counter = scope.querySelector('[data-entry-shown]');
    if (counter) counter.textContent = String(shown);
    const filteredTag = scope.querySelector('[data-entry-filtered]');
    if (filteredTag) filteredTag.textContent = (search || filter !== 'all') ? ' · filtered' : '';
  }

  function bindTable(scope) {
    const search = scope.querySelector('[data-entry-search]');
    if (search) {
      // Redrawing the panel would drop the caret, so filter the rendered rows
      // in place; the filter count in the footer follows.
      search.addEventListener('input', () => {
        query = search.value;
        page = 1;
        applyRowFilter(scope);
      });
    }
    scope.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
      stashEditor();
      filter = button.dataset.filter;
      page = 1;
      renderPanel();
    }));
    scope.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => {
      stashEditor();
      page += button.dataset.page === 'next' ? 1 : -1;
      renderPanel();
    }));
    scope.querySelectorAll('[data-entry]').forEach((input) => {
      input.addEventListener('input', () => {
        const entries = entryRows();
        const entry = entries[Number(input.dataset.entry)];
        if (!entry) return;
        const next = updateCsv((csv) => withValue(csv, entry.key, input.value));
        const counter = scope.querySelector('[data-entry-count]');
        if (counter) {
          const state = summarise(parsePairs(next));
          counter.textContent = `${state.translated} translated · ${state.missing} empty`;
        }
      });
    });
  }

  function stashEditor() {
    const textarea = csvEditor();
    if (!textarea) return;
    rows[active] = { ...(rows[active] || {}), csv: textarea.value };
  }

  function renderPanel() {
    const record = rows[active] || {};
    const meta = LANGS.find((lang) => lang.code === active) || LANGS[0];
    const text = record.csv || '';
    const pairs = parsePairs(text);
    const state = summarise(pairs);
    const diff = compareWithReference(pairs);
    const updated = record.updated_at ? NC.utils.formatDate(record.updated_at) : 'never saved';

    root.querySelector('[data-lang-panel]').innerHTML = `
      <div class="list-toolbar">
        <p class="text-muted-foreground toolbar-note">${escapeHTML(meta.hint)} Last saved: ${escapeHTML(updated)}.</p>
        <div class="button-row">
          <button type="button" class="btn btn-secondary" data-load-template><i class="fa-regular fa-file-arrow-down" aria-hidden="true"></i>Load template</button>
          <button type="button" class="btn btn-secondary" data-download><i class="fa-regular fa-download" aria-hidden="true"></i>Download CSV</button>
          <button type="button" class="btn btn-primary" data-save><i class="fa-regular fa-floppy-disk" aria-hidden="true"></i>Save ${escapeHTML(meta.label)}</button>
        </div>
      </div>
      <div class="metrics-grid">
        <article class="metric-card metric-brand"><div class="min-w-0"><p class="metric-label">Rows</p><p class="metric-value">${state.total}</p></div></article>
        <article class="metric-card metric-emerald"><div class="min-w-0"><p class="metric-label">Translated</p><p class="metric-value">${state.translated}</p></div></article>
        <article class="metric-card metric-amber"><div class="min-w-0"><p class="metric-label">Empty values</p><p class="metric-value">${state.missing}</p></div></article>
        <article class="metric-card metric-rose"><div class="min-w-0"><p class="metric-label">Missing keys</p><p class="metric-value">${diff.missing.length}</p></div></article>
      </div>
      ${diff.extra.length ? `<p class="notice notice-warning"><i class="fa-regular fa-triangle-exclamation" aria-hidden="true"></i>${diff.extra.length} key(s) are not in the Bengali list and will be ignored by the app. First few: ${escapeHTML(diff.extra.slice(0, 3).join(' · '))}</p>` : ''}
      <div class="list-toolbar">
        <p class="text-muted-foreground toolbar-note" data-entry-count>${state.translated} translated · ${state.missing} empty</p>
        <div class="button-row" data-view-tabs>${viewTabsMarkup()}</div>
      </div>
      <div data-lang-view>${view === 'csv' ? csvMarkup(text) : tableMarkup()}</div>`;

    root.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
      stashEditor();
      view = button.dataset.view;
      renderPanel();
    }));
    bindTable(root);
    root.querySelector('[data-load-template]').addEventListener('click', async () => {
      try {
        const text2 = await loadTemplate(active);
        if (currentCsv().trim() && !window.confirm('Replace the file with the template? Unsaved changes are lost.')) return;
        updateCsv(() => text2);
        NC.components.toast(`Template for ${meta.label} loaded. Press Save to publish it.`, 'info');
        renderPanel();
      } catch (error) {
        NC.components.toast(`Template could not be loaded (${error.message}).`, 'error');
      }
    });
    root.querySelector('[data-download]').addEventListener('click', () => {
      const blob = new Blob([rows[active]?.csv || ''], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${active}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    });
    root.querySelector('[data-save]').addEventListener('click', (event) => save(event.currentTarget));
  }

  async function save(button) {
    stashEditor();
    const meta = LANGS.find((lang) => lang.code === active) || LANGS[0];
    const csv = rows[active]?.csv || '';
    const pairs = parsePairs(csv);
    const state = summarise(pairs);
    if (!state.total) {
      NC.components.toast('There is nothing to save: the CSV has no key,value rows.', 'warning');
      return;
    }
    const duplicates = pairs.length - new Set(pairs.map(([key]) => key)).size;
    if (duplicates > 0 && !window.confirm(`${duplicates} duplicate key(s) found; the last one wins. Save anyway?`)) return;

    NC.utils.setButtonLoading(button, true, 'Saving…');
    try {
      await NC.api.upsert('languageFiles', {
        lang: meta.code,
        label: meta.label,
        csv,
        row_count: state.total
      }, 'lang');
      rows[active] = { ...(rows[active] || {}), csv, row_count: state.total, updated_at: new Date().toISOString() };
      NC.components.toast(`${meta.label} saved: ${state.translated} translated, ${state.missing} empty. The app picks it up on the next language change or refresh.`, 'success');
      renderTabs();
      renderPanel();
    } catch (error) {
      console.error(error);
      NC.components.toast(NC.api.userMessage(error, 'The language file could not be saved.'), 'error');
    } finally {
      NC.utils.setButtonLoading(button, false);
    }
  }

  async function load() {
    const panel = root.querySelector('[data-lang-panel]');
    panel.innerHTML = NC.components.skeleton(6, 4);
    try {
      const result = await NC.api.list('languageFiles', { select: '*', limit: 50 });
      rows = {};
      result.data.forEach((record) => { rows[record.lang] = record; });
      LANGS.forEach((lang) => { if (!rows[lang.code]) rows[lang.code] = { lang: lang.code, label: lang.label, csv: '' }; });
      await ensureReference();
      renderTabs();
      renderPanel();
    } catch (error) {
      console.error(error);
      panel.innerHTML = NC.components.emptyState({
        icon: 'fa-triangle-exclamation',
        title: 'Language files are unavailable',
        description: NC.api.userMessage(error, 'Run supabase/migrations/023_app_language_files.sql, then reload.')
      });
    }
  }

  function render(container) {
    root = container;
    root.innerHTML = `${NC.components.pageHeader({
      eyebrow: 'System',
      title: 'Language files',
      description: 'Edit the CSV the Android app downloads for Bengali, English and Bishnupriya Manipuri. Keys are the app\'s Bengali strings; a blank value falls back to Bengali.',
      breadcrumb: [{ label: 'Languages' }]
    })}<section class="surface">
      <div class="button-row" data-lang-tabs></div>
      <div data-lang-panel>${NC.components.skeleton(6, 4)}</div>
    </section>`;
    return load();
  }

  NC.views.languages = { render };

  // Exposed for the dashboard's own tests and for reuse by the importer.
  NC.languageFiles = Object.freeze({
    parseCSV, writeCSV, parsePairs, summarise, compareWithReference, withValue
  });
})(window.NC);
