(function (NC) {
  'use strict';

  const { escapeHTML, formatDateTime, debounce, formData } = NC.utils;
  const state = new NC.crud.ListState('profiles', {
    searchFields: ['name', 'first_name', 'last_name', 'email', 'phone', 'facebook_id', 'address'],
    sortKey: 'created_at'
  });
  let root;
  let submissions = [];
  let comments = [];
  let messages = [];
  let notices = [];
  let inboxReady = true;

  function displayName(user) {
    const composed = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return composed || user.name || user.email || 'Unnamed reader';
  }

  function relatedSubmissions(user) {
    return submissions.filter((item) => item.user_id === user.id
      || (user.email && String(item.writer_email || '').toLowerCase() === String(user.email).toLowerCase()));
  }

  function relatedComments(user) {
    return comments.filter((item) => item.user_id === user.id
      || (user.email && String(item.email || '').toLowerCase() === String(user.email).toLowerCase()));
  }

  function relatedMessages(user) {
    return messages.filter((item) => item.user_id === user.id);
  }

  function relatedNotices(user) {
    return notices.filter((item) => item.user_id === user.id);
  }

  function enrich(user) {
    const articles = relatedSubmissions(user);
    const userComments = relatedComments(user);
    const userMessages = relatedMessages(user);
    return {
      ...user,
      articleCount: articles.length,
      publishedCount: articles.filter((item) => ['Published', 'Approved'].includes(item.status)).length,
      pendingCount: articles.filter((item) => item.status === 'Pending').length,
      commentCount: userComments.length,
      messageCount: userMessages.length,
      unreadMessages: userMessages.filter((item) => item.sender === 'user' && !item.is_read).length
    };
  }

  function renderList() {
    const content = root.querySelector('[data-registered-users-content]');
    const { rows, total } = state.paged();
    if (!total) {
      content.innerHTML = NC.components.emptyState({
        icon: 'fa-user-group',
        title: state.query ? 'No registered users match your search' : 'No app users yet',
        description: state.query
          ? 'Try a different name, email, or phone number.'
          : 'Google sign-ins from the Android app write into public.profiles. Run migrations 005–008 if this list stays empty.'
      });
      return;
    }
    const body = rows.map((user) => {
      const row = enrich(user);
      return `
        <tr>
          <td data-label="User">
            <div class="person-cell">
              ${NC.utils.avatarHTML(displayName(row), row.avatar_url, 'person-avatar')}
              <div>
                <strong>${escapeHTML(displayName(row))}</strong>
                <span>${escapeHTML(row.email || 'No email')}</span>
              </div>
            </div>
          </td>
          <td data-label="Profile">${row.profile_completed
            ? NC.components.statusBadge('Complete')
            : NC.components.statusBadge('Incomplete')}</td>
          <td data-label="App data">
            <small>${row.articleCount} articles · ${row.commentCount} comments · ${row.messageCount} messages</small>
          </td>
          <td data-label="Joined"><time datetime="${escapeHTML(row.created_at || '')}">${escapeHTML(formatDateTime(row.created_at))}</time></td>
          <td data-label="Actions" class="text-right">${NC.components.rowActions([
            { action: 'view', id: row.id, label: 'Open registered user', icon: 'fa-eye' }
          ])}</td>
        </tr>`;
    }).join('');
    content.innerHTML = `${NC.components.tableShell({
      caption: 'Registered Android app users',
      minWidth: '980px',
      head: `<tr><th>User</th><th>Profile</th><th>App data</th><th><button type="button" data-sort="created_at">Joined ${NC.crud.sortIcon(state, 'created_at')}</button></th><th class="text-right">Actions</th></tr>`,
      body
    })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
    content.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const record = state.records.find((item) => item.id === button.dataset.id);
        if (record) openUser(record);
      });
    });
    NC.crud.bindPagination(root, state, renderList);
    NC.crud.bindSort(root, state, renderList);
  }

  function listBlock(title, empty, items) {
    if (!items.length) return `<section class="mt-6"><h3 class="section-mini-title">${escapeHTML(title)}</h3><p class="text-muted-foreground mt-2">${escapeHTML(empty)}</p></section>`;
    return `<section class="mt-6"><h3 class="section-mini-title">${escapeHTML(title)}</h3><div class="activity-list mt-3">${items.map((item) => `
      <div class="activity-item">
        <span class="activity-copy"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.meta || '')}</small></span>
        ${item.status ? NC.components.statusBadge(item.status) : ''}
      </div>`).join('')}</div></section>`;
  }

  function openUser(user) {
    const articles = relatedSubmissions(user);
    const userComments = relatedComments(user);
    const userMessages = relatedMessages(user);
    const userNotices = relatedNotices(user);
    NC.components.openModal({
      title: displayName(user),
      eyebrow: 'Registered user',
      size: 'xl',
      content: `
        <div class="profile-preview compact">
          ${NC.utils.avatarHTML(displayName(user), user.avatar_url, 'profile-preview-avatar')}
          <div>
            <h3>${escapeHTML(displayName(user))}</h3>
            <p>${escapeHTML(user.designation || user.email || 'Android app reader')}</p>
          </div>
        </div>
        <dl class="details-list mt-4">
          <div><dt>Email</dt><dd>${escapeHTML(user.email || '—')}</dd></div>
          <div><dt>Phone</dt><dd>${escapeHTML(user.phone || '—')}</dd></div>
          <div><dt>Address</dt><dd>${escapeHTML(user.address || '—')}</dd></div>
          <div><dt>Facebook</dt><dd>${escapeHTML(user.facebook_id || '—')}</dd></div>
          <div><dt>Location</dt><dd>${escapeHTML(user.location || '—')}</dd></div>
          <div><dt>Profile</dt><dd>${user.profile_completed ? 'Complete' : 'Incomplete'}</dd></div>
        </dl>
        ${user.about ? `<p class="mt-4">${escapeHTML(user.about)}</p>` : ''}
        ${listBlock('Articles from the app', 'This user has not submitted an article yet.', articles.map((item) => ({
          title: item.title || 'Untitled',
          meta: `${item.writer_name || displayName(user)} · ${formatDateTime(item.created_at)}`,
          status: item.status || 'Pending'
        })))}
        ${listBlock('Comments', 'No comments from this account.', userComments.map((item) => ({
          title: NC.utils.truncate(item.content, 140),
          meta: `${item.blog_title || 'Article'} · ${formatDateTime(item.created_at)}`,
          status: item.status || 'Unpublish'
        })))}
        ${listBlock('Notifications', inboxReady ? 'No in-app notices yet.' : 'Run migration 007 to store notices.', userNotices.map((item) => ({
          title: item.title || item.kind,
          meta: item.body || formatDateTime(item.created_at)
        })))}
        ${listBlock('Messages', inboxReady ? 'No messages yet.' : 'Run migration 007 to store admin messages.', userMessages.map((item) => ({
          title: item.sender === 'admin' ? 'Admin' : 'User',
          meta: [item.subject, item.body].filter(Boolean).join(' — '),
          status: item.sender
        })))}
        ${inboxReady ? `<form id="registered-user-reply" class="form-stack mt-6" novalidate>
          <div class="field"><label class="field-label" for="registered-reply-subject">Reply subject</label><input class="form-input" id="registered-reply-subject" name="subject" placeholder="Optional"></div>
          <div class="field"><label class="field-label" for="registered-reply-body">Message to this user <span aria-hidden="true">*</span></label><textarea class="form-textarea min-h-28" id="registered-reply-body" name="body" required></textarea></div>
        </form>` : ''}
      `,
      footer: `<button type="button" class="btn btn-secondary" data-modal-close>Close</button>${inboxReady ? '<button type="submit" form="registered-user-reply" class="btn btn-primary" data-send-user-reply><i class="fa-regular fa-paper-plane" aria-hidden="true"></i>Send reply</button>' : ''}`,
      onOpen: (modalRoot) => {
        const form = modalRoot.querySelector('#registered-user-reply');
        if (!form) return;
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const data = formData(form);
          if (!data.body) {
            NC.components.toast('Write a message before sending.', 'warning');
            return;
          }
          const button = modalRoot.querySelector('[data-send-user-reply]');
          NC.utils.setButtonLoading(button, true, 'Sending…');
          try {
            await NC.api.insert('messages', {
              user_id: user.id,
              sender: 'admin',
              subject: data.subject || '',
              body: data.body
            });
            NC.components.toast('Reply sent to the app inbox.', 'success');
            NC.components.closeModal();
            await load();
          } catch (error) {
            console.error(error);
            NC.components.toast(NC.api.userMessage(error, 'Unable to send the reply. Run migration 008.'), 'error');
          } finally {
            NC.utils.setButtonLoading(button, false);
          }
        });
      }
    });
  }

  async function safeList(key, options) {
    try {
      return await NC.api.list(key, options);
    } catch (error) {
      if (error?.isSchemaMissing) return { data: [], missing: true };
      throw error;
    }
  }

  async function load(context = {}) {
    const content = root.querySelector('[data-registered-users-content]');
    if (content) content.innerHTML = NC.components.skeleton(7, 5);
    try {
      const [profilesResult, submissionsResult, commentsResult, messagesResult, noticesResult] = await Promise.all([
        NC.api.list('profiles', { select: '*', order: 'created_at.desc', limit: 3000 }),
        safeList('submissions', { select: 'id,title,status,writer_name,writer_email,user_id,created_at', order: 'created_at.desc', limit: 3000 }),
        safeList('comments', { select: 'id,name,email,content,status,blog_title,user_id,created_at', order: 'created_at.desc', limit: 3000 }),
        safeList('messages', { select: '*', order: 'created_at.desc', limit: 3000 }),
        safeList('notifications', { select: '*', order: 'created_at.desc', limit: 3000 })
      ]);
      if (NC.crud.isStaleNavigation(context)) return;
      submissions = submissionsResult.data;
      comments = commentsResult.data;
      messages = messagesResult.data;
      notices = noticesResult.data;
      inboxReady = !messagesResult.missing && !noticesResult.missing;
      state.setRecords(profilesResult.data);
      const complete = root.querySelector('[data-registered-complete]');
      const pending = root.querySelector('[data-registered-articles]');
      const inbox = root.querySelector('[data-registered-messages]');
      if (complete) complete.textContent = profilesResult.data.filter((item) => item.profile_completed).length.toLocaleString();
      if (pending) pending.textContent = submissions.filter((item) => item.user_id).length.toLocaleString();
      if (inbox) inbox.textContent = messages.filter((item) => item.sender === 'user').length.toLocaleString();
      renderList();
      const id = context.params?.get('id');
      if (id) {
        const record = state.records.find((item) => item.id === id);
        if (record) openUser(record);
      }
    } catch (error) {
      NC.crud.handleLoadError(content || root, error, () => load(context), context);
    }
  }

  function render(container, context = {}) {
    root = container;
    root.innerHTML = `
      ${NC.components.pageHeader({
        eyebrow: 'Android app',
        title: 'Registered users',
        description: 'Google accounts from the Ningshing Che app, with the articles, comments, notices, and admin messages they pushed.',
        breadcrumb: [{ label: 'Registered users' }]
      })}
      <section class="submission-summary">
        <article><span class="metric-icon metric-brand"><i class="fa-regular fa-user-check" aria-hidden="true"></i></span><div><small>Complete profiles</small><strong data-registered-complete>—</strong></div></article>
        <article><span class="metric-icon metric-amber"><i class="fa-regular fa-file-pen" aria-hidden="true"></i></span><div><small>App articles</small><strong data-registered-articles>—</strong></div></article>
        <article><span class="metric-icon metric-sky"><i class="fa-regular fa-messages" aria-hidden="true"></i></span><div><small>User messages</small><strong data-registered-messages>—</strong></div></article>
        <article class="submission-help"><i class="fa-regular fa-mobile" aria-hidden="true"></i><p>This is not staff CMS login. It is the registered reader/author area from the Android app. Run SQL migrations 005–008 if rows do not appear.</p></article>
      </section>
      <section class="surface mt-5">
        <div class="list-toolbar">
          <label class="search-field">
            <i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i>
            <span class="sr-only">Search registered users</span>
            <input type="search" placeholder="Search name, email, or phone…" data-registered-search>
          </label>
        </div>
        <div data-registered-users-content>${NC.components.skeleton(7, 5)}</div>
      </section>`;
    root.querySelector('[data-registered-search]').addEventListener('input', debounce((event) => {
      state.setQuery(event.target.value);
      renderList();
    }, 220));
    return load(context);
  }

  NC.views['registered-users'] = { render };
})(window.NC);
