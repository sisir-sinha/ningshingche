(function (NC) {
  'use strict';

  const { escapeHTML, formatDateTime, debounce, formData, number, relativeTime, routeTo } = NC.utils;
  let root;
  let cache = emptyCache();

  function emptyCache() {
    return { users: [], articles: [], comments: [], messages: [], notices: [], inboxReady: true };
  }

  function displayName(user) {
    const composed = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return composed || user.name || user.email || 'Unnamed reader';
  }

  function userById(id) {
    return cache.users.find((item) => item.id === id) || null;
  }

  function relatedArticles(user) {
    if (!user) return [];
    return cache.articles.filter((item) => item.user_id === user.id
      || (user.email && String(item.writer_email || '').toLowerCase() === String(user.email).toLowerCase()));
  }

  function relatedComments(user) {
    if (!user) return [];
    return cache.comments.filter((item) => item.user_id === user.id
      || (user.email && String(item.email || '').toLowerCase() === String(user.email).toLowerCase()));
  }

  function appArticles() {
    const emails = new Set(cache.users.map((item) => String(item.email || '').toLowerCase()).filter(Boolean));
    const ids = new Set(cache.users.map((item) => item.id));
    return cache.articles.filter((item) => ids.has(item.user_id) || emails.has(String(item.writer_email || '').toLowerCase()));
  }

  function appComments() {
    const emails = new Set(cache.users.map((item) => String(item.email || '').toLowerCase()).filter(Boolean));
    const ids = new Set(cache.users.map((item) => item.id));
    return cache.comments.filter((item) => ids.has(item.user_id) || emails.has(String(item.email || '').toLowerCase()));
  }

  async function safeList(key, options) {
    try {
      return await NC.api.list(key, options);
    } catch (error) {
      if (error?.isSchemaMissing) return { data: [], missing: true };
      throw error;
    }
  }

  async function loadCache(context = {}) {
    const [profilesResult, submissionsResult, commentsResult, messagesResult, noticesResult] = await Promise.all([
      NC.api.list('profiles', { select: '*', order: 'created_at.desc', limit: 3000 }),
      safeList('submissions', { select: '*', order: 'created_at.desc', limit: 3000 }),
      safeList('comments', { select: '*', order: 'created_at.desc', limit: 3000 }),
      safeList('messages', { select: '*', order: 'created_at.desc', limit: 3000 }),
      safeList('notifications', { select: '*', order: 'created_at.desc', limit: 3000 })
    ]);
    if (NC.crud.isStaleNavigation(context)) return false;
    cache = {
      users: profilesResult.data,
      articles: submissionsResult.data,
      comments: commentsResult.data,
      messages: messagesResult.data,
      notices: noticesResult.data,
      inboxReady: !messagesResult.missing && !noticesResult.missing
    };
    return true;
  }

  function pageChrome(title, description, extra = '') {
    return `${NC.components.pageHeader({
      eyebrow: 'Registered users',
      title,
      description,
      breadcrumb: [{ label: 'Registered users', route: 'registered-users' }, { label: title }]
    })}${extra}`;
  }

  function bindList(state, renderList) {
    root.querySelector('[data-ru-search]')?.addEventListener('input', debounce((event) => {
      state.setQuery(event.target.value);
      renderList();
    }, 220));
  }

  function metrics() {
    const articles = appArticles();
    const comments = appComments();
    const published = articles.filter((item) => ['Published', 'Approved'].includes(item.status)).length;
    const pending = articles.filter((item) => item.status === 'Pending').length;
    const unreadNotices = cache.notices.filter((item) => !item.is_read).length;
    const userMessages = cache.messages.filter((item) => item.sender === 'user').length;
    const cards = [
      ['Users', cache.users.length, 'fa-users', 'teal'],
      ['Complete profiles', cache.users.filter((item) => item.profile_completed).length, 'fa-user-check', 'emerald'],
      ['Articles', articles.length, 'fa-file-pen', 'brand'],
      ['Published', published, 'fa-circle-check', 'emerald'],
      ['Pending articles', pending, 'fa-clock', 'amber'],
      ['Comments', comments.length, 'fa-comments', 'indigo'],
      ['Messages', cache.messages.length, 'fa-messages', 'sky'],
      ['User messages', userMessages, 'fa-inbox', 'cyan'],
      ['Notifications', cache.notices.length, 'fa-bell', 'violet'],
      ['Unread notices', unreadNotices, 'fa-bell-on', 'rose']
    ];
    return `<section class="metrics-grid" aria-label="Registered user metrics">${cards.map(([label, value, icon, tone]) => `
      <article class="metric-card metric-${tone}">
        <span class="metric-icon"><i class="fa-duotone fa-solid ${icon}" aria-hidden="true"></i></span>
        <div class="min-w-0"><p class="metric-label">${escapeHTML(label)}</p><p class="metric-value">${number(value)}</p></div>
        <span class="metric-detail"><i class="fa-regular fa-mobile" aria-hidden="true"></i>App data</span>
      </article>`).join('')}</section>`;
  }

  function recentBlock(title, items, empty, route) {
    if (!items.length) {
      return `<article class="surface"><div class="surface-header"><div><p class="eyebrow">Live feed</p><h2>${escapeHTML(title)}</h2></div></div>${NC.components.emptyState({ icon: 'fa-wave-pulse', title: empty, description: 'New app activity will appear here.' })}</article>`;
    }
    return `<article class="surface"><div class="surface-header"><div><p class="eyebrow">Live feed</p><h2>${escapeHTML(title)}</h2></div><button type="button" class="btn btn-ghost btn-sm" data-ru-goto="${escapeHTML(route)}">Open</button></div>
      <div class="activity-list">${items.slice(0, 8).map((item) => `
        <button type="button" class="activity-item" data-ru-open="${escapeHTML(item.route)}" data-ru-id="${escapeHTML(item.id || '')}">
          <span class="activity-icon"><i class="fa-regular fa-${escapeHTML(item.icon)}" aria-hidden="true"></i></span>
          <span class="activity-copy"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.meta)}</small></span>
          ${item.status ? NC.components.statusBadge(item.status) : ''}
        </button>`).join('')}</div></article>`;
  }

  function renderHome() {
    const articles = appArticles();
    const comments = appComments();
    root.innerHTML = `${pageChrome('Dashboard', 'Users, articles, comments, messages, and notifications pushed from the Android app.')}
      ${metrics()}
      <section class="dashboard-columns mt-6">
        ${recentBlock('Latest users', cache.users.map((user) => ({
          id: user.id, route: 'ru-users', icon: 'user', title: displayName(user),
          meta: `${user.email || 'No email'} · ${relativeTime(user.created_at)}`,
          status: user.profile_completed ? 'Complete' : 'Incomplete'
        })), 'No registered users yet', 'ru-users')}
        ${recentBlock('Latest articles', articles.map((item) => ({
          id: item.id, route: 'ru-articles', icon: 'file-pen', title: item.title || 'Untitled',
          meta: `${item.writer_name || 'Unknown writer'} · ${relativeTime(item.created_at)}`,
          status: item.status || 'Pending'
        })), 'No app articles yet', 'ru-articles')}
      </section>
      <section class="dashboard-columns mt-6">
        ${recentBlock('Latest comments', comments.map((item) => ({
          id: item.id, route: 'ru-comments', icon: 'comments', title: NC.utils.truncate(item.content, 90),
          meta: `${item.name || item.email || 'Reader'} · ${relativeTime(item.created_at)}`,
          status: item.status || 'Unpublish'
        })), 'No app comments yet', 'ru-comments')}
        ${recentBlock('Latest messages', cache.messages.map((item) => ({
          id: item.user_id, route: 'ru-messages', icon: 'messages', title: item.sender === 'admin' ? 'Admin reply' : 'User message',
          meta: `${NC.utils.truncate(item.body, 80)} · ${relativeTime(item.created_at)}`,
          status: item.sender
        })), 'No messages yet', 'ru-messages')}
      </section>
      <section class="mt-6">${recentBlock('Latest notifications', cache.notices.map((item) => ({
        id: item.id, route: 'ru-notifications', icon: 'bell', title: item.title || item.kind,
        meta: `${item.body || ''} · ${relativeTime(item.created_at)}`
      })), 'No notifications yet', 'ru-notifications')}</section>`;
    root.querySelectorAll('[data-ru-goto], [data-ru-open]').forEach((button) => {
      button.addEventListener('click', () => routeTo(button.dataset.ruGoto || button.dataset.ruOpen, button.dataset.ruId ? { id: button.dataset.ruId } : {}));
    });
  }

  function openUser(user) {
    const articles = relatedArticles(user);
    const comments = relatedComments(user);
    const messages = cache.messages.filter((item) => item.user_id === user.id);
    const notices = cache.notices.filter((item) => item.user_id === user.id);
    NC.components.openModal({
      title: displayName(user),
      eyebrow: 'Registered user',
      size: 'xl',
      content: `
        <div class="profile-preview compact">${NC.utils.avatarHTML(displayName(user), user.avatar_url, 'profile-preview-avatar')}<div><h3>${escapeHTML(displayName(user))}</h3><p>${escapeHTML(user.designation || user.email || 'Android app reader')}</p></div></div>
        <dl class="details-list mt-4">
          <div><dt>Email</dt><dd>${escapeHTML(user.email || '—')}</dd></div>
          <div><dt>Phone</dt><dd>${escapeHTML(user.phone || '—')}</dd></div>
          <div><dt>Address</dt><dd>${escapeHTML(user.address || '—')}</dd></div>
          <div><dt>Facebook</dt><dd>${escapeHTML(user.facebook_id || '—')}</dd></div>
          <div><dt>Profile</dt><dd>${user.profile_completed ? 'Complete' : 'Incomplete'}</dd></div>
        </dl>
        ${user.about ? `<p class="mt-4">${escapeHTML(user.about)}</p>` : ''}
        <p class="mt-6 text-muted-foreground">${articles.length} articles · ${comments.length} comments · ${messages.length} messages · ${notices.length} notices</p>
        <div class="button-row mt-4">
          <button type="button" class="btn btn-secondary" data-jump="ru-articles">Articles</button>
          <button type="button" class="btn btn-secondary" data-jump="ru-comments">Comments</button>
          <button type="button" class="btn btn-secondary" data-jump="ru-messages">Messages</button>
          <button type="button" class="btn btn-primary" data-jump="ru-notifications">Send notification</button>
        </div>`,
      footer: '<button type="button" class="btn btn-secondary" data-modal-close>Close</button>',
      onOpen: (modalRoot) => {
        modalRoot.querySelectorAll('[data-jump]').forEach((button) => button.addEventListener('click', () => {
          NC.components.closeModal();
          routeTo(button.dataset.jump, { id: user.id });
        }));
      }
    });
  }

  function renderUsers(context) {
    const state = new NC.crud.ListState('profiles', { searchFields: ['name', 'first_name', 'last_name', 'email', 'phone', 'facebook_id'], sortKey: 'created_at' });
    state.setRecords(cache.users);
    root.innerHTML = `${pageChrome('Users', 'Google accounts registered from the Android app.')}
      <section class="surface"><div class="list-toolbar"><label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search users</span><input type="search" placeholder="Search name, email, or phone…" data-ru-search></label></div><div data-ru-table></div></section>`;
    const renderList = () => {
      const content = root.querySelector('[data-ru-table]');
      const { rows, total } = state.paged();
      if (!total) {
        content.innerHTML = NC.components.emptyState({ icon: 'fa-users', title: state.query ? 'No users match' : 'No registered users yet', description: 'App Google sign-ins write into public.profiles.' });
        return;
      }
      content.innerHTML = `${NC.components.tableShell({
        caption: 'Registered app users', minWidth: '960px',
        head: `<tr><th>User</th><th>Profile</th><th>App data</th><th><button type="button" data-sort="created_at">Joined ${NC.crud.sortIcon(state, 'created_at')}</button></th><th class="text-right">Actions</th></tr>`,
        body: rows.map((user) => `<tr>
          <td data-label="User"><div class="person-cell">${NC.utils.avatarHTML(displayName(user), user.avatar_url, 'person-avatar')}<div><strong>${escapeHTML(displayName(user))}</strong><span>${escapeHTML(user.email || 'No email')}</span></div></div></td>
          <td data-label="Profile">${NC.components.statusBadge(user.profile_completed ? 'Complete' : 'Incomplete')}</td>
          <td data-label="App data"><small>${relatedArticles(user).length} articles · ${relatedComments(user).length} comments</small></td>
          <td data-label="Joined">${escapeHTML(formatDateTime(user.created_at))}</td>
          <td data-label="Actions" class="text-right">${NC.components.rowActions([{ action: 'view', id: user.id, label: 'Open user', icon: 'fa-eye' }])}</td>
        </tr>`).join('')
      })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
      content.querySelectorAll('[data-action]').forEach((button) => {
        const user = userById(button.dataset.id);
        if (user) button.addEventListener('click', () => openUser(user));
      });
      NC.crud.bindPagination(root, state, renderList);
      NC.crud.bindSort(root, state, renderList);
    };
    bindList(state, renderList);
    renderList();
    const id = context.params?.get('id');
    if (id && userById(id)) openUser(userById(id));
  }


  async function refreshScreen(renderFn, context = {}) {
    await loadCache();
    renderFn(context);
  }

  function articleById(id) {
    return cache.articles.find((item) => item.id === id) || null;
  }

  function commentById(id) {
    return cache.comments.find((item) => item.id === id) || null;
  }

  function noticeGroupMembers(item) {
    if (item?.kind === 'staff_notice' && item.related_id) {
      return cache.notices.filter((row) => row.kind === item.kind && row.related_id === item.related_id);
    }
    return cache.notices.filter((row) => row.id === item?.id);
  }

  function openArticleView(record, onEdit) {
    NC.components.openModal({
      title: record.title || 'Untitled article',
      eyebrow: record.status || 'Pending',
      size: 'xl',
      content: `
        <dl class="details-list">
          <div><dt>Writer</dt><dd>${escapeHTML(record.writer_name || record.writer_email || '—')}</dd></div>
          <div><dt>Email</dt><dd>${escapeHTML(record.writer_email || '—')}</dd></div>
          <div><dt>Status</dt><dd>${NC.components.statusBadge(record.status || 'Pending')}</dd></div>
          <div><dt>Submitted</dt><dd>${escapeHTML(formatDateTime(record.created_at))}</dd></div>
        </dl>
        <h3 class="section-mini-title mt-6">${escapeHTML(record.content_title || record.title || 'Article')}</h3>
        <div class="prose-content mt-4">${NC.utils.sanitizeHTML(record.content || '')}</div>`,
      footer: '<button type="button" class="btn btn-secondary" data-modal-close>Close</button><button type="button" class="btn btn-primary" data-article-edit><i class="fa-regular fa-pen" aria-hidden="true"></i>Edit</button>',
      onOpen: (modalRoot) => {
        modalRoot.querySelector('[data-article-edit]')?.addEventListener('click', () => {
          NC.components.closeModal();
          window.setTimeout(() => onEdit(record), 180);
        });
      }
    });
  }

  function openArticleForm(record, onSaved) {
    const statuses = ['Pending', 'Reviewed', 'Approved', 'Rejected', 'Published'];
    NC.components.openModal({
      title: 'Edit article',
      eyebrow: 'Registered users',
      size: 'xl',
      content: `<form id="ru-article-form" class="form-stack" novalidate>
        <div class="form-grid-2">
          <div class="field"><label class="field-label" for="ru-article-title">Title <span aria-hidden="true">*</span></label>
            <input class="form-input" id="ru-article-title" name="title" value="${escapeHTML(record.title || '')}" required>
            <p class="field-error hidden" data-field-error="title"></p></div>
          <div class="field"><label class="field-label" for="ru-article-status">Status</label>
            <select class="form-select" id="ru-article-status" name="status">
              ${statuses.map((status) => `<option value="${status}" ${status === (record.status || 'Pending') ? 'selected' : ''}>${status}</option>`).join('')}
            </select></div>
        </div>
        <div class="form-grid-2">
          <div class="field"><label class="field-label" for="ru-article-writer">Writer</label>
            <input class="form-input" id="ru-article-writer" name="writer_name" value="${escapeHTML(record.writer_name || '')}"></div>
          <div class="field"><label class="field-label" for="ru-article-email">Writer email</label>
            <input class="form-input" id="ru-article-email" name="writer_email" value="${escapeHTML(record.writer_email || '')}"></div>
        </div>
        <div class="field"><label class="field-label" for="ru-article-content">Content</label>
          <textarea class="form-textarea min-h-40" id="ru-article-content" name="content">${escapeHTML(record.content || '')}</textarea></div>
      </form>`,
      footer: '<button type="button" class="btn btn-secondary" data-modal-close>Cancel</button><button type="submit" form="ru-article-form" class="btn btn-primary"><i class="fa-regular fa-floppy-disk" aria-hidden="true"></i>Save</button>',
      onOpen: (modalRoot) => {
        modalRoot.querySelector('#ru-article-form')?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const data = formData(event.currentTarget);
          if (!NC.utils.validateFields(event.currentTarget, { title: data.title ? '' : 'Enter a title.' })) return;
          try {
            await NC.api.update('submissions', record.id, {
              title: data.title,
              content_title: data.title,
              writer_name: data.writer_name,
              writer_email: data.writer_email,
              content: data.content,
              status: data.status || record.status
            });
            NC.components.toast('Article saved.', 'success');
            NC.components.closeModal();
            await onSaved();
          } catch (error) {
            console.error(error);
            NC.components.toast(NC.api.userMessage(error, 'Unable to save article.'), 'error');
          }
        });
      }
    });
  }

  async function deleteArticle(record, onDeleted) {
    const deleted = await NC.crud.deleteRecord({
      table: 'submissions',
      record,
      label: 'article',
      remoteDeleteUrls: [record.imgbb_delete_url, record.writer_profile_delete_url].filter(Boolean)
    });
    if (deleted) await onDeleted();
  }

  function openCommentView(record, onEdit) {
    NC.components.openModal({
      title: record.name || record.email || 'Comment',
      eyebrow: record.status || 'Unpublish',
      size: 'lg',
      content: `
        <dl class="details-list">
          <div><dt>Article</dt><dd>${escapeHTML(record.blog_title || '—')}</dd></div>
          <div><dt>Email</dt><dd>${escapeHTML(record.email || '—')}</dd></div>
          <div><dt>Phone</dt><dd>${escapeHTML(record.phone || '—')}</dd></div>
          <div><dt>Received</dt><dd>${escapeHTML(formatDateTime(record.created_at))}</dd></div>
        </dl>
        <p class="mt-6">${escapeHTML(record.content || '')}</p>`,
      footer: '<button type="button" class="btn btn-secondary" data-modal-close>Close</button><button type="button" class="btn btn-primary" data-comment-edit><i class="fa-regular fa-pen" aria-hidden="true"></i>Edit</button>',
      onOpen: (modalRoot) => {
        modalRoot.querySelector('[data-comment-edit]')?.addEventListener('click', () => {
          NC.components.closeModal();
          window.setTimeout(() => onEdit(record), 180);
        });
      }
    });
  }

  function openCommentForm(record, onSaved) {
    NC.components.openModal({
      title: 'Edit comment',
      eyebrow: 'Registered users',
      size: 'lg',
      content: `<form id="ru-comment-form" class="form-stack" novalidate>
        <div class="form-grid-2">
          <div class="field"><label class="field-label" for="ru-comment-name">Name <span aria-hidden="true">*</span></label>
            <input class="form-input" id="ru-comment-name" name="name" value="${escapeHTML(record.name || '')}" required>
            <p class="field-error hidden" data-field-error="name"></p></div>
          <div class="field"><label class="field-label" for="ru-comment-status">Status</label>
            <select class="form-select" id="ru-comment-status" name="status">
              <option value="Unpublish" ${record.status !== 'Publish' ? 'selected' : ''}>Unpublish</option>
              <option value="Publish" ${record.status === 'Publish' ? 'selected' : ''}>Publish</option>
            </select></div>
        </div>
        <div class="field"><label class="field-label" for="ru-comment-content">Comment <span aria-hidden="true">*</span></label>
          <textarea class="form-textarea min-h-28" id="ru-comment-content" name="content" required>${escapeHTML(record.content || '')}</textarea>
          <p class="field-error hidden" data-field-error="content"></p></div>
      </form>`,
      footer: '<button type="button" class="btn btn-secondary" data-modal-close>Cancel</button><button type="submit" form="ru-comment-form" class="btn btn-primary"><i class="fa-regular fa-floppy-disk" aria-hidden="true"></i>Save</button>',
      onOpen: (modalRoot) => {
        modalRoot.querySelector('#ru-comment-form')?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const data = formData(event.currentTarget);
          if (!NC.utils.validateFields(event.currentTarget, {
            name: data.name ? '' : 'Enter a name.',
            content: data.content ? '' : 'Write a comment.'
          })) return;
          try {
            await NC.api.update('comments', record.id, {
              name: data.name,
              content: data.content,
              status: data.status || record.status
            });
            NC.components.toast('Comment saved.', 'success');
            NC.components.closeModal();
            await onSaved();
          } catch (error) {
            console.error(error);
            NC.components.toast(NC.api.userMessage(error, 'Unable to save comment.'), 'error');
          }
        });
      }
    });
  }

  async function deleteComment(record, onDeleted) {
    const deleted = await NC.crud.deleteRecord({ table: 'comments', record, label: 'comment' });
    if (deleted) await onDeleted();
  }

  function openNoticeView(item) {
    const user = userById(item.user_id);
    const audience = item.recipient_count > 1
      ? `${item.recipient_count} users`
      : (user ? displayName(user) : item.user_id);
    NC.components.openModal({
      title: item.title || 'Notification',
      eyebrow: item.kind || 'notice',
      size: 'lg',
      content: `
        <dl class="details-list">
          <div><dt>Audience</dt><dd>${escapeHTML(audience)}</dd></div>
          <div><dt>Kind</dt><dd>${escapeHTML(item.kind || '—')}</dd></div>
          <div><dt>Sent</dt><dd>${escapeHTML(formatDateTime(item.created_at))}</dd></div>
        </dl>
        <p class="mt-6">${escapeHTML(item.body || '')}</p>`
    });
  }

  function openNoticeForm(item, onSaved) {
    NC.components.openModal({
      title: 'Edit notification',
      eyebrow: 'Registered users',
      size: 'lg',
      content: `<form id="ru-notice-edit-form" class="form-stack" novalidate>
        <div class="field"><label class="field-label" for="ru-notice-edit-title">Title <span aria-hidden="true">*</span></label>
          <input class="form-input" id="ru-notice-edit-title" name="title" value="${escapeHTML(item.title || '')}" required>
          <p class="field-error hidden" data-field-error="title"></p></div>
        <div class="field"><label class="field-label" for="ru-notice-edit-body">Message <span aria-hidden="true">*</span></label>
          <textarea class="form-textarea min-h-28" id="ru-notice-edit-body" name="body" required>${escapeHTML(item.body || '')}</textarea>
          <p class="field-error hidden" data-field-error="body"></p></div>
      </form>`,
      footer: '<button type="button" class="btn btn-secondary" data-modal-close>Cancel</button><button type="submit" form="ru-notice-edit-form" class="btn btn-primary"><i class="fa-regular fa-floppy-disk" aria-hidden="true"></i>Save</button>',
      onOpen: (modalRoot) => {
        modalRoot.querySelector('#ru-notice-edit-form')?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const data = formData(event.currentTarget);
          if (!NC.utils.validateFields(event.currentTarget, {
            title: data.title ? '' : 'Enter a title.',
            body: data.body ? '' : 'Write a message.'
          })) return;
          try {
            const members = noticeGroupMembers(item);
            await Promise.all(members.map((row) => NC.api.update('notifications', row.id, {
              title: data.title,
              body: data.body
            })));
            NC.components.toast(members.length > 1 ? `Notification updated for ${members.length} users.` : 'Notification saved.', 'success');
            NC.components.closeModal();
            await onSaved();
          } catch (error) {
            console.error(error);
            NC.components.toast(NC.api.userMessage(error, 'Unable to save notification.'), 'error');
          }
        });
      }
    });
  }

  async function deleteNotice(item, onDeleted) {
    const members = noticeGroupMembers(item);
    const accepted = await NC.components.confirm({
      title: members.length > 1 ? 'Delete this broadcast?' : 'Delete notification?',
      description: members.length > 1
        ? `This will remove the notice from ${members.length} app users.`
        : `“${item.title || 'This notification'}” will be permanently removed.`,
      confirmLabel: 'Delete notification'
    });
    if (!accepted) return;
    try {
      await Promise.all(members.map((row) => NC.api.remove('notifications', row.id)));
      NC.components.toast('Notification deleted.', 'success');
      await onDeleted();
    } catch (error) {
      console.error(error);
      NC.components.toast(NC.api.userMessage(error, 'Unable to delete notification.'), 'error');
    }
  }

  function renderArticles(context = {}) {
    const state = new NC.crud.ListState('articles', { searchFields: ['title', 'writer_name', 'writer_email', 'content_title'], sortKey: 'created_at' });
    state.setRecords(appArticles());
    const reload = () => refreshScreen(renderArticles, context);
    root.innerHTML = `${pageChrome('Articles', 'Articles submitted by registered app users.')}
      <section class="surface"><div class="list-toolbar"><label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search articles</span><input type="search" placeholder="Search title or writer…" data-ru-search></label></div><div data-ru-table></div></section>`;
    const renderList = () => {
      const content = root.querySelector('[data-ru-table]');
      const { rows, total } = state.paged();
      if (!total) {
        content.innerHTML = NC.components.emptyState({ icon: 'fa-file-pen', title: state.query ? 'No articles match' : 'No app articles yet', description: 'Registered users submit articles from the Android dashboard.' });
        return;
      }
      content.innerHTML = `${NC.components.tableShell({
        caption: 'App articles', minWidth: '1080px',
        head: `<tr><th>Article</th><th>Writer</th><th>Status</th><th><button type="button" data-sort="created_at">Submitted ${NC.crud.sortIcon(state, 'created_at')}</button></th><th class="text-right">Actions</th></tr>`,
        body: rows.map((item) => `<tr>
          <td data-label="Article"><strong>${escapeHTML(item.title || 'Untitled')}</strong></td>
          <td data-label="Writer">${escapeHTML(item.writer_name || item.writer_email || '—')}</td>
          <td data-label="Status">${NC.components.statusBadge(item.status || 'Pending')}</td>
          <td data-label="Submitted">${escapeHTML(formatDateTime(item.created_at))}</td>
          <td data-label="Actions" class="text-right">${NC.components.rowActions([
            { action: 'view', id: item.id, label: 'View article', icon: 'fa-eye' },
            { action: 'edit', id: item.id, label: 'Edit article', icon: 'fa-pen' },
            { action: 'delete', id: item.id, label: 'Delete article', icon: 'fa-trash', danger: true }
          ])}</td>
        </tr>`).join('')
      })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
      content.querySelectorAll('[data-action]').forEach((button) => {
        const record = articleById(button.dataset.id);
        if (!record) return;
        button.addEventListener('click', () => {
          if (button.dataset.action === 'view') openArticleView(record, (item) => openArticleForm(item, reload));
          if (button.dataset.action === 'edit') openArticleForm(record, reload);
          if (button.dataset.action === 'delete') deleteArticle(record, reload);
        });
      });
      NC.crud.bindPagination(root, state, renderList);
      NC.crud.bindSort(root, state, renderList);
    };
    bindList(state, renderList);
    renderList();
    const openId = context.params?.get('id');
    if (openId && articleById(openId)) openArticleView(articleById(openId), (item) => openArticleForm(item, reload));
  }

  function renderComments(context = {}) {
    const state = new NC.crud.ListState('comments', { searchFields: ['name', 'email', 'content', 'blog_title'], sortKey: 'created_at' });
    state.setRecords(appComments());
    const reload = () => refreshScreen(renderComments, context);
    root.innerHTML = `${pageChrome('Comments', 'Comments left by registered app users.')}
      <section class="surface"><div class="list-toolbar"><label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search comments</span><input type="search" placeholder="Search comments…" data-ru-search></label></div><div data-ru-table></div></section>`;
    const renderList = () => {
      const content = root.querySelector('[data-ru-table]');
      const { rows, total } = state.paged();
      if (!total) {
        content.innerHTML = NC.components.emptyState({ icon: 'fa-comments', title: state.query ? 'No comments match' : 'No app comments yet' });
        return;
      }
      content.innerHTML = `${NC.components.tableShell({
        caption: 'App comments', minWidth: '1080px',
        head: `<tr><th>Comment</th><th>Article</th><th>Status</th><th><button type="button" data-sort="created_at">Received ${NC.crud.sortIcon(state, 'created_at')}</button></th><th class="text-right">Actions</th></tr>`,
        body: rows.map((item) => `<tr>
          <td data-label="Comment"><div class="comment-cell"><strong>${escapeHTML(item.name || item.email || 'Reader')}</strong><p>${escapeHTML(NC.utils.truncate(item.content, 120))}</p></div></td>
          <td data-label="Article">${escapeHTML(item.blog_title || '—')}</td>
          <td data-label="Status">${NC.components.statusBadge(item.status || 'Unpublish')}</td>
          <td data-label="Received">${escapeHTML(formatDateTime(item.created_at))}</td>
          <td data-label="Actions" class="text-right">${NC.components.rowActions([
            { action: 'view', id: item.id, label: 'View comment', icon: 'fa-eye' },
            { action: 'edit', id: item.id, label: 'Edit comment', icon: 'fa-pen' },
            { action: 'delete', id: item.id, label: 'Delete comment', icon: 'fa-trash', danger: true }
          ])}</td>
        </tr>`).join('')
      })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
      content.querySelectorAll('[data-action]').forEach((button) => {
        const record = commentById(button.dataset.id);
        if (!record) return;
        button.addEventListener('click', () => {
          if (button.dataset.action === 'view') openCommentView(record, (item) => openCommentForm(item, reload));
          if (button.dataset.action === 'edit') openCommentForm(record, reload);
          if (button.dataset.action === 'delete') deleteComment(record, reload);
        });
      });
      NC.crud.bindPagination(root, state, renderList);
      NC.crud.bindSort(root, state, renderList);
    };
    bindList(state, renderList);
    renderList();
    const openId = context.params?.get('id');
    if (openId && commentById(openId)) openCommentView(commentById(openId), (item) => openCommentForm(item, reload));
  }

  function threadFor(userId) {
    return cache.messages
      .filter((item) => item.user_id === userId)
      .slice()
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  }

  async function sendAdminReply(userId, body) {
    const record = await NC.api.insert('messages', {
      user_id: userId,
      sender: 'admin',
      subject: '',
      body,
      is_read: false
    });
    const unread = threadFor(userId).filter((item) => item.sender === 'user' && !item.is_read);
    await Promise.allSettled(unread.map((item) => NC.api.update('messages', item.id, { is_read: true })));
    if (record) cache.messages = [record, ...cache.messages.filter((item) => item.id !== record.id)];
    return record;
  }

  const chatTabs = new Map();
  const MAX_OPEN_CHATS = 3;

  function ensureChatDock() {
    let dock = document.getElementById('ru-chat-dock');
    if (dock) return dock;
    dock = document.createElement('div');
    dock.id = 'ru-chat-dock';
    dock.className = 'ru-chat-dock';
    dock.innerHTML = '<div class="ru-chat-windows" data-ru-chat-windows></div><div class="ru-chat-pills" data-ru-chat-pills></div>';
    document.body.appendChild(dock);
    return dock;
  }

  function chatIdentity(userId) {
    const user = userById(userId);
    const name = user ? displayName(user) : 'Reader';
    return {
      user,
      name,
      email: user?.email || '',
      avatar: NC.utils.avatarHTML(name, user?.avatar_url, 'ru-chat-head-avatar ru-chat-fallback')
    };
  }

  function bubblesHTML(userId) {
    const { name } = chatIdentity(userId);
    const thread = threadFor(userId);
    if (!thread.length) {
      return '<p class="text-muted-foreground" style="padding:8px">No messages yet. Write the first reply below.</p>';
    }
    return thread.map((item) => `
      <article class="ru-bubble ${item.sender === 'admin' ? 'is-admin' : 'is-user'}">
        <header><strong>${item.sender === 'admin' ? 'Admin' : escapeHTML(name)}</strong><time>${escapeHTML(formatDateTime(item.created_at))}</time></header>
        <p>${escapeHTML(item.body || '')}</p>
      </article>`).join('');
  }

  function fromCell(userId) {
    const user = userById(userId);
    return NC.utils.avatarHTML(user ? displayName(user) : 'User', user?.avatar_url, 'ru-from-avatar person-avatar');
  }

  function conversationRows() {
    const latest = new Map();
    cache.messages.forEach((item) => {
      if (!item.user_id) return;
      const prev = latest.get(item.user_id);
      if (!prev || String(item.created_at || '') > String(prev.created_at || '')) {
        latest.set(item.user_id, item);
      }
    });
    return [...latest.values()].map((item) => {
      const user = userById(item.user_id);
      const thread = threadFor(item.user_id);
      return {
        user_id: item.user_id,
        user_name: user ? displayName(user) : item.user_id,
        last_body: item.body || '',
        last_sender: item.sender || '',
        created_at: item.created_at || '',
        count: thread.length,
        unread: thread.filter((row) => row.sender === 'user' && !row.is_read).length
      };
    });
  }

  function renderChatDock() {
    const dock = ensureChatDock();
    const windows = dock.querySelector('[data-ru-chat-windows]');
    const pills = dock.querySelector('[data-ru-chat-pills]');
    const ids = [...chatTabs.keys()];
    if (!ids.length) {
      dock.classList.add('hidden');
      windows.replaceChildren();
      pills.replaceChildren();
      return;
    }
    dock.classList.remove('hidden');
    const openIds = ids.filter((id) => !chatTabs.get(id).minimized);
    const minIds = ids.filter((id) => chatTabs.get(id).minimized);
    windows.innerHTML = openIds.map((userId) => {
      const { name, email, avatar } = chatIdentity(userId);
      const sending = chatTabs.get(userId).sending;
      return `<section class="ru-chat-window" data-ru-chat="${escapeHTML(userId)}" role="dialog" aria-label="Conversation with ${escapeHTML(name)}">
        <header class="ru-chat-head" data-ru-chat-toggle="${escapeHTML(userId)}">
          ${avatar.replace('class=""', 'class="ru-chat-head-avatar"').replace('<span class="', '<span class="ru-chat-fallback ')}
          <div class="ru-chat-head-copy"><strong>${escapeHTML(name)}</strong><small>${escapeHTML(email || 'App user')}</small></div>
          <div class="ru-chat-head-actions">
            <button type="button" data-ru-chat-min="${escapeHTML(userId)}" aria-label="Minimize"><i class="fa-regular fa-minus" aria-hidden="true"></i></button>
            <button type="button" data-ru-chat-close="${escapeHTML(userId)}" aria-label="Close"><i class="fa-regular fa-xmark" aria-hidden="true"></i></button>
          </div>
        </header>
        <div class="ru-thread" data-ru-thread>${bubblesHTML(userId)}</div>
        <form class="ru-chat-compose" data-ru-chat-form="${escapeHTML(userId)}">
          <textarea name="body" rows="1" placeholder="Write a message…" ${sending ? 'disabled' : ''}></textarea>
          <button type="submit" ${sending ? 'disabled' : ''} aria-label="Send"><i class="fa-regular fa-paper-plane" aria-hidden="true"></i></button>
        </form>
      </section>`;
    }).join('');
    pills.innerHTML = minIds.map((userId) => {
      const { name, avatar } = chatIdentity(userId);
      return `<button type="button" class="ru-chat-pill" data-ru-chat-restore="${escapeHTML(userId)}" title="${escapeHTML(name)}">
        ${avatar}
        <span>${escapeHTML(name)}</span>
        <span data-ru-chat-close="${escapeHTML(userId)}" role="button" aria-label="Close" tabindex="0"><i class="fa-regular fa-xmark" aria-hidden="true"></i></span>
      </button>`;
    }).join('');
    windows.querySelectorAll('[data-ru-thread]').forEach((el) => { el.scrollTop = el.scrollHeight; });
    bindChatDock(dock);
    const focusId = openIds.at(-1);
    if (focusId) dock.querySelector(`[data-ru-chat="${CSS.escape(focusId)}"] textarea`)?.focus();
  }

  function bindChatDock(dock) {
    dock.querySelectorAll('[data-ru-chat-min]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const id = button.dataset.ruChatMin;
        const tab = chatTabs.get(id);
        if (tab) tab.minimized = true;
        renderChatDock();
      });
    });
    dock.querySelectorAll('[data-ru-chat-close]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        chatTabs.delete(button.dataset.ruChatClose);
        renderChatDock();
      });
    });
    dock.querySelectorAll('[data-ru-chat-toggle]').forEach((head) => {
      head.addEventListener('click', (event) => {
        if (event.target.closest('[data-ru-chat-min], [data-ru-chat-close]')) return;
        const id = head.dataset.ruChatToggle;
        const tab = chatTabs.get(id);
        if (tab) tab.minimized = true;
        renderChatDock();
      });
    });
    dock.querySelectorAll('[data-ru-chat-restore]').forEach((pill) => {
      pill.addEventListener('click', (event) => {
        if (event.target.closest('[data-ru-chat-close]')) return;
        openChat(pill.dataset.ruChatRestore);
      });
    });
    dock.querySelectorAll('[data-ru-chat-form]').forEach((form) => {
      const area = form.querySelector('textarea');
      area?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          form.requestSubmit();
        }
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const userId = form.dataset.ruChatForm;
        const body = String(new FormData(form).get('body') || '').trim();
        if (!body) return;
        const tab = chatTabs.get(userId);
        if (!tab || tab.sending) return;
        tab.sending = true;
        renderChatDock();
        try {
          await sendAdminReply(userId, body);
          NC.components.toast('Reply sent to the user’s Admin Message tab.', 'success');
          await loadCache();
        } catch (error) {
          console.error(error);
          NC.components.toast(NC.api.userMessage(error, 'Unable to send reply. Run migrations 007–010.'), 'error');
        } finally {
          if (chatTabs.has(userId)) chatTabs.get(userId).sending = false;
          renderChatDock();
        }
      });
    });
  }

  function openChat(userId) {
    if (!userId) return;
    if (!chatTabs.has(userId)) chatTabs.set(userId, { minimized: false, sending: false });
    else chatTabs.get(userId).minimized = false;
    const open = [...chatTabs.entries()].filter(([, tab]) => !tab.minimized);
    if (open.length > MAX_OPEN_CHATS) {
      open.slice(0, open.length - MAX_OPEN_CHATS).forEach(([id]) => {
        chatTabs.get(id).minimized = true;
      });
    }
    renderChatDock();
  }

  function openThread(userId) {
    openChat(userId);
  }

  function renderMessages(context = {}) {
    const state = new NC.crud.ListState('conversations', { searchFields: ['user_name', 'last_body'], sortKey: 'created_at' });
    state.setRecords(conversationRows());
    root.innerHTML = `${pageChrome('Messages', 'One row per user. Open a conversation to read the full thread.')}
      ${cache.inboxReady ? '' : `<div class="mb-6">${NC.components.notice('Run 007_user_inbox.sql so admin messages can be stored.', 'warning')}</div>`}
      <section class="surface"><div class="list-toolbar"><label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search conversations</span><input type="search" placeholder="Search people or messages…" data-ru-search></label></div><div data-ru-table></div></section>`;
    const renderList = () => {
      const content = root.querySelector('[data-ru-table]');
      const { rows, total } = state.paged();
      if (!total) {
        content.innerHTML = NC.components.emptyState({ icon: 'fa-messages', title: state.query ? 'No conversations match' : 'No messages yet' });
        return;
      }
      content.innerHTML = `${NC.components.tableShell({
        caption: 'Conversations', minWidth: '960px',
        head: `<tr><th>From</th><th>User</th><th>Last message</th><th><button type="button" data-sort="created_at">Updated ${NC.crud.sortIcon(state, 'created_at')}</button></th><th class="text-right">Actions</th></tr>`,
        body: rows.map((item) => {
          const preview = item.last_sender === 'admin' ? `Admin: ${item.last_body}` : item.last_body;
          const extra = item.count > 1 ? `<small>${item.count} messages${item.unread ? ` · ${item.unread} unread` : ''}</small>` : (item.unread ? '<small>Unread</small>' : '');
          return `<tr>
            <td data-label="From">${fromCell(item.user_id)}</td>
            <td data-label="User">${escapeHTML(item.user_name)}</td>
            <td data-label="Last message"><div>${escapeHTML(NC.utils.truncate(preview, 180))}</div>${extra}</td>
            <td data-label="Updated">${escapeHTML(formatDateTime(item.created_at))}</td>
            <td data-label="Actions" class="text-right">${NC.components.rowActions([
              { action: 'reply', id: item.user_id, label: 'Reply', icon: 'fa-reply' },
              { action: 'thread', id: item.user_id, label: 'Open conversation', icon: 'fa-comments' }
            ])}</td>
          </tr>`;
        }).join('')
      })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
      content.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => openChat(button.dataset.id));
      });
      NC.crud.bindPagination(root, state, renderList);
      NC.crud.bindSort(root, state, renderList);
    };
    bindList(state, renderList);
    renderList();
    const openId = context.params?.get('id');
    if (openId) openChat(openId);
  }

  function noticeAudienceUsers() {
    return cache.users.filter((user) => user?.id && user.notifications_enabled !== false);
  }

  function groupedNotices() {
    const groups = new Map();
    cache.notices.forEach((item) => {
      const key = item.kind === 'staff_notice' && item.related_id
        ? `${item.kind}:${item.related_id}`
        : item.id;
      const prev = groups.get(key);
      if (!prev) {
        groups.set(key, { ...item, recipient_count: 1 });
        return;
      }
      prev.recipient_count += 1;
      if (String(item.created_at || '') > String(prev.created_at || '')) {
        prev.created_at = item.created_at;
      }
    });
    return [...groups.values()];
  }

  function renderNotifications(context) {
    const state = new NC.crud.ListState('notices', { searchFields: ['title', 'body', 'kind'], sortKey: 'created_at' });
    state.setRecords(groupedNotices());
    const preselect = context.params?.get('id') || '';
    const enabledCount = noticeAudienceUsers().length;
    root.innerHTML = `${pageChrome('Notification', 'Send to one user, or to every app user who has notifications enabled.')}
      ${cache.inboxReady ? '' : `<div class="mb-6">${NC.components.notice('Run 007 and 009 so staff notices can be stored.', 'warning')}</div>`}
      <section class="surface">
        <div class="surface-header"><div><p class="eyebrow">Compose</p><h2>Send notification</h2></div></div>
        <form id="ru-notice-form" class="form-stack" novalidate>
          <div class="form-grid-2">
            <div class="field"><label class="field-label" for="ru-notice-user">Audience <span aria-hidden="true">*</span></label>
              <select class="form-select" id="ru-notice-user" name="user_id" required>
                <option value="__all_enabled__">All app users with notifications on (${enabledCount})</option>
                <option value="" disabled>—— One user ——</option>
                ${cache.users.map((user) => `<option value="${escapeHTML(user.id)}" ${user.id === preselect ? 'selected' : ''}>${escapeHTML(displayName(user))} — ${escapeHTML(user.email || 'no email')}</option>`).join('')}
              </select>
              <p class="field-error hidden" data-field-error="user_id"></p>
            </div>
            <div class="field"><label class="field-label" for="ru-notice-title">Title <span aria-hidden="true">*</span></label>
              <input class="form-input" id="ru-notice-title" name="title" required>
              <p class="field-error hidden" data-field-error="title"></p>
            </div>
          </div>
          <div class="field"><label class="field-label" for="ru-notice-body">Message <span aria-hidden="true">*</span></label>
            <textarea class="form-textarea min-h-28" id="ru-notice-body" name="body" required></textarea>
            <p class="field-error hidden" data-field-error="body"></p>
          </div>
          <div><button type="submit" class="btn btn-primary" data-send-notice><i class="fa-regular fa-paper-plane" aria-hidden="true"></i>Send notification</button></div>
        </form>
      </section>
      <section class="surface mt-6"><div class="list-toolbar"><label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search notices</span><input type="search" placeholder="Search sent notices…" data-ru-search></label></div><div data-ru-table></div></section>`;
    if (preselect) {
      const select = root.querySelector('#ru-notice-user');
      if (select) select.value = preselect;
    }
    root.querySelector('#ru-notice-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = formData(event.currentTarget);
      const errors = {
        user_id: data.user_id ? '' : 'Choose an audience.',
        title: data.title ? '' : 'Enter a title.',
        body: data.body ? '' : 'Write a message.'
      };
      if (!NC.utils.validateFields(event.currentTarget, errors)) return;
      const button = root.querySelector('[data-send-notice]');
      NC.utils.setButtonLoading(button, true, 'Sending…');
      try {
        const campaignId = NC.utils.uuid();
        const recipients = data.user_id === '__all_enabled__'
          ? noticeAudienceUsers()
          : cache.users.filter((user) => user.id === data.user_id);
        if (!recipients.length) throw new Error('No recipients. Users must have notifications enabled on the app.');
        const rows = recipients.map((user) => ({
          user_id: user.id,
          kind: 'staff_notice',
          title: data.title,
          body: data.body,
          related_id: campaignId,
          is_read: false
        }));
        const chunk = 80;
        for (let i = 0; i < rows.length; i += chunk) {
          await NC.api.insertMany('notifications', rows.slice(i, i + chunk));
        }
        NC.components.toast(
          recipients.length === 1
            ? 'Notification sent to the user’s app inbox.'
            : `Notification sent to ${recipients.length} app users. Devices with notification permission will alert.`,
          'success'
        );
        await loadCache();
        renderNotifications(context);
      } catch (error) {
        console.error(error);
        NC.components.toast(NC.api.userMessage(error, 'Unable to send. Run migration 009.'), 'error');
      } finally {
        NC.utils.setButtonLoading(button, false);
      }
    });
    const renderList = () => {
      const content = root.querySelector('[data-ru-table]');
      const { rows, total } = state.paged();
      if (!total) {
        content.innerHTML = NC.components.emptyState({ icon: 'fa-bell', title: 'No notifications yet' });
        return;
      }
      content.innerHTML = `${NC.components.tableShell({
        caption: 'Sent and generated notices', minWidth: '1080px',
        head: `<tr><th>User</th><th>Notice</th><th>Kind</th><th><button type="button" data-sort="created_at">Sent ${NC.crud.sortIcon(state, 'created_at')}</button></th><th class="text-right">Actions</th></tr>`,
        body: rows.map((item) => {
          const user = userById(item.user_id);
          const audience = item.recipient_count > 1
            ? `${item.recipient_count} users`
            : (user ? displayName(user) : item.user_id);
          return `<tr>
            <td data-label="User">${escapeHTML(audience)}</td>
            <td data-label="Notice"><strong>${escapeHTML(item.title)}</strong><div>${escapeHTML(NC.utils.truncate(item.body, 120))}</div></td>
            <td data-label="Kind">${escapeHTML(item.kind)}</td>
            <td data-label="Sent">${escapeHTML(formatDateTime(item.created_at))}</td>
            <td data-label="Actions" class="text-right">${NC.components.rowActions([
              { action: 'view', id: item.id, label: 'View notification', icon: 'fa-eye' },
              { action: 'edit', id: item.id, label: 'Edit notification', icon: 'fa-pen' },
              { action: 'delete', id: item.id, label: 'Delete notification', icon: 'fa-trash', danger: true }
            ])}</td>
          </tr>`;
        }).join('')
      })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
      content.querySelectorAll('[data-action]').forEach((button) => {
        const item = state.filtered().find((row) => row.id === button.dataset.id);
        if (!item) return;
        button.addEventListener('click', () => {
          if (button.dataset.action === 'view') openNoticeView(item);
          if (button.dataset.action === 'edit') openNoticeForm(item, () => refreshScreen(renderNotifications, context));
          if (button.dataset.action === 'delete') deleteNotice(item, () => refreshScreen(renderNotifications, context));
        });
      });
      NC.crud.bindPagination(root, state, renderList);
      NC.crud.bindSort(root, state, renderList);
    };
    bindList(state, renderList);
    renderList();
  }

  const screens = {
    'registered-users': renderHome,
    'ru-users': renderUsers,
    'ru-articles': renderArticles,
    'ru-comments': renderComments,
    'ru-messages': renderMessages,
    'ru-notifications': renderNotifications
  };

  async function render(container, context = {}) {
    root = container;
    const route = context.route || 'registered-users';
    root.innerHTML = `${pageChrome('Loading', 'Retrieving registered-user data from Supabase…')}${NC.components.skeleton(6, 4)}`;
    try {
      const ok = await loadCache(context);
      if (!ok) return;
      (screens[route] || renderHome)(context);
    } catch (error) {
      NC.crud.handleLoadError(root, error, () => render(container, context), context);
    }
  }

  Object.keys(screens).forEach((route) => {
    NC.views[route] = { render: (container, context) => render(container, { ...context, route }) };
  });
})(window.NC);
