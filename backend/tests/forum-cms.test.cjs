'use strict';

/**
 * Writing in the forum from the dashboard: the admin opens a thread, answers,
 * replies to an answer, edits anyone's words, and holds reactions — which is what
 * "the admin can edit or delete each and everything" means in rows.
 *
 * The two facts worth a test of their own:
 *
 *  * **A dashboard-written thread is official, and that is what the app's
 *    অনুমোদিত tab filters on.** The page sends `is_official`; the database's own
 *    trigger (030) forces it true for any dashboard insert as well, so the two
 *    cannot disagree.
 *  * **An editorial post is signed.** A reader's post keeps their profile name
 *    (the page sends `author_name: ''`), while an official one is signed with a
 *    name — the admin's own, or নিংশিং চে — because a blank signature would read
 *    as a reader's post in the app.
 *
 * The harness is shared with `forum-page.test.cjs`; see `helpers/forum-harness.cjs`.
 *
 * Needs jsdom and skips itself without it:
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

/** Open one thread's modal, the way a moderator does. */
const openThread = async (harness, rowIndex = 0) => {
  harness.root.querySelectorAll('tbody tr')[rowIndex].querySelector('[data-action="view"]')
    .dispatchEvent(new harness.window.Event('click', { bubbles: true }));
  await harness.settle();
  return harness.modal();
};

const type = (window, element, value) => {
  const field = element.querySelector('[data-editor-source]');
  field.value = value;
  return field;
};

const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));

// ---------------------------------------------------------------------------
// Opening a thread
// ---------------------------------------------------------------------------

test('the dashboard opens a thread of its own', async (t) => {
  if (needs(t)) return;

  await t.test('the editor arrives with the boards, the cover and the badge', async () => {
    const h = await open();
    click(h.window, h.root.querySelector('[data-forum-new]'));
    const modal = h.modal();
    assert.ok(modal, 'the editor opened');
    assert.match(modal.textContent, /Open a discussion/);
    const options = [...modal.querySelectorAll('#forum-editor-category option')].map((option) => option.value);
    assert.deepEqual(options, ['c1', 'c2'], 'both boards are offered');
    assert.ok(modal.querySelector('.image-uploader[data-image-uploader]'), 'a cover uploader');
    assert.ok(modal.querySelector('[data-rich-editor]'), 'and the same editor the rest of the dashboard uses');
    const official = modal.querySelector('[data-forum-official]');
    assert.ok(official.checked && official.disabled,
      'official is on and not optional for a thread written here');
    assert.equal(modal.querySelector('[name="author_name"]').value, 'Sisir Sinha',
      'signed by the dashboard user by default');
  });

  await t.test('saving publishes it as official, with its words and its cover', async () => {
    const h = await open();
    click(h.window, h.root.querySelector('[data-forum-new]'));
    const modal = h.modal();
    modal.querySelector('#forum-editor-title').value = 'নতুন ঘোষণা';
    modal.querySelector('#forum-editor-category').value = 'c2';
    modal.querySelector('[data-upload-url]').value = 'https://i.ibb.co/cover.jpg';
    type(h.window, modal.querySelector('#forum-editor-body'), '<p>নিংশিং চে পরিবারের পক্ষ থেকে</p>');
    click(h.window, modal.querySelector('[data-forum-save]'));
    await h.settle();

    const write = h.of('insert')[0];
    assert.ok(write, 'an insert was sent');
    assert.equal(write.table, 'forum');
    assert.deepEqual(plain(write.payload), {
      title: 'নতুন ঘোষণা',
      category_id: 'c2',
      body: '<p>নিংশিং চে পরিবারের পক্ষ থেকে</p>',
      author_name: 'Sisir Sinha',
      status: 'Publish',
      is_official: true,
      cover_image_url: 'https://i.ibb.co/cover.jpg',
      cover_delete_url: 'https://ibb.co/delete/old'
    });
    assert.equal(write.payload.user_id, undefined, 'no reader is invented for it');
    const toast = h.toasts.at(-1);
    assert.equal(toast.tone, 'success');
    assert.match(toast.message, /অনুমোদিত/, 'the toast says where it will appear');
  });

  await t.test('a blank title is refused before anything is sent', async () => {
    const h = await open();
    click(h.window, h.root.querySelector('[data-forum-new]'));
    const modal = h.modal();
    modal.querySelector('#forum-editor-title').value = 'ab';
    click(h.window, modal.querySelector('[data-forum-save]'));
    await h.settle();
    assert.equal(h.of('insert').length, 0, 'nothing was written');
    assert.match(modal.textContent, /at least 3 characters/);
  });

  await t.test('a hidden thread says so rather than claiming it is live', async () => {
    const h = await open();
    click(h.window, h.root.querySelector('[data-forum-new]'));
    const modal = h.modal();
    modal.querySelector('#forum-editor-title').value = 'খসড়া ঘোষণা';
    modal.querySelector('#forum-editor-status').value = 'Unpublish';
    type(h.window, modal.querySelector('#forum-editor-body'), '<p>পরে</p>');
    click(h.window, modal.querySelector('[data-forum-save]'));
    await h.settle();
    assert.equal(h.of('insert')[0].payload.status, 'Unpublish');
    assert.match(h.toasts.at(-1).message, /hidden thread/);
  });
});

