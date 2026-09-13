package com.ningshingche.app.data.portal

import java.io.IOException

/**
 * UI-facing models for the reader. They are intentionally flat, immutable and
 * free of JSON annotations so a screen never depends on a wire-format detail.
 *
 * Everything here is derived from [BlogDto] & friends by the mappers at the
 * bottom of this file, which is also where all of the "real data is messy"
 * decisions live (blank slugs, missing dates, HTML excerpts, ...).
 */

/** Result of a paged PostgREST query. */
data class Page<out T>(
    val items: List<T>,
    /** Exact total reported by `Content-Range`, or `null` when not requested. */
    val total: Int? = null,
    val offset: Int = 0,
    val limit: Int = PortalConfig.PAGE_SIZE
) {
}

data class ArticleSummary(
    val id: String,
    val title: String,
    val subTitle: String,
    val slug: String,
    val imageUrl: String,
    val categoryId: String?,
    val categoryTitle: String,
    val categorySlug: String,
    val authorId: String?,
    val authorName: String,
    val authorImageUrl: String,
    val tags: List<String>,
    val readingTimeMinutes: Int,
    val viewsCount: Long,
    /** ISO `yyyy-MM-dd`, or `""` when the row has no date. */
    val publishedDate: String,
    val year: Int,
    val isSlider: Boolean,
    val isFeature: Boolean,
    val isSpecial: Boolean
)

data class ArticleDetail(
    val summary: ArticleSummary,
    /** Sanitised-for-display HTML body, exactly as stored by the editor. */
    val html: String,
    val seoTitle: String,
    val seoDescription: String,
    val videoLink: String,
    val pdfLink: String
) {
    val id: String get() = summary.id
    val title: String get() = summary.title
}

data class CategoryRef(
    val id: String,
    val title: String,
    val subTitle: String,
    val slug: String,
    /** Font Awesome icon name from the dashboard, e.g. `"book-open"`. */
    val iconName: String
)

data class AuthorRef(
    val id: String,
    val name: String,
    val designation: String,
    val bio: String,
    val imageUrl: String,
    val location: String,
    val isVerified: Boolean
)

data class GalleryItem(
    val id: String,
    val title: String,
    val description: String,
    val imageUrl: String,
    val category: String
)

data class PdfBook(
    val id: String,
    val title: String,
    val coverUrl: String,
    val authorOrEditor: String,
    val edition: String,
    val category: String,
    val pageCount: Int,
    val fileSizeMb: Double,
    val publishedDate: String,
    val year: Int,
    val fileUrl: String,
    val description: String,
    val isHostedInStorage: Boolean
)

data class VideoItem(
    val id: String,
    val title: String,
    val url: String,
    val platform: String,
    val description: String,
    val thumbnailUrl: String
)

data class MusicTrack(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val genre: String,
    val description: String,
    val thumbnailUrl: String,
    val audioUrl: String,
    val fileProvider: String = "",
    val storagePath: String = "",
    val lyrics: String = "",
    val videoLink: String = "",
    val artistImage: String = "",
    val artistDescription: String = "",
    val albumImage: String = "",
    val albumDescription: String = "",
    val durationSeconds: Int,
    val fileSizeMb: Double,
    val loveCount: Int = 0,
    /** How many times the song has been played, from the database. */
    val viewsCount: Long = 0L,
    /** The registered reader who uploaded it, when it came from the app. */
    val uploaderId: String = "",
    val uploaderName: String = "",
    /** When it was uploaded — ISO text, as the database stores it. */
    val createdAt: String = ""
) {
    fun hasPlayableSource(): Boolean = audioUrl.isNotBlank() || storagePath.isNotBlank()
    fun hasVideo(): Boolean = videoLink.isNotBlank()

    /**
     * The line under the title in the player.
     *
     * The uploader comes first — for a song a reader sent in, who sent it is the
     * first thing to say — and only when there is one: catalogue tracks added by
     * the editors have no uploader and start at the singer, as before.
     */
    fun playerCreditLine(): String {
        val singer = artist.ifBlank { "নিংশিং চে" }
        return buildString {
            if (uploaderName.isNotBlank()) append("Uploader: ${uploaderName} ◻ ")
            append("Singer: $singer")
            if (album.isNotBlank()) append(" ◻ Album: $album")
            if (genre.isNotBlank()) append(" ◻ Genre: $genre")
        }
    }
}

data class CommentItem(
    val id: String,
    val name: String,
    val content: String,
    val createdAt: String,
    val address: String,
    val avatarUrl: String = ""
)

data class SiteSettings(
    val title: String,
    val description: String,
    val logoUrl: String,
    val contactEmail: String,
    val facebookUrl: String,
    val youtubeUrl: String,
    val instagramUrl: String,
    val heroSliderEnabled: Boolean,
    val featuredEnabled: Boolean,
    val specialEnabled: Boolean,
    val allowComments: Boolean,
    val allowSubmissions: Boolean
) {
    companion object {
        val DEFAULT = SiteSettings(
            title = "নিংশিং চে",
            description = "বিষ্ণুপ্রিয়া মণিপুরি ডিজিটাল সাংস্কৃতিক আর্কাইভ ও সাহিত্য পত্রিকা",
            logoUrl = "",
            contactEmail = "",
            facebookUrl = "",
            youtubeUrl = "",
            instagramUrl = "",
            heroSliderEnabled = true,
            featuredEnabled = true,
            specialEnabled = true,
            allowComments = true,
            allowSubmissions = true
        )
    }
}

/** Category/author/tag facets of one published article (no text content). */
data class BlogFacet(
    val id: String,
    val categoryId: String?,
    val categorySlug: String,
    val authorId: String?,
    val tags: List<String>,
    val year: Int,
    val viewsCount: Long
)

/** One annual issue (`নিংশিং চে - YYYY`) with its published-article count. */
data class IssueSummary(
    val year: Int,
    val articleCount: Int
) {
    val label: String get() = IssueTags.issueLabel(year)
    val bengaliYear: String get() = IssueTags.toBengaliDigits(year)
}

