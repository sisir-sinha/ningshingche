'use strict';

/**
 * Migration 039 and 040 grant EXECUTE carefully, and it is easy to undo by accident.
 *
 * The two files are written for the Supabase SQL editor, where a new function is
 * executable by `anon` the moment it exists — Supabase's default privileges grant it
 * explicitly, so `revoke all ... from public` does not take it back. That is why
 * `delete_my_account`, `block_user`, `unblock_user` and `my_blocked_users` each need
 * an explicit `revoke ... from anon` beside their grant, even though every one of
 * them already refuses a caller with no session.
 *
 * The distinction the migrations are drawing:
 *
 *   open to guests   request_account_deletion, report_content
 *                    a person who cannot sign in must still be able to ask for
 *                    deletion, and a guest reading the forum must still be able to
 *                    report what they see
 *   signed in only   delete_my_account, block_user, unblock_user, my_blocked_users
 *                    blocking is a personal setting, and deletion is destructive
 *
 * The tests below read the SQL and check the *net* effect: for every signed-in-only
 * function, the last statement that mentions anon must be a revoke.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations');

function read(name) {
  return fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');
}

/** SQL with `--` comments stripped, so prose cannot satisfy an assertion. */
function codeOnly(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const at = line.indexOf('--');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}

/**
 * Every grant/revoke touching EXECUTE for `role`, in file order. Returns the last
 * one, which is what the server ends up honouring.
 */
function lastExecuteStatementFor(sql, fnName, role) {
  const statements = codeOnly(sql)
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => /^(grant|revoke)/i.test(s))
    .filter((s) => s.includes(`function public.${fnName}`))
    .filter((s) => new RegExp(`\\b${role}\\b`).test(s));
  return statements.length ? statements[statements.length - 1] : null;
}

function expectRevokedFromAnon(file, fnName) {
  const last = lastExecuteStatementFor(read(file), fnName, 'anon');
  assert.ok(
    last,
    `${file}: ${fnName} never mentions anon — on Supabase it would keep the ` +
      `default EXECUTE grant it is meant to lose`
  );
  assert.match(
    last,
    /^revoke/i,
    `${file}: the last statement granting or revoking ${fnName} on anon is a ` +
      `grant, which re-opens it: "${last}"`
  );
}

function expectOpenToAnon(file, fnName) {
  const last = lastExecuteStatementFor(read(file), fnName, 'anon');
  assert.ok(
    last && /^grant/i.test(last),
    `${file}: ${fnName} is a guest-facing entry point and must stay granted to anon`
  );
}

// ---------------------------------------------------------- signed in only ---

test('delete_my_account cannot be reached from the guest role', () => {
  expectRevokedFromAnon('039_account_deletion.sql', 'delete_my_account');
});

test('block_user cannot be reached from the guest role', () => {
  expectRevokedFromAnon('040_content_safety.sql', 'block_user');
});

test('unblock_user cannot be reached from the guest role', () => {
  expectRevokedFromAnon('040_content_safety.sql', 'unblock_user');
});

test('my_blocked_users cannot be reached from the guest role', () => {
  expectRevokedFromAnon('040_content_safety.sql', 'my_blocked_users');
});

// ------------------------------------------------------------ guest-facing ---

test('request_account_deletion stays open to a person who cannot sign in', () => {
  expectOpenToAnon('039_account_deletion.sql', 'request_account_deletion');
});

test('report_content stays open to a guest reading the forum', () => {
  expectOpenToAnon('040_content_safety.sql', 'report_content');
});

// ------------------------------------------------------------- the bodies ---

test('the signed-in-only functions all refuse a caller with no session', () => {
  const all = codeOnly(read('039_account_deletion.sql')) + codeOnly(read('040_content_safety.sql'));
  for (const guard of [
    'Sign in to delete your account',
    'Sign in to block someone',
    'Sign in to change your blocks'
  ]) {
    assert.ok(all.includes(guard), `missing the no-session guard: "${guard}"`);
  }
});

test('every function the migrations create uses SECURITY DEFINER with a fixed path', () => {
  for (const file of ['039_account_deletion.sql', '040_content_safety.sql']) {
    const sql = codeOnly(read(file));
    const definitions = sql.split(/create or replace function/i).slice(1);
    assert.ok(definitions.length > 0, `${file}: no functions found`);
    for (const definition of definitions) {
      const head = definition.split('as $$')[0];
      const name = head.trim().split('(')[0].trim();
      assert.match(head, /security definer/i, `${file}: ${name} is not SECURITY DEFINER`);
      assert.match(head, /set search_path\s*=\s*public/i, `${file}: ${name} has no fixed search_path`);
    }
  }
});

// ------------------------------------------------------------- idempotency ---

test('the migrations can be run twice without failing', () => {
  // Both files are meant to be pasted into the SQL editor more than once — a
  // second run after a partial failure has to be harmless. Every create is
  // guarded, and every policy is dropped before it is recreated.
  for (const file of ['039_account_deletion.sql', '040_content_safety.sql']) {
    const sql = codeOnly(read(file));
    for (const match of sql.matchAll(/create\s+(table|index)\s+(?!if not exists)/gi)) {
      assert.fail(`${file}: "${match[0]}" would fail on a second run — needs IF NOT EXISTS`);
    }
    const creates = (sql.match(/create policy/gi) || []).length;
    const drops = (sql.match(/drop policy if exists/gi) || []).length;
    assert.equal(creates, drops, `${file}: ${creates} policies created but ${drops} dropped first`);
  }
});

test('the new tables turn row level security on', () => {
  for (const [file, tables] of [
    ['039_account_deletion.sql', ['account_deletion_requests']],
    ['040_content_safety.sql', ['content_reports', 'user_blocks']]
  ]) {
    const sql = codeOnly(read(file)).replace(/\s+/g, ' ');
    for (const table of tables) {
      assert.match(
        sql,
        new RegExp(`alter table public\\.${table} enable row level security`, 'i'),
        `${file}: ${table} is created without RLS`
      );
    }
  }
});
