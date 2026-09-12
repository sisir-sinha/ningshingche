(function (NC) {
  'use strict';

  /**
   * The forum, in the dashboard (route `forum`).
   *
   * The app's forum is written by readers and answered by readers; the dashboard
   * is where it is read back and moderated. The page follows the house pattern of
   * the other list screens — fetch, filter, sort, paginate, act in a modal — and
   * it follows the database's rules rather than inventing any:
   *
   *  * The three doors are the tables `forum_categories`, `forum_discussions` and
   *    `forum_replies`. Migration 029 grants the dashboard `select` on each and
   *    writes a dashboard-level RLS policy on it, which is what lets this page see
   *    a hidden thread at all: the app reads through the `forum_*` RPCs, and those
   *    never show one.
   *  * A reader's post is HTML, and **none of it is rendered here**. The body is
   *    shown as text through `stripHTML`, which sanitises before it takes the text
   *    out; the links inside it are listed as attachments, because that is where
   *    the app keeps a picture or a PDF. A moderator reads what the reader wrote,
   *    not what their markup would do.
   *  * Hiding is `status = 'Unpublish'`, the same column the app's RPCs filter on,
   *    and restoring is the same write the other way. Nothing else about a post is
   *    ever edited from here: the dashboard does not rewrite a reader's words.
   *
   * Needs jsdom and skips itself without it (see languages-page.test.cjs):
   *     npm install --no-save jsdom && node --test backend/tests/
   */

  const {
    escapeHTML, formatDateTime, relativeTime, truncate, debounce, number,
    stripHTML, sanitizeHTML, safeImage, safeExternalUrl, initials
  } = NC.utils;

  const state = new NC.crud.ListState('forum', {
    searchFields: ['title', 'body_text', 'author_name', 'category_title'],
    sortKey: 'created_at'
  });
  const filterValues = { status: 'all', category_id: 'all', answers: 'all' };
  let root;
  let categories = [];
  /** id → name, read once per load: threads *and* answers are signed with it. */
  let readers = new Map();

  // ---------------------------------------------------------------------------
  // The reader's post, as text
  // ---------------------------------------------------------------------------

  /** Block tags become line breaks, then everything becomes text. Nothing renders. */
  function bodyLines(body) {
    const spaced = String(body || '').replace(
      /<\s*\/?\s*(?:br|p|div|li|ul|ol|h[1-6]|blockquote|tr)\b[^>]*>/gi,
      '\n'
    );
    return stripHTML(spaced).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  }

  /** The links a reader attached: the app puts pictures and PDFs in the markup. */
  function bodyLinks(body) {
    const node = document.createElement('div');
    node.innerHTML = sanitizeHTML(body);
    return Array.from(node.querySelectorAll('a[href]')).map((anchor) => {
      const href = safeExternalUrl(anchor.getAttribute('href'));
      const name = (anchor.textContent || '').trim() || href;
      return { href, name };
    }).filter((link) => link.href);
  }

  function paragraphsHTML(lines, emptyText) {
    if (!lines.length) return `<p class="text-muted-foreground">${escapeHTML(emptyText)}</p>`;
    return lines.map((line) => `<p>${escapeHTML(line)}</p>`).join('');
  }

  function attachmentsHTML(links) {
    if (!links.length) return '';
    return `<div class="forum-attachments">${links.map((link) => `
      <a class="forum-attachment" href="${escapeHTML(link.href)}" target="_blank" rel="noopener noreferrer"><i class="fa-regular fa-paperclip" aria-hidden="true"></i>${escapeHTML(truncate(link.name, 60))}</a>`).join('')}</div>`;
  }

  // ---------------------------------------------------------------------------
  // Records
  // ---------------------------------------------------------------------------

  /** Every record carries what the list searches by, joined in one pass here. */
  function decorate(record, readers) {
    record.author_name = readers.get(record.user_id) || 'Registered reader';
    record.category_title = categories.find((item) => item.id === record.category_id)?.title || 'Uncategorised';
    record.body_text = stripHTML(record.body);
    return record;
  }

  /** An answer carries a reader's name as well — the same join, one line down. */
  function decorateAnswer(answer) {
    answer.author_name = readers.get(answer.user_id) || 'Registered reader';
    return answer;
  }

  const isHidden = (record) => record.status !== 'Publish';
  const isWaiting = (record) => !isHidden(record) && Number(record.replies_count || 0) === 0;

  function syncStateFilters() {
    state.setFilter('status', filterValues.status);
    state.setFilter('category_id', filterValues.category_id);
    // A function filter: "waiting" is about the answer count *and* the status,
    // which no single column says on its own.
    state.setFilter('__answers', filterValues.answers === 'waiting'
      ? (_, record) => isWaiting(record)
      : (filterValues.answers === 'answered'
        ? (_, record) => !isHidden(record) && Number(record.replies_count || 0) > 0
        : 'all'));
  }

  function hasActiveFilters() {
    return Object.values(filterValues).some((value) => value && value !== 'all');
  }

  function applyFilter(key, value) {
    if (!(key in filterValues)) return;
    filterValues[key] = value || 'all';
    syncStateFilters();
    syncFilterControls();
    renderList();
  }

  function clearFilters() {
    Object.keys(filterValues).forEach((key) => { filterValues[key] = 'all'; });
    state.setQuery('');
    const search = root.querySelector('[data-forum-search]');
    if (search) search.value = '';
    syncStateFilters();
    syncFilterControls();
    renderList();
  }

  function syncFilterControls() {
    [['[data-forum-status]', 'status'], ['[data-forum-category]', 'category_id'], ['[data-forum-answers]', 'answers']].forEach(([selector, key]) => {
      const select = root.querySelector(selector);
      if (!select) return;
      const value = String(filterValues[key]);
      select.value = [...select.options].some((option) => option.value === value) ? value : 'all';
    });
  }

  function renderActiveFilters() {
    const host = root.querySelector('[data-forum-active-filters]');
    if (!host) return;
    NC.crud.renderActiveFilters(host, [
      { key: 'status', label: 'Status', value: filterValues.status === 'Unpublish' ? 'Hidden from readers' : (filterValues.status === 'Publish' ? 'Published' : '') },
      { key: 'category_id', label: 'Category', value: filterValues.category_id !== 'all' ? (categories.find((item) => item.id === filterValues.category_id)?.title || 'Unknown') : '' },
      { key: 'answers', label: 'Answers', value: filterValues.answers === 'waiting' ? 'Waiting for an answer' : (filterValues.answers === 'answered' ? 'Answered' : '') }
    ], { onRemove: (key) => applyFilter(key, 'all'), onClear: clearFilters });
  }

  function categoryOptions() {
    const counts = new Map();
    state.records.forEach((record) => {
      if (record.category_id) counts.set(record.category_id, (counts.get(record.category_id) || 0) + 1);
    });
    return categories
      .map((item) => ({ value: item.id, label: item.title || 'Untitled', count: counts.get(item.id) || 0 }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'bn'));
  }

  function fillCategorySelect() {
    const current = root.querySelector('[data-forum-category]');
    if (!current) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = NC.crud.filterSelect(categoryOptions(), {
      attr: 'data-forum-category',
      label: 'Filter by category',
      placeholder: 'All categories',
      selected: filterValues.category_id,
      wide: true
    });
    const next = wrapper.firstElementChild;
    current.replaceWith(next);
    next.addEventListener('change', (event) => applyFilter('category_id', event.target.value));
    syncFilterControls();
  }

  // ---------------------------------------------------------------------------
  // The list
  // ---------------------------------------------------------------------------

  function statsHTML() {
    const rows = state.records;
    const tiles = [
      ['Discussions', rows.length, ''],
      ['Answers', rows.reduce((sum, record) => sum + Number(record.replies_count || 0), 0), ''],
      ['Waiting for an answer', rows.filter(isWaiting).length, 'is-waiting'],
      ['Hidden from readers', rows.filter(isHidden).length, '']
    ];
    return tiles.map(([label, value, tone]) => `
      <div class="forum-stat ${tone}"><strong>${number(value)}</strong><span>${escapeHTML(label)}</span></div>`).join('');
  }

  function discussionRow(record) {
    const waiting = isWaiting(record);
    const links = bodyLinks(record.body).length;
    return `
      <tr>
        <td data-label="Discussion">
          <div class="stacked-cell">
            <button type="button" class="table-link line-clamp-2" data-action="view" data-id="${escapeHTML(record.id)}">${escapeHTML(record.title || 'Untitled discussion')}</button>
            <span>${escapeHTML(truncate(record.body_text, 96))}</span>
            <small>${escapeHTML(record.author_name)}${record.is_official ? ' · <i class="fa-regular fa-badge-check" aria-hidden="true"></i> Official' : ''}${links ? ` · ${number(links)} attachment${links === 1 ? '' : 's'}` : ''}</small>
          </div>
        </td>
        <td data-label="Category"><span class="role-name-badge"><i class="fa-regular fa-layer-group" aria-hidden="true"></i>${escapeHTML(record.category_title)}</span></td>
        <td data-label="Answers"><div class="stacked-cell"><strong>${number(record.replies_count || 0)}</strong>${waiting ? '<small class="text-warning">Waiting for an answer</small>' : ''}</div></td>
        <td data-label="Views">${number(record.views_count || 0)}</td>
        <td data-label="Status">${NC.components.statusBadge(record.status || 'Publish')}</td>
        <td data-label="Started"><time datetime="${escapeHTML(record.created_at || '')}">${escapeHTML(formatDateTime(record.created_at))}</time><small>${escapeHTML(relativeTime(record.last_reply_at || record.created_at))}</small></td>
        <td data-label="Actions" class="text-right">${NC.components.rowActions([
          { action: 'view', id: record.id, label: 'Read the discussion', icon: 'fa-eye' },
          { action: 'toggle', id: record.id, label: isHidden(record) ? 'Show to readers' : 'Hide from readers', icon: 'fa-eye-slash' },
          { action: 'delete', id: record.id, label: 'Delete discussion', icon: 'fa-trash', danger: true }
        ])}</td>
      </tr>`;
  }

  function renderList() {
    const content = root.querySelector('[data-forum-content]');
    const { rows, total } = state.paged();
    renderActiveFilters();
    if (!total) {
      const filtered = Boolean(state.query) || hasActiveFilters();
      content.innerHTML = NC.components.emptyState({
        icon: 'fa-comments',
        title: filtered ? 'No discussions match your search or filters' : 'The forum is quiet',
        description: filtered
          ? 'Try a different title, reader, category, or phrase.'
          : 'Discussions written in the app appear here, with the answers readers left on them.',
        action: filtered ? '<button type="button" class="btn btn-secondary" data-clear-forum-filters><i class="fa-regular fa-filter-slash" aria-hidden="true"></i>Clear filters</button>' : ''
      });
      bindListEvents(content);
      return;
    }
    content.innerHTML = `${NC.components.tableShell({
      caption: 'Forum discussions',
      minWidth: '1060px',
      head: `<tr><th>Discussion</th><th>Category</th><th><button type="button" data-sort="replies_count">Answers ${NC.crud.sortIcon(state, 'replies_count')}</button></th><th><button type="button" data-sort="views_count">Views ${NC.crud.sortIcon(state, 'views_count')}</button></th><th>Status</th><th><button type="button" data-sort="created_at">Started ${NC.crud.sortIcon(state, 'created_at')}</button></th><th class="text-right">Actions</th></tr>`,
      body: rows.map(discussionRow).join('')
    })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
    bindListEvents(content);
  }

  function bindListEvents(scope = root) {
    scope.querySelectorAll('[data-clear-forum-filters]').forEach((button) => button.addEventListener('click', clearFilters));
    scope.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
      const record = state.records.find((item) => item.id === button.dataset.id);
      if (!record) return;
      if (button.dataset.action === 'view') openView(record.id);
      if (button.dataset.action === 'toggle') toggleStatus(record, button);
      if (button.dataset.action === 'delete') remove(record);
    }));
    NC.crud.bindPagination(root, state, renderList);
    NC.crud.bindSort(root, state, renderList);
  }

  // ---------------------------------------------------------------------------
  // Reading one discussion
  // ---------------------------------------------------------------------------

  function answerHTML(answer) {
    const hidden = answer.status !== 'Publish';
    return `
      <article class="forum-answer ${hidden ? 'is-hidden' : ''}" data-answer="${escapeHTML(answer.id)}">
        <div class="forum-answer-head">
          <span class="user-avatar">${escapeHTML(initials(answer.author_name || 'Reader'))}</span>
          <span><strong>${escapeHTML(answer.author_name || 'Registered reader')}</strong><small>${escapeHTML(formatDateTime(answer.created_at))} · ${escapeHTML(relativeTime(answer.created_at))}</small></span>
          ${hidden ? NC.components.statusBadge('Unpublish') : ''}
          <span class="forum-answer-actions">
            <button type="button" class="row-action" data-answer-toggle="${escapeHTML(answer.id)}" aria-label="${hidden ? 'Show this answer' : 'Hide this answer'}" title="${hidden ? 'Show this answer' : 'Hide this answer'}"><i class="fa-regular fa-eye-slash" aria-hidden="true"></i></button>
            <button type="button" class="row-action row-action-danger" data-answer-delete="${escapeHTML(answer.id)}" aria-label="Delete this answer" title="Delete this answer"><i class="fa-regular fa-trash" aria-hidden="true"></i></button>
          </span>
        </div>
        <div class="forum-body">${paragraphsHTML(bodyLines(answer.body), 'This answer has no text.')}</div>
        ${attachmentsHTML(bodyLinks(answer.body))}
      </article>`;
  }

  async function openView(discussionId) {
    const record = state.records.find((item) => item.id === discussionId);
    if (!record) return;
    const cover = safeImage(record.cover_image_url);
    NC.components.openModal({
      title: record.title || 'Untitled discussion',
      eyebrow: 'Forum moderation',
      size: 'lg',
      content: `
        <div class="forum-thread">
          <dl class="details-grid mt-6">
            <div><dt>Category</dt><dd>${escapeHTML(record.category_title)}</dd></div>
            <div><dt>Started by</dt><dd>${escapeHTML(record.author_name)}</dd></div>
            <div><dt>Started</dt><dd>${escapeHTML(formatDateTime(record.created_at))}</dd></div>
            <div><dt>Last answer</dt><dd>${escapeHTML(record.last_reply_at ? relativeTime(record.last_reply_at) : 'No answer yet')}</dd></div>
            <div><dt>Views</dt><dd>${number(record.views_count || 0)}</dd></div>
            <div><dt>Answers</dt><dd data-answer-count>${number(record.replies_count || 0)}</dd></div>
            <div><dt>Status</dt><dd>${NC.components.statusBadge(record.status || 'Publish')}${record.is_official ? ' <span class="status-badge status-info"><i class="fa-regular fa-badge-check" aria-hidden="true"></i>Official</span>' : ''}</dd></div>
          </dl>
          ${cover ? `<img class="forum-cover" src="${escapeHTML(cover)}" alt="The cover the reader attached" loading="lazy">` : ''}
          <div class="forum-body">${paragraphsHTML(bodyLines(record.body), 'This post has no text.')}</div>
          ${attachmentsHTML(bodyLinks(record.body))}
          <h3 class="forum-answers-title">Answers</h3>
          <div class="forum-answers" data-answers>${NC.components.skeleton(3, 3)}</div>
        </div>`,
      footer: `<button type="button" class="btn btn-secondary" data-modal-close>Close</button><button type="button" class="btn ${isHidden(record) ? 'btn-primary' : 'btn-ghost-danger'}" data-toggle-thread="${escapeHTML(record.id)}"><i class="fa-regular fa-eye-slash" aria-hidden="true"></i>${isHidden(record) ? 'Show to readers' : 'Hide from readers'}</button>`,
      onOpen: async (modalRoot) => {
        modalRoot.querySelector('[data-toggle-thread]')?.addEventListener('click', async (event) => {
          await toggleStatus(record, event.currentTarget);
          NC.components.closeModal();
        });
        const host = modalRoot.querySelector('[data-answers]');
        try {
          const result = await NC.api.list('forumReplies', {
            select: 'id,discussion_id,user_id,body,status,parent_id,created_at',
            filters: { discussion_id: record.id },
            order: 'created_at.asc',
            limit: 500
          });
          if (!host) return;
          host.innerHTML = result.data.length
            ? result.data.map(decorateAnswer).map(answerHTML).join('')
            : '<p class="text-muted-foreground">No reader has answered this discussion yet.</p>';
          host.querySelectorAll('[data-answer-toggle]').forEach((button) => button.addEventListener('click', () => toggleAnswer(result.data, button.dataset.answerToggle, button)));
          host.querySelectorAll('[data-answer-delete]').forEach((button) => button.addEventListener('click', () => removeAnswer(result.data, button.dataset.answerDelete, button, record)));
        } catch (error) {
          console.error(error);
          if (host) host.innerHTML = NC.components.notice(NC.api.userMessage(error, 'The answers could not be loaded.'), 'warning', 'fa-triangle-exclamation');
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  async function toggleStatus(record, button) {
    const next = isHidden(record) ? 'Publish' : 'Unpublish';
    NC.utils.setButtonLoading(button, true, '');
    try {
      await NC.api.update('forum', record.id, { status: next });
      record.status = next;
      NC.components.toast(next === 'Publish' ? 'The discussion is visible to readers again.' : 'The discussion is hidden from readers.', 'success');
      // Rendered from the record we just changed, so a hidden row drops out of a
      // "Published" filter without another round trip.
      renderList();
      refreshStats();
    } catch (error) {
      console.error(error);
      NC.components.toast(NC.api.userMessage(error, 'Unable to change the discussion status.'), 'error');
    } finally {
      NC.utils.setButtonLoading(button, false);
    }
  }

  async function toggleAnswer(answers, answerId, button) {
    const answer = answers.find((item) => item.id === answerId);
    if (!answer) return;
    const next = answer.status === 'Publish' ? 'Unpublish' : 'Publish';
    NC.utils.setButtonLoading(button, true, '');
    try {
      await NC.api.update('forumReplies', answer.id, { status: next });
      answer.status = next;
      NC.components.toast(next === 'Publish' ? 'The answer is visible again.' : 'The answer is hidden.', 'success');
      button.closest('.forum-answer')?.classList.toggle('is-hidden', next !== 'Publish');
    } catch (error) {
      console.error(error);
      NC.components.toast(NC.api.userMessage(error, 'Unable to change the answer status.'), 'error');
    } finally {
      NC.utils.setButtonLoading(button, false);
    }
  }

  async function remove(record) {
    try {
      const removed = await NC.crud.deleteRecord({
        table: 'forum',
        record,
        label: 'discussion',
        // The reader's cover is theirs, but the thread is going; the dashboard
        // offers the same ImgBB cleanup every other delete does.
        remoteDeleteUrls: [record.cover_delete_url].filter(Boolean)
      });
      if (removed) await load();
    } catch (error) {
      console.error(error);
      NC.components.toast(NC.api.userMessage(error, 'Unable to delete the discussion.'), 'error');
    }
  }

  async function removeAnswer(answers, answerId, button, record) {
    const answer = answers.find((item) => item.id === answerId);
    if (!answer) return;
    const accepted = await NC.components.confirm({
      title: 'Delete this answer?',
      description: `The answer from ${answer.author_name || 'this reader'} will be permanently removed. This action cannot be undone.`,
      confirmLabel: 'Delete answer'
    });
    if (!accepted) return;
    try {
      await NC.api.remove('forumReplies', answer.id);
      NC.components.toast('The answer was removed.', 'success');
      button.closest('.forum-answer')?.remove();
      record.replies_count = Math.max(0, Number(record.replies_count || 0) - 1);
      const counter = button.closest('.forum-thread')?.querySelector('[data-answer-count]');
      if (counter) counter.textContent = number(record.replies_count);
      // The database keeps `replies_count` on the discussion; read the list back
      // rather than trusting this page's arithmetic.
      await load({}, { keepListStill: true });
    } catch (error) {
      console.error(error);
      NC.components.toast(NC.api.userMessage(error, 'Unable to delete the answer.'), 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Load and render
  // ---------------------------------------------------------------------------

  function refreshStats() {
    const host = root.querySelector('[data-forum-stats]');
    if (host) host.innerHTML = statsHTML();
  }

  async function load(context = {}, { keepListStill = false } = {}) {
    // `keepListStill` is for the writes that happen inside the modal: the row
    // being changed is in the modal, and replacing the table under it would be a
    // flash for nothing.
    const content = root.querySelector('[data-forum-content]');
    if (!keepListStill) content.innerHTML = NC.components.skeleton(7, 5);
    try {
      const [discussionResult, categoryResult, profileResult] = await Promise.all([
        NC.api.list('forum', {
          select: 'id,category_id,user_id,title,body,status,views_count,replies_count,is_official,cover_image_url,cover_delete_url,created_at,last_reply_at,updated_at',
          order: 'created_at.desc',
          limit: 2000,
          count: true
        }),
        NC.api.list('forumCategories', { select: 'id,title,slug,position,is_locked', order: 'position.asc', limit: 200 }).catch(() => ({ data: [] })),
        // Names only: the join this page needs, and nothing more.
        NC.api.list('profiles', { select: 'id,name', limit: 5000 }).catch(() => ({ data: [] }))
      ]);
      if (NC.crud.isStaleNavigation(context)) return;
      categories = categoryResult.data;
      readers = new Map(profileResult.data.map((profile) => [profile.id, profile.name]));
      state.setRecords(discussionResult.data.map((record) => decorate(record, readers)));
      syncStateFilters();
      fillCategorySelect();
      renderList();
      refreshStats();
      const action = context.params?.get('action');
      const id = context.params?.get('id');
      if (id && ['view', 'edit'].includes(action) && state.records.some((record) => record.id === id)) openView(id);
    } catch (error) {
      NC.crud.handleLoadError(content, error, () => load(context), context);
    }
  }

  function render(container, context = {}) {
    root = container;
    const params = context.params || new URLSearchParams();
    // One `filter` parameter names the queue a link was aimed at — the dashboard's
    // Needs-attention items use it — and `answers` remains available for a direct
    // link to either answer state.
    const initialFilter = params.get('filter') || 'all';
    filterValues.status = ['Publish', 'Unpublish'].includes(initialFilter) ? initialFilter : 'all';
    filterValues.category_id = params.get('category') || 'all';
    const initialAnswers = (params.get('answers') || (initialFilter === 'Waiting' ? 'waiting' : '')).toLowerCase();
    filterValues.answers = ['waiting', 'answered'].includes(initialAnswers) ? initialAnswers : 'all';
    syncStateFilters();
    root.innerHTML = `
      ${NC.components.pageHeader({
        eyebrow: 'Community',
        title: 'Forum',
        description: 'Everything readers have posted in the app, with the answers they left each other. Hide what must not be public; nothing is rewritten from here.',
        breadcrumb: [{ label: 'Forum' }],
        actions: '<button type="button" class="btn btn-secondary" data-forum-refresh><i class="fa-regular fa-arrows-rotate" aria-hidden="true"></i>Refresh</button>'
      })}
      ${NC.components.notice('A discussion and its answers are shown as the reader wrote them — as text, never as markup — and hiding one takes it out of the app for everyone.', 'info', 'fa-comments')}
      <section class="forum-stats mt-6" data-forum-stats aria-label="Forum totals"></section>
      <section class="surface mt-6">
        <div class="list-toolbar">
          <label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search discussions</span><input type="search" placeholder="Search discussions…" data-forum-search></label>
          <select class="form-select toolbar-select" data-forum-status aria-label="Filter discussion status"><option value="all">All statuses</option><option value="Publish">Published</option><option value="Unpublish">Hidden from readers</option></select>
          <select class="form-select toolbar-select toolbar-select-wide" data-forum-category aria-label="Filter by category"><option value="all">All categories</option></select>
          <select class="form-select toolbar-select" data-forum-answers aria-label="Filter by answers"><option value="all">All discussions</option><option value="waiting">Waiting for an answer</option><option value="answered">Answered</option></select>
        </div>
        <div class="active-filters hidden" data-forum-active-filters></div>
        <div data-forum-content>${NC.components.skeleton(7, 5)}</div>
      </section>`;
    root.querySelector('[data-forum-refresh]').addEventListener('click', (event) => {
      event.currentTarget.blur();
      load(context);
    });
    root.querySelector('[data-forum-search]').addEventListener('input', debounce((event) => {
      state.setQuery(event.target.value);
      renderList();
    }, 220));
    const status = root.querySelector('[data-forum-status]');
    status.value = filterValues.status;
    status.addEventListener('change', (event) => applyFilter('status', event.target.value));
    const answers = root.querySelector('[data-forum-answers]');
    answers.value = filterValues.answers;
    answers.addEventListener('change', (event) => applyFilter('answers', event.target.value));
    root.querySelector('[data-forum-category]').addEventListener('change', (event) => applyFilter('category_id', event.target.value));
    return load(context);
  }

  NC.views.forum = { render };
})(window.NC);