/** A distinct tag (all spellings merged) with its published-article count. */
data class TagCount(
    val key: String,
    val label: String,
    val issueYear: Int?,
    val count: Int
)

/** Everything the home feed needs, fetched in one parallel batch. */
data class HomeFeed(
    val hero: List<ArticleSummary>,
    val featured: List<ArticleSummary>,
    val special: List<ArticleSummary>,
    val latest: List<ArticleSummary>,
    val categories: List<CategoryRef>,
    val authors: List<AuthorRef>,
    val gallery: List<GalleryItem>,
    val pdfBooks: List<PdfBook>,
    val videos: List<VideoItem>,
    val music: List<MusicTrack>,
    val settings: SiteSettings
)

// ---------------------------------------------------------------------------
// Forum
// ---------------------------------------------------------------------------

/**
 * One room on the forum home. `discussions` and `replies` are counts the
 * database keeps, not numbers the app works out.
 */
data class ForumCategory(
    val id: String,
    val slug: String,
    val title: String,
    val description: String,
    val discussions: Int,
    val replies: Int,
    val isLocked: Boolean = false
)

/**
 * One discussion, as a card and as a page.
 *
 * [body] is only filled in on the discussion's own page — the lists carry the
 * [excerpt], which is what the card shows — so a list of twenty threads is
 * twenty short rows, not twenty full posts.
 */
data class ForumDiscussion(
    val id: String,
    val categorySlug: String,
    val categoryTitle: String,
    val title: String,
    val excerpt: String,
    val body: String,
    val authorId: String,
    val authorName: String,
    val authorAvatarUrl: String,
    val views: Long,
    val replies: Int,
    val createdAt: String,
    val lastActivityAt: String,
    /** ImgBB cover, blank when the thread has none. */
    val coverImageUrl: String = "",
    /** Opened by the NingshingChe admin — the সাম্প্রতিক filter's third option. */
    val isOfficial: Boolean = false
) {
    /** A discussion nobody has answered reads differently on a card. */
    val hasReplies: Boolean get() = replies > 0

    val hasCover: Boolean get() = coverImageUrl.isNotBlank()
}

/**
 * One answer under a discussion.
 *
 * [parentId] is set when this answer answers another one. The app draws exactly
 * one level of indentation — migration 030 folds a reply-to-a-reply back onto
 * its own answer — so a non-null parent always points at a top-level answer.
 */
/**
 * How many characters a post may run to before a card folds it behind "আরও দেখুন".
 *
 * The owner's rule, and a *character* count rather than a measurement: a hundred
 * characters of Bengali is about two lines on a phone, which is where a card stops
 * being something a reader takes in at a glance. The same number folds a thread's
 * opening post, an answer and a reply — one rule, so no screen can disagree with
 * another about what "too long" means.
 */
internal const val FORUM_FOLD_CHARS = 100

data class ForumReply(
    val id: String,
    val discussionId: String,
    val parentId: String,
    val authorId: String,
    val authorName: String,
    val authorAvatarUrl: String,
    val body: String,
    val createdAt: String,
    val likes: Int = 0,
    val dislikes: Int = 0,
    val agrees: Int = 0,
    /** `like`, `dislike`, `agree`, or blank when the reader has not reacted. */
    val myReaction: String = "",
    /** The dashboard wrote this one: the app marks it as the admin's. */
    val isOfficial: Boolean = false,
    /** This reader wrote it. What a long press offers depends on it. */
    val isMine: Boolean = false
) {
    val isTopLevel: Boolean get() = parentId.isBlank()

    /** What the "top answers" filter sorts on. A dislike is shown, never subtracted. */
    val reactionScore: Int get() = likes + agrees

    /** The three reactions, in the order the row draws them. */
    val reactions: List<String>
        get() = listOf(REACTION_LIKE, REACTION_AGREE, REACTION_DISLIKE)

    /**
     * Whether a body is long enough to fold. The threshold is a length, not a
     * measurement: a card that has to be measured before it can decide would
     * push a "see more" onto every short answer that happens to wrap.
     *
     * The length is the length of the *words*. A post with a picture in it used
     * to fold on the markup alone — which hid a short answer behind a "see more"
     * for the sake of a tag, and the folded copy drew the picture as the one
     * character HtmlCompat keeps for images (U+FFFC, "obj" to a reader).
     */
    val isLong: Boolean get() = forumBodyText(body).length > FORUM_FOLD_CHARS

    companion object {
        const val REACTION_LIKE = "like"
        const val REACTION_DISLIKE = "dislike"
        const val REACTION_AGREE = "agree"
    }
}

/**
 * One file attached to a post: a picture, or a document.
 *
 * The app never draws a raw URL for one of these. A picture becomes a small
 * preview, a PDF becomes its icon and its file name — and a tap on either opens
 * the viewer, which shows the whole thing and offers the download.
 *
 * [sizeBytes] and [mimeType] are what the uploader knew about the file; a file
 * that came back from the database is rebuilt from its URL and its label alone,
 * which is why both have to survive being empty.
 */
data class ForumAttachment(
    val url: String,
    val name: String = "",
    val mimeType: String = "",
    val sizeBytes: Long = 0L
) {
    val isImage: Boolean get() = mimeType.startsWith("image/") || (!isPdf && mimeType.isBlank())

    val isPdf: Boolean get() = mimeType == MIME_PDF || isPdfReference(url, name)

    /** What a chip shows: the file's own name, or something honest instead. */
    val label: String
        get() = name.trim().ifBlank { if (isPdf) "সংযুক্তি.pdf" else "সংযুক্তি" }

    /** The name a downloaded copy is saved under. */
    val downloadName: String
        get() {
            val clean = label.substringAfterLast('/').trim()
            return if (clean.contains('.')) clean else "$clean${if (isPdf) ".pdf" else ".jpg"}"
        }

    val mime: String get() = if (mimeType.isNotBlank()) mimeType else if (isPdf) MIME_PDF else "image/jpeg"

    companion object {
        const val MIME_PDF = "application/pdf"

        /** A file described by a URL and a label, as a stored post describes it. */
        fun fromReference(url: String, name: String): ForumAttachment {
            val cleanUrl = url.trim()
            val label = name.trim()
            val pdf = isPdfReference(cleanUrl, label)
            return ForumAttachment(
                url = cleanUrl,
                name = label,
                mimeType = if (pdf) MIME_PDF else "image/jpeg"
            )
        }
    }
}

