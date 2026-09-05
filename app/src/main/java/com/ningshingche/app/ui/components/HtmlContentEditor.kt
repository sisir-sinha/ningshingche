package com.ningshingche.app.ui.components

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
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
import androidx.compose.material.icons.automirrored.filled.FormatListBulleted
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.FormatBold
import androidx.compose.material.icons.filled.FormatItalic
import androidx.compose.material.icons.filled.FormatListNumbered
import androidx.compose.material.icons.filled.FormatQuote
import androidx.compose.material.icons.filled.FormatSize
import androidx.compose.material.icons.filled.FormatUnderlined
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Redo
import androidx.compose.material.icons.filled.FormatStrikethrough
import androidx.compose.material.icons.filled.Title
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material.icons.filled.UnfoldLess
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.ningshingche.app.ui.theme.Kalpurush
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
    var showLinkDialog by remember { mutableStateOf(false) }
    var linkUrl by remember { mutableStateOf("https://") }
    val height = editorHeight.coerceIn(200, 720)

    fun run(command: String, arg: String? = null) {
        val script = if (arg == null) {
            "document.execCommand('$command')"
        } else {
            "document.execCommand('$command', false, ${JSONObject.quote(arg)})"
        }
        webView?.evaluateJavascript(script, null)
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
                    ToolIcon("কেটে দাগ", Icons.Default.FormatStrikethrough) { run("strikeThrough") }
                    ToolIcon("শিরোনাম", Icons.Default.Title) { run("formatBlock", "h2") }
                    ToolIcon("উপশিরোনাম", Icons.Default.FormatSize) { run("formatBlock", "h3") }
                    ToolIcon("উদ্ধৃতি", Icons.Default.FormatQuote) { run("formatBlock", "blockquote") }
                    ToolIcon("বুলেট তালিকা", Icons.AutoMirrored.Filled.FormatListBulleted) { run("insertUnorderedList") }
                    ToolIcon("সংখ্যা তালিকা", Icons.Default.FormatListNumbered) { run("insertOrderedList") }
                    ToolIcon("লিংক", Icons.Default.Link) { showLinkDialog = true }
                    ToolIcon("আগের কাজ", Icons.Default.Undo) { run("undo") }
                    ToolIcon("পুনরায়", Icons.Default.Redo) { run("redo") }
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

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "লেখা নির্বাচন করলে ফরম্যাট অপশন দেখাবে। নিচে টেনে এডিটর বড় করুন।",
                fontFamily = Kalpurush,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f)
            )
            FilledTonalIconButton(
                onClick = { onEditorHeightChange((height - 80).coerceAtLeast(200)) },
                enabled = height > 200
            ) {
                Icon(Icons.Default.UnfoldLess, contentDescription = "এডিটর ছোট করুন")
            }
            FilledTonalIconButton(
                onClick = { onEditorHeightChange((height + 80).coerceAtMost(720)) },
                enabled = height < 720
            ) {
                Icon(Icons.Default.UnfoldMore, contentDescription = "এডিটর বড় করুন")
            }
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
                    .testTag("article_content"),
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace)
            )
        } else {
            val background = MaterialTheme.colorScheme.surface
            val onSurface = MaterialTheme.colorScheme.onSurface
            val outline = MaterialTheme.colorScheme.outline
            val accent = MaterialTheme.colorScheme.primary
            AndroidView(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(height.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .border(1.dp, outline, RoundedCornerShape(12.dp))
                    .testTag("article_content"),
                factory = { context ->
                    @SuppressLint("SetJavaScriptEnabled")
                    WebView(context).apply {
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                        setBackgroundColor(background.toArgb())
                        isFocusable = true
                        isFocusableInTouchMode = true
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = false
                        settings.allowFileAccess = false
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
                            null,
                            editorHtml(background.toArgb(), onSurface.toArgb(), accent.toArgb()),
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
    }

    if (showLinkDialog) {
        AlertDialog(
            onDismissRequest = { showLinkDialog = false },
            title = { Text("লিংক যোগ করুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold) },
            text = {
                OutlinedTextField(
                    value = linkUrl,
                    onValueChange = { linkUrl = it },
                    label = { Text("URL", fontFamily = Kalpurush) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val url = linkUrl.trim()
                        if (url.startsWith("http://") || url.startsWith("https://")) {
                            run("createLink", url)
                        }
                        showLinkDialog = false
                    }
                ) { Text("যোগ করুন", fontFamily = Kalpurush) }
            },
            dismissButton = {
                TextButton(onClick = { showLinkDialog = false }) {
                    Text("বাতিল", fontFamily = Kalpurush)
                }
            }
        )
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

private fun editorHtml(bgArgb: Int, fgArgb: Int, accentArgb: Int): String {
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
            html,body { margin:0; padding:0; background:$bg; color:$fg; font-size:16px; height:100%; }
            body { position:relative; }
            #e { min-height:100%; padding:14px 14px 56px; outline:none; line-height:1.65; }
            #e:empty:before { content:'লেখা লিখুন… নির্বাচন করলে ফরম্যাট অপশন আসবে।'; color:#888; }
            #e h2 { font-size:1.35em; margin:0.6em 0 0.3em; }
            #e h3 { font-size:1.15em; margin:0.5em 0 0.25em; }
            #e blockquote { margin:0.5em 0; padding-left:12px; border-left:3px solid $accent; color:#666; }
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
            <button type="button" data-cmd="strikeThrough"><s>S</s></button>
            <button type="button" data-block="h2">H2</button>
            <button type="button" data-block="h3">H3</button>
            <button type="button" data-cmd="insertUnorderedList">•</button>
            <button type="button" data-cmd="insertOrderedList">1.</button>
            <button type="button" data-block="blockquote">“</button>
          </div>
          <div id="e" contenteditable="true"></div>
          <script>
            const e = document.getElementById('e');
            const bar = document.getElementById('selbar');
            function emit(){ if (window.Android) Android.onHtml(e.innerHTML); }
            e.addEventListener('input', emit);
            e.addEventListener('blur', emit);
            window.setHtml = function(html){
              if (typeof html === 'string') e.innerHTML = html;
            };
            document.querySelectorAll('#selbar [data-cmd]').forEach(function(btn){
              btn.addEventListener('mousedown', function(ev){ ev.preventDefault(); });
              btn.addEventListener('click', function(){
                document.execCommand(btn.getAttribute('data-cmd'));
                emit();
              });
            });
            document.querySelectorAll('#selbar [data-block]').forEach(function(btn){
              btn.addEventListener('mousedown', function(ev){ ev.preventDefault(); });
              btn.addEventListener('click', function(){
                document.execCommand('formatBlock', false, btn.getAttribute('data-block'));
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
              const left = Math.max(8, Math.min(window.scrollX + rect.left, document.body.clientWidth - 220));
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
