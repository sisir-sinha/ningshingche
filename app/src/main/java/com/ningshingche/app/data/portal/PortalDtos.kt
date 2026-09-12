package com.ningshingche.app.data.portal

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * Wire models for the Supabase PostgREST API.
 *
 * Field names mirror the columns in `backend/supabase/schema.sql` exactly, so
 * Moshi needs no custom naming strategy. Unknown columns (for example
 * `image_meta`, `inline_media`, `pdf_storage_path`) are ignored on read and are
 * never sent by the reader. Public comment POSTs use the explicit NewCommentDto payload.
 *
 * Every nullable field is nullable on purpose: PostgREST omits `null` columns
 * from JSON, and Bengali content frequently leaves optional columns empty.
 */

@JsonClass(generateAdapter = true)
data class BlogDto(
    val id: String,
    val title: String,
    @Json(name = "sub_title") val subTitle: String? = null,
    val slug: String? = null,
    val image: String? = null,
    val content: String? = null,
    @Json(name = "category_id") val categoryId: String? = null,
    @Json(name = "category_title") val categoryTitle: String? = null,
    @Json(name = "category_slug") val categorySlug: String? = null,
    @Json(name = "author_id") val authorId: String? = null,
    @Json(name = "author_name") val authorName: String? = null,
    @Json(name = "author_image") val authorImage: String? = null,
    val status: String? = null,
    val tags: List<String>? = null,
    @Json(name = "seo_title") val seoTitle: String? = null,
    @Json(name = "seo_description") val seoDescription: String? = null,
    @Json(name = "video_link") val videoLink: String? = null,
    @Json(name = "pdf_book_link") val pdfBookLink: String? = null,
    @Json(name = "is_slider") val isSlider: Boolean? = null,
    @Json(name = "is_feature") val isFeature: Boolean? = null,
    @Json(name = "is_special_article") val isSpecialArticle: Boolean? = null,
    @Json(name = "views_count") val viewsCount: Long? = null,
    @Json(name = "reading_time_minutes") val readingTimeMinutes: Int? = null,
    @Json(name = "published_date") val publishedDate: String? = null,
    @Json(name = "created_at") val createdAt: String? = null,
    @Json(name = "updated_at") val updatedAt: String? = null
)

@JsonClass(generateAdapter = true)
data class CategoryDto(
    val id: String,
    val title: String,
    @Json(name = "sub_title") val subTitle: String? = null,
    val slug: String? = null,
    @Json(name = "icon_name") val iconName: String? = null,
    @Json(name = "created_at") val createdAt: String? = null
)

@JsonClass(generateAdapter = true)
data class AuthorDto(
    val id: String,
    val title: String,
    val image: String? = null,
    val designation: String? = null,
    val description: String? = null,
    @Json(name = "is_verified") val isVerified: Boolean? = null,
    val verified: Boolean? = null,
    val location: String? = null,
    @Json(name = "created_at") val createdAt: String? = null
)

@JsonClass(generateAdapter = true)
data class GalleryDto(
    val id: String,
    val title: String,
    val description: String? = null,
    val image: String? = null,
    val category: String? = null,
    @Json(name = "created_at") val createdAt: String? = null
)

@JsonClass(generateAdapter = true)
data class PdfBookDto(
    val id: String,
    val title: String,
    val image: String? = null,
    @Json(name = "book_published_date") val bookPublishedDate: String? = null,
    val link: String? = null,
    @Json(name = "file_provider") val fileProvider: String? = null,
    @Json(name = "author_or_editor") val authorOrEditor: String? = null,
    val edition: String? = null,
    val category: String? = null,
    @Json(name = "page_count") val pageCount: Int? = null,
    @Json(name = "file_size_mb") val fileSizeMb: Double? = null,
    val description: String? = null,
    @Json(name = "created_at") val createdAt: String? = null
)