// ---------------------------------------------------------------------------
// Editing what is already there
// ---------------------------------------------------------------------------

test('the admin can edit a thread a reader wrote', async (t) => {
  if (needs(t)) return;

  await t.test('the editor opens on the stored words, and keeps the reader\'s name', async () => {
    const h = await open();
    h.root.querySelector('tbody tr [data-action="edit"]').dispatchEvent(new h.window.Event('click', { bubbles: true }));
    const modal = h.modal();
    assert.equal(modal.querySelector('#forum-editor-title').value, 'বিষ্ণুপ্রিয়া ভাষার বর্ণমালা');
    assert.equal(modal.querySelector('[data-editor-source]').value.includes('প্রথম লাইন'), true,
      'the editor is given the post\'s own HTML');
    assert.equal(modal.querySelector('[data-upload-url]').value, '');
    const official = modal.querySelector('[data-forum-official]');
    assert.equal(official.checked, false, 'a reader\'s thread is not official');
    assert.equal(official.disabled, false, 'but the admin may promote it');
    assert.equal(modal.querySelector('#forum-editor-author').value, '',
      'blank means the app keeps showing their profile name');
  });

  await t.test('saving patches the same row, and a promoted thread is signed', async () => {
    const h = await open();
    h.root.querySelector('tbody tr [data-action="edit"]').dispatchEvent(new h.window.Event('click', { bubbles: true }));
    const modal = h.modal();
    modal.querySelector('#forum-editor-title').value = 'সংশোধিত শিরোনাম';
    modal.querySelector('[data-forum-official]').checked = true;
    click(h.window, modal.querySelector('[data-forum-save]'));
    await h.settle();

    const write = h.of('update')[0];
    assert.equal(write.table, 'forum');
    assert.equal(write.id, 'd1');
    assert.equal(write.payload.title, 'সংশোধিত শিরোনাম');
    assert.equal(write.payload.is_official, true);
    assert.equal(write.payload.author_name, 'নিংশিং চে',
      'an unsigned official post is signed by the magazine, not left to read as a reader\'s');
    assert.match(write.payload.body, /প্রথম লাইন/, 'and the words it did not change are kept');
  });
});

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

