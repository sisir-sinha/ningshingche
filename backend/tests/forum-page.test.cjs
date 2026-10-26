'use strict';

/**
 * The dashboard's Forum page: what it reads, what it renders, and what it writes
 * when a moderator hides or deletes.
 *
 * Two things are worth guarding beyond "it renders":
 *
 *  * **A reader's post is never markup here.** The body is HTML written in the
 *    app; the dashboard shows it as text. The test plants a `<script>` and an
 *    `onerror` in a fixture body and asserts that neither survives as an element
 *    or an attribute.
 *  * **Moderation is the database's own words.** Hiding is a PATCH of
 *    `status = 'Unpublish'` on the same table and column the app's RPCs filter
 *    on, and the answers come from the table the dashboard was granted, not from
 *    a view that is revoked.
 *
 * The harness (fixtures, stubs, boot) is shared with the writing suite in
 * `forum-cms.test.cjs`; see `helpers/forum-harness.cjs`.
 *
 * Needs jsdom and skips itself without it (see languages-page.test.cjs):
 *     npm install --no-save jsdom && node --test backend/tests/
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { boot, needs, plain } = require('./helpers/forum-harness.cjs');

const open = async (options = {}, params = '') => {
  const harness = boot(options);
  await harness.window.NC.views.forum.render(harness.root, { route: 'forum', params: new URLSearchParams(params) });
  return harness;
};

// ---------------------------------------------------------------------------
// The page itself
// ---------------------------------------------------------------------------

test('the Forum page lists what readers wrote, as text', async (t) => {
  if (needs(t)) return;
  const h = await open();

  await t.test('it reads the three granted tables and the names it joins', () => {
    const tables = h.of('list').map((call) => call.table);
    assert.deepEqual([...new Set(tables)].sort(), ['forum', 'forumCategories', 'profiles'],
      'the tables migration 029 grants the dashboard — not the revoked views');
    const forum = h.of('list').find((call) => call.table === 'forum');
    assert.ok(!forum.options.select.includes('body_text'), 'no such column is asked for');
    assert.ok(forum.options.select.includes('body'), 'the body is, because the modal shows it');
    assert.ok(forum.options.select.includes('author_name'), 'and the signature the dashboard can set');
  });

  await t.test('every discussion is a row, with its board and reader', () => {
    const rows = h.root.querySelectorAll('tbody tr');
    assert.equal(rows.length, 3, 'all three fixtures');
    assert.match(h.root.innerHTML, /বিষ্ণুপ্রিয়া ভাষার বর্ণমালা/);
    assert.match(h.root.innerHTML, /নবদ্বীপ সিংহ/, 'the reader\'s name, joined from profiles');
    assert.match(h.root.innerHTML, /ভাষা/, 'and the board it was filed under');
  });

  await t.test('the counters say what the forum needs answering', () => {
    const stats = [...h.root.querySelectorAll('.forum-stat')].map((node) => String(node.textContent.trim()));
    assert.deepEqual(stats, ['3Discussions', '3Answers', '1Waiting for an answer', '1Hidden from readers']);
  });

  await t.test('no reader markup is ever a node', () => {
    assert.equal(h.root.querySelectorAll('script').length, 0);
    assert.equal(h.root.querySelectorAll('img').length, 0);
    assert.ok(!/onerror/i.test(h.root.innerHTML), 'the attribute is not carried through');
  });

  await t.test('the page offers to write as well as to moderate', () => {
    assert.ok(h.root.querySelector('[data-forum-new]'), 'New discussion');
    assert.ok(h.root.querySelector('tbody tr [data-action="edit"]'), 'Edit on every row');
  });
});

test('the answers are read from the table, and dangerous markup stays text', async (t) => {
  if (needs(t)) return;
  const h = await open();

  h.root.querySelector('tbody tr [data-action="view"]').dispatchEvent(new h.window.Event('click', { bubbles: true }));
  await h.settle();

  await t.test('the modal shows the thread and asks for its answers', () => {
    const modal = h.modal();
    assert.ok(modal, 'a modal opened');
    assert.match(modal.textContent, /বিষ্ণুপ্রিয়া ভাষার বর্ণমালা/);
    assert.match(modal.textContent, /প্রথম লাইন/);
    assert.match(modal.textContent, /দ্বিতীয় লাইন/, 'the block tags became line breaks, not one run-on line');
    assert.match(modal.textContent, /পরীক্ষা পাঠক/, 'an answer is signed with its reader’s name');
    assert.match(modal.textContent, /তৃতীয় পাঠক/);
    const replies = h.of('list').filter((call) => call.table === 'forumReplies');
    assert.equal(replies.length, 1);
    assert.equal(replies[0].options.filters.discussion_id, 'd1');
    assert.match(replies[0].options.order, /created_at\.asc/, 'answers read oldest first');
  });

  await t.test('the attachment the reader put in the markup is a link', () => {
    const link = h.window.document.querySelector('.forum-attachment');
    assert.ok(link, 'the link is offered');
    assert.equal(link.getAttribute('href'), 'https://example.test/a.pdf');
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(link.getAttribute('target'), '_blank');
  });

  await t.test('a script tag in an answer is text, and its onerror is gone', () => {
    const answers = h.window.document.querySelectorAll('.forum-answer');
    assert.equal(answers.length, 3, 'every answer is listed');
    assert.equal(h.window.document.querySelectorAll('.forum-answer script').length, 0, 'no script element');
    assert.equal(h.window.__pwned, undefined, 'and nothing ran');
    assert.ok(!/onerror/i.test(h.modal().innerHTML), 'no handler attribute');
    assert.match(h.modal().textContent, /দেখুন/, 'the words themselves are kept');
  });

  await t.test('an answer that answers an answer is indented one level', () => {
    const nested = h.window.document.querySelector('.forum-answer.is-reply');
    assert.ok(nested, 'r3 answers r1');
    assert.equal(nested.closest('[data-answers]').querySelectorAll('.forum-answer').length, 3,
      'and they all live in one flat list — the indent is a class, not a tree');
  });
});

test('moderating writes the column the app filters on', async (t) => {
  if (needs(t)) return;

  await t.test('hiding is status = Unpublish on forum_discussions', async () => {
    const h = await open();
    h.root.querySelector('tbody tr [data-action="toggle"]').dispatchEvent(new h.window.Event('click', { bubbles: true }));
    await h.settle();
    const write = h.of('update')[0];
    assert.deepEqual(plain({ table: write.table, id: write.id, payload: write.payload }), {
      table: 'forum', id: 'd1', payload: { status: 'Unpublish' }
    });
  });

  await t.test('restoring is the same write the other way', async () => {
    const h = await open();
    const rows = [...h.root.querySelectorAll('tbody tr')];
    const hiddenRow = rows.find((row) => row.textContent.includes('লুকানো আলোচনা'));
    hiddenRow.querySelector('[data-action="toggle"]').dispatchEvent(new h.window.Event('click', { bubbles: true }));
    await h.settle();
    const write = h.of('update')[0];
    assert.deepEqual(plain({ id: write.id, payload: write.payload }), { id: 'd3', payload: { status: 'Publish' } });
  });

  await t.test('deleting a discussion deletes the row it belongs to', async () => {
    const h = await open();
    h.root.querySelector('tbody tr [data-action="delete"]').dispatchEvent(new h.window.Event('click', { bubbles: true }));
    await h.settle();
    const removal = h.of('delete')[0];
    assert.deepEqual(plain({ table: removal.table, id: removal.id }), { table: 'forum', id: 'd1' });
  });

  await t.test('hiding an answer is a write on forum_replies', async () => {
    const h = await open();
    h.root.querySelector('tbody tr [data-action="view"]').dispatchEvent(new h.window.Event('click', { bubbles: true }));
    await h.settle();
    const button = h.window.document.querySelector('[data-answer-toggle]');
    button.dispatchEvent(new h.window.Event('click', { bubbles: true }));
    await h.settle();
    const write = h.of('update')[0];
    assert.deepEqual(plain({ table: write.table, id: write.id, payload: write.payload }), {
      table: 'forumReplies', id: 'r1', payload: { status: 'Unpublish' }
    });
  });
});

test('the queues a moderator is sent to are the page\'s own filters', async (t) => {
  if (needs(t)) return;

  await t.test('?filter=Unpublish opens on the hidden threads', async () => {
    const h = await open({}, 'filter=Unpublish');
    const rows = [...h.root.querySelectorAll('tbody tr')];
    assert.equal(rows.length, 1);
    assert.match(rows[0].textContent, /লুকানো আলোচনা/);
  });

  await t.test('?filter=Waiting opens on the threads nobody answered', async () => {
    const h = await open({}, 'filter=Waiting');
    const rows = [...h.root.querySelectorAll('tbody tr')];
    assert.equal(rows.length, 1);
    assert.match(rows[0].textContent, /উত্তর নেই/);
  });

  await t.test('?action=view&id=… opens that discussion', async () => {
    const h = await open({}, 'action=view&id=d2');
    const modal = h.modal();
    assert.ok(modal, 'the discussion a notification pointed at is open');
    assert.match(modal.textContent, /উত্তর নেই/);
  });
});
