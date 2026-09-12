package com.ningshingche.app.ui.components

import android.graphics.Color as AndroidColor
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.github.barteksc.pdfviewer.PDFView
import com.github.barteksc.pdfviewer.util.FitPolicy
import com.ningshingche.app.data.portal.ForumAttachment
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.util.PdfHelper
import kotlinx.coroutines.launch
import java.io.File

private val ViewerCanvas = Color(0xF2120E0C)
private val ViewerInk = Color(0xFFF6EFE6)

/**
 * An attachment, as large as the phone will show it.
 *
 * A picture fills the screen and can be pinched; a PDF is opened by the app's own
 * viewer library — the same one the book archive uses, at its plainest setting,
 * because the owner asked for no smart options here: pages, swipes, and nothing
 * to configure. Either way the file can be taken away from the top right corner,
 * which writes it into `Download/Ningshingche` (or `Download/Ningshingche_PDFs`
 * for a document) and says so in a toast.
 *
 * The whole thing is a dialog without a frame, so the page behind it is visible
 * enough to know where the reader came from, and a tap outside closes it — the
 * close button is there for the tap that lands on the picture instead.
 */
@Composable
fun AttachmentViewer(
    attachment: ForumAttachment,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            dismissOnClickOutside = true,
            dismissOnBackPress = true
        )
    ) {
        Surface(
            color = ViewerCanvas,
            modifier = modifier
                .fillMaxSize()
                .testTag("attachment_viewer")
        ) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .padding(start = 16.dp, end = 6.dp, top = 8.dp, bottom = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = attachment.label,
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 14.sp,
                            color = ViewerInk,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = if (attachment.isPdf) "পিডিএফ ডকুমেন্ট" else "ছবি",
                            fontFamily = Kalpurush,
                            fontSize = 11.sp,
                            color = ViewerInk.copy(alpha = 0.62f)
                        )
                    }
                    IconButton(
                        onClick = {
                            if (saving) return@IconButton
                            saving = true
                            scope.launch {
                                PdfHelper.saveAttachmentToDownloads(
                                    context = context,
                                    url = attachment.url,
                                    fileName = attachment.downloadName,
                                    mimeType = attachment.mime
                                )
                                    .onSuccess { AppToasts.show(it) }
                                    .onFailure { AppToasts.show(it.message ?: "ডাউনলোড হয়নি।") }
                                saving = false
                            }
                        },
                        modifier = Modifier.testTag("attachment_download")
                    ) {
                        if (saving) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = ViewerInk
                            )
                        } else {
                            Icon(Icons.Default.Download, contentDescription = "ডাউনলোড", tint = ViewerInk)
                        }
                    }
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.testTag("attachment_close")
                    ) {
                        Icon(Icons.Default.Close, contentDescription = "বন্ধ করুন", tint = ViewerInk)
                    }
                }

                if (attachment.isPdf) {
                    AttachmentPdf(attachment = attachment)
                } else {
                    AttachmentPicture(attachment = attachment)
                }
            }
        }
    }
}

/** A picture, fitted to the screen and pinch-zoomable. */
@Composable
private fun AttachmentPicture(attachment: ForumAttachment) {
    var scale by remember(attachment.url) { mutableFloatStateOf(1f) }
    var offset by remember(attachment.url) { mutableStateOf(Offset.Zero) }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(attachment.url) {
                detectTransformGestures { _, pan, zoom, _ ->
                    scale = (scale * zoom).coerceIn(1f, 5f)
                    // Panning only means something once the picture is bigger than
                    // the screen; at 1× it would just slide the picture aside.
                    offset = if (scale > 1f) offset + pan else Offset.Zero
                }
            }
            .testTag("attachment_image_view"),
        contentAlignment = Alignment.Center
    ) {
        PortalAsyncImage(
            url = attachment.url,
            contentDescription = attachment.label,
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer(
                    scaleX = scale,
                    scaleY = scale,
                    translationX = offset.x,
                    translationY = offset.y
                )
        )
        if (scale > 1f) {
            Text(
                text = "স্বাভাবিক আকারে ফিরতে দুই আঙুল টেনে ছোট করুন",
                fontFamily = Kalpurush,
                fontSize = 10.5.sp,
                color = ViewerInk.copy(alpha = 0.55f),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 18.dp)
            )
        }
    }
}

/**
 * A PDF, drawn by the app's viewer library.
 *
 * The document is fetched to the cache first — the library reads files, not
 * URLs — and the pages are then shown one after another, fitted to the width,
 * with a swipe between them. No annotations, no night mode, no settings sheet:
 * the reader came here to look at one document, and the reader's own settings
 * belong to the book archive.
 */
@Composable
private fun AttachmentPdf(attachment: ForumAttachment) {
    val context = LocalContext.current
    var file by remember(attachment.url) { mutableStateOf<File?>(null) }
    var loading by remember(attachment.url) { mutableStateOf(true) }
    var error by remember(attachment.url) { mutableStateOf<String?>(null) }
    var attempt by remember(attachment.url) { mutableStateOf(0) }

    LaunchedEffect(attachment.url, attempt) {
        loading = true
        error = null
        runCatching { PdfHelper.downloadAttachment(context, attachment.url, attachment.downloadName) }
            .onSuccess { file = it }
            .onFailure { error = it.message ?: "পিডিএফটি খোলা যায়নি।" }
        loading = false
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .navigationBarsPadding()
            .testTag("attachment_pdf_view"),
        contentAlignment = Alignment.Center
    ) {
        val pdfFile = file
        when {
            error != null -> Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.testTag("attachment_error")
            ) {
                Text(
                    text = error.orEmpty(),
                    fontFamily = Kalpurush,
                    color = ViewerInk,
                    fontSize = 13.sp
                )
                TextButton(onClick = { attempt += 1 }) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = null,
                        tint = ViewerInk,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(Modifier.size(6.dp))
                    Text("আবার চেষ্টা করুন", fontFamily = Kalpurush, color = ViewerInk, fontSize = 13.sp)
                }
            }
            pdfFile != null -> AndroidView(
                modifier = Modifier.fillMaxSize(),
                // One page after another, fitted to the width: the plainest thing
                // the library does. The book archive's settings sheet — fit mode,
                // night mode, book view — is deliberately not here.
                factory = { viewContext ->
                    PDFView(viewContext, null).apply {
                        setBackgroundColor(AndroidColor.TRANSPARENT)
                        post {
                            runCatching {
                                fromFile(pdfFile)
                                    .enableSwipe(true)
                                    .enableDoubletap(true)
                                    .enableAntialiasing(true)
                                    .swipeHorizontal(false)
                                    .pageFitPolicy(FitPolicy.WIDTH)
                                    .fitEachPage(true)
                                    .pageSnap(false)
                                    .spacing(12)
                                    .load()
                            }.onFailure { failure ->
                                error = failure.message ?: "পিডিএফটি খোলা যায়নি।"
                            }
                        }
                    }
                }
            )
            loading -> CircularProgressIndicator(color = ViewerInk)
        }
    }
}
