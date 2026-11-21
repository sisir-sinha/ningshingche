/**
 * The reports queue — what Play asks for when it asks "and then what?".
 *
 * The app lets a reader report a thread, an answer, a comment, a profile, a track
 * or an AI answer (migration 040). That is only half of the policy: the other half
 * is that *someone reads it*. This page is that someone.
 *
 * Three decisions are worth knowing before reading the code:
 *
 *  - **Nothing is removed from here by a button.** A report is a claim, not a
 *    verdict; the queue moves a claim through `open → reviewing → actioned /
 *    dismissed`, and removing the content is a separate, deliberate act on the
 *    Forum, Comments, Music or Users page. A one-tap "delete the reported thing"
 *    is a silencing tool, and reviewers get it wrong often enough that the two
 *    steps should not be the same gesture.
 *
 *  - **Every change writes `handled_by`.** Play's reviewers, and an owner reading
 *    their own queue six months later, both ask who decided. The name is the
 *    dashboard sign-in, which is the only identity this page has.
 *
 *  - **The page borrows the Forum permission** (`permission: 'forum'` in
 *    config.js) instead of claiming a new menu key: `dashboard_save_role` drops a
 *    key that `dashboard_valid_permissions()` does not list, and a role that can
 *    already moderate the forum is exactly the role that should triage its
 *    reports. It is the same arrangement Languages uses to ride on Settings.
 */
