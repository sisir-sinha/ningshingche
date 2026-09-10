@file:OptIn(ExperimentalMaterial3Api::class)

package com.ningshingche.app.ui.screens

import android.app.Activity
import android.graphics.Color as AndroidColor
import android.view.WindowManager
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.ViewDay
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.github.barteksc.pdfviewer.PDFView
import com.github.barteksc.pdfviewer.scroll.DefaultScrollHandle
import com.github.barteksc.pdfviewer.util.FitPolicy
import com.ningshingche.app.data.model.PdfFitMode
import com.ningshingche.app.data.model.PdfReaderSettings
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.PortalSaffron
import com.ningshingche.app.ui.viewmodel.PdfViewerViewModel
import java.io.File

private val ReaderCanvas = Color(0xFF1A1410)
private val ReaderBar = Color(0xFF241A16)
private val PagePaper = Color(0xFFFFFBF5)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PdfViewerScreen(
    pdfId: String,
    viewModel: PdfViewerViewModel,
    onNavigateBack: () -> Unit
) {
    val context = LocalContext.current
    val activity = context as? Activity

    LaunchedEffect(pdfId) { viewModel.loadPdf(pdfId) }

    val pdfDocument by viewModel.pdfDocument.collectAsState()
    val pageCount by viewModel.pageCount.collectAsState()
    val currentPage by viewModel.currentPage.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val errorMessage by viewModel.errorMessage.collectAsState()
    val downloadStatus by viewModel.downloadStatus.collectAsState()
    val localFile by viewModel.localFile.collectAsState()
    val settings by viewModel.readerSettings.collectAsState()

    LaunchedEffect(downloadStatus) {
        downloadStatus?.let { msg ->
            Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
            viewModel.clearStatus()
        }
    }

    DisposableEffect(settings.keepScreenOn) {
        val window = activity?.window
        if (settings.keepScreenOn) {
            window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        onDispose {
            window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    var showSettings by remember { mutableStateOf(false) }
    var pdfViewRef by remember { mutableStateOf<PDFView?>(null) }

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
                Text(subtitle, fontFamily = Kalpurush, color = PortalSaffron, fontSize = 12.sp)
            }
            IconButton(onClick = { showSettings = true }, enabled = localFile != null) {
                Icon(Icons.Default.Settings, contentDescription = "সেটিংস", tint = PortalSaffron)
            }
            IconButton(onClick = { viewModel.openExternally() }, enabled = localFile != null) {
                Icon(Icons.Default.OpenInNew, contentDescription = "অন্য অ্যাপে খুলুন", tint = PortalSaffron)
            }
            IconButton(onClick = { viewModel.sharePdf() }, enabled = localFile != null) {
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
                errorMessage != null && localFile == null -> Column(
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
                localFile != null -> {
                    BookPdfCanvas(
                        file = localFile!!,
                        settings = settings,
                        startPage = currentPage,
                        onReady = { pdfViewRef = it },
                        onLoad = viewModel::onDocumentLoaded,
                        onPage = viewModel::onPageChanged,
                        onError = { viewModel.onViewerError(it.message ?: "পিডিএফ খোলা যায়নি।") }
                    )
                    if (settings.bookView && pageCount > 1) {
                        IconButton(
                            onClick = { pdfViewRef?.jumpTo((currentPage - 1).coerceAtLeast(0), true) },
                            enabled = currentPage > 0,
                            modifier = Modifier
                                .align(Alignment.CenterStart)
                                .padding(start = 4.dp)
                                .size(40.dp)
                                .clip(CircleShape)
                                .background(Color(0x66000000))
                        ) {
                            Icon(Icons.Default.ChevronLeft, "আগের পৃষ্ঠা", tint = Color.White)
                        }
                        IconButton(
                            onClick = { pdfViewRef?.jumpTo((currentPage + 1).coerceAtMost(pageCount - 1), true) },
                            enabled = currentPage < pageCount - 1,
                            modifier = Modifier
                                .align(Alignment.CenterEnd)
                                .padding(end = 4.dp)
                                .size(40.dp)
                                .clip(CircleShape)
                                .background(Color(0x66000000))
                        ) {
                            Icon(Icons.Default.ChevronRight, "পরের পৃষ্ঠা", tint = Color.White)
                        }
                    }
                    if (isLoading) {
                        CircularProgressIndicator(
                            color = PortalSaffron,
                            strokeWidth = 2.dp,
                            modifier = Modifier.align(Alignment.Center)
                        )
                    }
                }
                else -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = PortalSaffron, strokeWidth = 2.dp)
                    Spacer(Modifier.height(12.dp))
                    Text("পিডিএফ খোলা হচ্ছে…", fontFamily = Kalpurush, color = Color(0xFFFFF3D6), fontSize = 14.sp)
                }
            }
        }

        if (pageCount > 0) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ReaderBar)
                    .navigationBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                if (pageCount > 1) {
                    Slider(
                        value = currentPage.toFloat(),
                        onValueChange = { value ->
                            pdfViewRef?.jumpTo(value.toInt().coerceIn(0, pageCount - 1), false)
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
                    text = if (settings.bookView) {
                        "বই দৃশ্য  ·  সোয়াইপ করে পাতা উল্টান"
                    } else {
                        "স্ক্রল দৃশ্য  ·  চিমটি করে জুম"
                    },
                    fontFamily = Kalpurush,
                    color = Color(0xCCFFF3D6),
                    fontSize = 11.sp,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }

    if (showSettings) {
        ModalBottomSheet(
            onDismissRequest = { showSettings = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = ReaderBar,
            contentColor = Color(0xFFFFF3D6)
        ) {
            PdfReaderSettingsSheet(
                settings = settings,
                pageCount = pageCount,
                currentPage = currentPage,
                onChange = viewModel::updateSettings,
                onJump = { page ->
                    pdfViewRef?.jumpTo(page.coerceIn(0, (pageCount - 1).coerceAtLeast(0)), true)
                },
                onClose = { showSettings = false }
            )
        }
    }
}

@Composable
private fun BookPdfCanvas(
    file: File,
    settings: PdfReaderSettings,
    startPage: Int,
    onReady: (PDFView) -> Unit,
    onLoad: (Int) -> Unit,
    onPage: (Int, Int) -> Unit,
    onError: (Throwable) -> Unit
) {
    val bookPad = if (settings.bookView) 14.dp else 0.dp
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = bookPad, vertical = bookPad)
            .then(
                if (settings.bookView) {
                    Modifier
                        .shadow(18.dp, RoundedCornerShape(10.dp))
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (settings.nightMode) Color(0xFF121212) else PagePaper)
                } else Modifier
            )
    ) {
        keyForReload(file, settings, startPage) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    PDFView(ctx, null).apply {
                        setBackgroundColor(
                            if (settings.nightMode) AndroidColor.parseColor("#121212")
                            else AndroidColor.parseColor("#1A1410")
                        )
                        onReady(this)
                        post {
                            runCatching {
                                bindPdf(
                                    view = this,
                                    file = file,
                                    settings = settings,
                                    startPage = startPage,
                                    onLoad = onLoad,
                                    onPage = onPage,
                                    onError = onError
                                )
                            }.onFailure(onError)
                        }
                    }
                },
                onRelease = { view ->
                    runCatching { view.recycle() }
                }
            )
        }
    }
}