/** What one tap on the reaction popup answers with. */
data class ForumReactionState(
    val replyId: String,
    val likes: Int,
    val dislikes: Int,
    val agrees: Int,
    val mine: String
)

/**
 * One reader's forum work — their dashboard card, and the third tab of their
 * public page. [counts] are the database's, and so is the order of both lists.
 */
data class ForumActivity(
    val userId: String,
    val discussions: Int,
    val replies: Int,
    val reactions: Int,
    val threads: List<ForumActivityThread>,
    val answers: List<ForumActivityAnswer>
) {
    val hasAnything: Boolean get() = threads.isNotEmpty() || answers.isNotEmpty()

    val total: Int get() = discussions + replies

    /**
     * Whether the database holds more than the window that was asked for.
     *
     * `forum_activity` takes a limit and no offset, so the two lists that come
     * back are trimmed to the limit while the counters are the whole truth —
     * which is what tells a screen whether to offer a "load more".
     */
    fun hasMoreThan(limit: Int): Boolean =
        discussions > threads.size || replies > answers.size
}

data class ForumActivityThread(
    val id: String,
    val title: String,
    val excerpt: String,
    val categorySlug: String,
    val categoryTitle: String,
    val views: Long,
    val replies: Int,
    val createdAt: String
)

data class ForumActivityAnswer(
    val id: String,
    val discussionId: String,
    val discussionTitle: String,
    val excerpt: String,
    val likes: Int,
    val dislikes: Int,
    val agrees: Int,
    val createdAt: String
)

/**
 * One page of one list, and how many there are in all.
 *
 * [total] is the database's count for the whole list, not the size of [items] —
 * that is what lets a page say "৫" beside a tab and offer "আরও দেখুন" without
 * having loaded the rest. [offset] is where this page started, so a screen that
 * has stitched two pages together knows what to ask for next.
 */
data class Paged<T>(
    val items: List<T>,
    val total: Int,
    val offset: Int = 0
) {
    /** How many rows the screen holds once this page has been added to it. */
    val loaded: Int get() = offset + items.size

    val hasMore: Boolean get() = loaded < total

    /** True when the list is empty and the database says that is the whole truth. */
    val isEmpty: Boolean get() = items.isEmpty() && total == 0

    companion object {
        val EMPTY: Paged<Nothing> get() = Paged(emptyList(), 0)
    }
}

/**
 * One row of a paged profile list, in the shape of the kind it belongs to.
 *
 * The database answers all four kinds through one function, so the app has one
 * page type and this says which of the four a row is — the tab that asked for it
 * already knows, and a `when` over these is exhaustive by construction.
 */
sealed interface ProfileItem {
    /** Stable for the list, so a LazyColumn can key on it. */
    val key: String

    data class Article(val article: PublicArticle) : ProfileItem {
        override val key: String get() = "article-${article.id}"
    }

    data class Song(val song: MusicTrack) : ProfileItem {
        override val key: String get() = "song-${song.id}"
    }

    data class Thread(val thread: ForumActivityThread) : ProfileItem {
        override val key: String get() = "thread-${thread.id}"
    }

    data class Answer(val answer: ForumActivityAnswer) : ProfileItem {
        override val key: String get() = "answer-${answer.id}"
    }
}

/** The four totals the profile's tabs are labelled with (migration 033). */
data class ProfileTotals(
    val articles: Int = 0,
    val songs: Int = 0,
    val threads: Int = 0,
    val answers: Int = 0
) {
    companion object {
        /** The kinds `profile_items` answers with, in the order the page shows them. */
        const val ARTICLES = "articles"
        const val SONGS = "songs"
        const val THREADS = "threads"
        const val ANSWERS = "answers"
        const val COUNTS = "counts"
    }
}

/**
 * The forum home: the rooms, and the discussions the reader asked to see.
 *
 * [order] is the filter that produced [latest] — `recent`, `popular` or
 * `official` — echoed by the database so a screen can never label one list with
 * another's name.
 */
data class ForumOverview(
    val categories: List<ForumCategory>,
    val latest: List<ForumDiscussion>,
    val totalDiscussions: Int,
    val totalReplies: Int,
    val order: String = ORDER_RECENT,
    val officialCount: Int = 0
) {
    companion object {
        const val ORDER_RECENT = "recent"
        const val ORDER_POPULAR = "popular"
        const val ORDER_OFFICIAL = "official"

        val orders = listOf(ORDER_RECENT, ORDER_POPULAR, ORDER_OFFICIAL)
    }
}

data class ForumCategoryPage(
    val category: ForumCategory,
    val discussions: List<ForumDiscussion>,
    val total: Int
)

data class ForumSearchResult(
    val query: String,
    val discussions: List<ForumDiscussion>,
    val total: Int
)

/**
 * A discussion with its answers, in the order they were written.
 *
 * The database answers flat and the nesting happens here, because "one step of
 * indentation, and only the newest answer under each one until the reader asks
 * for the rest" is a rule about reading a thread, not about storing one.
 */
