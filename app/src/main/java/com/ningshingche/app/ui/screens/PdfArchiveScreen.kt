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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ningshingche.app.R
import com.ningshingche.app.data.model.PdfDocument
import com.ningshingche.app.ui.components.PortalAsyncImage
import com.ningshingche.app.ui.editorial.EditorialShape
import com.ningshingche.app.ui.editorial.EditorialSpace
import com.ningshingche.app.ui.editorial.EditorialType
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.i18n.t
import com.ningshingche.app.ui.i18n.tNow
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
    val books by viewModel.pdfDocuments.collectAsState()
    var query by rememberSaveable { mutableStateOf("") }
    val sections = remember(books, query) { librarySections(books, query) }
    val tokens = LocalEditorialTokens.current
    val keyboard = LocalSoftwareKeyboardController.current

    Column(Modifier.fillMaxSize().background(tokens.paper)) {
        Row(
            modifier = Modifier.fillMaxWidth().statusBarsPadding().padding(end = EditorialSpace.gutter),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onNavigateBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = t("পেছনে"), tint = tokens.ink)
            }
            Text(t("ডিজিটাল গ্রন্থাগার"), style = EditorialType.Headline, color = tokens.ink,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        TextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier.fillMaxWidth().padding(horizontal = EditorialSpace.gutter)
                .padding(top = EditorialSpace.xs, bottom = EditorialSpace.sm).testTag("library_search"),
            singleLine = true,
            textStyle = EditorialType.Body,
            placeholder = { Text(t("বই খুঁজুন..."), style = EditorialType.Body, color = tokens.inkMuted) },
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = tokens.inkMuted) },
            trailingIcon = {
                if (query.isNotEmpty()) IconButton(onClick = { query = "" }) {
                    Icon(Icons.Default.Close, contentDescription = t("মুছুন"), tint = tokens.inkMuted)
                }
            },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
            shape = RoundedCornerShape(EditorialShape.card),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = tokens.surfaceSunken,
                unfocusedContainerColor = tokens.surfaceSunken,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent
            )
        )
        if (sections.isEmpty()) {
            Text(
                if (query.isBlank()) t("এখনো কোনো বই নেই।") else t("কোনো বই পাওয়া যায়নি।"),
                style = EditorialType.Body, color = tokens.inkMuted,
                modifier = Modifier.padding(EditorialSpace.gutter).testTag("library_empty")
            )
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f).testTag("library_sections"),
                contentPadding = PaddingValues(bottom = EditorialSpace.xl),
                verticalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
            ) {
                items(sections, key = { it.key }) { section ->
                    LibrarySectionRow(section, onOpenPdf) { doc ->
                        scope.launch {
                            Toast.makeText(context, tNow("ডাউনলোড হচ্ছে..."), Toast.LENGTH_SHORT).show()
                            val message = PdfHelper.savePdfToDownloads(context, doc)
                                .getOrElse { tNow("ডাউনলোড হয়নি") }
                            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun LibrarySectionRow(section: LibrarySection, onOpen: (String) -> Unit, onDownload: (PdfDocument) -> Unit) {
    var expanded by rememberSaveable(section.key) { mutableStateOf(false) }
    val tokens = LocalEditorialTokens.current
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = EditorialSpace.gutter)
                .padding(top = EditorialSpace.md, bottom = EditorialSpace.sm),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (section.isNingshingChe) {
                Icon(painterResource(R.drawable.ic_verified_badge), contentDescription = t("যাচাইকৃত"),
                    tint = Color.Unspecified, modifier = Modifier.size(18.dp).testTag("library_official_badge"))
                Spacer(Modifier.width(6.dp))
            }
            Text(
                if (section.title.isBlank()) t("অন্যান্য") else section.title,
                style = EditorialType.Headline, color = tokens.ink,
                maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f)
            )
            if (section.books.size > LIBRARY_PREVIEW_COUNT) {
                Row(
                    modifier = Modifier.clip(RoundedCornerShape(EditorialShape.chip))
                        .clickable { expanded = !expanded }.padding(start = 8.dp, top = 8.dp, bottom = 8.dp)
                        .testTag("library_more_${section.key}"),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(if (expanded) t("কম দেখান") else t("আরও দেখুন"),
                        style = EditorialType.Subtitle, color = tokens.accent, maxLines = 1)
                    if (!expanded) Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null,
                        tint = tokens.accent, modifier = Modifier.padding(start = 4.dp).size(16.dp))
                }
            }
        }
        val visible = if (expanded) section.books else section.books.take(LIBRARY_PREVIEW_COUNT)
        LazyRow(
            contentPadding = PaddingValues(horizontal = EditorialSpace.gutter),
            horizontalArrangement = Arrangement.spacedBy(EditorialSpace.md),
            modifier = Modifier.testTag("library_row_${section.key}")
        ) {
            items(visible, key = { it.id }) { book ->
                LibraryBook(book, onOpen = { onOpen(book.id) }, onDownload = { onDownload(book) })
            }
        }
    }
}

@Composable
private fun LibraryBook(book: PdfDocument, onOpen: () -> Unit, onDownload: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Card(
        onClick = onOpen,
        shape = RoundedCornerShape(EditorialShape.card),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.width(148.dp).testTag("library_book_${book.id}")
    ) {
        Column {
            PortalAsyncImage(
                url = book.coverImageUrl, contentDescription = book.title, contentScale = ContentScale.FillBounds,
                modifier = Modifier.fillMaxWidth().height(190.dp).padding(EditorialSpace.sm)
                    .clip(RoundedCornerShape(EditorialShape.thumb))
            )
            Column(Modifier.padding(horizontal = EditorialSpace.md)) {
                Text(book.title, style = EditorialType.Subtitle, color = tokens.ink,
                    maxLines = 2, minLines = 2, overflow = TextOverflow.Ellipsis)
                if (book.edition.isNotBlank()) Text(book.edition, style = EditorialType.Caption,
                    color = tokens.inkMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                IconButton(onClick = onDownload) {
                    Icon(Icons.Default.Download, contentDescription = t("ডাউনলোড"), tint = tokens.accent)
                }
            }
        }
    }
}