@Composable
private fun keyForReload(
    file: File,
    settings: PdfReaderSettings,
    startPage: Int,
    content: @Composable () -> Unit
) {
    androidx.compose.runtime.key(
        file.absolutePath,
        settings.bookView,
        settings.nightMode,
        settings.snapPages,
        settings.doubleTapZoom,
        settings.annotations,
        settings.scrollHandle,
        settings.spacingDp,
        settings.fitMode,
        startPage < 0
    ) { content() }
}

private fun bindPdf(
    view: PDFView,
    file: File,
    settings: PdfReaderSettings,
    startPage: Int,
    onLoad: (Int) -> Unit,
    onPage: (Int, Int) -> Unit,
    onError: (Throwable) -> Unit
) {
    val fit = when (settings.fitMode) {
        PdfFitMode.WIDTH -> FitPolicy.WIDTH
        PdfFitMode.HEIGHT -> FitPolicy.HEIGHT
        PdfFitMode.BOTH -> FitPolicy.BOTH
    }
    val book = settings.bookView
    val configurator = view.fromFile(file)
        .enableSwipe(true)
        .swipeHorizontal(book)
        .enableDoubletap(settings.doubleTapZoom)
        .defaultPage(startPage.coerceAtLeast(0))
        .onLoad { pages -> onLoad(pages) }
        .onPageChange { page, count -> onPage(page, count) }
        .onError { error -> onError(error) }
        .enableAnnotationRendering(settings.annotations)
        .enableAntialiasing(true)
        .spacing(if (book) 0 else settings.spacingDp)
        .autoSpacing(book)
        .pageFitPolicy(fit)
        .fitEachPage(book)
        .pageSnap(book || settings.snapPages)
        .pageFling(book)
        .nightMode(settings.nightMode)
    if (settings.scrollHandle) {
        configurator.scrollHandle(DefaultScrollHandle(view.context))
    }
    configurator.load()
}

