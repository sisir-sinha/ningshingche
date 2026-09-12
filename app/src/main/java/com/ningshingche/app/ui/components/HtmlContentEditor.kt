package com.ningshingche.app.ui.components

import android.annotation.SuppressLint
import android.content.ClipboardManager
import android.content.Context
import android.view.ActionMode
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.FormatBold
import androidx.compose.material.icons.filled.FormatItalic
import androidx.compose.material.icons.filled.FormatUnderlined
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.ningshingche.app.data.remote.ImgBbUploader
import com.ningshingche.app.ui.theme.Kalpurush
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * A handle on the editor's keyboard, for the screen that owns it.
 *
 * A WebView is not a Compose text field, so `focusManager.clearFocus()` does not
 * close its keyboard. A screen that wants to dismiss it — because the reader
 * tapped outside, or because Back was pressed while the keyboard was up — asks
 * the editor through this instead, and the editor blurs the page and hides the
 * input method from the view that actually opened it.
 */
class HtmlEditorController {
    internal var hideKeyboard: (() -> Unit)? = null
    internal var focusEditor: (() -> Unit)? = null

    /** Blur the editing surface and put the keyboard away. */
    fun dismiss() {
        hideKeyboard?.invoke()
    }

    /**
     * Put the caret in the box and raise the keyboard.
     *
     * A reply box that opens under a tap is a box the reader expects to type in
     * straight away, and a WebView only raises the keyboard for a focus the page
     * asked for itself — so the screen asks the page, not the view.
     */
    fun focus() {
        focusEditor?.invoke()
    }
}

/** The smallest a box may be. A reply starts near this and grows from there. */
private const val EDITOR_MIN_HEIGHT = 88

/**
 * The app's rich text editor: a WebView with a toolbar over it.
 *
 * Two shapes, one component. The article composer takes the full editor — the
 * HTML switch, the height controls, the resize handle, and the little bar that
 * appears over selected text. The forum takes [compact], which is the same
 * editing surface without any of that: bold, italic, underline and a bullet
 * list, no selection popup (a popup over three lines of reply covers most of
 * them), and no way to put a picture *into* the text.
 *
 * The editor holds no files of its own. A forum post's attachments are drawn by
 * the screen that owns the box — on the row under it, beside the button that
 * added them — and they are appended to the HTML on their way to the database;
 * nothing is ever typed into the middle of a sentence.
 *
 * The box grows with what is written in it ([autoGrow]) up to [maxGrow], and
 * scrolls inside itself beyond that — a reply of three lines does not open a
 * box the height of a page, and a reply of thirty does not become unreadable.
 */