(function (NC) {
  'use strict';

  const { escapeHTML, formatDateTime } = NC.utils;
  const state = new NC.crud.ListState('contentReports', {
    searchFields: ['reason', 'note', 'content_type', 'content_id', 'reporter_device'],
    sortKey: 'created_at'
  });

  let root;
  let filterValues = { status: 'open', content_type: 'all', reason: 'all' };

  const CONTENT_TYPES = [
    { value: 'article', label: 'Article' },
    { value: 'discussion', label: 'Forum thread' },
    { value: 'reply', label: 'Forum answer' },
    { value: 'comment', label: 'Blog comment' },
    { value: 'profile', label: 'Profile' },
    { value: 'music', label: 'Music track' },
    { value: 'ai_output', label: 'AI answer' }
  ];

  const REASONS = [
    { value: 'harassment', label: 'Harassment' },
    { value: 'hate', label: 'Hate' },
    { value: 'sexual', label: 'Sexual content' },
    { value: 'violence', label: 'Violence' },
    { value: 'spam', label: 'Spam' },
    { value: 'copyright', label: 'Copyright' },
    { value: 'misinformation', label: 'Misinformation' },
    { value: 'impersonation', label: 'Impersonation' },
    { value: 'other', label: 'Other' }
  ];

  const STATUSES = [
    { value: 'open', label: 'Open', tone: 'danger', icon: 'fa-circle-exclamation' },
    { value: 'reviewing', label: 'Reviewing', tone: 'warning', icon: 'fa-clock' },
    { value: 'actioned', label: 'Actioned', tone: 'success', icon: 'fa-circle-check' },
    { value: 'dismissed', label: 'Dismissed', tone: 'neutral', icon: 'fa-circle-xmark' }
  ];

  function labelOf(list, value, fallback = 'Unknown') {
    return list.find((item) => item.value === value)?.label || fallback;
  }

  function contentLabel(type) {
    return labelOf(CONTENT_TYPES, type, type || 'Unknown');
  }

  function reasonLabel(reason) {
    return labelOf(REASONS, reason, reason || 'Unknown');
  }

  function statusPill(status) {
    const meta = STATUSES.find((item) => item.value === status) || STATUSES[0];
    return `<span class="status-badge status-${meta.tone}"><i class="fa-solid ${meta.icon}" aria-hidden="true"></i>${escapeHTML(meta.label)}</span>`;
  }

  function hasActiveFilters() {
    return filterValues.status !== 'all' || filterValues.content_type !== 'all' || filterValues.reason !== 'all';
  }

  function syncStateFilters() {
    state.setFilter('status', filterValues.status);
    state.setFilter('content_type', filterValues.content_type);
    state.setFilter('reason', filterValues.reason);
  }

  function applyFilter(key, value) {
    if (!(key in filterValues)) return;
    filterValues[key] = value || 'all';
    syncStateFilters();
    const control = root.querySelector(`[data-report-filter="${key}"]`);
    if (control) control.value = filterValues[key];
    renderList();
  }

  function clearFilters() {
    filterValues = { status: 'all', content_type: 'all', reason: 'all' };
    state.setQuery('');
    const search = root.querySelector('[data-report-search]');
    if (search) search.value = '';
    syncStateFilters();
    root.querySelectorAll('[data-report-filter]').forEach((select) => { select.value = 'all'; });
    renderList();
  }

  /** How many of each status, over the whole list rather than the current page. */
  function counts() {
    const tally = { open: 0, reviewing: 0, actioned: 0, dismissed: 0 };
    state.records.forEach((record) => {
      if (record.status in tally) tally[record.status] += 1;
    });
    return tally;
  }

  function renderSummary() {
    const host = root.querySelector('[data-report-summary]');
    if (!host) return;
    const tally = counts();
    host.innerHTML = STATUSES.map((status) => `
      <button type="button" class="report-stat${filterValues.status === status.value ? ' is-active' : ''}" data-report-status="${status.value}">
        <span class="report-stat-value">${Number(tally[status.value] || 0).toLocaleString()}</span>
        <span class="report-stat-label">${escapeHTML(status.label)}</span>
      </button>`).join('');
    host.querySelectorAll('[data-report-status]').forEach((button) => {
      button.addEventListener('click', () => applyFilter('status', button.dataset.reportStatus));
    });
  }

  /**
   * Some content can be opened where it lives, so the reviewer reads the thread in
   * its context before deciding. The forum's own route takes `?action=view&id=…`;
   * a reply is shown from the thread it answers, which is the row this page has to
   * look up first.
   */
  function openLink(record) {
    if (record.content_type === 'article' && NC.auth.canAccess('blogs')) {
      return { route: 'blogs', params: { action: 'view', id: record.content_id }, label: 'Open the article' };
    }
    if (record.content_type === 'discussion') {
      return { route: 'forum', params: { action: 'view', id: record.content_id }, label: 'Open the thread' };
    }
    if (record.content_type === 'comment') {
      return { route: 'comments', params: { action: 'view', id: record.content_id }, label: 'Open the comment' };
    }
    if (record.content_type === 'music' && NC.auth.canAccess('music')) {
      return { route: 'music', params: { action: 'view', id: record.content_id }, label: 'Open the track' };
    }
    if (record.content_type === 'profile' && NC.auth.canAccess('registered-users')) {
      return { route: 'ru-users', params: { action: 'view', id: record.content_id }, label: 'Open the profile' };
    }
    return null;
  }

  function renderList() {
    const content = root.querySelector('[data-reports-content]');
    const { rows, total } = state.paged();
    renderSummary();
    if (!total) {
      const filtered = Boolean(state.query) || hasActiveFilters();
      content.innerHTML = NC.components.emptyState({
        icon: 'fa-flag',
        title: filtered ? 'No reports match these filters' : 'Nothing has been reported',
        description: filtered
          ? 'Try another status, another kind of content, or clear the filters.'
          : 'Reports readers send from the app arrive here. Nothing is hidden automatically — an editor reads each one.',
        action: filtered
          ? '<button type="button" class="btn btn-secondary" data-clear-report-filters><i class="fa-regular fa-filter-slash" aria-hidden="true"></i>Clear filters</button>'
          : ''
      });
      bindListEvents(content);
      return;
    }
    const body = rows.map((record) => {
      const reporter = record.reporter_user_id
        ? (record.reporter_user_id.slice(0, 8) + '…')
        : (record.reporter_device ? 'Guest · ' + record.reporter_device.slice(0, 8) + '…' : 'Unknown');
      return `
      <tr>
        <td data-label="Reported">
          <div class="comment-cell">
            <strong>${escapeHTML(contentLabel(record.content_type))}</strong>
            <p>${escapeHTML(reasonLabel(record.reason))}${record.note ? ' — ' + escapeHTML(NC.utils.truncate(record.note, 110)) : ''}</p>
            <small>${record.content_id ? escapeHTML(record.content_id.slice(0, 12)) + '…' : 'No reference'}</small>
          </div>
        </td>
        <td data-label="Reporter"><span class="stacked-cell"><span>${escapeHTML(reporter)}</span>${record.reported_user_id ? `<small>against ${escapeHTML(record.reported_user_id.slice(0, 8))}…</small>` : ''}</span></td>
        <td data-label="Status">${statusPill(record.status)}</td>
        <td data-label="Received"><time datetime="${escapeHTML(record.created_at || '')}">${escapeHTML(formatDateTime(record.created_at))}</time></td>
        <td data-label="Actions" class="text-right">${NC.components.rowActions([
          { action: 'view', id: record.id, label: 'Read the report', icon: 'fa-eye' },
          ...(record.status === 'open' ? [{ action: 'review', id: record.id, label: 'Start reviewing', icon: 'fa-clock' }] : []),
          ...(record.status === 'reviewing' ? [
            { action: 'actioned', id: record.id, label: 'Mark as actioned', icon: 'fa-circle-check' },
            { action: 'dismissed', id: record.id, label: 'Dismiss this report', icon: 'fa-circle-xmark' }
          ] : [])
        ])}</td>
      </tr>`;
    }).join('');
    content.innerHTML = `${NC.components.tableShell({
      caption: 'Content reports',
      minWidth: '940px',
      head: '<tr><th>Reported</th><th>Reporter</th><th>Status</th><th><button type="button" data-sort="created_at">Received ' + NC.crud.sortIcon(state, 'created_at') + '</button></th><th class="text-right">Actions</th></tr>',
      body
    })}${NC.components.pagination({ page: state.page, pageSize: state.pageSize, total })}`;
    bindListEvents(content);
  }

  function bindListEvents(scope = root) {
    scope.querySelectorAll('[data-clear-report-filters]').forEach((button) => {
      button.addEventListener('click', () => clearFilters());
    });
    scope.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const record = state.records.find((item) => item.id === button.dataset.id);
        if (!record) return;
        const action = button.dataset.action;
        if (action === 'view') openView(record);
        if (action === 'review') setStatus(record, 'reviewing');
        if (action === 'actioned') setStatus(record, 'actioned');
        if (action === 'dismissed') setStatus(record, 'dismissed');
      });
    });
    NC.crud.bindPagination(root, state, renderList);
    NC.crud.bindSort(root, state, renderList);
  }

  function openView(record) {
    const link = openLink(record);
    const rows = [
      ['Kind of content', contentLabel(record.content_type)],
      ['Reason given', reasonLabel(record.reason)],
      ['Note from the reader', record.note || '—'],
      ['The content', record.content_id || '—'],
      ['Reported user', record.reported_user_id || 'Not attributed'],
      ['Reporter', record.reporter_user_id || (record.reporter_device ? 'Guest · ' + record.reporter_device : 'Unknown')],
      ['Received', formatDateTime(record.created_at)],
      ['Last changed', formatDateTime(record.updated_at)],
      ['Handled by', record.handled_by || 'Nobody yet']
    ];
    NC.components.openModal({
      title: 'Report · ' + contentLabel(record.content_type),
      content: `
        ${NC.components.notice(
          record.status === 'open'
            ? 'Nothing has been done about this yet. Read the content before deciding.'
            : (record.status === 'reviewing'
              ? 'Someone is looking at this. Mark it actioned once the content is dealt with, or dismissed if it breaks no rule.'
              : (record.status === 'actioned'
                ? 'This report was acted on. The content itself is removed from its own page — this page never deletes anything.'
                : 'This report was dismissed as not breaking the rules.')),
          record.status === 'dismissed' ? 'info' : (record.status === 'actioned' ? 'success' : 'warning')
        )}
        <dl class="details-grid mt-4">${rows.map(([term, value]) => `<div><dt>${escapeHTML(term)}</dt><dd>${escapeHTML(String(value))}</dd></div>`).join('')}</dl>
        ${link ? `<p class="form-hint"><a class="btn btn-secondary" href="#/${escapeHTML(link.route)}?action=${escapeHTML(link.params.action)}&id=${encodeURIComponent(link.params.id)}"><i class="fa-regular fa-arrow-up-right-from-square" aria-hidden="true"></i>${escapeHTML(link.label)}</a></p>` : ''}
      `,
      footer: `
        <button type="button" class="btn btn-secondary" data-modal-close>Close</button>
        ${record.status === 'open' ? '<button type="button" class="btn btn-primary" data-report-set="reviewing">Start reviewing</button>' : ''}
        ${record.status === 'reviewing' ? '<button type="button" class="btn btn-secondary" data-report-set="dismissed">Dismiss</button><button type="button" class="btn btn-primary" data-report-set="actioned">Mark actioned</button>' : ''}
      `
    });
    const footer = document.querySelector('.modal-footer') || document;
    footer.querySelectorAll('[data-report-set]').forEach((button) => {
      button.addEventListener('click', () => {
        NC.components.closeModal('report');
        setStatus(record, button.dataset.reportSet);
      });
    });
  }

  /**
   * The one write this page makes. `handled_by` is the dashboard sign-in name, so a
   * decision can be traced back to a person rather than to "the dashboard".
   */
  async function setStatus(record, status) {
    // `NC.state.session.user` is the sign-in the dashboard already keeps; the
    // configured display name is the fallback for a legacy password-only login,
    // which has no user row to read a name from.
    const user = NC.state?.session?.user || {};
    const editor = String(user.name || user.username || NC_CONFIG.auth?.displayName || 'Editor').trim();
    try {
      const updated = await NC.api.update('contentReports', record.id, {
        status,
        handled_by: editor,
        updated_at: new Date().toISOString()
      });
      if (!updated) throw new Error('The report was not updated. Refresh and try again.');
      const rows = state.records.map((item) => (item.id === record.id ? { ...item, ...updated } : item));
      state.setRecords(rows);
      renderList();
      NC.components.toast(
        status === 'reviewing' ? 'This report is yours now — it moved to Reviewing.'
          : (status === 'actioned' ? 'Marked actioned. Remove the content from its own page.'
            : 'Dismissed. The content stays where it is.'),
        status === 'actioned' ? 'success' : 'info'
      );
    } catch (error) {
      console.error(error);
      NC.components.toast(NC.api.userMessage(error, 'The report could not be updated.'), 'error');
    }
  }

  async function load(context = {}) {
    const content = root.querySelector('[data-reports-content]');
    content.innerHTML = NC.components.skeleton(6, 5);
    try {
      const result = await NC.api.list('contentReports', {
        select: '*',
        order: 'created_at.desc',
        limit: 2000
      });
      if (NC.crud.isStaleNavigation(context)) return;
      state.setRecords(result.data);
      syncStateFilters();
      renderList();
      const action = context.params?.get('action');
      const id = context.params?.get('id');
      if (id && ['view', 'review'].includes(action)) {
        const record = state.records.find((item) => item.id === id);
        if (record) openView(record);
      }
    } catch (error) {
      NC.crud.handleLoadError(content, error, () => load(context), context);
    }
  }

  function render(container, context = {}) {
    root = container;
    const params = context.params || new URLSearchParams();
    filterValues = {
      status: params.get('status') || 'open',
      content_type: params.get('type') || 'all',
      reason: params.get('reason') || 'all'
    };
    state.setQuery('');
    syncStateFilters();
    root.innerHTML = `
      ${NC.components.pageHeader({
        eyebrow: 'Community',
        title: 'Reports',
        description: 'What readers flagged in the app, and what was done about it. Nothing here is hidden by the tap that reported it.',
        breadcrumb: [{ label: 'Reports' }]
      })}
      <section class="surface">
        <div class="report-stats" data-report-summary></div>
        <div class="list-toolbar">
          <label class="search-field">
            <i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i>
            <span class="sr-only">Search reports</span>
            <input type="search" placeholder="Search reports…" data-report-search>
          </label>
          <select class="form-select toolbar-select" data-report-filter="content_type" aria-label="Filter by kind of content">
            <option value="all">All content</option>
            ${CONTENT_TYPES.map((type) => `<option value="${escapeHTML(type.value)}">${escapeHTML(type.label)}</option>`).join('')}
          </select>
          <select class="form-select toolbar-select" data-report-filter="reason" aria-label="Filter by reason">
            <option value="all">All reasons</option>
            ${REASONS.map((reason) => `<option value="${escapeHTML(reason.value)}">${escapeHTML(reason.label)}</option>`).join('')}
          </select>
        </div>
        <div data-reports-content>${NC.components.skeleton(6, 5)}</div>
      </section>`;
    root.querySelectorAll('[data-report-filter]').forEach((select) => {
      select.value = filterValues[select.dataset.reportFilter] || 'all';
      select.addEventListener('change', (event) => applyFilter(select.dataset.reportFilter, event.target.value));
    });
    root.querySelector('[data-report-search]').addEventListener('input', NC.utils.debounce((event) => {
      state.setQuery(event.target.value);
      renderList();
    }, 220));
    return load(context);
  }

  NC.views.reports = { render };
})(window.NC);
