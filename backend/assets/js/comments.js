(function (NC) {
  'use strict';

  const { escapeHTML, formatDateTime, formData, validateFields, debounce } = NC.utils;
  const state = new NC.crud.ListState('comments', { searchFields: ['name', 'email', 'content', 'blog_title'], sortKey: 'created_at' });
  let root;
  let blogs = [];
  let authors = [];
  const filterValues = { status: 'all', blog_id: 'all', author_id: 'all', commenter: 'all' };

  function blogTitle(record) {
    return blogs.find((item) => item.id === record.blog_id)?.title || record.blog_title || 'Unknown blog';
  }

  function blogAuthorId(record) {
    return blogs.find((item) => item.id === record.blog_id)?.author_id || '';
  }

  function blogAuthorName(record) {
    const blog = blogs.find((item) => item.id === record.blog_id);
    return authors.find((item) => item.id === blog?.author_id)?.title || blog?.author_name || '';
  }

  // Commenter identity: registered app users share a user_id; anonymous
  // readers are grouped by lower-cased email, then by name.
  function commenterKey(record) {
    if (record.user_id) return `user:${record.user_id}`;
    if (record.email) return `email:${String(record.email).trim().toLocaleLowerCase()}`;
    return `name:${String(record.name || '').trim().toLocaleLowerCase()}`;
  }

  function hasActiveFilters() {
    return Object.values(filterValues).some((value) => value && value !== 'all');
  }

  function syncStateFilters() {
    state.setFilter('status', filterValues.status);
    state.setFilter('blog_id', filterValues.blog_id);
    state.setFilter('__author', filterValues.author_id !== 'all' ? (_, record) => blogAuthorId(record) === filterValues.author_id : 'all');
    state.setFilter('__commenter', filterValues.commenter !== 'all' ? (_, record) => commenterKey(record) === filterValues.commenter : 'all');
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
    const search = root.querySelector('[data-comment-search]');
    if (search) search.value = '';
    syncStateFilters();
    syncFilterControls();
    renderList();
  }

  function syncFilterControls() {
    [['[data-comment-status]', 'status'], ['[data-comment-blog]', 'blog_id'], ['[data-comment-author]', 'author_id'], ['[data-comment-commenter]', 'commenter']].forEach(([selector, key]) => {
      const select = root.querySelector(selector);
      if (!select) return;
      const value = String(filterValues[key]);
      select.value = [...select.options].some((option) => option.value === value) ? value : 'all';
    });
  }

  function renderFilterChips() {
    const host = root.querySelector('[data-comment-active-filters]');
    if (!host) return;
    const commenter = filterValues.commenter !== 'all' ? commenterOptions().find((item) => item.value === filterValues.commenter) : null;
    NC.crud.renderActiveFilters(host, [
      { key: 'status', label: 'Status', value: filterValues.status === 'Publish' ? 'Published' : (filterValues.status === 'Unpublish' ? 'Needs moderation' : '') },
      { key: 'blog_id', label: 'Blog', value: filterValues.blog_id !== 'all' ? (blogs.find((item) => item.id === filterValues.blog_id)?.title || 'Unknown') : '' },
      { key: 'author_id', label: 'Blog author', value: filterValues.author_id !== 'all' ? (authors.find((item) => item.id === filterValues.author_id)?.title || 'Unknown') : '' },
      { key: 'commenter', label: 'Commenter', value: commenter ? commenter.label : '' }
    ], { onRemove: (key) => applyFilter(key, 'all'), onClear: clearFilters });
  }

  function authorOptions() {
    const counts = new Map();
    state.records.forEach((record) => { const id = blogAuthorId(record); if (id) counts.set(id, (counts.get(id) || 0) + 1); });
    return authors
      .filter((author) => counts.has(author.id))
      .map((author) => ({ value: author.id, label: author.title || 'Untitled', count: counts.get(author.id) || 0 }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'bn'));
  }

  function commenterOptions() {
    const groups = new Map();
    state.records.forEach((record) => {
      const key = commenterKey(record);
      const entry = groups.get(key) || { value: key, label: record.name || record.email || 'Anonymous', count: 0, registered: Boolean(record.user_id) };
      entry.count += 1;
      if (!entry.label && (record.name || record.email)) entry.label = record.name || record.email;
      groups.set(key, entry);
    });
    return [...groups.values()]
      .map((item) => ({ ...item, label: item.registered ? `${item.label} · app user` : item.label }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'bn'));
  }

  function blogOptions() {
    const counts = new Map();
    state.records.forEach((record) => { if (record.blog_id) counts.set(record.blog_id, (counts.get(record.blog_id) || 0) + 1); });
    return blogs
      .map((blog) => ({ value: blog.id, label: blog.title, count: counts.get(blog.id) || 0 }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'bn'));
  }

  function fillFilterSelects() {
    const replace = (selector, options, placeholder, attr, label) => {
      const current = root.querySelector(selector);
      if (!current) return;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = NC.crud.filterSelect(options, { attr, label, placeholder, wide: true });
      const next = wrapper.firstElementChild;
      current.replaceWith(next);
    };
    replace('[data-comment-blog]', blogOptions(), 'All blogs', 'data-comment-blog', 'Filter by blog');
    replace('[data-comment-author]', authorOptions(), 'All blog authors', 'data-comment-author', 'Filter by blog author');
    replace('[data-comment-commenter]', commenterOptions(), 'All commenters', 'data-comment-commenter', 'Filter by commenter');
    root.querySelector('[data-comment-blog]').addEventListener('change', (event) => applyFilter('blog_id', event.target.value));
    root.querySelector('[data-comment-author]').addEventListener('change', (event) => applyFilter('author_id', event.target.value));
    root.querySelector('[data-comment-commenter]').addEventListener('change', (event) => applyFilter('commenter', event.target.value));
    syncFilterControls();
  }

  function renderList() {
    const content = root.querySelector('[data-comments-content]');
    const { rows, total } = state.paged();
    renderFilterChips();
    if (!total) {
      const filtered = Boolean(state.query) || hasActiveFilters();
      content.innerHTML = NC.components.emptyState({
        icon: 'fa-comments', title: filtered ? 'No comments match your search or filters' : 'No comments yet',
        description: filtered ? 'Try a different name, article, author, or phrase.' : 'Reader feedback and moderation requests will appear here.',
        action: filtered ? '<button type="button" class="btn btn-secondary" data-clear-comment-filters><i class="fa-regular fa-filter-slash" aria-hidden="true"></i>Clear filters</button>' : '<button type="button" class="btn btn-primary" data-add-comment><i class="fa-regular fa-plus" aria-hidden="true"></i>Add comment</button>'
      }); bindListEvents(content); return;
    }
    const body = rows.map((record) => `
      <tr>
        <td data-label="Comment"><div class="comment-cell"><button type="button" class="table-link" data-filter-commenter="${escapeHTML(commenterKey(record))}" title="Show every comment by this reader">${escapeHTML(record.name || 'Anonymous')}</button><p>${escapeHTML(NC.utils.truncate(record.content, 110))}</p><small>${escapeHTML(record.email || record.phone || 'No contact details')}</small></div></td>
        <td data-label="Blog"><div class="stacked-cell">${NC.auth.canAccess('blogs') ? `<button type="button" class="table-link line-clamp-2" data-open-blog="${escapeHTML(record.blog_id)}">${escapeHTML(blogTitle(record))}</button>` : `<span class="line-clamp-2">${escapeHTML(blogTitle(record))}</span>`}${blogAuthorName(record) ? `<span>${blogAuthorId(record) ? `<button type="button" class="table-link" style="font-weight:600;font-size:inherit;color:inherit" data-filter-author="${escapeHTML(blogAuthorId(record))}" title="Show comments on this author’s blogs"><i class="fa-regular fa-user-pen" aria-hidden="true"></i> ${escapeHTML(blogAuthorName(record))}</button>` : escapeHTML(blogAuthorName(record))}</span>` : ''}</div></td>
        <td data-label="Status">${NC.components.statusBadge(record.status || 'Unpublish')}</td>
        <td data-label="Received"><time datetime="${escapeHTML(record.created_at || '')}">${escapeHTML(formatDateTime(record.created_at))}</time></td>
        <td data-label="Actions" class="text-right">${NC.components.rowActions([
          { action: 'view', id: record.id, label: 'View comment', icon: 'fa-eye' },
          { action: 'toggle', id: record.id, label: record.status === 'Publish' ? 'Unpublish comment' : 'Publish comment', icon: record.status === 'Publish' ? 'fa-eye-slash' : 'fa-circle-check' },
          { action: 'edit', id: record.id, label: 'Edit comment', icon: 'fa-pen' },
          { action: 'delete', id: record.id, label: 'Delete comment', icon: 'fa-trash', danger: true }
        ])}</td>
      </tr>`).join('');
    content.innerHTML = `${NC.components.tableShell({
      caption: 'Reader comments', minWidth: '900px',
      head: `<tr><th>Comment</th><th>Blog</th><th>Status</th><th><button type="button" data-sort="created_at">Received ${NC.crud.sortIcon(state, 'created_at')}</button></th><th class="text-right">Actions</th></tr>`, body
    })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
    bindListEvents(content);
  }

  function bindListEvents(scope = root) {
    scope.querySelectorAll('[data-clear-comment-filters]').forEach((button) => button.addEventListener('click', () => clearFilters()));
    scope.querySelectorAll('[data-filter-commenter]').forEach((button) => button.addEventListener('click', () => applyFilter('commenter', button.dataset.filterCommenter)));
    scope.querySelectorAll('[data-filter-author]').forEach((button) => button.addEventListener('click', () => applyFilter('author_id', button.dataset.filterAuthor)));
    scope.querySelectorAll('[data-add-comment]').forEach((button) => button.addEventListener('click', () => openForm()));
    scope.querySelectorAll('[data-open-blog]').forEach((button) => button.addEventListener('click', () => NC.utils.routeTo('blogs', { action: 'view', id: button.dataset.openBlog })));
    scope.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
      const record = state.records.find((item) => item.id === button.dataset.id); if (!record) return;
      if (button.dataset.action === 'view') openView(record);
      if (button.dataset.action === 'edit') openForm(record);
      if (button.dataset.action === 'toggle') toggleStatus(record, button);
      if (button.dataset.action === 'delete') remove(record);
    }));
    NC.crud.bindPagination(root, state, renderList); NC.crud.bindSort(root, state, renderList);
  }

  function openView(record) {
    NC.components.openModal({
      title: `Comment by ${record.name || 'Anonymous'}`, eyebrow: 'Reader feedback', size: 'md',
      content: `
        <blockquote class="comment-preview"><i class="fa-solid fa-quote-left" aria-hidden="true"></i><p>${escapeHTML(record.content)}</p></blockquote>
        <dl class="details-grid mt-6"><div><dt>Blog</dt><dd>${escapeHTML(blogTitle(record))}</dd></div><div><dt>Status</dt><dd>${NC.components.statusBadge(record.status)}</dd></div><div><dt>Email</dt><dd>${escapeHTML(record.email || '—')}</dd></div><div><dt>Phone</dt><dd>${escapeHTML(record.phone || '—')}</dd></div><div><dt>Address</dt><dd>${escapeHTML(record.address || '—')}</dd></div><div><dt>Received</dt><dd>${escapeHTML(formatDateTime(record.created_at))}</dd></div></dl>`,
      footer: `<button type="button" class="btn btn-secondary" data-modal-close>Close</button><button type="button" class="btn btn-primary" data-view-comment-edit><i class="fa-regular fa-pen" aria-hidden="true"></i>Edit</button>`,
      onOpen: (modalRoot) => modalRoot.querySelector('[data-view-comment-edit]').addEventListener('click', () => { NC.components.closeModal(); window.setTimeout(() => openForm(record), 180); })
    });
  }

  function openForm(record = null) {
    NC.components.openModal({
      title: record ? 'Edit comment' : 'Add comment', eyebrow: 'Comment moderation', size: 'lg',
      content: `
        <form id="comment-form" class="form-stack" novalidate>
          ${record ? '' : NC.importer.formControlHTML('comments')}
          <div class="field"><label class="field-label" for="comment-blog">Blog <span aria-hidden="true">*</span></label><select class="form-select" id="comment-blog" name="blog_id"><option value="">Choose a blog</option>${blogs.map((blog) => `<option value="${escapeHTML(blog.id)}" ${blog.id === record?.blog_id ? 'selected' : ''}>${escapeHTML(blog.title)}</option>`).join('')}</select><p class="field-error hidden" data-field-error="blog_id"></p></div>
          <div class="form-grid-2"><div class="field"><label class="field-label" for="comment-name">Name <span aria-hidden="true">*</span></label><input class="form-input" id="comment-name" name="name" value="${escapeHTML(record?.name || '')}" autocomplete="name" autofocus><p class="field-error hidden" data-field-error="name"></p></div><div class="field"><label class="field-label" for="comment-status">Status</label><select class="form-select" id="comment-status" name="status"><option value="Unpublish" ${record?.status !== 'Publish' ? 'selected' : ''}>Unpublish</option><option value="Publish" ${record?.status === 'Publish' ? 'selected' : ''}>Publish</option></select></div></div>
          <div class="form-grid-2"><div class="field"><label class="field-label" for="comment-email">Email</label><input class="form-input" type="email" id="comment-email" name="email" value="${escapeHTML(record?.email || '')}" autocomplete="email"><p class="field-error hidden" data-field-error="email"></p></div><div class="field"><label class="field-label" for="comment-phone">Phone</label><input class="form-input" type="tel" id="comment-phone" name="phone" value="${escapeHTML(record?.phone || '')}" autocomplete="tel"></div></div>
          <div class="field"><label class="field-label" for="comment-address">Address</label><input class="form-input" id="comment-address" name="address" value="${escapeHTML(record?.address || '')}" autocomplete="street-address"></div>
          <div class="field"><label class="field-label" for="comment-content">Comment <span aria-hidden="true">*</span></label><textarea class="form-textarea min-h-36" id="comment-content" name="content">${escapeHTML(record?.content || '')}</textarea><p class="field-error hidden" data-field-error="content"></p></div>
        </form>`,
      footer: `<button type="button" class="btn btn-secondary" data-modal-close>Cancel</button><button type="submit" form="comment-form" class="btn btn-primary" data-save-comment><i class="fa-regular fa-floppy-disk" aria-hidden="true"></i>${record ? 'Save changes' : 'Add comment'}</button>`,
      onOpen: (modalRoot) => {
        const form = modalRoot.querySelector('#comment-form');
        if (!record) NC.importer.mountFormControl(modalRoot, {
          type: 'comments', onRecord: ({ payload }) => NC.importer.fillForm(form, payload)
        });
        form.addEventListener('submit', async (event) => {
          event.preventDefault(); const data = formData(form);
          const errors = {
            blog_id: data.blog_id ? '' : 'Choose the related blog.', name: data.name ? '' : 'Name is required.',
            email: data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ? 'Enter a valid email address.' : '',
            content: data.content ? '' : 'Comment content is required.'
          };
          if (!validateFields(form, errors)) return;
          const blog = blogs.find((item) => item.id === data.blog_id);
          const button = modalRoot.querySelector('[data-save-comment]'); NC.utils.setButtonLoading(button, true, 'Saving…');
          try {
            await NC.crud.save('comments', record?.id, { ...data, blog_title: blog?.title || record?.blog_title || '' });
            NC.components.toast(`Comment ${record ? 'updated' : 'added'} successfully.`, 'success');
            NC.components.closeModal(); await load();
          } catch (error) { console.error(error); NC.components.toast(NC.api.userMessage(error, 'Unable to save the comment.'), 'error'); }
          finally { NC.utils.setButtonLoading(button, false); }
        });
      }
    });
  }

  async function toggleStatus(record, button) {
    const next = record.status === 'Publish' ? 'Unpublish' : 'Publish';
    NC.utils.setButtonLoading(button, true, '');
    try {
      await NC.api.update('comments', record.id, { status: next });
      NC.components.toast(`Comment ${next === 'Publish' ? 'published' : 'unpublished'} successfully.`, 'success');
      await load();
    } catch (error) { console.error(error); NC.components.toast(NC.api.userMessage(error, 'Unable to update comment status.'), 'error'); }
    finally { NC.utils.setButtonLoading(button, false); }
  }

  async function remove(record) {
    try { if (await NC.crud.deleteRecord({ table: 'comments', record, label: 'comment' })) await load(); }
    catch (error) { console.error(error); NC.components.toast(NC.api.userMessage(error, 'Unable to delete the comment.'), 'error'); }
  }

  async function load(context = {}) {
    const content = root.querySelector('[data-comments-content]'); content.innerHTML = NC.components.skeleton(7, 5);
    try {
      const [commentsResult, blogsResult, authorsResult] = await Promise.all([
        NC.api.list('comments', { select: '*', order: 'created_at.desc', limit: 3000 }),
        NC.api.list('blogs', { select: 'id,title,status,author_id,author_name', order: 'title.asc', limit: 3000 }),
        NC.api.list('authors', { select: 'id,title', order: 'title.asc', limit: 2000 }).catch(() => ({ data: [] }))
      ]);
      if (NC.crud.isStaleNavigation(context)) return;
      blogs = blogsResult.data; authors = authorsResult.data; state.setRecords(commentsResult.data);
      syncStateFilters(); fillFilterSelects(); renderList();
      const action = context.params?.get('action'), id = context.params?.get('id');
      if (action === 'new') openForm();
      if (id && ['view', 'edit'].includes(action)) { const record = state.records.find((item) => item.id === id); if (record) action === 'view' ? openView(record) : openForm(record); }
    } catch (error) { NC.crud.handleLoadError(content, error, () => load(context), context); }
  }

  function render(container, context = {}) {
    root = container;
    const params = context.params || new URLSearchParams();
    const initialStatus = params.get('filter') || 'all';
    filterValues.status = ['Publish', 'Unpublish'].includes(initialStatus) ? initialStatus : 'all';
    filterValues.blog_id = params.get('blog') || 'all';
    filterValues.author_id = params.get('author') || 'all';
    filterValues.commenter = params.get('user') ? `user:${params.get('user')}` : (params.get('commenter') || 'all');
    syncStateFilters();
    root.innerHTML = `
      ${NC.components.pageHeader({ eyebrow: 'Community', title: 'Comments', description: 'Review reader feedback and control what appears publicly.', breadcrumb: [{ label: 'Comments' }], actions: `${NC.importer.bulkButton('comments')}<button type="button" class="btn btn-primary" data-add-comment><i class="fa-regular fa-plus" aria-hidden="true"></i>Add comment</button>` })}
      <section class="surface"><div class="list-toolbar"><label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search comments</span><input type="search" placeholder="Search comments…" data-comment-search></label><select class="form-select toolbar-select" data-comment-status aria-label="Filter comment status"><option value="all">All statuses</option><option value="Unpublish">Needs moderation</option><option value="Publish">Published</option></select><select class="form-select toolbar-select toolbar-select-wide" data-comment-blog aria-label="Filter by blog"><option value="all">All blogs</option></select><select class="form-select toolbar-select toolbar-select-wide" data-comment-author aria-label="Filter by blog author"><option value="all">All blog authors</option></select><select class="form-select toolbar-select toolbar-select-wide" data-comment-commenter aria-label="Filter by commenter"><option value="all">All commenters</option></select></div><div class="active-filters hidden" data-comment-active-filters></div><div data-comments-content>${NC.components.skeleton(7, 5)}</div></section>`;
    root.querySelector('[data-add-comment]').addEventListener('click', () => openForm());
    root.querySelector('[data-comment-search]').addEventListener('input', debounce((event) => { state.setQuery(event.target.value); renderList(); }, 220));
    const status = root.querySelector('[data-comment-status]'); status.value = filterValues.status;
    status.addEventListener('change', (event) => applyFilter('status', event.target.value));
    root.querySelector('[data-comment-blog]').addEventListener('change', (event) => applyFilter('blog_id', event.target.value));
    root.querySelector('[data-comment-author]').addEventListener('change', (event) => applyFilter('author_id', event.target.value));
    root.querySelector('[data-comment-commenter]').addEventListener('change', (event) => applyFilter('commenter', event.target.value));
    NC.importer.bindBulk(root, { type: 'comments', onComplete: () => load(context) });
    return load(context);
  }

  NC.views.comments = { render };
})(window.NC);