@Composable
fun HtmlContentEditor(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    editorHeight: Int = 280,
    onEditorHeightChange: (Int) -> Unit = {},
    selectionPopup: Boolean = true,
    compact: Boolean = false,
    placeholder: String = "লেখা লিখুন… নির্বাচন করলে মোটা, বাঁকা, নিচে দাগ, কপি, কাট ও পেস্ট আসবে।",
    testTag: String = "article_content",
    controller: HtmlEditorController? = null,
    autoGrow: Boolean = true,
    maxGrow: Int = if (compact) 260 else 720
) {
    var htmlMode by remember { mutableStateOf(false) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    // What the page last told us, and what we last told the page. A value that
    // comes back from the page is not pushed back into it (that would fight the
    // caret); a value that changes anywhere else — the box being emptied after a
    // post went through, a draft being restored — is pushed, and that is how the
    // text actually disappears from the screen.
    var lastEmitted by remember { mutableStateOf("") }
    var lastPushed by remember { mutableStateOf("") }
    var uploading by remember { mutableStateOf(false) }
    var uploadError by remember { mutableStateOf<String?>(null) }
    // What the box measures: the caller's height is the floor, what the reader
    // has written raises it, and `maxGrow` is the ceiling beyond which the box
    // scrolls instead of growing.
    var contentHeight by remember { mutableIntStateOf(0) }
    val baseHeight = editorHeight.coerceIn(EDITOR_MIN_HEIGHT, 720)
    val height = maxOf(baseHeight, contentHeight).coerceAtMost(maxGrow)
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // The reader's own Back, while the keyboard is up, is the keyboard's first.
    SideEffect {
        controller?.focusEditor = {
            webView?.requestFocus()
            webView?.evaluateJavascript("if(window.focusEditor){window.focusEditor();}", null)
        }
        controller?.hideKeyboard = {
            webView?.evaluateJavascript(
                "if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();",
                null
            )
            val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
            imm?.hideSoftInputFromWindow(webView?.windowToken, 0)
        }
    }

    /**
     * A toolbar button, in three steps: the box takes the focus back, the caret
     * is put where it was, and only then does the command run.
     *
     * That order is the whole of a bug the owner reported twice — bold and
     * italic "did nothing". Tapping a Compose button is not a tap on the page, so
     * the page may have lost the focus the selection lived in; `execCommand` with
     * no selection does nothing at all, quietly. The page keeps its last range
     * and puts it back before every command, which is what makes the button work
     * whether or not the reader still has the caret showing.
     */
    fun run(command: String, arg: String? = null) {
        val web = webView ?: return
        // Only if it is not focused already: asking a WebView for the focus it
        // already has is a no-op, but asking for it *while the keyboard is
        // attached* restarts the input connection, and a Bengali keyboard that
        // is composing a conjunct does not survive that.
        if (!web.isFocused) web.requestFocus()
        val script = if (arg == null) {
            "window.command(${JSONObject.quote(command)})"
        } else {
            "window.command(${JSONObject.quote(command)}, ${JSONObject.quote(arg)})"
        }
        web.evaluateJavascript(script, null)
    }

    fun insertImageUrl(url: String) {
        val quoted = JSONObject.quote(url)
        webView?.evaluateJavascript("if(window.insertImage){window.insertImage($quoted);}", null)
    }

    fun pasteClipboard() {
        val text = clipboardText(context)
        if (text.isBlank()) return
        webView?.evaluateJavascript("if(window.pasteText){window.pasteText(${JSONObject.quote(text)});}", null)
    }

    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            uploading = true
            uploadError = null
            val result = ImgBbUploader.uploadFromUri(context, uri, "inline_${System.currentTimeMillis()}")
            uploading = false
            result.onSuccess { image ->
                val url = image.displayUrl.ifBlank { image.url }
                if (url.isNotBlank()) insertImageUrl(url)
            }.onFailure { error ->
                uploadError = error.message ?: "ছবি আপলোড হয়নি।"
            }
        }
    }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 8.dp)) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            tonalElevation = 1.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 4.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (!htmlMode) {
                    ToolIcon("মোটা", Icons.Default.FormatBold, compact) { run("bold") }
                    ToolIcon("বাঁকা", Icons.Default.FormatItalic, compact) { run("italic") }
                    ToolIcon("নিচে দাগ", Icons.Default.FormatUnderlined, compact) { run("underline") }
                    ToolIcon("তালিকা", Icons.Default.FormatListBulleted, compact) { run("insertUnorderedList") }
                    if (!compact) {
                        ToolIcon("পেস্ট", Icons.Default.ContentPaste) { pasteClipboard() }
                    }
                    // The picture button is the article composer's. A forum post
                    // attaches its files on the row under the box — a picture and a
                    // PDF alike — so the four the owner listed are the four here.
                    if (!compact) {
                        ToolIcon("ছবি যোগ", Icons.Default.Image) {
                            if (!uploading) imagePicker.launch("image/*")
                        }
                    }
                    if (!compact) {
                        ToolIcon("আগের কাজ", Icons.Default.Undo) { run("undo") }
                    }
                }
                // The HTML switch belongs to the article composer: a forum reply
                // is written in the toolbar and nowhere else.
                if (!compact) {
                    FilterChip(
                        selected = htmlMode,
                        onClick = {
                            if (!htmlMode) {
                                webView?.evaluateJavascript("(document.getElementById('e')||{}).innerHTML||''") { raw ->
                                    val html = unescapeJsString(raw)
                                    if (html.isNotBlank()) onValueChange(html)
                                }
                            }
                            htmlMode = !htmlMode
                        },
                        label = { Text("HTML", fontFamily = Kalpurush, fontWeight = FontWeight.Bold) },
                        leadingIcon = { Icon(Icons.Default.Code, contentDescription = null, modifier = Modifier.size(16.dp)) }
                    )
                }
            }
        }

        if (!compact) {
            Text(
                "লেখা নির্বাচন করলে মোটা, বাঁকা, নিচে দাগ, কপি, কাট ও পেস্ট দেখাবে। ছবি ImgBB-তে আপলোড হয়।",
            fontFamily = Kalpurush,
            style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        if (htmlMode) {
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                label = { Text("HTML লেখা", fontFamily = Kalpurush) },
                minLines = 8,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(height.dp)
                    .testTag(testTag),
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace)
            )
        } else {
            val background = MaterialTheme.colorScheme.surface
            val onSurface = MaterialTheme.colorScheme.onSurface
            val outline = MaterialTheme.colorScheme.outline
            val accent = MaterialTheme.colorScheme.primary
            Box {
                AndroidView(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(height.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .border(1.dp, outline, RoundedCornerShape(12.dp))
                        .testTag(testTag),
                    factory = { viewContext ->
                        @SuppressLint("SetJavaScriptEnabled")
                        RichEditorWebView(viewContext).apply {
                            layoutParams = ViewGroup.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT
                            )
                            setBackgroundColor(background.toArgb())
                            isFocusable = true
                            isFocusableInTouchMode = true
                            isLongClickable = true
                            isHapticFeedbackEnabled = false
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = false
                            settings.allowFileAccess = true
                            settings.allowContentAccess = true
                            settings.loadsImagesAutomatically = true
                            settings.blockNetworkImage = false
                            addJavascriptInterface(
                                HtmlBridge(
                                    host = this,
                                    emit = { html ->
                                        post {
                                            lastEmitted = html
                                            onValueChange(html)
                                        }
                                    },
                                    emitHeight = { measured ->
                                        post {
                                            // Reported by the page as it grows;
                                            // ignored entirely when the caller
                                            // has asked for a fixed box.
                                            if (autoGrow) contentHeight = measured.coerceIn(0, 720)
                                        }
                                    }
                                ),
                                "Android"
                            )
                            webViewClient = object : WebViewClient() {
                                override fun onPageFinished(view: WebView?, url: String?) {
                                    val quoted = JSONObject.quote(value)
                                    view?.evaluateJavascript(
                                        "if(window.setHtml){window.setHtml($quoted);}",
                                        null
                                    )
                                }
                            }
                            loadDataWithBaseURL(
                                "https://ningshingche.com/",
                                editorHtml(
                                    background.toArgb(),
                                    onSurface.toArgb(),
                                    accent.toArgb(),
                                    KalpurushWebFont.css(viewContext),
                                    selectionPopup,
                                    placeholder
                                ),
                                "text/html",
                                "utf-8",
                                null
                            )
                            webView = this
                        }
                    },
                    update = { view ->
                        webView = view
                        // What the caller holds and what the box shows are kept in
                        // step here. Setting the value from the page may be pushed
                        // straight back in a moment later, which is what empties the
                        // box the instant an answer has gone through.
                        if (value != lastEmitted && value != lastPushed) {
                            lastPushed = value
                            view.evaluateJavascript(
                                "if(window.setHtml){window.setHtml(${JSONObject.quote(value)});}",
                                null
                            )
                        }
                    }
                )
                if (uploading) {
                    Box(
                        modifier = Modifier
                            .matchParentSize()
                            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.72f)),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 2.dp)
                            Text("ছবি আপলোড হচ্ছে…", fontFamily = Kalpurush, modifier = Modifier.padding(top = 8.dp))
                        }
                    }
                }
            }
            if (!compact) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(18.dp)
                    .pointerInput(baseHeight) {
                        detectVerticalDragGestures { _, dragAmount ->
                            onEditorHeightChange((baseHeight + dragAmount).toInt().coerceIn(200, 720))
                        }
                    },
                contentAlignment = Alignment.Center
            ) {
                Box(
                    modifier = Modifier
                        .width(42.dp)
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(MaterialTheme.colorScheme.outline)
                )
            }
            }
            DisposableEffect(Unit) {
                onDispose {
                    webView?.destroy()
                    webView = null
                }
            }
        }

        uploadError?.let { error ->
            Text(error, color = MaterialTheme.colorScheme.error, fontFamily = Kalpurush, style = MaterialTheme.typography.bodySmall)
        }

        if (!compact) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
            FilledTonalIconButton(
                onClick = { onEditorHeightChange((baseHeight - 80).coerceAtLeast(200)) },
                enabled = baseHeight > 200
            ) {
                Text("−", fontWeight = FontWeight.Bold)
            }
            FilledTonalIconButton(
                onClick = { onEditorHeightChange((baseHeight + 80).coerceAtMost(720)) },
                enabled = baseHeight < 720
            ) {
                Text("+", fontWeight = FontWeight.Bold)
            }
            }
        }
    }
}

