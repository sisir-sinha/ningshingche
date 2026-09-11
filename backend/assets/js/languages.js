(function (NC) {
  'use strict';

  /**
   * Interface language files, edited as one grid: a row per string, a column per
   * language (bpy · bn · en) — the same shape as the spreadsheet the owner fills
   * in, so the page and the sheet can be handed back and forth.
   *
   * Where each numbered column comes from:
   *   bn   the Bengali source text compiled into the app. It is the *key* the app
   *        looks a string up by, so it is read-only here: changing it would break
   *        the lookup rather than rename anything.
   *   bpy  Bishnupriya Manipuri translation   (editable)
   *   en   English translation                (editable)
   *
   * Storage is unchanged — one `key,value` CSV per language in
   * `public.app_language_files`, which is what the app downloads. The grid joins
   * those files for editing and writes them back on save, so nothing has to be
   * migrated and the app keeps working as it is.
   *
   * An empty cell is not an empty string in the app: it means "not translated
   * yet", and the app shows its own Bengali text for that key.
   */

  const { escapeHTML } = NC.utils;

  /** Columns, in the order the owner's sheet shows them. */
  const LANGS = Object.freeze([
    { code: 'bpy', label: 'বিষ্ণুপ্রিয়া মণিপুরী', short: 'bpy', editable: true },
    { code: 'bn', label: 'বাংলা', short: 'bn', editable: false, source: true },
    { code: 'en', label: 'English', short: 'en', editable: true }
  ]);
  const SOURCE = 'bn';
  const EDITABLE = LANGS.filter((lang) => lang.editable).map((lang) => lang.code);
  const TEMPLATE_BASE = 'assets/lang';
  const PAGE_SIZE = 25;

  let root;
  let rows = {};                    // language code → stored record
  let keys = [];                    // the string order the grid shows
  let values = {};                  // language code → { key: value }
  let known = new Set();            // keys present in the Bengali list
  let query = '';
  let filter = 'all';               // all | missing | complete
  let page = 1;

  // ------------------------------------------------------------------ CSV

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

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function writeCSV(pairs) {
    return `key,value\n${pairs.map(([key, value]) => `${csvCell(key)},${csvCell(value)}`).join('\n')}\n`;
  }

  /** `key,value` pairs from a language file, header skipped, blank values dropped. */
  function parsePairs(text) {
    const records = parseCSV(text);
    if (records.length) records.shift();
    const pairs = [];
    records.forEach((cells) => {
      if (!cells.length) return;
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

  // --------------------------------------------------------------- matrix

  /**
   * Trimmed, single-spaced, without trailing sentence punctuation — the same
   * fallback the app applies when it looks a string up (`looseKey` in
   * `ui/i18n/Strings.kt`), so a sheet typed by hand does not miss a key over a
   * stray `।`.
   */
  function looseKey(text) {
    return String(text || '').trim().replace(/\s+/g, ' ').replace(/[।.!?\s\u200b]+$/, '');
  }

  /** The grid rows: key + one value per language, in `keyList` order. */
  function buildMatrix(keyList, maps) {
    return keyList.map((key) => ({
      key,
      known: known.has(key),
      values: LANGS.reduce((acc, lang) => {
        acc[lang.code] = (maps[lang.code] || {})[key] || '';
        return acc;
      }, {})
    }));
  }

  /**
   * The grid as the owner's sheet: `#,bpy,bn,en`, one row per string. The number
   * column is written for the spreadsheet and ignored on the way back in.
   */
  function matrixCsv(matrix) {
    const header = ['#', ...LANGS.map((lang) => lang.short)].join(',');
    const lines = matrix.map((entry, index) =>
      [String(index + 1), ...LANGS.map((lang) => csvCell(entry.values[lang.code]))].join(','));
    return `${header}\n${lines.join('\n')}\n`;
  }

  /**
   * Reads a matrix file back in. Columns are matched by header name in any
   * order; `#` and unknown columns are ignored; the Bengali column is the key.
   * A plain `key,value` file is accepted too and treated as one language's file
   * when its second column names bpy or en.
   */
  function parseMatrix(text) {
    const records = parseCSV(text);
    if (!records.length) return null;
    const header = records[0].map((cell) => cell.trim().toLowerCase());
    const shortCodes = LANGS.map((lang) => lang.short);
    let keyColumn = header.indexOf(SOURCE);
    let languageColumns = {};
    shortCodes.forEach((code) => {
      const at = header.indexOf(code);
      if (at > -1) languageColumns[code] = at;
    });
    if (keyColumn === -1 && header[0] === 'key') {
      // `key,value` from a single language file.
      const language = header[1] && shortCodes.includes(header[1]) ? header[1] : null;
      if (language && language !== SOURCE) { keyColumn = 0; languageColumns = { [language]: 1 }; }
    }
    if (keyColumn === -1 || !Object.keys(languageColumns).length) return null;
    const order = [];
    const out = {};
    LANGS.forEach((lang) => { out[lang.code] = {}; });
    records.slice(1).forEach((cells) => {
      const key = (cells[keyColumn] || '').trim();
      if (!key) return;
      if (!(key in out[SOURCE]) && !order.includes(key)) order.push(key);
      Object.entries(languageColumns).forEach(([code, at]) => {
        // One cell, not the rest of the row: columns are positional here.
        out[code][key] = String(cells[at] ?? '').trim();
      });
      if (!(key in out[SOURCE]) && out[SOURCE][key] === undefined) out[SOURCE][key] = key;
    });
    return { keys: order, values: out };
  }

  // ---------------------------------------------------------------- load

  async function loadTemplate(lang) {
    const response = await fetch(`${TEMPLATE_BASE}/${lang}.csv`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.text();
  }

  /** The Bengali key list: the bn row if it has one, else the committed template. */
  async function keyListFrom(bnCsv) {
    const fromRow = parsePairs(bnCsv).map(([key]) => key).filter(Boolean);
    if (fromRow.length) return fromRow;
    return parsePairs(await loadTemplate(SOURCE)).map(([key]) => key).filter(Boolean);
  }

  async function load() {
    const panel = root.querySelector('[data-grid-panel]');
    panel.innerHTML = NC.components.skeleton(7, 4);
    try {
      const result = await NC.api.list('languageFiles', { select: '*', limit: 50 });
      rows = {};
      result.data.forEach((record) => { rows[record.lang] = record; });
      LANGS.forEach((lang) => {
        if (!rows[lang.code]) rows[lang.code] = { lang: lang.code, label: lang.label, csv: '' };
      });

      const keyList = await keyListFrom(rows[SOURCE].csv || '');
      known = new Set(keyList);
      values = {};
      LANGS.forEach((lang) => {
        values[lang.code] = {};
        parsePairs(rows[lang.code].csv || '').forEach(([key, value]) => {
          values[lang.code][key] = value;
          if (lang.code === SOURCE && !values[SOURCE][key]) values[SOURCE][key] = key;
        });
        if (lang.code === SOURCE) {
          // The Bengali column is the source text: it always has the key itself.
          keyList.forEach((key) => { values[SOURCE][key] = key; });
        }
      });

      // Keys a translator added by hand are kept, after the known list, so a save
      // does not silently drop them.
      const extraKeys = [];
      LANGS.forEach((lang) => {
        Object.keys(values[lang.code]).forEach((key) => {
          if (!known.has(key) && !extraKeys.includes(key)) extraKeys.push(key);
        });
      });
      keys = [...keyList, ...extraKeys];

      page = 1;
      renderToolbar();
      renderGrid();
    } catch (error) {
      console.error(error);
      panel.innerHTML = NC.components.emptyState({
        icon: 'fa-triangle-exclamation',
        title: 'Language files are unavailable',
        description: NC.api.userMessage(error, 'Run supabase/migrations/023_app_language_files.sql, then reload.')
      });
    }
  }

  // --------------------------------------------------------------- render

  function matrix() {
    return buildMatrix(keys, values);
  }

  function coverage() {
    return LANGS.map((lang) => {
      const filled = keys.filter((key) => (values[lang.code][key] || '').trim()).length;
      return { ...lang, filled, total: keys.length };
    });
  }

  function rowMatches(entry, search) {
    const texts = LANGS.map((lang) => entry.values[lang.code]);
    if (search && !texts.some((text) => text.toLowerCase().includes(search))) return false;
    const missing = EDITABLE.some((code) => !(entry.values[code] || '').trim());
    if (filter === 'missing') return missing;
    if (filter === 'complete') return !missing;
    return true;
  }

  function renderToolbar() {
    const chips = coverage().map((lang) => `<span class="status-badge ${lang.filled ? 'status-info' : 'status-neutral'}" title="${escapeHTML(lang.label)}">
        ${escapeHTML(lang.short)} ${lang.filled}/${lang.total}</span>`).join('');
    root.querySelector('[data-lang-chips]').innerHTML = chips;
  }

  function renderGrid() {
    const entries = matrix();
    const search = query.trim().toLowerCase();
    const filtered = entries.filter((entry) => rowMatches(entry, search));
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(1, page), pages);
    page = safePage;
    const slice = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    const cells = (entry) => LANGS.map((lang) => {
      if (lang.source) {
        return `<td data-label="${escapeHTML(lang.short)}" class="lang-source"><span dir="auto">${escapeHTML(entry.values[lang.code])}</span>
          ${entry.known ? '' : '<span class="status-badge status-warning" title="Not in the Bengali list the app uses">extra</span>'}</td>`;
      }
      const value = entry.values[lang.code];
      const filled = !!(value || '').trim();
      return `<td data-label="${escapeHTML(lang.short)}">
        <input class="form-input lang-cell ${filled ? '' : 'is-empty'}" data-entry data-lang="${lang.code}" data-key="${escapeHTML(entry.key)}"
          dir="auto" spellcheck="false" placeholder="—" value="${escapeHTML(value)}"></td>`;
    }).join('');

    const body = slice.map((entry, index) => `<tr data-entry-row data-row="${(safePage - 1) * PAGE_SIZE + index + 1}"
        data-search-text="${escapeHTML(LANGS.map((lang) => entry.values[lang.code]).join(' \\u0000 '))}"
        data-missing="${EDITABLE.some((code) => !(entry.values[code] || '').trim()) ? 'true' : 'false'}">
        <td data-label="#" class="lang-index">${(safePage - 1) * PAGE_SIZE + index + 1}</td>
        ${cells(entry)}
      </tr>`).join('');

    const row = (lang) => `<th${lang.source ? ' class="lang-source-head"' : ''}>${escapeHTML(lang.short)}<small>${escapeHTML(lang.label)}</small></th>`;
    root.querySelector('[data-grid-panel]').innerHTML = `
      <div class="list-toolbar">
        <label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search strings</span><input type="search" placeholder="Search Bengali or a translation…" data-entry-search value="${escapeHTML(query)}"></label>
        <div class="button-row">
          ${[['all', 'All'], ['missing', 'Missing'], ['complete', 'Complete']].map(([id, label]) =>
            `<button type="button" class="btn ${filter === id ? 'btn-primary' : 'btn-secondary'}" data-filter="${id}">${label}</button>`).join('')}
        </div>
      </div>
      ${body ? NC.components.tableShell({
        caption: 'Interface strings and their translations',
        minWidth: '820px',
        head: `<tr><th style="width:64px">#</th>${LANGS.map(row).join('')}</tr>`,
        body
      }) : NC.components.emptyState({ icon: 'fa-inbox', title: 'Nothing matches', description: 'Clear the search or switch the filter to see the other rows.' })}
      <div class="list-toolbar">
        <p class="text-muted-foreground toolbar-note" data-entry-summary>Showing <span data-entry-shown>${slice.length}</span> of ${keys.length} strings<span data-entry-filtered>${search || filter !== 'all' ? ' · filtered' : ''}</span>${EDITABLE.map((code) => {
          const filled = keys.filter((key) => (values[code][key] || '').trim()).length;
          return ` · ${code} ${filled}/${keys.length}`;
        }).join('')}</p>
        <div class="button-row">
          <button type="button" class="btn btn-secondary" data-page="prev" ${safePage <= 1 ? 'disabled' : ''}><i class="fa-regular fa-chevron-left" aria-hidden="true"></i>Previous</button>
          <span class="status-badge status-neutral">Page ${safePage} / ${pages}</span>
          <button type="button" class="btn btn-secondary" data-page="next" ${safePage >= pages ? 'disabled' : ''}>Next<i class="fa-regular fa-chevron-right" aria-hidden="true"></i></button>
        </div>
      </div>`;

    bindGrid();
  }

  /** Hide/show the rows already on screen, so typing in the search box keeps focus. */
  function applyRowFilter() {
    const search = query.trim().toLowerCase();
    let shown = 0;
    root.querySelectorAll('[data-entry-row]').forEach((row) => {
      const matches = (!search || (row.dataset.searchText || '').toLowerCase().includes(search))
        && (filter === 'all'
          || (filter === 'missing' ? row.dataset.missing === 'true' : row.dataset.missing !== 'true'));
      row.hidden = !matches;
      if (matches) shown += 1;
    });
    const counter = root.querySelector('[data-entry-shown]');
    if (counter) counter.textContent = String(shown);
    const filteredTag = root.querySelector('[data-entry-filtered]');
    if (filteredTag) filteredTag.textContent = (search || filter !== 'all') ? ' · filtered' : '';
  }

  function refreshCounters() {
    renderToolbar();
    const summary = root.querySelector('[data-entry-summary]');
    if (!summary) return;
    const parts = EDITABLE.map((code) => {
      const filled = keys.filter((key) => (values[code][key] || '').trim()).length;
      return `${code} ${filled}/${keys.length}`;
    }).join(' · ');
    summary.innerHTML = `Showing <span data-entry-shown>${root.querySelectorAll('[data-entry-row]:not([hidden])').length}</span>`
      + ` of ${keys.length} strings<span data-entry-filtered>${query.trim() || filter !== 'all' ? ' · filtered' : ''}</span> · ${parts}`;
  }

  function bindGrid() {
    const search = root.querySelector('[data-entry-search]');
    if (search) {
      search.addEventListener('input', () => { query = search.value; page = 1; applyRowFilter(); });
    }
    root.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
      filter = button.dataset.filter;
      page = 1;
      root.querySelectorAll('[data-filter]').forEach((other) =>
        other.classList.toggle('btn-primary', other === button));
      root.querySelectorAll('[data-filter]').forEach((other) =>
        other.classList.toggle('btn-secondary', other !== button));
      applyRowFilter();
    }));
    root.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => {
      page += button.dataset.page === 'next' ? 1 : -1;
      renderGrid();
    }));
    root.querySelectorAll('[data-entry]').forEach((input) => {
      input.addEventListener('input', () => {
        const code = input.dataset.lang;
        const key = input.dataset.key;
        if (!values[code]) values[code] = {};
        values[code][key] = input.value;
        input.classList.toggle('is-empty', !input.value.trim());
        input.closest('[data-entry-row]').dataset.missing = EDITABLE.some((other) => !(values[other][key] || '').trim()) ? 'true' : 'false';
        // Metrics only: the grid itself is not redrawn, so the caret stays put.
        refreshCounters();
      });
    });
  }

  // ---------------------------------------------------------------- write

  /** One language's file, in grid order, blanks dropped (the app treats them as untranslated). */
  function csvFor(code) {
    return writeCSV(keys
      .filter((key) => (values[code][key] || '').trim())
      .map((key) => [key, values[code][key].trim()]));
  }

  async function saveAll(button) {
    NC.utils.setButtonLoading(button, true, 'Saving…');
    try {
      const saved = [];
      for (const code of EDITABLE) {
        const lang = LANGS.find((entry) => entry.code === code);
        const csv = csvFor(code);
        const count = parsePairs(csv).length;
        await NC.api.upsert('languageFiles', {
          lang: code,
          label: lang.label,
          csv,
          row_count: count
        }, 'lang');
        saved.push(`${code} ${count}`);
      }
      LANGS.forEach((lang) => { if (rows[lang.code]) rows[lang.code].updated_at = new Date().toISOString(); });
      NC.components.toast(`Saved — ${saved.join(', ')} strings. The app picks it up on the next language change or refresh.`, 'success');
    } catch (error) {
      console.error(error);
      NC.components.toast(NC.api.userMessage(error, 'The translations could not be saved.'), 'error');
    } finally {
      NC.utils.setButtonLoading(button, false);
    }
  }

  function download(button) {
    const blob = new Blob([matrixCsv(matrix())], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ningshingche-translations.csv';
    link.click();
    URL.revokeObjectURL(url);
    NC.components.toast('Downloaded. Fill it in a spreadsheet, then use Import to bring it back.', 'info');
    button?.blur?.();
  }

  function openImport() {
    NC.components.openModal({
      title: 'Import translations',
      eyebrow: 'From a spreadsheet',
      description: 'Paste the sheet — a header row with bpy, bn and en, one column per language — or paste a single language\'s key,value file.',
      content: `<div class="field">
          <label class="field-label" for="import-csv">CSV</label>
          <textarea class="form-textarea" id="import-csv" rows="12" spellcheck="false" placeholder="#,bpy,bn,en&#10;1,আরাক ওয়াহিদ…,অন্য শব্দে চেষ্টা করুন,Try another word"></textarea>
          <p class="field-hint">The bn column is the key the app looks up, so it is not changed by an import; it only tells the page which string a row belongs to.</p>
        </div>`,
      footer: '<button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>'
        + '<button type="button" class="btn btn-primary" data-apply-import><i class="fa-regular fa-file-import" aria-hidden="true"></i>Import</button>',
      onOpen: (modalRoot) => {
        modalRoot.querySelector('[data-apply-import]').addEventListener('click', () => {
          const text = modalRoot.querySelector('#import-csv').value;
          const parsed = parseMatrix(text);
          if (!parsed || !parsed.keys.length) {
            NC.components.toast('That does not look like a translation sheet: no bpy/bn/en header with rows under it.', 'warning');
            return;
          }
          const byLoose = new Map();
          keys.forEach((knownKey) => { if (!byLoose.has(looseKey(knownKey))) byLoose.set(looseKey(knownKey), knownKey); });
          let changed = 0;
          let renamed = 0;
          parsed.keys.forEach((typedKey) => {
            // A key a person typed may differ from the app's string only by
            // punctuation; land it on the real key instead of stranding it.
            const key = byLoose.get(looseKey(typedKey)) || typedKey;
            if (key !== typedKey) renamed += 1;
            if (!keys.includes(key)) { keys.push(key); }
            if (parsed.values[SOURCE]?.[typedKey] && !values[SOURCE][key]) values[SOURCE][key] = key;
            EDITABLE.forEach((code) => {
              const value = parsed.values[code]?.[typedKey];
              if (value === undefined) return;
              if (!values[code]) values[code] = {};
              values[code][key] = value;
              changed += 1;
            });
          });
          NC.components.closeModal();
          page = 1;
          renderToolbar();
          renderGrid();
          const note = renamed ? `, ${renamed} matched a Bengali key after ignoring punctuation` : '';
          NC.components.toast(`Imported ${parsed.keys.length} rows (${changed} cells)${note}. Press Save translations to publish.`, 'success');
        });
      }
    });
  }

  function render(container) {
    root = container;
    root.innerHTML = `${NC.components.pageHeader({
      eyebrow: 'System',
      title: 'Language files',
      description: 'One row per string, one column per language. Bengali is the source text the app looks strings up by; Bishnupriya Manipuri and English are what it downloads for the language the reader picks.',
      breadcrumb: [{ label: 'Languages' }],
      actions: '<button type="button" class="btn btn-secondary" data-reload><i class="fa-regular fa-rotate" aria-hidden="true"></i>Reload</button>'
        + '<button type="button" class="btn btn-secondary" data-import><i class="fa-regular fa-file-import" aria-hidden="true"></i>Import</button>'
        + '<button type="button" class="btn btn-secondary" data-download><i class="fa-regular fa-download" aria-hidden="true"></i>Download</button>'
        + '<button type="button" class="btn btn-primary" data-save-all><i class="fa-regular fa-floppy-disk" aria-hidden="true"></i>Save translations</button>'
    })}<section class="surface">
      <div class="list-toolbar">
        <p class="text-muted-foreground toolbar-note" data-lang-chips></p>
        <p class="text-muted-foreground toolbar-note">A blank cell keeps the app's Bengali text.</p>
      </div>
      <div data-grid-panel>${NC.components.skeleton(7, 4)}</div>
    </section>`;
    root.querySelector('[data-save-all]').addEventListener('click', (event) => saveAll(event.currentTarget));
    root.querySelector('[data-download]').addEventListener('click', (event) => download(event.currentTarget));
    root.querySelector('[data-import]').addEventListener('click', () => openImport());
    root.querySelector('[data-reload]').addEventListener('click', () => load());
    return load();
  }

  NC.views.languages = { render };

  // Exposed for the dashboard's own tests and for reuse by the importer.
  NC.languageFiles = Object.freeze({
    parseCSV, writeCSV, parsePairs, summarise, buildMatrix, matrixCsv, parseMatrix
  });
})(window.NC);
