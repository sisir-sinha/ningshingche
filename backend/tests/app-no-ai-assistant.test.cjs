'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const app = path.join(root, 'app/src/main/java/com/ningshingche/app');
const read = file => fs.readFileSync(path.join(app, file), 'utf8');
function kotlinFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? kotlinFiles(p) : p.endsWith('.kt') ? [p] : [];
  });
}
test('both assistant UIs and network providers are absent from the app', () => {
  for (const file of kotlinFiles(app)) {
    const code = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(code, /NinghsingCheAiAssistant|AiAssistantScreen|AiAssistantHomeBanner|ArticleAiAssistantBottomSheet|AiViewModel|ai_assistant|onAiClick|onAiPrompt|generativelanguage\.googleapis\.com|openrouter\.ai/i, file);
  }
  assert.doesNotMatch(read('ui/reader/ArticleScreen.kt'), /showAiSheet|FloatingActionButton/);
  assert.doesNotMatch(read('ui/reader/HomeScreen.kt'), /AI সহকারী/);
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'metadata.json'), 'utf8'));
  assert.ok(!metadata.majorCapabilities.includes('MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API'));
});
test('new builds exclude retired AI credentials', () => {
  const gradle = fs.readFileSync(path.join(root, 'app/build.gradle.kts'), 'utf8');
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  for (const key of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY']) {
    assert.match(gradle, new RegExp(`ignoreList\\.add\\("${key}"\\)`));
    assert.ok(!example.includes(key));
  }
});
test('existing Room chat schema and user records are preserved', () => {
  assert.match(read('data/local/AppDatabase.kt'), /version = 4/);
  for (const file of kotlinFiles(app)) {
    if (file.includes(`${path.sep}data${path.sep}local${path.sep}`)) continue;
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\.chatDao\(\)/, file);
  }
  assert.match(read('data/local/AppDatabase.kt'), /ChatMessageEntity::class/);
  assert.match(read('data/local/Entities.kt'), /tableName = "ai_chat_messages"/);
});
test('other article features are still available', () => {
  const article = read('ui/reader/ArticleScreen.kt');
  for (const symbol of ['ContentReportDialog', 'FontSizeControlBottomSheet', 'ArticleAuthorMetaCard']) {
    assert.ok(article.includes(symbol), `${symbol} should remain`);
  }
});
