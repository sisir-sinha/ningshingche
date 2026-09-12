package com.ningshingche.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.AutoStories
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Celebration
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonPin
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Science
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.ningshingche.app.R
import com.ningshingche.app.data.model.Article
import com.ningshingche.app.data.model.ArticleCitation
import com.ningshingche.app.data.model.PdfDocument
import com.ningshingche.app.data.repository.NinghsingCheContentData
import com.ningshingche.app.ui.theme.Kalpurush

/**
 * Returns a dedicated Google Material Icon for each category.
 */
fun getCategoryIcon(categorySlug: String): ImageVector {
    return when (categorySlug.trim().lowercase().replace(Regex("\\s+"), "-")) {
        "history-heritage", "history", "heritage", "ইতিহাস" -> Icons.Default.AccountBalance
        "literature-poetry", "literature", "poetry", "সাহিত্য", "কবিতা" -> Icons.Default.AutoStories
        "language-grammar", "language", "grammar", "ইমার-ঠারর-এলা" -> Icons.Default.Translate
        "culture-festivals", "culture", "festivals", "সংস্কৃতি" -> Icons.Default.Celebration
        "society-philosophy", "society", "philosophy", "society-culture", "সমাজ-ও-সংস্কৃতি" -> Icons.Default.Psychology
        "arts-drama", "art", "arts", "drama" -> Icons.Default.Palette
        "research-essays", "research", "essays", "reviews", "পর্যালোচনা" -> Icons.Default.Science
        "biography-memoirs", "biography", "memoirs", "reminiscence", "জীবনী", "স্মৃতিচারণ" -> Icons.Default.PersonPin
        "editorial", "preface", "সম্পাদকীয়", "ভুমিকা" -> Icons.Default.EditNote
        "mythology", "religion", "পৌরাণিক-কাহিনী", "ধর্ম" -> Icons.Default.AccountBalance
        "science-technology", "বিজ্ঞান-ও-প্রযুক্তি" -> Icons.Default.Science
        "news", "misc", "পৌ", "রকমারি" -> Icons.AutoMirrored.Filled.MenuBook
        else -> Icons.AutoMirrored.Filled.MenuBook
    }
}

/**
 * Icon for a category row. Prefers the Font Awesome `icon_name` chosen in the
 * dashboard (e.g. `book-open`, `landmark`), falling back to [getCategoryIcon]
 * keyed by the category title or slug.
 */
fun categoryIconFor(iconName: String?, titleOrSlug: String): ImageVector {
    return when (iconName?.trim()?.lowercase()?.removePrefix("fa-")) {
        "landmark", "monument", "building-columns" -> Icons.Default.AccountBalance
        "language", "globe" -> Icons.Default.Translate
        "feather", "feather-pointed", "pen-fancy" -> Icons.Default.AutoStories
        "address-card", "id-card", "user" -> Icons.Default.PersonPin
        "hands-praying", "place-of-worship", "om" -> Icons.Default.AccountBalance
        "magnifying-glass", "search" -> Icons.Default.Science
        "dragon", "wand-magic-sparkles", "hat-wizard" -> Icons.Default.Psychology
        "microchip", "flask", "atom", "laptop-code" -> Icons.Default.Science
        "circle-info", "info" -> Icons.Default.EditNote
        "shapes", "layer-group", "icons" -> Icons.AutoMirrored.Filled.MenuBook
        "people-group", "users", "people-roof" -> Icons.Default.Psychology
        "pen-nib", "pen", "pen-to-square" -> Icons.Default.EditNote
        "masks-theater", "palette", "music" -> Icons.Default.Celebration
        "book-open", "book", "book-open-reader" -> Icons.Default.AutoStories
        "clock-rotate-left", "history", "hourglass" -> Icons.Default.PersonPin
        "newspaper" -> Icons.AutoMirrored.Filled.MenuBook
        else -> getCategoryIcon(titleOrSlug)
    }
}

/**
 * Modern Brand Logo component supporting local vector asset and remote logo loading.
 */