@Composable
/**
 * One toolbar button. [compact] shrinks it: the reply box is a strip at the
 * bottom of the screen, and three 40 dp buttons over a 96 dp box would be most
 * of the box.
 */
@Composable
private fun ToolIcon(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    compact: Boolean = false,
    onClick: () -> Unit
) {
    IconButton(onClick = onClick, modifier = Modifier.size(if (compact) 30.dp else 40.dp)) {
        Icon(icon, contentDescription = label, modifier = Modifier.size(if (compact) 16.dp else 20.dp))
    }
}

private class HtmlBridge(
    private val host: WebView,
    private val emit: (String) -> Unit,
    private val emitHeight: (Int) -> Unit
) {
    @JavascriptInterface
    fun onHtml(html: String) {
        emit(html)
    }

    /** How tall the writing is, in CSS pixels — which is what a dp is here. */
    @JavascriptInterface
    fun onHeight(px: Int) {
        host.post { emitHeight(px) }
    }
}

private fun clipboardText(context: Context): String {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return ""
    val clip = clipboard.primaryClip ?: return ""
    if (clip.itemCount <= 0) return ""
    return clip.getItemAt(0).coerceToText(context).toString()
}

open class RichEditorWebView(context: android.content.Context) : WebView(context) {
    override fun startActionMode(callback: ActionMode.Callback?): ActionMode? = null
    override fun startActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? = null
}


