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
  let editor;

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
        renderTabs();
        renderEditor();
      });
    });
  }

  function stashEditor() {
    if (!editor) return;
    rows[active] = { ...(rows[active] || {}), csv: editor.value };
  }

  function renderEditor() {
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
      <div class="field">
        <label class="field-label" for="lang-csv">CSV (key,value)</label>
        <textarea class="form-textarea" id="lang-csv" rows="18" spellcheck="false" dir="auto">${escapeHTML(text)}</textarea>
        <p class="field-hint">Blank values keep the app's own Bengali text. Blank lines, duplicate keys and rows without a comma are reported on save and skipped.</p>
      </div>`;

    editor = root.querySelector('#lang-csv');
    root.querySelector('[data-load-template]').addEventListener('click', async () => {
      try {
        const text2 = await loadTemplate(active);
        if (editor.value.trim() && !window.confirm('Replace the editor with the template? Unsaved changes are lost.')) return;
        editor.value = text2;
        NC.components.toast(`Template for ${meta.label} loaded. Press Save to publish it.`, 'info');
        renderEditor();
      } catch (error) {
        NC.components.toast(`Template could not be loaded (${error.message}).`, 'error');
      }
    });
    root.querySelector('[data-download]').addEventListener('click', () => {
      const blob = new Blob([editor.value], { type: 'text/csv;charset=utf-8' });
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
      renderEditor();
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
      renderEditor();
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
  NC.languageFiles = Object.freeze({ parseCSV, writeCSV, parsePairs, summarise, compareWithReference });
})(window.NC);