@JsonClass(generateAdapter = true)
data class VideoDto(
    val id: String,
    val title: String,
    @Json(name = "video_link") val videoLink: String,
    val platform: String? = null,
    val description: String? = null,
    @Json(name = "thumbnail_url") val thumbnailUrl: String? = null,
    @Json(name = "created_at") val createdAt: String? = null
)

@JsonClass(generateAdapter = true)
data class MusicDto(
    val id: String,
    val title: String,
    val artist: String? = null,
    val album: String? = null,
    val genre: String? = null,
    val description: String? = null,
    @Json(name = "thumbnail_url") val thumbnailUrl: String? = null,
    @Json(name = "audio_url") val audioUrl: String? = null,
    @Json(name = "file_provider") val fileProvider: String? = null,
    @Json(name = "file_storage_path") val fileStoragePath: String? = null,
    val lyrics: String? = null,
    @Json(name = "video_link") val videoLink: String? = null,
    @Json(name = "artist_image") val artistImage: String? = null,
    @Json(name = "artist_description") val artistDescription: String? = null,
    @Json(name = "album_image") val albumImage: String? = null,
    @Json(name = "album_description") val albumDescription: String? = null,
    @Json(name = "duration_seconds") val durationSeconds: Int? = null,
    @Json(name = "file_size_mb") val fileSizeMb: Double? = null,
    @Json(name = "sort_order") val sortOrder: Int? = null,
    @Json(name = "love_count") val loveCount: Int? = null,
    @Json(name = "views_count") val viewsCount: Long? = null,
    /** The registered reader who uploaded the song, when there is one. */
    @Json(name = "user_id") val userId: String? = null,
    @Json(name = "uploader_name") val uploaderName: String? = null,
    @Json(name = "created_at") val createdAt: String? = null
)

@JsonClass(generateAdapter = true)
data class CommentDto(
    val id: String,
    @Json(name = "blog_id") val blogId: String,
    @Json(name = "blog_title") val blogTitle: String? = null,
    val name: String,
    val address: String? = null,
    val content: String,
    val status: String? = null,
    @Json(name = "created_at") val createdAt: String? = null,
    @Json(name = "avatar_url") val avatarUrl: String? = null,
    @Json(name = "user_id") val userId: String? = null
)

@JsonClass(generateAdapter = true)
data class SettingsDto(
    val id: String,
    @Json(name = "site_title") val siteTitle: String? = null,
    @Json(name = "site_description") val siteDescription: String? = null,
    @Json(name = "logo_url") val logoUrl: String? = null,
    @Json(name = "contact_email") val contactEmail: String? = null,
    @Json(name = "contact_phone") val contactPhone: String? = null,
    @Json(name = "facebook_url") val facebookUrl: String? = null,
    @Json(name = "youtube_url") val youtubeUrl: String? = null,
    @Json(name = "instagram_url") val instagramUrl: String? = null,
    @Json(name = "hero_slider_enabled") val heroSliderEnabled: Boolean? = null,
    @Json(name = "featured_articles_enabled") val featuredArticlesEnabled: Boolean? = null,
    @Json(name = "special_articles_enabled") val specialArticlesEnabled: Boolean? = null,
    @Json(name = "allow_comments") val allowComments: Boolean? = null,
    @Json(name = "allow_user_submissions") val allowUserSubmissions: Boolean? = null
)

/**
 * Payload for the public comment insert. RLS grants `INSERT` to anonymous users
 * for `comments` only, and the default status is `Unpublish`, so anything posted
 * here waits for moderation in the dashboard.
 */
@JsonClass(generateAdapter = true)
data class NewCommentDto(
    @Json(name = "blog_id") val blogId: String,
    @Json(name = "blog_title") val blogTitle: String,
    val name: String,
    // Optional form fields map to NOT NULL database columns with empty defaults.
    val address: String = "",
    val email: String = "",
    val phone: String = "",
    val content: String,
    val status: String = "Unpublish",
    @Json(name = "avatar_url") val avatarUrl: String = "",
    @Json(name = "user_id") val userId: String? = null
)

