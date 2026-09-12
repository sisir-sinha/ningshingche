/**
 * The owner's fifth read of the forum, checked the way the other four were.
 *
 * Eight notes came back: the toolbar's bold and italic "still didn't work", the
 * picture button did not belong in the formatting row, the reply box should not
 * be standing there waiting, an attached picture was sitting on top of the
 * formatting buttons, a posted picture showed as "obj" until "see more" was
 * tapped, a tap on a file should open it large with a download in the corner,
 * a PDF should be its icon and its name, and a draft that has been posted should
 * be gone.
 *
 * The rules of the house hold here too: assert the thing that would be wrong if
 * the work had not been done, and prefer the file's own words over a paraphrase
 * of them. The one behavioural test is the parsing of a body, because that is
 * where "obj" came from and regexes are exactly what a lexical check cannot
 * reason about.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'ningshingche', 'app');
const read = (...parts) => fs.readFileSync(path.join(APP, ...parts), 'utf8');

const FORUM_SCREENS = read('ui', 'screens', 'ForumScreens.kt');
const FORUM_EDITOR = read('ui', 'components', 'HtmlContentEditor.kt');
const VIEWER = read('ui', 'components', 'AttachmentViewer.kt');
const DRAFT_STORE = read('data', 'local', 'ForumDraftStore.kt');
const PORTAL_MODELS = read('data', 'portal', 'PortalModels.kt');
const FORUM_HTML = read('data', 'portal', 'ForumHtml.kt');
const UPLOADER = read('data', 'remote', 'ForumAttachmentUploader.kt');
const SATORU = read('data', 'remote', 'SatoruUploadClient.kt');
const PDF_HELPER = read('util', 'PdfHelper.kt');

/** A declaration's body, from its opening brace to the one that closes it. */
function bodyOf(source, name) {
  const at = source.indexOf(`fun ${name}(`);
  assert.ok(at !== -1, `${name}() is declared`);
  const open = source.indexOf('{', source.indexOf('(', at));
  assert.ok(open !== -1, `${name}() has a body`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`${name}() is not closed`);
}

const screen = (name) => bodyOf(FORUM_SCREENS, name);

/** The editor composable's own source — its parameter list holds a lambda. */
function editorSource() {
  const from = FORUM_EDITOR.indexOf('fun HtmlContentEditor(');
  const to = FORUM_EDITOR.indexOf('private fun ToolIcon(');
  assert.ok(from !== -1 && to > from, 'the editor is declared, before its toolbar button');
  return FORUM_EDITOR.slice(from, to);
}

/** The script the editor loads, from `<script>` to the end of it. */
function editorScript() {
  const from = FORUM_EDITOR.indexOf('<script>');
  const to = FORUM_EDITOR.indexOf('</script>', from);
  assert.ok(from !== -1 && to > from, 'the editor page has a script');
  return FORUM_EDITOR.slice(from, to);
}

// ---------------------------------------------------------------------------
// 1. The toolbar, and the two buttons the owner said did nothing
// ---------------------------------------------------------------------------