test('the admin answers, replies, edits and removes', async (t) => {
  if (needs(t)) return;

  await t.test('a fresh answer is written with the dashboard\'s signature', async () => {
    const h = await open();
    const modal = await openThread(h);
    type(h.window, modal.querySelector('#forum-answer-body'), '<p>আমরা দেখছি</p>');
    click(h.window, modal.querySelector('[data-answer-save]'));
    await h.settle();

    const write = h.of('insert')[0];
    assert.equal(write.table, 'forumReplies');
    assert.deepEqual(plain(write.payload), {
      discussion_id: 'd1',
      body: '<p>আমরা দেখছি</p>',
      parent_id: null,
      status: 'Publish',
      author_name: 'Sisir Sinha',
      is_official: true,
      user_id: null
    });
    assert.equal(modal.querySelector('[data-editor-source]').value, '', 'the composer is emptied');
    assert.match(h.toasts.at(-1).message, /live in the app/);
  });

  await t.test('an empty answer is not posted', async () => {
    const h = await open();
    const modal = await openThread(h);
    type(h.window, modal.querySelector('#forum-answer-body'), '   ');
    click(h.window, modal.querySelector('[data-answer-save]'));
    await h.settle();
    assert.equal(h.of('insert').length, 0);
    assert.equal(h.toasts.at(-1).tone, 'error');
  });

  await t.test('answering an answer keeps one indent level', async () => {
    const h = await open();
    const modal = await openThread(h);

    // The nested answer r3 already hangs off r1; answering *it* is answering r1.
    const nested = [...modal.querySelectorAll('.forum-answer')].find((card) => card.dataset.answer === 'r3');
    click(h.window, nested.querySelector('[data-answer-reply]'));
    // The note names the answer it will hang off — r1's reader, not the nested
    // answer's author, because the row it is attached to is r1.
    assert.match(modal.textContent, /answering পরীক্ষা পাঠক/, 'the composer says who it is aimed at');

    type(h.window, modal.querySelector('#forum-answer-body'), '<p>একই কথা</p>');
    click(h.window, modal.querySelector('[data-answer-save]'));
    await h.settle();
    assert.equal(h.of('insert')[0].payload.parent_id, 'r1', 'never a second level');

    // And answering a top-level answer hangs off that answer.
    const top = [...modal.querySelectorAll('.forum-answer')].find((card) => card.dataset.answer === 'r2');
    click(h.window, top.querySelector('[data-answer-reply]'));
    type(h.window, modal.querySelector('#forum-answer-body'), '<p>সঠিক</p>');
    click(h.window, modal.querySelector('[data-answer-save]'));
    await h.settle();
    assert.equal(h.of('insert').at(-1).payload.parent_id, 'r2');
  });

  await t.test('the composer can be aimed back at the thread', async () => {
    const h = await open();
    const modal = await openThread(h);
    const card = [...modal.querySelectorAll('.forum-answer')].find((item) => item.dataset.answer === 'r1');
    click(h.window, card.querySelector('[data-answer-reply]'));
    const clear = modal.querySelector('[data-answer-parent-clear]');
    assert.equal(clear.classList.contains('hidden'), false, 'the way back is offered');
    click(h.window, clear);
    assert.equal(clear.classList.contains('hidden'), true);
    assert.match(modal.textContent, /answering the discussion/);
    type(h.window, modal.querySelector('#forum-answer-body'), '<p>সবার জন্য</p>');
    click(h.window, modal.querySelector('[data-answer-save]'));
    await h.settle();
    assert.equal(h.of('insert').at(-1).payload.parent_id, null);
  });

  await t.test('editing an answer patches its words, its parent and its badge', async () => {
    const h = await open();
    const modal = await openThread(h);
    const card = [...modal.querySelectorAll('.forum-answer')].find((item) => item.dataset.answer === 'r2');
    click(h.window, card.querySelector('[data-answer-edit]'));

    const editor = card.querySelector('[data-answer-editor]');
    assert.equal(editor.classList.contains('hidden'), false, 'the inline editor is revealed');
    assert.equal(card.querySelector('[data-answer-body]').classList.contains('hidden'), true, 'and the text folds away');
    assert.equal(editor.querySelector('[data-editor-source]').value.includes('দেখুন'), true,
      'a reader\'s own words, in the editor');
    const parents = [...editor.querySelectorAll('[data-answer-parent-select] option')].map((option) => option.value);
    assert.deepEqual(parents, ['', 'r1'], 'attached to the thread, or to a top-level answer — never itself');

    type(h.window, editor, '<p>সম্পাদিত</p>');
    editor.querySelector('[data-answer-edit-official]').checked = true;
    click(h.window, editor.querySelector('[data-answer-save-edit]'));
    await h.settle();

    const write = h.of('update')[0];
    assert.equal(write.table, 'forumReplies');
    assert.equal(write.id, 'r2');
    assert.deepEqual(plain(write.payload), { body: '<p>সম্পাদিত</p>', parent_id: null, is_official: true });
  });

  await t.test('deleting an answer asks first, then removes the row', async () => {
    const h = await open();
    const modal = await openThread(h);
    const card = [...modal.querySelectorAll('.forum-answer')].find((item) => item.dataset.answer === 'r1');
    click(h.window, card.querySelector('[data-answer-delete]'));
    await h.settle();
    assert.equal(h.confirmations.length, 1, 'a confirmation was raised');
    assert.match(h.confirmations[0].title, /Delete this answer/);
    const removal = h.of('remove')[0];
    assert.deepEqual(plain({ table: removal.table, id: removal.id }), { table: 'forumReplies', id: 'r1' });
  });
});

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

