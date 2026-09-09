(function (NC) {
  'use strict';

  const { escapeHTML, formatDate, formData, validateFields, debounce, safeImage } = NC.utils;
  const state = new NC.crud.ListState('music', { searchFields: ['title', 'artist', 'album', 'genre', 'description', 'video_link'], sortKey: 'created_at' });
  const GENRES = [
    'লোকগীতি', 'প্রেম', 'বিরহ', 'নৃত্য', 'পালা-কীর্তন', 'ভজন',
    'রাস', 'রাখুয়াল', 'আরতী', 'সরাত', 'ধ্রুমেল', 'হোলি কীর্তন',
    'পল্লী', 'আধ্যাত্মিক', 'উৎসব', 'দেশাত্মবোধক', 'শিশু',
    'ঐতিহ্যবাহী', 'আধুনিক', 'চলচ্চিত্র', 'ফোক-ফিউশন', 'রিমিক্স',
    'বাদ্যযন্ত্র', 'রক'
  ];
  let root;

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

  function renderList() {
    const content = root.querySelector('[data-music-content]');
    const { rows, total } = state.paged();
    if (!total) {
      content.innerHTML = NC.components.emptyState({
        icon: 'fa-music', title: state.query ? 'No tracks match your search' : 'Add the first song',
        description: state.query ? 'Try a different title or artist.' : 'Upload MP3 files so the app music player can stream them.',
        action: state.query ? '' : '<button type="button" class="btn btn-primary" data-add-track><i class="fa-regular fa-plus" aria-hidden="true"></i>Add track</button>'
      }); bindEvents(content); return;
    }
    const body = rows.map((record) => {
      const thumbnail = safeImage(record.thumbnail_url);
      return `
        <tr>
          <td data-label="Track"><div class="video-cell">${thumbnail ? `<img src="${escapeHTML(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-image-fallback>` : `<span><i class="fa-regular fa-music" aria-hidden="true"></i></span>`}<div><strong>${escapeHTML(record.title)}</strong><small>${escapeHTML([record.artist, record.album].filter(Boolean).join(' · ') || record.description || '')}</small></div></div></td>
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
    scope.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
      const record = state.records.find((item) => item.id === button.dataset.id); if (!record) return;
      if (button.dataset.action === 'view') openView(record);
      if (button.dataset.action === 'edit') openForm(record);
      if (button.dataset.action === 'delete') remove(record);
    }));
    NC.crud.bindPagination(root, state, renderList);
  }

  function openView(record) {
    NC.components.openModal({
      title: record.title, eyebrow: [record.artist, record.album].filter(Boolean).join(' · ') || 'Music', size: 'lg',
      content: `${record.thumbnail_url ? `<img src="${escapeHTML(record.thumbnail_url)}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:16px;margin-bottom:16px;" referrerpolicy="no-referrer">` : ''}<audio controls preload="metadata" src="${escapeHTML(record.audio_url)}" style="width:100%"></audio>${record.video_link ? `<div class="mt-5">${NC.media.videoPreviewHTML(record.video_link, { title: record.title })}</div>` : ''}${record.description ? `<div class="prose-content mt-5"><p>${escapeHTML(record.description)}</p></div>` : ''}`,
      footer: '<button type="button" class="btn btn-secondary" data-modal-close>Close</button><button type="button" class="btn btn-primary" data-track-edit><i class="fa-regular fa-pen" aria-hidden="true"></i>Edit track</button>',
      onOpen: (modalRoot) => modalRoot.querySelector('[data-track-edit]').addEventListener('click', () => { NC.components.closeModal(); window.setTimeout(() => openForm(record), 180); })
    });
  }

  function openForm(record = null) {
    NC.components.openModal({
      title: record ? 'Edit track' : 'Add track', eyebrow: 'Music library', size: 'xl',
      description: 'Upload an MP3 via Catbox so the app gets a lasting public URL (not a 15-minute signed link).',
      content: `<form id="music-form" class="form-stack" novalidate>
        <div class="form-grid-2">
          <div class="field"><label class="field-label" for="track-title">Title <span aria-hidden="true">*</span></label><input class="form-input" id="track-title" name="title" value="${escapeHTML(record?.title || '')}" autofocus><p class="field-error hidden" data-field-error="title"></p></div>
          <div class="field"><label class="field-label" for="track-artist">Artist</label><input class="form-input" id="track-artist" name="artist" value="${escapeHTML(record?.artist || '')}"></div>
        </div>
        <div class="form-grid-2">
          <div class="field"><label class="field-label" for="track-album">Album</label><input class="form-input" id="track-album" name="album" value="${escapeHTML(record?.album || '')}"></div>
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
        ${NC.media.imageUploaderHTML({ id: 'track-cover', label: 'Cover / thumbnail', hint: 'Square artwork looks best in the mini player and notification.' })}
        ${NC.media.audioUploaderHTML({ id: 'track-audio', label: 'MP3 file' })}
        <div class="field"><label class="field-label" for="track-video">Video link</label><input class="form-input" type="url" id="track-video" name="video_link" value="${escapeHTML(record?.video_link || '')}" placeholder="YouTube, Facebook, Veome Video Link Here"><p class="field-error hidden" data-field-error="video_link"></p><span class="field-hint">Optional. YouTube, Facebook, or Vimeo. Paste a URL to preview it below.</span></div>
        <div data-track-video-preview class="mt-2">${record?.video_link ? NC.media.videoPreviewHTML(record.video_link, { title: record.title }) : ''}</div>
        <div class="field"><label class="field-label" for="track-description">Description</label><textarea class="form-textarea min-h-28" id="track-description" name="description">${escapeHTML(record?.description || '')}</textarea></div>
        <div class="field"><label class="field-label" for="track-lyrics">Lyrics</label><textarea class="form-textarea min-h-40" id="track-lyrics" name="lyrics" placeholder="Optional. Shown in the app player.">${escapeHTML(record?.lyrics || '')}</textarea></div>
      </form>`,
      footer: `<button type="button" class="btn btn-secondary" data-modal-close>Cancel</button><button type="submit" form="music-form" class="btn btn-primary" data-save-track><i class="fa-regular fa-floppy-disk" aria-hidden="true"></i>${record ? 'Save changes' : 'Add track'}</button>`,
      onOpen: (modalRoot) => {
        const form = modalRoot.querySelector('#music-form');
        const cover = NC.media.mountImageUploader(modalRoot, {
          initial: record ? { url: record.thumbnail_url, delete_url: record.imgbb_delete_url, ...record.image_meta } : null
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
          if (!validateFields(form, errors) || !audio.validate() || cover.isUploading() || audio.isUploading()) {
            if (cover.isUploading() || audio.isUploading()) NC.components.toast('Wait for all uploads to finish.', 'warning');
            return;
          }
          const button = modalRoot.querySelector('[data-save-track]'); NC.utils.setButtonLoading(button, true, 'Saving…');
          const image = cover.getValue();
          try {
            await NC.crud.save('music', record?.id, {
              title: data.title,
              artist: data.artist,
              album: data.album,
              genre: genres.getValue() || data.genre || '',
              description: data.description,
              lyrics: data.lyrics || '',
              video_link: videoLink,
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
    root.innerHTML = `${NC.components.pageHeader({ eyebrow: 'Multimedia', title: 'Music', description: 'Upload MP3 tracks for the in-app player, mini bar, and notification controls.', breadcrumb: [{ label: 'Music' }], actions: `<button type="button" class="btn btn-primary" data-add-track><i class="fa-regular fa-plus" aria-hidden="true"></i>Add track</button>` })}<section class="surface"><div class="list-toolbar"><label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search music</span><input type="search" placeholder="Search tracks…" data-music-search></label></div><div data-music-content>${NC.components.skeleton(7, 5)}</div></section>`;
    root.querySelector('[data-add-track]').addEventListener('click', () => openForm());
    root.querySelector('[data-music-search]').addEventListener('input', debounce((event) => { state.setQuery(event.target.value); renderList(); }, 220));
    return load(context);
  }

  NC.views.music = { render };
})(window.NC);