data class ForumThread(
    val discussion: ForumDiscussion,
    val replies: List<ForumReply>
) {
    /** The answers themselves, newest first — what the উত্তরসমূহ filter reorders. */
    val answers: List<ForumReply> get() = replies.filter { it.isTopLevel }

    /** Everything written under one answer, oldest first. */
    fun repliesUnder(answerId: String): List<ForumReply> =
        replies.filter { it.parentId == answerId }.sortedBy { it.createdAt }

    /** The answers in the order the filter asked for. */
    fun answersIn(order: String): List<ForumReply> = when (order) {
        ANSWER_TOP -> answers.sortedWith(
            compareByDescending<ForumReply> { it.reactionScore }.thenBy { it.createdAt }
        )
        else -> answers.sortedBy { it.createdAt }
    }

    /** With [reply] folded in — a post, a reaction, or an answer just edited. */
    fun with(reply: ForumReply): ForumThread {
        val replaced = replies.map { if (it.id == reply.id) reply else it }
        return copy(replies = if (replaced.any { it.id == reply.id }) replaced else replaced + reply)
    }

    /**
     * Without one answer — what the reader sees the instant their own answer is
     * removed, before the thread is read again. The database has already folded
     * any answers written under it onto the answer it answered; this only takes
     * the removed row off the screen.
     */
    fun without(replyId: String): ForumThread =
        copy(replies = replies.filterNot { it.id == replyId })

    companion object {
        /** Newest first, the way a conversation is usually read. */
        const val ANSWER_RECENT = "recent"
        /** Most liked or agreed first — the owner's "top answers". */
        const val ANSWER_TOP = "top"

        val answerOrders = listOf(ANSWER_TOP, ANSWER_RECENT)
    }
}

internal fun ForumCategoryDto.toModel() = ForumCategory(
    id = id.orEmpty(),
    slug = slug.orEmpty(),
    title = title.orEmpty().ifBlank { "আলোচনা" },
    description = description.orEmpty(),
    discussions = (discussions ?: 0).coerceAtLeast(0),
    replies = (replies ?: 0).coerceAtLeast(0),
    isLocked = isLocked ?: false
)

internal fun ForumDiscussionDto.toModel() = ForumDiscussion(
    id = id.orEmpty(),
    categorySlug = categorySlug.orEmpty(),
    categoryTitle = categoryTitle.orEmpty().ifBlank { "আলোচনা" },
    title = title.orEmpty().trim().ifBlank { "শিরোনামহীন আলোচনা" },
    excerpt = excerpt.orEmpty().trim(),
    body = body.orEmpty(),
    authorId = authorId.orEmpty(),
    authorName = authorName.orEmpty().trim().ifBlank { "নিংশিং চে পাঠক" },
    authorAvatarUrl = authorAvatarUrl.orEmpty(),
    views = (views ?: 0L).coerceAtLeast(0L),
    replies = (replies ?: 0).coerceAtLeast(0),
    createdAt = createdAt.orEmpty(),
    // A thread nobody answered is as old as its own post, which is what a card
    // showing "শেষ উত্তর" has to fall back to.
    lastActivityAt = lastReplyAt.orEmpty().ifBlank { createdAt.orEmpty() },
    coverImageUrl = coverImageUrl.orEmpty().trim(),
    isOfficial = isOfficial ?: false
)

internal fun ForumReplyDto.toModel() = ForumReply(
    id = id.orEmpty(),
    discussionId = discussionId.orEmpty(),
    parentId = parentId.orEmpty(),
    authorId = authorId.orEmpty(),
    authorName = authorName.orEmpty().trim().ifBlank { "নিংশিং চে পাঠক" },
    authorAvatarUrl = authorAvatarUrl.orEmpty(),
    body = body.orEmpty(),
    createdAt = createdAt.orEmpty(),
    likes = (likes ?: 0).coerceAtLeast(0),
    dislikes = (dislikes ?: 0).coerceAtLeast(0),
    agrees = (agrees ?: 0).coerceAtLeast(0),
    // Anything the database does not call one of the three is "no reaction":
    // a screen that showed an unknown word back at the reader would be worse
    // than a screen that showed none.
    myReaction = when (myReaction.orEmpty().trim()) {
        ForumReply.REACTION_LIKE, ForumReply.REACTION_DISLIKE, ForumReply.REACTION_AGREE ->
            myReaction.orEmpty().trim()
        else -> ""
    },
    isOfficial = isOfficial == true,
    isMine = isMine == true
)

/** The reaction the popup just set, as the model the card redraws from. */
internal fun ForumReactionDto.toModel(): ForumReactionState = ForumReactionState(
    replyId = replyId.orEmpty(),
    likes = (likes ?: 0).coerceAtLeast(0),
    dislikes = (dislikes ?: 0).coerceAtLeast(0),
    agrees = (agrees ?: 0).coerceAtLeast(0),
    mine = mine.orEmpty().trim()
)

internal fun ForumActivityDto.toModel(): ForumActivity? {
    val id = userId.orEmpty()
    if (id.isBlank()) return null
    return ForumActivity(
        userId = id,
        discussions = (counts?.discussions ?: discussions.orEmpty().size).coerceAtLeast(0),
        replies = (counts?.replies ?: replies.orEmpty().size).coerceAtLeast(0),
        reactions = (counts?.reactions ?: 0).coerceAtLeast(0),
        threads = discussions.orEmpty().map { it.toModel() },
        answers = replies.orEmpty().map { it.toModel() }
    )
}

internal fun ForumActivityDiscussionDto.toModel() = ForumActivityThread(
    id = id.orEmpty(),
    title = title.orEmpty().trim().ifBlank { "শিরোনামহীন আলোচনা" },
    excerpt = excerpt.orEmpty().trim(),
    categorySlug = categorySlug.orEmpty(),
    categoryTitle = categoryTitle.orEmpty().ifBlank { "আলোচনা" },
    views = (views ?: 0L).coerceAtLeast(0L),
    replies = (replies ?: 0).coerceAtLeast(0),
    createdAt = createdAt.orEmpty()
)

internal fun ForumActivityReplyDto.toModel() = ForumActivityAnswer(
    id = id.orEmpty(),
    discussionId = discussionId.orEmpty(),
    discussionTitle = discussionTitle.orEmpty().trim().ifBlank { "আলোচনা" },
    excerpt = excerpt.orEmpty().trim(),
    likes = (likes ?: 0).coerceAtLeast(0),
    dislikes = (dislikes ?: 0).coerceAtLeast(0),
    agrees = (agrees ?: 0).coerceAtLeast(0),
    createdAt = createdAt.orEmpty()
)

