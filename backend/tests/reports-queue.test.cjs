/**
 * The reports queue, checked as the other dashboard pages are.
 *
 * Play's UGC policy does not stop at "the app has a report button": it asks what
 * happens after a report. This suite holds the three things that answer that
 * question — a page an editor can open, a decision that is written down, and the
 * absence of a one-tap delete — plus the wiring that makes the page reachable.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BACKEND = path.join(__dirname, '..');
const ROOT = path.join(BACKEND, '..');
const read = (...parts) => fs.readFileSync(path.join(BACKEND, ...parts), 'utf8');

const REPORTS = read('assets', 'js', 'reports.js');
const CONFIG = read('assets', 'js', 'config.js');
const INDEX = read('index.html');
const SETUP = read('setup.html');
const MIGRATION = fs.readFileSync(
  path.join(BACKEND, 'supabase', 'migrations', '040_content_safety.sql'), 'utf8');

/** The routes block of config.js, one route per line — the sidebar's own source. */
function configuredRoutes() {
  const start = CONFIG.indexOf('routes: Object.freeze([');
  const block = CONFIG.slice(start, CONFIG.indexOf('])', start));
  return block.split('\n')
    .filter((line) => /^\s*\{\s*id:\s*'/.test(line))
    .map((line) => ({
      id: /id:\s*'([^']+)'/.exec(line)[1],
      permission: (/permission:\s*'([^']+)'/.exec(line) || [])[1],
      group: (/group:\s*'([^']+)'/.exec(line) || [])[1]
    }));
}

test('the queue is reachable, and asks for no new permission', async (t) => {
  await t.test('the sidebar has a Reports route beside the forum', () => {
    const route = configuredRoutes().find((item) => item.id === 'reports');
    assert.ok(route, 'Reports is a route');
    assert.equal(route.group, 'content', 'it sits with the content menus');
    // Borrowed, not claimed: `dashboard_save_role` silently drops a key that
    // `dashboard_valid_permissions()` does not list, and whoever can moderate the
    // forum is who should read its reports.
    assert.equal(route.permission, 'forum', 'on the forum permission');
  });

  await t.test('the view is loaded before the router runs', () => {
    const view = INDEX.indexOf('assets/js/reports.js');
    const router = INDEX.indexOf('assets/js/app.js');
    assert.ok(view !== -1, 'index.html loads the view');
    assert.ok(view < router, 'and does so before app.js reads NC.views');
    assert.match(REPORTS, /NC\.views\.reports = \{ render \};/);
  });

  await t.test('the table has a key, and the setup page asks about it', () => {
    assert.match(CONFIG, /contentReports: 'content_reports'/);
    assert.match(REPORTS, /NC\.api\.list\('contentReports'/);
    assert.match(SETUP, /\['contentReports', 'content_reports'/,
      'the check page has to probe it, or a missing migration looks like an empty queue');
    assert.match(SETUP, /migrations\/040_content_safety\.sql/,
      'and name the file that adds it');
  });
});

test('a report is read, decided, and written down', async (t) => {
  await t.test('the four states are the database four', () => {
    const allowed = /check \(status in \(([^)]+)\)\)/.exec(MIGRATION);
    assert.ok(allowed, 'the migration constrains the status');
    const states = [...allowed[1].matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
    const offered = [...REPORTS.matchAll(/value: '([a-z]+)', label: '/g)].map((match) => match[1]);
    states.forEach((state) => assert.ok(offered.includes(state),
      `the page can show ${state}`));
    assert.deepEqual(
      offered.filter((state) => ['open', 'reviewing', 'actioned', 'dismissed'].includes(state)).sort(),
      states.slice().sort(),
      'and offers no state the database would refuse'
    );
  });

  await t.test('every decision names who made it', () => {
    assert.match(REPORTS, /handled_by: editor,/,
      'the update carries the editor');
    assert.match(REPORTS, /const editor = String\(user\.name \|\| user\.username/,
      'taken from the dashboard sign-in, not a constant');
  });

  await t.test('nothing is deleted from the queue', () => {
    // A report is a claim, not a verdict. Removing the content is a separate act
    // on the page where it lives; a one-tap delete here would be a silencing
    // tool, and the two steps should not be one gesture.
    assert.ok(!/NC\.api\.delete(Record)?\(/.test(REPORTS), 'no delete call');
    assert.ok(!/\.remove\(/.test(REPORTS), 'and no remove helper');
    assert.match(REPORTS, /this page never deletes anything/,
      'the modal says so where an editor will read it');
  });

  await t.test('the default view is the work, not the archive', () => {
    assert.match(REPORTS, /status: params\.get\('status'\) \|\| 'open'/,
      'open reports are what the page shows first');
    assert.match(REPORTS, /data-report-status="\$\{status\.value\}"/,
      'and the counters are the filter');
  });
});

test('a report says what it is about, in words a person reads', async (t) => {
  await t.test('every content type the app can send has a label', () => {
    const types = /check \(content_type in\s*\(([^)]+)\)\)/.exec(MIGRATION);
    assert.ok(types, 'the migration constrains the type');
    const allowed = [...types[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    const labelled = [...REPORTS.matchAll(/\{ value: '([a-z_]+)', label: '[^']+' \}/g)].map((match) => match[1]);
    allowed.forEach((type) => assert.ok(labelled.includes(type),
      `${type} is reportable from the app and named on the page`));
  });

  await t.test('and every reason code too', () => {
    const reasons = /check \(reason in\s*\(([^)]+)\)\)/.exec(MIGRATION);
    assert.ok(reasons, 'the migration constrains the reason');
    const allowed = [...reasons[1].matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
    const labelled = [...REPORTS.matchAll(/\{ value: '([a-z]+)', label: '[^']+' \}/g)].map((match) => match[1]);
    allowed.forEach((reason) => assert.ok(labelled.includes(reason),
      `${reason} is a code the app sends, and has words on the page`));
  });

  await t.test('a reviewer can open the thing that was reported', () => {
    assert.match(REPORTS, /record\.content_type === 'discussion'[\s\S]{0,120}route: 'forum'/,
      'a thread opens in the forum');
    assert.match(REPORTS, /record\.content_type === 'comment'[\s\S]{0,120}route: 'comments'/,
      'a comment opens where it lives');
    assert.match(REPORTS, /NC\.auth\.canAccess\('music'\)/,
      'and a track only opens for a role that may see it');
  });
});
