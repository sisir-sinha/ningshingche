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
          id: item.id, route: 'ru-messages', icon: 'messages', title: item.sender === 'admin' ? 'Admin reply' : 'User message',
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

  function renderArticles() {
    const state = new NC.crud.ListState('articles', { searchFields: ['title', 'writer_name', 'writer_email', 'content_title'], sortKey: 'created_at' });
    state.setRecords(appArticles());
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
        caption: 'App articles', minWidth: '960px',
        head: `<tr><th>Article</th><th>Writer</th><th>Status</th><th><button type="button" data-sort="created_at">Submitted ${NC.crud.sortIcon(state, 'created_at')}</button></th></tr>`,
        body: rows.map((item) => `<tr>
          <td data-label="Article"><strong>${escapeHTML(item.title || 'Untitled')}</strong></td>
          <td data-label="Writer">${escapeHTML(item.writer_name || item.writer_email || '—')}</td>
          <td data-label="Status">${NC.components.statusBadge(item.status || 'Pending')}</td>
          <td data-label="Submitted">${escapeHTML(formatDateTime(item.created_at))}</td>
        </tr>`).join('')
      })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
      NC.crud.bindPagination(root, state, renderList);
      NC.crud.bindSort(root, state, renderList);
    };
    bindList(state, renderList);
    renderList();
  }

  function renderComments() {
    const state = new NC.crud.ListState('comments', { searchFields: ['name', 'email', 'content', 'blog_title'], sortKey: 'created_at' });
    state.setRecords(appComments());
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
        caption: 'App comments', minWidth: '960px',
        head: `<tr><th>Comment</th><th>Article</th><th>Status</th><th><button type="button" data-sort="created_at">Received ${NC.crud.sortIcon(state, 'created_at')}</button></th></tr>`,
        body: rows.map((item) => `<tr>
          <td data-label="Comment"><div class="comment-cell"><strong>${escapeHTML(item.name || item.email || 'Reader')}</strong><p>${escapeHTML(NC.utils.truncate(item.content, 120))}</p></div></td>
          <td data-label="Article">${escapeHTML(item.blog_title || '—')}</td>
          <td data-label="Status">${NC.components.statusBadge(item.status || 'Unpublish')}</td>
          <td data-label="Received">${escapeHTML(formatDateTime(item.created_at))}</td>
        </tr>`).join('')
      })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
      NC.crud.bindPagination(root, state, renderList);
      NC.crud.bindSort(root, state, renderList);
    };
    bindList(state, renderList);
    renderList();
  }

  function renderMessages() {
    const state = new NC.crud.ListState('messages', { searchFields: ['subject', 'body', 'sender'], sortKey: 'created_at' });
    state.setRecords(cache.messages);
    root.innerHTML = `${pageChrome('Messages', 'Conversation between registered users and editorial staff.')}
      ${cache.inboxReady ? '' : `<div class="mb-6">${NC.components.notice('Run 007_user_inbox.sql so admin messages can be stored.', 'warning')}</div>`}
      <section class="surface"><div class="list-toolbar"><label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search messages</span><input type="search" placeholder="Search messages…" data-ru-search></label></div><div data-ru-table></div></section>`;
    const renderList = () => {
      const content = root.querySelector('[data-ru-table]');
      const { rows, total } = state.paged();
      if (!total) {
        content.innerHTML = NC.components.emptyState({ icon: 'fa-messages', title: state.query ? 'No messages match' : 'No messages yet' });
        return;
      }
      content.innerHTML = `${NC.components.tableShell({
        caption: 'Admin messages', minWidth: '960px',
        head: `<tr><th>From</th><th>User</th><th>Message</th><th><button type="button" data-sort="created_at">Sent ${NC.crud.sortIcon(state, 'created_at')}</button></th></tr>`,
        body: rows.map((item) => {
          const user = userById(item.user_id);
          return `<tr>
            <td data-label="From">${NC.components.statusBadge(item.sender === 'admin' ? 'Admin' : 'User')}</td>
            <td data-label="User">${escapeHTML(user ? displayName(user) : item.user_id)}</td>
            <td data-label="Message"><strong>${escapeHTML(item.subject || '—')}</strong><div>${escapeHTML(NC.utils.truncate(item.body, 140))}</div></td>
            <td data-label="Sent">${escapeHTML(formatDateTime(item.created_at))}</td>
          </tr>`;
        }).join('')
      })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
      NC.crud.bindPagination(root, state, renderList);
      NC.crud.bindSort(root, state, renderList);
    };
    bindList(state, renderList);
    renderList();
  }

  function renderNotifications(context) {
    const state = new NC.crud.ListState('notices', { searchFields: ['title', 'body', 'kind'], sortKey: 'created_at' });
    state.setRecords(cache.notices);
    const preselect = context.params?.get('id') || '';
    root.innerHTML = `${pageChrome('Notification', 'Send an in-app notification to a particular registered user.')}
      ${cache.inboxReady ? '' : `<div class="mb-6">${NC.components.notice('Run 007 and 009 so staff notices can be stored.', 'warning')}</div>`}
      <section class="surface">
        <div class="surface-header"><div><p class="eyebrow">Compose</p><h2>Send notification</h2></div></div>
        <form id="ru-notice-form" class="form-stack" novalidate>
          <div class="form-grid-2">
            <div class="field"><label class="field-label" for="ru-notice-user">User <span aria-hidden="true">*</span></label>
              <select class="form-select" id="ru-notice-user" name="user_id" required>
                <option value="">Choose a registered user</option>
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
          <div><button type="submit" class="btn btn-primary" data-send-notice><i class="fa-regular fa-paper-plane" aria-hidden="true"></i>Send to this user</button></div>
        </form>
      </section>
      <section class="surface mt-6"><div class="list-toolbar"><label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search notices</span><input type="search" placeholder="Search sent notices…" data-ru-search></label></div><div data-ru-table></div></section>`;
    root.querySelector('#ru-notice-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = formData(event.currentTarget);
      const errors = {
        user_id: data.user_id ? '' : 'Choose a user.',
        title: data.title ? '' : 'Enter a title.',
        body: data.body ? '' : 'Write a message.'
      };
      if (!NC.utils.validateFields(event.currentTarget, errors)) return;
      const button = root.querySelector('[data-send-notice]');
      NC.utils.setButtonLoading(button, true, 'Sending…');
      try {
        await NC.api.insert('notifications', {
          user_id: data.user_id,
          kind: 'staff_notice',
          title: data.title,
          body: data.body,
          related_id: NC.utils.uuid(),
          is_read: false
        });
        NC.components.toast('Notification sent to the user’s app inbox.', 'success');
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
        caption: 'Sent and generated notices', minWidth: '960px',
        head: `<tr><th>User</th><th>Notice</th><th>Kind</th><th><button type="button" data-sort="created_at">Sent ${NC.crud.sortIcon(state, 'created_at')}</button></th></tr>`,
        body: rows.map((item) => {
          const user = userById(item.user_id);
          return `<tr>
            <td data-label="User">${escapeHTML(user ? displayName(user) : item.user_id)}</td>
            <td data-label="Notice"><strong>${escapeHTML(item.title)}</strong><div>${escapeHTML(NC.utils.truncate(item.body, 120))}</div></td>
            <td data-label="Kind">${escapeHTML(item.kind)}</td>
            <td data-label="Sent">${escapeHTML(formatDateTime(item.created_at))}</td>
          </tr>`;
        }).join('')
      })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
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