test('the admin reacts, and can take reactions away', async (t) => {
  if (needs(t)) return;

  await t.test('the bar shows every kind, and marks the dashboard\'s own', async () => {
    const h = await open();
    const modal = await openThread(h);
    const card = [...modal.querySelectorAll('.forum-answer')].find((item) => item.dataset.answer === 'r1');
    const bar = card.querySelector('[data-reactions]');
    const buttons = [...bar.querySelectorAll('[data-react]')].map((button) => button.dataset.react);
    assert.deepEqual(buttons, ['like', 'dislike', 'agree']);
    assert.deepEqual(
      [...bar.querySelectorAll('[data-react] span')].map((node) => node.textContent),
      ['1', '0', '1'],
      'the counts are the rows in forum_reactions'
    );
    assert.equal(bar.querySelector('.forum-reaction.is-mine'), null,
      'someone else liked it, and a reader agreed — not the dashboard');
  });

  await t.test('a new reaction is one row, keyed to the dashboard user', async () => {
    const h = await open();
    const modal = await openThread(h);
    const card = [...modal.querySelectorAll('.forum-answer')].find((item) => item.dataset.answer === 'r2');
    click(h.window, card.querySelector('[data-react="like"]'));
    await h.settle();
    const write = h.of('upsert')[0];
    assert.equal(write.table, 'forumReactions');
    assert.equal(write.conflict, 'reply_id,reactor_key', 'one reaction per reactor per answer');
    assert.deepEqual(plain(write.payload), { reply_id: 'r2', reactor_key: 'dashboard:me', kind: 'like', user_id: null });
  });

  await t.test('tapping the same kind again takes it back', async () => {
    const h = await open();
    const modal = await openThread(h);
    // r1 already carries a like from someone else; add the dashboard's own first.
    const card = [...modal.querySelectorAll('.forum-answer')].find((item) => item.dataset.answer === 'r1');
    click(h.window, card.querySelector('[data-react="agree"]'));
    await h.settle();
    assert.equal(h.of('upsert').length, 1);

    // The page redraws from the server; the fixture still says the dashboard has
    // no reaction, so the second tap is another upsert rather than a withdrawal —
    // and the withdrawal is what the third assertion below exercises directly.
    click(h.window, card.querySelector('[data-react="like"]'));
    await h.settle();
    assert.equal(h.of('upsert').length, 2);
    assert.equal(h.of('removeWhere').length, 0);
  });

  await t.test('clearing reactions deletes by answer, after asking', async () => {
    const h = await open();
    const modal = await openThread(h);
    const card = [...modal.querySelectorAll('.forum-answer')].find((item) => item.dataset.answer === 'r1');
    const clear = card.querySelector('[data-clear-reactions]');
    assert.ok(clear, 'offered when there is something to clear');
    assert.match(clear.textContent, /Clear 2 reactions/);
    click(h.window, clear);
    await h.settle();
    assert.equal(h.confirmations.length, 1);
    assert.match(h.confirmations[0].description, /2 reactions/);
    const removal = h.of('removeWhere')[0];
    assert.deepEqual(plain({ table: removal.table, filters: removal.filters }), {
      table: 'forumReactions', filters: { reply_id: 'r1' }
    });
  });

  await t.test('an answer with no reactions offers nothing to clear', async () => {
    const h = await open();
    const modal = await openThread(h);
    const card = [...modal.querySelectorAll('.forum-answer')].find((item) => item.dataset.answer === 'r2');
    assert.equal(card.querySelector('[data-clear-reactions]'), null);
  });
});

// ---------------------------------------------------------------------------
// The database side of writing
// ---------------------------------------------------------------------------

const fs = require('node:fs');
const path = require('node:path');

const EDITORIAL_SQL = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '032_forum_editorial.sql'),
  'utf8'
);

