package com.ningshingche.app.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf

/**
 * Saved-article state shared with every article card in the composition.
 *
 * Cards (`ArticleRow`, `ArticleListItemCard`) read [LocalBookmarkController]
 * and render a save toggle when a controller is installed, so a screen does
 * not have to thread bookmark callbacks through every list. The controller is
 * provided once at the app root from `SavedArticlesViewModel`.
 */
@Stable
class BookmarkController(
    val savedIds: Set<String>,
    val onToggle: (String) -> Unit
) {
    fun isSaved(articleId: String): Boolean = articleId in savedIds
}

val LocalBookmarkController = compositionLocalOf<BookmarkController?> { null }

/** Convenience for cards: `(isSaved, toggle)` or `null` when no controller is installed. */
@Composable
fun rememberBookmarkStateFor(articleId: String): Pair<Boolean, () -> Unit>? {
    val controller = LocalBookmarkController.current ?: return null
    return controller.isSaved(articleId) to { controller.onToggle(articleId) }
}