@Composable
fun NingshingCheBrandLogo(
    modifier: Modifier = Modifier,
    size: Dp = 40.dp
) {
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = modifier
            .size(size)
            .testTag("ningshingche_brand_logo")
    ) {
        AsyncImage(
            model = ImageRequest.Builder(LocalContext.current)
                .data(NinghsingCheContentData.APP_LOGO_URL)
                .crossfade(true)
                .error(R.drawable.ic_ningshingche_logo)
                .fallback(R.drawable.ic_ningshingche_logo)
                .placeholder(R.drawable.ic_ningshingche_logo)
                .build(),
            contentDescription = "Ningshing Che Logo",
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxSize()
                .padding(4.dp)
        )
    }
}




/**
 * Compact article card used by list pages.
 *
 * @param isBookmarked when non-null a save/bookmark toggle is shown on the
 *   right edge; tapping it calls [onBookmarkClick] without opening the article.
 */
@Composable
fun ArticleListItemCard(
    article: Article,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    isBookmarked: Boolean? = null,
    onBookmarkClick: (() -> Unit)? = null
) {
    // Explicit parameters win; otherwise pick up the app-wide controller.
    val shared = if (isBookmarked == null) rememberBookmarkStateFor(article.id) else null
    val saved = isBookmarked ?: shared?.first
    val onToggle = onBookmarkClick ?: shared?.second
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        shadowElevation = 1.dp,
        modifier = modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .testTag("article_item_${article.id}")
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            PortalAsyncImage(
                url = article.featuredImageUrl,
                contentDescription = article.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .size(76.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.primaryContainer)
            )

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Icon(
                        imageVector = getCategoryIcon(article.categorySlug),
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(12.dp)
                    )
                    Text(
                        text = article.category,
                        style = MaterialTheme.typography.labelSmall.copy(
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.Bold,
                            fontSize = 10.sp
                        )
                    )
                    Text(
                        text = "•",
                        style = MaterialTheme.typography.labelSmall.copy(color = MaterialTheme.colorScheme.onSurfaceVariant)
                    )
                    Icon(
                        imageVector = Icons.Default.AccessTime,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(11.dp)
                    )
                    Text(
                        text = "${article.readingTimeMinutes} মি.",
                        style = MaterialTheme.typography.labelSmall.copy(
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 10.sp
                        )
                    )
                }

                Text(
                    text = article.title,
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                        fontSize = 14.sp,
                        lineHeight = 20.sp
                    ),
                    maxLines = 2,
                    minLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Person,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(12.dp)
                    )
                    Text(
                        text = "${article.authorName} • ${article.publishedDate}",
                        style = MaterialTheme.typography.bodySmall.copy(
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 11.sp
                        ),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }

            if (saved != null && onToggle != null) {
                BookmarkToggleButton(
                    isBookmarked = saved,
                    onClick = onToggle,
                    modifier = Modifier.testTag("bookmark_toggle_${article.id}")
                )
            }
        }
    }
}

/** Save / unsave toggle shown on article cards (filled = saved). */
@Composable
fun BookmarkToggleButton(
    isBookmarked: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.primary
) {
    IconButton(onClick = onClick, modifier = modifier.size(36.dp)) {
        Icon(
            imageVector = if (isBookmarked) Icons.Default.Bookmark else Icons.Default.BookmarkBorder,
            contentDescription = if (isBookmarked) "সংরক্ষণ বাতিল করুন" else "সংরক্ষণ করুন",
            tint = if (isBookmarked) tint else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(22.dp)
        )
    }
}





@Composable
fun AiSourceCitationCard(
    citation: com.ningshingche.app.data.model.ArticleCitation,
    onClick: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.size(32.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.MenuBook,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = citation.title,
                    style = MaterialTheme.typography.titleSmall.copy(
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                        fontSize = 13.sp
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "${citation.author} • ${citation.category}",
                    style = MaterialTheme.typography.bodySmall.copy(
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 11.sp
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}

