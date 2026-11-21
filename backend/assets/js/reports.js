/**
 * The reports queue — what Play asks for when it asks "and then what?".
 *
 * The app lets a reader report a thread, an answer, a comment, a profile, a track
 * or an AI answer (migration 040). That is only half of the policy: the other half
 * is that *someone reads it*. This page is that someone.
 *
 * Reviewers open reports before deciding. The server authenticates the dashboard
 * session, records decision reasons and actor IDs, and can transactionally
 * unpublish supported content without deleting it. Article and comment actions
 * also require their respective dashboard permissions.
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
        if (action === 'remove') setStatus(record, 'remove');
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
      ['Handled by', record.handled_by || 'Nobody yet'],
      ['Decision reason', record.decision_reason || '—']
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
                ? 'This report was actioned. Check the decision reason and audit for what happened; content is never deleted automatically.'
                : 'This report was dismissed as not breaking the rules.')),
          record.status === 'dismissed' ? 'info' : (record.status === 'actioned' ? 'success' : 'warning')
        )}
        <dl class="details-grid mt-4">${rows.map(([term, value]) => `<div><dt>${escapeHTML(term)}</dt><dd>${escapeHTML(String(value))}</dd></div>`).join('')}</dl>
        <section class="mt-4" aria-label="Evidence snapshot">
          <strong>Evidence snapshot</strong>
          <p data-report-evidence>Loading snapshot…</p>
        </section>
        ${link ? `<p class="form-hint"><a class="btn btn-secondary" href="#/${escapeHTML(link.route)}?action=${escapeHTML(link.params.action)}&id=${encodeURIComponent(link.params.id)}"><i class="fa-regular fa-arrow-up-right-from-square" aria-hidden="true"></i>${escapeHTML(link.label)}</a></p>` : ''}
      `,
      footer: `
        <button type="button" class="btn btn-secondary" data-modal-close>Close</button>
        ${record.status === 'open' ? '<button type="button" class="btn btn-primary" data-report-set="reviewing">Start reviewing</button>' : ''}
        ${record.status === 'reviewing' ? '<button type="button" class="btn btn-secondary" data-report-set="dismissed">Dismiss</button><button type="button" class="btn btn-primary" data-report-set="actioned">Mark actioned</button>' : ''}
        ${record.status === 'reviewing' && ['article', 'comment', 'discussion', 'reply'].includes(record.content_type) ? '<button type="button" class="btn btn-danger" data-report-set="remove">Unpublish content &amp; resolve</button>' : ''}
      `
    });
    // textContent prevents report content from becoming executable markup. Older
    // reports and AI IDs have no verified snapshot; never invent one.
    const evidenceHost = document.querySelector('[data-report-evidence]');
    if (evidenceHost) {
      NC.api.rpc('dashboard_report_evidence', { p_report_id: record.id }).then((evidence) => {
        if (!evidenceHost.isConnected) return;
        evidenceHost.textContent = evidence && typeof evidence.snapshot === 'string'
          ? (evidence.snapshot || 'The verified snapshot is empty.')
          : 'No verified snapshot is available for this report.';
      }).catch(() => {
        if (evidenceHost.isConnected) evidenceHost.textContent = 'The evidence snapshot could not be loaded.';
      });
    }
    const footer = document.querySelector('.modal-footer') || document;
    footer.querySelectorAll('[data-report-set]').forEach((button) => {
      button.addEventListener('click', () => {
        NC.components.closeModal('report');
        setStatus(record, button.dataset.reportSet);
      });
    });
  }

  // Reasons and the moderator identity are enforced by the server. Cancelling a
  // prompt performs no write; unpublishing and its audit are one transaction.
  async function setStatus(record, status) {
    const actions = { reviewing: 'review', dismissed: 'dismiss', actioned: 'resolve', remove: 'remove' };
    const action = actions[status];
    if (!action) return;
    let reason = '';
    if (action !== 'review') {
      const answer = window.prompt(action === 'remove'
        ? 'Reason for unpublishing this content (required):'
        : 'Reason for this decision (required):');
      if (answer === null) return;
      reason = answer.trim();
      if (reason.length < 3 || reason.length > 1000) {
        NC.components.toast('Enter a reason of 3–1000 characters.', 'error');
        return;
      }
    }
    try {
      const updated = await NC.api.rpc('dashboard_moderate_report', {
        p_report_id: record.id, p_action: action, p_reason: reason
      });
      if (!updated) throw new Error('The report was not updated. Refresh and try again.');
      state.setRecords(state.records.map((item) => (item.id === record.id ? { ...item, ...updated } : item)));
      renderList();
      NC.components.toast(action === 'remove' ? 'Content unpublished and report resolved.' : 'Report updated.', 'info');
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

  // Account enforcement is intentionally separate from a report verdict. The
  // server requires a super-admin session even if this panel is shown to others.
  function bindAccountModeration() {
    const panel = root.querySelector('[data-account-moderation]');
    const form = panel.querySelector('[data-account-form]');
    let pending = null;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const action = String(data.get('action'));
      const target = String(data.get('user_id')).trim();
      const reason = String(data.get('reason')).trim();
      const hours = Number(data.get('hours'));
      const isRestriction = action.startsWith('restrict_') || action === 'suspend';
      const reference = action === 'lift' ? String(data.get('restriction_id')).trim() : null;
      if (!target || reason.length < 3 || reason.length > 1000 ||
          (action === 'lift' && !reference) ||
          (isRestriction && (!Number.isInteger(hours) || hours < 1 || hours > 8760))) {
        NC.components.toast('Enter a user ID, a reason, and the required duration or restriction ID.', 'error');
        return;
      }
      const signature = JSON.stringify([target, action, reason, isRestriction ? hours : null, reference]);
      if (!window.confirm('Apply this account action? It is recorded and is not based on report counts.')) return;
      if (!pending || pending.signature !== signature) {
        pending = { signature, request: {
          p_request_id: crypto.randomUUID(), p_user_id: target, p_action: action, p_reason: reason,
          p_expires_at: isRestriction ? new Date(Date.now() + hours * 3600000).toISOString() : null,
          p_restriction_id: reference
        } };
      }
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const result = await NC.api.rpc('dashboard_account_action', pending.request);
        if (!result || !result.id) throw new Error('No action was returned.');
        pending = null;
        NC.components.toast('Account action recorded. Action ID: ' + result.id, 'success');
      } catch (error) {
        NC.components.toast(NC.api.userMessage(error, 'Account action failed.'), 'error');
      } finally { submit.disabled = false; }
    });

    panel.querySelector('[data-load-history]').addEventListener('click', async () => {
      const host = panel.querySelector('[data-account-history]');
      const userId = String(new FormData(form).get('user_id')).trim();
      if (!userId) { host.textContent = 'Enter a user ID first.'; return; }
      host.textContent = 'Loading account decisions…';
      try {
        const rows = await NC.api.rpc('dashboard_account_history', { p_user_id: userId, p_limit: 100 });
        if (!Array.isArray(rows)) throw new Error('No history was returned.');
        host.innerHTML = rows.length ? rows.map((row) => `<p><strong>${escapeHTML(row.action)}</strong> · ${escapeHTML(formatDateTime(row.created_at))}<br>Action ID: ${escapeHTML(row.id)} · Moderator: ${escapeHTML(row.moderator_id)}<br>${escapeHTML(row.previous_status)} → ${escapeHTML(row.new_status)}${row.expires_at ? ' · Until ' + escapeHTML(formatDateTime(row.expires_at)) : ''}<br>${escapeHTML(row.reason)}</p>`).join('') : '<p>No account decisions found.</p>';
      } catch (error) { host.textContent = NC.api.userMessage(error, 'History could not be loaded.'); }
    });

    let offset = 0;
    const status = panel.querySelector('[data-appeal-status]');
    const list = panel.querySelector('[data-appeal-list]');
    async function loadAppeals() {
      list.textContent = 'Loading appeals…';
      try {
        const rows = await NC.api.rpc('dashboard_list_moderation_appeals', {
          p_status: status.value, p_limit: 25, p_offset: offset
        });
        if (!Array.isArray(rows)) throw new Error('No appeal list was returned.');
        list.innerHTML = rows.length ? rows.map((row) => `
          <article class="surface mt-4">
            <strong>${escapeHTML(row.status)}</strong> · ${escapeHTML(formatDateTime(row.created_at))}
            <p>User: ${escapeHTML(row.user_id)} · Decision: ${escapeHTML(row.event_id)}</p>
            <p>${escapeHTML(row.explanation)}</p>
            ${row.outcome_reason ? `<p>Outcome: ${escapeHTML(row.outcome_reason)}</p>` : ''}
            ${row.status === 'pending' ? `<button type="button" class="btn btn-secondary" data-appeal-id="${escapeHTML(row.id)}" data-appeal-action="review">Start review</button>` : ''}
            ${row.status === 'reviewing' ? `<button type="button" class="btn btn-primary" data-appeal-id="${escapeHTML(row.id)}" data-appeal-action="accept">Accept</button> <button type="button" class="btn btn-secondary" data-appeal-id="${escapeHTML(row.id)}" data-appeal-action="reject">Reject</button>` : ''}
          </article>`).join('') : '<p>No appeals on this page.</p>';
        panel.querySelector('[data-appeal-prev]').disabled = offset === 0;
        panel.querySelector('[data-appeal-next]').disabled = rows.length < 25 || offset >= 10000;
      } catch (error) {
        list.textContent = NC.api.userMessage(error, 'Appeals could not be loaded.');
      }
    }
    panel.addEventListener('toggle', () => { if (panel.open) loadAppeals(); });
    status.addEventListener('change', () => { offset = 0; loadAppeals(); });
    panel.querySelector('[data-appeal-prev]').addEventListener('click', () => { offset = Math.max(0, offset - 25); loadAppeals(); });
    panel.querySelector('[data-appeal-next]').addEventListener('click', () => { offset += 25; loadAppeals(); });
    list.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-appeal-action]');
      if (!button) return;
      const action = button.dataset.appealAction;
      let reason = '';
      if (action !== 'review') {
        const input = window.prompt('Decision reason (required):');
        if (input === null) return;
        reason = input.trim();
        if (reason.length < 3 || reason.length > 1000) { NC.components.toast('Enter a reason of 3–1000 characters.', 'error'); return; }
        if (!window.confirm('Record this appeal decision? Restrictions are not lifted automatically.')) return;
      }
      button.disabled = true;
      try {
        await NC.api.rpc('dashboard_decide_appeal', { p_id: button.dataset.appealId, p_action: action, p_reason: reason });
        await loadAppeals();
      } catch (error) { NC.components.toast(NC.api.userMessage(error, 'Appeal decision failed.'), 'error'); button.disabled = false; }
    });
  }

  function bindPolicySettings() {
    const panel = root.querySelector('[data-policy-settings]');
    const form = panel.querySelector('[data-policy-form]');
    const select = form.querySelector('[name="code"]');
    let policies = [];
    function fillPolicy() {
      const row = policies.find((item) => item.code === select.value);
      if (!row) return;
      form.elements.label.value = row.label;
      form.elements.description.value = row.description;
      form.elements.severity.value = row.severity;
      form.elements.content_types.value = row.content_types.join(', ');
      form.elements.recommended_action.value = row.recommended_action;
      form.elements.appeal_eligible.checked = row.appeal_eligible;
    }
    async function loadPolicies() {
      try {
        const rows = await NC.api.rpc('moderation_policy_catalog');
        if (!Array.isArray(rows)) throw new Error('Policy catalog unavailable.');
        policies = rows;
        select.innerHTML = rows.map((row) => `<option value="${escapeHTML(row.code)}">${escapeHTML(row.label)}</option>`).join('');
        fillPolicy();
      } catch (error) { NC.components.toast(NC.api.userMessage(error, 'Policies could not be loaded.'), 'error'); }
    }
    panel.addEventListener('toggle', () => { if (panel.open) loadPolicies(); });
    select.addEventListener('change', fillPolicy);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const types = form.elements.content_types.value.split(',').map((x) => x.trim()).filter(Boolean);
      const reason = form.elements.reason.value.trim();
      if (reason.length < 3 || !types.length) { NC.components.toast('Enter a reason and content types.', 'error'); return; }
      if (!window.confirm('Save these policy recommendations? This does not automatically enforce them.')) return;
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        await NC.api.rpc('dashboard_update_moderation_policy', {
          p_code: select.value, p_label: form.elements.label.value.trim(),
          p_description: form.elements.description.value.trim(), p_severity: form.elements.severity.value,
          p_content_types: types, p_recommended_action: form.elements.recommended_action.value,
          p_appeal_eligible: form.elements.appeal_eligible.checked, p_reason: reason
        });
        NC.components.toast('Policy recommendation saved.', 'success');
        await loadPolicies();
      } catch (error) { NC.components.toast(NC.api.userMessage(error, 'Policy could not be saved.'), 'error'); }
      finally { button.disabled = false; }
    });
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
      </section>
      <details class="surface mt-4" data-account-moderation>
        <summary>Account actions and appeals — super administrators</summary>
        <p>Only an authorized super administrator can use these controls. An accepted appeal does not automatically lift a restriction.</p>
        <form data-account-form>
          <label>User ID <input class="form-control" name="user_id" required maxlength="36"></label>
          <label>Action <select class="form-select" name="action">
            <option value="warning">Warning</option><option value="restrict_publishing">Restrict publishing</option>
            <option value="restrict_comments">Restrict comments</option><option value="restrict_forum">Restrict forum</option>
            <option value="suspend">Suspend posting</option><option value="lift">Lift an active restriction</option>
          </select></label>
          <label>Reason <textarea class="form-control" name="reason" required minlength="3" maxlength="1000"></textarea></label>
          <label>Duration in hours (restrictions only) <input class="form-control" name="hours" type="number" min="1" max="8760" value="24"></label>
          <label>Restriction action ID (lift only) <input class="form-control" name="restriction_id" maxlength="36"></label>
          <button type="submit" class="btn btn-primary">Review and record action</button>
        </form>
        <button type="button" class="btn btn-secondary" data-load-history>Show this user's account decisions</button>
        <div data-account-history aria-live="polite"></div>
        <h3>Appeals</h3>
        <label>Status <select class="form-select" data-appeal-status>
          <option value="pending">Pending</option><option value="reviewing">Under review</option>
          <option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="all">All</option>
        </select></label>
        <div data-appeal-list aria-live="polite"></div>
        <button type="button" class="btn btn-secondary" data-appeal-prev disabled>Previous</button>
        <button type="button" class="btn btn-secondary" data-appeal-next disabled>Next</button>
      </details>
      <details class="surface mt-4" data-policy-settings>
        <summary>Moderation policy settings</summary>
        <p>Recommendations only; changes require a super administrator and do not automatically enforce actions or determine appeal eligibility.</p>
        <form data-policy-form>
          <label>Category <select class="form-select" name="code"></select></label>
          <label>Label <input class="form-control" name="label" required maxlength="100"></label>
          <label>Description <textarea class="form-control" name="description" required maxlength="1000"></textarea></label>
          <label>Severity <select class="form-select" name="severity"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label>Content types (comma-separated) <input class="form-control" name="content_types" required></label>
          <label>Recommended action <select class="form-select" name="recommended_action"><option value="review">Review</option><option value="warning">Warning</option><option value="remove">Remove</option><option value="restrict">Restrict</option></select></label>
          <label><input type="checkbox" name="appeal_eligible"> Recommended appeal eligibility</label>
          <label>Reason for change <textarea class="form-control" name="reason" required minlength="3" maxlength="1000"></textarea></label>
          <button type="submit" class="btn btn-primary">Save policy recommendation</button>
        </form>
      </details>`;
    bindAccountModeration();
    bindPolicySettings();
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
