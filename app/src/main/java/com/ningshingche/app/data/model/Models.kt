package com.ningshingche.app.data.model

data class Article(
    val id: String,
    val title: String,
    val slug: String,
    val excerpt: String,
    val content: String,
    val featuredImageUrl: String,
    val authorId: String,
    val authorName: String,
    val authorAvatarUrl: String = "",
    val category: String,
    val categorySlug: String,
    val tags: List<String> = emptyList(),
    val publishedDate: String,
    val year: Int,
    val readingTimeMinutes: Int = 5,
    val isFeatured: Boolean = false,
    val isEditorialPick: Boolean = false,
    val viewCount: Int = 120,
    val sourceUrl: String = "https://ningshingche.com",
    val relatedArticleIds: List<String> = emptyList()
)

data class Category(
    val id: String,
    val name: String,
    val slug: String,
    val description: String,
    val articleCount: Int,
    val iconName: String = "article",
    val imageUrl: String = ""
)

data class Author(
    val id: String,
    val name: String,
    val designation: String,
    val bio: String,
    val avatarUrl: String,
    val articleCount: Int,
    val location: String = "বাংলাদেশ / ভারত",
    val topics: List<String> = emptyList(),
    val isVerified: Boolean = false
)

data class YearArchive(
    val year: Int,
    val bengaliYearText: String,
    val title: String,
    val description: String,
    val issueCount: Int,
    val articleCount: Int,
    val coverImageUrl: String = ""
)

data class PdfCategory(
    val id: String,
    val name: String,
    val description: String,
    val count: Int
)

data class PdfDocument(
    val id: String,
    val title: String,
    val edition: String,
    val category: String,
    val categorySlug: String,
    val year: Int,
    val authorOrEditor: String,
    val pageCount: Int,
    val fileSizeMb: Float,
    val pdfUrl: String,
    val coverImageUrl: String,
    val description: String,
    val tags: List<String> = emptyList(),
    val downloadUrl: String = pdfUrl
)

data class Bookmark(
    val articleId: String,
    val savedAtTimestamp: Long = System.currentTimeMillis(),
    val folder: String = "সব সংরক্ষিত",
    val note: String = ""
)

data class ReadingHistory(
    val articleId: String,
    val readAtTimestamp: Long = System.currentTimeMillis(),
    val scrollPosition: Int = 0,
    val progressPercent: Float = 0f
)

enum class ReaderThemeMode {
    PAPER, SEPIA, NIGHT, CRISP
}

enum class AppThemeMode {
    SYSTEM, LIGHT, DARK
}

/**
 * The palette the reader paints the app with.
 *
 * Five presets and one they build themselves: [CUSTOM] takes a position on the
 * colour wheel — a hue and a strength — and derives a whole palette from it. The
 * values live in `ui/editorial/EditorialPalettes.kt`; this is the name that gets
 * stored and read back.
 */
enum class AppPalette {
    INDIGO, EYE_WARM, NIGHT, FOREST, ROSE, CUSTOM;

    companion object {
        /** Where the wheel opens: the indigo accent, so the reader's own palette starts on something familiar. */
        const val DEFAULT_CUSTOM_HUE = 222
        const val DEFAULT_CUSTOM_SATURATION = 62
    }
}

/**
 * Interface language. Bengali is the language the strings are written in, so it
 * always works and needs no download; English and Bishnupriya Manipuri come
 * from the dashboard's Languages page (`app_language_files`) and fall back to
 * the Bengali original for any string they do not translate yet.
 */
enum class ContentLanguage {
    BENGALI, ENGLISH, BISHNUPRIYA
}

enum class PdfFitMode { WIDTH, HEIGHT, BOTH }

data class PdfReaderSettings(
    val bookView: Boolean = true,
    val nightMode: Boolean = false,
    val snapPages: Boolean = true,
    val doubleTapZoom: Boolean = true,
    val annotations: Boolean = true,
    val keepScreenOn: Boolean = true,
    val scrollHandle: Boolean = true,
    val spacingDp: Int = 8,
    val fitMode: PdfFitMode = PdfFitMode.BOTH
)

data class ReaderPreferences(
    /**
     * How large an article's body is drawn, in sp. The reader's own setting — the
     * slider names the number — so it is not run through `textSize`; the default
     * moved with the rest of the app (18 → 20) and the slider's range widened
     * (14–28 → 16–34), because the owner's note was that the app reads small.
     */
    val fontSizeSp: Float = 20f,
    // Matches APP_LEADING in ui/theme/TextScale.kt: the reader's own spacing
    // dial starts where the rest of the app sets its text, not looser.
    val lineSpacingMultiplier: Float = 1.45f,
    val themeMode: ReaderThemeMode = ReaderThemeMode.PAPER,
    /**
     * Light, dark, or whatever the phone is set to. Dark by default: this app is
     * read at night, and the night side of every palette is the one that was tuned
     * hardest — the reader can still choose SYSTEM or LIGHT in Settings.
     */
    val appThemeMode: AppThemeMode = AppThemeMode.DARK,
    /** The palette in use. [AppPalette.INDIGO], the app's own, until the reader says otherwise. */
    val appPalette: AppPalette = AppPalette.INDIGO,
    /** The custom palette's wheel position: hue in degrees, strength in percent. */
    val customHue: Int = AppPalette.DEFAULT_CUSTOM_HUE,
    val customSaturation: Int = AppPalette.DEFAULT_CUSTOM_SATURATION,
    val contentLanguage: ContentLanguage = ContentLanguage.BENGALI,
    /**
     * False until the reader has answered the language question the first launch
     * asks. The app shows that screen instead of the reader while it is false.
     */
    val languageChosen: Boolean = false,
    val ttsSpeed: Float = 1.0f,
    val notificationsEnabled: Boolean = true,
    val notificationNewArticles: Boolean = true,
    val notificationFeatured: Boolean = true,
    val notificationVideos: Boolean = true,
    val notificationPdfs: Boolean = true,
    val notificationSystem: Boolean = true,
    val notificationOther: Boolean = true,
    val onboardingComplete: Boolean = false
)

data class ArticleCitation(
    val articleId: String,
    val title: String,
    val author: String,
    val category: String,
    val snippet: String
)

data class ArticleComment(
    val name: String,
    val content: String,
    val meta: String = ""
)

data class AiChatMessage(
    val id: String,
    val text: String,
    val isUser: Boolean,
    val timestamp: Long = System.currentTimeMillis(),
    val citations: List<ArticleCitation> = emptyList(),
    val isThinking: Boolean = false,
    /** True when the assistant found nothing locally and offers to fetch online. */
    val offerOnline: Boolean = false,
    val suggestedQuestions: List<String> = emptyList()
)