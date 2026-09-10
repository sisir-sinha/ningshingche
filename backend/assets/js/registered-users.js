(function (NC) {
  'use strict';

  const { escapeHTML, formatDateTime, debounce, formData, number, relativeTime, routeTo, safeImage, slugify } = NC.utils;
  let root;
  let cache = emptyCache();
  let charts = [];
  let articleEditor = null;      // Quill controller while the article editor is open
  let articleEditorCleanup = null;

  function emptyCache() {
    return { users: [], articles: [], comments: [], messages: [], notices: [], tracks: [], categories: [], authors: [], inboxReady: true };
  }

  function destroyCharts() {
    charts.forEach((chart) => chart?.destroy?.());
    charts = [];
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

  function trackOwner(record) {
    if (!record) return null;
    if (record.user_id) {
      const byId = userById(record.user_id);
      if (byId) return byId;
    }
    const match = String(record.file_storage_path || '').match(/^user\/([^/]+)\//);
    return match ? userById(match[1]) : null;
  }

  function relatedTracks(user) {
    if (!user) return [];
    return cache.tracks.filter((item) => trackOwner(item)?.id === user.id || item.user_id === user.id);
  }

  function isAppTrack(record) {
    if (!record) return false;
    if (record.user_id) return true;
    return String(record.file_storage_path || '').startsWith('user/');
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

  function appTracks() {
    return cache.tracks.filter(isAppTrack);
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
    const optional = (key, options) => NC.api.list(key, options).catch(() => ({ data: [] }));
    const [profilesResult, submissionsResult, commentsResult, messagesResult, noticesResult, tracksResult, categoriesResult, authorsResult] = await Promise.all([
      NC.api.list('profiles', { select: '*', order: 'created_at.desc', limit: 3000 }),
      safeList('submissions', { select: '*', order: 'created_at.desc', limit: 3000 }),
      safeList('comments', { select: '*', order: 'created_at.desc', limit: 3000 }),
      safeList('messages', { select: '*', order: 'created_at.desc', limit: 3000 }),
      safeList('notifications', { select: '*', order: 'created_at.desc', limit: 3000 }),
      safeList('music', { select: '*', order: 'created_at.desc', limit: 3000 }),
      optional('categories', { select: 'id,title,slug', order: 'title.asc', limit: 1000 }),
      optional('authors', { select: 'id,title,image', order: 'title.asc', limit: 2000 })
    ]);
    if (NC.crud.isStaleNavigation(context)) return false;
    cache = {
      users: profilesResult.data,
      articles: submissionsResult.data,
      comments: commentsResult.data,
      messages: messagesResult.data,
      notices: noticesResult.data,
      tracks: tracksResult.data,
      categories: categoriesResult.data,
      authors: authorsResult.data,
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

  /** Which registered user does a record belong to? Matches user_id, then e-mail. */
  function ownerOf(record, emailField) {
    if (!record) return null;
    if (record.user_id) { const byId = userById(record.user_id); if (byId) return byId; }
    const email = String(record[emailField] || '').toLowerCase();
    if (!email) return null;
    return cache.users.find((user) => String(user.email || '').toLowerCase() === email) || null;
  }

  function userFilterOptions(records, emailField) {
    const counts = new Map();
    records.forEach((record) => { const owner = ownerOf(record, emailField); if (owner) counts.set(owner.id, (counts.get(owner.id) || 0) + 1); });
    return cache.users
      .filter((user) => counts.has(user.id))
      .map((user) => ({ value: user.id, label: `${displayName(user)}${user.email ? ` — ${user.email}` : ''}`, count: counts.get(user.id) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'bn'));
  }

  function userFilterSelect(records, emailField, attr, label) {
    return NC.crud.filterSelect(userFilterOptions(records, emailField), { attr, label, placeholder: 'All users', wide: true });
  }

  function bindUserFilter(state, renderList, attr, emailField, chipsHost, extraChips = () => []) {
    const select = root.querySelector(`[${attr}]`);
    if (!select) return () => {};
    const apply = () => {
      const value = select.value;
      state.setFilter('__user', value && value !== 'all' ? (_, record) => ownerOf(record, emailField)?.id === value : 'all');
      renderList();
      const host = root.querySelector(chipsHost);
      if (host) NC.crud.renderActiveFilters(host, [
        { key: 'user', label: 'User', value: value && value !== 'all' ? displayName(userById(value) || {}) : '' },
        ...extraChips()
      ], {
        onRemove: (key) => { if (key === 'user') { select.value = 'all'; apply(); } else extraChips().find((chip) => chip.key === key)?.remove?.(); },
        onClear: () => { select.value = 'all'; extraChips().forEach((chip) => chip.remove?.()); apply(); }
      });
    };
    select.addEventListener('change', apply);
    return { apply, select };
  }

  function metrics() {
    const articles = appArticles();
    const comments = appComments();
    const tracks = appTracks();
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
      ['Songs', tracks.length, 'fa-music', 'rose'],
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

  function chartCard(title, description, canvasId, className = '') {
    return `<article class="surface chart-card ${className}"><div class="surface-header"><div><h2>${escapeHTML(title)}</h2><p>${escapeHTML(description)}</p></div></div><div class="chart-wrap"><canvas id="${escapeHTML(canvasId)}" role="img" aria-label="${escapeHTML(title)} chart"></canvas></div></article>`;
  }

  function monthlyBuckets(months = 6) {
    const now = new Date();
    const buckets = [];
    for (let offset = months - 1; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      buckets.push({ key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: new Intl.DateTimeFormat(NC_CONFIG.app.locale, { month: 'short', year: '2-digit' }).format(date), count: 0 });
    }
    return buckets;
  }

  function monthlyCounts(records, months = 6) {
    return NC.utils.groupMonthly(records, months).map((item) => item.count);
  }

  function dailyBuckets(days = 14) {
    const today = new Date();
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - index));
      return { key: date.toISOString().slice(0, 10), label: new Intl.DateTimeFormat(NC_CONFIG.app.locale, { day: 'numeric', month: 'short' }).format(date), count: 0 };
    });
  }

  function dailyCounts(records, days = 14) {
    const buckets = dailyBuckets(days);
    const map = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    records.forEach((record) => {
      const date = NC.utils.toDate(record.created_at);
      if (!date) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      if (map.has(key)) map.get(key).count += 1;
    });
    return { labels: buckets.map((bucket) => bucket.label), counts: buckets.map((bucket) => bucket.count) };
  }

  function topContributors(limit = 8) {
    const rows = cache.users.map((user) => ({
      user,
      name: displayName(user),
      articles: relatedArticles(user).length,
      comments: relatedComments(user).length,
      messages: cache.messages.filter((item) => item.user_id === user.id && item.sender === 'user').length
    })).map((row) => ({ ...row, total: row.articles + row.comments + row.messages }))
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'bn'));
    return rows.slice(0, limit);
  }

  function renderHomeCharts() {
    destroyCharts();
    if (!window.Chart) {
      root.querySelectorAll('.chart-wrap').forEach((node) => { node.innerHTML = NC.components.notice('Chart.js did not load. Check your connection and refresh.', 'warning'); });
      return;
    }
    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--muted-foreground').trim() || '#94a3b8';
    const grid = css.getPropertyValue('--border').trim() || 'rgba(148,163,184,.15)';
    const palette = { brand: '#8b5cf6', emerald: '#22c55e', sky: '#38bdf8', amber: '#f59e0b', rose: '#f43f5e', indigo: '#6366f1', teal: '#14b8a6', slate: '#94a3b8', fuchsia: '#d946ef' };
    const common = {
      responsive: true, maintainAspectRatio: false, animation: { duration: 450 },
      plugins: { legend: { labels: { color: text, usePointStyle: true, boxWidth: 8, padding: 16 } } },
      scales: {
        x: { ticks: { color: text, maxRotation: 0, autoSkip: true }, grid: { display: false }, border: { display: false } },
        y: { beginAtZero: true, ticks: { color: text, precision: 0 }, grid: { color: grid }, border: { display: false } }
      }
    };
    const articles = appArticles();
    const comments = appComments();
    const userMessages = cache.messages.filter((item) => item.sender === 'user');
    const adminMessages = cache.messages.filter((item) => item.sender === 'admin');
    const labels = monthlyBuckets(6).map((bucket) => bucket.label);
    const mount = (id, config) => { const canvas = document.getElementById(id); if (canvas) charts.push(new Chart(canvas, config)); };

    // 1. Sign-ups + activity over six months
    mount('ru-chart-growth', {
      type: 'line',
      data: { labels, datasets: [
        { label: 'New users', data: monthlyCounts(cache.users), borderColor: palette.teal, backgroundColor: `${palette.teal}22`, tension: .35, fill: true, pointRadius: 3 },
        { label: 'Articles', data: monthlyCounts(articles), borderColor: palette.brand, backgroundColor: `${palette.brand}22`, tension: .35, pointRadius: 3 },
        { label: 'Comments', data: monthlyCounts(comments), borderColor: palette.indigo, backgroundColor: `${palette.indigo}22`, tension: .35, pointRadius: 3 },
        { label: 'User messages', data: monthlyCounts(userMessages), borderColor: palette.sky, backgroundColor: `${palette.sky}22`, tension: .35, pointRadius: 3 }
      ] },
      options: common
    });

    // 2. Article status doughnut
    const statuses = ['Pending', 'Reviewed', 'Approved', 'Published', 'Rejected'];
    const statusColors = [palette.amber, palette.sky, palette.emerald, palette.teal, palette.rose];
    mount('ru-chart-status', {
      type: 'doughnut',
      data: { labels: statuses, datasets: [{ data: statuses.map((status) => articles.filter((item) => (item.status || 'Pending') === status).length), backgroundColor: statusColors, borderWidth: 0, hoverOffset: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'bottom', labels: common.plugins.legend.labels } } }
    });

    // 3. Profile completion + notification opt-in
    const complete = cache.users.filter((item) => item.profile_completed).length;
    const optIn = cache.users.filter((item) => item.notifications_enabled !== false).length;
    mount('ru-chart-profiles', {
      type: 'bar',
      data: { labels: ['Profile complete', 'Profile incomplete', 'Notifications on', 'Notifications off'], datasets: [{ label: 'Users', data: [complete, cache.users.length - complete, optIn, cache.users.length - optIn], backgroundColor: [palette.emerald, palette.slate, palette.brand, palette.slate], borderRadius: 8, borderSkipped: false }] },
      options: { ...common, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ...common.scales.y }, y: { ...common.scales.x } } }
    });

    // 4. Daily messages: user vs admin (14 days)
    const userDaily = dailyCounts(userMessages);
    const adminDaily = dailyCounts(adminMessages);
    mount('ru-chart-messages', {
      type: 'bar',
      data: { labels: userDaily.labels, datasets: [
        { label: 'From users', data: userDaily.counts, backgroundColor: palette.sky, borderRadius: 6, borderSkipped: false, stack: 'm' },
        { label: 'Admin replies', data: adminDaily.counts, backgroundColor: palette.brand, borderRadius: 6, borderSkipped: false, stack: 'm' }
      ] },
      options: { ...common, scales: { x: { ...common.scales.x, stacked: true }, y: { ...common.scales.y, stacked: true } } }
    });

    // 5. Most active users (stacked horizontal)
    const top = topContributors(8);
    const topCanvas = document.getElementById('ru-chart-top');
    if (topCanvas && !top.length) topCanvas.closest('.chart-wrap').innerHTML = '<div class="chart-empty">No user activity yet.</div>';
    else mount('ru-chart-top', {
      type: 'bar',
      data: { labels: top.map((row) => row.name), datasets: [
        { label: 'Articles', data: top.map((row) => row.articles), backgroundColor: palette.brand, stack: 'a', borderRadius: 4 },
        { label: 'Comments', data: top.map((row) => row.comments), backgroundColor: palette.indigo, stack: 'a', borderRadius: 4 },
        { label: 'Messages', data: top.map((row) => row.messages), backgroundColor: palette.sky, stack: 'a', borderRadius: 4 }
      ] },
      options: { ...common, indexAxis: 'y', scales: { x: { ...common.scales.y, stacked: true }, y: { ...common.scales.x, stacked: true } } }
    });

    // 6. Notification kinds + read state
    const kinds = [...new Set(cache.notices.map((item) => item.kind || 'notice'))].slice(0, 8);
    mount('ru-chart-notices', {
      type: 'bar',
      data: { labels: kinds.map((kind) => kind.replace(/_/g, ' ')), datasets: [
        { label: 'Read', data: kinds.map((kind) => cache.notices.filter((item) => (item.kind || 'notice') === kind && item.is_read).length), backgroundColor: palette.emerald, stack: 'n', borderRadius: 4 },
        { label: 'Unread', data: kinds.map((kind) => cache.notices.filter((item) => (item.kind || 'notice') === kind && !item.is_read).length), backgroundColor: palette.rose, stack: 'n', borderRadius: 4 }
      ] },
      options: { ...common, scales: { x: { ...common.scales.x, stacked: true }, y: { ...common.scales.y, stacked: true } } }
    });
  }

  function renderHome() {
    const articles = appArticles();
    const comments = appComments();
    root.innerHTML = `${pageChrome('Dashboard', 'Users, articles, songs, comments, messages, and notifications pushed from the Android app.')}
      ${metrics()}
      <section class="ru-chart-grid mt-6" aria-label="Registered user charts">
        ${chartCard('Growth & activity', 'New sign-ups, articles, comments, and user messages per month.', 'ru-chart-growth', 'chart-wide')}
        ${chartCard('Article status', 'Where registered-user submissions sit in the review flow.', 'ru-chart-status')}
        ${chartCard('Profiles & notifications', 'Completed profiles and notification opt-in.', 'ru-chart-profiles')}
        ${chartCard('Messages · last 14 days', 'Incoming user messages against admin replies.', 'ru-chart-messages', 'chart-wide')}
        ${chartCard('Most active users', 'Articles, comments, and messages per reader.', 'ru-chart-top', 'chart-wide')}
        ${chartCard('Notifications', 'Sent notices by kind, read vs unread.', 'ru-chart-notices')}
      </section>
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
        ${recentBlock('Latest songs', appTracks().map((item) => ({
          id: item.id, route: 'ru-music', icon: 'music', title: item.title || 'Untitled',
          meta: `${trackOwner(item) ? displayName(trackOwner(item)) : (item.artist || 'App user')} · ${relativeTime(item.created_at)}`,
          status: item.genre || 'Song'
        })), 'No app songs yet', 'ru-music')}
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
    renderHomeCharts();
  }

  window.addEventListener('nc:theme-change', () => {
    if (charts.length && NC.utils.getHashRoute().route === 'registered-users') window.setTimeout(renderHomeCharts, 50);
  });

  function openUser(user) {
    const articles = relatedArticles(user);
    const comments = relatedComments(user);
    const tracks = relatedTracks(user);
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
        <p class="mt-6 text-muted-foreground">${articles.length} articles · ${tracks.length} songs · ${comments.length} comments · ${messages.length} messages · ${notices.length} notices</p>
        <div class="button-row mt-4">
          <button type="button" class="btn btn-secondary" data-jump="ru-articles">Articles</button>
          <button type="button" class="btn btn-secondary" data-jump="ru-music">Music</button>
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
          <td data-label="App data"><small>${relatedArticles(user).length} articles · ${relatedTracks(user).length} songs · ${relatedComments(user).length} comments</small></td>
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
      footer: `<button type="button" class="btn btn-secondary" data-modal-close>Close</button>${canConvertArticle() && !articleConverted(record) && record.status !== 'Rejected' ? '<button type="button" class="btn btn-secondary" data-article-approve><i class="fa-regular fa-circle-check" aria-hidden="true"></i>Approve & convert to Blog</button>' : ''}${canEditArticles() ? '<button type="button" class="btn btn-primary" data-article-edit><i class="fa-regular fa-pen" aria-hidden="true"></i>Edit</button>' : ''}`,
      onOpen: (modalRoot) => {
        modalRoot.querySelector('[data-article-edit]')?.addEventListener('click', () => {
          NC.components.closeModal();
          window.setTimeout(() => onEdit(record), 180);
        });
        modalRoot.querySelector('[data-article-approve]')?.addEventListener('click', () => {
          NC.components.closeModal();
          window.setTimeout(() => openArticleApproval(record, { onConverted: () => refreshScreen(renderArticles, {}) }), 180);
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Article editor — the same editorial workspace as Blogs › Add new blog:
  // Quill rich text with inline images, ImgBB thumbnail, live preview, status.
  // Records stay in submitted_blogs so the Android app keeps seeing them.
  // ---------------------------------------------------------------------------
  const ARTICLE_STATUSES = ['Pending', 'Reviewed', 'Approved', 'Rejected', 'Published'];

  function canEditArticles() {
    return NC.auth.canAccess('submissions');
  }

  function canConvertArticle() {
    return NC.auth.canAccess('submissions') && NC.auth.canAccess('blogs') && NC.auth.canAccess('authors');
  }

  function articleConverted(record) {
    return Boolean(record?.converted_blog_id) || ['Approved', 'Published'].includes(record?.status);
  }

  function articleOwner(record) {
    return ownerOf(record, 'writer_email');
  }

  function profileFields(user) {
    if (!user) return {};
    return {
      user_id: user.id,
      writer_name: displayName(user),
      writer_email: user.email || '',
      writer_profile_image: user.avatar_url || '',
      writer_designation: user.designation || '',
      writer_facebook: user.facebook_id || user.facebook || '',
      phone: user.phone || '',
      address: user.address || user.location || ''
    };
  }

  function closeArticleEditor() {
    articleEditorCleanup?.();
    articleEditorCleanup = null;
    articleEditor?.destroy?.();
    articleEditor = null;
  }

  function articlePreviewMarkup(data) {
    const image = safeImage(data.thumbnail);
    const owner = data.user_id ? userById(data.user_id) : null;
    return `
      <article class="article-preview">
        <header>
          <div class="article-kicker"><span>Registered user article</span><time>${escapeHTML(NC.utils.formatDate(data.created_at || new Date()))}</time></div>
          <h1>${escapeHTML(data.title || 'Untitled article')}</h1>
          ${data.content_title && data.content_title !== data.title ? `<p class="article-subtitle">${escapeHTML(data.content_title)}</p>` : ''}
          <div class="article-byline">${NC.utils.avatarHTML(data.writer_name || 'Writer', data.writer_profile_image || owner?.avatar_url, 'article-author-avatar')}<div><strong>${escapeHTML(data.writer_name || owner?.name || 'Unknown writer')}</strong><span>${escapeHTML(data.writer_designation || data.writer_email || 'App user')} · ${escapeHTML(data.status || 'Pending')} preview</span></div></div>
        </header>
        ${image ? `<img class="article-hero" src="${escapeHTML(image)}" alt="${escapeHTML(data.title || '')}" referrerpolicy="no-referrer">` : ''}
        <div class="article-body prose-content">${NC.utils.sanitizeHTML(data.content || '<p>Article content preview will appear here.</p>')}</div>
      </article>`;
  }

  function previewArticle(data) {
    NC.components.openModal({
      title: 'Article preview', eyebrow: data.status || 'Pending', size: 'preview',
      content: articlePreviewMarkup(data),
      footer: '<button type="button" class="btn btn-secondary" data-modal-close>Close</button>',
      onOpen: (modalRoot) => NC.components.bindImageFallbacks(modalRoot)
    });
  }

  /**
   * Full-page editor. `record` may be an existing submission or null for
   * "Add article" (then `presetUser` decides whose profile it is filed under).
   */
  function renderArticleEditor(record = null, { presetUser = null, onDone } = {}) {
    if (!canEditArticles()) {
      NC.components.toast('Editing registered-user articles requires Submit Blogs access.', 'warning');
      return;
    }
    closeArticleEditor();
    destroyCharts();
    const isEdit = Boolean(record?.id);
    const owner = isEdit ? articleOwner(record) : presetUser;
    const draft = { ...(record || {}), ...(!isEdit && owner ? profileFields(owner) : {}) };
    const converted = articleConverted(record);
    const userOptions = cache.users
      .map((user) => ({ id: user.id, label: `${displayName(user)}${user.email ? ` — ${user.email}` : ''}` }))
      .sort((a, b) => a.label.localeCompare(b.label, 'bn'));
    const finish = onDone || (() => refreshScreen(renderArticles, {}));

    root.innerHTML = `
      ${NC.components.pageHeader({
        eyebrow: isEdit ? 'Edit article' : 'New article',
        title: isEdit ? (record.title || 'Untitled article') : 'Add article for a registered user',
        description: isEdit ? 'Edit the article exactly as the Blogs editor works. Changes stay linked to the reader’s app profile.' : 'Publish an article on behalf of an app user. It will appear under their profile in the Android app.',
        breadcrumb: [{ label: 'Registered users', route: 'registered-users' }, { label: 'Articles', route: 'ru-articles' }, { label: isEdit ? 'Edit' : 'New' }],
        actions: '<button type="button" class="btn btn-secondary" data-article-cancel><i class="fa-regular fa-arrow-left" aria-hidden="true"></i>Back to articles</button>'
      })}
      ${converted ? `<div class="mb-5">${NC.components.notice(`This article was already converted to a blog${record.converted_blog_id ? '' : ' (status ' + escapeHTML(record.status) + ')'}. Edits here do not change the published blog.`, 'info')}</div>` : ''}
      <form id="ru-article-editor" class="blog-editor" novalidate>
        <div class="blog-editor-main">
          <section class="surface form-stack">
            <div class="field"><label class="field-label" for="ru-article-title">Title <span aria-hidden="true">*</span></label><input class="title-input" id="ru-article-title" name="title" value="${escapeHTML(draft.title || '')}" placeholder="Enter an article title" autofocus required><p class="field-error hidden" data-field-error="title"></p></div>
            <div class="field"><label class="field-label" for="ru-article-subtitle">Subtitle</label><textarea class="subtitle-input" id="ru-article-subtitle" name="content_title" rows="2" placeholder="Optional standfirst shown under the title">${escapeHTML(draft.content_title && draft.content_title !== draft.title ? draft.content_title : '')}</textarea></div>
            ${NC.media.imageUploaderHTML({ id: 'ru-article-thumbnail', label: 'Thumbnail', hint: 'Choose a local image for ImgBB upload, or paste a direct image URL.' })}
            ${NC.editor.editorHTML({ id: 'ru-article-content', label: 'Article content', hint: 'Use headings and short paragraphs for a readable article.', required: true })}
          </section>
        </div>
        <aside class="blog-editor-sidebar">
          <section class="surface form-stack"><div class="surface-header compact"><div><p class="eyebrow">Registered user</p><h2>Writer</h2></div></div>
            <div class="field"><label class="field-label" for="ru-article-user">App user <span aria-hidden="true">*</span></label><select class="form-select" id="ru-article-user" name="user_id" ${isEdit && draft.user_id ? '' : ''}><option value="">Choose a registered user</option>${userOptions.map((item) => `<option value="${escapeHTML(item.id)}" ${item.id === (draft.user_id || owner?.id) ? 'selected' : ''}>${escapeHTML(item.label)}</option>`).join('')}</select><p class="field-error hidden" data-field-error="user_id"></p><span class="field-hint">Writer details below follow the selected profile.</span></div>
            <div class="person-cell compact" data-article-user-card>${owner ? NC.utils.avatarHTML(displayName(owner), owner.avatar_url, 'person-avatar') : ''}<div><strong>${escapeHTML(owner ? displayName(owner) : 'No profile selected')}</strong><span>${escapeHTML(owner?.email || '')}</span></div></div>
            <div class="form-grid-2">
              <div class="field"><label class="field-label" for="ru-article-writer">Writer name <span aria-hidden="true">*</span></label><input class="form-input" id="ru-article-writer" name="writer_name" value="${escapeHTML(draft.writer_name || '')}" required><p class="field-error hidden" data-field-error="writer_name"></p></div>
              <div class="field"><label class="field-label" for="ru-article-email">Writer email</label><input class="form-input" id="ru-article-email" name="writer_email" type="email" value="${escapeHTML(draft.writer_email || '')}"></div>
            </div>
            <div class="form-grid-2">
              <div class="field"><label class="field-label" for="ru-article-designation">Designation</label><input class="form-input" id="ru-article-designation" name="writer_designation" value="${escapeHTML(draft.writer_designation || draft.designation || '')}"></div>
              <div class="field"><label class="field-label" for="ru-article-phone">Phone</label><input class="form-input" id="ru-article-phone" name="phone" value="${escapeHTML(draft.phone || '')}"></div>
            </div>
            <div class="field"><label class="field-label" for="ru-article-address">Address</label><input class="form-input" id="ru-article-address" name="address" value="${escapeHTML(draft.address || '')}"></div>
          </section>
          <section class="surface form-stack mt-5"><div class="surface-header compact"><div><p class="eyebrow">Review</p><h2>Status</h2></div></div>
            <div class="field"><label class="field-label" for="ru-article-status">Status</label><select class="form-select" id="ru-article-status" name="status">${ARTICLE_STATUSES.map((status) => `<option value="${status}" ${status === (draft.status || 'Pending') ? 'selected' : ''}>${status}</option>`).join('')}</select><span class="field-hint">“Published” is what the Android app shows readers. “Approved” means converted to a magazine blog.</span></div>
            ${isEdit ? `<dl class="details-list"><div><dt>Submitted</dt><dd>${escapeHTML(formatDateTime(record.created_at))}</dd></div>${record.reviewed_at ? `<div><dt>Reviewed</dt><dd>${escapeHTML(formatDateTime(record.reviewed_at))}</dd></div>` : ''}${record.converted_blog_id && NC.auth.canAccess('blogs') ? `<div><dt>Blog</dt><dd><button type="button" class="table-link" data-open-converted="${escapeHTML(record.converted_blog_id)}">Open converted blog</button></dd></div>` : ''}</dl>` : ''}
          </section>
          <section class="surface mt-5"><p class="eyebrow mb-3">At a glance</p><div class="editor-summary"><div><span>Words</span><strong data-article-word-count>0</strong></div><div><span>Reading time</span><strong data-article-read-time>1 min</strong></div><div><span>Last saved</span><strong>${escapeHTML(record?.updated_at || record?.reviewed_at ? NC.utils.formatDate(record.updated_at || record.reviewed_at) : 'Not saved')}</strong></div></div></section>
        </aside>
        <div class="editor-action-bar"><div><span class="save-indicator"><i class="fa-regular fa-shield-check" aria-hidden="true"></i>Content is sanitized before save</span></div><div class="editor-actions">
          <button type="button" class="btn btn-secondary" data-article-cancel>Cancel</button>
          <button type="button" class="btn btn-secondary" data-article-preview><i class="fa-regular fa-eye" aria-hidden="true"></i>Preview</button>
          ${isEdit && canConvertArticle() && !converted && record.status !== 'Rejected' ? '<button type="button" class="btn btn-secondary" data-article-approve><i class="fa-regular fa-circle-check" aria-hidden="true"></i>Approve & convert to Blog</button>' : ''}
          <button type="button" class="btn btn-secondary" data-article-save="__keep__"><i class="fa-regular fa-floppy-disk" aria-hidden="true"></i>Save</button>
          <button type="button" class="btn btn-primary" data-article-save="Published"><i class="fa-regular fa-paper-plane" aria-hidden="true"></i>Save & publish in app</button>
        </div></div>
      </form>`;

    const form = root.querySelector('#ru-article-editor');
    const thumbnailUploads = [];
    let editorClosed = false;
    const thumbnail = NC.media.mountImageUploader(root.querySelector('#ru-article-thumbnail'), {
      initial: { url: draft.thumbnail || '', delete_url: draft.imgbb_delete_url || '', image_meta: draft.thumbnail_meta || {} },
      label: 'Thumbnail',
      onChange: (next) => {
        if (next?.provider !== 'imgbb' || !next.delete_url) return;
        if (!thumbnailUploads.some((item) => item.url === next.url)) thumbnailUploads.push({ ...next });
        if (editorClosed) NC.crud.deleteMediaRecords([next]);
      }
    });
    articleEditor = NC.editor.mountEditor(root.querySelector('#ru-article-content'), {
      initial: draft.content || '',
      media: Array.isArray(draft.inline_media) ? draft.inline_media : [],
      required: true,
      label: 'Article content',
      onChange: updateWordCount
    });

    function updateWordCount(changedHtml) {
      const html = typeof changedHtml === 'string' ? changedHtml : (articleEditor?.getValue?.() || draft.content || '');
      const words = NC.utils.stripHTML(html).split(/\s+/).filter(Boolean).length;
      const count = root.querySelector('[data-article-word-count]');
      const time = root.querySelector('[data-article-read-time]');
      if (count) count.textContent = words.toLocaleString();
      if (time) time.textContent = `${Math.max(1, Math.ceil(words / 220))} min`;
    }
    updateWordCount();

    form.elements.user_id.addEventListener('change', () => {
      const user = userById(form.elements.user_id.value);
      const card = root.querySelector('[data-article-user-card]');
      if (card) card.innerHTML = `${user ? NC.utils.avatarHTML(displayName(user), user.avatar_url, 'person-avatar') : ''}<div><strong>${escapeHTML(user ? displayName(user) : 'No profile selected')}</strong><span>${escapeHTML(user?.email || '')}</span></div>`;
      if (!user) return;
      const fields = profileFields(user);
      ['writer_name', 'writer_email', 'writer_designation', 'phone', 'address'].forEach((name) => {
        const input = form.elements[name];
        if (input && (!input.value || input.dataset.autofilled === 'true')) { input.value = fields[name] || ''; input.dataset.autofilled = 'true'; }
      });
    });
    ['writer_name', 'writer_email', 'writer_designation', 'phone', 'address'].forEach((name) => {
      form.elements[name]?.addEventListener('input', (event) => { event.target.dataset.autofilled = 'false'; });
    });

    function collectData(statusOverride) {
      const data = formData(form);
      const user = userById(data.user_id);
      const media = thumbnail.getValue();
      const status = statusOverride && statusOverride !== '__keep__' ? statusOverride : (data.status || 'Pending');
      return {
        ...draft,
        title: data.title,
        content_title: data.content_title || data.title,
        content: articleEditor.getValue(),
        inline_media: articleEditor.getMedia(),
        thumbnail: media?.url || '',
        imgbb_delete_url: media?.delete_url || '',
        thumbnail_meta: NC.crud.imagePayload(media).image_meta,
        user_id: data.user_id || null,
        writer_name: data.writer_name,
        writer_email: data.writer_email,
        writer_designation: data.writer_designation,
        writer_profile_image: draft.writer_profile_image || user?.avatar_url || '',
        designation: data.writer_designation,
        phone: data.phone,
        address: data.address,
        status
      };
    }

    function payloadFor(data) {
      const payload = {
        title: data.title, content_title: data.content_title, content: data.content, inline_media: data.inline_media,
        thumbnail: data.thumbnail, imgbb_delete_url: data.imgbb_delete_url, thumbnail_meta: data.thumbnail_meta,
        user_id: data.user_id, writer_name: data.writer_name, writer_email: data.writer_email,
        writer_designation: data.writer_designation, writer_profile_image: data.writer_profile_image,
        designation: data.designation, phone: data.phone, address: data.address, status: data.status
      };
      if (isEdit && ['Reviewed', 'Approved', 'Rejected', 'Published'].includes(data.status) && data.status !== record.status) payload.reviewed_at = new Date().toISOString();
      return payload;
    }

    async function cleanup({ saved = false, payload = null } = {}) {
      editorClosed = true;
      const keep = new Set((payload?.inline_media || []).map((item) => item.url));
      const inline = (saved ? articleEditor.getInactiveMedia() : articleEditor.getSessionUploads()).filter((item) => !keep.has(item.url));
      const thumbs = thumbnailUploads.filter((item) => !saved || item.url !== payload?.thumbnail);
      await NC.crud.deleteMediaRecords([...thumbs, ...inline]);
    }
    articleEditorCleanup = cleanup;

    async function save(status, button) {
      const data = collectData(status);
      const errors = {
        title: data.title ? '' : 'Article title is required.',
        user_id: data.user_id ? '' : 'Choose the registered user this article belongs to.',
        writer_name: data.writer_name ? '' : 'Writer name is required.'
      };
      if (!articleEditor.validate()) errors.title ||= '';
      if (!NC.utils.validateFields(form, errors) || !articleEditor.validate()) return;
      if (thumbnail.isUploading()) { NC.components.toast('Wait for the thumbnail upload to finish.', 'warning'); return; }
      NC.utils.setButtonLoading(button, true, 'Saving…');
      try {
        const payload = payloadFor(data);
        const saved = isEdit ? await NC.api.update('submissions', record.id, payload) : await NC.api.insert('submissions', payload);
        if (isEdit && record.imgbb_delete_url && record.imgbb_delete_url !== payload.imgbb_delete_url && !articleConverted(record)) {
          NC.crud.deleteMediaRecords([{ url: record.thumbnail, delete_url: record.imgbb_delete_url, provider: 'imgbb' }]);
        }
        await cleanup({ saved: true, payload });
        articleEditorCleanup = null;
        NC.components.toast(isEdit ? 'Article saved.' : 'Article created for the selected user.', 'success');
        closeArticleEditor();
        await finish(saved);
      } catch (error) {
        console.error(error);
        NC.components.toast(NC.api.userMessage(error, 'Unable to save the article.'), 'error');
      } finally {
        NC.utils.setButtonLoading(button, false);
      }
    }

    root.querySelector('[data-article-preview]').addEventListener('click', () => previewArticle(collectData()));
    root.querySelectorAll('[data-article-save]').forEach((button) => button.addEventListener('click', () => save(button.dataset.articleSave, button)));
    root.querySelector('[data-article-approve]')?.addEventListener('click', async () => {
      if (!isEdit) return;
      openArticleApproval(record, { onConverted: async () => { articleEditorCleanup = null; closeArticleEditor(); await finish(); } });
    });
    root.querySelector('[data-open-converted]')?.addEventListener('click', () => routeTo('blogs', { action: 'edit', id: record.converted_blog_id }));
    root.querySelectorAll('[data-article-cancel]').forEach((button) => button.addEventListener('click', async () => {
      if (thumbnail.isUploading()) { NC.components.toast('Wait for active media uploads to finish before leaving the editor.', 'warning'); return; }
      const leave = await NC.components.confirm({ title: 'Leave the editor?', description: 'Unsaved changes will be lost. Newly uploaded files will be cleaned up where the provider permits it.', danger: false, confirmLabel: 'Leave editor', confirmIcon: 'fa-arrow-left' });
      if (!leave) return;
      await cleanup();
      articleEditorCleanup = null;
      closeArticleEditor();
      await finish();
    }));
  }

  /** Legacy name kept for the view modal's Edit button. */
  function openArticleForm(record, onSaved) {
    renderArticleEditor(record, { onDone: onSaved });
  }

  // ---------------------------------------------------------------------------
  // Approve & convert to Blog — mirrors Submit Blogs: approve_submission RPC
  // (migration 004) with a client-side fallback when the RPC is unavailable.
  // ---------------------------------------------------------------------------
  function openArticleApproval(record, { onConverted } = {}) {
    if (!canConvertArticle()) { NC.components.toast('Approval conversion requires Submit Blogs, Blogs, and Authors access.', 'warning'); return; }
    if (articleConverted(record) || record.status === 'Rejected') { NC.components.toast('This article is not eligible for another conversion.', 'warning'); return; }
    if (!cache.categories.length) { NC.components.toast('Create a blog category first.', 'warning'); return; }
    const owner = articleOwner(record);
    const suggestedSlug = slugify(record.title || '') || `article-${String(record.id).slice(0, 8)}`;
    const matchedAuthor = cache.authors.find((item) => String(item.title || '').trim().toLocaleLowerCase() === String(record.writer_name || '').trim().toLocaleLowerCase());
    NC.components.openModal({
      title: 'Approve & convert to blog', eyebrow: 'Registered users', size: 'lg',
      description: 'The article becomes a magazine blog. The writer is linked to an existing author with the same name, or a new author is created.',
      content: `<form id="ru-approval-form" class="form-stack" novalidate>
        ${NC.components.notice(matchedAuthor ? `Writer “${escapeHTML(record.writer_name)}” matches the existing author “${escapeHTML(matchedAuthor.title)}”.` : `A new author “${escapeHTML(record.writer_name || 'Unknown')}” will be created${owner?.avatar_url ? ' with the app profile photo' : ''}.`, 'info')}
        <div class="field"><label class="field-label" for="ru-approval-category">Blog category <span aria-hidden="true">*</span></label><select class="form-select" id="ru-approval-category" name="category_id"><option value="">Choose a category</option>${cache.categories.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.title)}</option>`).join('')}</select><p class="field-error hidden" data-field-error="category_id"></p></div>
        <div class="form-grid-2">
          <div class="field"><label class="field-label" for="ru-approval-status">Initial blog status</label><select class="form-select" id="ru-approval-status" name="status"><option value="Draft">Save as draft</option><option value="Publish">Publish immediately</option></select></div>
          <div class="field"><label class="field-label" for="ru-approval-slug">Blog slug <span aria-hidden="true">*</span></label><input class="form-input" id="ru-approval-slug" name="slug" value="${escapeHTML(suggestedSlug)}"><p class="field-error hidden" data-field-error="slug"></p></div>
        </div>
        <div class="field"><label class="field-label" for="ru-approval-issue">নিংশিং চে issue (optional)</label><select class="form-select" id="ru-approval-issue" name="issue_year"><option value="">Not part of an annual issue</option>${[new Date().getFullYear() + 1, new Date().getFullYear(), new Date().getFullYear() - 1].map((year) => `<option value="${year}">${escapeHTML(NC.tags.issueLabel(year))}</option>`).join('')}</select></div>
        <div class="conversion-map"><div><span>Article title</span><strong>${escapeHTML(record.title || 'Untitled')}</strong><i class="fa-regular fa-arrow-down" aria-hidden="true"></i><span>Blog title</span></div><div><span>Writer</span><strong>${escapeHTML(record.writer_name || '—')}</strong><i class="fa-regular fa-arrow-down" aria-hidden="true"></i><span>Author relationship</span></div><div><span>Thumbnail & content</span><strong>Preserved</strong><i class="fa-regular fa-arrow-down" aria-hidden="true"></i><span>Hero & article body</span></div></div>
      </form>`,
      footer: '<button type="button" class="btn btn-secondary" data-modal-close>Cancel</button><button type="submit" form="ru-approval-form" class="btn btn-primary" data-confirm-approval><i class="fa-regular fa-circle-check" aria-hidden="true"></i>Approve & convert</button>',
      onOpen: (modalRoot) => {
        const form = modalRoot.querySelector('#ru-approval-form');
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const data = formData(form); data.slug = slugify(data.slug); form.elements.slug.value = data.slug;
          if (!NC.utils.validateFields(form, { category_id: data.category_id ? '' : 'Choose a blog category.', slug: data.slug ? '' : 'Enter a valid unique slug.' })) return;
          const button = modalRoot.querySelector('[data-confirm-approval]'); NC.utils.setButtonLoading(button, true, 'Converting…');
          try {
            if (await NC.api.slugExists(data.slug)) { NC.utils.validateFields(form, { slug: 'This blog slug is already in use.' }); return; }
            let converted;
            try {
              converted = await NC.api.rpc('approve_submission', { p_submission_id: record.id, p_category_id: data.category_id, p_status: data.status, p_slug: data.slug });
            } catch (rpcError) {
              if (![404, 400].includes(rpcError.status) && rpcError.code !== 'PGRST202') throw rpcError;
              converted = await fallbackArticleApproval(record, data);
            }
            const blog = Array.isArray(converted) ? converted[0] : converted;
            const year = NC.tags.parseIssueParam(data.issue_year);
            if (blog?.id && year && NC.auth.canAccess('blogs')) {
              try { await NC.api.update('blogs', blog.id, { tags: NC.tags.withIssue(blog.tags || [], year) }); } catch (tagError) { console.warn('Issue tag was not applied:', tagError); }
            }
            NC.components.toast(data.status === 'Publish' ? 'Article approved and blog published.' : 'Article approved and converted to a draft blog.', 'success');
            NC.components.closeModal();
            await onConverted?.(blog);
            if (blog?.id) routeTo('blogs', { action: 'edit', id: blog.id });
          } catch (error) {
            console.error(error);
            NC.components.toast(NC.api.userMessage(error, 'Unable to convert this article. Nothing was discarded.'), 'error');
          } finally { NC.utils.setButtonLoading(button, false); }
        });
      }
    });
  }

  async function fallbackArticleApproval(record, data) {
    const writer = String(record.writer_name || '').trim();
    let author = cache.authors.find((item) => String(item.title || '').trim().toLocaleLowerCase() === writer.toLocaleLowerCase());
    if (!author) {
      const owner = articleOwner(record);
      author = await NC.api.insert('authors', {
        title: writer || displayName(owner || {}), designation: record.writer_designation || owner?.designation || '',
        image: record.writer_profile_image || owner?.avatar_url || '', imgbb_delete_url: record.writer_profile_delete_url || '',
        image_meta: record.writer_profile_meta || {}, description: '', is_verified: false, location: record.address || ''
      });
      cache.authors.push(author);
    }
    const category = cache.categories.find((item) => item.id === data.category_id);
    const blog = await NC.api.insert('blogs', {
      title: record.title, sub_title: record.content_title && record.content_title !== record.title ? record.content_title : '',
      image: record.thumbnail || '', imgbb_delete_url: record.imgbb_delete_url || '', image_meta: record.thumbnail_meta || {},
      content: record.content || '', inline_media: Array.isArray(record.inline_media) ? record.inline_media : [],
      category_id: data.category_id, category_title: category?.title || '', category_slug: category?.slug || '',
      author_id: author.id, author_name: author.title, author_image: author.image || '', status: data.status,
      slug: data.slug, tags: [], is_slider: false, is_feature: false, is_special_article: false,
      seo_title: '', seo_description: '', video_link: '', pdf_book_link: '',
      published_date: data.status === 'Publish' ? new Date().toISOString().slice(0, 10) : null
    });
    await NC.api.update('submissions', record.id, { status: 'Approved', reviewed_at: new Date().toISOString(), converted_blog_id: blog.id });
    return blog;
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
    closeArticleEditor();
    const state = new NC.crud.ListState('articles', { searchFields: ['title', 'writer_name', 'writer_email', 'content_title'], sortKey: 'created_at' });
    const records = appArticles();
    state.setRecords(records);
    const reload = () => refreshScreen(renderArticles, context);
    const params = context.params || new URLSearchParams();
    const presetUser = params.get('user') || 'all';
    const presetStatus = params.get('status') || 'all';
    const statusOptions = ARTICLE_STATUSES.map((status) => ({ value: status, label: status, count: records.filter((item) => (item.status || 'Pending') === status).length })).filter((item) => item.count > 0);
    root.innerHTML = `${pageChrome('Articles', 'Articles submitted by registered app users. Edit them in the full editor, publish them in the app, or convert them into magazine blogs.',
      canEditArticles() ? `<div class="page-actions mb-5"><button type="button" class="btn btn-primary" data-ru-add-article><i class="fa-regular fa-plus" aria-hidden="true"></i>Add article</button></div>` : '')}
      <section class="surface">
        <div class="list-toolbar">
          <label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search articles</span><input type="search" placeholder="Search title or writer…" data-ru-search></label>
          ${userFilterSelect(records, 'writer_email', 'data-ru-user-filter', 'Filter by user')}
          ${NC.crud.filterSelect(statusOptions, { attr: 'data-ru-status-filter', label: 'Filter by status', placeholder: 'All statuses', selected: presetStatus })}
        </div>
        <div class="active-filters hidden" data-ru-active-filters></div>
        <div data-ru-table></div>
      </section>`;
    const renderList = () => {
      const content = root.querySelector('[data-ru-table]');
      const { rows, total } = state.paged();
      if (!total) {
        const filtered = Boolean(state.query) || root.querySelector('[data-ru-user-filter]')?.value !== 'all' || root.querySelector('[data-ru-status-filter]')?.value !== 'all';
        content.innerHTML = NC.components.emptyState({ icon: 'fa-file-pen', title: filtered ? 'No articles match' : 'No app articles yet', description: filtered ? 'Try another user, status, or search.' : 'Registered users submit articles from the Android app, or add one for them here.', action: !filtered && canEditArticles() ? '<button type="button" class="btn btn-primary" data-ru-add-article><i class="fa-regular fa-plus" aria-hidden="true"></i>Add article</button>' : '' });
        content.querySelector('[data-ru-add-article]')?.addEventListener('click', () => renderArticleEditor(null, { onDone: reload }));
        return;
      }
      content.innerHTML = `${NC.components.tableShell({
        caption: 'App articles', minWidth: '1120px',
        head: `<tr><th>Article</th><th>Writer · App user</th><th>Status</th><th><button type="button" data-sort="created_at">Submitted ${NC.crud.sortIcon(state, 'created_at')}</button></th><th class="text-right">Actions</th></tr>`,
        body: rows.map((item) => {
          const owner = articleOwner(item);
          const thumb = safeImage(item.thumbnail);
          const actions = [{ action: 'view', id: item.id, label: 'View article', icon: 'fa-eye' }];
          if (canEditArticles()) actions.push({ action: 'edit', id: item.id, label: 'Edit article', icon: 'fa-pen' });
          if (canConvertArticle() && !articleConverted(item) && item.status !== 'Rejected') actions.push({ action: 'approve', id: item.id, label: 'Approve & convert to Blog', icon: 'fa-circle-check' });
          if (item.converted_blog_id && NC.auth.canAccess('blogs')) actions.push({ action: 'blog', id: item.id, label: 'Open converted blog', icon: 'fa-newspaper' });
          if (canEditArticles()) actions.push({ action: 'delete', id: item.id, label: 'Delete article', icon: 'fa-trash', danger: true });
          return `<tr>
          <td data-label="Article"><div class="article-cell">${thumb ? `<img src="${escapeHTML(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-image-fallback>` : '<span class="article-thumb-placeholder"><i class="fa-regular fa-file-lines" aria-hidden="true"></i></span>'}<div><strong>${escapeHTML(item.title || 'Untitled')}</strong><small>${escapeHTML(NC.utils.truncate(NC.utils.stripHTML(item.content || ''), 90) || 'No content yet')}</small></div></div></td>
          <td data-label="Writer"><div class="person-cell compact">${NC.utils.avatarHTML(item.writer_name || displayName(owner || {}), item.writer_profile_image || owner?.avatar_url, 'person-avatar')}<div><strong>${escapeHTML(item.writer_name || item.writer_email || '—')}</strong><span>${owner ? `<button type="button" class="table-link" data-ru-filter-user="${escapeHTML(owner.id)}" title="Show only this user’s articles">${escapeHTML(displayName(owner))}${owner.email ? ` · ${escapeHTML(owner.email)}` : ''}</button>` : escapeHTML(item.writer_email || 'No linked profile')}</span></div></div></td>
          <td data-label="Status">${NC.components.statusBadge(item.status || 'Pending')}${item.converted_blog_id ? '<div class="mt-1"><small class="text-muted-foreground">Converted to blog</small></div>' : ''}</td>
          <td data-label="Submitted">${escapeHTML(formatDateTime(item.created_at))}</td>
          <td data-label="Actions" class="text-right">${NC.components.rowActions(actions)}</td>
        </tr>`;
        }).join('')
      })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
      NC.components.bindImageFallbacks(content);
      content.querySelectorAll('[data-action]').forEach((button) => {
        const record = articleById(button.dataset.id);
        if (!record) return;
        button.addEventListener('click', () => {
          if (button.dataset.action === 'view') openArticleView(record, (item) => renderArticleEditor(item, { onDone: reload }));
          if (button.dataset.action === 'edit') renderArticleEditor(record, { onDone: reload });
          if (button.dataset.action === 'approve') openArticleApproval(record, { onConverted: reload });
          if (button.dataset.action === 'blog') routeTo('blogs', { action: 'edit', id: record.converted_blog_id });
          if (button.dataset.action === 'delete') deleteArticle(record, reload);
        });
      });
      content.querySelectorAll('[data-ru-filter-user]').forEach((button) => button.addEventListener('click', () => {
        const select = root.querySelector('[data-ru-user-filter]');
        if (select) { select.value = button.dataset.ruFilterUser; select.dispatchEvent(new Event('change')); }
      }));
      NC.crud.bindPagination(root, state, renderList);
      NC.crud.bindSort(root, state, renderList);
    };
    bindList(state, renderList);
    root.querySelectorAll('[data-ru-add-article]').forEach((button) => button.addEventListener('click', () => {
      const selected = root.querySelector('[data-ru-user-filter]')?.value;
      renderArticleEditor(null, { presetUser: selected && selected !== 'all' ? userById(selected) : null, onDone: reload });
    }));
    const statusSelect = root.querySelector('[data-ru-status-filter]');
    const statusChip = () => [{ key: 'status', label: 'Status', value: statusSelect.value !== 'all' ? statusSelect.value : '', remove: () => { statusSelect.value = 'all'; statusSelect.dispatchEvent(new Event('change')); } }];
    const userFilter = bindUserFilter(state, renderList, 'data-ru-user-filter', 'writer_email', '[data-ru-active-filters]', statusChip);
    statusSelect.addEventListener('change', () => { state.setFilter('status', statusSelect.value); userFilter.apply(); });
    if (presetUser !== 'all' && userFilter.select && [...userFilter.select.options].some((option) => option.value === presetUser)) userFilter.select.value = presetUser;
    state.setFilter('status', statusSelect.value);
    userFilter.apply();
    const openId = params.get('id');
    if (openId && articleById(openId)) {
      if (params.get('action') === 'edit') renderArticleEditor(articleById(openId), { onDone: reload });
      else openArticleView(articleById(openId), (item) => renderArticleEditor(item, { onDone: reload }));
    } else if (params.get('action') === 'new') {
      renderArticleEditor(null, { presetUser: presetUser !== 'all' ? userById(presetUser) : null, onDone: reload });
    }
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

  function messageAttachmentUrls(body) {
    const found = String(body || '').match(/https?:\/\/[^\s)]+/gi) || [];
    return [...new Set(found.map((url) => url.replace(/[.,;]+$/, '')))].filter((url) => (
      /i\.ibb\.co|imgbb\.com/i.test(url) || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)
    ));
  }

  function messagePlainText(body) {
    let text = String(body || '');
    messageAttachmentUrls(text).forEach((url) => { text = text.split(url).join(''); });
    return text.replace(/\n{3,}/g, '\n\n').trim();
  }

  function openImageLightbox(url) {
    if (!url) return;
    document.getElementById('ru-image-lightbox')?.remove();
    const layer = document.createElement('div');
    layer.id = 'ru-image-lightbox';
    layer.className = 'ru-image-lightbox';
    layer.innerHTML = `<button type="button" class="ru-image-lightbox-close" aria-label="Close"><i class="fa-regular fa-xmark" aria-hidden="true"></i></button>
      <img src="${escapeHTML(url)}" alt="" referrerpolicy="no-referrer">`;
    const close = () => layer.remove();
    layer.addEventListener('click', (event) => {
      if (event.target === layer || event.target.closest('.ru-image-lightbox-close')) close();
    });
    document.addEventListener('keydown', function onKey(event) {
      if (event.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        close();
      }
    });
    document.body.appendChild(layer);
  }

  function bubblesHTML(userId) {
    const { name } = chatIdentity(userId);
    const thread = threadFor(userId);
    if (!thread.length) {
      return '<p class="text-muted-foreground" style="padding:8px">No messages yet. Write the first reply below.</p>';
    }
    return thread.map((item) => {
      const images = messageAttachmentUrls(item.body);
      const text = messagePlainText(item.body);
      const photos = images.map((url) => `<button type="button" class="ru-chat-photo" data-ru-lightbox="${escapeHTML(url)}"><img src="${escapeHTML(url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>`).join('');
      return `
      <article class="ru-bubble ${item.sender === 'admin' ? 'is-admin' : 'is-user'}">
        <header><strong>${item.sender === 'admin' ? 'Admin' : escapeHTML(name)}</strong><time>${escapeHTML(formatDateTime(item.created_at))}</time></header>
        ${text ? `<p>${escapeHTML(text)}</p>` : ''}
        ${photos ? `<div class="ru-chat-photos">${photos}</div>` : ''}
      </article>`;
    }).join('');
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

  let chatDockFocus = true;

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
            <button type="button" data-ru-chat-reload="${escapeHTML(userId)}" aria-label="Reload chat" title="Reload chat"><i class="fa-regular fa-rotate-right" aria-hidden="true"></i></button>
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
    if (chatDockFocus) {
      const focusId = openIds.at(-1);
      if (focusId) dock.querySelector(`[data-ru-chat="${CSS.escape(focusId)}"] textarea`)?.focus();
    }
  }

  function bindChatDock(dock) {
    dock.querySelectorAll('[data-ru-chat-reload]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const userId = button.dataset.ruChatReload;
        button.disabled = true;
        try {
          await loadCache();
          chatDockFocus = false;
          renderChatDock();
          chatDockFocus = true;
          NC.components.toast('Chat reloaded.', 'success');
          const thread = dock.querySelector(`[data-ru-chat="${CSS.escape(userId)}"] [data-ru-thread]`);
          if (thread) thread.scrollTop = thread.scrollHeight;
        } catch (error) {
          console.error(error);
          NC.components.toast(NC.api.userMessage(error, 'Unable to reload chat.'), 'error');
          button.disabled = false;
        }
      });
    });
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
    dock.querySelectorAll('[data-ru-lightbox]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openImageLightbox(button.dataset.ruLightbox);
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
    const conversations = conversationRows();
    state.setRecords(conversations);
    const params = context.params || new URLSearchParams();
    const presetUser = params.get('user') || 'all';
    const userOptions = conversations
      .map((item) => ({ value: item.user_id, label: `${item.user_name}${userById(item.user_id)?.email ? ` — ${userById(item.user_id).email}` : ''}`, count: item.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'bn'));
    root.innerHTML = `${pageChrome('Messages', 'One row per user. Open a conversation to read the full thread.')}
      ${cache.inboxReady ? '' : `<div class="mb-6">${NC.components.notice('Run 007_user_inbox.sql so admin messages can be stored.', 'warning')}</div>`}
      <section class="surface"><div class="list-toolbar"><label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search conversations</span><input type="search" placeholder="Search people or messages…" data-ru-search></label>${NC.crud.filterSelect(userOptions, { attr: 'data-ru-user-filter', label: 'Filter by user', placeholder: 'All users', selected: presetUser, wide: true })}<select class="form-select toolbar-select" data-ru-unread-filter aria-label="Filter by unread"><option value="all">Read & unread</option><option value="unread">Unread only</option></select></div><div class="active-filters hidden" data-ru-active-filters></div><div data-ru-table></div></section>`;
    const userSelect = root.querySelector('[data-ru-user-filter]');
    const unreadSelect = root.querySelector('[data-ru-unread-filter]');
    const applyFilters = () => {
      state.setFilter('user_id', userSelect.value);
      state.setFilter('__unread', unreadSelect.value === 'unread' ? (_, row) => row.unread > 0 : 'all');
      renderList();
      NC.crud.renderActiveFilters(root.querySelector('[data-ru-active-filters]'), [
        { key: 'user', label: 'User', value: userSelect.value !== 'all' ? (conversations.find((item) => item.user_id === userSelect.value)?.user_name || 'User') : '' },
        { key: 'unread', label: 'Only', value: unreadSelect.value === 'unread' ? 'Unread' : '' }
      ], {
        onRemove: (key) => { if (key === 'user') userSelect.value = 'all'; if (key === 'unread') unreadSelect.value = 'all'; applyFilters(); },
        onClear: () => { userSelect.value = 'all'; unreadSelect.value = 'all'; applyFilters(); }
      });
    };
    const renderList = () => {
      const content = root.querySelector('[data-ru-table]');
      const { rows, total } = state.paged();
      if (!total) {
        const filtered = Boolean(state.query) || userSelect.value !== 'all' || unreadSelect.value !== 'all';
        content.innerHTML = NC.components.emptyState({ icon: 'fa-messages', title: filtered ? 'No conversations match' : 'No messages yet', description: filtered ? 'Try another user or clear the filters.' : '' });
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
    userSelect.addEventListener('change', applyFilters);
    unreadSelect.addEventListener('change', applyFilters);
    applyFilters();
    const openId = params.get('id');
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


  function durationLabel(seconds) {
    const total = Number(seconds) || 0;
    if (total <= 0) return '—';
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function trackById(id) {
    return cache.tracks.find((item) => item.id === id) || null;
  }

  function canManageMusic() {
    return NC.auth.canAccess('music');
  }

  function openTrackView(record) {
    const owner = trackOwner(record);
    const thumbnail = safeImage(record.thumbnail_url);
    NC.components.openModal({
      title: record.title || 'Untitled',
      eyebrow: [record.artist, record.album].filter(Boolean).join(' · ') || 'App song',
      size: 'lg',
      content: `
        ${thumbnail ? `<img src="${escapeHTML(thumbnail)}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:16px;margin-bottom:16px;" referrerpolicy="no-referrer">` : ''}
        <dl class="details-list">
          <div><dt>Uploaded by</dt><dd>${escapeHTML(owner ? displayName(owner) : (record.user_id || 'App user'))}${owner?.email ? ` · ${escapeHTML(owner.email)}` : ''}</dd></div>
          <div><dt>Genre</dt><dd>${escapeHTML(record.genre || '—')}</dd></div>
          <div><dt>Length</dt><dd>${escapeHTML(durationLabel(record.duration_seconds))}</dd></div>
          <div><dt>Added</dt><dd>${escapeHTML(formatDateTime(record.created_at))}</dd></div>
        </dl>
        <audio controls preload="metadata" src="${escapeHTML(record.audio_url || '')}" style="width:100%;margin-top:16px"></audio>
        ${record.video_link ? `<div class="mt-5">${NC.media.videoPreviewHTML(record.video_link, { title: record.title })}</div>` : ''}
        ${record.description ? `<div class="prose-content mt-5"><p>${escapeHTML(record.description)}</p></div>` : ''}`,
      footer: `<button type="button" class="btn btn-secondary" data-modal-close>Close</button>${canManageMusic() ? '<button type="button" class="btn btn-primary" data-open-music><i class="fa-regular fa-music" aria-hidden="true"></i>Open in Music</button>' : ''}`,
      onOpen: (modalRoot) => {
        modalRoot.querySelector('[data-open-music]')?.addEventListener('click', () => {
          NC.components.closeModal();
          routeTo('music', { action: 'view', id: record.id });
        });
      }
    });
  }

  async function deleteTrack(record, onDeleted) {
    if (!canManageMusic()) {
      NC.components.toast('Deleting songs requires Music library access.', 'warning');
      return;
    }
    const deleted = await NC.crud.deleteRecord({
      table: 'music',
      record,
      label: 'track',
      remoteDeleteUrls: [record.imgbb_delete_url],
      storageObjects: record.file_storage_path ? [{ bucket: NC_CONFIG.supabase.musicBucket, path: record.file_storage_path }] : []
    });
    if (deleted) await onDeleted();
  }

  function renderMusic(context = {}) {
    const state = new NC.crud.ListState('tracks', { searchFields: ['title', 'artist', 'album', 'genre', 'description'], sortKey: 'created_at' });
    const records = appTracks();
    state.setRecords(records);
    const reload = () => refreshScreen(renderMusic, context);
    const params = context.params || new URLSearchParams();
    const presetUser = params.get('user') || 'all';
    const userOptions = cache.users
      .map((user) => ({ value: user.id, label: `${displayName(user)}${user.email ? ` — ${user.email}` : ''}`, count: relatedTracks(user).length }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'bn'));
    root.innerHTML = `${pageChrome('Music', 'Songs uploaded from the Android app (নতুন গান). Editorial tracks stay in Content → Music.')}
      <section class="surface">
        <div class="list-toolbar">
          <label class="search-field"><i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i><span class="sr-only">Search songs</span><input type="search" placeholder="Search title, artist, or album…" data-ru-search></label>
          ${NC.crud.filterSelect(userOptions, { attr: 'data-ru-user-filter', label: 'Filter by user', placeholder: 'All users', selected: presetUser, wide: true })}
        </div>
        <div class="active-filters hidden" data-ru-active-filters></div>
        <div data-ru-table></div>
      </section>`;
    const renderList = () => {
      const content = root.querySelector('[data-ru-table]');
      const { rows, total } = state.paged();
      if (!total) {
        const filtered = Boolean(state.query) || root.querySelector('[data-ru-user-filter]')?.value !== 'all';
        content.innerHTML = NC.components.emptyState({
          icon: 'fa-music',
          title: filtered ? 'No songs match' : 'No app songs yet',
          description: filtered ? 'Try another user or search.' : 'Registered users upload MP3s from নতুন গান. They also appear in Content → Music.'
        });
        return;
      }
      content.innerHTML = `${NC.components.tableShell({
        caption: 'App songs', minWidth: '1080px',
        head: `<tr><th>Track</th><th>Uploaded by</th><th>Length</th><th><button type="button" data-sort="created_at">Added ${NC.crud.sortIcon(state, 'created_at')}</button></th><th class="text-right">Actions</th></tr>`,
        body: rows.map((item) => {
          const owner = trackOwner(item);
          const thumbnail = safeImage(item.thumbnail_url);
          const actions = [{ action: 'view', id: item.id, label: 'Preview track', icon: 'fa-play' }];
          if (canManageMusic()) {
            actions.push({ action: 'library', id: item.id, label: 'Open in Music', icon: 'fa-music' });
            actions.push({ action: 'delete', id: item.id, label: 'Delete track', icon: 'fa-trash', danger: true });
          }
          return `<tr>
            <td data-label="Track"><div class="video-cell">${thumbnail ? `<img src="${escapeHTML(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-image-fallback>` : `<span><i class="fa-regular fa-music" aria-hidden="true"></i></span>`}<div><strong>${escapeHTML(item.title || 'Untitled')}</strong><small>${escapeHTML([item.artist, item.album].filter(Boolean).join(' · ') || item.genre || '')}</small></div></div></td>
            <td data-label="Uploaded by"><div class="person-cell compact">${NC.utils.avatarHTML(owner ? displayName(owner) : 'App user', owner?.avatar_url, 'person-avatar')}<div><strong>${escapeHTML(owner ? displayName(owner) : (item.user_id || 'Unknown user'))}</strong><span>${escapeHTML(owner?.email || '')}</span></div></div></td>
            <td data-label="Length">${escapeHTML(durationLabel(item.duration_seconds))}</td>
            <td data-label="Added">${escapeHTML(formatDateTime(item.created_at))}</td>
            <td data-label="Actions" class="text-right">${NC.components.rowActions(actions)}</td>
          </tr>`;
        }).join('')
      })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
      NC.components.bindImageFallbacks(content);
      content.querySelectorAll('[data-action]').forEach((button) => {
        const record = trackById(button.dataset.id);
        if (!record) return;
        button.addEventListener('click', () => {
          if (button.dataset.action === 'view') openTrackView(record);
          if (button.dataset.action === 'library') routeTo('music', { action: 'view', id: record.id });
          if (button.dataset.action === 'delete') deleteTrack(record, reload);
        });
      });
      NC.crud.bindPagination(root, state, renderList);
      NC.crud.bindSort(root, state, renderList);
    };
    bindList(state, renderList);
    const userSelect = root.querySelector('[data-ru-user-filter]');
    const applyUser = () => {
      const value = userSelect?.value;
      state.setFilter('__user', value && value !== 'all' ? (_, record) => (trackOwner(record)?.id === value || record.user_id === value) : 'all');
      renderList();
      NC.crud.renderActiveFilters(root.querySelector('[data-ru-active-filters]'), [
        { key: 'user', label: 'User', value: value && value !== 'all' ? displayName(userById(value) || {}) : '' }
      ], {
        onRemove: (key) => { if (key === 'user' && userSelect) { userSelect.value = 'all'; applyUser(); } },
        onClear: () => { if (userSelect) userSelect.value = 'all'; applyUser(); }
      });
    };
    userSelect?.addEventListener('change', applyUser);
    const openId = params.get('id');
    if (presetUser !== 'all' && userSelect && [...userSelect.options].some((option) => option.value === presetUser)) {
      userSelect.value = presetUser;
    } else if (openId && userById(openId) && !trackById(openId) && userSelect) {
      userSelect.value = openId;
    }
    applyUser();
    if (openId && trackById(openId)) openTrackView(trackById(openId));
  }

  const screens = {
    'registered-users': renderHome,
    'ru-users': renderUsers,
    'ru-articles': renderArticles,
    'ru-music': renderMusic,
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
    NC.views[route] = {
      render: (container, context) => render(container, { ...context, route }),
      destroy: () => {
        destroyCharts();
        closeArticleEditor();
      }
    };
  });
})(window.NC);