@Composable
private fun PdfReaderSettingsSheet(
    settings: PdfReaderSettings,
    pageCount: Int,
    currentPage: Int,
    onChange: (PdfReaderSettings) -> Unit,
    onJump: (Int) -> Unit,
    onClose: () -> Unit
) {
    var jump by remember(currentPage) { mutableStateOf((currentPage + 1).toString()) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 20.dp)
            .padding(bottom = 24.dp)
            .verticalScroll(rememberScrollState())
    ) {
        Text("পাঠকের সেটিংস", fontFamily = Kalpurush, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Spacer(Modifier.height(14.dp))
        Text("দৃশ্য", fontFamily = Kalpurush, color = PortalSaffron, fontSize = 13.sp)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ModeChip(
                selected = settings.bookView,
                icon = Icons.Default.MenuBook,
                label = "বই"
            ) { onChange(settings.copy(bookView = true)) }
            ModeChip(
                selected = !settings.bookView,
                icon = Icons.Default.ViewDay,
                label = "স্ক্রল"
            ) { onChange(settings.copy(bookView = false)) }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            if (settings.bookView) "এক পাতায় একটি পৃষ্ঠা। বাঁদিকে/ডানদিকে সোয়াইপ করলে পাতা উল্টে।"
            else "উপর-নিচ স্ক্রল করে পুরো বই পড়ুন।",
            fontFamily = Kalpurush,
            color = Color(0xCCFFF3D6),
            fontSize = 12.sp
        )
        Spacer(Modifier.height(16.dp))
        HorizontalDivider(color = Color(0x335A4034))
        Spacer(Modifier.height(12.dp))
        SettingSwitch("রাতের মোড", settings.nightMode) { onChange(settings.copy(nightMode = it)) }
        SettingSwitch("পাতা স্ন্যাপ", settings.snapPages) { onChange(settings.copy(snapPages = it)) }
        SettingSwitch("দুবার ট্যাপে জুম", settings.doubleTapZoom) { onChange(settings.copy(doubleTapZoom = it)) }
        SettingSwitch("অ্যানোটেশন দেখান", settings.annotations) { onChange(settings.copy(annotations = it)) }
        SettingSwitch("স্ক্রল হ্যান্ডেল", settings.scrollHandle) { onChange(settings.copy(scrollHandle = it)) }
        SettingSwitch("স্ক্রিন জ্বালিয়ে রাখুন", settings.keepScreenOn) { onChange(settings.copy(keepScreenOn = it)) }
        Spacer(Modifier.height(8.dp))
        Text("ফ্রেমে মিল", fontFamily = Kalpurush, color = PortalSaffron, fontSize = 13.sp)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FitChip("প্রস্থ", settings.fitMode == PdfFitMode.WIDTH) { onChange(settings.copy(fitMode = PdfFitMode.WIDTH)) }
            FitChip("উচ্চতা", settings.fitMode == PdfFitMode.HEIGHT) { onChange(settings.copy(fitMode = PdfFitMode.HEIGHT)) }
            FitChip("দুটোই", settings.fitMode == PdfFitMode.BOTH) { onChange(settings.copy(fitMode = PdfFitMode.BOTH)) }
        }
        if (!settings.bookView) {
            Spacer(Modifier.height(12.dp))
            Text("পাতার ফাঁক  ·  ${settings.spacingDp} dp", fontFamily = Kalpurush, fontSize = 13.sp)
            Slider(
                value = settings.spacingDp.toFloat(),
                onValueChange = { onChange(settings.copy(spacingDp = it.toInt())) },
                valueRange = 0f..32f,
                colors = SliderDefaults.colors(
                    thumbColor = PortalSaffron,
                    activeTrackColor = PortalSaffron,
                    inactiveTrackColor = Color(0xFF5A4034)
                )
            )
        }
        if (pageCount > 1) {
            Spacer(Modifier.height(8.dp))
            Text("পৃষ্ঠায় যান", fontFamily = Kalpurush, color = PortalSaffron, fontSize = 13.sp)
            Row(verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.material3.OutlinedTextField(
                    value = jump,
                    onValueChange = { jump = it.filter { ch -> ch.isDigit() }.take(5) },
                    singleLine = true,
                    modifier = Modifier.width(120.dp),
                    label = { Text("১–$pageCount", fontFamily = Kalpurush) }
                )
                Spacer(Modifier.width(12.dp))
                TextButton(onClick = {
                    val page = (jump.toIntOrNull() ?: (currentPage + 1)) - 1
                    onJump(page)
                }) {
                    Text("যান", fontFamily = Kalpurush, color = PortalSaffron)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onClose, modifier = Modifier.align(Alignment.End)) {
            Text("বন্ধ", fontFamily = Kalpurush, color = PortalSaffron)
        }
    }
}

@Composable
private fun ModeChip(
    selected: Boolean,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label, fontFamily = Kalpurush) },
        leadingIcon = { Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp)) },
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = PortalSaffron.copy(alpha = 0.22f),
            selectedLabelColor = Color(0xFFFFF3D6),
            selectedLeadingIconColor = PortalSaffron
        )
    )
}

@Composable
private fun FitChip(label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label, fontFamily = Kalpurush) },
        colors = FilterChipDefaults.filterChipColors(
            selectedContainerColor = PortalSaffron.copy(alpha = 0.22f),
            selectedLabelColor = Color(0xFFFFF3D6)
        )
    )
}

@Composable
private fun SettingSwitch(label: String, checked: Boolean, onChecked: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, fontFamily = Kalpurush, fontSize = 15.sp, modifier = Modifier.weight(1f))
        Switch(
            checked = checked,
            onCheckedChange = onChecked,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = PortalSaffron
            )
        )
    }
}
