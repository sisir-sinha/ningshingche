package com.ningshingche.app.data.portal

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Headers
import retrofit2.http.POST
import retrofit2.http.Query

/**
 * PostgREST surface used by the public reader.
 *
 * Notes on the query parameters
 * -----------------------------
 * - `select` projects columns. The reader never pulls `content` into a list; it
 *   is requested only for the single-article call, which keeps feed responses at
 *   roughly 2 KB per row instead of 20 KB.
 * - Filters use PostgREST's `column=operator.value` syntax. `ilike` and `or`
 *   carry `*`, `(`, `)` and `,` characters, so those parameters are annotated
 *   `encoded = true` and are pre-encoded by [PortalRepository.filters] helpers
 *   where needed.
 * - `limit`/`offset` drive paging; the exact total comes back in the
 *   `Content-Range` response header when `Prefer: count=exact` is sent.
 * - `nullslast` keeps rows without a published date at the end rather than the
 *   top of a descending feed.
 */
interface PortalApi {

    companion object {
        /** Feed/list projection — deliberately excludes `content`. */
        const val BLOG_LIST_COLUMNS =
            "id,title,sub_title,slug,image,category_id,category_title,category_slug," +
                "author_id,author_name,author_image,tags,status,is_slider,is_feature," +
                "is_special_article,views_count,reading_time_minutes,published_date,created_at"

        /** Single-article projection — adds the body and related media. */
        const val BLOG_DETAIL_COLUMNS =
            "$BLOG_LIST_COLUMNS,content,seo_title,seo_description,video_link,pdf_book_link"

        const val CATEGORY_COLUMNS = "id,title,sub_title,slug,icon_name"
        const val TAG_COUNT_COLUMNS = "tag_key,tag,issue_year,is_issue,total,published,spellings"
        const val FACET_COLUMNS = "id,category_id,category_slug,author_id,tags,published_date,created_at,views_count"
        const val AUTHOR_COLUMNS = "id,title,image,designation,description,is_verified,location"
        const val GALLERY_COLUMNS = "id,title,description,image,category,created_at"
        const val PDF_COLUMNS =
            "id,title,image,book_published_date,link,file_provider,author_or_editor," +
                "edition,category,page_count,file_size_mb,description"
        const val VIDEO_COLUMNS = "id,title,video_link,platform,description,thumbnail_url,created_at"
        const val MUSIC_COLUMNS =
            "id,title,artist,album,genre,description,thumbnail_url,audio_url," +
                "file_provider,file_storage_path,duration_seconds,file_size_mb,sort_order,created_at"
        const val MUSIC_COLUMNS_WITH_LYRICS = "$MUSIC_COLUMNS,lyrics"
        const val MUSIC_COLUMNS_WITH_VIDEO = "$MUSIC_COLUMNS_WITH_LYRICS,video_link"
        const val MUSIC_COLUMNS_WITH_META =
            "$MUSIC_COLUMNS_WITH_VIDEO,artist_image,artist_description,album_image,album_description"
        const val MUSIC_COLUMNS_WITH_LOVE = "$MUSIC_COLUMNS_WITH_META,love_count"
        /** Love count plus the uploader and the public play count (migrations 024-025). */
        const val MUSIC_COLUMNS_WITH_VIEWS =
            "$MUSIC_COLUMNS_WITH_LOVE,user_id,uploader_name,views_count"
        const val COMMENT_COLUMNS = "id,blog_id,blog_title,name,address,content,status,created_at,avatar_url,user_id"
        const val COMMENT_COLUMNS_WITHOUT_AVATAR = "id,blog_id,blog_title,name,address,content,status,created_at"
        const val SETTINGS_COLUMNS =
            "id,site_title,site_description,logo_url,contact_email,contact_phone," +
                "facebook_url,youtube_url,instagram_url,hero_slider_enabled," +
                "featured_articles_enabled,special_articles_enabled,allow_comments," +
                "allow_user_submissions"

        const val FEED_ORDER = "published_date.desc.nullslast,created_at.desc"
    }

    // ------------------------------------------------------------------ blogs

    @Headers("Prefer: count=exact")
    @GET("blogs")
    suspend fun blogs(
        @Query("select") select: String = BLOG_LIST_COLUMNS,
        @Query("id") id: String? = null,
        @Query("slug", encoded = true) slug: String? = null,
        @Query("status") status: String? = null,
        @Query("category_id") categoryId: String? = null,
        @Query("author_id") authorId: String? = null,
        @Query("is_slider") isSlider: String? = null,
        @Query("is_feature") isFeature: String? = null,
        @Query("is_special_article") isSpecialArticle: String? = null,
        @Query("title", encoded = true) title: String? = null,
        @Query("or", encoded = true) or: String? = null,
        /** Nested conditions for a multi-word search — see `SearchQuery`. */
        @Query("and", encoded = true) and: String? = null,
        /** `ov.{…}` / `cs.{…}` against the raw `tags` column (exact spellings). */
        @Query("tags", encoded = true) tags: String? = null,
        /** `cs.{…}` against the generated `tag_keys` column (migration 013). */
        @Query("tag_keys", encoded = true) tagKeys: String? = null,
        @Query("order") order: String? = FEED_ORDER,
        @Query("limit") limit: Int? = null,
        @Query("offset") offset: Int? = null
    ): Response<List<BlogDto>>


    // ------------------------------------------------------------------- tags

    /**
     * Aggregated tag counts (migration 013 view). Returns 404 / PGRST205 on a
     * database that has not run the migration — callers must fall back to
     * scanning `blogs.tags` client-side.
     */
    @GET("blog_tag_counts")
    suspend fun tagCounts(
        @Query("select") select: String = TAG_COUNT_COLUMNS,
        @Query("order") order: String = "issue_year.desc.nullslast,total.desc",
        @Query("limit") limit: Int? = 200
    ): Response<List<TagCountDto>>