internal fun ProfileItemsDto.toTotals() = ProfileTotals(
    articles = (totals?.articles ?: 0).coerceAtLeast(0),
    songs = (totals?.songs ?: 0).coerceAtLeast(0),
    threads = (totals?.threads ?: 0).coerceAtLeast(0),
    answers = (totals?.answers ?: 0).coerceAtLeast(0)
)

internal fun ProfileItemsDto.toPage(offset: Int): Paged<ProfileItemDto> =
    Paged(
        items = items.orEmpty(),
        total = (total ?: items.orEmpty().size).coerceAtLeast(0),
        offset = offset
    )

/** The same article shape the profile always drew, from either image column. */
internal fun ProfileItemDto.toArticle() = PublicArticle(
    id = id.orEmpty(),
    title = title.orEmpty().ifBlank { "শিরোনামহীন" },
    slug = slug.orEmpty(),
    thumbnailUrl = image.orEmpty().ifBlank { thumbnail.orEmpty() },
    categoryTitle = categoryTitle.orEmpty(),
    viewsCount = (viewsCount ?: 0L).coerceAtLeast(0L),
    publishedAt = publishedDate.orEmpty().ifBlank { createdAt.orEmpty() }
)

internal fun ProfileItemDto.toSong(uploaderId: String, uploaderName: String) = MusicTrack(
    id = id.orEmpty(),
    title = title.orEmpty().trim(),
    artist = artist.orEmpty().trim(),
    album = album.orEmpty().trim(),
    genre = genre.orEmpty().trim(),
    description = "",
    thumbnailUrl = thumbnailUrl.orEmpty(),
    audioUrl = audioUrl.orEmpty(),
    storagePath = fileStoragePath.orEmpty().trim(),
    durationSeconds = (durationSeconds ?: 0).coerceAtLeast(0),
    fileSizeMb = 0.0,
    createdAt = createdAt.orEmpty(),
    loveCount = (loveCount ?: 0).coerceAtLeast(0),
    viewsCount = (viewsCount ?: 0L).coerceAtLeast(0L),
    uploaderId = uploaderId,
    uploaderName = uploaderName
)

internal fun ProfileItemDto.toActivityThread() = ForumActivityThread(
    id = id.orEmpty(),
    title = title.orEmpty().trim().ifBlank { "শিরোনামহীন আলোচনা" },
    excerpt = excerpt.orEmpty().trim(),
    categorySlug = categorySlug.orEmpty(),
    categoryTitle = categoryTitle.orEmpty().ifBlank { "আলোচনা" },
    views = (viewsCount ?: 0L).coerceAtLeast(0L),
    replies = (repliesCount ?: 0).coerceAtLeast(0),
    createdAt = createdAt.orEmpty()
)

internal fun ProfileItemDto.toActivityAnswer() = ForumActivityAnswer(
    id = id.orEmpty(),
    discussionId = discussionId.orEmpty(),
    discussionTitle = discussionTitle.orEmpty().trim().ifBlank { "আলোচনা" },
    // The excerpt the database sent; a row from an older function still has the
    // body, and a card shows words either way.
    excerpt = excerpt.orEmpty().ifBlank { forumBodyText(body.orEmpty()) }.trim(),
    likes = (likeCount ?: 0).coerceAtLeast(0),
    dislikes = (dislikeCount ?: 0).coerceAtLeast(0),
    agrees = (agreeCount ?: 0).coerceAtLeast(0),
    createdAt = createdAt.orEmpty()
)

internal fun ForumOverviewDto.toModel(): ForumOverview {
    val wanted = order.orEmpty().ifBlank { ForumOverview.ORDER_RECENT }
    val rows = latest.orEmpty().map { it.toModel() }
    return ForumOverview(
        categories = categories.orEmpty().map { it.toModel() },
        // **জনপ্রিয় is most answered first, then most read.** The database orders
        // it that way (030), and the same rule is applied here so the tab cannot
        // show a "popular" list in any other order: whichever way the rows
        // arrive, the first card on that tab is the most answered thread.
        latest = if (wanted == ForumOverview.ORDER_POPULAR) {
            rows.sortedWith(
                compareByDescending<ForumDiscussion> { it.replies }
                    .thenByDescending { it.views }
            )
        } else {
            rows
        },
        totalDiscussions = (totalDiscussions ?: 0).coerceAtLeast(0),
        totalReplies = (totalReplies ?: 0).coerceAtLeast(0),
        order = wanted,
        officialCount = (officialCount ?: 0).coerceAtLeast(0)
    )
}

internal fun ForumCategoryPageDto.toModel(): ForumCategoryPage? {
    val room = category?.toModel() ?: return null
    return ForumCategoryPage(
        category = room,
        discussions = discussions.orEmpty().map { it.toModel() },
        total = (total ?: 0).coerceAtLeast(0)
    )
}

internal fun ForumSearchDto.toModel() = ForumSearchResult(
    query = query.orEmpty(),
    discussions = discussions.orEmpty().map { it.toModel() },
    total = (total ?: 0).coerceAtLeast(0)
)

internal fun ForumThreadDto.toModel(): ForumThread? {
    val thread = discussion?.toModel() ?: return null
    return ForumThread(
        discussion = thread,
        replies = replies.orEmpty().map { it.toModel() }.sortedBy { it.createdAt }
    )
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

sealed class PortalError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** No connectivity, DNS failure, TLS failure or timeout. */
    class Offline(cause: Throwable? = null) :
        PortalError("ইন্টারনেট সংযোগ নেই। সংরক্ষিত আর্কাইভ দেখানো হচ্ছে।", cause)

    /** HTTP failure. `code` is the PostgREST/Supabase status. */
    class Http(val code: Int, override val message: String) : PortalError(message)

    /**
     * A call that needs a session was refused — no reader token travelled, or
     * the one that did had expired.
     *
     * Kept apart from [Http] for two reasons: the screens answer it with the
     * sign-in gate rather than a retry button, and the database's own wording
     * for it is English ("contributor board is for signed-in readers"), which is
     * not a sentence to put in front of a Bengali reader.
     */
    class SignedOut(override val message: String = SESSION_EXPIRED) : PortalError(message) {
        companion object {
            /** The same sentence the contributor gate shows, so it is one key. */
            const val SESSION_EXPIRED =
                "আপনার সেশনের মেয়াদ শেষ হয়েছে। আবার সাইন ইন করলে তালিকা ও পয়েন্ট দেখা যাবে।"
        }
    }

    /** A table or column is missing — `schema.sql` or migration 003 has not run. */
    class SchemaMissing(override val message: String) : PortalError(message)

    /** Successful request, empty result. */
    object NotFound : PortalError("কোনো তথ্য পাওয়া যায়নি।")

    class Unknown(cause: Throwable? = null) :
        PortalError("তথ্য লোড করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।", cause)
}