// ---------------------------------------------------------------- tags (013)

/** Row of the `blog_tag_counts` view created by migration 013. */
@JsonClass(generateAdapter = true)
data class TagCountDto(
    @Json(name = "tag_key") val tagKey: String,
    val tag: String,
    @Json(name = "issue_year") val issueYear: Int? = null,
    @Json(name = "is_issue") val isIssue: Boolean? = null,
    val total: Int? = null,
    val published: Int? = null,
    /** Wire field: deserialised by Moshi, read by the dashboard's review screens. */
    val spellings: List<String>? = null
)

/** Row returned by the `blog_issue_years` RPC. */
@JsonClass(generateAdapter = true)
data class IssueYearDto(
    @Json(name = "issue_year") val issueYear: Int,
    val label: String? = null,
    val total: Int? = null
)

/** Minimal projection used for client-side category/author/tag statistics. */
@JsonClass(generateAdapter = true)
data class BlogFacetDto(
    val id: String,
    @Json(name = "category_id") val categoryId: String? = null,
    @Json(name = "category_slug") val categorySlug: String? = null,
    @Json(name = "author_id") val authorId: String? = null,
    val tags: List<String>? = null,
    @Json(name = "published_date") val publishedDate: String? = null,
    @Json(name = "created_at") val createdAt: String? = null,
    @Json(name = "views_count") val viewsCount: Long? = null
)


/** One day of the dashboard's views-over-time chart (`user_view_series` RPC). */
@JsonClass(generateAdapter = true)
data class ViewDayDto(
    val day: String,
    val views: Long? = null
)

/** `user_view_totals` RPC: what the reader's published work has been read/watched. */
@JsonClass(generateAdapter = true)
data class ViewTotalsDto(
    @Json(name = "article_views") val articleViews: Long? = null,
    @Json(name = "music_views") val musicViews: Long? = null
)

/** A published article as it appears on a public user page. */
@JsonClass(generateAdapter = true)
data class PublicArticleDto(
    val id: String,
    val title: String? = null,
    val slug: String? = null,
    val thumbnail: String? = null,
    @Json(name = "views_count") val viewsCount: Long? = null,
    @Json(name = "published_date") val publishedDate: String? = null,
    @Json(name = "created_at") val createdAt: String? = null,
    @Json(name = "category_title") val categoryTitle: String? = null
)

/** One of that user's uploads. Same fields the catalogue hands the player. */
@JsonClass(generateAdapter = true)
data class PublicSongDto(
    val id: String,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val genre: String? = null,
    @Json(name = "thumbnail_url") val thumbnailUrl: String? = null,
    @Json(name = "audio_url") val audioUrl: String? = null,
    @Json(name = "file_storage_path") val fileStoragePath: String? = null,
    @Json(name = "duration_seconds") val durationSeconds: Int? = null,
    @Json(name = "love_count") val loveCount: Int? = null,
    @Json(name = "views_count") val viewsCount: Long? = null,
    @Json(name = "created_at") val createdAt: String? = null
)

/** `public_profile` RPC — a registered reader's public page. */
@JsonClass(generateAdapter = true)
data class PublicProfileDto(
    val id: String,
    val name: String? = null,
    @Json(name = "avatar_url") val avatarUrl: String? = null,
    val designation: String? = null,
    val address: String? = null,
    @Json(name = "joined_at") val joinedAt: String? = null,
    /** Migration 028 adds these three to the same RPC. */
    val points: Int? = null,
    @Json(name = "month_points") val monthPoints: Int? = null,
    @Json(name = "article_views") val articleViews: Long? = null,
    @Json(name = "music_views") val musicViews: Long? = null,
    val articles: List<PublicArticleDto>? = null,
    val songs: List<PublicSongDto>? = null
)

// ---------------------------------------------------------------------- forum
//
// Six RPCs, one row shape. `forum_discussion_rows` (migration 029) is a view the
// database builds, so every one of these answers with the same keys — the app
// has one DTO for a card wherever it appears.

