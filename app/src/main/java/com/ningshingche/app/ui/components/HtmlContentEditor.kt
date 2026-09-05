package com.ningshingche.app.ui.components

import android.annotation.SuppressLint
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.ViewGroup
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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Code
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
import androidx.compose.runtime.getValue
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

@Composable
fun HtmlContentEditor(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    editorHeight: Int = 280,
    onEditorHeightChange: (Int) -> Unit = {}
) {
    var htmlMode by remember { mutableStateOf(false) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    var uploading by remember { mutableStateOf(false) }
    var uploadError by remember { mutableStateOf<String?>(null) }
    val height = editorHeight.coerceIn(200, 720)
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    fun run(command: String, arg: String? = null) {
        val script = if (arg == null) {
            "document.execCommand('$command')"
        } else {
            "document.execCommand('$command', false, ${JSONObject.quote(arg)})"
        }
        webView?.evaluateJavascript(script, null)
    }

    fun insertImageUrl(url: String) {
        val quoted = JSONObject.quote(url)
        webView?.evaluateJavascript("if(window.insertImage){window.insertImage($quoted);}", null)
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

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
                    ToolIcon("মোটা", Icons.Default.FormatBold) { run("bold") }
                    ToolIcon("বাঁকা", Icons.Default.FormatItalic) { run("italic") }
                    ToolIcon("নিচে দাগ", Icons.Default.FormatUnderlined) { run("underline") }
                    ToolIcon("ছবি যোগ", Icons.Default.Image) {
                        if (!uploading) imagePicker.launch("image/*")
                    }
                    ToolIcon("আগের কাজ", Icons.Default.Undo) { run("undo") }
                }
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

        Text(
            "লেখা নির্বাচন করলে মোটা, বাঁকা, নিচে দাগ, কপি ও কাট দেখাবে। ছবি ImgBB-তে আপলোড হয়।",
            fontFamily = Kalpurush,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        if (htmlMode) {
            OutlinedTextField(
                value = value,
                onValueChange = onValueChange,
                label = { Text("HTML লেখা", fontFamily = Kalpurush) },
                minLines = 8,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(height.dp)
                    .testTag("article_content"),
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
                        .testTag("article_content"),
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
                                HtmlBridge { html -> post { onValueChange(html) } },
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
                                    KalpurushWebFont.css(viewContext)
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
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(18.dp)
                    .pointerInput(height) {
                        detectVerticalDragGestures { _, dragAmount ->
                            onEditorHeightChange((height + dragAmount).toInt().coerceIn(200, 720))
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

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically
        ) {
            FilledTonalIconButton(
                onClick = { onEditorHeightChange((height - 80).coerceAtLeast(200)) },
                enabled = height > 200
            ) {
                Text("−", fontWeight = FontWeight.Bold)
            }
            FilledTonalIconButton(
                onClick = { onEditorHeightChange((height + 80).coerceAtMost(720)) },
                enabled = height < 720
            ) {
                Text("+", fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun ToolIcon(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit
) {
    IconButton(onClick = onClick, modifier = Modifier.size(40.dp)) {
        Icon(icon, contentDescription = label, modifier = Modifier.size(20.dp))
    }
}

private class HtmlBridge(private val emit: (String) -> Unit) {
    @JavascriptInterface
    fun onHtml(html: String) {
        emit(html)
    }
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
            val bytes = context.assets.open("fonts/kalpurush.ttf").use { it.readBytes() }
            val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
            val face = """
            @font-face {
              font-family: 'Kalpurush';
              src: url('data:font/truetype;charset=utf-8;base64,$b64') format('truetype');
              font-weight: 100 900;
              font-style: normal;
              font-display: block;
            }
            """.trimIndent()
            cached = face
            return face
        }
    }
}

private fun editorHtml(bgArgb: Int, fgArgb: Int, accentArgb: Int, fontFaceCss: String): String {
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
            #e:empty:before { content:'লেখা লিখুন… নির্বাচন করলে মোটা, বাঁকা, নিচে দাগ, কপি ও কাট আসবে।'; color:#888; font-family:'Kalpurush', sans-serif !important; }
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
          </div>
          <div id="e" contenteditable="true"></div>
          <script>
            const e = document.getElementById('e');
            const bar = document.getElementById('selbar');
            function emit(){ if (window.Android) Android.onHtml(e.innerHTML); }
            e.addEventListener('input', emit);
            e.addEventListener('blur', emit);
            document.addEventListener('contextmenu', function(ev){ ev.preventDefault(); });
            window.setHtml = function(html){
              if (typeof html === 'string' && html !== e.innerHTML) e.innerHTML = html;
            };
            window.insertImage = function(url){
              if (!url) return;
              e.focus();
              document.execCommand('insertHTML', false, '<p><img src="'+String(url).replace(/"/g,'')+'" alt=""></p>');
              emit();
            };
            document.querySelectorAll('#selbar [data-cmd]').forEach(function(btn){
              btn.addEventListener('mousedown', function(ev){ ev.preventDefault(); });
              btn.addEventListener('click', function(){
                document.execCommand(btn.getAttribute('data-cmd'));
                emit();
              });
            });
            document.addEventListener('selectionchange', function(){
              const sel = window.getSelection();
              if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !e.contains(sel.anchorNode)) {
                bar.style.display = 'none';
                return;
              }
              const rect = sel.getRangeAt(0).getBoundingClientRect();
              bar.style.display = 'flex';
              const top = window.scrollY + rect.top - bar.offsetHeight - 8;
              const left = Math.max(8, Math.min(window.scrollX + rect.left, document.body.clientWidth - 260));
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