internal fun Throwable.toPortalError(): Throwable = when (this) {
    is PortalError -> this
    is IOException -> PortalError.Offline(this)
    else -> PortalError.Unknown(this)
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

internal fun BlogDto.toSummary(): ArticleSummary {
    val date = publishedDate.orEmpty()
    return ArticleSummary(
        id = id,
        title = title.trim(),
        subTitle = subTitle.orEmpty().trim(),
        // Slugs in this database are Bengali; fall back to the UUID so deep
        // links and share URLs always resolve to something.
        slug = slug.orEmpty().ifBlank { id },
        imageUrl = image.orEmpty(),
        categoryId = categoryId,
        categoryTitle = categoryTitle.orEmpty().ifBlank { "সাধারণ" },
        categorySlug = categorySlug.orEmpty(),
        authorId = authorId,
        authorName = authorName.orEmpty().ifBlank { "নিংশিং চে" },
        authorImageUrl = authorImage.orEmpty(),
        tags = tags?.filter { it.isNotBlank() }.orEmpty(),
        readingTimeMinutes = (readingTimeMinutes ?: 0).coerceAtLeast(1),
        viewsCount = viewsCount ?: 0L,
        publishedDate = date,
        year = yearOf(date, createdAt),
        isSlider = isSlider ?: false,
        isFeature = isFeature ?: false,
        isSpecial = isSpecialArticle ?: false
    )
}

internal fun BlogDto.toDetail(): ArticleDetail = ArticleDetail(
    summary = toSummary(),
    html = content.orEmpty(),
    seoTitle = seoTitle.orEmpty(),
    seoDescription = seoDescription.orEmpty(),
    videoLink = videoLink.orEmpty(),
    pdfLink = pdfBookLink.orEmpty()
)

internal fun BlogFacetDto.toFacet(): BlogFacet = BlogFacet(
    id = id,
    categoryId = categoryId,
    categorySlug = categorySlug.orEmpty(),
    authorId = authorId,
    tags = tags?.map { IssueTags.clean(it) }?.filter { it.isNotBlank() }.orEmpty(),
    year = yearOf(publishedDate.orEmpty(), createdAt),
    viewsCount = viewsCount ?: 0L
)

internal fun CategoryDto.toRef(): CategoryRef = CategoryRef(
    id = id,
    title = title.trim(),
    subTitle = subTitle.orEmpty().trim(),
    slug = slug.orEmpty().ifBlank { id },
    iconName = iconName.orEmpty().ifBlank { "layer-group" }
)

internal fun AuthorDto.toRef(): AuthorRef = AuthorRef(
    id = id,
    name = title.trim(),
    designation = designation.orEmpty().trim(),
    bio = description.orEmpty(),
    imageUrl = image.orEmpty(),
    location = location.orEmpty(),
    isVerified = (isVerified == true) || (verified == true)
)

internal fun GalleryDto.toItem(): GalleryItem = GalleryItem(
    id = id,
    title = title.trim(),
    description = description.orEmpty(),
    imageUrl = image.orEmpty(),
    category = category.orEmpty().ifBlank { "সাধারণ" }
)

internal fun PdfBookDto.toModel(): PdfBook {
    val date = bookPublishedDate.orEmpty()
    return PdfBook(
        id = id,
        title = title.trim(),
        coverUrl = image.orEmpty(),
        authorOrEditor = authorOrEditor.orEmpty(),
        edition = edition.orEmpty(),
        category = category.orEmpty(),
        pageCount = pageCount ?: 0,
        fileSizeMb = fileSizeMb ?: 0.0,
        publishedDate = date,
        year = yearOf(date, createdAt),
        fileUrl = link.orEmpty(),
        description = description.orEmpty(),
        isHostedInStorage = fileProvider == "supabase-storage"
    )
}

internal fun MusicDto.toItem(): MusicTrack = MusicTrack(
    createdAt = createdAt.orEmpty(),
    id = id,
    title = title.trim(),
    artist = artist.orEmpty().trim(),
    album = album.orEmpty().trim(),
    genre = genre.orEmpty().trim(),
    description = description.orEmpty(),
    thumbnailUrl = thumbnailUrl.orEmpty(),
    audioUrl = audioUrl.orEmpty().trim(),
    fileProvider = fileProvider.orEmpty().trim(),
    storagePath = fileStoragePath.orEmpty().trim(),
    lyrics = lyrics.orEmpty(),
    videoLink = videoLink.orEmpty().trim(),
    artistImage = artistImage.orEmpty().trim(),
    artistDescription = artistDescription.orEmpty().trim(),
    albumImage = albumImage.orEmpty().trim(),
    albumDescription = albumDescription.orEmpty().trim(),
    durationSeconds = (durationSeconds ?: 0).coerceAtLeast(0),
    fileSizeMb = fileSizeMb ?: 0.0,
    loveCount = (loveCount ?: 0).coerceAtLeast(0),
    viewsCount = (viewsCount ?: 0L).coerceAtLeast(0L),
    uploaderId = userId.orEmpty().trim(),
    uploaderName = uploaderName.orEmpty().trim()
)

internal fun VideoDto.toItem(): VideoItem = VideoItem(
    id = id,
    title = title.trim(),
    url = videoLink,
    platform = platform.orEmpty().ifBlank { platformOf(videoLink) },
    description = description.orEmpty(),
    thumbnailUrl = thumbnailUrl.orEmpty().ifBlank { thumbnailOf(videoLink) }
)

internal fun CommentDto.toItem(): CommentItem = CommentItem(
    id = id,
    name = name.trim(),
    content = content.trim(),
    createdAt = createdAt.orEmpty(),
    address = address.orEmpty(),
    avatarUrl = avatarUrl.orEmpty()
)

internal fun SettingsDto.toModel(): SiteSettings = SiteSettings(
    title = siteTitle.orEmpty().ifBlank { SiteSettings.DEFAULT.title },
    description = siteDescription.orEmpty().ifBlank { SiteSettings.DEFAULT.description },
    logoUrl = logoUrl.orEmpty(),
    contactEmail = contactEmail.orEmpty(),
    facebookUrl = facebookUrl.orEmpty(),
    youtubeUrl = youtubeUrl.orEmpty(),
    instagramUrl = instagramUrl.orEmpty(),
    heroSliderEnabled = heroSliderEnabled ?: true,
    featuredEnabled = featuredArticlesEnabled ?: true,
    specialEnabled = specialArticlesEnabled ?: true,
    allowComments = allowComments ?: true,
    allowSubmissions = allowUserSubmissions ?: true
)

// ---------------------------------------------------------------------------
// Small helpers shared by the mappers and the UI
// ---------------------------------------------------------------------------

/** `2025-06-17` → `2025`. Falls back to `created_at`, then to the current year. */
internal fun yearOf(publishedDate: String, createdAt: String?): Int {
    val fromPublished = publishedDate.filter { it.isDigit() }.take(4).toIntOrNull()
    if (fromPublished != null) return fromPublished
    val fromCreated = createdAt?.filter { it.isDigit() }?.take(4)?.toIntOrNull()
    if (fromCreated != null) return fromCreated
    return 2025
}

/** Plain-text teaser for the HTML body stored by the dashboard editor. */
fun excerptOf(html: String, maxChars: Int = 160): String {
    val text = stripHtml(html)
    return if (text.length <= maxChars) text else text.take(maxChars).trimEnd() + "…"
}

fun stripHtml(html: String): String = html
    .replace(Regex("(?is)<(script|style).*?</\\1>"), " ")
    .replace(Regex("(?is)<br\\s*/?>"), "\n")
    .replace(Regex("(?is)</p\\s*>"), "\n\n")
    .replace(Regex("(?s)<[^>]+>"), " ")
    .replace("&nbsp;", " ")
    .replace("&amp;", "&")
    .replace("&quot;", "\"")
    .replace("&#39;", "'")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace(Regex("[ \\t]+"), " ")
    .replace(Regex("\n{3,}"), "\n\n")
    .trim()

/** Best-effort platform label for a video URL. */
fun platformOf(url: String): String = when {
    url.contains("youtube.com", true) || url.contains("youtu.be", true) -> "YouTube"
    url.contains("facebook.com", true) || url.contains("fb.watch", true) -> "Facebook"
    url.contains("instagram.com", true) -> "Instagram"
    url.contains("vimeo.com", true) -> "Vimeo"
    url.contains("dailymotion.com", true) -> "Dailymotion"
    else -> "Video Link"
}

/** YouTube thumbnails are derivable; Facebook reels are not. */
fun thumbnailOf(url: String): String {
    val id = Regex("(?:v=|youtu\\.be/|shorts/|embed/)([A-Za-z0-9_-]{11})").find(url)
        ?.groupValues?.getOrNull(1)
    return if (id != null) "https://i.ytimg.com/vi/$id/hqdefault.jpg" else ""
}

/** Public permalink for a blog. Bengali slugs must be percent-encoded. */
fun permalinkOf(slug: String): String {
    val encoded = java.net.URLEncoder.encode(slug, "UTF-8").replace("+", "%20")
    return "https://ningshingche.com/article/$encoded"
}


/**
 * A registered reader's public page: who they are and everything of theirs that
 * is published, gathered by the `public_profile` RPC so the page opens with a
 * single request.
 */
data class PublicProfile(
    val id: String,
    val name: String,
    /** What they do, when they told the app. Empty is normal, never invented. */
    val designation: String = "",
    /** Their address as they wrote it. The page shows a short form of it. */
    val address: String = "",
    val avatarUrl: String,
    val joinedAt: String,
    /** Everything they have earned, and what they earned this month. */
    val points: Int = 0,
    val monthPoints: Int = 0,
    val articleViews: Long,
    val musicViews: Long,
    val articles: List<PublicArticle>,
    val songs: List<MusicTrack>
) {
    val totalViews: Long get() = articleViews + musicViews

    /** First line of the address, trimmed — a card is not a mailing label. */
    val shortAddress: String
        get() = address.trim().lineSequence().firstOrNull().orEmpty().trim()

    /**
     * Both lists, most read first. The server already orders them that way; this
     * sorts again so a page restored from an older cached answer cannot show a
     * different order than a freshly fetched one.
     */
    val articlesByViews: List<PublicArticle>
        get() = articles.sortedWith(
            compareByDescending<PublicArticle> { it.viewsCount }.thenByDescending { it.publishedAt }
        )

    val songsByViews: List<MusicTrack>
        get() = songs.sortedWith(
            compareByDescending<MusicTrack> { it.viewsCount }.thenByDescending { it.createdAt }
        )
}

/** One published article on a public user page. */
data class PublicArticle(
    val id: String,
    val title: String,
    val slug: String,
    val thumbnailUrl: String,
    val categoryTitle: String,
    val viewsCount: Long,
    val publishedAt: String
)

/** One point of the dashboard's views-over-time chart. */
data class ViewDay(
    val day: String,
    val views: Long
)

/** The reader's own view totals, as the database has them. */
data class ViewTotals(
    val articleViews: Long,
    val musicViews: Long
) {
    val total: Long get() = articleViews + musicViews
}

internal fun ViewTotalsDto.toModel(): ViewTotals = ViewTotals(
    articleViews = (articleViews ?: 0L).coerceAtLeast(0L),
    musicViews = (musicViews ?: 0L).coerceAtLeast(0L)
)

internal fun ViewDayDto.toModel(): ViewDay = ViewDay(
    day = day,
    views = (views ?: 0L).coerceAtLeast(0L)
)

internal fun PublicProfileDto.toModel(): PublicProfile {
    val profileId = id
    val profileName = name.orEmpty()
    return PublicProfile(
    id = profileId,
    name = profileName.ifBlank { "নিংশিং চে পাঠক" },
    designation = designation.orEmpty().trim(),
    address = address.orEmpty().trim(),
    avatarUrl = avatarUrl.orEmpty(),
    points = (points ?: 0).coerceAtLeast(0),
    monthPoints = (monthPoints ?: 0).coerceAtLeast(0),
    joinedAt = joinedAt.orEmpty(),
    articleViews = (articleViews ?: 0L).coerceAtLeast(0L),
    musicViews = (musicViews ?: 0L).coerceAtLeast(0L),
    articles = articles.orEmpty().map { row ->
        PublicArticle(
            id = row.id,
            title = row.title.orEmpty().ifBlank { "শিরোনামহীন" },
            slug = row.slug.orEmpty(),
            thumbnailUrl = row.thumbnail.orEmpty(),
            categoryTitle = row.categoryTitle.orEmpty(),
            viewsCount = (row.viewsCount ?: 0L).coerceAtLeast(0L),
            publishedAt = row.publishedDate.orEmpty().ifBlank { row.createdAt.orEmpty() }
        )
    },
    songs = songs.orEmpty().map { row ->
        MusicTrack(
            id = row.id,
            title = row.title.orEmpty().trim(),
            artist = row.artist.orEmpty().trim(),
            album = row.album.orEmpty().trim(),
            genre = row.genre.orEmpty().trim(),
            description = "",
            thumbnailUrl = row.thumbnailUrl.orEmpty(),
            audioUrl = row.audioUrl.orEmpty(),
            storagePath = row.fileStoragePath.orEmpty().trim(),
            durationSeconds = (row.durationSeconds ?: 0).coerceAtLeast(0),
            fileSizeMb = 0.0,
            createdAt = row.createdAt.orEmpty(),
            loveCount = (row.loveCount ?: 0).coerceAtLeast(0),
            viewsCount = (row.viewsCount ?: 0L).coerceAtLeast(0L),
            uploaderId = profileId,
            uploaderName = profileName
        )
    }
    )
}


/**
 * What one reader has contributed over a window — a month, or everything.
 *
 * The counts are raw; [points] is what the database makes of them (its weights,
 * not the app's: `contributor_points_from`, migration 026). Keeping the parts
 * around is what lets a card say "৩টি প্রবন্ধ · ৫টি গান · ৯২০ পয়েন্ট" without
 * another request.
 */
data class ContributionStats(
    val articles: Int,
    val songs: Int,
    val comments: Int,
    val views: Long,
    val seconds: Int,
    val points: Int,
    // The forum joined the score in migration 030: a discussion is worth 20, an
    // answer 5, and a reaction received 1. The weights stay in the database; the
    // app only shows what it is handed.
    val discussions: Int = 0,
    val replies: Int = 0,
    val reactions: Int = 0
) {
    val minutes: Int get() = seconds / 60
    val isEmpty: Boolean get() = points <= 0
}

/** One row of the monthly contributor board. */
data class Contributor(
    val userId: String,
    val name: String,
    val avatarUrl: String,
    val stats: ContributionStats
) {
    val points: Int get() = stats.points
}

/** The board for one month, best first. */
data class ContributorBoard(
    /** `YYYY-MM`, as the database reports it. */
    val monthKey: String,
    val contributors: List<Contributor>
)

/** A reader's own points: the month the board covers, and everything before it. */
data class ContributorScore(
    val monthKey: String,
    val month: ContributionStats,
    val lifetime: ContributionStats
)

internal fun ContributionBlockDto.toStats(): ContributionStats = ContributionStats(
    articles = (articles ?: 0).coerceAtLeast(0),
    songs = (songs ?: 0).coerceAtLeast(0),
    comments = (comments ?: 0).coerceAtLeast(0),
    views = (views ?: 0L).coerceAtLeast(0L),
    seconds = (seconds ?: 0).coerceAtLeast(0),
    points = (points ?: 0).coerceAtLeast(0),
    discussions = (discussions ?: 0).coerceAtLeast(0),
    replies = (replies ?: 0).coerceAtLeast(0),
    reactions = (reactions ?: 0).coerceAtLeast(0)
)

internal fun ContributorDto.toModel(): Contributor = Contributor(
    userId = userId,
    name = name.orEmpty().ifBlank { "নিংশিং চে পাঠক" },
    avatarUrl = avatarUrl.orEmpty(),
    stats = ContributionStats(
        articles = (articles ?: 0).coerceAtLeast(0),
        songs = (songs ?: 0).coerceAtLeast(0),
        comments = (comments ?: 0).coerceAtLeast(0),
        views = (views ?: 0L).coerceAtLeast(0L),
        seconds = (seconds ?: 0).coerceAtLeast(0),
        points = (points ?: 0).coerceAtLeast(0)
    )
)

internal fun ContributorBoardDto.toModel(): ContributorBoard = ContributorBoard(
    monthKey = monthKey.orEmpty(),
    // Best first, and decided here as well as in the database. A board is a
    // ranking: a list of readers that is not in the order of the thing it ranks
    // them by is not a board, and it was reading as one (the rows arrived in the
    // order the database happened to hold them — see 035). Sorting here means the
    // page is in order whatever the server sends; the database sorts too, so the
    // two agree rather than one correcting the other.
    contributors = contributors.orEmpty()
        .map { it.toModel() }
        .sortedWith(
            compareByDescending<Contributor> { it.points }
                .thenByDescending { it.stats.articles }
                .thenByDescending { it.stats.songs }
        )
)

internal fun ContributorScoreDto.toModel(): ContributorScore = ContributorScore(
    monthKey = monthKey.orEmpty(),
    month = (month ?: ContributionBlockDto()).toStats(),
    lifetime = (lifetime ?: ContributionBlockDto()).toStats()
)
