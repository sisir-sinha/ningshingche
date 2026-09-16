package com.ningshingche.app.ui.screens

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoStories
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ningshingche.app.data.model.PdfDocument
import com.ningshingche.app.ui.theme.BrandGoldLight
import com.ningshingche.app.ui.theme.BrandIndigo
import com.ningshingche.app.ui.theme.BrandIndigoDeep
import com.ningshingche.app.ui.theme.BrandOnGold
import com.ningshingche.app.ui.theme.textSize
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.theme.PanelChip
import com.ningshingche.app.ui.theme.PanelDeep
import com.ningshingche.app.ui.theme.PanelInk
import com.ningshingche.app.ui.theme.PanelInkMuted
import com.ningshingche.app.ui.viewmodel.PdfArchiveViewModel
import com.ningshingche.app.util.PdfHelper
import kotlinx.coroutines.launch

@Composable
fun PdfArchiveScreen(
    viewModel: PdfArchiveViewModel,
    onNavigateBack: () -> Unit,
    onOpenPdf: (String) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val pdfs by viewModel.filteredPdfs.collectAsState()
    val categories by viewModel.categories.collectAsState()
    val selectedCategoryId by viewModel.selectedCategoryId.collectAsState()
    val shelves = remember(pdfs) { pdfs.chunked(3).ifEmpty { listOf(emptyList()) } }

    val libraryBg = Brush.verticalGradient(
        listOf(BrandIndigo, BrandIndigoDeep, PanelDeep)
    )
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(libraryBg)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(BrandIndigo)
                .statusBarsPadding()
                .padding(bottom = 10.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(end = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onNavigateBack) {
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "পেছনে",
                        tint = PanelInk
                    )
                }
                Icon(
                    Icons.Default.AutoStories,
                    contentDescription = null,
                    tint = BrandGoldLight,
                    modifier = Modifier.size(24.dp)
                )
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        "ডিজিটাল গ্রন্থাগার",
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = textSize(20),
                        color = PanelInk,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        "নিংশিং চে মুদ্রিত সংখ্যা ও স্মারকপত্র",
                        fontFamily = Kalpurush,
                        color = PanelInkMuted,
                        fontSize = textSize(12),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
            if (categories.isNotEmpty()) {
                LazyRow(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 2.dp, bottom = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(categories, key = { it.id }) { category ->
                        val selected = category.id == selectedCategoryId
                        Text(
                            text = category.name,
                            fontFamily = Kalpurush,
                            fontSize = textSize(13),
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                            color = if (selected) BrandOnGold else PanelInk,
                            modifier = Modifier
                                .clip(RoundedCornerShape(20.dp))
                                .background(if (selected) BrandGoldLight else PanelChip)
                                .clickable { viewModel.selectCategory(category.id) }
                                .padding(horizontal = 12.dp, vertical = 6.dp)
                        )
                    }
                }
            }
        }

        LazyColumn(
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(bottom = 28.dp)
        ) {
        shelves.forEachIndexed { index, row ->
            item {
                LibraryShelf(
                    books = row,
                    shelfLabel = if (index == 0) "মূল তাক" else "তাক ${index + 1}",
                    onOpen = onOpenPdf,
                    onDownload = { doc ->
                        scope.launch {
                            Toast.makeText(context, "ডাউনলোড হচ্ছে...", Toast.LENGTH_SHORT).show()
                            val msg = PdfHelper.savePdfToDownloads(context, doc).getOrElse { "ডাউনলোড হয়নি" }
                            Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
                        }
                    }
                )
            }
        }
        }
    }
}

@Composable
private fun LibraryShelf(
    books: List<PdfDocument>,
    shelfLabel: String,
    onOpen: (String) -> Unit,
    onDownload: (PdfDocument) -> Unit
) {
    Column(Modifier.padding(bottom = 8.dp)) {
        Text(
            shelfLabel,
            fontFamily = Kalpurush,
            color = BrandGoldLight,
            fontSize = textSize(13),
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            items(books, key = { it.id }) { book ->
                LibraryBook(book, onOpen = { onOpen(book.id) }, onDownload = { onDownload(book) })
            }
        }
        Box(
            Modifier
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .fillMaxWidth()
                .height(14.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(Brush.verticalGradient(listOf(BrandIndigo, BrandIndigoDeep, PanelDeep)))
        )
    }
}

@Composable
private fun LibraryBook(
    book: PdfDocument,
    onOpen: () -> Unit,
    onDownload: () -> Unit
) {
    Column(
        modifier = Modifier
            .width(148.dp)
            .clickable(onClick = onOpen),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .width(132.dp)
                .height(176.dp)
                .shadow(10.dp, RoundedCornerShape(4.dp))
                .clip(RoundedCornerShape(4.dp))
                .background(BrandIndigo)
        ) {
            com.ningshingche.app.ui.components.PortalAsyncImage(
                url = book.coverImageUrl,
                contentDescription = book.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
            Box(
                Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(Color.Transparent, Color(0xCC0B0E14))
                        )
                    )
            )
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .width(8.dp)
                    .height(176.dp)
                    .background(Brush.horizontalGradient(listOf(Color(0x660B0E14), Color.Transparent)))
            )
            Column(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(8.dp)
            ) {
                Text(
                    if (book.year > 0) "${book.year}" else "PDF",
                    color = BrandGoldLight,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = textSize(12)
                )
                Text(
                    book.title,
                    color = PanelInk,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = textSize(13),
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(20.dp))
                    .background(BrandGoldLight)
                    .clickable(onClick = onOpen)
                    .padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.MenuBook, null, tint = BrandOnGold, modifier = Modifier.size(12.dp))
                Text(" পাকরিক", color = BrandOnGold, fontFamily = Kalpurush, fontSize = textSize(12), fontWeight = FontWeight.Bold)
            }
            Icon(
                Icons.Default.Download,
                contentDescription = "ডাউনলোড",
                tint = BrandGoldLight,
                modifier = Modifier
                    .size(20.dp)
                    .clickable(onClick = onDownload)
            )
        }
    }
}