    // ------------------------------------------------------------- public page

    /**
     * Everything a public user page shows, in one request (migration 024 RPC).
     * `profiles` and `submitted_blogs` are both select-own, so the page cannot
     * be assembled from the tables themselves.
     */
    @POST("rpc/public_profile")
    suspend fun publicProfile(
        @Body body: Map<String, String>
    ): Response<PublicProfileDto?>

    // ------------------------------------------------------------------ views

    /**
     * Counts one view of an article or a song and answers with the new total
     * (migration 025 RPC). Safe for guests: the function identifies them by a
     * device-derived pseudonym, and counts the same viewer once a day.
     */
    @POST("rpc/record_content_view")
    suspend fun recordContentView(
        @Body body: Map<String, String>
    ): Response<Long?>

    /** The reader's own article/song view totals (migration 025 RPC). */
    @POST("rpc/user_view_totals")
    suspend fun viewTotals(
        @Body body: Map<String, String>
    ): Response<ViewTotalsDto?>

    /** One row per day for the last `p_days` days, empty days included. */
    @POST("rpc/user_view_series")
    suspend fun viewSeries(
        @Body body: Map<String, String>
    ): Response<List<ViewDayDto>>

    /** Published article count per annual issue (migration 013 RPC). */
    @POST("rpc/blog_issue_years")
    suspend fun issueYears(
        @Body body: Map<String, String> = emptyMap()
    ): Response<List<IssueYearDto>>

    /**
     * Lightweight facet projection (no titles, no bodies — ~100 bytes per row)
     * used to count published articles per category, author, tag and issue
     * client-side. Also the fallback for tag statistics when the migration 013
     * endpoints are unavailable.
     */
    @GET("blogs")
    suspend fun blogFacets(
        @Query("select") select: String = FACET_COLUMNS,
        @Query("status") status: String = "eq.Publish",
        @Query("limit") limit: Int = 1000
    ): Response<List<BlogFacetDto>>

    // ------------------------------------------------------------- categories

    @GET("categories")
    suspend fun categories(
        @Query("select") select: String = CATEGORY_COLUMNS,
        @Query("order") order: String = "title.asc",
        @Query("limit") limit: Int? = null
    ): Response<List<CategoryDto>>

    @GET("categories")
    suspend fun categoryBySlug(
        @Query("select") select: String = CATEGORY_COLUMNS,
        @Query("slug", encoded = true) slug: String,
        @Query("limit") limit: Int = 1
    ): Response<List<CategoryDto>>

    // ---------------------------------------------------------------- authors

    @GET("authors")
    suspend fun authors(
        @Query("select") select: String = AUTHOR_COLUMNS,
        @Query("order") order: String = "title.asc",
        @Query("limit") limit: Int? = null,
        @Query("offset") offset: Int? = null
    ): Response<List<AuthorDto>>

    @GET("authors")
    suspend fun authorById(
        @Query("select") select: String = AUTHOR_COLUMNS,
        @Query("id") id: String,
        @Query("limit") limit: Int = 1
    ): Response<List<AuthorDto>>

    // -------------------------------------------------------------- galleries

    @Headers("Prefer: count=exact")
    @GET("galleries")
    suspend fun galleries(
        @Query("select") select: String = GALLERY_COLUMNS,
        @Query("category", encoded = true) category: String? = null,
        @Query("order") order: String = "created_at.desc",
        @Query("limit") limit: Int? = null,
        @Query("offset") offset: Int? = null
    ): Response<List<GalleryDto>>

    // -------------------------------------------------------------- pdf books

    @GET("pdf_books")
    suspend fun pdfBooks(
        @Query("select") select: String = PDF_COLUMNS,
        @Query("order") order: String = "book_published_date.desc.nullslast,created_at.desc",
        @Query("limit") limit: Int? = null
    ): Response<List<PdfBookDto>>

    // ----------------------------------------------------------------- videos

    @GET("videos")
    suspend fun videos(
        @Query("select") select: String = VIDEO_COLUMNS,
        @Query("order") order: String = "created_at.desc",
        @Query("limit") limit: Int? = null
    ): Response<List<VideoDto>>

    // ------------------------------------------------------------------ music

    @GET("music_tracks")
    suspend fun musicTracks(
        @Query("select") select: String = MUSIC_COLUMNS,
        @Query("order") order: String = "sort_order.asc,created_at.desc",
        @Query("limit") limit: Int? = null
    ): Response<List<MusicDto>>

    // --------------------------------------------------------------- comments

    @GET("comments")
    suspend fun comments(
        @Query("select") select: String = COMMENT_COLUMNS,
        @Query("blog_id") blogId: String? = null,
        @Query("status") status: String? = null,
        @Query("order") order: String = "created_at.desc",
        @Query("limit") limit: Int? = null
    ): Response<List<CommentDto>>

    /**
     * Anonymous comment submission. Allowed by the `comments_public_insert`
     * RLS policy; the row lands as `Unpublish` until a moderator approves it.
     */
    // Anonymous users may INSERT an Unpublish row, but may not SELECT it.
    // Asking for a representation triggers the SELECT policy and rejects the insert.
    @Headers("Prefer: return=minimal")
    @POST("comments")
    suspend fun postComment(
        @Body comment: NewCommentDto
    ): Response<Unit>

    // --------------------------------------------------------------- settings

    @GET("settings")
    suspend fun settings(
        @Query("select") select: String = SETTINGS_COLUMNS,
        @Query("id") id: String = "eq.site_settings",
        @Query("limit") limit: Int = 1
    ): Response<List<SettingsDto>>
}