test('the formatting buttons actually reach the caret', async (t) => {
  await t.test('the page keeps the selection a tap on a button would lose', () => {
    const script = editorScript();
    assert.match(script, /var lastRange = null;/, 'the last range is remembered');
    assert.match(script, /function saveSelection\(\)\{/, 'saved as the reader moves the caret');
    assert.match(script, /lastRange = sel\.getRangeAt\(0\)\.cloneRange\(\);/, 'as a copy, not a live range');
    assert.match(script, /function restoreSelection\(\)\{/, 'and put back before a command');
    assert.match(script, /sel\.removeAllRanges\(\);\s*sel\.addRange\(lastRange\);/, 'which is the whole of it');
    for (const event of ['keyup', 'mouseup', 'touchend', 'focus']) {
      assert.ok(script.includes(`'${event}'`), `${event} moves the caret`);
    }
    assert.match(script, /document\.addEventListener\('selectionchange', saveSelection\)/,
      'and a selection made by dragging is caught too');
    // Not on every keystroke: that is what a Bengali keyboard is doing when it
    // is composing, and reading the selection underneath it is what threw it off.
    assert.ok(!/\['keyup','mouseup','input','touchend','focus'\]/.test(script),
      'and never on the input event itself');
  });

  await t.test('nothing touches the document while the keyboard is composing', () => {
    const script = editorScript();
    assert.match(script, /var composing = false;/, 'the page knows');
    assert.match(script, /e\.addEventListener\('compositionstart', function\(\)\{ composing = true; \}\);/);
    assert.match(script, /e\.addEventListener\('compositionend', function\(\)\{/);
    assert.match(script, /if \(ev && ev\.isComposing\) composing = true;/,
      'and believes the event when the flag did not get set');
    assert.match(script, /function saveSelection\(\)\{\s*if \(composing\) return;/,
      'the selection is not even read');
    assert.match(script, /if \(!composing\) \{[\s\S]{0,420}restoreSelection\(\);/,
      'a command leaves the selection alone mid-composition');
    assert.match(script, /if \(composing \|\| document\.activeElement === e\) return;\s*e\.focus\(\);/,
      'raising the keyboard never moves a caret that is being typed at');
    assert.match(script, /if \(composing \|\| document\.activeElement === e\) \{\s*pendingHtml = html;\s*return;\s*\}/,
      'and a value from outside waits instead of writing under the keyboard');
    assert.match(script, /e\.addEventListener\('blur', flushPending\);/,
      'then lands once the box has let go of the caret');
    assert.match(script, /if \(composing\) \{ bar\.style\.display = 'none'; return; \}/,
      'the selection bar waits for the word to be finished');
  });

  await t.test('a command runs on that selection, after the box takes the focus back', () => {
    const script = editorScript();
    assert.match(script, /window\.command = function\(cmd, arg\)\{/, 'one door for every command');
    assert.match(script, /e\.focus\(\);/, 'the box first');
    assert.match(script, /restoreSelection\(\);/, 'then the caret');
    assert.match(script, /document\.execCommand\('styleWithCSS', false, false\);/,
      'and tags, not inline styles, so the renderers understand the markup');
    assert.match(script, /document\.execCommand\(cmd, false, arg === undefined \? null : arg\);/,
      'then the command itself');
    assert.match(script, /return done;/, 'which reports whether it did anything');
    assert.match(FORUM_EDITOR, /"window\.command\(\$\{JSONObject\.quote\(command\)\}\)"/,
      'and the Kotlin side calls it');
    assert.match(FORUM_EDITOR, /"window\.command\(\$\{JSONObject\.quote\(command\)\}, \$\{JSONObject\.quote\(arg\)\}\)"/,
      'with an argument where there is one');
    const run = bodyOf(FORUM_EDITOR, 'run');
    assert.match(run, /if \(!web\.isFocused\) web\.requestFocus\(\)/,
      'the view takes the focus back — but never asks again for one it already has,');
    assert.match(run, /restarts the input connection/,
      'because that restarts the keyboard under a composing word');
  });

  await t.test('the selection bar goes through the same door, not around it', () => {
    const script = editorScript();
    assert.match(script, /window\.command\(btn\.getAttribute\('data-cmd'\)\);/);
    assert.ok(!/document\.execCommand\(btn\.getAttribute/.test(script),
      'so the article composer is fixed by the same change');
  });

  await t.test('Kalpurush declares one weight, or bold is drawn as regular', () => {
    // A face that claims 100–900 tells the browser every weight is covered, so it
    // has no reason to synthesise the bold the reader asked for — which is what
    // \"bold did nothing\" looked like. One weight, and the browser fakes the rest.
    assert.match(FORUM_EDITOR, /font-weight: 400;/);
    assert.ok(!/font-weight: 100 900/.test(FORUM_EDITOR), 'the range is gone');
    assert.match(FORUM_EDITOR, /lets the browser\s*\/\/ synthesise the bold/,
      'and the reason is written down where the next reader will find it');
  });
});

// ---------------------------------------------------------------------------
// 2. The compact row is the four the owner listed
// ---------------------------------------------------------------------------

test('the compact toolbar is four buttons and no picture button', async (t) => {
  await t.test('bold, italic, underline and the list', () => {
    const editor = editorSource();
    for (const button of ['মোটা', 'বাঁকা', 'নিচে দাগ', 'তালিকা']) {
      assert.ok(editor.includes(`ToolIcon("${button}"`), `${button} is in the row`);
    }
    assert.match(editor, /Icons\.Default\.FormatBold, compact\) \{ run\("bold"\) \}/);
    assert.match(editor, /Icons\.Default\.FormatItalic, compact\) \{ run\("italic"\) \}/);
    assert.match(editor, /Icons\.Default\.FormatUnderlined, compact\) \{ run\("underline"\) \}/);
    assert.match(editor, /Icons\.Default\.FormatListBulleted, compact\) \{ run\("insertUnorderedList"\) \}/);
  });

  await t.test('and the picture is not among them', () => {
    const editor = editorSource();
    assert.ok(!/onAttachImage/.test(editor), 'the compact editor does not offer a picker');
    assert.ok(!/ছবি সংযুক্ত করুন/.test(editor), 'and the button is gone, not hidden');
    assert.match(editor, /if \(!compact\) \{\s*ToolIcon\("ছবি যোগ", Icons\.Default\.Image\)/,
      'the article composer still inserts one, because an article is not a post');
  });
});

// ---------------------------------------------------------------------------
// 3. The box is asked for, and it arrives
// ---------------------------------------------------------------------------

test('the reply box appears when it is asked for', async (t) => {
  await t.test('one button, bottom right, with the owner\'s own words', () => {
    const launcher = screen('ForumReplyLauncher');
    assert.match(launcher, /text = "উত্তর যোগ করুন"/, 'the words the owner asked for');
    // A button in the corner over the page's own background — not a full-width
    // bar with a tone of its own, which is what the owner saw covering the page.
    assert.match(launcher, /contentAlignment = Alignment\.CenterEnd/, 'bottom right');
    assert.ok(!/Surface\(/.test(launcher), 'and no strip behind it');
    assert.match(launcher, /ExtendedFloatingActionButton\(/);
    assert.match(launcher, /testTag\("forum_reply_open"\)/, 'reachable in a UI test');
    assert.match(launcher, /testTag\("forum_reply_launcher"\)/);
  });

  await t.test('the thread shows the button, not a standing editor', () => {
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /ForumReplyLauncher\(onClick = \{ openComposer\(""\) \}\)/);
    assert.match(thread, /AnimatedVisibility\(\s*visible = composerOpen,[\s\S]{0,420}ForumReplyComposer\(/,
      'the editor is what the button opens');
  });

  await t.test('and the two trade places with a transition, not a jump', () => {
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /visible = composerOpen,\s*enter = expandVertically\(expandFrom = Alignment\.Bottom\) \+ fadeIn\(\),\s*exit = shrinkVertically\(shrinkFrom = Alignment\.Bottom\) \+ fadeOut\(\)/,
      'the box grows out of the bottom and shrinks back into it');
    assert.match(thread, /visible = !composerOpen,\s*enter = expandVertically\(expandFrom = Alignment\.Bottom\) \+ fadeIn\(\),\s*exit = shrinkVertically\(shrinkFrom = Alignment\.Bottom\) \+ fadeOut\(\)/,
      'and the button does the same on its way out');
  });

  await t.test('the keyboard follows the box in, and Back goes the other way', () => {
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /delay\(FORUM_COMPOSER_APPEAR_MS\)[\s\S]{0,80}editor\.focus\(\)/,
      'the keyboard is asked for once the box has arrived');
    assert.match(thread, /BackHandler\(enabled = composerOpen && !keyboardUp\)/,
      'Back closes the box when the keyboard is already down');
    assert.match(thread, /BackHandler\(enabled = keyboardUp\) \{ editor\.dismiss\(\) \}/,
      'and the keyboard first when it is up');
    assert.match(FORUM_EDITOR, /if\(window\.focusEditor\)\{window\.focusEditor\(\);\}/,
      'the page raises the keyboard for a focus it was asked for');
    assert.match(FORUM_EDITOR, /window\.focusEditor = function\(\)\{\s*if \(composing \|\| document\.activeElement === e\) return;\s*e\.focus\(\);\s*\};/,
      'and does nothing at all if the reader is already in the box');
  });

  await t.test('and the box can be put away without posting anything', () => {
    const composer = screen('ForumReplyComposer');
    assert.match(composer, /onClick = onCollapse/, 'a chevron, not a bar of buttons');
    assert.match(composer, /testTag\("forum_reply_collapse"\)/);
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /onCollapse = \{\s*composerOpen = false\s*editor\.dismiss\(\)\s*\}/,
      'and it leaves the draft where it is');
    assert.ok(!/draftStore\.clearReply\(discussionId\)\s*\}\s*$/.test(thread.slice(thread.indexOf('onCollapse'))),
      'nothing is thrown away by closing it');
  });
});

// ---------------------------------------------------------------------------
// 4. Files are attached on their own row
// ---------------------------------------------------------------------------

test('the paperclip takes pictures and PDFs, five at most', async (t) => {
  await t.test('the row is under the box, with the button that filled it', () => {
    const composer = screen('ForumReplyComposer');
    const editorAt = composer.indexOf('HtmlContentEditor(');
    const rowAt = composer.indexOf('ForumAttachmentRow(');
    assert.ok(editorAt !== -1 && rowAt > editorAt,
      'the attachments are under the editor, not over its toolbar');
    assert.match(composer, /tagPrefix = "forum_reply"/);
    assert.match(composer, /onAttach = onAttach,/, 'the row is handed the screen\'s picker');
    assert.match(screen('ForumThreadScreen'),
      /onAttach = \{\s*attachmentPicker\.launch\(ForumAttachmentUploader\.PICKER_TYPES\)\s*\}/,
      'which is the one picker the thread opens');
  });

  await t.test('a paperclip, and no word beside it', () => {
    const row = screen('ForumAttachmentRow');
    assert.match(row, /Icons\.Default\.AttachFile/, 'the attachment icon the owner asked for');
    assert.match(row, /contentDescription = "ফাইল সংযুক্ত করুন"/, 'named for a screen reader');
    assert.ok(!/Text\(\s*text = "ছবি"/.test(row), 'and no "ছবি" label under it');
    assert.match(row, /testTag\("\$\{tagPrefix\}_attach"\)/);
  });

  await t.test('every file has its own cross, on the row', () => {
    const row = screen('ForumAttachmentRow');
    assert.match(row, /testTag\("\$\{tagPrefix\}_attachment"\)/, 'the file itself');
    assert.match(row, /testTag\("\$\{tagPrefix\}_attachment_remove"\)/, 'and the cross that takes it back');
    assert.match(row, /onClick = \{ onRemove\(file\) \}/, 'one file at a time');
    assert.match(row, /PortalAsyncImage\(/, 'a picture is drawn as itself');
    assert.match(row, /Icons\.Default\.PictureAsPdf/, 'and a document as its icon');
    assert.match(row, /text = file\.label/, 'with its name beside it');
  });

  await t.test('the picker offers pictures and PDFs, and the app checks again', () => {
    assert.match(UPLOADER, /val PICKER_TYPES = arrayOf\("image\/\*", MIME_PDF\)/);
    assert.match(UPLOADER, /const val MAX_FILES = 5/);
    assert.match(UPLOADER, /fun isSupported\(mimeType: String, name: String\): Boolean/);
    assert.match(UPLOADER, /শুধু ছবি ও পিডিএফ ফাইল যুক্ত করা যাবে।/, 'a refusal in the reader\'s language');
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /ActivityResultContracts\.OpenMultipleDocuments\(\)/,
      'several files in one trip to the picker');
    assert.match(thread, /uris\.take\(ForumAttachmentUploader\.roomLeft\(attachments\.size\)\)/,
      'and the fifth is where it stops');
    assert.match(thread, /একটি উত্তরে সর্বোচ্চ \$\{toBengaliNumeral\(ForumAttachmentUploader\.MAX_FILES\)\}টি ফাইল যুক্ত করা যাবে।/,
      'saying so in Bengali numerals');
  });

  await t.test('a picture goes to the image host and a document to the file host', () => {
    assert.match(UPLOADER, /ImgBbUploader\.uploadFromUri\(context, uri, "forum_attach_\$\{index\}_\$stamp"\)/);
    assert.match(UPLOADER, /SatoruUploadClient\.uploadAttachment\(context, uri\)/);
    assert.match(SATORU, /suspend fun uploadAttachment\(context: Context, uri: Uri\): Result<UploadedFile>/);
    assert.match(SATORU, /data class UploadedFile\(/);
    assert.match(SATORU, /displayName = name/, 'the name travels with the URL');
    assert.match(UPLOADER, /পিডিএফ ২০০ এমবি-র বেশি হতে পারে না।/);
  });

  await t.test('the new-thread composer has the same row', () => {
    assert.match(FORUM_SCREENS, /tagPrefix = "forum_new"/);
    assert.match(FORUM_SCREENS, /onAttach = \{ attachmentPicker\.launch\(ForumAttachmentUploader\.PICKER_TYPES\) \}/,
      'the same picker');
    assert.match(FORUM_SCREENS, /testTag\("forum_new_attach_error"\)/);
  });
});

// ---------------------------------------------------------------------------
// 5. What is attached is what is drawn — and never "obj"
// ---------------------------------------------------------------------------

/** The Kotlin regex literals, read out of the file and usable in JS. */
function kotlinRegex(name) {
  const at = FORUM_HTML.indexOf(`val ${name} = Regex(`);
  assert.ok(at !== -1, `${name} is a regex in ForumHtml.kt`);
  const window = FORUM_HTML.slice(at, at + 400);
  const literal = /"((?:[^"\\]|\\.)*)"/.exec(window);
  assert.ok(literal, `${name} has a pattern`);
  const pattern = literal[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const flags = /IGNORE_CASE/.test(window) ? 'gi' : 'g';
  const dotAll = /DOT_MATCHES_ALL/.test(window) ? 's' : '';
  return new RegExp(pattern, flags + dotAll);
}

test('a body is read as words, pictures and documents', async (t) => {
  const anyTag = kotlinRegex('ANY_TAG');
  const imageTag = kotlinRegex('IMAGE_TAG');
  const imageSrc = kotlinRegex('IMAGE_SRC');
  const anchor = kotlinRegex('ANCHOR');
  const pdfInUrl = kotlinRegex('PDF_IN_URL');

  const isPdf = (url, label) => pdfInUrl.test(url) || label.trim().toLowerCase().endsWith('.pdf');

  // The pipeline, in the order ForumHtml.kt runs it.
  const markup = (html) => html
    .replace(imageTag, ' ')
    .replace(anchor, (match, url, label) => (isPdf(url, label) ? ' ' : match));
  const text = (html) => markup(html)
    .replace(anyTag, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const images = (html) => [...html.matchAll(imageTag)]
    .map((m) => (imageSrc.exec(m[0]) || [])[1])
    .filter(Boolean);
  const docs = (html) => [...html.matchAll(anchor)]
    .filter((m) => isPdf(m[1], m[2]))
    .map((m) => ({ url: m[1], name: m[2].replace(anyTag, ' ').trim() }));

  const body = '<p>আমার <b>উত্তর</b> এখানে</p>'
    + '<p><img src="https://files.catbox.moe/abc.jpg" alt="ছবি.jpg"></p>'
    + '<p><a href="https://files.catbox.moe/book.pdf">বই.pdf</a></p>';

  await t.test('the words keep their markup and lose the files', () => {
    assert.equal(text(body), 'আমার উত্তর এখানে');
    assert.match(markup(body), /<b>উত্তর<\/b>/, 'bold survives into the renderer');
    assert.ok(!/<img/.test(markup(body)), 'and no image goes in — this is where "obj" came from');
    assert.ok(!/book\.pdf/.test(markup(body)), 'nor a bare document URL');
  });

  await t.test('the picture is a picture, and the document is a document', () => {
    assert.deepEqual(images(body), ['https://files.catbox.moe/abc.jpg']);
    assert.deepEqual(docs(body), [{ url: 'https://files.catbox.moe/book.pdf', name: 'বই.pdf' }]);
  });

  await t.test('a link that is not a document is left alone', () => {
    const withLink = '<p>দেখুন <a href="https://ningshingche.com/x">এখানে</a> — https://a.pdf.example.com</p>';
    assert.equal(docs(withLink).length, 0, 'an article link is a link');
    assert.match(markup(withLink), /<a href="https:\/\/ningshingche\.com\/x">/, 'and stays in the text');
  });

  await t.test('the screen draws the two differently', () => {
    const preview = screen('ForumAttachmentPreview');
    assert.match(preview, /if \(file\.isPdf\) \{/, 'a document is not a thumbnail');
    assert.match(preview, /Icons\.Default\.PictureAsPdf/);
    assert.match(preview, /modifier = Modifier\.widthIn\(max = 168\.dp\)/, 'its name on one line, clipped');
    assert.match(preview, /contentScale = ContentScale\.Crop/, 'and a picture is drawn as itself');
    assert.match(preview, /testTag\("forum_body_attachment"\)/, 'both reachable by the same name');
    assert.match(PORTAL_MODELS, /val label: String\s*get\(\) = name\.trim\(\)\.ifBlank \{ if \(isPdf\) "সংযুক্তি\.pdf" else "সংযুক্তি" \}/,
      'and a file with no name still has something to call itself');
  });

  await t.test('a post with one picture is not a long post', () => {
    assert.match(PORTAL_MODELS, /val isLong: Boolean get\(\) = forumBodyText\(body\)\.length > 240/,
      'the fold counts the words');
    const opening = screen('ForumOpeningPost');
    assert.match(opening, /canExpand = forumBodyText\(discussion\.body\)\.length > FORUM_FOLD_CHARS/);
    assert.ok(!/contains\("<img"/.test(FORUM_SCREENS),
      'and nothing folds on the strength of an image tag any more');
  });

  await t.test('the post carries its files out, and the database sees only the words', () => {
    const attachment = read('data', 'portal', 'ForumHtml.kt');
    assert.match(attachment, /fun forumWithAttachments\(body: String, attachments: List<ForumAttachment>\): String/);
    assert.match(attachment, /"<p><img src=\\"\$url\\" alt=\\"\$\{attachment\.label\.replace\("\\"", ""\)\}\\"><\/p>"/);
    assert.match(attachment, /"<p><a href=\\"\$url\\">\$\{attachment\.label\.replace\("\\"", ""\)\}<\/a><\/p>"/);
    assert.match(attachment, /if \(attachments\.isEmpty\(\)\) return body/,
      'and a post with nothing attached is sent untouched');
  });
});

// ---------------------------------------------------------------------------
// 6. A file opens large, with a download in the corner
// ---------------------------------------------------------------------------

test('a tap on a file opens it large', async (t) => {
  await t.test('the thread opens the viewer for either kind', () => {
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /onOpenAttachment = \{ file -> viewerAttachment = file \}/,
      'from the opening post and from the answers');
    assert.match(thread, /viewerAttachment\?\.let \{ file ->[\s\S]{0,140}AttachmentViewer\(/);
    assert.match(thread, /onDismiss = \{ viewerAttachment = null \}/);
  });

  await t.test('it is a dialog over the thread, with the file\'s name on it', () => {
    assert.match(VIEWER, /fun AttachmentViewer\(/);
    assert.match(VIEWER, /Dialog\(/);
    assert.match(VIEWER, /usePlatformDefaultWidth = false/, 'as wide as the phone');
    assert.match(VIEWER, /dismissOnClickOutside = true/, 'and a tap outside closes it');
    assert.match(VIEWER, /testTag\("attachment_viewer"\)/);
    assert.match(VIEWER, /text = attachment\.label/, 'what the reader opened is written on top');
    assert.match(VIEWER, /if \(attachment\.isPdf\) \{\s*AttachmentPdf\(attachment = attachment\)/,
      'one viewer per kind');
  });

  await t.test('a picture is large, and can be pinched', () => {
    assert.match(VIEWER, /private fun AttachmentPicture\(attachment: ForumAttachment\)/);
    assert.match(VIEWER, /contentScale = ContentScale\.Fit/, 'the whole picture, not a crop');
    assert.match(VIEWER, /detectTransformGestures/, 'with the usual two-finger zoom');
    assert.match(VIEWER, /scale = \(scale \* zoom\)\.coerceIn\(1f, 5f\)/);
    assert.match(VIEWER, /testTag\("attachment_image_view"\)/);
  });

  await t.test('a PDF is read by the app\'s own viewer library', () => {
    assert.match(VIEWER, /private fun AttachmentPdf\(attachment: ForumAttachment\)/);
    assert.match(VIEWER, /PDFView\(viewContext, null\)/, 'the library the book archive uses');
    assert.match(VIEWER, /pageFitPolicy\(FitPolicy\.WIDTH\)/, 'fitted to the width');
    assert.match(VIEWER, /enableSwipe\(true\)/, 'a swipe between the pages');
    assert.match(VIEWER, /\.load\(\)/);
    assert.match(VIEWER, /PdfHelper\.downloadAttachment\(context, attachment\.url, attachment\.downloadName\)/,
      'fetched first: the library reads files, not URLs');
    assert.match(VIEWER, /testTag\("attachment_error"\)/, 'and a failure says so, with a retry');
    assert.ok(!/PdfReaderSettingsSheet|nightMode|bookView/.test(VIEWER),
      'no smart options: the owner asked for the plainest viewer there is');
  });

  await t.test('the download sits in the top right and writes to Downloads', () => {
    const viewer = bodyOf(VIEWER, 'AttachmentViewer');
    const downloadAt = viewer.indexOf('testTag("attachment_download")');
    const closeAt = viewer.indexOf('testTag("attachment_close")');
    assert.ok(downloadAt !== -1 && closeAt > downloadAt, 'download first, close after it');
    assert.match(viewer, /Icons\.Default\.Download/);
    assert.match(viewer, /PdfHelper\.saveAttachmentToDownloads\(/);
    assert.match(viewer, /mimeType = attachment\.mime/);
    assert.match(PDF_HELPER, /suspend fun saveAttachmentToDownloads\(/);
    assert.match(PDF_HELPER, /val folder = if \(pdf\) "Ningshingche_PDFs" else "Ningshingche"/,
      'documents and pictures do not share a folder');
    assert.match(PDF_HELPER, /MediaStore\.Downloads\.EXTERNAL_CONTENT_URI/);
    assert.match(PDF_HELPER, /suspend fun downloadAttachment\(context: Context, url: String, fileName: String\): File/);
    assert.match(PDF_HELPER, /private fun safeFileName\(raw: String\): String/, 'and a name the disk will take');
  });
});

// ---------------------------------------------------------------------------
// 6b. The editor is not a browser
// ---------------------------------------------------------------------------

test('nothing inside the editor can navigate away from it', async (t) => {
  await t.test('a link, a tap, a drag: the box stays where it is', () => {
    assert.match(FORUM_EDITOR, /override fun shouldOverrideUrlLoading\(\s*view: WebView\?,\s*request: android\.webkit\.WebResourceRequest\?\s*\): Boolean = true/,
      'every navigation is refused');
    assert.match(FORUM_EDITOR, /@Deprecated\("the older signature, still asked for below API 24"\)\s*override fun shouldOverrideUrlLoading\(\s*view: WebView\?,\s*url: String\?\s*\): Boolean = true/,
      'on both signatures, because the platform asks for one of the two');
    assert.match(FORUM_EDITOR, /settings\.setSupportMultipleWindows\(false\)/, 'and no popup window');
    assert.match(FORUM_EDITOR, /settings\.javaScriptCanOpenWindowsAutomatically = false/);
  });
});

// ---------------------------------------------------------------------------
// 7. A draft is for what has not been posted
// ---------------------------------------------------------------------------

test('a posted answer leaves nothing behind', async (t) => {
  await t.test('the files are part of the draft, pictures and documents alike', () => {
    assert.match(DRAFT_STORE, /data class ReplyDraft\(\s*val body: String = "",\s*val parentId: String = "",\s*val attachments: List<ForumAttachment> = emptyList\(\)/);
    assert.match(DRAFT_STORE, /data class ComposerDraft\(/);
    assert.match(DRAFT_STORE, /val attachments: List<ForumAttachment> = emptyList\(\)/);
    assert.match(DRAFT_STORE, /put\("attachments", draft\.attachments\.toJsonArray\(\)\)/);
    assert.match(DRAFT_STORE, /private fun List<ForumAttachment>\.toJsonArray\(\)/);
    assert.match(DRAFT_STORE, /private fun org\.json\.JSONArray\?\.toAttachments\(\): List<ForumAttachment>/);
  });

  await t.test('and a draft opens the box, because a hidden draft is a lost one', () => {
    assert.match(FORUM_SCREENS, /val saved = draftStore\.reply\(discussionId\)/);
    assert.match(FORUM_SCREENS, /if \(forumHasText\(saved\.body\) \|\| saved\.attachments\.isNotEmpty\(\)\) composerOpen = true/);
  });

  await t.test('a successful send clears the box, the files and the draft', () => {
    const thread = screen('ForumThreadScreen');
    const success = thread.slice(thread.indexOf('postReply(discussionId'));
    assert.match(success, /replyBody = ""/, 'the words');
    assert.match(success, /attachments = emptyList\(\)/, 'the files');
    assert.match(success, /composerOpen = false/, 'and the box itself');
    assert.match(success, /editor\.dismiss\(\)/);
    assert.match(success, /draftStore\.clearReply\(discussionId\)/);
    const clearAt = success.indexOf('draftStore.clearReply(discussionId)');
    const postAt = success.indexOf('.onSuccess { posted ->');
    assert.ok(postAt !== -1 && clearAt > postAt, 'and only after the database has answered');
  });

  await t.test('the box is emptied through the editor itself', () => {
    // Setting the value from the outside is a race the page refuses to lose: a
    // document the reader may still be typing in is not rewritten from under
    // them. A clear is different — the post is already in the database — so the
    // screen asks the editor to empty itself.
    assert.match(FORUM_EDITOR, /internal var clearBox: \(\(\) -> Unit\)\? = null/);
    assert.match(FORUM_EDITOR, /fun clear\(\) \{\s*clearBox\?\.invoke\(\)\s*\}/,
      'the screen has one call to make');
    assert.match(FORUM_EDITOR, /webView\?\.evaluateJavascript\("if\(window\.clearEditor\)\{window\.clearEditor\(\);\}", null\)/);
    assert.match(FORUM_EDITOR, /window\.clearEditor = function\(\)\{[\s\S]{0,220}e\.innerHTML = '';/,
      'and the page empties itself, whatever the caret is doing');
    const thread = screen('ForumThreadScreen');
    assert.match(thread, /composerOpen = false\s*editor\.clear\(\)\s*editor\.dismiss\(\)/,
      'the send clears it before the box closes');
  });

  await t.test('an empty value from the app is an instruction, not a draft', () => {
    assert.match(FORUM_EDITOR, /if \(html === ''\) \{ pendingHtml = null; applyHtml\(''\); return; \}/,
      'applied at once, focused or not');
    assert.match(FORUM_EDITOR, /\['blur','focusout','keyup','touchend'\]\.forEach\(function\(ev\)\{\s*e\.addEventListener\(ev, flushPending\);/,
      'while a draft that arrived mid-sentence waits, and is applied on the next one');
  });

  await t.test('the editor is told the value is empty — otherwise the text stays on screen', () => {
    assert.match(FORUM_EDITOR, /var lastEmitted by remember \{ mutableStateOf\(""\) \}/,
      'what the page last said');
    assert.match(FORUM_EDITOR, /var lastPushed by remember \{ mutableStateOf\(""\) \}/, 'and what we last sent it');
    assert.match(FORUM_EDITOR, /if \(value != lastEmitted && value != lastPushed\) \{\s*lastPushed = value/,
      'so a value from outside is pushed in, and one from the page is not pushed back at it');
    assert.match(FORUM_EDITOR, /"if\(window\.setHtml\)\{window\.setHtml\(\$\{JSONObject\.quote\(value\)\}\);\}"/);
    assert.match(FORUM_EDITOR, /lastEmitted = html\s*onValueChange\(html\)/, 'the page records its own words');
    assert.match(FORUM_EDITOR, /function applyHtml\(html\)\{[\s\S]{0,240}if \(document\.activeElement !== e\) placeCaretAtEnd\(\);/,
      'and a pushed value leaves the caret somewhere sensible — but only when nobody is holding one');
    assert.match(FORUM_EDITOR, /if \(composing \|\| document\.activeElement === e\) \{\s*pendingHtml = html;/,
      'while a value that arrives during typing is kept, not applied');
  });

  await t.test('a new thread clears its draft the same way', () => {
    const composer = screen('NewDiscussionScreen');
    assert.match(composer, /formattedBody|forumWithAttachments\(body, attachments\)/);
    const success = composer.slice(composer.indexOf('post('));
    assert.match(success, /draftStore\.clearComposer\(\)/);
    assert.ok(success.indexOf('draftStore.clearComposer()') > success.indexOf('.onSuccess { created ->'),
      'after the post succeeded, not before');
  });
});
