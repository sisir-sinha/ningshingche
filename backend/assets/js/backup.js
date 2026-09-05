(function (NC) {
  'use strict';

  const { escapeHTML, number, bytes, formatDateTime } = NC.utils;
  const FORMAT = 'ningshing-che-dashboard-backup';
  const VERSION = 1;
  const PAGE_SIZE = 500;
  const MAX_BYTES = 50 * 1024 * 1024;
  // Explicit allowlist: never enumerate configuration, auth tables or browser storage.
  const sections = Object.freeze([
    { key: 'authors', table: 'authors', label: 'Authors', icon: 'fa-user-pen' },
    { key: 'categories', table: 'categories', label: 'Categories', icon: 'fa-layer-group' },
    { key: 'blogs', table: 'blogs', label: 'Blogs', icon: 'fa-newspaper' },
    { key: 'comments', table: 'comments', label: 'Comments', icon: 'fa-comments' },
    { key: 'galleries', table: 'galleries', label: 'Galleries', icon: 'fa-images' },
    { key: 'books', table: 'pdf_books', label: 'PDF books', icon: 'fa-books' },
    { key: 'submissions', table: 'submitted_blogs', label: 'Submitted blogs', icon: 'fa-file-pen' },
    { key: 'videos', table: 'videos', label: 'Videos', icon: 'fa-video' },
    { key: 'settings', table: 'settings', label: 'Site settings', icon: 'fa-sliders' }
  ].map(Object.freeze));

  function availableSections() {
    return sections.filter((section) => NC.auth.canAccess(section.key));
  }

  function checkAccess(keys, token, signal) {
    if (signal?.aborted) throw new DOMException('Backup cancelled.', 'AbortError');
    if (NC.auth.isLegacy()) {
      throw new Error('Backups require secure login. Install migration 004 and sign in again.');
    }
    if (!token || token !== NC.auth.getSessionToken() || !NC.auth.canAccess('settings')
        || keys.some((key) => !NC.auth.canAccess(key))) {
      throw new Error('Your session or permissions changed. Sign in again and retry the backup.');
    }
  }

  async function checkServerAccess(key, signal) {
    // This existing stable RPC only reads permissions; it does not update session metadata.
    // A stale/revoked session can otherwise silently read only public rows through RLS.
    let allowed;
    try {
      allowed = await NC.api.rpc('dashboard_has_permission', { p_permission: key }, { signal });
    } catch (error) {
      if (error.isRpcMissing) {
        throw new Error('Backups require migration 004. Install dashboard access control and sign in again.');
      }
      throw error;
    }
    if (allowed !== true) {
      throw new Error('Supabase could not confirm your backup permissions. Sign in again; no backup was created.');
    }
  }

  async function collect(keys, { signal, onProgress } = {}) {
    if (!Array.isArray(keys) || !keys.length) throw new Error('Choose at least one section to back up.');
    if (keys.some((key) => !sections.some((section) => section.key === key))) {
      throw new Error('This section is not supported by dashboard backups.');
    }
    const selected = sections.filter((section) => keys.includes(section.key));
    const token = NC.auth.getSessionToken();
    const startedAt = new Date().toISOString();
    const tables = {}, counts = {};
    const encoder = new TextEncoder();
    let totalRecords = 0, serializedBytes = 0;
    checkAccess(keys, token, signal);
    await checkServerAccess('settings', signal);

    for (const [index, section] of selected.entries()) {
      const rows = [], seen = new Set();
      let expected = null;
      do {
        checkAccess(keys, token, signal);
        onProgress?.({ section: section.label, completed: index, sections: selected.length,
          records: rows.length, expected, totalRecords });
        const page = await NC.api.list(section.key, {
          select: '*', order: 'id.asc', limit: PAGE_SIZE, offset: rows.length, count: true, signal
        });
        checkAccess(keys, token, signal);
        if (!page.hasExactCount || !Number.isSafeInteger(page.count) || page.count < 0) {
          throw new Error('Supabase did not return an exact record count. No partial backup was created.');
        }
        if (expected !== null && expected !== page.count) {
          throw new Error(`${section.label} changed during the backup. Pause editing and try again.`);
        }
        expected = page.count;
        if ((page.data.length === 0 && rows.length < expected) || rows.length + page.data.length > expected) {
          throw new Error(`${section.label} returned an incomplete page. No partial backup was created; please retry.`);
        }
        for (const row of page.data) {
          if (!row || typeof row.id !== 'string' || !row.id || seen.has(row.id)) {
            throw new Error(`${section.label} returned missing or duplicate IDs. No partial backup was created.`);
          }
          seen.add(row.id);
          rows.push(row);
        }
        serializedBytes += encoder.encode(JSON.stringify(page.data)).byteLength;
        if (serializedBytes > MAX_BYTES) {
          throw new Error('This backup exceeds the 50 MB browser limit. Select fewer sections or use a managed database backup.');
        }
        onProgress?.({ section: section.label, completed: index, sections: selected.length,
          records: rows.length, expected, totalRecords: totalRecords + rows.length });
        // Do not stop at a short page: Supabase may cap results below PAGE_SIZE.
      } while (rows.length < expected);
      await checkServerAccess(section.key, signal);
      checkAccess(keys, token, signal);
      tables[section.table] = rows;
      counts[section.table] = rows.length;
      totalRecords += rows.length;
    }
    await checkServerAccess('settings', signal);
    checkAccess(keys, token, signal);

    return {
      format: FORMAT,
      version: VERSION,
      application: NC_CONFIG.app.name,
      application_version: NC_CONFIG.app.version,
      started_at: startedAt,
      created_at: new Date().toISOString(),
      source: { supabase_url: NC_CONFIG.supabase.url, website_url: NC_CONFIG.app.websiteUrl },
      manifest: {
        scope: selected.length === sections.length ? 'all-content' : 'selected-content',
        table_counts: counts,
        total_records: totalRecords,
        omitted_tables: sections.filter((section) => !keys.includes(section.key)).map((section) => section.table),
        media: 'references-only',
        excluded: ['Uploaded image, PDF and video files', 'Database schema, functions and RLS policies',
          'Dashboard users, roles, passwords and sessions', 'API keys and browser preferences'],
        consistency: 'Paginated live export, not a transactional snapshot. Pause editing while exporting.'
      },
      tables
    };
  }

  function markup() {
    const available = availableSections();
    const secure = !NC.auth.isLegacy() && Boolean(NC.auth.getSessionToken());
    return `<section class="surface settings-section" id="settings-backup" aria-labelledby="backup-title">
      <div class="surface-header"><div><p class="eyebrow">Data protection</p><h2 id="backup-title">Backup</h2><p>Keep an offline copy of your editorial content and saved site settings.</p></div><span class="backup-format">JSON · v${VERSION}</span></div>
      <div class="backup-intro"><span class="backup-mark"><i class="fa-regular fa-box-archive" aria-hidden="true"></i></span><div><strong>Your content. Your copy.</strong><p>Create a dated, portable data export without changing anything in your database.</p></div></div>
      ${!secure ? NC.components.notice('Secure login is required for complete backups. Install migration 004 and sign in again; compatibility login can only see some public records.', 'warning', 'fa-lock') : ''}
      <fieldset class="backup-options" data-backup-options ${!secure ? 'disabled' : ''}>
        <legend class="field-label">What would you like to back up?</legend>
        <div class="backup-scopes">
          <label class="backup-scope"><input type="radio" name="backup_scope" value="all" checked><span><strong>All accessible data</strong><small>Recommended · keep related content together</small></span></label>
          <label class="backup-scope"><input type="radio" name="backup_scope" value="selected"><span><strong>Selected sections</strong><small>Choose the content you need</small></span></label>
        </div>
        <div class="backup-selection-heading"><p data-backup-selection-summary>${available.length} of ${sections.length} sections selected</p><div class="backup-selection-tools hidden" data-backup-selection-tools><button type="button" class="field-action" data-backup-select-all>Select all</button><button type="button" class="field-action" data-backup-clear>Clear</button></div></div>
        <div class="backup-section-grid">${sections.map((section) => {
          const allowed = available.includes(section);
          return `<label class="backup-section-option ${!allowed ? 'is-restricted' : ''}"><input type="checkbox" value="${section.key}" data-backup-section ${allowed ? 'checked' : ''} disabled><i class="fa-regular ${section.icon}" aria-hidden="true"></i><span>${section.label}${!allowed ? '<small>Not in your role</small>' : ''}</span>${!allowed ? '<i class="fa-regular fa-lock" aria-hidden="true"></i>' : ''}</label>`;
        }).join('')}</div>
      </fieldset>
      <details class="backup-details"><summary>What is included in this backup?</summary><dl><dt>Included</dt><dd>Every readable record in your selected sections, including IDs, relationships, drafts, timestamps, and media URLs/metadata. Site settings must be saved first.</dd><dt>Not included</dt><dd>Actual images, PDFs or videos; database schema and policies; user accounts, roles, passwords, API keys, sessions, or browser preferences.</dd><dt>Good to know</dt><dd>This is a manual data export, not a full disaster-recovery snapshot. Pause editing while it runs. Keep separate backups of hosted files and the database. Restore and automatic scheduling are not included.</dd></dl></details>
      <p class="backup-privacy"><i class="fa-regular fa-shield-exclamation" aria-hidden="true"></i><span>JSON backups are <strong>not encrypted</strong> and may include private drafts, reader contact details, and media-deletion links. Store them somewhere safe.</span></p>
      <div class="backup-actions"><button type="button" class="btn btn-primary" data-backup-create ${!secure || !available.length ? 'disabled' : ''}><i class="fa-regular fa-box-archive" aria-hidden="true"></i>Create backup</button><button type="button" class="btn btn-secondary hidden" data-backup-cancel>Cancel</button><span>UTF-8 JSON · up to 50 MB</span></div>
      <div class="backup-progress hidden" data-backup-progress role="status" aria-live="polite"><p data-backup-progress-text></p><progress max="100" value="0" aria-label="Backup progress"></progress></div>
      <p class="backup-message hidden" data-backup-message role="status"></p>
      <p class="backup-error hidden" data-backup-error role="alert"></p>
      <div class="backup-result hidden" data-backup-result><div class="backup-result-heading"><span class="backup-result-icon"><i class="fa-regular fa-circle-check" aria-hidden="true"></i></span><div><h3>Ready to download</h3><p data-backup-file></p></div></div><p class="backup-result-summary" data-backup-result-summary></p><ul class="backup-counts" data-backup-counts></ul><button type="button" class="btn btn-secondary" data-backup-download><i class="fa-regular fa-download" aria-hidden="true"></i>Download JSON</button><small>Your browser chooses where to save the file.</small></div>
      <div class="backup-history"><h3>Recent downloads</h3><p>Only download metadata is remembered in this browser, for your account. Backup files are not stored online.</p><div data-backup-history></div></div>
    </section>`;
  }

  function mount(root) {
    let controller = null, ready = null, active = true;
    const options = root.querySelector('[data-backup-options]');
    const createButton = root.querySelector('[data-backup-create]');
    const cancelButton = root.querySelector('[data-backup-cancel]');
    const progress = root.querySelector('[data-backup-progress]');
    const result = root.querySelector('[data-backup-result]');
    const errorOutput = root.querySelector('[data-backup-error]');
    const message = root.querySelector('[data-backup-message]');
    const sessionToken = NC.auth.getSessionToken();
    const user = NC.state.session?.user;
    const historyKey = `backup-downloads:${NC_CONFIG.supabase.url}:${user?.id || user?.username || 'unknown'}`;
    const isUsable = () => !NC.auth.isLegacy() && Boolean(sessionToken)
      && sessionToken === NC.auth.getSessionToken() && NC.auth.canAccess('settings');
    const selection = () => root.querySelector('[name="backup_scope"]:checked')?.value === 'all'
      ? availableSections().map((section) => section.key)
      : Array.from(root.querySelectorAll('[data-backup-section]:checked')).map((input) => input.value);

    function history() {
      const saved = NC.utils.readPreference(historyKey, []);
      return Array.isArray(saved) ? saved.filter((item) => item && typeof item.filename === 'string'
        && Number.isFinite(item.records) && Number.isFinite(item.bytes)).slice(0, 5)
        .map(({ filename, records, bytes, requested_at }) => ({ filename, records, bytes, requested_at })) : [];
    }

    function renderHistory() {
      const items = history();
      root.querySelector('[data-backup-history]').innerHTML = items.length
        ? `<ul class="backup-history-list">${items.map((item) => `<li><i class="fa-regular fa-file-code" aria-hidden="true"></i><div><strong>${escapeHTML(item.filename)}</strong><small>${escapeHTML(formatDateTime(item.requested_at))} · ${number(item.records)} records · ${bytes(item.bytes)}</small></div><span>Requested</span></li>`).join('')}</ul>`
        : '<p class="backup-history-empty">No backup downloads requested in this browser yet.</p>';
    }

    function clearReady() {
      if (ready) URL.revokeObjectURL(ready.url);
      ready = null;
      result.classList.add('hidden');
    }

    function refreshSelection() {
      const all = root.querySelector('[name="backup_scope"]:checked')?.value === 'all';
      root.querySelectorAll('[data-backup-section]').forEach((input) => {
        const allowed = NC.auth.canAccess(input.value);
        if (all) input.checked = allowed;
        if (!allowed) input.checked = false;
        input.disabled = all || !allowed;
      });
      root.querySelector('[data-backup-selection-tools]').classList.toggle('hidden', all);
      const count = selection().length;
      root.querySelector('[data-backup-selection-summary]').textContent = `${count} of ${sections.length} sections selected${count !== sections.length ? ' · partial content backup' : ''}`;
      options.disabled = Boolean(controller) || !isUsable();
      createButton.disabled = Boolean(controller) || !isUsable() || !count;
    }

    function updateProgress(state) {
      if (!active) return;
      const fraction = state.expected ? state.records / state.expected : 0;
      progress.querySelector('progress').value = Math.min(99, Math.round((state.completed + fraction) / state.sections * 100));
      root.querySelector('[data-backup-progress-text]').textContent = `Reading ${state.section} · ${number(state.records)}${state.expected !== null ? ` of ${number(state.expected)}` : ''} records · section ${state.completed + 1} of ${state.sections}`;
    }

    async function create() {
      if (controller || !isUsable()) return;
      const keys = selection();
      controller = new AbortController();
      const operation = controller;
      clearReady();
      errorOutput.classList.add('hidden'); message.classList.add('hidden');
      progress.classList.remove('hidden'); cancelButton.classList.remove('hidden');
      progress.querySelector('progress').value = 0;
      root.querySelector('[data-backup-progress-text]').textContent = 'Checking backup permissions…';
      NC.utils.setButtonLoading(createButton, true, 'Creating backup…');
      refreshSelection();
      try {
        const backup = await collect(keys, { signal: operation.signal, onProgress: updateProgress });
        if (!active || operation.signal.aborted) return;
        const blob = new Blob([JSON.stringify(backup)], { type: 'application/json;charset=utf-8' });
        if (blob.size > MAX_BYTES) throw new Error('This backup exceeds 50 MB. Select fewer sections or use a managed database backup.');
        const filename = `ningshing-che-backup-${backup.created_at.replace(/[:.]/g, '-')}.json`;
        ready = { url: URL.createObjectURL(blob), filename, bytes: blob.size, records: backup.manifest.total_records,
          tableCounts: backup.manifest.table_counts, keys };
        root.querySelector('[data-backup-file]').textContent = filename;
        root.querySelector('[data-backup-result-summary]').textContent = `${number(ready.records)} records · ${keys.length} sections · ${bytes(ready.bytes)}`;
        root.querySelector('[data-backup-counts]').innerHTML = sections.filter((section) => keys.includes(section.key))
          .map((section) => `<li><span>${section.label}</span><strong>${number(ready.tableCounts[section.table])}</strong></li>`).join('');
        result.classList.remove('hidden');
        message.textContent = 'Backup ready. Download the JSON file below to keep your copy.';
        message.classList.remove('hidden');
      } catch (error) {
        if (!active) return;
        clearReady();
        if (error.name === 'AbortError') {
          message.textContent = 'Backup cancelled. No file was created.';
          message.classList.remove('hidden');
        } else {
          errorOutput.textContent = NC.api.userMessage(error, 'Backup failed. No partial file was created; please retry.');
          errorOutput.classList.remove('hidden');
        }
      } finally {
        if (active) {
          controller = null;
          NC.utils.setButtonLoading(createButton, false);
          cancelButton.classList.add('hidden'); progress.classList.add('hidden');
          refreshSelection();
        }
      }
    }

    function download() {
      if (!ready) return;
      try {
        checkAccess(ready.keys, sessionToken);
        const link = document.createElement('a');
        link.href = ready.url; link.download = ready.filename; link.hidden = true;
        document.body.appendChild(link);
        try { link.click(); } finally { link.remove(); }
        // Browsers do not confirm a saved download. Record only that it was requested.
        const entry = { filename: ready.filename, records: ready.records, bytes: ready.bytes,
          requested_at: new Date().toISOString() };
        NC.utils.writePreference(historyKey, [entry, ...history().filter((item) => item.filename !== entry.filename)].slice(0, 5));
        renderHistory();
        message.textContent = 'Download requested. Check your browser downloads and keep the file in a safe place.';
        message.classList.remove('hidden');
      } catch (error) {
        clearReady();
        errorOutput.textContent = NC.api.userMessage(error);
        errorOutput.classList.remove('hidden');
      }
    }

    function selectionChanged() {
      clearReady(); message.classList.add('hidden'); errorOutput.classList.add('hidden'); refreshSelection();
    }
    options.addEventListener('change', selectionChanged);
    root.querySelector('[data-backup-select-all]').addEventListener('click', () => {
      root.querySelectorAll('[data-backup-section]').forEach((input) => { input.checked = NC.auth.canAccess(input.value); });
      selectionChanged();
    });
    root.querySelector('[data-backup-clear]').addEventListener('click', () => {
      root.querySelectorAll('[data-backup-section]').forEach((input) => { input.checked = false; });
      selectionChanged();
    });
    createButton.addEventListener('click', create);
    cancelButton.addEventListener('click', () => controller?.abort());
    root.querySelector('[data-backup-download]').addEventListener('click', download);

    function onSessionChange() {
      if (!isUsable() || ready?.keys.some((key) => !NC.auth.canAccess(key))) {
        controller?.abort(); clearReady();
      }
      refreshSelection();
    }
    window.addEventListener('nc:session-change', onSessionChange);
    window.addEventListener('nc:auth-change', onSessionChange);
    refreshSelection(); renderHistory();
    return function destroy() {
      active = false;
      controller?.abort(); controller = null;
      clearReady();
      window.removeEventListener('nc:session-change', onSessionChange);
      window.removeEventListener('nc:auth-change', onSessionChange);
    };
  }

  NC.backup = Object.freeze({ sections, availableSections, collect, markup, mount, FORMAT, VERSION, MAX_BYTES });
})(window.NC);
