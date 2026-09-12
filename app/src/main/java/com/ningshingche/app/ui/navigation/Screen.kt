package com.ningshingche.app.ui.navigation

/**
 * Tabs of the "অন্বেষণ ও সংগ্রহ" (Explore) screen. The `key` is what goes into
 * the navigation route, so it must stay URL-safe and stable.
 */
enum class ExploreTab(val key: String, val title: String) {
    Categories("categories", "বিভাগসমূহ"),
    Authors("authors", "লেখকবৃন্দ"),
    Issues("issues", "বার্ষিক সংখ্যা"),
    Popular("popular", "জনপ্রিয় ও নির্বাচিত");

    companion object {
        fun fromKey(key: String?): ExploreTab = entries.firstOrNull { it.key == key } ?: Categories
    }
}

sealed class Screen(val route: String) {
    data object Home : Screen("home")
    data object Search : Screen("search")
    data object Bookmarks : Screen("bookmarks")
    data object AiAssistant : Screen("ai_assistant")
    data object Settings : Screen("settings")
    data object Login : Screen("login")
    data object UserDashboard : Screen("user_dashboard")
    data object UserProfile : Screen("user_profile")
    data object NewArticle : Screen("new_article")
    data object NewMusic : Screen("new_music")
    data object PdfArchive : Screen("pdf_archive")
    data object Music : Screen("music")
    data object MusicGenre : Screen("music_genre/{name}") {
    }
    data object MusicArtist : Screen("music_artist/{name}") {
    }
    data object MusicAlbum : Screen("music_album/{name}") {
    }
    data object Featured : Screen("featured")
    data object About : Screen("about")
    /** The reader forum: rooms, threads and replies (migration 029). */
    data object Forum : Screen("forum")
    data object Contributors : Screen("contributors")
    data object AuthorsDirectory : Screen("authors_directory")

    /** `explore?tab=<key>`; `route` (no argument) opens the first tab. */
    data object Explore : Screen("explore") {
        const val pattern = "explore?tab={tab}"
    }

    data object PdfViewer : Screen("pdf_viewer/{pdfId}") {
    }

    data object ArticleDetail : Screen("article/{articleId}") {
    }
}