private object KalpurushWebFont {
    @Volatile private var cached: String? = null

    fun css(context: android.content.Context): String {
        cached?.let { return it }
        synchronized(this) {
            cached?.let { return it }
            // Read from res/font, where the same TTF already lives for Compose:
            // shipping a second copy under assets/ cost 314 KB of the APK for
            // bytes the resource table was carrying anyway.
            val bytes = runCatching {
                context.resources.openRawResource(com.ningshingche.app.R.font.kalpurush)
                    .use { it.readBytes() }
            }.getOrNull() ?: return ""
            val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
            // `font-weight: 400` and not a range: Kalpurush ships one weight, and a
            // face that claims 100–900 tells the browser every weight is covered —
            // so it draws bold text with the regular glyphs and bold looks like
            // nothing happened. Declaring the single weight lets the browser
            // synthesise the bold (and the italic) the reader asked for.
            val face = """
            @font-face {
              font-family: 'Kalpurush';
              src: url('data:font/truetype;charset=utf-8;base64,$b64') format('truetype');
              font-weight: 400;
              font-style: normal;
              font-display: block;
            }
            """.trimIndent()
            cached = face
            return face
        }
    }
}

private fun editorHtml(
    bgArgb: Int,
    fgArgb: Int,
    accentArgb: Int,
    fontFaceCss: String,
    selectionPopup: Boolean = true,
    placeholder: String = "লেখা লিখুন… নির্বাচন করলে মোটা, বাঁকা, নিচে দাগ, কপি, কাট ও পেস্ট আসবে।"
): String {
    val bg = hexColor(bgArgb)
    val fg = hexColor(fgArgb)
    val accent = hexColor(accentArgb)
    return """
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8"/>
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
          <style>
            $fontFaceCss
            html,body { margin:0; padding:0; background:$bg; color:$fg; font-size:16px; height:100%;
              font-family:'Kalpurush', sans-serif !important;
              -webkit-touch-callout:none; -webkit-user-select:text; user-select:text; }
            body { position:relative; }
            #e { min-height:100%; padding:14px 14px 56px; outline:none; line-height:1.65;
              font-family:'Kalpurush', sans-serif !important;
              -webkit-touch-callout:none; -webkit-user-select:text; user-select:text; }
            #e:empty:before { content:'${placeholder.replace("'", "")}'; color:#888; font-family:'Kalpurush', sans-serif !important; }
            #e img { max-width:100%; height:auto; border-radius:8px; margin:8px 0; }
            #selbar {
              position:absolute; display:none; z-index:20;
              background:#1a1512; color:#fff; border-radius:10px;
              padding:4px; gap:2px; box-shadow:0 10px 28px rgba(0,0,0,.28);
              white-space:nowrap;
            }
            #selbar button {
              color:#fff; background:transparent; border:0; border-radius:7px;
              padding:7px 9px; font-weight:700; font-size:13px;
            }
            #selbar button:active { background:rgba(255,255,255,.15); }
          </style>
        </head>
        <body>
          <div id="selbar">
            <button type="button" data-cmd="bold">B</button>
            <button type="button" data-cmd="italic"><i>I</i></button>
            <button type="button" data-cmd="underline"><u>U</u></button>
            <button type="button" data-cmd="copy">Copy</button>
            <button type="button" data-cmd="cut">Cut</button>
            <button type="button" data-cmd="paste">Paste</button>
          </div>
          <div id="e" contenteditable="true"></div>
          <script>
            const e = document.getElementById('e');
            const bar = document.getElementById('selbar');
            function emit(){ if (window.Android) Android.onHtml(e.innerHTML); }
            // Where the caret was, kept across taps that leave the page. A tap on
            // a toolbar button is a tap outside the document, and the selection
            // does not survive it on every WebView build — which is why the
            // buttons put the range back before they run a command.
            var lastRange = null;
            // Whether the reader's keyboard is in the middle of a letter. Bengali
            // is written by composing — ক + ্ + ষ is one character to a reader and
            // three keystrokes to the IME — and while a composition is open the
            // DOM and the selection belong to the keyboard. Anything this page
            // does to either of them mid-composition is a garbled word at best
            // and a keyboard that throws its hands up at worst, so every path
            // below that touches the document is closed while it is true.
            var composing = false;
            e.addEventListener('compositionstart', function(){ composing = true; });
            e.addEventListener('compositionend', function(){
              composing = false;
              flushPending();
              saveSelection();
            });
            function saveSelection(){
              if (composing) return;
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0 && e.contains(sel.anchorNode)) {
                lastRange = sel.getRangeAt(0).cloneRange();
              }
            }
            function restoreSelection(){
              if (!lastRange) return;
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(lastRange);
            }
            // Only ever used when the page is not focused by the reader — a value
            // arriving from outside, with nobody's caret to disturb.
            function placeCaretAtEnd(){
              const range = document.createRange();
              range.selectNodeContents(e);
              range.collapse(false);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
              lastRange = range.cloneRange();
            }
            // Not on 'input': that fires on every keystroke of every composition,
            // and reading the selection there is the one thing an IME does not
            // want happening underneath it.
            ['keyup','mouseup','touchend','focus'].forEach(function(ev){
              e.addEventListener(ev, saveSelection);
            });
            document.addEventListener('selectionchange', saveSelection);
            window.command = function(cmd, arg){
              if (!composing) {
                // The caret may have been left behind by the tap that got here;
                // putting it back is what makes the button work. Mid-composition
                // it is the keyboard's, and is left alone.
                if (e.focus && document.activeElement !== e) e.focus();
                restoreSelection();
              }
              // Tags, not inline styles: the reader's markup is read back by the
              // app's own renderer and by the site, and both know <b> and <i>.
              document.execCommand('styleWithCSS', false, false);
              var done = false;
              try { done = document.execCommand(cmd, false, arg === undefined ? null : arg); }
              catch (err) { done = false; }
              if (!composing) saveSelection();
              emit();
              grow();
              return done;
            };
            // Raising the keyboard for a box that was just opened — and doing
            // nothing at all when the reader is already in it, because moving a
            // caret that someone is typing at is how a word ends up in pieces.
            window.focusEditor = function(){
              if (composing || document.activeElement === e) return;
              e.focus();
            };
            // How tall the writing is. The box on the other side of the bridge
            // grows to fit it, up to the ceiling the caller set, and scrolls past
            // that — so a long reply is readable inside a box that never takes
            // more of the screen than it has to.
            function grow(){ if (window.Android && Android.onHeight) Android.onHeight(Math.ceil(e.scrollHeight)); }
            e.addEventListener('input', function(ev){
              // The keyboard says so itself, and it is believed over the flag: a
              // composition can open without a compositionstart on some builds.
              if (ev && ev.isComposing) composing = true;
              emit();
              grow();
            });
            e.addEventListener('blur', emit);
            window.addEventListener('resize', grow);
            setTimeout(grow, 60);
            document.addEventListener('contextmenu', function(ev){ ev.preventDefault(); });
            var pendingHtml = null;
            function applyHtml(html){
              if (typeof html !== 'string' || html === e.innerHTML) return;
              e.innerHTML = html;
              lastRange = null;
              if (document.activeElement !== e) placeCaretAtEnd();
              grow();
            }
            // A value from the caller. Refused while the reader is composing or
            // has the caret in the box — the app clears the box *after* blurring
            // it, for exactly this reason — and kept until the page is free.
            window.setHtml = function(html){
              if (typeof html !== 'string') return;
              if (html === e.innerHTML) { pendingHtml = null; return; }
              if (composing || document.activeElement === e) {
                pendingHtml = html;
                return;
              }
              pendingHtml = null;
              applyHtml(html);
            };
            function flushPending(){
              if (pendingHtml === null) return;
              if (composing || document.activeElement === e) return;
              const html = pendingHtml;
              pendingHtml = null;
              applyHtml(html);
            }
            e.addEventListener('blur', flushPending);
            e.addEventListener('focusout', flushPending);
            window.insertImage = function(url){
              if (!url) return;
              e.focus();
              document.execCommand('insertHTML', false, '<p><img src="'+String(url).replace(/"/g,'')+'" alt=""></p>');
              emit();
            };
            document.querySelectorAll('#selbar [data-cmd]').forEach(function(btn){
              btn.addEventListener('mousedown', function(ev){ ev.preventDefault(); });
              btn.addEventListener('click', function(){
                window.command(btn.getAttribute('data-cmd'));
              });
            });
            // The selection bar belongs to the article composer alone: over three
            // lines of reply it is in the way, which is why the forum turns it off.
            if (${selectionPopup}) document.addEventListener('selectionchange', function(){
              // A composing region counts as a selection, and the black bar
              // appearing over every Bengali word as it is written is worse than
              // no bar at all — so the bar waits for the word to be finished.
              if (composing) { bar.style.display = 'none'; return; }
              const sel = window.getSelection();
              if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !e.contains(sel.anchorNode)) {
                bar.style.display = 'none';
                return;
              }
              const rect = sel.getRangeAt(0).getBoundingClientRect();
              bar.style.display = 'flex';
              const top = window.scrollY + rect.top - bar.offsetHeight - 8;
              const left = Math.max(8, Math.min(window.scrollX + rect.left, document.body.clientWidth - 340));
              bar.style.top = Math.max(8, top) + 'px';
              bar.style.left = left + 'px';
            });
          </script>
        </body>
        </html>
    """.trimIndent()
}

private fun hexColor(argb: Int): String = String.format("#%06X", 0xFFFFFF and argb)

private fun unescapeJsString(raw: String): String {
    if (raw.length >= 2 && raw.startsWith("\"") && raw.endsWith("\"")) {
        return raw.substring(1, raw.lastIndex)
            .replace("\\n", "\n")
            .replace("\\\"", "\"")
            .replace("\\/", "/")
            .replace("\\\\", "\\")
    }
    if (raw == "null") return ""
    return raw
}
