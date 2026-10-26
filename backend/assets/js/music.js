(function (NC) {
  'use strict';

  const { escapeHTML, formatDate, formData, validateFields, debounce, safeImage } = NC.utils;
  const state = new NC.crud.ListState('music', { searchFields: ['title', 'bn_title', 'artist', 'bn_artist', 'album', 'bn_album', 'genre', 'description', 'video_link'], sortKey: 'created_at' });
  const GENRES = [
    'লোকগীতি', 'প্রেম', 'বিরহ', 'নৃত্য', 'পালা-কীর্তন', 'ভজন',
    'রাস', 'রাখুয়াল', 'আরতী', 'সরাত', 'ধ্রুমেল', 'হোলি কীর্তন',
    'পল্লী', 'আধ্যাত্মিক', 'উৎসব', 'দেশাত্মবোধক', 'শিশু',
    'ঐতিহ্যবাহী', 'আধুনিক', 'চলচ্চিত্র', 'ফোক-ফিউশন', 'রিমিক্স',
    'বাদ্যযন্ত্র', 'রক'
  ];
  let root;

  // ---------- Dynamic placeholder helpers ----------
  function getStaticPlaceholder(kind) {
    if (NC.media && NC.media.placeholderFor) return NC.media.placeholderFor(kind);
    const map = {
      cover: 'https://placehold.co/400x400/EDE9FF/7C3AED?text=No+Cover',
      thumbnail: 'https://placehold.co/400x400/EDE9FF/7C3AED?text=No+Cover',
      artist: 'https://placehold.co/400x400/E0F2FE/0369A1?text=No+Artist',
      album: 'https://placehold.co/400x400/FEF3C7/B45309?text=No+Album'
    };
    return map[kind] || map.cover;
  }
  // Use dynamic text + random color when NC.media available, else static fallback
  function dynamicPlaceholder(text, fallback, kind) {
    const label = String(text || '').trim() || fallback;
    if (NC.media && NC.media.placeholderWithText) {
      try { return NC.media.placeholderWithText(label, fallback, kind); } catch (_) {}
    }
    return getStaticPlaceholder(kind);
  }
  function coverPlaceholder(record, liveTitle) {
    // liveTitle overrides record value when typing (for live preview)
    if (liveTitle !== undefined) return dynamicPlaceholder(liveTitle, 'No Cover', 'cover');
    const txt = (record && (record.bn_title || record.title)) || 'No Cover';
    return dynamicPlaceholder(txt, 'No Cover', 'cover');
  }
  function artistPlaceholder(record, liveName) {
    if (liveName !== undefined) return dynamicPlaceholder(liveName, 'No Artist', 'artist');
    const txt = (record && (record.bn_artist || record.artist)) || 'No Artist';
    return dynamicPlaceholder(txt, 'No Artist', 'artist');
  }
  function albumPlaceholder(record, liveName) {
    if (liveName !== undefined) return dynamicPlaceholder(liveName, 'No Album', 'album');
    const txt = (record && (record.bn_album || record.album)) || 'No Album';
    return dynamicPlaceholder(txt, 'No Album', 'album');
  }
  // Legacy static for fallback where needed
  const PLACEHOLDERS = {
    cover: getStaticPlaceholder('cover'),
    thumbnail: getStaticPlaceholder('thumbnail'),
    artist: getStaticPlaceholder('artist'),
    album: getStaticPlaceholder('album')
  };

  function resolveCover(record) {
    return safeImage(record.thumbnail_url) || coverPlaceholder(record);
  }
  function resolveArtistImage(record) {
    return safeImage(record.artist_image) || safeImage(record.thumbnail_url) || artistPlaceholder(record);
  }
  function resolveAlbumImage(record) {
    return safeImage(record.album_image) || safeImage(record.thumbnail_url) || albumPlaceholder(record);
  }

  // ---------- Build distinct artist/album indexes from existing records ----------
  function buildArtistIndex() {
    const map = new Map(); // lower -> { artist, bn_artist, artist_image, artist_description }
    (state.records || []).forEach((r) => {
      const name = String(r.artist || '').trim();
      if (!name) return;
      const key = name.toLowerCase();
      const img = String(r.artist_image || '').trim() || String(r.thumbnail_url || '').trim();
      const desc = String(r.artist_description || '').trim();
      if (!map.has(key)) map.set(key, { artist: name, bn_artist: String(r.bn_artist || '').trim(), artist_image: img, artist_description: desc });
      else {
        const cur = map.get(key);
        if (!cur.bn_artist && r.bn_artist) cur.bn_artist = String(r.bn_artist || '').trim();
        if (!cur.artist_image && img) cur.artist_image = img;
        if (!cur.artist_description && desc) cur.artist_description = desc;
      }
    });
    return map;
  }
  function buildAlbumIndex() {
    const map = new Map();
    (state.records || []).forEach((r) => {
      const name = String(r.album || '').trim();
      if (!name) return;
      const key = name.toLowerCase();
      const img = String(r.album_image || '').trim() || String(r.thumbnail_url || '').trim();
      const desc = String(r.album_description || '').trim();
      if (!map.has(key)) map.set(key, { album: name, bn_album: String(r.bn_album || '').trim(), album_image: img, album_description: desc });
      else {
        const cur = map.get(key);
        if (!cur.bn_album && r.bn_album) cur.bn_album = String(r.bn_album || '').trim();
        if (!cur.album_image && img) cur.album_image = img;
        if (!cur.album_description && desc) cur.album_description = desc;
      }
    });
    return map;
  }

  // ---------- Single-value combobox (Artist / Album) ----------
  function mountSingleCombobox(container, opts) {
    const box = container.querySelector(opts.comboSelector);
    if (!box) return { getValue: () => '', setValue: () => {} };
    const hidden = box.querySelector(opts.hiddenSelector);
    const shell = box.querySelector(opts.shellSelector);
    const input = box.querySelector(opts.inputSelector);
    const menu = box.querySelector(opts.menuSelector);
    const items = opts.items || [];
    const onSelect = opts.onSelect || (() => {});
    let active = -1;

    function allItems() { return items; }

    function filtered() {
      const needle = String(input.value || '').trim().toLowerCase();
      if (!needle) return allItems().slice(0, 12);
      return allItems().filter((it) => it.toLowerCase().includes(needle)).slice(0, 12);
    }

    function syncHiddenFromInput() {
      hidden.value = String(input.value || '').trim();
    }

    function selectValue(val) {
      input.value = val;
      hidden.value = val;
      menu.classList.add('hidden');
      shell.classList.remove('is-open');
      active = -1;
      onSelect(val);
      // update placeholder live if callback provided for live text
      if (opts.onLiveChange) opts.onLiveChange(val);
    }

    function renderMenu() {
      const options = filtered();
      if (!options.length) {
        // show "create" option if typed text not in list
        const typed = String(input.value || '').trim();
        if (typed && !items.some((it) => it.toLowerCase() === typed.toLowerCase())) {
          menu.innerHTML = `<button type="button" class="combo-option" data-create="${escapeHTML(typed)}">Create "${escapeHTML(typed)}"</button>`;
          menu.classList.remove('hidden');
          shell.classList.add('is-open');
          menu.querySelectorAll('.combo-option').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', () => selectValue(typed));
          });
          return;
        }
        menu.classList.add('hidden');
        menu.innerHTML = '';
        shell.classList.remove('is-open');
        return;
      }
      menu.innerHTML = options.map((item, idx) =>
        `<button type="button" class="combo-option${idx === active ? ' is-active' : ''}" role="option" data-value="${escapeHTML(item)}">${escapeHTML(item)}</button>`
      ).join('');
      menu.classList.remove('hidden');
      shell.classList.add('is-open');
      menu.querySelectorAll('.combo-option').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => selectValue(btn.dataset.value || btn.textContent || ''));
      });
    }

    input.addEventListener('focus', renderMenu);
    input.addEventListener('input', () => { syncHiddenFromInput(); active = -1; renderMenu(); if (opts.onLiveChange) opts.onLiveChange(input.value); });
    input.addEventListener('change', syncHiddenFromInput);
    input.addEventListener('keydown', (e) => {
      const options = filtered();
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (active >= 0 && options[active]) { e.preventDefault(); selectValue(options[active]); return; }
        // if typing exact match, select it
        const typed = String(input.value || '').trim();
        if (typed && options.some((it) => it.toLowerCase() === typed.toLowerCase())) {
          e.preventDefault();
          const match = options.find((it) => it.toLowerCase() === typed.toLowerCase());
          if (match) { selectValue(match); return; }
        }
        // allow Tab to commit typed value as new
        if (e.key === 'Tab' && typed) { hidden.value = typed; menu.classList.add('hidden'); shell.classList.remove('is-open'); }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, options.length - 1); renderMenu(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); renderMenu(); }
      if (e.key === 'Escape') { menu.classList.add('hidden'); shell.classList.remove('is-open'); }
    });
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        // commit current input to hidden if not empty
        syncHiddenFromInput();
        menu.classList.add('hidden');
        shell.classList.remove('is-open');
      }, 150);
    });
    shell.addEventListener('click', () => input.focus());

    // set initial
    if (opts.initial) {
      input.value = opts.initial;
      hidden.value = opts.initial;
    }

    return {
      getValue() { syncHiddenFromInput(); return hidden.value; },
      setValue(v) { input.value = v; hidden.value = v; },
      focus() { input.focus(); },
      refresh() { renderMenu(); }
    };
  }

  function parseGenres(value) {
    return String(value || '').split(/[,،;\t\n]+/).map((item) => item.trim()).filter(Boolean)
      .filter((item, index, list) => list.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index);
  }

  function genreBadges(value) {
    const items = parseGenres(value);
    if (!items.length) return '—';
    return `<div class="badge-wrap">${items.map((item) => NC.components.statusBadge(item)).join('')}</div>`;
  }

  function mountGenreCombobox(root, initial) {
    const box = root.querySelector('[data-genre-combo]');
    if (!box) return { getValue: () => '' };
    const hidden = box.querySelector('[data-genre-value]');
    const shell = box.querySelector('[data-genre-shell]');
    const input = box.querySelector('.combo-query');
    const menu = box.querySelector('[data-genre-menu]');
    let selected = parseGenres(initial);
    let active = -1;

    function syncHidden() {
      hidden.value = selected.join(', ');
    }

    function renderChips() {
      shell.querySelectorAll('.combo-chip').forEach((node) => node.remove());
      selected.forEach((genre, index) => {
        const chip = document.createElement('span');
        chip.className = 'combo-chip';
        chip.innerHTML = `${escapeHTML(genre)}<button type="button" aria-label="Remove ${escapeHTML(genre)}">&times;</button>`;
        chip.querySelector('button').addEventListener('click', (event) => {
          event.preventDefault();
          selected.splice(index, 1);
          syncHidden(); renderChips(); renderMenu();
          input.focus();
        });
        shell.insertBefore(chip, input);
      });
      syncHidden();
    }

    function addToken(raw) {
      parseGenres(raw).forEach((item) => {
        if (!selected.some((genre) => genre.toLowerCase() === item.toLowerCase())) selected.push(item);
      });
      input.value = '';
      active = -1;
      renderChips();
      renderMenu();
    }

    function filtered() {
      const needle = input.value.trim().toLowerCase();
      return GENRES.filter((item) =>
        !selected.some((genre) => genre.toLowerCase() === item.toLowerCase()) &&
        (!needle || item.toLowerCase().includes(needle))
      );
    }

    function renderMenu() {
      const options = filtered();
      if (!options.length) {
        menu.classList.add('hidden');
        menu.innerHTML = '';
        shell.classList.remove('is-open');
        return;
      }
      menu.innerHTML = options.map((item, index) =>
        `<button type="button" class="combo-option${index === active ? ' is-active' : ''}" role="option">${escapeHTML(item)}</button>`
      ).join('');
      menu.classList.remove('hidden');
      shell.classList.add('is-open');
      menu.querySelectorAll('.combo-option').forEach((button) => {
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => addToken(button.textContent || ''));
      });
    }

    input.addEventListener('focus', renderMenu);
    input.addEventListener('input', () => {
      const value = input.value;
      if (/[,،;\t\n]/.test(value)) addToken(value);
      else { active = -1; renderMenu(); }
    });
    input.addEventListener('keydown', (event) => {
      const options = filtered();
      if (event.key === 'Tab' || event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        if (active >= 0 && options[active]) addToken(options[active]);
        else addToken(input.value);
        return;
      }
      if (event.key === 'Backspace' && !input.value && selected.length) {
        selected.pop();
        syncHidden(); renderChips(); renderMenu();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        active = Math.min(active + 1, options.length - 1);
        renderMenu();
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        active = Math.max(active - 1, 0);
        renderMenu();
      }
      if (event.key === 'Escape') {
        menu.classList.add('hidden');
        shell.classList.remove('is-open');
      }
    });
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (input.value.trim()) addToken(input.value);
        menu.classList.add('hidden');
        shell.classList.remove('is-open');
      }, 120);
    });
    shell.addEventListener('click', () => input.focus());
    const select = root.querySelector('[data-genre-select]');
    select?.addEventListener('change', () => {
      if (select.value) {
        addToken(select.value);
        select.selectedIndex = 0;
      }
    });
    renderChips();
    return {
      getValue() {
        if (input.value.trim()) addToken(input.value);
        return hidden.value;
      }
    };
  }

  function durationLabel(seconds) {
    const total = Number(seconds) || 0;
    if (total <= 0) return '—';
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // ---------- JSON import helpers ----------
  function textVal(v) { return v == null ? '' : String(v).trim(); }
  function normKey(v) { return String(v || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function dupKeyForPayload(p) {
    // Primary: normalized audio_url; fallback: title|artist|album combo
    const audio = normKey(p.audio_url);
    if (audio) return `audio:${audio}`;
    return `meta:${normKey(p.title)}|${normKey(p.artist)}|${normKey(p.album)}`;
  }
  function dupKeyForRecord(r) {
    const audio = normKey(r.audio_url);
    if (audio) return `audio:${audio}`;
    return `meta:${normKey(r.title)}|${normKey(r.artist)}|${normKey(r.album)}`;
  }

  function normalizeJsonRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = textVal(raw.title || raw.name || raw.track || raw.song_name || raw.song);
    const bn_title = textVal(raw.bn_title || raw.bnTitle || raw.title_bn || raw.titleBn || raw.bengali_title || raw.bangla_title || raw.banglaTitle);
    const artist = textVal(raw.artist || raw.singer || raw.artist_name || raw.artistName || raw.performer);
    const bn_artist = textVal(raw.bn_artist || raw.bnArtist || raw.artist_bn || raw.artistBn || raw.singer_bn);
    const album = textVal(raw.album || raw.album_name || raw.albumName || raw.collection || raw.album_title);
    const bn_album = textVal(raw.bn_album || raw.bnAlbum || raw.album_bn || raw.albumBn);
    const genre = textVal(raw.genre || raw.genre_bpy || raw.genreBpy || raw.tags || raw.category || raw.genres);
    const description = textVal(raw.description || raw.desc || raw.details || raw.content);
    const lyrics = textVal(raw.lyrics || raw.lyric || raw.words);
    const video_link = textVal(raw.video_link || raw.videoLink || raw.video || raw.video_url || raw.youtube || raw.youtube_url);
    const thumbnail_url = textVal(raw.thumbnail_url || raw.thumbnailUrl || raw.cover || raw.cover_url || raw.coverUrl || raw.thumbnail || raw.image || raw.artwork || raw.artwork_url || raw.img || raw.cover_image);
    const artist_image = textVal(raw.artist_image || raw.artistImage || raw.artist_img || raw.singer_image);
    const album_image = textVal(raw.album_image || raw.albumImage || raw.album_img || raw.album_cover);
    const audio_url = textVal(raw.audio_url || raw.audioUrl || raw.file_path || raw.filePath || raw.audio || raw.url || raw.link || raw.mp3 || raw.file || raw.source || raw.audio_link);
    const file_provider = audio_url ? (audio_url.includes('supabase') || raw.file_storage_path ? 'supabase-storage' : 'url') : 'url';
    if (!title || !audio_url) return null;
    return {
      title, bn_title, artist, bn_artist, album, bn_album, genre, description, lyrics, video_link,
      thumbnail_url: thumbnail_url || coverPlaceholder({ bn_title: bn_title || title, title }, bn_title || title),
      artist_image: artist_image || '', artist_description: textVal(raw.artist_description || raw.artistDescription || raw.artist_bio || ''),
      album_image: album_image || '', album_description: textVal(raw.album_description || raw.albumDescription || raw.album_bio || ''),
      audio_url, file_provider, file_storage_path: textVal(raw.file_storage_path || raw.fileStoragePath || ''),
      file_size_mb: Number(raw.file_size_mb || raw.fileSizeMb || 0) || 0,
      duration_seconds: Number(raw.duration_seconds || raw.durationSeconds || raw.duration || 0) || 0,
      imgbb_delete_url: textVal(raw.imgbb_delete_url || ''), image_meta: raw.image_meta || {}
    };
  }

  function parseJsonImportFile(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('The JSON file is empty.');
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch (e) { throw new Error('Invalid JSON: ' + e.message); }
    let arr = [];
    if (Array.isArray(parsed)) arr = parsed;
    else if (Array.isArray(parsed.data)) arr = parsed.data;
    else if (Array.isArray(parsed.tracks)) arr = parsed.tracks;
    else if (Array.isArray(parsed.songs)) arr = parsed.songs;
    else if (parsed && typeof parsed === 'object') {
      if (parsed.title || parsed.audio_url || parsed.file_path) arr = [parsed];
      else {
        const values = Object.values(parsed);
        if (values.length && typeof values[0] === 'object') arr = values;
        else throw new Error('JSON must be an array of songs or an object with a data/tracks/songs array.');
      }
    } else throw new Error('JSON must be an array of songs.');
    if (!arr.length) throw new Error('JSON contains no songs.');
    return arr;
  }

  function openJsonImport() {
    let jsonRecords = [];
    let validPayloads = [];
    let invalidCount = 0;
    let duplicateCount = 0;
    let existingKeySet = new Set(); // filled on first file process
    const modal = NC.components.openModal({
      title: 'Import music from JSON', eyebrow: 'Bulk upload', size: 'xl',
      description: 'Upload a JSON file with an array of songs. Each needs at least a title and an audio_url (or file_path). Fields like bn_title, bn_artist, bn_album, thumbnail_url, artist_image, album_image are optional — placeholders are shown when missing.',
      content: `
        <div class="import-wizard">
          <div class="import-toolbar">
            <div>${NC.components.notice('JSON keys are flexible: title / bn_title, artist / bn_artist, album / bn_album, audio_url / file_path, thumbnail_url / cover, artist_image, album_image, genre / tags, video_link, lyrics, description.', 'info')}</div>
            <div class="import-template-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-json-template-download><i class="fa-regular fa-file-code" aria-hidden="true"></i>Download template</button>
            </div>
          </div>
          <label class="import-drop-zone" data-json-drop-zone tabindex="0">
            <input type="file" class="sr-only" accept=".json,application/json" data-json-file>
            <span><i class="fa-regular fa-cloud-arrow-up" aria-hidden="true"></i></span>
            <strong>Choose a JSON file</strong>
            <small>or drag & drop it here · .json · array of song objects</small>
          </label>
          <div data-json-preview class="hidden"></div>
          <div data-json-status class="notice notice-muted hidden"></div>
          <div data-json-output></div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2 hidden" data-json-actions>
          <button type="button" class="btn btn-primary" data-json-import><i class="fa-regular fa-file-import" aria-hidden="true"></i>Import valid songs</button>
          <span class="field-hint" data-json-hint></span>
        </div>
      `,
      footer: '<button type="button" class="btn btn-secondary" data-modal-close>Close</button>',
      onOpen: (modalRoot) => {
        const input = modalRoot.querySelector('[data-json-file]');
        const dropZone = modalRoot.querySelector('[data-json-drop-zone]');
        const output = modalRoot.querySelector('[data-json-output]');
        const status = modalRoot.querySelector('[data-json-status]');
        const preview = modalRoot.querySelector('[data-json-preview]');
        const actions = modalRoot.querySelector('[data-json-actions]');
        const importBtn = modalRoot.querySelector('[data-json-import]');
        const hint = modalRoot.querySelector('[data-json-hint]');
        function downloadTemplate() {
          const sample = [{
              title: 'Example Song', bn_title: 'উদাহরণ গান', artist: 'Example Artist', bn_artist: 'উদাহরণ শিল্পী', album: 'Example Album', bn_album: 'উদাহরণ অ্যালবাম',
              audio_url: 'https://example.com/song.mp3', thumbnail_url: 'https://example.com/cover.jpg', artist_image: 'https://example.com/artist.jpg', album_image: 'https://example.com/album.jpg', genre: 'ভজন, লোকগীতি', description: 'Optional', lyrics: 'Optional', video_link: 'https://youtube.com/watch?v=...'
            }];
          const blob = new Blob([JSON.stringify(sample, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'music-template.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        modalRoot.querySelector('[data-json-template-download]')?.addEventListener('click', downloadTemplate);
        function renderPreview() {
          if (!jsonRecords.length) { preview.classList.add('hidden'); status.classList.add('hidden'); actions.classList.add('hidden'); return; }
          preview.classList.remove('hidden'); status.classList.remove('hidden');
          const hasIssues = invalidCount || duplicateCount;
          status.className = `notice ${hasIssues ? 'notice-warning' : 'notice-success'}`;
          status.innerHTML = `<i class="fa-regular fa-circle-info" aria-hidden="true"></i><p><strong>${validPayloads.length} valid</strong> · ${duplicateCount} duplicate(s) skipped · ${invalidCount} invalid · ${jsonRecords.length} total. Duplicates by audio_url or title/artist/album will be skipped. Placeholders for missing images.</p>`;
          const rows = validPayloads.slice(0, 100).map((payload, idx) => {
            const thumb = safeImage(payload.thumbnail_url) || coverPlaceholder(payload);
            const bnInfo = payload.bn_title ? ` <small style="color:var(--muted-foreground)">(${escapeHTML(payload.bn_title)})</small>` : '';
            return `<tr><td>${idx + 1}</td><td><div class="video-cell"><img src="${escapeHTML(thumb)}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:6px;" onerror="this.style.display='none'"><div><strong>${escapeHTML(payload.title)}</strong>${bnInfo}<small>${escapeHTML([payload.artist, payload.bn_artist].filter(Boolean).join(' · ') || payload.album || '')}</small></div></div></td><td>${escapeHTML(payload.audio_url.slice(0, 48))}${payload.audio_url.length > 48 ? '…' : ''}</td><td><span class="import-status is-valid"><i class="fa-solid fa-circle-check"></i>Ready</span></td></tr>`;
          }).join('');
          const extraRows = [];
          if (duplicateCount) extraRows.push(`<tr><td colspan="4" class="text-center text-amber-600"><i class="fa-regular fa-forward" aria-hidden="true"></i> ${duplicateCount} duplicate(s) will be skipped (already in library or duplicate within file)</td></tr>`);
          if (invalidCount) extraRows.push(`<tr><td colspan="4" class="text-center text-muted-foreground">${invalidCount} invalid record(s) skipped (missing title or audio_url)</td></tr>`);
          output.innerHTML = `<div class="import-preview-wrap"><table class="data-table import-preview-table"><thead><tr><th>#</th><th>Track</th><th>Audio</th><th>Status</th></tr></thead><tbody>${rows}${extraRows.join('')}</tbody></table></div>${jsonRecords.length > 100 ? `<p class="field-hint mt-2">Showing first 100 of ${jsonRecords.length}.</p>` : ''}`;
          hint.textContent = `${validPayloads.length} ready to import · ${duplicateCount} duplicate(s) skipped · Missing images = placeholders`;
          actions.classList.remove('hidden'); importBtn.innerHTML = `<i class="fa-regular fa-file-import" aria-hidden="true"></i>Import ${validPayloads.length} songs`; importBtn.disabled = validPayloads.length === 0;
        }
        async function processFile(file) {
          if (!file) return; output.innerHTML = `<div class="import-loading"><i class="fa-regular fa-spinner-third fa-spin" aria-hidden="true"></i><p>Reading JSON…</p></div>`;
          try {
            const text = await file.text(); jsonRecords = parseJsonImportFile(text);
            validPayloads = []; invalidCount = 0; duplicateCount = 0;
            // Build existing duplicate keys (from current library)
            try {
              if (existingKeySet.size === 0) {
                // Prefer in-memory state.records if already loaded, else fetch
                let existing = state.records && state.records.length ? state.records : [];
                if (!existing.length) {
                  const res = await NC.api.list('music', { select: 'audio_url,title,artist,album', limit: 2000 });
                  existing = res.data || [];
                }
                existing.forEach((rec) => existingKeySet.add(dupKeyForRecord(rec)));
              }
            } catch (e) { console.warn('Could not load existing music for duplicate check, will treat all as new:', e); }
            const seenInFile = new Set();
            jsonRecords.forEach((raw) => {
              const norm = normalizeJsonRecord(raw);
              if (!norm) { invalidCount += 1; return; }
              const key = dupKeyForPayload(norm);
              if (existingKeySet.has(key) || seenInFile.has(key)) { duplicateCount += 1; return; }
              seenInFile.add(key);
              // Also consider fallback combo key as duplicate if audio key differs but meta matches
              // To catch duplicates where audio_url differs only by encoding, we check both forms
              // Already dupKeyForPayload uses audio_url primary, so it's sufficient
              validPayloads.push(norm);
            });
            renderPreview();
            if (!validPayloads.length) {
              if (duplicateCount) NC.components.toast(`${duplicateCount} duplicate(s) skipped — nothing new to import.`, 'warning');
              else NC.components.toast('No valid songs found. Each needs title + audio_url/file_path.', 'error');
            } else {
              const msg = duplicateCount ? `${validPayloads.length} new songs ready (${duplicateCount} duplicate(s) will be skipped).` : `${validPayloads.length} valid songs detected.`;
              NC.components.toast(msg, duplicateCount ? 'warning' : 'success');
            }
          } catch (e) { output.innerHTML = `<div class="import-error"><i class="fa-solid fa-file-circle-exclamation"></i><h3>Could not read JSON</h3><p>${escapeHTML(e.message)}</p></div>`; NC.components.toast(e.message, 'error'); } finally { input.value = ''; }
        }
        input.addEventListener('change', () => processFile(input.files?.[0])); dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } }); ['dragenter', 'dragover'].forEach((n) => dropZone.addEventListener(n, (e) => { e.preventDefault(); dropZone.classList.add('is-dragging'); })); ['dragleave', 'drop'].forEach((n) => dropZone.addEventListener(n, (e) => { e.preventDefault(); dropZone.classList.remove('is-dragging'); })); dropZone.addEventListener('drop', (e) => processFile(e.dataTransfer?.files?.[0]));
        importBtn.addEventListener('click', async () => {
          if (!validPayloads.length) return; importBtn.disabled = true;
          output.innerHTML = `<div class="import-progress-panel"><div><i class="fa-regular fa-spinner-third fa-spin"></i><span><strong>Importing ${validPayloads.length} songs…</strong><small data-json-progress-label>0 of ${validPayloads.length}</small></span></div><div class="upload-progress"><div class="upload-progress-track"><span data-json-progress-bar></span></div><span data-json-progress-percent>0%</span></div></div>`;
          const bar = output.querySelector('[data-json-progress-bar]'); const pct = output.querySelector('[data-json-progress-percent]'); const label = output.querySelector('[data-json-progress-label]');
          let cursor = 0, completed = 0, imported = 0, failed = 0; const results = [];
          async function worker() { while (cursor < validPayloads.length) { const item = validPayloads[cursor]; cursor += 1; try { const rec = await NC.api.insert('music', item); results.push({ status: 'imported', item, rec }); imported += 1; } catch (err) { results.push({ status: 'failed', item, err }); failed += 1; } completed += 1; const p = Math.round((completed / validPayloads.length) * 100); bar.style.width = p + '%'; pct.textContent = p + '%'; label.textContent = `${completed} of ${validPayloads.length} · ${imported} imported${failed ? ` · ${failed} failed` : ''}`; } }
          await Promise.all(Array.from({ length: Math.min(4, validPayloads.length) }, worker));
          existingKeySet = new Set([...existingKeySet, ...validPayloads.slice(0, imported).map(dupKeyForPayload)]);
          const totalSkipped = duplicateCount + invalidCount;
          output.innerHTML = `<div class="import-complete ${failed ? 'has-failures' : ''}"><span><i class="fa-solid ${failed ? 'fa-triangle-exclamation' : 'fa-circle-check'}\"></i></span><div><h3>${failed ? 'Completed with errors' : 'Import completed'}</h3><p>${imported} imported · ${failed} failed · ${duplicateCount} duplicate(s) skipped · ${invalidCount} invalid skipped.</p></div></div>`;
          if (imported) { NC.components.toast(`${imported} songs imported${duplicateCount ? `, ${duplicateCount} duplicate(s) skipped` : ''}.`, 'success'); await load(); } if (failed) NC.components.toast(`${failed} failed to import.`, 'error');
          if (!imported && duplicateCount) NC.components.toast(`All ${duplicateCount} song(s) were duplicates — nothing imported.`, 'warning');
        });
      }
    }); return modal;
  }

  function renderList() {
    const content = root.querySelector('[data-music-content]');
    const { rows, total } = state.paged();
    if (!total) {
      content.innerHTML = NC.components.emptyState({
        icon: 'fa-music', title: state.query ? 'No tracks match your search' : 'Add the first song',
        description: state.query ? 'Try a different title or artist.' : 'Upload MP3 files so the app music player can stream them. You can also bulk import via JSON.',
        action: state.query ? '' : '<button type="button" class="btn btn-primary" data-add-track><i class="fa-regular fa-plus" aria-hidden="true"></i>Add track</button> <button type="button" class="btn btn-secondary" data-import-json><i class="fa-regular fa-file-code" aria-hidden="true"></i>Import JSON</button>'
      }); bindEvents(content); return;
    }
    const body = rows.map((record) => {
      const thumbnail = resolveCover(record);
      const subtitleParts = [record.artist, record.bn_artist, record.album, record.bn_album].filter(Boolean);
      const displayTitle = record.bn_title ? `${record.title} · ${record.bn_title}` : record.title;
      return `
        <tr>
          <td data-label="Track"><div class="video-cell"><img src="${escapeHTML(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" style="width:44px;height:44px;object-fit:cover;border-radius:8px;background:var(--surface-subtle)" onerror="this.src='${getStaticPlaceholder('cover')}'"><div><strong>${escapeHTML(displayTitle)}</strong><small>${escapeHTML(subtitleParts.join(' · ') || record.description || '')}</small></div></div></td>
          <td data-label="Genre">${genreBadges(record.genre)}</td>
          <td data-label="Length">${escapeHTML(durationLabel(record.duration_seconds))}</td>
          <td data-label="Added">${escapeHTML(formatDate(record.created_at))}</td>
          <td data-label="Actions" class="text-right">${NC.components.rowActions([
            { action: 'view', id: record.id, label: 'Preview track', icon: 'fa-play' },
            { action: 'edit', id: record.id, label: 'Edit track', icon: 'fa-pen' },
            { action: 'delete', id: record.id, label: 'Delete track', icon: 'fa-trash', danger: true }
          ])}</td>
        </tr>`;
    }).join('');
    content.innerHTML = `${NC.components.tableShell({ caption: 'Music', minWidth: '820px', head: '<tr><th>Track</th><th>Genre</th><th>Length</th><th>Added</th><th class="text-right">Actions</th></tr>', body })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
    bindEvents(content); NC.components.bindImageFallbacks(content);
  }

  function bindEvents(scope = root) {
    scope.querySelectorAll('[data-add-track]').forEach((button) => button.addEventListener('click', () => openForm()));
    scope.querySelectorAll('[data-import-json]').forEach((button) => button.addEventListener('click', () => openJsonImport()));
    scope.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
      const record = state.records.find((item) => item.id === button.dataset.id); if (!record) return;
      if (button.dataset.action === 'view') openView(record);
      if (button.dataset.action === 'edit') openForm(record);
      if (button.dataset.action === 'delete') remove(record);
    }));
    NC.crud.bindPagination(root, state, renderList);
  }

  function openView(record) {
    const cover = resolveCover(record);
    const artistImg = resolveArtistImage(record);
    const albumImg = resolveAlbumImage(record);
    NC.components.openModal({
      title: record.bn_title ? `${record.title} · ${record.bn_title}` : record.title,
      eyebrow: [record.artist, record.bn_artist, record.album, record.bn_album].filter(Boolean).join(' · ') || 'Music', size: 'lg',
      content: `
        <div class="grid gap-4">
          <div class="flex gap-4 items-start flex-wrap">
            <img src="${escapeHTML(cover)}" alt="Cover" style="width:120px;height:120px;object-fit:cover;border-radius:16px;" referrerpolicy="no-referrer" onerror="this.src='${getStaticPlaceholder('cover')}'">
            <div class="grid gap-3">
              <div class="flex gap-2 items-center flex-wrap">
                <img src="${escapeHTML(artistImg)}" alt="Artist" style="width:48px;height:48px;object-fit:cover;border-radius:50%;border:1px solid var(--border)" referrerpolicy="no-referrer" onerror="this.src='${getStaticPlaceholder('artist')}'">
                <div><strong>${escapeHTML(record.artist || 'Unknown artist')}</strong>${record.bn_artist ? `<small style="display:block;color:var(--muted-foreground)">${escapeHTML(record.bn_artist)}</small>` : ''}</div>
              </div>
              <div class="flex gap-2 items-center flex-wrap">
                <img src="${escapeHTML(albumImg)}" alt="Album" style="width:48px;height:48px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" referrerpolicy="no-referrer" onerror="this.src='${getStaticPlaceholder('album')}'">
                <div><strong>${escapeHTML(record.album || 'Unknown album')}</strong>${record.bn_album ? `<small style="display:block;color:var(--muted-foreground)">${escapeHTML(record.bn_album)}</small>` : ''}</div>
              </div>
            </div>
          </div>
          <audio controls preload="metadata" src="${escapeHTML(record.audio_url)}" style="width:100%"></audio>
          ${record.video_link ? `<div class="mt-2">${NC.media.videoPreviewHTML(record.video_link, { title: record.title })}</div>` : ''}
          ${record.description ? `<div class="prose-content mt-3"><p>${escapeHTML(record.description)}</p></div>` : ''}
          ${record.lyrics ? `<details class="mt-3"><summary class="cursor-pointer font-semibold">Lyrics</summary><div class="prose-content mt-2 whitespace-pre-wrap">${escapeHTML(record.lyrics)}</div></details>` : ''}
          <div class="details-grid mt-3">
            ${record.bn_title ? `<div><dt>Bangla Title</dt><dd>${escapeHTML(record.bn_title)}</dd></div>` : ''}
            ${record.bn_artist ? `<div><dt>Bangla Artist</dt><dd>${escapeHTML(record.bn_artist)}</dd></div>` : ''}
            ${record.bn_album ? `<div><dt>Bangla Album</dt><dd>${escapeHTML(record.bn_album)}</dd></div>` : ''}
          </div>
        </div>
      `,
      footer: '<button type="button" class="btn btn-secondary" data-modal-close>Close</button><button type="button" class="btn btn-primary" data-track-edit><i class="fa-regular fa-pen" aria-hidden="true"></i>Edit track</button>',
      onOpen: (modalRoot) => modalRoot.querySelector('[data-track-edit]').addEventListener('click', () => { NC.components.closeModal(); window.setTimeout(() => openForm(record), 180); })
    });
  }

  function openForm(record = null) {
    // Build distinct lists for comboboxes
    const artistMap = buildArtistIndex();
    const albumMap = buildAlbumIndex();
    const distinctArtists = Array.from(artistMap.values()).map(v => v.artist).sort((a,b)=>a.localeCompare(b));
    const distinctAlbums = Array.from(albumMap.values()).map(v => v.album).sort((a,b)=>a.localeCompare(b));

    NC.components.openModal({
      title: record ? 'Edit track' : 'Add track', eyebrow: 'Music library', size: 'xl',
      description: 'Upload an MP3 to Supabase Storage so the app streams a lasting public URL. Add Bangla titles for bilingual display; placeholders are shown when images are left empty.',
      content: `<form id="music-form" class="form-stack" novalidate>
        <div class="form-grid-2">
          <div class="field"><label class="field-label" for="track-title">Title <span aria-hidden="true">*</span></label><input class="form-input" id="track-title" name="title" value="${escapeHTML(record?.title || '')}" autofocus><p class="field-error hidden" data-field-error="title"></p></div>
          <div class="field"><label class="field-label" for="track-bn-title">Bangla Title (bn_title)</label><input class="form-input" id="track-bn-title" name="bn_title" value="${escapeHTML(record?.bn_title || '')}" placeholder="বাংলা শিরোনাম"><p class="field-hint">Appears with English title; also shown in cover placeholder.</p></div>
        </div>
        <!-- Artist combobox + BN -->
        <div class="form-grid-2">
          <div class="field">
            <label class="field-label" for="track-artist-query">Artist</label>
            <div class="combo-box" data-artist-combo>
              <input type="hidden" name="artist" data-artist-value value="${escapeHTML(record?.artist || '')}">
              <div class="combo-box-shell" data-artist-shell>
                <input class="combo-query" id="track-artist-query" type="text" autocomplete="off" placeholder="Type or select artist…" value="${escapeHTML(record?.artist || '')}">
              </div>
              <div class="combo-menu hidden" data-artist-menu role="listbox"></div>
            </div>
            <span class="field-hint">Choose existing or type new. Selecting auto-fills Bangla artist.</span>
          </div>
          <div class="field"><label class="field-label" for="track-bn-artist">Bangla Artist (bn_artist)</label><input class="form-input" id="track-bn-artist" name="bn_artist" value="${escapeHTML(record?.bn_artist || '')}" placeholder="বাংলা শিল্পী"></div>
        </div>
        <!-- Album combobox + BN -->
        <div class="form-grid-2">
          <div class="field">
            <label class="field-label" for="track-album-query">Album</label>
            <div class="combo-box" data-album-combo>
              <input type="hidden" name="album" data-album-value value="${escapeHTML(record?.album || '')}">
              <div class="combo-box-shell" data-album-shell>
                <input class="combo-query" id="track-album-query" type="text" autocomplete="off" placeholder="Type or select album…" value="${escapeHTML(record?.album || '')}">
              </div>
              <div class="combo-menu hidden" data-album-menu role="listbox"></div>
            </div>
            <span class="field-hint">Choose existing or type new. Selecting auto-fills Bangla album.</span>
          </div>
          <div class="field"><label class="field-label" for="track-bn-album">Bangla Album (bn_album)</label><input class="form-input" id="track-bn-album" name="bn_album" value="${escapeHTML(record?.bn_album || '')}" placeholder="বাংলা অ্যালবাম"></div>
        </div>
        <div class="field">
          <label class="field-label" for="track-genre-select">Genre / category</label>
          <select class="form-input" id="track-genre-select" data-genre-select>
            <option value="">Select a genre…</option>
            ${GENRES.map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join('')}
          </select>
          <div class="combo-box mt-3" data-genre-combo>
            <input type="hidden" name="genre" data-genre-value value="${escapeHTML(record?.genre || '')}">
            <div class="combo-box-shell" data-genre-shell>
              <input class="combo-query" id="track-genre-query" type="text" autocomplete="off" placeholder="Or type another genre, then comma / tab">
            </div>
            <div class="combo-menu hidden" data-genre-menu role="listbox"></div>
          </div>
          <span class="field-hint">Use the select or type. Comma or Tab creates a chip. Multiple genres are allowed.</span>
        </div>
        ${NC.media.imageUploaderHTML({ id: 'track-cover', label: 'Cover / thumbnail', hint: 'Square artwork looks best in mini player. Placeholder shows Bangla title with random color if empty.', placeholder: coverPlaceholder(record || { bn_title: '', title: '' }) })}
        ${NC.media.imageUploaderHTML({ id: 'track-artist-image', label: 'Artist image', hint: 'Shown on artist page. Placeholder shows Bangla artist with random color if empty.', placeholder: artistPlaceholder(record || { bn_artist: '', artist: '' }) })}
        <div class="field"><label class="field-label" for="track-artist-description">Artist description</label><textarea class="form-textarea min-h-28" id="track-artist-description" name="artist_description" placeholder="Short bio for the artist page.">${escapeHTML(record?.artist_description || '')}</textarea></div>
        ${NC.media.imageUploaderHTML({ id: 'track-album-image', label: 'Album image', hint: 'Shown on album page. Placeholder shows Bangla album with random color if empty.', placeholder: albumPlaceholder(record || { bn_album: '', album: '' }) })}
        <div class="field"><label class="field-label" for="track-album-description">Album description</label><textarea class="form-textarea min-h-28" id="track-album-description" name="album_description" placeholder="Notes for the album page.">${escapeHTML(record?.album_description || '')}</textarea></div>
        ${NC.media.audioUploaderHTML({ id: 'track-audio', label: 'MP3 file' })}
        <div class="field"><label class="field-label" for="track-video">Video link</label><input class="form-input" type="url" id="track-video" name="video_link" value="${escapeHTML(record?.video_link || '')}" placeholder="YouTube, Facebook, Veome Video Link Here"><p class="field-error hidden" data-field-error="video_link"></p><span class="field-hint">Optional. YouTube, Facebook, or Vimeo. Paste a URL to preview it below.</span></div>
        <div data-track-video-preview class="mt-2">${record?.video_link ? NC.media.videoPreviewHTML(record.video_link, { title: record.title }) : ''}</div>
        <div class="field"><label class="field-label" for="track-description">Description</label><textarea class="form-textarea min-h-28" id="track-description" name="description">${escapeHTML(record?.description || '')}</textarea></div>
        <div class="field"><label class="field-label" for="track-lyrics">Lyrics</label><textarea class="form-textarea min-h-40" id="track-lyrics" name="lyrics" placeholder="Optional. Shown in the app player.">${escapeHTML(record?.lyrics || '')}</textarea></div>
      </form>`,
      footer: `<button type="button" class="btn btn-secondary" data-modal-close>Cancel</button><button type="submit" form="music-form" class="btn btn-primary" data-save-track><i class="fa-regular fa-floppy-disk" aria-hidden="true"></i>${record ? 'Save changes' : 'Add track'}</button>`,
      onOpen: (modalRoot) => {
        const form = modalRoot.querySelector('#music-form');
        // Dynamic placeholders that update live
        const initialCoverPh = coverPlaceholder(record || { bn_title: form.querySelector('#track-bn-title')?.value || '', title: form.querySelector('#track-title')?.value || '' });
        const initialArtistPh = artistPlaceholder(record || { bn_artist: form.querySelector('#track-bn-artist')?.value || '', artist: form.querySelector('#track-artist-query')?.value || '' });
        const initialAlbumPh = albumPlaceholder(record || { bn_album: form.querySelector('#track-bn-album')?.value || '', album: form.querySelector('#track-album-query')?.value || '' });

        const cover = NC.media.mountImageUploader(modalRoot.querySelector('#track-cover'), {
          initial: record ? { url: record.thumbnail_url, delete_url: record.imgbb_delete_url, ...record.image_meta } : null,
          placeholder: initialCoverPh
        });
        const artistImage = NC.media.mountImageUploader(modalRoot.querySelector('#track-artist-image'), {
          initial: record?.artist_image ? { url: record.artist_image } : null,
          placeholder: initialArtistPh
        });
        const albumImage = NC.media.mountImageUploader(modalRoot.querySelector('#track-album-image'), {
          initial: record?.album_image ? { url: record.album_image } : null,
          placeholder: initialAlbumPh
        });

        // Live placeholder updates when BN fields change (only if no real image)
        function updateCoverPlaceholder() {
          if (cover.getValue().url) return; // real image present, don't override
          const bn = form.querySelector('#track-bn-title')?.value || '';
          const en = form.querySelector('#track-title')?.value || '';
          const label = bn || en || 'No Cover';
          cover.setPlaceholder(dynamicPlaceholder(label, 'No Cover', 'cover'));
        }
        function updateArtistPlaceholder() {
          if (artistImage.getValue().url) return;
          const bn = form.querySelector('#track-bn-artist')?.value || '';
          const en = form.querySelector('#track-artist-query')?.value || '';
          const label = bn || en || 'No Artist';
          artistImage.setPlaceholder(dynamicPlaceholder(label, 'No Artist', 'artist'));
        }
        function updateAlbumPlaceholder() {
          if (albumImage.getValue().url) return;
          const bn = form.querySelector('#track-bn-album')?.value || '';
          const en = form.querySelector('#track-album-query')?.value || '';
          const label = bn || en || 'No Album';
          albumImage.setPlaceholder(dynamicPlaceholder(label, 'No Album', 'album'));
        }
        form.querySelector('#track-title')?.addEventListener('input', debounce(updateCoverPlaceholder, 250));
        form.querySelector('#track-bn-title')?.addEventListener('input', debounce(updateCoverPlaceholder, 250));
        form.querySelector('#track-bn-artist')?.addEventListener('input', debounce(updateArtistPlaceholder, 250));
        form.querySelector('#track-bn-album')?.addEventListener('input', debounce(updateAlbumPlaceholder, 250));

        // Artist combobox: selecting fills bn_artist + existing image
        const artistCombo = mountSingleCombobox(modalRoot, {
          comboSelector: '[data-artist-combo]', hiddenSelector: '[data-artist-value]', shellSelector: '[data-artist-shell]', inputSelector: '.combo-query', menuSelector: '[data-artist-menu]',
          items: distinctArtists, initial: record?.artist || '',
          onSelect: (val) => {
            const key = val.toLowerCase();
            const found = artistMap.get(key);
            if (found) {
              if (found.bn_artist) {
                const bnInput = form.querySelector('#track-bn-artist');
                if (bnInput) bnInput.value = found.bn_artist;
              }
              // Auto place existing artist image if available and current field is empty (placeholder)
              if (found.artist_image && !artistImage.getValue().url) {
                artistImage.setValue({ url: found.artist_image });
                NC.components.toast(`Artist image auto-filled from “${val}”.`, 'info');
              }
              if (found.artist_description) {
                const desc = form.querySelector('#track-artist-description');
                if (desc && !String(desc.value || '').trim()) desc.value = found.artist_description;
              }
            }
            updateArtistPlaceholder();
          },
          onLiveChange: () => updateArtistPlaceholder()
        });
        const albumCombo = mountSingleCombobox(modalRoot, {
          comboSelector: '[data-album-combo]', hiddenSelector: '[data-album-value]', shellSelector: '[data-album-shell]', inputSelector: '.combo-query', menuSelector: '[data-album-menu]',
          items: distinctAlbums, initial: record?.album || '',
          onSelect: (val) => {
            const key = val.toLowerCase();
            const found = albumMap.get(key);
            if (found) {
              if (found.bn_album) {
                const bnInput = form.querySelector('#track-bn-album');
                if (bnInput) bnInput.value = found.bn_album;
              }
              if (found.album_image && !albumImage.getValue().url) {
                albumImage.setValue({ url: found.album_image });
                NC.components.toast(`Album image auto-filled from “${val}”.`, 'info');
              }
              if (found.album_description) {
                const desc = form.querySelector('#track-album-description');
                if (desc && !String(desc.value || '').trim()) desc.value = found.album_description;
              }
            }
            updateAlbumPlaceholder();
          },
          onLiveChange: () => updateAlbumPlaceholder()
        });

        const audio = NC.media.mountAudioUploader(modalRoot, {
          initial: record ? { url: record.audio_url, path: record.file_storage_path, provider: record.file_provider, size: Number(record.file_size_mb || 0) * 1024 * 1024, duration_seconds: record.duration_seconds } : null
        });
        const genres = mountGenreCombobox(modalRoot, record?.genre || '');
        const videoInput = modalRoot.querySelector('#track-video');
        const videoPreview = modalRoot.querySelector('[data-track-video-preview]');
        const refreshVideoPreview = () => {
          const link = (videoInput?.value || '').trim();
          if (!videoPreview) return;
          videoPreview.innerHTML = link ? NC.media.videoPreviewHTML(link, { title: form.querySelector('#track-title')?.value || 'Video' }) : '';
        };
        videoInput?.addEventListener('input', debounce(refreshVideoPreview, 280));
        videoInput?.addEventListener('change', refreshVideoPreview);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const data = formData(form);
          // artist/album come from hidden combo values, but formData already has them as 'artist'/'album'
          const audioValue = audio.getValue();
          const videoLink = (data.video_link || '').trim();
          const errors = {
            title: data.title ? '' : 'Track title is required.',
            video_link: videoLink && !NC.utils.isValidUrl(videoLink, { allowEmpty: false }) ? 'Enter a valid video URL.' : ''
          };
          if (!validateFields(form, errors) || !audio.validate() || cover.isUploading() || audio.isUploading() || artistImage.isUploading() || albumImage.isUploading()) {
            if (cover.isUploading() || audio.isUploading() || artistImage.isUploading() || albumImage.isUploading()) NC.components.toast('Wait for all uploads to finish.', 'warning');
            return;
          }
          const button = modalRoot.querySelector('[data-save-track]'); NC.utils.setButtonLoading(button, true, 'Saving…');
          const image = cover.getValue();
          try {
            await NC.crud.save('music', record?.id, {
              title: data.title, bn_title: data.bn_title || '',
              artist: data.artist || '', bn_artist: data.bn_artist || '',
              album: data.album || '', bn_album: data.bn_album || '',
              genre: genres.getValue() || data.genre || '',
              description: data.description || '', lyrics: data.lyrics || '', video_link: videoLink,
              artist_image: artistImage.getValue().url || '', artist_description: data.artist_description || '',
              album_image: albumImage.getValue().url || '', album_description: data.album_description || '',
              thumbnail_url: image.url || '', imgbb_delete_url: image.delete_url || '',
              image_meta: { display_url: image.display_url || image.url || '', filename: image.filename || '', size: Number(image.size || 0), mime: image.mime || '', provider: image.provider || (image.url ? 'url' : ''), uploaded_at: image.uploaded_at || null },
              audio_url: audioValue.url, file_provider: audioValue.provider || 'url', file_storage_path: audioValue.path || '', file_size_mb: audioValue.size ? Number((audioValue.size / 1024 / 1024).toFixed(2)) : Number(record?.file_size_mb || 0), duration_seconds: audioValue.duration || Number(record?.duration_seconds || 0)
            });
            if (record?.file_storage_path && record.file_storage_path !== audioValue.path) {
              const result = await NC.api.deleteStorageObject(NC_CONFIG.supabase.musicBucket, record.file_storage_path);
              if (!result.ok) NC.components.toast('The track was saved, but the old audio file could not be removed from storage.', 'warning');
            }
            NC.components.toast(`Track ${record ? 'updated' : 'added'} successfully.`, 'success'); NC.components.closeModal(); await load();
          } catch (error) { console.error(error); NC.components.toast(NC.api.userMessage(error, 'Unable to save the track.'), 'error'); } finally { NC.utils.setButtonLoading(button, false); }
        });
      }
    });
  }

  async function remove(record) {
    try {
      const deleted = await NC.crud.deleteRecord({
        table: 'music', record, label: 'track', remoteDeleteUrls: [record.imgbb_delete_url],
        storageObjects: record.file_storage_path ? [{ bucket: NC_CONFIG.supabase.musicBucket, path: record.file_storage_path }] : []
      });
      if (deleted) await load();
    } catch (error) { console.error(error); NC.components.toast(NC.api.userMessage(error, 'Unable to delete the track.'), 'error'); }
  }

  async function load(context = {}) {
    const content = root.querySelector('[data-music-content]'); content.innerHTML = NC.components.skeleton(7, 5);
    try {
      const result = await NC.api.list('music', { select: '*', order: 'sort_order.asc,created_at.desc', limit: 2000 });
      if (NC.crud.isStaleNavigation(context)) return;
      state.setRecords(result.data); renderList();
      const action = context.params?.get('action'), id = context.params?.get('id');
      if (action === 'new') openForm();
      if (id && ['view', 'edit'].includes(action)) { const record = state.records.find((item) => item.id === id); if (record) action === 'view' ? openView(record) : openForm(record); }
    } catch (error) { NC.crud.handleLoadError(content, error, () => load(context), context); }
  }

  function render(container, context = {}) {
    root = container;
    root.innerHTML = `${NC.components.pageHeader({ eyebrow: 'Multimedia', title: 'Music', description: 'Upload MP3 tracks for the in-app player. Artist & Album are searchable comboboxes; placeholders show Bangla names with random colors.', breadcrumb: [{ label: 'Music' }], actions: `<button type="button" class="btn btn-secondary" data-import-json><i class="fa-regular fa-file-code" aria-hidden="true"></i>Import JSON</button><button type="button" class="btn btn-primary" data-add-track><i class="fa-regular fa-plus" aria-hidden="true"></i>Add track</button>` })}<section class="surface"><div class="list-toolbar"><label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search music</span><input type="search" placeholder="Search tracks (title, Bangla, artist, album)…" data-music-search></label><span class="field-hint" style="margin-left:auto">Placeholders = Bangla title/artist/album · random color</span></div><div data-music-content>${NC.components.skeleton(7, 5)}</div></section>`;
    root.querySelector('[data-add-track]').addEventListener('click', () => openForm());
    root.querySelector('[data-import-json]').addEventListener('click', () => openJsonImport());
    root.querySelector('[data-music-search]').addEventListener('input', debounce((event) => { state.setQuery(event.target.value); renderList(); }, 220));
    return load(context);
  }

  NC.views.music = { render };
})(window.NC);
