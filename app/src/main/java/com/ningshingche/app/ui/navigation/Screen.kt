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
        fun createRoute(name: String) = "music_genre/${java.net.URLEncoder.encode(name, "UTF-8").replace("+", "%20")}"
    }
    data object MusicArtist : Screen("music_artist/{name}") {
        fun createRoute(name: String) = "music_artist/${java.net.URLEncoder.encode(name, "UTF-8").replace("+", "%20")}"
    }
    data object MusicAlbum : Screen("music_album/{name}") {
        fun createRoute(name: String) = "music_album/${java.net.URLEncoder.encode(name, "UTF-8").replace("+", "%20")}"
    }
    data object Featured : Screen("featured")
    data object About : Screen("about")
    data object SocialActivities : Screen("social_activities")
    data object AuthorsDirectory : Screen("authors_directory")

    /** `explore?tab=<key>`; `route` (no argument) opens the first tab. */
    data object Explore : Screen("explore") {
        const val ARG_TAB = "tab"
        const val pattern = "explore?tab={tab}"
        fun createRoute(tab: ExploreTab) = "explore?tab=${tab.key}"
    }

    data object PdfViewer : Screen("pdf_viewer/{pdfId}") {
        fun createRoute(pdfId: String) = "pdf_viewer/$pdfId"
    }

    data object ArticleDetail : Screen("article/{articleId}") {
        fun createRoute(articleId: String) = "article/$articleId"
    }

    data object CategoryDetail : Screen("category/{categorySlug}") {
        fun createRoute(categorySlug: String) = "category/$categorySlug"
    }

    data object AuthorDetail : Screen("author/{authorId}") {
        fun createRoute(authorId: String) = "author/$authorId"
    }

    /** Annual issue (`নিংশিং চে - YYYY` tag) listing. */
    data object IssueDetail : Screen("issue/{year}") {
        fun createRoute(year: Int) = "issue/$year"
    }
}
