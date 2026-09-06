(function (NC) {
  'use strict';

  class ListState {
    constructor(key, options = {}) {
      this.key = key;
      this.records = [];
      this.query = '';
      this.page = 1;
      this.pageSize = Number(NC.utils.readPreference('items-per-page', NC_CONFIG.app.defaultPageSize));
      this.sortKey = options.sortKey || 'created_at';
      this.sortDirection = options.sortDirection || 'desc';
      this.filters = {};
      this.searchFields = options.searchFields || ['title'];
    }

    setRecords(records) {
      this.records = Array.isArray(records) ? records : [];
      const pages = Math.max(1, Math.ceil(this.filtered().length / this.pageSize));
      if (this.page > pages) this.page = pages;
      return this;
    }

    setQuery(value) {
      this.query = String(value || '').trim().toLocaleLowerCase();
      this.page = 1;
      return this;
    }

    setFilter(key, value) {
      this.filters[key] = value;
      this.page = 1;
      return this;
    }

    setSort(key, direction) {
      if (this.sortKey === key && !direction) this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      else {
        this.sortKey = key;
        this.sortDirection = direction || 'asc';
      }
      this.page = 1;
      return this;
    }

    filtered(extraPredicate) {
      const query = this.query;
      const filters = this.filters;
      const rows = this.records.filter((record) => {
        if (query) {
          const searchable = this.searchFields.map((field) => {
            const value = record[field];
            return Array.isArray(value) ? value.join(' ') : String(value ?? '');
          }).join(' ').toLocaleLowerCase();
          if (!searchable.includes(query)) return false;
        }
        for (const [key, expected] of Object.entries(filters)) {
          if (expected === '' || expected === 'all' || expected == null) continue;
          const actual = record[key];
          if (typeof expected === 'function') {
            if (!expected(actual, record)) return false;
          } else if (String(actual).toLocaleLowerCase() !== String(expected).toLocaleLowerCase()) return false;
        }
        return extraPredicate ? extraPredicate(record) : true;
      });
      return NC.utils.sortRecords(rows, this.sortKey, this.sortDirection);
    }

    paged(extraPredicate) {
      const preferredSize = Number(NC.utils.readPreference('items-per-page', this.pageSize));
      if ([10, 20, 30, 50].includes(preferredSize)) this.pageSize = preferredSize;
      const rows = this.filtered(extraPredicate);
      const total = rows.length;
      const pages = Math.max(1, Math.ceil(total / this.pageSize));
      this.page = Math.min(Math.max(1, this.page), pages);
      const start = (this.page - 1) * this.pageSize;
      return { rows: rows.slice(start, start + this.pageSize), total, pages, page: this.page };
    }
  }

  function bindPagination(root, state, render) {
    root.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => {
      const page = Number(button.dataset.page);
      if (!Number.isFinite(page) || page < 1) return;
      state.page = page;
      render();
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  function bindSort(root, state, render) {
    root.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => {
      state.setSort(button.dataset.sort);
      render();
    }));
  }

  function sortIcon(state, key) {
    if (state.sortKey !== key) return '<i class="fa-regular fa-sort text-faint" aria-hidden="true"></i>';
    return `<i class="fa-regular ${state.sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down'}" aria-hidden="true"></i>`;
  }

  async function save(table, id, payload) {
    return id ? NC.api.update(table, id, payload) : NC.api.insert(table, payload);
  }

  async function deleteRecord({ table, record, label, remoteDeleteUrls = [], storageObjects = [] }) {
    const accepted = await NC.components.confirm({
      title: `Delete ${label}?`,
      description: `“${record.title || record.name || 'This record'}” will be permanently removed. This action cannot be undone.`,
      details: remoteDeleteUrls.filter(Boolean).length
        ? 'The dashboard will also attempt to remove associated ImgBB media after the database record is deleted.'
        : '',
      confirmLabel: `Delete ${label}`
    });
    if (!accepted) return false;

    await NC.api.remove(table, record.id);
    const remoteResults = await Promise.all(remoteDeleteUrls.filter(Boolean).map((url) => NC.api.attemptImgBBDelete(url)));
    remoteResults.forEach(NC.components.remoteDeleteWarning);
    const storageResults = await Promise.all(storageObjects.filter((item) => item?.path).map((item) => NC.api.deleteStorageObject(item.bucket, item.path)));
    if (storageResults.some((result) => !result.ok)) {
      NC.components.toast('The record was deleted, but a stored file could not be removed. Review Supabase Storage.', 'warning');
    }
    NC.components.toast(`${label} deleted successfully.`, 'success');
    return true;
  }

  async function deleteReplacedMedia(oldMedia, newMedia) {
    if (!oldMedia?.delete_url || oldMedia.delete_url === newMedia?.delete_url) return;
    const result = await NC.api.attemptImgBBDelete(oldMedia.delete_url);
    NC.components.remoteDeleteWarning(result, 'The record was saved, but ImgBB did not confirm deletion of the replaced image. Use the saved deletion page to finish manually.');
  }

  async function deleteMediaRecords(records = [], warningMessage = '') {
    const urls = [...new Set(records.map((record) => typeof record === 'string' ? record : record?.delete_url || record?.imgbb_delete_url).filter(Boolean))];
    if (!urls.length) return [];
    const results = await Promise.all(urls.map((url) => NC.api.attemptImgBBDelete(url)));
    results.forEach((result) => NC.components.remoteDeleteWarning(result, warningMessage || 'ImgBB did not confirm deletion of an unused image. Use the saved deletion page to finish manually.'));
    return results;
  }

  function imagePayload(media) {
    return {
      image: media?.url || '',
      imgbb_delete_url: media?.delete_url || '',
      image_meta: {
        display_url: media?.display_url || media?.url || '',
        filename: media?.filename || '',
        size: Number(media?.size || 0),
        mime: media?.mime || '',
        provider: media?.provider || (media?.url ? 'url' : ''),
        uploaded_at: media?.uploaded_at || null
      }
    };
  }

  /**
   * Toolbar <select> filled from a list of { value, label, count } options.
   * Options: { attr, label, placeholder, selected, wide, countLabel }.
   */
  function filterSelect(options, { attr, label, placeholder = 'All', selected = 'all', wide = false } = {}) {
    const { escapeHTML } = NC.utils;
    const rows = options.map((item) => {
      const value = String(item.value);
      const count = Number.isFinite(item.count) ? ` (${Number(item.count).toLocaleString()})` : '';
      return `<option value="${escapeHTML(value)}" ${value === String(selected) ? 'selected' : ''}>${escapeHTML(item.label)}${escapeHTML(count)}</option>`;
    }).join('');
    return `<select class="form-select toolbar-select${wide ? ' toolbar-select-wide' : ''}" ${attr} aria-label="${escapeHTML(label)}"><option value="all">${escapeHTML(placeholder)}</option>${rows}</select>`;
  }

  /**
   * Renders the "Filters: [chip ×] [chip ×] Clear all" strip inside `host`.
   * `chips` is [{ key, label, value }]. onRemove(key) and onClear() re-render.
   */
  function renderActiveFilters(host, chips, { onRemove, onClear } = {}) {
    if (!host) return;
    const { escapeHTML } = NC.utils;
    const active = chips.filter((chip) => chip && chip.value);
    if (!active.length) { host.innerHTML = ''; host.classList.add('hidden'); return; }
    host.classList.remove('hidden');
    host.innerHTML = `<span class="active-filters-label">Filters</span>${active.map((chip) => `
      <span class="filter-chip"><small>${escapeHTML(chip.label)}:</small>${escapeHTML(chip.value)}<button type="button" data-filter-remove="${escapeHTML(chip.key)}" aria-label="Remove ${escapeHTML(chip.label)} filter"><i class="fa-regular fa-xmark" aria-hidden="true"></i></button></span>`).join('')}
      ${active.length > 1 ? '<button type="button" class="filter-chip-clear" data-filter-clear>Clear all</button>' : ''}`;
    host.querySelectorAll('[data-filter-remove]').forEach((button) => button.addEventListener('click', () => onRemove?.(button.dataset.filterRemove)));
    host.querySelector('[data-filter-clear]')?.addEventListener('click', () => onClear?.());
  }

  /** Small tag chip list for table cells. Issue tags are highlighted; extra tags collapse into "+N". */
  function tagChips(tags, { max = 3, attr = 'data-tag-filter' } = {}) {
    const { escapeHTML } = NC.utils;
    const list = NC.tags.tagsOf(tags);
    if (!list.length) return '';
    const sorted = [...list].sort((a, b) => Number(NC.tags.isIssue(b)) - Number(NC.tags.isIssue(a)));
    const shown = sorted.slice(0, max);
    const rest = sorted.length - shown.length;
    return `<div class="tag-chips">${shown.map((tag) => {
      const issue = NC.tags.isIssue(tag);
      return `<button type="button" class="tag-chip${issue ? ' is-issue' : ''}" ${attr}="${escapeHTML(NC.tags.keyOf(tag))}" title="Filter by ${escapeHTML(NC.tags.displayLabel(tag))}">${issue ? '<i class="fa-solid fa-calendar" aria-hidden="true"></i>' : '#'}${escapeHTML(NC.tags.displayLabel(tag))}</button>`;
    }).join('')}${rest > 0 ? `<span class="tag-chip is-more" title="${escapeHTML(sorted.slice(max).map(NC.tags.displayLabel).join(', '))}">+${rest}</span>` : ''}</div>`;
  }

  function isStaleNavigation(context = {}) {
    return Boolean(context.navigationId && context.navigationId !== NC.state.navigationId);
  }

  function handleLoadError(container, error, retry, context = {}) {
    if (isStaleNavigation(context)) return;
    console.error(error);
    container.innerHTML = NC.components.errorState(error);
    container.querySelector('[data-retry]')?.addEventListener('click', retry);
  }

  NC.crud = Object.freeze({
    ListState, bindPagination, bindSort, sortIcon, save, deleteRecord,
    deleteReplacedMedia, deleteMediaRecords, imagePayload, handleLoadError, isStaleNavigation,
    filterSelect, renderActiveFilters, tagChips
  });
})(window.NC);