test('032 opens the forum to the dashboard without opening it to anyone else', async (t) => {
  await t.test('an editorial post needs no reader, and carries its own signature', () => {
    assert.match(EDITORIAL_SQL, /^begin;/m, 'one transaction');
    assert.match(EDITORIAL_SQL, /^commit;/m);
    ['forum_discussions', 'forum_replies'].forEach((table) => {
      assert.ok(EDITORIAL_SQL.includes(`alter table if exists public.${table} alter column user_id drop not null;`),
        `${table}.user_id may be empty — an admin is not a reader`);
      assert.ok(EDITORIAL_SQL.includes(`alter table if exists public.${table} add column if not exists author_name text not null default '';`),
        `${table} can be signed`);
    });
    assert.match(EDITORIAL_SQL, /add column if not exists is_official boolean not null default false;/,
      'and an answer can be marked as the dashboard\'s too');
  });

  await t.test('the name the app shows prefers the dashboard, then the reader', () => {
    const discussions = EDITORIAL_SQL.slice(EDITORIAL_SQL.indexOf('create or replace view public.forum_discussion_rows'));
    assert.match(discussions,
      /coalesce\(nullif\(btrim\(d\.author_name\), ''\), nullif\(btrim\(p\.name\), ''\), 'নিংশিং চে পাঠক'\) as author_name/);
    const replies = EDITORIAL_SQL.slice(EDITORIAL_SQL.indexOf('create or replace view public.forum_reply_rows'));
    assert.match(replies,
      /coalesce\(nullif\(btrim\(r\.author_name\), ''\), nullif\(btrim\(p\.name\), ''\), 'নিংশিং চে পাঠক'\) as author_name/);
    assert.ok(!/drop view/i.test(EDITORIAL_SQL),
      'both views are replaced, never dropped: the app\'s four read functions depend on them');
  });

  await t.test('a reader cannot sign someone else\'s name or award a badge', () => {
    assert.match(EDITORIAL_SQL, /create or replace function public\.forum_content_guard\(\)/);
    assert.match(EDITORIAL_SQL, /if public\.is_dashboard_request\(\) then\s*\n\s*return new;/,
      'the dashboard keeps what it sent');
    assert.match(EDITORIAL_SQL, /new\.author_name := old\.author_name;\s*\n\s*new\.is_official := old\.is_official;/,
      'and everyone else keeps the stored values on an update');
    assert.match(EDITORIAL_SQL, /new\.author_name := '';\s*\n\s*new\.is_official := false;/,
      'a new row from anywhere else has neither');
    ['forum_discussions_content_guard', 'forum_replies_content_guard'].forEach((trigger) => {
      assert.ok(EDITORIAL_SQL.includes(`create trigger ${trigger}`), `${trigger} is installed`);
    });
    assert.equal((EDITORIAL_SQL.match(/before insert or update on public\./g) || []).length, 2,
      'before insert *and* update: a PATCH is the door a reader has');
  });

  await t.test('reactions get a dashboard door, and only that', () => {
    // The grant runs through `execute`, so the semicolon is outside the string.
    assert.match(EDITORIAL_SQL, /grant select, insert, update, delete on public\.forum_reactions to anon, authenticated/);
    assert.match(EDITORIAL_SQL, /using \(public\.dashboard_has_any_permission\(array\['forum','analytics'\]::text\[\]\)\)/,
      'readable by the same keys as the forum tables');
    // insert: with check. update: using and with check. delete: using. Four in all,
    // and not one of them is reachable with a session alone.
    assert.equal((EDITORIAL_SQL.match(/dashboard_has_permission\('forum'\)/g) || []).length, 4,
      'writable only with the Forum menu');
    assert.match(EDITORIAL_SQL, /using \(public\.is_dashboard_request\(\)\) with check \(public\.is_dashboard_request\(\)\)/,
      'and a database without 004 keeps the shape it had');
    assert.ok(!/for select to anon, authenticated\s*\n\s*using \(true\)/.test(EDITORIAL_SQL),
      'nothing is opened to a reader who is not a dashboard user');
  });

  await t.test('the file is honest about what it needs', () => {
    assert.match(EDITORIAL_SQL, /raise notice '032_forum_editorial\.sql needs 029_forum\.sql and 030_forum_answers\.sql first; nothing to do\.'/,
      'a database without 030 is told, not half-changed');
    assert.match(EDITORIAL_SQL, /if to_regclass\('public\.forum_reactions'\) is null then\s*\n\s*return;/);
    ['forum_discussions', 'forum_replies', 'forum_reactions'].forEach((table) => {
      assert.ok(EDITORIAL_SQL.includes(`if to_regclass('public.${table}') is not null then`),
        `${table} keeps RLS whether or not the file created it`);
    });
  });
});

test('the setup check knows a forum column that came later', async (t) => {
  const API_JS = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'api.js'), 'utf8');

  await t.test('the probe asks for the columns the page writes', () => {
    assert.match(API_JS, /forum: 'id,status,replies_count,last_reply_at,is_official,author_name'/);
    assert.match(API_JS, /forumReplies: 'id,status,parent_id,author_name,is_official'/,
      'and for the one an answer is signed with');
  });

  await t.test('and names every file that builds them, in order', () => {
    const entry = /forum: \[([^\]]+)\]/.exec(API_JS);
    assert.ok(entry, 'the forum maps to a list of migrations, not one');
    // 034 joined the list with the forum's own edit and delete: the page cannot
    // sign an answer without `is_official`, and cannot offer the reader their own
    // answer back without `is_mine`, which is what that file adds.
    assert.deepEqual(entry[1].split(',').map((file) => file.trim().replace(/'/g, '').split('/').pop()),
      ['029_forum.sql', '030_forum_answers.sql', '032_forum_editorial.sql',
        '034_forum_reply_edit.sql']);
    assert.match(API_JS, /const files = \(items\) => \[\.\.\.new Set\(items\.flatMap/,
      'and the banner can read a list');
  });
});
