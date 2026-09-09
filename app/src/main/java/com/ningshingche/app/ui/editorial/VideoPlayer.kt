package com.ningshingche.app.ui.editorial

import android.annotation.SuppressLint
import android.graphics.Color as AndroidColor
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.ningshingche.app.data.portal.VideoItem
import com.ningshingche.app.ui.theme.Kalpurush
import java.net.URLEncoder

// ---------------------------------------------------------------------------
// Embed resolution
// ---------------------------------------------------------------------------

/** Matches the video id in every YouTube URL shape we store: watch?v=, /shorts/, /embed/, youtu.be/, /live/. */
private val YOUTUBE_ID = Regex("""(?:v=|/shorts/|/embed/|/live/|youtu\.be/)([A-Za-z0-9_-]{11})""")
private val VIMEO_ID = Regex("""(?:vimeo\.com/(?:video/)?|player\.vimeo\.com/video/)(\d+)""")
private val DAILYMOTION_ID = Regex("""dailymotion\.com/(?:embed/)?video/([A-Za-z0-9]+)""")

/**
 * Builds the embeddable iframe URL for a social video link (YouTube, Facebook,
 * Instagram, Vimeo, Dailymotion, or any host that already serves an embed page).
 */
internal fun embedUrlFor(url: String, autoplay: Boolean = true): String {
    val trimmed = url.trim()
    if (trimmed.isBlank()) return trimmed
    val autoFlag = if (autoplay) "1" else "0"

    YOUTUBE_ID.find(trimmed)?.groupValues?.getOrNull(1)?.let { id ->
        return "https://www.youtube.com/embed/$id" +
            "?autoplay=$autoFlag&rel=0&playsinline=1&modestbranding=1&fs=1"
    }
    VIMEO_ID.find(trimmed)?.groupValues?.getOrNull(1)?.let { id ->
        return "https://player.vimeo.com/video/$id?autoplay=$autoFlag&playsinline=1"
    }
    DAILYMOTION_ID.find(trimmed)?.groupValues?.getOrNull(1)?.let { id ->
        return "https://www.dailymotion.com/embed/video/$id?autoplay=$autoFlag"
    }
    if (trimmed.contains("instagram.com", ignoreCase = true)) {
        val path = trimmed.substringAfter("instagram.com").substringBefore("?").trimEnd('/')
        return if (path.endsWith("/embed")) {
            "https://www.instagram.com$path/"
        } else {
            "https://www.instagram.com$path/embed/"
        }
    }
    if (trimmed.contains("facebook.com", ignoreCase = true) || trimmed.contains("fb.watch", ignoreCase = true)) {
        val encoded = URLEncoder.encode(trimmed, "UTF-8")
        return "https://www.facebook.com/plugins/video.php" +
            "?href=$encoded&show_text=false&autoplay=${if (autoplay) "true" else "false"}&mute=0&width=560"
    }
    return trimmed
}

internal fun embedUrlFor(video: VideoItem): String = embedUrlFor(video.url, autoplay = true)

private fun playerHtml(src: String): String = """
    <!DOCTYPE html>
    <html>
    <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <style>
      html, body { margin:0; padding:0; width:100%; height:100%; background:#000; overflow:hidden; }
      #player { position:absolute; top:0; left:0; width:100%; height:100%; border:0; }
    </style>
    </head>
    <body>
    <iframe id="player"
        src="$src"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowfullscreen></iframe>
    </body>
    </html>
""".trimIndent()

/** A Chrome UA without the `; wv` marker, which YouTube and Facebook treat as an embedded browser. */
private const val PLAYER_UA =
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

// ---------------------------------------------------------------------------
// Player dialog
// ---------------------------------------------------------------------------

/**
 * Full-screen in-app video player.
 *
 * Plays YouTube via its official iframe embed and Facebook via the video plugin, both
 * inside a WebView. The WebView is paused with the hosting lifecycle and destroyed on
 * release, so closing the dialog stops audio immediately.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun SocialEmbedPlayer(
    url: String,
    modifier: Modifier = Modifier,
    autoplay: Boolean = true
) {
    val html = remember(url, autoplay) { playerHtml(embedUrlFor(url, autoplay)) }
    val lifecycleOwner = LocalLifecycleOwner.current
    var webView: WebView? by remember { mutableStateOf(null) }

    AndroidView(
        factory = { context ->
            WebView(context).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                setBackgroundColor(AndroidColor.BLACK)
                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    mediaPlaybackRequiresUserGesture = false
                    useWideViewPort = true
                    loadWithOverviewMode = true
                    builtInZoomControls = false
                    displayZoomControls = false
                    mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                    userAgentString = PLAYER_UA
                }
                webViewClient = WebViewClient()
                webChromeClient = WebChromeClient()
                loadDataWithBaseURL("https://ningshingche.com/", html, "text/html", "utf-8", null)
                webView = this
            }
        },
        modifier = modifier,
        onRelease = { view ->
            view.stopLoading()
            view.loadUrl("about:blank")
            view.webChromeClient = null
            view.destroy()
            webView = null
        }
    )

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> webView?.onPause()
                Lifecycle.Event.ON_RESUME -> webView?.onResume()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            webView?.onPause()
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun VideoPlayerDialog(
    video: VideoItem,
    onDismiss: () -> Unit,
    onOpenExternal: (String) -> Unit
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            dismissOnBackPress = true,
            dismissOnClickOutside = false
        )
    ) {
        Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
            SocialEmbedPlayer(
                url = video.url,
                modifier = Modifier.fillMaxSize(),
                autoplay = true
            )

            // Header: title with a close button and a manual escape hatch to the browser.
            Row(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = "বন্ধ করুন", tint = Color.White)
                }
                Text(
                    text = video.title,
                    fontFamily = Kalpurush,
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Surface(
                    onClick = { onOpenExternal(video.url) },
                    shape = CircleShape,
                    color = Color.White.copy(alpha = 0.16f)
                ) {
                    Icon(
                        Icons.Filled.OpenInNew,
                        contentDescription = "ব্রাউজারে খুলুন",
                        tint = Color.White,
                        modifier = Modifier.padding(8.dp).size(20.dp)
                    )
                }
            }
        }
    }
}
