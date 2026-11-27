'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = path.join(__dirname, '../../app/src/main/java/com/ningshingche/app');
const read = file => fs.readFileSync(path.join(app, file), 'utf8');
function kotlinFiles(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e =>
    e.isDirectory() ? kotlinFiles(path.join(dir, e.name)) : e.name.endsWith('.kt') ? [path.join(dir, e.name)] : []);
}
test('no reader-facing screen renders an article reading-time estimate', () => {
  for (const file of kotlinFiles(path.join(app, 'ui'))) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\breadingTimeMinutes\b|মিনিট পাঠ/, file);
  }
  const editorial = read('ui/editorial/EditorialComponents.kt');
  assert.match(editorial, /formatBengaliDate\(publishedDate\)/, 'byline keeps its date');
  assert.match(editorial, /if \(authorName\.isNotBlank\(\)\) add\(authorName\)/, 'and author');
  const article = read('ui/reader/ArticleScreen.kt');
  assert.match(article, /article\.summary\.viewsCount > 0/, 'article view counts remain');
  assert.doesNotMatch(article, /Icons\.Default\.Schedule/, 'no unused reading-time clock');
});
test('dashboard editors and preview do not display article reading estimates', () => {
  const blogs = fs.readFileSync(path.join(__dirname, '../assets/js/blogs.js'), 'utf8');
  const submissions = fs.readFileSync(path.join(__dirname, '../assets/js/registered-users.js'), 'utf8');
  assert.doesNotMatch(blogs + submissions, /data-(?:blog|article)-read-time|<span>Reading time<\/span>| min read/);
  assert.match(blogs, /data-blog-word-count/, 'word count stays');
  assert.match(submissions, /data-article-word-count/, 'submission word count stays');
  assert.match(blogs, /reading_time_minutes: estimateReadingTime\(content\)/, 'existing database compatibility stays intact');
});
test('music timers and playback remain available', () => {
  const music = read('ui/components/MusicPlayer.kt');
  assert.match(music, /controller\.setSleepTimer\(minutes\)/);
  assert.match(music, /private fun formatMs\(ms: Long\)/);
});

test('dashboard word counters work without the removed reading-time element', () => {
  const cases = [
    {file: 'blogs.js', start: '    function updateWordCount(changedHtml) {', end: '\n    title.addEventListener', node: 'data-blog-word-count', variables: ['editorController', 'record']},
    {file: 'registered-users.js', start: '    function updateWordCount(changedHtml) {', end: '\n    updateWordCount();', node: 'data-article-word-count', variables: ['articleEditor', 'draft']},
  ];
  for (const item of cases) {
    const source = fs.readFileSync(path.join(__dirname, '../assets/js', item.file), 'utf8');
    const start = source.indexOf(item.start);
    assert.notEqual(start, -1);
    const end = source.indexOf(item.end, start);
    assert.notEqual(end, -1);
    const definition = source.slice(start, end);
    const count = {textContent: ''};
    const root = {querySelector: selector => selector === `[${item.node}]` ? count : null};
    const NC = {utils: {stripHTML: html => html.replace(/<[^>]*>/g, ' ')}};
    const build = new Function('root', 'NC', ...item.variables, `${definition}\nreturn updateWordCount;`);
    const update = build(root, NC, null, {});
    assert.doesNotThrow(() => update('<p>one two three</p>'));
    assert.equal(count.textContent, '3');
  }
});