/** A forum room, with the counts the database keeps for it. */
@JsonClass(generateAdapter = true)
data class ForumCategoryDto(
    val id: String? = null,
    val slug: String? = null,
    val title: String? = null,
    val description: String? = null,
    val discussions: Int? = null,
    val replies: Int? = null,
    @Json(name = "is_locked") val isLocked: Boolean? = null
)

/** One discussion: a card in a list, a whole page on its own. */
@JsonClass(generateAdapter = true)
data class ForumDiscussionDto(
    val id: String? = null,
    @Json(name = "category_slug") val categorySlug: String? = null,
    @Json(name = "category_title") val categoryTitle: String? = null,
    val title: String? = null,
    val excerpt: String? = null,
    val body: String? = null,
    @Json(name = "author_id") val authorId: String? = null,
    @Json(name = "author_name") val authorName: String? = null,
    @Json(name = "author_avatar_url") val authorAvatarUrl: String? = null,
    @Json(name = "views_count") val views: Long? = null,
    @Json(name = "replies_count") val replies: Int? = null,
    @Json(name = "created_at") val createdAt: String? = null,
    @Json(name = "last_reply_at") val lastReplyAt: String? = null
)

@JsonClass(generateAdapter = true)
data class ForumReplyDto(
    val id: String? = null,
    @Json(name = "author_id") val authorId: String? = null,
    @Json(name = "author_name") val authorName: String? = null,
    @Json(name = "author_avatar_url") val authorAvatarUrl: String? = null,
    val body: String? = null,
    @Json(name = "created_at") val createdAt: String? = null
)

/** The forum home: rooms, latest activity, and the two totals. */
@JsonClass(generateAdapter = true)
data class ForumOverviewDto(
    val categories: List<ForumCategoryDto>? = null,
    val latest: List<ForumDiscussionDto>? = null,
    @Json(name = "total_discussions") val totalDiscussions: Int? = null,
    @Json(name = "total_replies") val totalReplies: Int? = null
)

/** One room. `null` from the RPC means the slug is not a room. */
@JsonClass(generateAdapter = true)
data class ForumCategoryPageDto(
    val category: ForumCategoryDto? = null,
    val discussions: List<ForumDiscussionDto>? = null,
    val total: Int? = null
)

@JsonClass(generateAdapter = true)
data class ForumSearchDto(
    val query: String? = null,
    val discussions: List<ForumDiscussionDto>? = null,
    val total: Int? = null
)

@JsonClass(generateAdapter = true)
data class ForumThreadDto(
    val discussion: ForumDiscussionDto? = null,
    val replies: List<ForumReplyDto>? = null
)


/** One reader on the monthly contributor board (migration 026 RPC). */
@JsonClass(generateAdapter = true)
data class ContributorDto(
    @Json(name = "user_id") val userId: String,
    val name: String? = null,
    @Json(name = "avatar_url") val avatarUrl: String? = null,
    val articles: Int? = null,
    val songs: Int? = null,
    val comments: Int? = null,
    val views: Long? = null,
    val seconds: Int? = null,
    val points: Int? = null
)

/** The board: which month it is, and who earned the most in it. */
@JsonClass(generateAdapter = true)
data class ContributorBoardDto(
    @Json(name = "month_key") val monthKey: String? = null,
    val contributors: List<ContributorDto>? = null
)

/** One window of a reader's own contribution (a month, or everything). */
@JsonClass(generateAdapter = true)
data class ContributionBlockDto(
    val articles: Int? = null,
    val songs: Int? = null,
    val comments: Int? = null,
    val views: Long? = null,
    val seconds: Int? = null,
    val points: Int? = null
)

/** A reader's own points: this month and since they joined. */
@JsonClass(generateAdapter = true)
data class ContributorScoreDto(
    @Json(name = "month_key") val monthKey: String? = null,
    val month: ContributionBlockDto? = null,
    val lifetime: ContributionBlockDto? = null
)
