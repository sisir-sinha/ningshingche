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
    searchFields: ['title', 'body_text', 'author_display', 'category_title'],
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
    // `author_name` stays exactly what the row stores — the dashboard's own
    // signature, or nothing on a reader's post. `author_display` is the name the
    // app shows, in the database's own order (032): the stored signature, then
    // the reader's profile, then the magazine's reader label. The editor writes
    // the first; it must never turn the second into a frozen copy of itself.
    record.author_display = record.author_name || readers.get(record.user_id) || 'Registered reader';
    record.category_title = categories.find((item) => item.id === record.category_id)?.title || 'Uncategorised';
    record.body_text = stripHTML(record.body);
    return record;
  }

  /** An answer carries a name as well — the same rule, one line down. */
  function decorateAnswer(answer) {
    answer.author_display = answer.author_name || readers.get(answer.user_id) || 'Registered reader';
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
            <small>${escapeHTML(record.author_display)}${record.is_official ? ' · <i class="fa-regular fa-badge-check" aria-hidden="true"></i> Official' : ''}${links ? ` · ${number(links)} attachment${links === 1 ? '' : 's'}` : ''}</small>
          </div>
        </td>
        <td data-label="Category"><span class="role-name-badge"><i class="fa-regular fa-layer-group" aria-hidden="true"></i>${escapeHTML(record.category_title)}</span></td>
        <td data-label="Answers"><div class="stacked-cell"><strong>${number(record.replies_count || 0)}</strong>${waiting ? '<small class="text-warning">Waiting for an answer</small>' : ''}</div></td>
        <td data-label="Views">${number(record.views_count || 0)}</td>
        <td data-label="Status">${NC.components.statusBadge(record.status || 'Publish')}</td>
        <td data-label="Started"><time datetime="${escapeHTML(record.created_at || '')}">${escapeHTML(formatDateTime(record.created_at))}</time><small>${escapeHTML(relativeTime(record.last_reply_at || record.created_at))}</small></td>
        <td data-label="Actions" class="text-right">${NC.components.rowActions([
          { action: 'view', id: record.id, label: 'Read the discussion', icon: 'fa-eye' },
          { action: 'edit', id: record.id, label: 'Edit the discussion', icon: 'fa-pen' },
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
      if (button.dataset.action === 'edit') openEditor(record);
      if (button.dataset.action === 'toggle') toggleStatus(record, button);
      if (button.dataset.action === 'delete') remove(record);
    }));
    NC.crud.bindPagination(root, state, renderList);
    NC.crud.bindSort(root, state, renderList);
  }

  // ---------------------------------------------------------------------------
  // Reading a discussion, and writing in it
  // ---------------------------------------------------------------------------

  /** The name an editorial post is signed with when the admin leaves it blank. */
  const OFFICIAL_SIGNATURE = 'নিংশিং চে';

  /**
   * The name the app will show. Blank is honest for a reader's post — the
   * database falls back to their profile — but an unsigned official post would
   * read as a reader's, so an official one always carries a signature.
   */
  function signature(name, official) {
    const clean = String(name || '').trim();
    if (clean) return clean;
    return official ? OFFICIAL_SIGNATURE : '';
  }

  /** The dashboard user's own name, offered as the signature of what they write. */
  function editorSignature() {
    return String(NC.state.session?.user?.name || '').trim() || OFFICIAL_SIGNATURE;
  }

  function categoryOptionsHTML(selectedId) {
    return categories.map((item) => `<option value="${escapeHTML(item.id)}"${item.id === selectedId ? ' selected' : ''}>${escapeHTML(item.title || 'Untitled')}</option>`).join('');
  }

  function statusOptionsHTML(selected) {
    const value = selected === 'Unpublish' ? 'Unpublish' : 'Publish';
    return `<option value="Publish"${value === 'Publish' ? ' selected' : ''}>Published — readers see it</option><option value="Unpublish"${value === 'Unpublish' ? ' selected' : ''}>Hidden from readers</option>`;
  }

  // ---------------------------------------------------------------------------
  // The editor: a thread the admin opens, or one they change
  // ---------------------------------------------------------------------------

  function openEditor(record = null) {
    const editing = Boolean(record);
    const modal = NC.components.openModal({
      id: 'forum-editor',
      size: 'lg',
      eyebrow: editing ? 'Edit discussion' : 'New discussion',
      title: editing ? (record.title || 'Untitled discussion') : 'Open a discussion',
      description: editing
        ? 'Everything about this thread is editable here — including a reader\'s words. Nothing changes until you save.'
        : 'A thread written from the dashboard is signed by you and marked official, which is what puts it under অনুমোদিত in the app.',
      content: `
        <form id="forum-editor-form" class="form-stack" novalidate>
          <div class="form-grid-2">
            <div class="field">
              <label class="field-label" for="forum-editor-category">Board <span aria-hidden="true">*</span></label>
              <select class="form-select" id="forum-editor-category" name="category_id" required>${categoryOptionsHTML(record?.category_id || categories[0]?.id || '')}</select>
              <p class="field-error hidden" data-field-error="category_id"></p>
            </div>
            <div class="field">
              <label class="field-label" for="forum-editor-status">Readers</label>
              <select class="form-select" id="forum-editor-status" name="status">${statusOptionsHTML(record?.status)}</select>
            </div>
          </div>
          <div class="field">
            <label class="field-label" for="forum-editor-title">Title <span aria-hidden="true">*</span></label>
            <input class="form-input" id="forum-editor-title" name="title" maxlength="200" value="${escapeHTML(record?.title || '')}" required>
            <p class="field-error hidden" data-field-error="title"></p>
          </div>
          <div class="field">
            <label class="field-label" for="forum-editor-author">Signed by</label>
            <input class="form-input" id="forum-editor-author" name="author_name" maxlength="80" value="${escapeHTML(record ? (record.author_name || '') : editorSignature())}" placeholder="${escapeHTML(record && !record.author_name ? `Shown as ${record.author_display}` : OFFICIAL_SIGNATURE)}">
            <p class="field-hint">The signature the app shows beside this post. Leave it empty on a reader's thread to keep showing their own profile name${record && !record.author_name ? ` (${escapeHTML(record.author_display)})` : ''}.</p>
          </div>
          ${NC.editor.editorHTML({ id: 'forum-editor-body', label: 'Discussion', hint: 'Headings, bold, lists and links all appear in the app. Pictures are attached below, not pasted into the text.' })}
          ${NC.media.imageUploaderHTML({ id: 'forum-editor-cover', label: 'Cover image', hint: 'Optional. The app shows it above the text.' })}
          <label class="simple-checkbox"><input type="checkbox" data-forum-official name="is_official" ${(record ? Boolean(record.is_official) : true) ? 'checked' : ''}${editing ? '' : ' disabled'}><span>Official — listed under অনুমোদিত in the app</span></label>
          ${editing ? '' : '<p class="field-hint">Every thread created here is official, so the app lists it under অনুমোদিত.</p>'}
        </form>`,
      footer: `<button type="button" class="btn btn-secondary" data-modal-close>Cancel</button><button type="button" class="btn btn-primary" data-forum-save><i class="fa-regular fa-floppy-disk" aria-hidden="true"></i>${editing ? 'Save the changes' : 'Publish the discussion'}</button>`,
      onOpen: (modalRoot) => {
        const form = modalRoot.querySelector('#forum-editor-form');
        const editor = NC.editor.mountEditor(modalRoot.querySelector('#forum-editor-body'), {
          initial: record?.body || '',
          required: false,
          label: 'Discussion'
        });
        const cover = NC.media.mountImageUploader(modalRoot.querySelector('#forum-editor-cover'), {
          initial: { url: record?.cover_image_url || '', delete_url: record?.cover_delete_url || '' },
          label: 'Cover image'
        });
        const official = modalRoot.querySelector('[data-forum-official]');
        modalRoot.querySelector('[data-forum-save]').addEventListener('click', (event) => saveThread({
          button: event.currentTarget, form, editor, cover, official, record
        }));
      }
    });
    return modal;
  }

  async function saveThread({ button, form, editor, cover, official, record }) {
    const editing = Boolean(record);
    const data = NC.utils.formData(form);
    const title = String(data.title || '').trim();
    const isOfficial = official.disabled ? true : official.checked;
    const errors = {};
    if (title.length < 3) errors.title = 'Enter a title of at least 3 characters.';
    if (!data.category_id) errors.category_id = 'Choose a board.';
    if (!NC.utils.validateFields(form, errors)) return;
    if (!editor.validate()) return;

    const image = cover.getValue();
    const payload = {
      title,
      category_id: data.category_id,
      body: editor.getValue(),
      author_name: signature(data.author_name, isOfficial),
      status: data.status === 'Unpublish' ? 'Unpublish' : 'Publish',
      is_official: isOfficial,
      cover_image_url: NC.utils.safeExternalUrl(image.url) || '',
      cover_delete_url: image.delete_url || ''
    };

    NC.utils.setButtonLoading(button, true, editing ? 'Saving…' : 'Publishing…');
    try {
      const saved = editing
        ? await NC.api.update('forum', record.id, payload)
        : await NC.api.insert('forum', payload);
      NC.components.closeModal('saved');
      NC.components.toast(
        editing
          ? 'The discussion was saved.'
          : `The discussion is live${payload.status === 'Publish' ? ' in the app under অনুমোদিত' : ' as a hidden thread'}.`,
        'success'
      );
      await load({}, { keepListStill: true });
      const savedId = saved?.id || record?.id;
      if (savedId && state.records.some((item) => item.id === savedId)) openView(savedId);
    } catch (error) {
      console.error(error);
      NC.components.toast(NC.api.userMessage(error, 'The discussion could not be saved.'), 'error');
    } finally {
      NC.utils.setButtonLoading(button, false);
    }
  }

  // ---------------------------------------------------------------------------
  // Reactions, as the dashboard sees and keeps them
  // ---------------------------------------------------------------------------

  const REACTIONS = [
    ['like', 'Like', 'fa-thumbs-up'],
    ['dislike', 'Dislike', 'fa-thumbs-down'],
    ['agree', 'Agree', 'fa-circle-check']
  ];

  /** One key per dashboard user, so two admins can each hold their own reaction. */
  function adminReactorKey() {
    return `dashboard:${NC.state.session?.user?.id || 'unknown'}`;
  }

  function reactionCounts(rows = []) {
    return REACTIONS.reduce((counts, [kind]) => {
      counts[kind] = rows.filter((row) => row.kind === kind).length;
      return counts;
    }, {});
  }

  async function loadReactions(replyIds) {
    if (!replyIds.length) return new Map();
    const result = await NC.api.list('forumReactions', {
      select: 'reply_id,reactor_key,kind,user_id,created_at',
      filters: { reply_id: { op: 'in', value: replyIds } },
      order: 'created_at.asc',
      limit: 5000
    });
    const grouped = new Map();
    result.data.forEach((row) => {
      if (!grouped.has(row.reply_id)) grouped.set(row.reply_id, []);
      grouped.get(row.reply_id).push(row);
    });
    return grouped;
  }

  function reactionBarHTML(answer) {
    const rows = reactions.get(answer.id) || [];
    const counts = reactionCounts(rows);
    const mine = rows.find((row) => row.reactor_key === adminReactorKey())?.kind || '';
    return `
      <div class="forum-reactions" data-reactions="${escapeHTML(answer.id)}">
        ${REACTIONS.map(([kind, label, icon]) => `
          <button type="button" class="forum-reaction ${mine === kind ? 'is-mine' : ''}" data-react="${kind}" data-answer="${escapeHTML(answer.id)}" aria-pressed="${mine === kind ? 'true' : 'false'}" title="${mine === kind ? `Take your ${label.toLowerCase()} back` : label}">
            <i class="fa-regular ${icon}" aria-hidden="true"></i><span>${number(counts[kind] || 0)}</span>
          </button>`).join('')}
        ${rows.length ? `<button type="button" class="forum-reaction-clear" data-clear-reactions="${escapeHTML(answer.id)}"><i class="fa-regular fa-eraser" aria-hidden="true"></i>Clear ${number(rows.length)} reaction${rows.length === 1 ? '' : 's'}</button>` : ''}
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // The thread, with its answers
  // ---------------------------------------------------------------------------

  let reactions = new Map();

  function answerCard(answer) {
    const hidden = answer.status !== 'Publish';
    return `
      <article class="forum-answer ${hidden ? 'is-hidden' : ''} ${answer.parent_id ? 'is-reply' : ''}" data-answer="${escapeHTML(answer.id)}">
        <div class="forum-answer-head">
          <span class="user-avatar">${escapeHTML(initials(answer.author_display || 'Reader'))}</span>
          <span>
            <strong>${escapeHTML(answer.author_display || 'Registered reader')}</strong>
            ${answer.is_official ? '<span class="status-badge status-info"><i class="fa-regular fa-badge-check" aria-hidden="true"></i>Official</span>' : ''}
            <small>${escapeHTML(formatDateTime(answer.created_at))} · ${escapeHTML(relativeTime(answer.created_at))}</small>
          </span>
          ${hidden ? NC.components.statusBadge('Unpublish') : ''}
        </div>
        <div class="forum-body" data-answer-body>${paragraphsHTML(bodyLines(answer.body), 'This answer has no text.')}${attachmentsHTML(bodyLinks(answer.body))}</div>
        <div class="forum-answer-editor hidden" data-answer-editor></div>
        ${reactionBarHTML(answer)}
        <div class="forum-answer-actions">
          <button type="button" class="row-action" data-answer-reply="${escapeHTML(answer.id)}" title="Answer this one" aria-label="Answer this one"><i class="fa-regular fa-reply" aria-hidden="true"></i><span>Answer</span></button>
          <button type="button" class="row-action" data-answer-edit="${escapeHTML(answer.id)}" title="Edit this answer" aria-label="Edit this answer"><i class="fa-regular fa-pen" aria-hidden="true"></i><span>Edit</span></button>
          <button type="button" class="row-action" data-answer-toggle="${escapeHTML(answer.id)}" title="${hidden ? 'Show this answer' : 'Hide this answer'}" aria-label="${hidden ? 'Show this answer' : 'Hide this answer'}"><i class="fa-regular fa-eye-slash" aria-hidden="true"></i><span>${hidden ? 'Show' : 'Hide'}</span></button>
          <button type="button" class="row-action row-action-danger" data-answer-delete="${escapeHTML(answer.id)}" title="Delete this answer" aria-label="Delete this answer"><i class="fa-regular fa-trash" aria-hidden="true"></i><span>Delete</span></button>
        </div>
      </article>`;
  }

  async function openView(discussionId) {
    const record = state.records.find((item) => item.id === discussionId);
    if (!record) return;
    const cover = safeImage(record.cover_image_url);
    let answers = [];
    let parentId = '';

    NC.components.openModal({
      id: 'forum-thread',
      size: 'xl',
      eyebrow: 'Forum moderation',
      title: record.title || 'Untitled discussion',
      content: `
        <div class="forum-thread">
          <dl class="details-grid mt-6">
            <div><dt>Board</dt><dd>${escapeHTML(record.category_title)}</dd></div>
            <div><dt>Started by</dt><dd>${escapeHTML(record.author_display)}</dd></div>
            <div><dt>Started</dt><dd>${escapeHTML(formatDateTime(record.created_at))}</dd></div>
            <div><dt>Last answer</dt><dd>${escapeHTML(record.last_reply_at ? relativeTime(record.last_reply_at) : 'No answer yet')}</dd></div>
            <div><dt>Views</dt><dd>${number(record.views_count || 0)}</dd></div>
            <div><dt>Answers</dt><dd data-answer-count>${number(record.replies_count || 0)}</dd></div>
            <div><dt>Status</dt><dd>${NC.components.statusBadge(record.status || 'Publish')}${record.is_official ? ' <span class="status-badge status-info"><i class="fa-regular fa-badge-check" aria-hidden="true"></i>অনুমোদিত</span>' : ''}</dd></div>
          </dl>
          ${cover ? `<img class="forum-cover" src="${escapeHTML(cover)}" alt="The cover attached to this thread" loading="lazy">` : ''}
          <div class="forum-body">${paragraphsHTML(bodyLines(record.body), 'This post has no text.')}</div>
          ${attachmentsHTML(bodyLinks(record.body))}
          <h3 class="forum-answers-title">Answers <span data-answers-count>${number(record.replies_count || 0)}</span></h3>
          <div class="forum-answers" data-answers>${NC.components.skeleton(3, 3)}</div>
          <section class="forum-composer" data-composer>
            <div class="forum-composer-head">
              <strong>Write an answer</strong>
              <span data-answer-parent-note>answering the discussion</span>
            </div>
            ${NC.editor.editorHTML({ id: 'forum-answer-body', label: 'Answer', hint: 'What you write here appears in the app under this discussion, signed as you.' })}
            <label class="simple-checkbox"><input type="checkbox" data-answer-official checked><span>Mark this answer official</span></label>
            <div class="form-actions">
              <button type="button" class="btn btn-primary" data-answer-save><i class="fa-regular fa-paper-plane" aria-hidden="true"></i>Post the answer</button>
              <button type="button" class="btn btn-secondary hidden" data-answer-parent-clear>Answer the discussion instead</button>
            </div>
          </section>
        </div>`,
      footer: `<button type="button" class="btn btn-secondary" data-modal-close>Close</button><button type="button" class="btn btn-secondary" data-thread-edit><i class="fa-regular fa-pen" aria-hidden="true"></i>Edit the discussion</button><button type="button" class="btn ${isHidden(record) ? 'btn-primary' : 'btn-ghost-danger'}" data-toggle-thread="${escapeHTML(record.id)}"><i class="fa-regular fa-eye-slash" aria-hidden="true"></i>${isHidden(record) ? 'Show to readers' : 'Hide from readers'}</button>`,
      onOpen: async (modalRoot) => {
        const editor = NC.editor.mountEditor(modalRoot.querySelector('#forum-answer-body'), {
          initial: '', required: false, label: 'Answer'
        });
        const official = modalRoot.querySelector('[data-answer-official]');
        const note = modalRoot.querySelector('[data-answer-parent-note]');
        const clearParent = modalRoot.querySelector('[data-answer-parent-clear]');
        const host = modalRoot.querySelector('[data-answers]');

        function setParent(nextId) {
          parentId = nextId || '';
          const parent = answers.find((item) => item.id === parentId);
          // The answer hangs off the answer it was written to, so the note names
          // the person it will appear under (one indent level, as the app reads it).
          note.textContent = parent ? `answering ${parent.author_display || 'that reader'}` : 'answering the discussion';
          clearParent.classList.toggle('hidden', !parentId);
        }

        function draw() {
          host.innerHTML = answers.length
            ? answers.map(answerCard).join('')
            : '<p class="text-muted-foreground">No reader has answered this discussion yet.</p>';
          bindAnswerEvents();
        }

        async function refreshAnswers() {
          const result = await NC.api.list('forumReplies', {
            select: 'id,discussion_id,user_id,parent_id,author_name,body,status,is_official,created_at',
            filters: { discussion_id: record.id },
            order: 'created_at.asc',
            limit: 500
          });
          answers = result.data.map(decorateAnswer);
          reactions = await loadReactions(answers.map((answer) => answer.id));
          modalRoot.querySelector('[data-answers-count]').textContent = number(answers.length);
          draw();
        }

        async function postAnswer(button) {
          if (!editor.validate()) return;
          const body = editor.getValue();
          if (!stripHTML(body)) {
            NC.components.toast('Write the answer first.', 'error');
            return;
          }
          NC.utils.setButtonLoading(button, true, 'Posting…');
          try {
            await NC.api.insert('forumReplies', {
              discussion_id: record.id,
              body,
              parent_id: parentId || null,
              status: 'Publish',
              author_name: signature(editorSignature(), official.checked),
              is_official: official.checked,
              user_id: null
            });
            editor.setValue('');
            setParent('');
            NC.components.toast('The answer is live in the app.', 'success');
            // The database keeps `replies_count`; read the list back rather than
            // trusting this page's arithmetic.
            await load({}, { keepListStill: true });
            await refreshAnswers();
          } catch (error) {
            console.error(error);
            NC.components.toast(NC.api.userMessage(error, 'The answer could not be posted.'), 'error');
          } finally {
            NC.utils.setButtonLoading(button, false);
          }
        }

        function openAnswerEditor(answer, card) {
          const hostNode = card.querySelector('[data-answer-editor]');
          const bodyNode = card.querySelector('[data-answer-body]');
          const others = answers.filter((item) => item.id !== answer.id && !item.parent_id);
          hostNode.innerHTML = `
            ${NC.editor.editorHTML({ id: `forum-answer-edit-${answer.id}`, label: 'Answer', hint: 'Editing a reader\'s answer changes it for them too.', required: true })}
            <div class="field">
              <label class="field-label" for="forum-answer-parent-${escapeHTML(answer.id)}">Attached to</label>
              <select class="form-select" id="forum-answer-parent-${escapeHTML(answer.id)}" data-answer-parent-select>
                <option value="">The discussion itself</option>
                ${others.map((item) => `<option value="${escapeHTML(item.id)}"${answer.parent_id === item.id ? ' selected' : ''}>${escapeHTML(truncate(stripHTML(item.body) || 'answer', 60))} — ${escapeHTML(item.author_display || 'reader')}</option>`).join('')}
              </select>
            </div>
            <label class="simple-checkbox"><input type="checkbox" data-answer-edit-official ${answer.is_official ? 'checked' : ''}><span>Official</span></label>
            <div class="form-actions">
              <button type="button" class="btn btn-primary" data-answer-save-edit><i class="fa-regular fa-floppy-disk" aria-hidden="true"></i>Save the answer</button>
              <button type="button" class="btn btn-secondary" data-answer-edit-cancel>Cancel</button>
            </div>`;
          hostNode.classList.remove('hidden');
          bodyNode.classList.add('hidden');
          const editEditor = NC.editor.mountEditor(hostNode, { initial: answer.body || '', required: true, label: 'Answer' });
          hostNode.querySelector('[data-answer-save-edit]').addEventListener('click', async (event) => {
            if (!editEditor.validate()) return;
            const button = event.currentTarget;
            NC.utils.setButtonLoading(button, true, 'Saving…');
            try {
              await NC.api.update('forumReplies', answer.id, {
                body: editEditor.getValue(),
                parent_id: hostNode.querySelector('[data-answer-parent-select]').value || null,
                is_official: hostNode.querySelector('[data-answer-edit-official]').checked
              });
              NC.components.toast('The answer was saved.', 'success');
              await refreshAnswers();
            } catch (error) {
              console.error(error);
              NC.components.toast(NC.api.userMessage(error, 'The answer could not be saved.'), 'error');
            } finally {
              NC.utils.setButtonLoading(button, false);
            }
          });
          hostNode.querySelector('[data-answer-edit-cancel]').addEventListener('click', () => {
            hostNode.classList.add('hidden');
            hostNode.innerHTML = '';
            bodyNode.classList.remove('hidden');
          });
        }

        async function toggleAnswer(answer, button) {
          const next = answer.status === 'Publish' ? 'Unpublish' : 'Publish';
          NC.utils.setButtonLoading(button, true, '');
          try {
            await NC.api.update('forumReplies', answer.id, { status: next });
            answer.status = next;
            NC.components.toast(next === 'Publish' ? 'The answer is visible again.' : 'The answer is hidden.', 'success');
            await refreshAnswers();
          } catch (error) {
            console.error(error);
            NC.components.toast(NC.api.userMessage(error, 'Unable to change the answer status.'), 'error');
          } finally {
            NC.utils.setButtonLoading(button, false);
          }
        }

        async function deleteAnswer(answer, button) {
          const accepted = await NC.components.confirm({
            title: 'Delete this answer?',
            description: `The answer${answer.author_display ? ` from ${answer.author_display}` : ''} will be permanently removed. This action cannot be undone.`,
            confirmLabel: 'Delete answer'
          });
          if (!accepted) return;
          NC.utils.setButtonLoading(button, true, '');
          try {
            await NC.api.remove('forumReplies', answer.id);
            NC.components.toast('The answer was removed.', 'success');
            await load({}, { keepListStill: true });
            await refreshAnswers();
          } catch (error) {
            console.error(error);
            NC.components.toast(NC.api.userMessage(error, 'Unable to delete the answer.'), 'error');
          } finally {
            NC.utils.setButtonLoading(button, false);
          }
        }

        async function react(answer, kind, button) {
          const rows = reactions.get(answer.id) || [];
          const mine = rows.find((row) => row.reactor_key === adminReactorKey());
          NC.utils.setButtonLoading(button, true, '');
          try {
            if (mine && mine.kind === kind) {
              await NC.api.removeWhere('forumReactions', { reply_id: answer.id, reactor_key: adminReactorKey() });
              NC.components.toast('Your reaction was taken back.', 'success');
            } else {
              await NC.api.upsert('forumReactions', {
                reply_id: answer.id,
                reactor_key: adminReactorKey(),
                kind,
                user_id: null
              }, 'reply_id,reactor_key');
              NC.components.toast(`The answer was marked ${kind}.`, 'success');
            }
            await refreshAnswers();
          } catch (error) {
            console.error(error);
            NC.components.toast(NC.api.userMessage(error, 'The reaction could not be saved.'), 'error');
          } finally {
            NC.utils.setButtonLoading(button, false);
          }
        }

        async function clearReactions(answer, button) {
          const rows = reactions.get(answer.id) || [];
          const accepted = await NC.components.confirm({
            title: 'Remove every reaction?',
            description: `${number(rows.length)} reaction${rows.length === 1 ? '' : 's'} on this answer will be deleted for good — readers included.`,
            confirmLabel: 'Remove them'
          });
          if (!accepted) return;
          NC.utils.setButtonLoading(button, true, '');
          try {
            await NC.api.removeWhere('forumReactions', { reply_id: answer.id });
            NC.components.toast('Every reaction on that answer was removed.', 'success');
            await refreshAnswers();
          } catch (error) {
            console.error(error);
            NC.components.toast(NC.api.userMessage(error, 'The reactions could not be removed.'), 'error');
          } finally {
            NC.utils.setButtonLoading(button, false);
          }
        }

        function bindAnswerEvents() {
          host.querySelectorAll('[data-answer]').forEach((card) => {
            const answer = answers.find((item) => item.id === card.dataset.answer);
            if (!answer) return;
            card.querySelector('[data-answer-reply]')?.addEventListener('click', () => {
              // One indent level, as the app reads it: answering an answer hangs
              // off the answer it was written to, not off a second step.
              setParent(answer.parent_id || answer.id);
              editor.focus();
              modalRoot.querySelector('[data-composer]').scrollIntoView({ block: 'nearest' });
            });
            card.querySelector('[data-answer-edit]')?.addEventListener('click', () => openAnswerEditor(answer, card));
            card.querySelector('[data-answer-toggle]')?.addEventListener('click', (event) => toggleAnswer(answer, event.currentTarget));
            card.querySelector('[data-answer-delete]')?.addEventListener('click', (event) => deleteAnswer(answer, event.currentTarget));
            card.querySelectorAll('[data-react]').forEach((button) => button.addEventListener('click', () => react(answer, button.dataset.react, button)));
            card.querySelector('[data-clear-reactions]')?.addEventListener('click', (event) => clearReactions(answer, event.currentTarget));
          });
        }

        modalRoot.querySelector('[data-answer-save]').addEventListener('click', (event) => postAnswer(event.currentTarget));
        clearParent.addEventListener('click', () => setParent(''));
        modalRoot.querySelector('[data-thread-edit]').addEventListener('click', () => openEditor(record));
        modalRoot.querySelector('[data-toggle-thread]').addEventListener('click', async (event) => {
          await toggleStatus(record, event.currentTarget);
          NC.components.closeModal('updated');
        });

        try {
          await refreshAnswers();
        } catch (error) {
          console.error(error);
          host.innerHTML = NC.components.notice(NC.api.userMessage(error, 'The answers could not be loaded.'), 'warning', 'fa-triangle-exclamation');
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
          select: 'id,category_id,user_id,title,body,author_name,status,views_count,replies_count,is_official,cover_image_url,cover_delete_url,created_at,last_reply_at,updated_at',
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
        actions: '<button type="button" class="btn btn-secondary" data-forum-refresh><i class="fa-regular fa-arrows-rotate" aria-hidden="true"></i>Refresh</button><button type="button" class="btn btn-primary" data-forum-new><i class="fa-regular fa-plus" aria-hidden="true"></i>New discussion</button>'
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
    root.querySelector('[data-forum-new]').addEventListener('click', (event) => {
      event.currentTarget.blur();
      openEditor(null);
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
