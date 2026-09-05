package com.ningshingche.app.ui.components

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.ningshingche.app.ui.theme.Kalpurush

@Composable
fun HtmlContentEditor(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var htmlMode by remember { mutableStateOf(false) }
    var webView by remember { mutableStateOf<WebView?>(null) }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (!htmlMode) {
                FormatButton("B") { webView?.exec("bold") }
                FormatButton("I") { webView?.exec("italic") }
                FormatButton("U") { webView?.exec("underline") }
                FormatButton("H") { webView?.eval("document.execCommand('formatBlock', false, 'h2')") }
                FormatButton("•") { webView?.exec("insertUnorderedList") }
            }
            FilterChip(
                selected = htmlMode,
                onClick = {
                    if (!htmlMode) {
                        webView?.evaluateJavascript("document.getElementById('e')?.innerHTML || ''") { raw ->
                            val html = unescapeJsString(raw)
                            if (html.isNotBlank()) onValueChange(html)
                        }
                    }
                    htmlMode = !htmlMode
                },
                label = { Text("HTML", fontFamily = Kalpurush, fontWeight = FontWeight.Bold) }
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
                    .testTag("article_content"),
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace)
            )
        } else {
            val background = MaterialTheme.colorScheme.surface
            val onSurface = MaterialTheme.colorScheme.onSurface
            val outline = MaterialTheme.colorScheme.outline
            key(htmlMode) {
            AndroidView(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(220.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .border(1.dp, outline, RoundedCornerShape(4.dp))
                    .testTag("article_content"),
                factory = { context ->
                    @SuppressLint("SetJavaScriptEnabled")
                    WebView(context).apply {
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                        setBackgroundColor(background.toArgb())
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = false
                        settings.allowFileAccess = false
                        addJavascriptInterface(
                            HtmlBridge { html -> post { onValueChange(html) } },
                            "Android"
                        )
                        webViewClient = object : WebViewClient() {
                            override fun onPageFinished(view: WebView?, url: String?) {
                                super.onPageFinished(view, url)
                            }
                        }
                        loadDataWithBaseURL(
                            null,
                            editorHtml(value, background.toArgb(), onSurface.toArgb()),
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
            DisposableEffect(Unit) {
                onDispose {
                    webView?.destroy()
                    webView = null
                }
            }
            }
        }
    }
}

@Composable
private fun FormatButton(label: String, onClick: () -> Unit) {
    TextButton(onClick = onClick) {
        Text(label, fontWeight = FontWeight.Bold)
    }
}

@SuppressLint("SetJavaScriptEnabled")
private fun WebView.exec(command: String) {
    eval("document.execCommand('$command')")
}

private fun WebView.eval(script: String) {
    evaluateJavascript(script, null)
}

private class HtmlBridge(private val emit: (String) -> Unit) {
    @JavascriptInterface
    fun onHtml(html: String) {
        emit(html)
    }
}

private fun editorHtml(initial: String, bgArgb: Int, fgArgb: Int): String {
    val bg = hexColor(bgArgb)
    val fg = hexColor(fgArgb)
    val body = initial.ifBlank { "" }
    return """
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8"/>
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
          <style>
            html,body { margin:0; padding:10px; background:$bg; color:$fg; font-size:16px; }
            #e { min-height:180px; outline:none; }
            #e:empty:before { content:'লেখা লিখুন…'; color:#888; }
          </style>
        </head>
        <body>
          <div id="e" contenteditable="true">$body</div>
          <script>
            const e = document.getElementById('e');
            function emit(){ if (window.Android) Android.onHtml(e.innerHTML); }
            e.addEventListener('input', emit);
            e.addEventListener('blur', emit);
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
