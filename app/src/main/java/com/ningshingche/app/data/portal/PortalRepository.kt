package com.ningshingche.app.data.portal

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import retrofit2.Response
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * Public reader repository with moderated, anonymous comment submission.
 *
 * Design rules
 * ------------
 * 1. **The reader never authenticates.** Public RLS policies already restrict
 *    `blogs` and `comments` to `status = 'Publish'`, so the anonymous
 *    publishable key is both sufficient and correct. If you later front the API
 *    with a proxy that needs a token, add it in [PortalConfig.okHttpClient] —
 *    no call site has to change.
 * 2. **Every call returns a `Result`.** `PortalError` already carries a
 *    Bengali, user-presentable message.
 * 3. **Last-good-wins caching.** Reference data (categories, authors, PDFs,
 *    videos, settings) is cached in memory with a TTL; if the network fails the
 *    cached value is returned so the UI degrades instead of blanking out.
 * 4. **Paging is explicit.** Callers receive a [Page] with the exact total from
 *    `Content-Range`, which is what drives "load more" and the result counter in
 *    search.
 */
class PortalRepository(
    private val api: PortalApi
) {

    /**
     * The stable id this install reports when it counts a view while signed
     * out, so a guest is one viewer instead of an anonymous crowd. Set by the
     * application at startup; empty means guests all count as one.
     */
    var guestViewerId: String = ""

    // ------------------------------------------------------------------ cache

    private class CacheEntry<T>(val value: T, val storedAtMillis: Long) {
        fun isFresh(ttlMillis: Long) = System.currentTimeMillis() - storedAtMillis < ttlMillis
    }

    private val cacheMutex = Mutex()
    private val categoriesCache = mutableMapOf<String, CacheEntry<List<CategoryRef>>>()
    private val authorsCache = mutableMapOf<String, CacheEntry<List<AuthorRef>>>()
    private val pdfCache = mutableMapOf<String, CacheEntry<List<PdfBook>>>()
    private val videoCache = mutableMapOf<String, CacheEntry<List<VideoItem>>>()
    private val musicCache = mutableMapOf<String, CacheEntry<List<MusicTrack>>>()
    private val settingsCache = mutableMapOf<String, CacheEntry<SiteSettings>>()
    private val facetsCache = mutableMapOf<String, CacheEntry<List<BlogFacet>>>()
    private val issuesCache = mutableMapOf<String, CacheEntry<List<IssueSummary>>>()
    private val tagCountsCache = mutableMapOf<String, CacheEntry<List<TagCount>>>()

    /**
     * Tri-state memo of whether the migration 013 endpoints exist on this
     * database: `null` = not probed yet, `true` = available, `false` = missing
     * (fall back to scanning `blogs.tags` client-side).
     */
    @Volatile private var tagEndpointsAvailable: Boolean? = null

    private companion object {
        val TTL_REFERENCE = TimeUnit.MINUTES.toMillis(10)
        val TTL_SETTINGS = TimeUnit.HOURS.toMillis(1)
    }

    // ------------------------------------------------------------ home feed

    /**
     * One batched load for the home screen. Each section is fetched in parallel
     * and a failure in any single section degrades to an empty list rather than
     * failing the whole screen.
     */
    suspend fun homeFeed(): Result<HomeFeed> = withContext(Dispatchers.IO) {
        runCatching {
            coroutineScope {
                val hero = async { heroArticles().getOrNull().orEmpty() }
                val featured = async { featuredArticles().getOrNull().orEmpty() }
                val special = async { specialArticles().getOrNull().orEmpty() }
                val latest = async { latestArticles(limit = 5).getOrNull() }
                val categories = async { categories().getOrNull().orEmpty() }
                val authors = async { authors(limit = 16).getOrNull().orEmpty() }
                val gallery = async { galleries(limit = 12).getOrNull()?.items.orEmpty() }
                val pdfs = async { pdfBooks().getOrNull().orEmpty() }
                val videos = async { videos(limit = 8).getOrNull().orEmpty() }
                val music = async { musicTracks(limit = 8).getOrNull().orEmpty() }
                val settings = async { settings().getOrNull() ?: SiteSettings.DEFAULT }

                val latestPage = latest.await()
                if (latestPage == null && hero.await().isEmpty()) {
                    // Nothing at all came back — surface a real error instead of
                    // rendering an empty home screen.
                    throw PortalError.Unknown()
                }

                HomeFeed(
                    // With only 3 slider rows in the database the hero can look
                    // thin; top up from the newest articles so the carousel
                    // always has at least three panels.
                    hero = (hero.await().takeIf { it.size >= 3 } ?: (hero.await() + latestPage?.items.orEmpty()).distinctBy { it.id }.take(5)),
                    featured = featured.await().ifEmpty { latestPage?.items.orEmpty().take(6) },
                    special = special.await(),
                    latest = latestPage?.items.orEmpty(),
                    categories = categories.await(),
                    authors = authors.await(),
                    gallery = gallery.await(),
                    pdfBooks = pdfs.await(),
                    videos = videos.await(),
                    music = music.await(),
                    settings = settings.await()
                )
            }
        }.recoverCatching { throw it.toPortalError() }
    }

    // ----------------------------------------------------------------- blogs

    suspend fun heroArticles(): Result<List<ArticleSummary>> = withContext(Dispatchers.IO) {
        callList {
            api.blogs(
                status = "eq.Publish",
                isSlider = "eq.true",
                order = PortalApi.FEED_ORDER,
                limit = 6
            )
        }.map { list -> list.map { it.toSummary() } }
    }

    suspend fun featuredArticles(): Result<List<ArticleSummary>> = withContext(Dispatchers.IO) {
        callList {
            api.blogs(
                status = "eq.Publish",
                isFeature = "eq.true",
                order = PortalApi.FEED_ORDER,
                limit = 10
            )
        }.map { list -> list.map { it.toSummary() } }
    }

    suspend fun specialArticles(): Result<List<ArticleSummary>> = withContext(Dispatchers.IO) {
        callList {
            api.blogs(
                status = "eq.Publish",
                isSpecialArticle = "eq.true",
                order = PortalApi.FEED_ORDER,
                limit = 10
            )
        }.map { list -> list.map { it.toSummary() } }
    }

    suspend fun latestArticles(limit: Int = PortalConfig.PAGE_SIZE): Result<Page<ArticleSummary>> =
        withContext(Dispatchers.IO) {
            callPage {
                api.blogs(status = "eq.Publish", order = PortalApi.FEED_ORDER, limit = limit)
            }.map { page -> page.mapItems { it.toSummary() } }
        }

    /** Page through a category. `categoryId` is the UUID from [CategoryRef.id]. */
    suspend fun articlesByCategory(
        categoryId: String,
        limit: Int = PortalConfig.PAGE_SIZE,
        offset: Int = 0
    ): Result<Page<ArticleSummary>> = withContext(Dispatchers.IO) {
        callPage {
            api.blogs(
                status = "eq.Publish",
                categoryId = "eq.$categoryId",
                order = PortalApi.FEED_ORDER,
                limit = limit,
                offset = offset
            )
        }.map { page -> page.mapItems { it.toSummary() } }
    }

    suspend fun articlesByAuthor(
        authorId: String,
        limit: Int = PortalConfig.PAGE_SIZE,
        offset: Int = 0
    ): Result<Page<ArticleSummary>> = withContext(Dispatchers.IO) {
        callPage {
            api.blogs(
                status = "eq.Publish",
                authorId = "eq.$authorId",
                order = PortalApi.FEED_ORDER,
                limit = limit,
                offset = offset
            )
        }.map { page -> page.mapItems { it.toSummary() } }
    }

    // ------------------------------------------------------------ tags / issues

    /**
     * Per-article facets (category, author, tags) for every published article.
     * One ~5 KB request that lets Explore show real counts next to categories,
     * authors and annual issues instead of hard-coded numbers.
     */
    suspend fun facets(forceRefresh: Boolean = false): Result<List<BlogFacet>> =
        withContext(Dispatchers.IO) {
            cached("all", facetsCache, TTL_REFERENCE, forceRefresh) {
                callList { api.blogFacets() }.getOrThrow().map { it.toFacet() }
            }
        }

    /**
     * Articles of one annual issue (`নিংশিং চে - YYYY` tag, any spelling).
     *
     * Fast path: `tag_keys=cs.{নিংশিংচে-YYYY}` on the generated column from
     * migration 013. Fallback: `tags=ov.{…every known spelling…}` plus a
     * client-side [IssueTags.matchesIssue] check, which also catches spellings
     * the variant list does not enumerate but the normaliser understands.
     */
    suspend fun articlesByIssue(
        year: Int,
        limit: Int = PortalConfig.PAGE_SIZE,
        offset: Int = 0
    ): Result<Page<ArticleSummary>> = withContext(Dispatchers.IO) {
        if (tagEndpointsAvailable != false) {
            val viaKeys = callPage {
                api.blogs(
                    status = "eq.Publish",
                    tagKeys = "cs." + encodeArrayLiteral(listOf(IssueTags.issueKey(year))),
                    order = PortalApi.FEED_ORDER,
                    limit = limit,
                    offset = offset
                )
            }
            if (viaKeys.isSuccess) {
                tagEndpointsAvailable = true
                return@withContext viaKeys.map { page -> page.mapItems { it.toSummary() } }
            }
            if (viaKeys.exceptionOrNull() !is PortalError.SchemaMissing) {
                return@withContext viaKeys.map { page -> page.mapItems { it.toSummary() } }
            }
            tagEndpointsAvailable = false
        }
        callPage {
            api.blogs(
                status = "eq.Publish",
                tags = "ov." + encodeArrayLiteral(IssueTags.issueVariants(year)),
                order = PortalApi.FEED_ORDER,
                limit = limit,
                offset = offset
            )
        }.map { page ->
            page.mapItems { it.toSummary() }.let { mapped ->
                mapped.copy(items = mapped.items.filter { IssueTags.matchesIssue(it.tags, year) })
            }
        }
    }


    /**
     * One row per annual issue that actually has published articles, newest
     * first. Uses the `blog_issue_years` RPC when migration 013 is installed
     * and otherwise derives the same list from a light `id,tags` scan.
     */
    suspend fun issues(forceRefresh: Boolean = false): Result<List<IssueSummary>> =
        withContext(Dispatchers.IO) {
            cached("all", issuesCache, TTL_REFERENCE, forceRefresh) {
                if (tagEndpointsAvailable != false) {
                    val viaRpc = callList { api.issueYears() }
                    if (viaRpc.isSuccess) {
                        tagEndpointsAvailable = true
                        val rows = viaRpc.getOrThrow()
                            .filter { (it.total ?: 0) > 0 }
                            .map { IssueSummary(year = it.issueYear, articleCount = it.total ?: 0) }
                            .sortedByDescending { it.year }
                        if (rows.isNotEmpty()) return@cached rows
                    } else if (viaRpc.exceptionOrNull() is PortalError.SchemaMissing) {
                        tagEndpointsAvailable = false
                    } else {
                        throw viaRpc.exceptionOrNull() ?: PortalError.Unknown()
                    }
                }
                val rows = facets(forceRefresh = forceRefresh).getOrThrow()
                rows.flatMap { row -> row.tags.mapNotNull { IssueTags.issueYear(it) }.distinct() }
                    .groupingBy { it }
                    .eachCount()
                    .map { (year, count) -> IssueSummary(year = year, articleCount = count) }
                    .sortedByDescending { it.year }
            }
        }

    /**
     * Distinct tags with published-article counts (issue tags first, then by
     * frequency), merging every spelling of a tag into one row.
     */
    suspend fun tagCounts(forceRefresh: Boolean = false): Result<List<TagCount>> =
        withContext(Dispatchers.IO) {
            cached("all", tagCountsCache, TTL_REFERENCE, forceRefresh) {
                if (tagEndpointsAvailable != false) {
                    val viaView = callList { api.tagCounts() }
                    if (viaView.isSuccess) {
                        tagEndpointsAvailable = true
                        return@cached viaView.getOrThrow()
                            .filter { (it.published ?: it.total ?: 0) > 0 }
                            .map { row ->
                                TagCount(
                                    key = row.tagKey,
                                    label = row.issueYear?.let { IssueTags.issueLabel(it) } ?: IssueTags.clean(row.tag),
                                    issueYear = row.issueYear,
                                    count = row.published ?: row.total ?: 0
                                )
                            }
                    } else if (viaView.exceptionOrNull() is PortalError.SchemaMissing) {
                        tagEndpointsAvailable = false
                    } else {
                        throw viaView.exceptionOrNull() ?: PortalError.Unknown()
                    }
                }
                val rows = facets(forceRefresh = forceRefresh).getOrThrow()
                val counts = linkedMapOf<String, TagCount>()
                rows.forEach { row ->
                    row.tags
                        .distinctBy { IssueTags.keyOf(it) }
                        .forEach { tag ->
                            val key = IssueTags.keyOf(tag)
                            val year = IssueTags.issueYear(tag)
                            val previous = counts[key]
                            counts[key] = TagCount(
                                key = key,
                                label = year?.let { IssueTags.issueLabel(it) } ?: (previous?.label ?: tag),
                                issueYear = year,
                                count = (previous?.count ?: 0) + 1
                            )
                        }
                }
                counts.values.sortedWith(
                    compareByDescending<TagCount> { it.issueYear ?: Int.MIN_VALUE }
                        .thenByDescending { it.count }
                        .thenBy { it.label }
                )
            }
        }

    /**
     * Server-side search across the article text: title, subtitle, slug, author,
     * tags and body. Several words are separate conditions, so a reader can type
     * what they remember in any order — see [SearchQuery], which owns the filter
     * syntax and is unit-tested against the live database's behaviour.
     */
    suspend fun searchArticles(
        query: String,
        limit: Int = PortalConfig.PAGE_SIZE,
        offset: Int = 0
    ): Result<Page<ArticleSummary>> = withContext(Dispatchers.IO) {
        val filter = SearchQuery.build(query)
            ?: return@withContext Result.success(Page(emptyList(), total = 0, offset = offset, limit = limit))

        val encoded = SearchQuery.encode(filter.value)
        callPage {
            api.blogs(
                status = "eq.Publish",
                or = encoded.takeIf { filter.parameter == "or" },
                and = encoded.takeIf { filter.parameter == "and" },
                order = PortalApi.FEED_ORDER,
                limit = limit,
                offset = offset
            )
        }.map { page -> page.mapItems { it.toSummary() } }
    }

    /** Fetch a single article by UUID or slug (deep links use the slug). */
    suspend fun article(idOrSlug: String): Result<ArticleDetail> = withContext(Dispatchers.IO) {
        val trimmed = idOrSlug.trim()
        if (trimmed.isBlank()) return@withContext Result.failure(PortalError.NotFound)

        val isUuid = runCatching { java.util.UUID.fromString(trimmed) }.isSuccess

        callList {
            if (isUuid) {
                api.blogs(
                    select = PortalApi.BLOG_DETAIL_COLUMNS,
                    id = "eq.$trimmed",
                    limit = 1
                )
            } else {
                api.blogs(
                    select = PortalApi.BLOG_DETAIL_COLUMNS,
                    slug = "eq.${escapeFilterValue(trimmed)}",
                    limit = 1
                )
            }
        }.mapCatching { list ->
            val first = list.firstOrNull()
            if (first != null) {
                first.toDetail()
            } else if (isUuid) {
                val fallback = api.blogs(
                    select = PortalApi.BLOG_DETAIL_COLUMNS,
                    slug = "eq.${escapeFilterValue(trimmed)}",
                    limit = 1
                ).body()?.firstOrNull()
                fallback?.toDetail() ?: throw PortalError.NotFound
            } else {
                throw PortalError.NotFound
            }
        }.map { detail -> detail.withFreshViewCount() }
    }

    /**
     * Counts this reading of the article and folds the new total into the
     * article the screen is about to show.
     *
     * A failed count is not an error the reader should see — the article is
     * open, the number is simply the one the row carried.
     */
    private suspend fun ArticleDetail.withFreshViewCount(): ArticleDetail {
        val total = recordArticleView(summary.id).getOrNull() ?: return this
        return copy(summary = summary.copy(viewsCount = total))
    }

    // --------------------------------------------------------- public profile

    /**
     * A registered reader's public page (migration 024 RPC). `profiles` and
     * `submitted_blogs` are select-own, so the page is assembled by the
     * database, which is also what keeps the writer's contact details off it.
     */
    suspend fun publicProfile(userId: String): Result<PublicProfile> =
        withContext(Dispatchers.IO) {
            val id = userId.trim()
            if (id.isBlank()) return@withContext Result.failure(PortalError.NotFound)
            callOne { api.publicProfile(mapOf("p_user_id" to id)) }
                .mapCatching { dto -> dto?.toModel() ?: throw PortalError.NotFound }
        }

    // ----------------------------------------------------------- contributors

    /**
     * The monthly contributor board (migration 026 RPC).
     *
     * Signed-in readers only — the function is granted to `authenticated` alone,
     * so a guest gets a 401/403 here rather than an empty board, and the screen
     * turns that into its sign-in gate.
     */
    suspend fun contributorBoard(limit: Int = 50): Result<ContributorBoard> =
        withContext(Dispatchers.IO) {
            callOne {
                api.contributorLeaderboard(mapOf("p_limit" to limit.coerceIn(1, 100).toString()))
            }.mapCatching { it.toModel() }
        }

    /** The reader's own points, this month and lifetime (migration 026 RPC). */
    suspend fun contributorPoints(userId: String): Result<ContributorScore> =
        withContext(Dispatchers.IO) {
            val id = userId.trim()
            if (id.isBlank()) return@withContext Result.failure(PortalError.NotFound)
            callOne { api.contributorPoints(mapOf("p_user_id" to id)) }
                .mapCatching { it.toModel() }
        }

    /**
     * Reports seconds spent in the app (migration 026 RPC) and returns the
     * reader's total for today, so the caller can tell a stored report from a
     * dropped one.
     */
    suspend fun recordAppTime(seconds: Int): Result<Int> = withContext(Dispatchers.IO) {
        val granted = seconds.coerceIn(0, 3600)
        if (granted == 0) return@withContext Result.success(0)
        callOne { api.recordAppTime(mapOf("p_seconds" to granted.toString())) }
    }

    // ------------------------------------------------------------------ views

    /** Counts one article view; the result is the item's new public total. */
    suspend fun recordArticleView(articleId: String): Result<Long> = recordView("blog", articleId)

    /** Counts one play of a song; the result is the track's new public total. */
    suspend fun recordMusicView(trackId: String): Result<Long> = recordView("music", trackId)

    private suspend fun recordView(type: String, id: String): Result<Long> =
        withContext(Dispatchers.IO) {
            val target = id.trim()
            if (target.isBlank()) return@withContext Result.failure(PortalError.NotFound)
            callOne {
                api.recordContentView(
                    mapOf(
                        "p_type" to type,
                        "p_id" to target,
                        "p_device_id" to guestViewerId
                    )
                )
            }
        }

    /** The reader's own article/song view totals, straight from the database. */
    suspend fun viewTotals(userId: String): Result<ViewTotals> = withContext(Dispatchers.IO) {
        val id = userId.trim()
        if (id.isBlank()) return@withContext Result.failure(PortalError.NotFound)
        callOne { api.viewTotals(mapOf("p_user_id" to id)) }
            .mapCatching { dto -> dto?.toModel() ?: ViewTotals(0L, 0L) }
    }

    /** One row per day for the reader's views-over-time chart. */
    suspend fun viewSeries(userId: String, days: Int = 30): Result<List<ViewDay>> =
        withContext(Dispatchers.IO) {
            val id = userId.trim()
            if (id.isBlank()) return@withContext Result.failure(PortalError.NotFound)
            callList {
                api.viewSeries(
                    mapOf("p_user_id" to id, "p_days" to days.coerceIn(1, 365).toString())
                )
            }.mapCatching { rows -> rows.map { it.toModel() } }
        }

    // ------------------------------------------------------------ reference

    suspend fun categories(forceRefresh: Boolean = false): Result<List<CategoryRef>> =
        withContext(Dispatchers.IO) {
            cached("all", categoriesCache, TTL_REFERENCE, forceRefresh) {
                callList { api.categories(limit = 100) }.getOrThrow().map { it.toRef() }
            }
        }

    suspend fun categoryBySlug(slug: String): Result<CategoryRef> = withContext(Dispatchers.IO) {
        val trimmed = slug.trim()
        if (trimmed.isBlank()) return@withContext Result.failure(PortalError.NotFound)
        callList { api.categoryBySlug(slug = "eq.${escapeFilterValue(trimmed)}") }.mapCatching { list ->
            list.firstOrNull()?.toRef() ?: throw PortalError.NotFound
        }
    }

    suspend fun authors(
        limit: Int = 50,
        offset: Int = 0,
        forceRefresh: Boolean = false
    ): Result<List<AuthorRef>> = withContext(Dispatchers.IO) {
        cached("authors-$limit-$offset", authorsCache, TTL_REFERENCE, forceRefresh) {
            callList { api.authors(limit = limit, offset = offset) }.getOrThrow().map { it.toRef() }
        }
    }

    suspend fun author(id: String): Result<AuthorRef> = withContext(Dispatchers.IO) {
        val trimmed = id.trim()
        if (trimmed.isBlank()) return@withContext Result.failure(PortalError.NotFound)
        callList { api.authorById(id = "eq.$trimmed") }.mapCatching { list ->
            list.firstOrNull()?.toRef() ?: throw PortalError.NotFound
        }
    }

    suspend fun galleries(
        category: String? = null,
        limit: Int = 24,
        offset: Int = 0
    ): Result<Page<GalleryItem>> = withContext(Dispatchers.IO) {
        val catFilter = category?.trim()?.takeIf { it.isNotBlank() }?.let { "eq.${escapeFilterValue(it)}" }
        callPage {
            api.galleries(category = catFilter, limit = limit, offset = offset)
        }.map { page -> page.mapItems { it.toItem() } }
    }

    suspend fun pdfBooks(forceRefresh: Boolean = false): Result<List<PdfBook>> =
        withContext(Dispatchers.IO) {
            cached("all", pdfCache, TTL_REFERENCE, forceRefresh) {
                callList { api.pdfBooks(limit = 100) }.getOrThrow().map { it.toModel() }
            }
        }

    suspend fun videos(limit: Int = 20, forceRefresh: Boolean = false): Result<List<VideoItem>> =
        withContext(Dispatchers.IO) {
            cached("videos-$limit", videoCache, TTL_REFERENCE, forceRefresh) {
                callList { api.videos(limit = limit) }.getOrThrow().map { it.toItem() }
            }
        }

    suspend fun musicTracks(limit: Int = 50, forceRefresh: Boolean = false): Result<List<MusicTrack>> =
        withContext(Dispatchers.IO) {
            cached("music-$limit", musicCache, TTL_REFERENCE, forceRefresh) {
                val selects = listOf(
                    PortalApi.MUSIC_COLUMNS_WITH_VIEWS,
                    PortalApi.MUSIC_COLUMNS_WITH_LOVE,
                    PortalApi.MUSIC_COLUMNS_WITH_META,
                    PortalApi.MUSIC_COLUMNS_WITH_VIDEO,
                    PortalApi.MUSIC_COLUMNS_WITH_LYRICS,
                    PortalApi.MUSIC_COLUMNS
                )
                var rows: List<MusicDto>? = null
                var lastError: Throwable? = null
                for (select in selects) {
                    val attempt = callList { api.musicTracks(select = select, limit = limit) }
                    if (attempt.isSuccess) {
                        rows = attempt.getOrThrow()
                        break
                    }
                    lastError = attempt.exceptionOrNull()
                    if (lastError !is PortalError.SchemaMissing) break
                }
                (rows ?: throw lastError ?: PortalError.Unknown())
                    .map { it.toItem() }
                    .filter { it.hasPlayableSource() }
            }
        }

    suspend fun settings(forceRefresh: Boolean = false): Result<SiteSettings> =
        withContext(Dispatchers.IO) {
            cached("site_settings", settingsCache, TTL_SETTINGS, forceRefresh) {
                callList { api.settings() }.getOrThrow().firstOrNull()?.toModel()
                    ?: SiteSettings.DEFAULT
            }
        }

    // ------------------------------------------------------------- comments

    suspend fun comments(blogId: String): Result<List<CommentItem>> = withContext(Dispatchers.IO) {
        val withAvatar = callList {
            api.comments(
                select = PortalApi.COMMENT_COLUMNS,
                blogId = "eq.$blogId",
                status = "eq.Publish",
                limit = 100
            )
        }
        if (withAvatar.isSuccess) {
            return@withContext withAvatar.map { list -> list.map { it.toItem() } }
        }
        if (withAvatar.exceptionOrNull() is PortalError.SchemaMissing) {
            return@withContext callList {
                api.comments(
                    select = PortalApi.COMMENT_COLUMNS_WITHOUT_AVATAR,
                    blogId = "eq.$blogId",
                    status = "eq.Publish",
                    limit = 100
                )
            }.map { list -> list.map { it.toItem() } }
        }
        withAvatar.map { list -> list.map { it.toItem() } }
    }

    /**
     * Public comment submission. RLS inserts the row as `Unpublish`, so it is
     * invisible until a moderator approves it in the dashboard.
     */
    suspend fun postComment(
        blogId: String,
        blogTitle: String,
        name: String,
        email: String?,
        content: String,
        phone: String = "",
        address: String = "",
        avatarUrl: String = "",
        userId: String? = null
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val response = api.postComment(
                NewCommentDto(
                    blogId = blogId,
                    blogTitle = blogTitle,
                    name = name.trim(),
                    address = address.trim(),
                    email = email.orEmpty().trim(),
                    phone = phone.trim(),
                    content = content.trim(),
                    status = "Unpublish",
                    avatarUrl = avatarUrl.trim(),
                    userId = userId?.takeIf { it.isNotBlank() }
                )
            )
            // The successful anonymous insert has no response body (201/204).
            if (!response.isSuccessful) throw httpError(response.code(), response)
            Result.success(Unit)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            Result.failure(error.toPortalError())
        }
    }

    // -------------------------------------------------------------- plumbing

    /** Unwraps a list response, mapping HTTP/transport failures to [PortalError]. */
    private suspend fun <T> callList(block: suspend () -> Response<List<T>>): Result<List<T>> =
        runCatching {
            val response = block()
            if (!response.isSuccessful) throw httpError(response.code(), response)
            response.body().orEmpty()
        }.recoverCatching { throw it.toPortalError() }

    /** Unwraps a single-object or scalar response, treating an empty body as missing. */
    private suspend fun <T : Any> callOne(block: suspend () -> Response<T?>): Result<T> =
        runCatching {
            val response = block()
            if (!response.isSuccessful) throw httpError(response.code(), response)
            response.body() ?: throw PortalError.NotFound
        }.recoverCatching { throw it.toPortalError() }

    /** Same as [callList] but also parses `Content-Range` into [Page.total]. */
    private suspend fun <T> callPage(block: suspend () -> Response<List<T>>): Result<Page<T>> =
        runCatching {
            val response = block()
            if (!response.isSuccessful) throw httpError(response.code(), response)
            val body = response.body().orEmpty()
            Page(
                items = body,
                total = parseContentRangeTotal(response.headers()["Content-Range"]),
                offset = 0,
                limit = body.size
            )
        }.recoverCatching { throw it.toPortalError() }

    private fun httpError(code: Int, response: Response<*>): PortalError {
        val raw = response.errorBody()?.string().orEmpty()
        val body = runCatching {
            PortalConfig.moshi.adapter(Map::class.java).fromJson(raw)
        }.getOrNull()
        val message = (body?.get("message") as? String)?.takeIf { it.isNotBlank() }
            ?: (body?.get("error_description") as? String)
        val bodyCode = body?.get("code") as? String
        return when {
            code == 404 || raw.contains("PGRST205") ->
                PortalError.SchemaMissing("ডেটাবেজ টেবিল পাওয়া যায়নি। অনুগ্রহ করে সার্ভার কনফিগারেশন যাচাই করুন।")
            raw.contains("PGRST204") || raw.contains("42703") ->
                PortalError.SchemaMissing("ডেটাবেজ আপডেট প্রয়োজন।")
            isSignInRefusal(code, bodyCode, message) -> PortalError.SignedOut()
            else -> PortalError.Http(code, message?.takeIf { it.isNotBlank() } ?: "সার্ভার ত্রুটি ($code)")
        }
    }

    /**
     * True when the database refused the call because it saw no session.
     *
     * The auth-gated RPCs raise `42501` (`insufficient_privilege`) — migration
     * 026 does, and PostgREST may render that as a 401 or a 403 depending on its
     * version — so the body's own code and wording are matched as well as the
     * status. That way a signed-in reader is told their session needs renewing
     * whichever shape the refusal arrives in, and never sees the English
     * sentence the function raised.
     */
    internal fun isSignInRefusal(code: Int, bodyCode: String?, message: String?): Boolean =
        bodyCode == "42501" ||
            code == 401 ||
            (code == 403 && message?.contains("signed-in readers", ignoreCase = true) == true)

    /** Example header "0-19/50" yields 50; "0-19/star" or malformed yields null. */
    internal fun parseContentRangeTotal(header: String?): Int? {
        if (header.isNullOrBlank()) return null
        val total = header.substringAfterLast('/', "").trim()
        return total.toIntOrNull()
    }

    /**
     * Percent-encode a value that is interpolated into a PostgREST filter.
     * Commas, parentheses and asterisks are structural in `or=`/`ilike`, so they
     * must never arrive unescaped from user input or a Bengali slug.
     */
    private fun escapeFilterValue(value: String): String =
        URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    /**
     * PostgREST array literal for `cs.` / `ov.` filters, e.g. `{"a","b c"}`.
     * Braces, quotes and commas are structural and stay raw; the values are
     * percent-encoded because the query parameter is sent `encoded = true`.
     */
    private fun encodeArrayLiteral(values: Collection<String>): String =
        values.distinct().joinToString(",", prefix = "{", postfix = "}") { value ->
            "\"" + escapeFilterValue(value.replace("\\", "\\\\").replace("\"", "\\\"")) + "\""
        }

    private suspend fun <T> cached(
        key: String,
        store: MutableMap<String, CacheEntry<T>>,
        ttlMillis: Long,
        forceRefresh: Boolean,
        fetch: suspend () -> T
    ): Result<T> {
        if (!forceRefresh) {
            val hit = cacheMutex.withLock { store[key]?.takeIf { it.isFresh(ttlMillis) } }
            if (hit != null) return Result.success(hit.value)
        }
        return runCatching { fetch() }
            .onSuccess { value ->
                cacheMutex.withLock { store[key] = CacheEntry(value, System.currentTimeMillis()) }
            }
            .recoverCatching { error ->
                val stale = cacheMutex.withLock { store[key]?.value }
                if (stale != null) return@recoverCatching stale
                throw error.toPortalError()
            }
    }

    private inline fun <T, R> Page<T>.mapItems(transform: (T) -> R): Page<R> = Page(
        items = items.map(transform),
        total = total,
        offset = offset,
        limit = limit
    )
}
