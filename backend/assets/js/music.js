(function (NC) {
  'use strict';

  const { escapeHTML, formatDate, formData, validateFields, debounce, safeImage, safeExternalUrl, isValidUrl } = NC.utils;
  const state = new NC.crud.ListState('music', { searchFields: ['title', 'bn_title', 'artist', 'bn_artist', 'album', 'bn_album', 'genre', 'description', 'video_link'], sortKey: 'created_at' });
  const GENRES = [
    'লোকগীতি', 'প্রেম', 'বিরহ', 'নৃত্য', 'পালা-কীর্তন', 'ভজন',
    'রাস', 'রাখুয়াল', 'আরতী', 'সরাত', 'ধ্রুমেল', 'হোলি কীর্তন',
    'পল্লী', 'আধ্যাত্মিক', 'উৎসব', 'দেশাত্মবোধক', 'শিশু',
    'ঐতিহ্যবাহী', 'আধুনিক', 'চলচ্চিত্র', 'ফোক-ফিউশন', 'রিমিক্স',
    'বাদ্যযন্ত্র', 'রক'
  ];
  let root;

  // Placeholder URLs — use NC.media placeholders if available, else fallback to placehold.co
  function getPlaceholder(kind) {
    if (NC.media && NC.media.placeholderFor) return NC.media.placeholderFor(kind);
    // fallback external placeholder (works when online)
    const map = {
      cover: 'https://placehold.co/400x400/EDE9FF/7C3AED?text=No+Cover',
      thumbnail: 'https://placehold.co/400x400/EDE9FF/7C3AED?text=No+Cover',
      artist: 'https://placehold.co/400x400/E0F2FE/0369A1?text=No+Artist',
      album: 'https://placehold.co/400x400/FEF3C7/B45309?text=No+Album'
    };
    return map[kind] || map.cover;
  }
  const PLACEHOLDERS = {
    cover: getPlaceholder('cover'),
    thumbnail: getPlaceholder('thumbnail'),
    artist: getPlaceholder('artist'),
    album: getPlaceholder('album')
  };

  function resolveCover(record) {
    return safeImage(record.thumbnail_url) || PLACEHOLDERS.cover;
  }
  function resolveArtistImage(record) {
    return safeImage(record.artist_image) || safeImage(record.thumbnail_url) || PLACEHOLDERS.artist;
  }
  function resolveAlbumImage(record) {
    return safeImage(record.album_image) || safeImage(record.thumbnail_url) || PLACEHOLDERS.album;
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

  function normalizeJsonRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    // accept both snake_case and camelCase + khallik legacy fields
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

    // Only require title + audio_url
    if (!title || !audio_url) return null;

    return {
      title,
      bn_title,
      artist,
      bn_artist,
      album,
      bn_album,
      genre,
      description,
      lyrics,
      video_link,
      thumbnail_url: thumbnail_url || PLACEHOLDERS.cover,
      artist_image: artist_image || '',
      artist_description: textVal(raw.artist_description || raw.artistDescription || raw.artist_bio || ''),
      album_image: album_image || '',
      album_description: textVal(raw.album_description || raw.albumDescription || raw.album_bio || ''),
      audio_url,
      file_provider,
      file_storage_path: textVal(raw.file_storage_path || raw.fileStoragePath || ''),
      file_size_mb: Number(raw.file_size_mb || raw.fileSizeMb || 0) || 0,
      duration_seconds: Number(raw.duration_seconds || raw.durationSeconds || raw.duration || 0) || 0,
      imgbb_delete_url: textVal(raw.imgbb_delete_url || ''),
      image_meta: raw.image_meta || {}
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
      // single object -> wrap
      if (parsed.title || parsed.audio_url || parsed.file_path) arr = [parsed];
      else {
        // maybe keyed object: { "song1": {...}, "song2": {...} }
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
    const modal = NC.components.openModal({
      title: 'Import music from JSON',
      eyebrow: 'Bulk upload',
      size: 'xl',
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
          const sample = [
            {
              title: 'Example Song',
              bn_title: 'উদাহরণ গান',
              artist: 'Example Artist',
              bn_artist: 'উদাহরণ শিল্পী',
              album: 'Example Album',
              bn_album: 'উদাহরণ অ্যালবাম',
              audio_url: 'https://example.com/song.mp3',
              thumbnail_url: 'https://example.com/cover.jpg',
              artist_image: 'https://example.com/artist.jpg',
              album_image: 'https://example.com/album.jpg',
              genre: 'ভজন, লোকগীতি',
              description: 'Optional description',
              lyrics: 'Optional lyrics',
              video_link: 'https://youtube.com/watch?v=...'
            }
          ];
          const blob = new Blob([JSON.stringify(sample, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'music-template.json'; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        modalRoot.querySelector('[data-json-template-download]')?.addEventListener('click', downloadTemplate);

        function renderPreview() {
          if (!jsonRecords.length) {
            preview.classList.add('hidden');
            status.classList.add('hidden');
            actions.classList.add('hidden');
            return;
          }
          preview.classList.remove('hidden');
          status.classList.remove('hidden');
          status.className = `notice ${invalidCount ? 'notice-warning' : 'notice-success'}`;
          status.innerHTML = `<i class="fa-regular fa-circle-info" aria-hidden="true"></i><p><strong>${validPayloads.length} valid</strong> · ${invalidCount} invalid/skipped · ${jsonRecords.length} total. Placeholders will be used for missing images.</p>`;

          const rows = validPayloads.slice(0, 100).map((payload, idx) => {
            const thumb = safeImage(payload.thumbnail_url) || PLACEHOLDERS.cover;
            const bnInfo = payload.bn_title ? ` <small style="color:var(--muted-foreground)">(${escapeHTML(payload.bn_title)})</small>` : '';
            return `<tr>
              <td>${idx + 1}</td>
              <td><div class="video-cell"><img src="${escapeHTML(thumb)}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:6px;" onerror="this.style.display='none'"><div><strong>${escapeHTML(payload.title)}</strong>${bnInfo}<small>${escapeHTML([payload.artist, payload.bn_artist].filter(Boolean).join(' · ') || payload.album || '')}</small></div></div></td>
              <td>${escapeHTML(payload.audio_url.slice(0, 48))}${payload.audio_url.length > 48 ? '…' : ''}</td>
              <td><span class="import-status is-valid"><i class="fa-solid fa-circle-check"></i>Ready</span></td>
            </tr>`;
          }).join('');
          const invalidRows = invalidCount ? `<tr><td colspan="4" class="text-center text-muted-foreground">${invalidCount} record(s) skipped (missing title or audio_url)</td></tr>` : '';
          output.innerHTML = `<div class="import-preview-wrap"><table class="data-table import-preview-table"><thead><tr><th>#</th><th>Track</th><th>Audio</th><th>Status</th></tr></thead><tbody>${rows}${invalidRows}</tbody></table></div>${jsonRecords.length > 100 ? `<p class="field-hint mt-2">Showing first 100 of ${jsonRecords.length}.</p>` : ''}`;
          hint.textContent = `${validPayloads.length} ready to import · Missing images will show placeholders`;
          actions.classList.remove('hidden');
          importBtn.innerHTML = `<i class="fa-regular fa-file-import" aria-hidden="true"></i>Import ${validPayloads.length} songs`;
          importBtn.disabled = validPayloads.length === 0;
        }

        async function processFile(file) {
          if (!file) return;
          output.innerHTML = `<div class="import-loading"><i class="fa-regular fa-spinner-third fa-spin" aria-hidden="true"></i><p>Reading JSON…</p></div>`;
          try {
            const text = await file.text();
            jsonRecords = parseJsonImportFile(text);
            validPayloads = [];
            invalidCount = 0;
            jsonRecords.forEach((raw) => {
              const norm = normalizeJsonRecord(raw);
              if (norm) validPayloads.push(norm);
              else invalidCount += 1;
            });
            renderPreview();
            if (!validPayloads.length) NC.components.toast('No valid songs found. Each needs title + audio_url/file_path.', 'error');
            else NC.components.toast(`${validPayloads.length} valid songs detected.`, 'success');
          } catch (e) {
            output.innerHTML = `<div class="import-error"><i class="fa-solid fa-file-circle-exclamation"></i><h3>Could not read JSON</h3><p>${escapeHTML(e.message)}</p></div>`;
            NC.components.toast(e.message, 'error');
          } finally {
            input.value = '';
          }
        }

        input.addEventListener('change', () => processFile(input.files?.[0]));
        dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
        ['dragenter', 'dragover'].forEach((n) => dropZone.addEventListener(n, (e) => { e.preventDefault(); dropZone.classList.add('is-dragging'); }));
        ['dragleave', 'drop'].forEach((n) => dropZone.addEventListener(n, (e) => { e.preventDefault(); dropZone.classList.remove('is-dragging'); }));
        dropZone.addEventListener('drop', (e) => processFile(e.dataTransfer?.files?.[0]));

        importBtn.addEventListener('click', async () => {
          if (!validPayloads.length) return;
          importBtn.disabled = true;
          output.innerHTML = `<div class="import-progress-panel"><div><i class="fa-regular fa-spinner-third fa-spin"></i><span><strong>Importing ${validPayloads.length} songs…</strong><small data-json-progress-label>0 of ${validPayloads.length}</small></span></div><div class="upload-progress"><div class="upload-progress-track"><span data-json-progress-bar></span></div><span data-json-progress-percent>0%</span></div></div>`;
          const bar = output.querySelector('[data-json-progress-bar]');
          const pct = output.querySelector('[data-json-progress-percent]');
          const label = output.querySelector('[data-json-progress-label]');
          let cursor = 0, completed = 0, imported = 0, failed = 0;
          const results = [];
          async function worker() {
            while (cursor < validPayloads.length) {
              const item = validPayloads[cursor]; cursor += 1;
              try {
                const rec = await NC.api.insert('music', item);
                results.push({ status: 'imported', item, rec }); imported += 1;
              } catch (err) {
                results.push({ status: 'failed', item, err }); failed += 1;
              }
              completed += 1;
              const p = Math.round((completed / validPayloads.length) * 100);
              bar.style.width = p + '%'; pct.textContent = p + '%';
              label.textContent = `${completed} of ${validPayloads.length} · ${imported} imported${failed ? ` · ${failed} failed` : ''}`;
            }
          }
          await Promise.all(Array.from({ length: Math.min(4, validPayloads.length) }, worker));
          output.innerHTML = `<div class="import-complete ${failed ? 'has-failures' : ''}"><span><i class="fa-solid ${failed ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i></span><div><h3>${failed ? 'Completed with errors' : 'Import completed'}</h3><p>${imported} imported · ${failed} failed · ${invalidCount} skipped.</p></div></div>`;
          if (imported) { NC.components.toast(`${imported} songs imported.`, 'success'); await load(); }
          if (failed) NC.components.toast(`${failed} failed to import.`, 'error');
        });
      }
    });
    return modal;
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
      // Show bn_title as secondary if present
      const displayTitle = record.bn_title ? `${record.title} · ${record.bn_title}` : record.title;
      return `
        <tr>
          <td data-label="Track"><div class="video-cell"><img src="${escapeHTML(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" style="width:44px;height:44px;object-fit:cover;border-radius:8px;background:var(--surface-subtle)" onerror="this.src='${PLACEHOLDERS.cover}'"><div><strong>${escapeHTML(displayTitle)}</strong><small>${escapeHTML(subtitleParts.join(' · ') || record.description || '')}</small></div></div></td>
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
      eyebrow: [record.artist, record.bn_artist, record.album, record.bn_album].filter(Boolean).join(' · ') || 'Music',
      size: 'lg',
      content: `
        <div class="grid gap-4">
          <div class="flex gap-4 items-start flex-wrap">
            <img src="${escapeHTML(cover)}" alt="Cover" style="width:120px;height:120px;object-fit:cover;border-radius:16px;" referrerpolicy="no-referrer" onerror="this.src='${PLACEHOLDERS.cover}'">
            <div class="grid gap-3">
              <div class="flex gap-2 items-center flex-wrap">
                <img src="${escapeHTML(artistImg)}" alt="Artist" style="width:48px;height:48px;object-fit:cover;border-radius:50%;border:1px solid var(--border)" referrerpolicy="no-referrer" onerror="this.src='${PLACEHOLDERS.artist}'">
                <div><strong>${escapeHTML(record.artist || 'Unknown artist')}</strong>${record.bn_artist ? `<small style="display:block;color:var(--muted-foreground)">${escapeHTML(record.bn_artist)}</small>` : ''}</div>
              </div>
              <div class="flex gap-2 items-center flex-wrap">
                <img src="${escapeHTML(albumImg)}" alt="Album" style="width:48px;height:48px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" referrerpolicy="no-referrer" onerror="this.src='${PLACEHOLDERS.album}'">
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
    NC.components.openModal({
      title: record ? 'Edit track' : 'Add track', eyebrow: 'Music library', size: 'xl',
      description: 'Upload an MP3 to Supabase Storage so the app streams a lasting public URL. Add Bangla titles for bilingual display; placeholders are shown when images are left empty.',
      content: `<form id="music-form" class="form-stack" novalidate>
        <div class="form-grid-2">
          <div class="field"><label class="field-label" for="track-title">Title <span aria-hidden="true">*</span></label><input class="form-input" id="track-title" name="title" value="${escapeHTML(record?.title || '')}" autofocus><p class="field-error hidden" data-field-error="title"></p></div>
          <div class="field"><label class="field-label" for="track-bn-title">Bangla Title (bn_title)</label><input class="form-input" id="track-bn-title" name="bn_title" value="${escapeHTML(record?.bn_title || '')}" placeholder="বাংলা শিরোনাম"><p class="field-hint">Appears with the English title in the app.</p></div>
        </div>
        <div class="form-grid-2">
          <div class="field"><label class="field-label" for="track-artist">Artist</label><input class="form-input" id="track-artist" name="artist" value="${escapeHTML(record?.artist || '')}"></div>
          <div class="field"><label class="field-label" for="track-bn-artist">Bangla Artist (bn_artist)</label><input class="form-input" id="track-bn-artist" name="bn_artist" value="${escapeHTML(record?.bn_artist || '')}" placeholder="বাংলা শিল্পী"></div>
        </div>
        <div class="form-grid-2">
          <div class="field"><label class="field-label" for="track-album">Album</label><input class="form-input" id="track-album" name="album" value="${escapeHTML(record?.album || '')}"></div>
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
        ${NC.media.imageUploaderHTML({ id: 'track-cover', label: 'Cover / thumbnail', hint: 'Square artwork looks best in the mini player and notification. Placeholder shown if empty.', placeholder: PLACEHOLDERS.cover })}
        ${NC.media.imageUploaderHTML({ id: 'track-artist-image', label: 'Artist image', hint: 'Shown on the artist page in the app. Falls back to cover if empty; placeholder if both empty.', placeholder: PLACEHOLDERS.artist })}
        <div class="field"><label class="field-label" for="track-artist-description">Artist description</label><textarea class="form-textarea min-h-28" id="track-artist-description" name="artist_description" placeholder="Short bio for the artist page.">${escapeHTML(record?.artist_description || '')}</textarea></div>
        ${NC.media.imageUploaderHTML({ id: 'track-album-image', label: 'Album image', hint: 'Shown on the album page in the app. Falls back to cover if empty; placeholder if both empty.', placeholder: PLACEHOLDERS.album })}
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
        const cover = NC.media.mountImageUploader(modalRoot.querySelector('#track-cover'), {
          initial: record ? { url: record.thumbnail_url, delete_url: record.imgbb_delete_url, ...record.image_meta } : null,
          placeholder: PLACEHOLDERS.cover
        });
        const artistImage = NC.media.mountImageUploader(modalRoot.querySelector('#track-artist-image'), {
          initial: record?.artist_image ? { url: record.artist_image } : null,
          placeholder: PLACEHOLDERS.artist
        });
        const albumImage = NC.media.mountImageUploader(modalRoot.querySelector('#track-album-image'), {
          initial: record?.album_image ? { url: record.album_image } : null,
          placeholder: PLACEHOLDERS.album
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
              title: data.title,
              bn_title: data.bn_title || '',
              artist: data.artist || '',
              bn_artist: data.bn_artist || '',
              album: data.album || '',
              bn_album: data.bn_album || '',
              genre: genres.getValue() || data.genre || '',
              description: data.description || '',
              lyrics: data.lyrics || '',
              video_link: videoLink,
              artist_image: artistImage.getValue().url || '',
              artist_description: data.artist_description || '',
              album_image: albumImage.getValue().url || '',
              album_description: data.album_description || '',
              thumbnail_url: image.url || '',
              imgbb_delete_url: image.delete_url || '',
              image_meta: {
                display_url: image.display_url || image.url || '',
                filename: image.filename || '',
                size: Number(image.size || 0),
                mime: image.mime || '',
                provider: image.provider || (image.url ? 'url' : ''),
                uploaded_at: image.uploaded_at || null
              },
              audio_url: audioValue.url,
              file_provider: audioValue.provider || 'url',
              file_storage_path: audioValue.path || '',
              file_size_mb: audioValue.size ? Number((audioValue.size / 1024 / 1024).toFixed(2)) : Number(record?.file_size_mb || 0),
              duration_seconds: audioValue.duration || Number(record?.duration_seconds || 0)
            });
            if (record?.file_storage_path && record.file_storage_path !== audioValue.path) {
              const result = await NC.api.deleteStorageObject(NC_CONFIG.supabase.musicBucket, record.file_storage_path);
              if (!result.ok) NC.components.toast('The track was saved, but the old audio file could not be removed from storage.', 'warning');
            }
            NC.components.toast(`Track ${record ? 'updated' : 'added'} successfully.`, 'success'); NC.components.closeModal(); await load();
          } catch (error) {
            console.error(error); NC.components.toast(NC.api.userMessage(error, 'Unable to save the track.'), 'error');
          } finally { NC.utils.setButtonLoading(button, false); }
        });
      }
    });
  }

  async function remove(record) {
    try {
      const deleted = await NC.crud.deleteRecord({
        table: 'music',
        record,
        label: 'track',
        remoteDeleteUrls: [record.imgbb_delete_url],
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
    root.innerHTML = `${NC.components.pageHeader({ eyebrow: 'Multimedia', title: 'Music', description: 'Upload MP3 tracks for the in-app player, mini bar, and notification controls. Now with Bangla titles and bulk JSON import.', breadcrumb: [{ label: 'Music' }], actions: `<button type="button" class="btn btn-secondary" data-import-json><i class="fa-regular fa-file-code" aria-hidden="true"></i>Import JSON</button><button type="button" class="btn btn-primary" data-add-track><i class="fa-regular fa-plus" aria-hidden="true"></i>Add track</button>` })}<section class="surface"><div class="list-toolbar"><label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search music</span><input type="search" placeholder="Search tracks (title, Bangla, artist, album)…" data-music-search></label><span class="field-hint" style="margin-left:auto">Placeholders shown when cover/artist/album images are empty</span></div><div data-music-content>${NC.components.skeleton(7, 5)}</div></section>`;
    root.querySelector('[data-add-track]').addEventListener('click', () => openForm());
    root.querySelector('[data-import-json]').addEventListener('click', () => openJsonImport());
    root.querySelector('[data-music-search]').addEventListener('input', debounce((event) => { state.setQuery(event.target.value); renderList(); }, 220));
    return load(context);
  }

  NC.views.music = { render };
})(window.NC);
