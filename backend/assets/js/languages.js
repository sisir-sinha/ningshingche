(function (NC) {
  'use strict';

  /**
   * Interface language files, edited as one grid: a row per string, a column per
   * language (bpy · bn · en) — the same shape as the spreadsheet the owner fills
   * in, so the page and the sheet can be handed back and forth.
   *
   * Every column is editable, Bengali included:
   *   bn   the wording a Bengali reader sees. It starts as the app's own string
   *        and can be rewritten here — a typo, a word the community prefers.
   *   bpy  Bishnupriya Manipuri translation
   *   en   English translation
   *
   * Bengali is also the *key*: the app looks a string up by the text compiled
   * into it (`t("লেখক")`). So each row keeps two things that can differ — the
   * app's own string (the key, shown under the cell once you change it) and the
   * wording you type. Storage is unchanged: one `key,value` CSV per language in
   * `public.app_language_files`, where the key is always the app's own string and
   * the value is what you typed. Nothing has to be migrated.
   *
   * An empty cell is not an empty string in the app: it means "leave this as it
   * was" — the app shows its own Bengali text for that key, which is the same
   * thing for a row nobody has edited.
   */

  const { escapeHTML } = NC.utils;

  /** Columns, in the order the owner's sheet shows them. */
  const LANGS = Object.freeze([
    { code: 'bpy', label: 'বিষ্ণুপ্রিয়া মণিপুরী', short: 'bpy' },
    { code: 'bn', label: 'বাংলা', short: 'bn', source: true },
    { code: 'en', label: 'English', short: 'en' }
  ]);
  const SOURCE = 'bn';
  const EDITABLE = LANGS.map((lang) => lang.code);            // every cell
  const TRANSLATIONS = LANGS.filter((lang) => !lang.source).map((lang) => lang.code);
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
    const rows = pairs.map(([key, value]) => `${csvCell(key)},${csvCell(value)}`);
    return `key,value\n${rows.length ? `${rows.join('\n')}\n` : ''}`;
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
   * The grid as the owner's sheet: `#,bpy,bn,en`, one row per string — the shape
   * the page shows and the owner fills in by hand. One extra column, `key`, is
   * appended for round trips and left empty while the Bengali is untouched, so a
   * sheet that has not been edited still reads as four columns.
   */
  function matrixCsv(matrix) {
    const header = ['#', ...LANGS.map((lang) => lang.short), 'key'].join(',');
    const lines = matrix.map((entry, index) => {
      const bengali = (entry.values[SOURCE] || '').trim();
      const key = bengali && bengali !== entry.key ? entry.key : '';
      return [String(index + 1), ...LANGS.map((lang) => csvCell(entry.values[lang.code])), csvCell(key)].join(',');
    });
    return `${header}\n${lines.join('\n')}\n`;
  }

  /**
   * Reads a matrix file back in. Columns are matched by header name in any order
   * and `#` and unknown columns are ignored. The row's identity is the app's own
   * string: from the `key` column when the sheet has one (Download writes it once
   * the Bengali has been edited), otherwise from the Bengali cell, which is the
   * key itself on a sheet nobody has edited. A plain `key,value` file is accepted
   * too, when its second column names bpy, bn or en.
   */
  function parseMatrix(text) {
    const records = parseCSV(text);
    if (!records.length) return null;
    const header = records[0].map((cell) => cell.trim().toLowerCase());
    const shortCodes = LANGS.map((lang) => lang.short);
    const keyAt = header.indexOf('key');
    const bengaliAt = header.indexOf(SOURCE);
    let keyColumn = keyAt > -1 ? keyAt : bengaliAt;
    let languageColumns = {};
    shortCodes.forEach((code) => {
      const at = header.indexOf(code);
      if (at > -1) languageColumns[code] = at;
    });
    if (keyColumn === -1 && header[0] === 'key') {
      // `key,value` from a single language file.
      const language = header[1] && shortCodes.includes(header[1]) ? header[1] : null;
      if (language) { keyColumn = 0; languageColumns = { [language]: 1 }; }
    }
    if (keyColumn === -1 || !Object.keys(languageColumns).length) return null;
    const order = [];
    const out = {};
    LANGS.forEach((lang) => { out[lang.code] = {}; });
    records.slice(1).forEach((cells) => {
      const cellAt = (at) => (at === undefined ? '' : String(cells[at] ?? '').trim());
      const bengali = cellAt(bengaliAt);
      // The app's own string, when the sheet carries it; else the Bengali cell.
      const key = cellAt(keyAt) || bengali;
      if (!key) return;
      if (!order.includes(key)) order.push(key);
      LANGS.forEach((lang) => {
        const at = languageColumns[lang.code];
        // One cell, not the rest of the row: columns are positional here.
        if (at !== undefined) out[lang.code][key] = cellAt(at);
      });
      // Bengali defaults to the app's own string: an untouched sheet says nothing
      // about it, and that is exactly what the app shows then.
      if (!out[SOURCE][key]) out[SOURCE][key] = bengali || key;
    });
    return { keys: order, values: out };
  }

  // ---------------------------------------------------------------- load

  async function loadTemplate(lang) {
    const response = await fetch(`${TEMPLATE_BASE}/${lang}.csv`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.text();
  }

  /**
   * The key list, always from the Bengali template committed with the app.
   *
   * It used to be read from the stored Bengali file, which no longer works: that
   * file now holds only the rows somebody rewrote, so taking the list from it
   * would shrink the grid to those few. If the template cannot be fetched, the
   * keys already loaded from the stored files are used instead.
   */
  async function keyListFrom() {
    try {
      const fromTemplate = parsePairs(await loadTemplate(SOURCE)).map(([key]) => key).filter(Boolean);
      if (fromTemplate.length) return fromTemplate;
    } catch (error) {
      console.error(error);
    }
    const fallback = [];
    LANGS.forEach((lang) => Object.keys(values[lang.code] || {}).forEach((key) => {
      if (!fallback.includes(key)) fallback.push(key);
    }));
    return fallback;
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

      // Stored files first, then the committed key list on top: the Bengali
      // column shows the app's own string unless a row has been rewritten.
      values = {};
      LANGS.forEach((lang) => {
        values[lang.code] = {};
        parsePairs(rows[lang.code].csv || '').forEach(([key, value]) => {
          values[lang.code][key] = value;
        });
      });
      const keyList = await keyListFrom();
      known = new Set(keyList);
      keyList.forEach((key) => {
        if (!(values[SOURCE][key] || '').trim()) values[SOURCE][key] = key;
      });

      // Keys a translator added by hand are kept, after the known list, so a save
      // does not silently drop them.
      const extraKeys = [];
      LANGS.forEach((lang) => {
        Object.keys(values[lang.code]).forEach((key) => {
          if (!known.has(key) && !extraKeys.includes(key)) extraKeys.push(key);
        });
      });
      // A key typed by hand has no compiled string behind it, so it is its own
      // Bengali wording.
      extraKeys.forEach((key) => { if (!(values[SOURCE][key] || '').trim()) values[SOURCE][key] = key; });
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

  /** Per-column progress: translations filled, or Bengali rows rewritten. */
  function coverage() {
    return LANGS.map((lang) => {
      const filled = keys.filter((key) => {
        const value = (values[lang.code][key] || '').trim();
        return lang.source ? value && value !== key : value;
      }).length;
      return { ...lang, filled, total: keys.length };
    });
  }

  function rowMatches(entry, search) {
    const texts = LANGS.map((lang) => entry.values[lang.code]);
    if (search && !texts.some((text) => text.toLowerCase().includes(search))) return false;
    // Missing means "no translation yet", so Bengali — which always has the
    // app's own wording behind it — is never the reason a row is listed.
    const missing = TRANSLATIONS.some((code) => !(entry.values[code] || '').trim());
    if (filter === 'missing') return missing;
    if (filter === 'complete') return !missing;
    return true;
  }

  function renderToolbar() {
    const chips = coverage().map((lang) => `<span class="status-badge ${lang.filled ? 'status-info' : 'status-neutral'}" title="${escapeHTML(lang.label)}">
        ${escapeHTML(lang.short)} ${lang.source ? `${lang.filled} edited` : `${lang.filled}/${lang.total}`}</span>`).join('');
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
      const value = entry.values[lang.code];
      const filled = !!(value || '').trim();
      // Bengali is the key as well as the wording: once it is rewritten the
      // app's own string is shown underneath, so the row still says what it maps to.
      const rewritten = lang.source && filled && value.trim() !== entry.key;
      return `<td data-label="${escapeHTML(lang.short)}"${lang.source ? ' class="lang-source"' : ''}>
        <input class="form-input lang-cell ${filled ? '' : 'is-empty'}" data-entry data-lang="${lang.code}" data-key="${escapeHTML(entry.key)}"
          dir="auto" spellcheck="false" placeholder="—" value="${escapeHTML(value)}">
        ${lang.source ? `<small class="lang-key-hint" data-key-hint>${rewritten ? `মূল: ${escapeHTML(entry.key)}` : ''}</small>` : ''}
        ${lang.source && !entry.known ? '<span class="status-badge status-warning" title="Not in the Bengali list the app uses">extra</span>' : ''}</td>`;
    }).join('');

    const body = slice.map((entry, index) => `<tr data-entry-row data-row="${(safePage - 1) * PAGE_SIZE + index + 1}"
        data-search-text="${escapeHTML(LANGS.map((lang) => entry.values[lang.code]).join(' \\u0000 '))}"
        data-missing="${TRANSLATIONS.some((code) => !(entry.values[code] || '').trim()) ? 'true' : 'false'}">
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
        <p class="text-muted-foreground toolbar-note" data-entry-summary>Showing <span data-entry-shown>${slice.length}</span> of ${keys.length} strings<span data-entry-filtered>${search || filter !== 'all' ? ' · filtered' : ''}</span>${coverage().map((lang) => ` · ${escapeHTML(lang.short)} ${lang.source ? `${lang.filled} edited` : `${lang.filled}/${lang.total}`}`).join('')}</p>
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
    const parts = coverage().map((lang) => {
      const count = `${escapeHTML(lang.short)} ${lang.source ? `${lang.filled} edited` : `${lang.filled}/${lang.total}`}`;
      return count;
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
        const hint = input.closest('td')?.querySelector('[data-key-hint]');
        if (hint) hint.textContent = input.value.trim() && input.value.trim() !== key ? `মূল: ${key}` : '';
        input.closest('[data-entry-row]').dataset.missing = TRANSLATIONS.some((other) => !(values[other][key] || '').trim()) ? 'true' : 'false';
        // Metrics only: the grid itself is not redrawn, so the caret stays put.
        refreshCounters();
      });
    });
  }

  // ---------------------------------------------------------------- write

  /**
   * One language's file, in grid order. Blanks are dropped — the app treats them
   * as untranslated — and for Bengali a row that still reads exactly like the
   * app's own string is dropped too: it would only restate the key, and leaving
   * it out keeps the file to the rows somebody actually rewrote.
   */
  function csvFor(code) {
    return writeCSV(keys
      .filter((key) => (values[code][key] || '').trim())
      .filter((key) => code !== SOURCE || (values[code][key] || '').trim() !== key)
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
      description: 'Paste the sheet — a header row with bpy, bn and en, one column per language — or a single language\'s key,value file. The optional key column Download writes is used when present, so a sheet with rewritten Bengali still lands on the right rows.',
      content: `<div class="field">
          <label class="field-label" for="import-csv">CSV</label>
          <textarea class="form-textarea" id="import-csv" rows="12" spellcheck="false" placeholder="#,bpy,bn,en&#10;1,আরাক ওয়াহিদ…,অন্য শব্দে চেষ্টা করুন,Try another word"></textarea>
          <p class="field-hint">Rows are matched to the app's own strings by the key column when the sheet has one, and by the Bengali column otherwise. Bengali is editable: type the wording a Bengali reader should see.</p>
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
            EDITABLE.forEach((code) => {
              const value = parsed.values[code]?.[typedKey];
              if (value === undefined) return;
              if (!values[code]) values[code] = {};
              // A Bengali cell that only repeats the row's own label — a sheet
              // typed by hand, or one missing the trailing `।` — is not a
              // rewrite, so the app's own string is kept exactly as compiled.
              values[code][key] = code === SOURCE && value && looseKey(value) === looseKey(typedKey)
                ? key
                : value;
              changed += 1;
            });
            // Bengali always has wording: the imported cell, or the app's own.
            if (!(values[SOURCE][key] || '').trim()) values[SOURCE][key] = key;
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
      description: 'One row per string, one column per language — the sheet. Bengali, Bishnupriya Manipuri and English are all editable; Bengali is also the string the app looks each row up by, so its original text stays under the cell after you rewrite it.',
      breadcrumb: [{ label: 'Languages' }],
      actions: '<button type="button" class="btn btn-secondary" data-reload><i class="fa-regular fa-rotate" aria-hidden="true"></i>Reload</button>'
        + '<button type="button" class="btn btn-secondary" data-import><i class="fa-regular fa-file-import" aria-hidden="true"></i>Import</button>'
        + '<button type="button" class="btn btn-secondary" data-download><i class="fa-regular fa-download" aria-hidden="true"></i>Download</button>'
        + '<button type="button" class="btn btn-primary" data-save-all><i class="fa-regular fa-floppy-disk" aria-hidden="true"></i>Save translations</button>'
    })}<section class="surface">
      <div class="list-toolbar">
        <p class="text-muted-foreground toolbar-note" data-lang-chips></p>
        <p class="text-muted-foreground toolbar-note">A blank cell keeps the app's Bengali text. Editing Bengali changes the wording a Bengali reader sees, never the lookup.</p>
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
