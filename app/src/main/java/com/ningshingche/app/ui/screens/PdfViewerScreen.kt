package com.ningshingche.app.ui.screens

import android.graphics.Bitmap
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.PortalSaffron
import com.ningshingche.app.ui.viewmodel.PdfViewerViewModel
import kotlinx.coroutines.launch

private val ReaderCanvas = Color(0xFF1A1410)
private val ReaderBar = Color(0xFF241A16)
private val PagePaper = Color(0xFFFFFBF5)

@Composable
fun PdfViewerScreen(
    pdfId: String,
    viewModel: PdfViewerViewModel,
    onNavigateBack: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    LaunchedEffect(pdfId) { viewModel.loadPdf(pdfId) }

    val pdfDocument by viewModel.pdfDocument.collectAsState()
    val pageCount by viewModel.pageCount.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val errorMessage by viewModel.errorMessage.collectAsState()
    val downloadStatus by viewModel.downloadStatus.collectAsState()

    LaunchedEffect(downloadStatus) {
        downloadStatus?.let { msg ->
            Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
            viewModel.clearStatus()
        }
    }

    val listState = rememberLazyListState()
    val currentPage by remember {
        derivedStateOf { listState.firstVisibleItemIndex.coerceAtLeast(0) }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ReaderCanvas)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(ReaderBar)
                .padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onNavigateBack, modifier = Modifier.testTag("pdf_viewer_back_button")) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "পেছনে", tint = Color(0xFFFFF3D6))
            }
            Column(Modifier.weight(1f)) {
                Text(
                    pdfDocument?.title ?: "গ্রন্থাগার",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFFFFF3D6),
                    fontSize = 16.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                val subtitle = when {
                    pageCount > 0 -> "পৃষ্ঠা ${currentPage + 1} / $pageCount"
                    !pdfDocument?.edition.isNullOrBlank() -> pdfDocument?.edition.orEmpty()
                    else -> "পিডিএফ পাঠক"
                }
                Text(
                    subtitle,
                    fontFamily = Kalpurush,
                    color = PortalSaffron,
                    fontSize = 12.sp
                )
            }
            IconButton(
                onClick = { viewModel.openExternally() },
                enabled = pageCount > 0
            ) {
                Icon(Icons.Default.OpenInNew, contentDescription = "অন্য অ্যাপে খুলুন", tint = PortalSaffron)
            }
            IconButton(onClick = { viewModel.sharePdf() }, enabled = pageCount > 0) {
                Icon(Icons.Default.Share, contentDescription = "শেয়ার", tint = PortalSaffron)
            }
            IconButton(onClick = { viewModel.downloadPdf() }, enabled = pdfDocument != null) {
                Icon(Icons.Default.Download, contentDescription = "ডাউনলোড", tint = PortalSaffron)
            }
        }

        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentAlignment = Alignment.Center
        ) {
            when {
                isLoading -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = PortalSaffron, strokeWidth = 2.dp)
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "পিডিএফ খোলা হচ্ছে…",
                        fontFamily = Kalpurush,
                        color = Color(0xFFFFF3D6),
                        fontSize = 14.sp
                    )
                }
                errorMessage != null -> Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.padding(32.dp)
                ) {
                    Icon(Icons.Default.PictureAsPdf, null, tint = PortalSaffron, modifier = Modifier.size(56.dp))
                    Spacer(Modifier.height(12.dp))
                    Text(
                        errorMessage ?: "বইটি খোলা যায়নি",
                        fontFamily = Kalpurush,
                        color = Color(0xFFFFF3D6),
                        fontSize = 15.sp
                    )
                    TextButton(onClick = { viewModel.loadPdf(pdfId) }) {
                        Text("আবার চেষ্টা করুন", fontFamily = Kalpurush, color = PortalSaffron)
                    }
                }
                pageCount > 0 -> {
                    val context = LocalContext.current
                    val pageWidthPx = context.resources.displayMetrics.widthPixels.coerceAtLeast(720)
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(pageCount, key = { it }) { index ->
                            PdfPageCard(
                                pageIndex = index,
                                pageCount = pageCount,
                                widthPx = pageWidthPx,
                                viewModel = viewModel
                            )
                        }
                    }
                }
            }
        }

        if (pageCount > 0) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ReaderBar)
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                if (pageCount > 1) {
                    Slider(
                        value = currentPage.toFloat(),
                        onValueChange = { value ->
                            scope.launch { listState.scrollToItem(value.toInt().coerceIn(0, pageCount - 1)) }
                        },
                        valueRange = 0f..(pageCount - 1).toFloat(),
                        steps = (pageCount - 2).coerceAtLeast(0),
                        colors = SliderDefaults.colors(
                            thumbColor = PortalSaffron,
                            activeTrackColor = PortalSaffron,
                            inactiveTrackColor = Color(0xFF5A4034)
                        )
                    )
                }
                Text(
                    "পৃষ্ঠা ${currentPage + 1} / $pageCount  ·  চিমটি করে জুম, দুবার ট্যাপ করে বড়",
                    fontFamily = Kalpurush,
                    color = Color(0xCCFFF3D6),
                    fontSize = 11.sp,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun PdfPageCard(
    pageIndex: Int,
    pageCount: Int,
    widthPx: Int,
    viewModel: PdfViewerViewModel
) {
    var bitmap by remember(pageIndex, widthPx) { mutableStateOf<Bitmap?>(null) }
    var scale by remember(pageIndex) { mutableFloatStateOf(1f) }
    var offsetX by remember(pageIndex) { mutableFloatStateOf(0f) }
    var offsetY by remember(pageIndex) { mutableFloatStateOf(0f) }

    LaunchedEffect(pageIndex, widthPx) {
        bitmap = viewModel.renderPage(pageIndex, widthPx)
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .shadow(8.dp, RoundedCornerShape(6.dp))
            .clip(RoundedCornerShape(6.dp))
            .background(PagePaper)
            .pointerInput(pageIndex) {
                detectTransformGestures { _, pan, zoom, _ ->
                    scale = (scale * zoom).coerceIn(1f, 4f)
                    if (scale > 1f) {
                        offsetX += pan.x
                        offsetY += pan.y
                    } else {
                        offsetX = 0f
                        offsetY = 0f
                    }
                }
            }
            .pointerInput(pageIndex) {
                detectTapGestures(
                    onDoubleTap = {
                        if (scale > 1.15f) {
                            scale = 1f
                            offsetX = 0f
                            offsetY = 0f
                        } else {
                            scale = 2.2f
                        }
                    }
                )
            }
    ) {
        val page = bitmap
        if (page != null) {
            Image(
                bitmap = page.asImageBitmap(),
                contentDescription = "পৃষ্ঠা ${pageIndex + 1} / $pageCount",
                contentScale = ContentScale.FillWidth,
                modifier = Modifier
                    .fillMaxWidth()
                    .graphicsLayer(
                        scaleX = scale,
                        scaleY = scale,
                        translationX = offsetX,
                        translationY = offsetY
                    )
            )
        } else {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(420.dp),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = PortalSaffron, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
            }
        }
    }
}
