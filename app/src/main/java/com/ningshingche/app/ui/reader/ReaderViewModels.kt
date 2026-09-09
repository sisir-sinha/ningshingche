package com.ningshingche.app.ui.reader

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.ningshingche.app.data.auth.GoogleAuthRepository
import com.ningshingche.app.data.preferences.CommenterDetails
import com.ningshingche.app.data.preferences.CommenterDetailsStore
import com.ningshingche.app.data.portal.ArticleDetail
import com.ningshingche.app.data.remote.UserProfile
import com.ningshingche.app.data.portal.ArticleSummary
import com.ningshingche.app.data.portal.AuthorRef
import com.ningshingche.app.data.portal.CategoryRef
import com.ningshingche.app.data.portal.CommentItem
import com.ningshingche.app.data.portal.HomeFeed
import com.ningshingche.app.data.music.MusicCatalogIndex
import com.ningshingche.app.data.portal.MusicTrack
import com.ningshingche.app.data.portal.VideoItem
import com.ningshingche.app.data.portal.Page
import com.ningshingche.app.data.portal.PortalError
import com.ningshingche.app.NinghsingCheApp
import com.ningshingche.app.data.portal.PortalRepository
import com.ningshingche.app.data.portal.GalleryItem
import com.ningshingche.app.data.portal.IssueSummary
import com.ningshingche.app.data.portal.IssueTags
import com.ningshingche.app.data.portal.PortalConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * ViewModels for the public reader.
 *
 * One rule runs through all of them: **the UI state is a single sealed value**,
 * so a screen is either loading, has content, or has an error — never two of
 * those at once. Paged screens additionally keep `isLoadingMore` and `total`
 * alongside a `Ready` state so a "load more" failure does not blank the list.
 */

private fun PortalError?.message(): String =
    (this as? PortalError)?.message ?: "তথ্য লোড করতে সমস্যা হয়েছে।"

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

sealed interface HomeUiState {
    data object Loading : HomeUiState
    data class Ready(val feed: HomeFeed, val isRefreshing: Boolean = false) : HomeUiState
    data class Error(val message: String) : HomeUiState
}

class HomeViewModel(private val repository: PortalRepository) : ViewModel() {

    private val _state = MutableStateFlow<HomeUiState>(HomeUiState.Loading)
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    /** Set when the feed falls back to cached/stale data after a failure. */
    private val _offlineNotice = MutableStateFlow<String?>(null)
    val offlineNotice: StateFlow<String?> = _offlineNotice.asStateFlow()

    private val _videoCatalog = MutableStateFlow<List<VideoItem>>(emptyList())
    val videoCatalog: StateFlow<List<VideoItem>> = _videoCatalog.asStateFlow()

    private val _videosLoading = MutableStateFlow(false)
    val videosLoading: StateFlow<Boolean> = _videosLoading.asStateFlow()

    private val _musicCatalog = MutableStateFlow<List<MusicTrack>>(emptyList())
    val musicCatalog: StateFlow<List<MusicTrack>> = _musicCatalog.asStateFlow()

    private val _musicLoading = MutableStateFlow(false)
    val musicLoading: StateFlow<Boolean> = _musicLoading.asStateFlow()

    private val _musicError = MutableStateFlow<String?>(null)
    val musicError: StateFlow<String?> = _musicError.asStateFlow()

    init { load() }

    fun loadVideoCatalog(force: Boolean = false) {
        viewModelScope.launch {
            _videosLoading.value = _videoCatalog.value.isEmpty()
            repository.videos(limit = 200, forceRefresh = force)
                .onSuccess { _videoCatalog.value = it }
                .onFailure {
                    if (_videoCatalog.value.isEmpty()) {
                        _videoCatalog.value =
                            (_state.value as? HomeUiState.Ready)?.feed?.videos.orEmpty()
                    }
                }
            _videosLoading.value = false
        }
    }

    fun loadMusicCatalog(force: Boolean = false) {
        viewModelScope.launch {
            _musicLoading.value = _musicCatalog.value.isEmpty()
            _musicError.value = null
            repository.musicTracks(limit = 500, forceRefresh = force)
                .onSuccess {
                    _musicCatalog.value = it
                    _musicError.value = null
                }
                .onFailure { error ->
                    if (_musicCatalog.value.isEmpty()) {
                        _musicCatalog.value =
                            (_state.value as? HomeUiState.Ready)?.feed?.music.orEmpty()
                    }
                    if (_musicCatalog.value.isEmpty()) {
                        _musicError.value = (error as? PortalError).message()
                    }
                }
            _musicLoading.value = false
        }
    }

    fun load(force: Boolean = false) {
        viewModelScope.launch {
            val isRefresh = _state.value is HomeUiState.Ready
            if (isRefresh) {
                _state.update { (it as HomeUiState.Ready).copy(isRefreshing = true) }
            } else {
                _state.value = HomeUiState.Loading
            }

            repository.homeFeed()
                .onSuccess { feed ->
                    _state.value = HomeUiState.Ready(feed)
                    _offlineNotice.value = null
                    val notifier = runCatching { NinghsingCheApp.instance.contentUpdateNotifier }.getOrNull()
                    notifier?.ingest(feed, notify = false)
                }
                .onFailure { error ->
                    val portalError = error as? PortalError
                    val previous = (_state.value as? HomeUiState.Ready)?.feed
                    if (previous != null) {
                        // Keep showing what we have; pull-to-refresh just stops.
                        _state.value = HomeUiState.Ready(previous)
                        _offlineNotice.value = portalError.message()
                    } else {
                        _state.value = HomeUiState.Error(portalError.message())
                    }
                }
        }
    }
}

// ---------------------------------------------------------------------------
// Article reader
// ---------------------------------------------------------------------------

sealed interface ArticleUiState {
    data object Loading : ArticleUiState
    data class Ready(
        val article: ArticleDetail,
        val author: AuthorRef? = null,
        val comments: List<CommentItem> = emptyList(),
        val related: List<ArticleSummary> = emptyList(),
        val commentPosted: Boolean = false,
        val isRefreshing: Boolean = false
    ) : ArticleUiState
    data class Error(val message: String) : ArticleUiState
}

/** In-memory draft only: no SavedStateHandle or persistent comment-content field. */
data class CommentFormState(
    val name: String = "",
    val email: String = "",
    val phone: String = "",
    val address: String = "",
    val avatarUrl: String = "",
    val content: String = "",
    val detailsLoaded: Boolean = false,
    val identityFromAccount: Boolean = false,
    val isError: Boolean = false
)

class ArticleViewModel(
    private val repository: PortalRepository,
    private val commenterDetailsStore: CommenterDetailsStore,
    private val currentUser: kotlinx.coroutines.flow.StateFlow<UserProfile?> = kotlinx.coroutines.flow.MutableStateFlow(null)
) : ViewModel() {

    private val _state = MutableStateFlow<ArticleUiState>(ArticleUiState.Loading)
    val state: StateFlow<ArticleUiState> = _state.asStateFlow()

    private val _commentStatus = MutableStateFlow<String?>(null)
    val commentStatus: StateFlow<String?> = _commentStatus.asStateFlow()

    private val _isPostingComment = MutableStateFlow(false)
    val isPostingComment: StateFlow<Boolean> = _isPostingComment.asStateFlow()

    private val _commentForm = MutableStateFlow(CommentFormState())
    val commentForm: StateFlow<CommentFormState> = _commentForm.asStateFlow()

    private var currentIdOrSlug: String = ""

    init {
        viewModelScope.launch {
            try {
                val saved = commenterDetailsStore.details.first()
                _commentForm.value = CommentFormState(
                    name = saved.name, email = saved.email, phone = saved.phone,
                    detailsLoaded = true
                )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // A local storage problem must never require login or block commenting.
                _commentForm.update { it.copy(detailsLoaded = true) }
            }
            currentUser.collect { user ->
                if (user != null) {
                    val name = user.composedFullName().ifBlank { user.fullName }
                    _commentForm.update { form ->
                        form.copy(
                            name = name.ifBlank { form.name },
                            email = user.email.ifBlank { form.email },
                            phone = user.phone.ifBlank { form.phone },
                            address = user.address.ifBlank { form.address },
                            avatarUrl = user.avatarUrl.ifBlank { form.avatarUrl },
                            identityFromAccount = true,
                            detailsLoaded = true
                        )
                    }
                } else {
                    _commentForm.update { it.copy(identityFromAccount = false) }
                }
            }
        }
    }

    fun updateCommentForm(form: CommentFormState) {
        if (_isPostingComment.value || !_commentForm.value.detailsLoaded) return
        _commentForm.value = form.copy(detailsLoaded = true, isError = false)
        _commentStatus.value = null
    }

    fun retry() {
        if (currentIdOrSlug.isNotBlank()) {
            load(currentIdOrSlug)
        }
    }

    fun refresh() {
        if (currentIdOrSlug.isBlank()) return
        val currentReady = _state.value as? ArticleUiState.Ready
        if (currentReady != null) {
            _state.value = currentReady.copy(isRefreshing = true)
        }
        viewModelScope.launch {
            val detail = repository.article(currentIdOrSlug)
            if (detail.isSuccess) {
                val article = detail.getOrThrow()
                val authorId = article.summary.authorId
                val authorRef = if (!authorId.isNullOrBlank()) {
                    repository.author(authorId).getOrNull()
                } else null
                val comments = repository.comments(article.id).getOrNull().orEmpty()
                val related = relatedOf(article)

                _state.value = ArticleUiState.Ready(
                    article = article,
                    author = authorRef ?: currentReady?.author,
                    comments = comments,
                    related = related,
                    isRefreshing = false
                )
            } else {
                if (currentReady != null) {
                    _state.value = currentReady.copy(isRefreshing = false)
                } else {
                    _state.value = ArticleUiState.Error((detail.exceptionOrNull() as? PortalError).message())
                }
            }
        }
    }

    fun load(idOrSlug: String) {
        if (currentIdOrSlug.isNotBlank() && currentIdOrSlug != idOrSlug.trim()) {
            _commentForm.update { it.copy(content = "", isError = false) }
            _commentStatus.value = null
        }
        currentIdOrSlug = idOrSlug.trim()
        if (currentIdOrSlug.isBlank()) {
            _state.value = ArticleUiState.Error("প্রবন্ধটি পাওয়া যায়নি।")
            return
        }
        viewModelScope.launch {
            _state.value = ArticleUiState.Loading
            val detail = repository.article(currentIdOrSlug)

            if (detail.isFailure) {
                _state.value = ArticleUiState.Error((detail.exceptionOrNull() as? PortalError).message())
                return@launch
            }

            val article = detail.getOrThrow()
            _state.value = ArticleUiState.Ready(article)

            // Load author details if available
            launch {
                val authorId = article.summary.authorId
                if (!authorId.isNullOrBlank()) {
                    val authorRef = repository.author(authorId).getOrNull()
                    if (authorRef != null) {
                        _state.update { current ->
                            (current as? ArticleUiState.Ready)?.copy(author = authorRef) ?: current
                        }
                    }
                }
            }

            // Comments and related reading are secondary: fetch them together
            // and drop either one if it fails rather than failing the article.
            launch {
                val comments = repository.comments(article.id).getOrNull().orEmpty()
                _state.update { current ->
                    (current as? ArticleUiState.Ready)?.copy(comments = comments) ?: current
                }
            }
            launch {
                val related = relatedOf(article)
                _state.update { current ->
                    (current as? ArticleUiState.Ready)?.copy(related = related) ?: current
                }
            }
        }
    }

    /** Same category first, then same author, capped at four. */
    private suspend fun relatedOf(article: ArticleDetail): List<ArticleSummary> {
        val categoryId = article.summary.categoryId
        val authorId = article.summary.authorId
        val picks = mutableListOf<ArticleSummary>()
        if (!categoryId.isNullOrBlank()) {
            repository.articlesByCategory(categoryId, limit = 8)
                .getOrNull()?.items?.let { picks += it }
        }
        if (picks.size < 4 && !authorId.isNullOrBlank()) {
            repository.articlesByAuthor(authorId, limit = 8)
                .getOrNull()?.items?.let { picks += it }
        }
        return picks
            .filter { it.id != article.id }
            .distinctBy { it.id }
            .take(4)
    }

    fun postComment() {
        if (_isPostingComment.value || !_commentForm.value.detailsLoaded) return
        val current = (_state.value as? ArticleUiState.Ready) ?: return
        val form = _commentForm.value
        val account = currentUser.value
        val name = account?.composedFullName()?.ifBlank { account.fullName }?.ifBlank { form.name } ?: form.name
        val email = account?.email?.ifBlank { form.email } ?: form.email
        val phone = account?.phone?.ifBlank { form.phone } ?: form.phone
        val address = account?.address?.ifBlank { form.address } ?: form.address
        val avatarUrl = account?.avatarUrl?.ifBlank { form.avatarUrl } ?: form.avatarUrl
        val invalid = when {
            name.isBlank() || form.content.isBlank() -> if (account != null) "মন্তব্য আবশ্যক।" else "নাম ও মন্তব্য আবশ্যক।"
            email.isNotBlank() && !Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(email.trim()) ->
                "সঠিক ইমেইল দিন অথবা ঐচ্ছিক ঘরটি খালি রাখুন।"
            else -> null
        }
        if (invalid != null) {
            _commentForm.update { it.copy(isError = true) }
            _commentStatus.value = invalid
            return
        }
        // Set synchronously, before launching: rapid taps must not create duplicate POSTs.
        _isPostingComment.value = true
        _commentForm.update { it.copy(isError = false) }
        _commentStatus.value = "মন্তব্য পাঠানো হচ্ছে..."
        viewModelScope.launch {
            try {
                repository.postComment(
                    blogId = current.article.id,
                    blogTitle = current.article.title,
                    name = name,
                    email = email,
                    phone = phone,
                    content = form.content,
                    address = address,
                    avatarUrl = avatarUrl,
                    userId = account?.id
                ).onSuccess {
                    val details = CommenterDetails(name.trim(), email.trim(), phone.trim())
                    // Clear the draft ONLY after the server confirms the insert.
                    _commentForm.update {
                        it.copy(
                            name = details.name,
                            email = details.email,
                            phone = details.phone,
                            address = address,
                            avatarUrl = avatarUrl,
                            content = "",
                            isError = false,
                            identityFromAccount = account != null
                        )
                    }
                    _commentStatus.value = "মন্তব্য জমা হয়েছে। অনুমোদনের পর প্রকাশিত হবে।"
                    _state.update { state ->
                        (state as? ArticleUiState.Ready)?.takeIf { it.article.id == current.article.id }
                            ?.copy(commentPosted = true) ?: state
                    }
                    try {
                        commenterDetailsStore.save(details)
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        // The comment succeeded. Never report a failed POST or invite a duplicate
                        // submission merely because saving local contact details failed.
                        _commentStatus.value = "মন্তব্য জমা হয়েছে। অনুমোদনের পর প্রকাশিত হবে। তবে এই ডিভাইসে আপনার তথ্য মনে রাখা যায়নি।"
                    }
                }.onFailure { error ->
                    _commentForm.update { it.copy(isError = true) }
                    _commentStatus.value = if (error is PortalError.Offline) {
                        "ইন্টারনেট সংযোগ যাচাই করে আবার চেষ্টা করুন। আপনার মন্তব্য মুছে ফেলা হয়নি।"
                    } else (error as? PortalError).message()
                }
            } finally {
                _isPostingComment.value = false
            }
        }
    }

    fun clearCommentStatus() {
        _commentStatus.value = null
        _commentForm.update { it.copy(isError = false) }
    }

}

// ---------------------------------------------------------------------------
// Paged article lists (category, author, search)
// ---------------------------------------------------------------------------

sealed interface ListUiState {
    data object Loading : ListUiState
    data class Ready(
        val articles: List<ArticleSummary>,
        val total: Int? = null,
        val isLoadingMore: Boolean = false,
        val endReached: Boolean = false
    ) : ListUiState
    data class Error(val message: String) : ListUiState
}

/** Shared paging logic so category, author and search lists behave identically. */
private class ArticlePaginator(
    private val scope: kotlinx.coroutines.CoroutineScope,
    private val fetch: suspend (limit: Int, offset: Int) -> Result<Page<ArticleSummary>>
) {
    private val _state = MutableStateFlow<ListUiState>(ListUiState.Loading)
    val state: StateFlow<ListUiState> = _state.asStateFlow()

    fun loadFirst() {
        _state.value = ListUiState.Loading
        scope.launch {
            fetch(PAGE_SIZE, 0)
                .onSuccess { page ->
                    _state.value = ListUiState.Ready(
                        articles = page.items,
                        total = page.total,
                        endReached = page.items.size < PAGE_SIZE
                    )
                }
                .onFailure { _state.value = ListUiState.Error((it as? PortalError).message()) }
        }
    }

    fun loadMore() {
        val current = _state.value as? ListUiState.Ready ?: return
        if (current.isLoadingMore || current.endReached) return
        _state.value = current.copy(isLoadingMore = true)
        scope.launch {
            fetch(PAGE_SIZE, current.articles.size)
                .onSuccess { page ->
                    val merged = (current.articles + page.items).distinctBy { it.id }
                    _state.value = ListUiState.Ready(
                        articles = merged,
                        total = page.total ?: current.total,
                        endReached = page.items.isEmpty() || merged.size >= (page.total ?: Int.MAX_VALUE)
                    )
                }
                .onFailure {
                    _state.value = current.copy(isLoadingMore = false, endReached = true)
                }
        }
    }

    private companion object { const val PAGE_SIZE = 20 }
}

class CategoryViewModel(
    private val repository: PortalRepository,
    private val categorySlug: String
) : ViewModel() {

    private val _category = MutableStateFlow<CategoryRef?>(null)
    val category: StateFlow<CategoryRef?> = _category.asStateFlow()

    private val paginator = ArticlePaginator(viewModelScope) { limit, offset ->
        val id = _category.value?.id
            ?: repository.categoryBySlug(categorySlug).getOrNull()?.also { _category.value = it }?.id
        if (id == null) Result.failure(PortalError.NotFound)
        else repository.articlesByCategory(id, limit = limit, offset = offset)
    }
    val state: StateFlow<ListUiState> = paginator.state

    init { load() }

    fun load() {
        viewModelScope.launch {
            repository.categoryBySlug(categorySlug)
                .onSuccess { _category.value = it }
                .onFailure { _category.value = null }
            paginator.loadFirst()
        }
    }

    fun loadMore() = paginator.loadMore()
}

class AuthorViewModel(
    private val repository: PortalRepository,
    private val authorId: String
) : ViewModel() {

    private val _author = MutableStateFlow<AuthorRef?>(null)
    val author: StateFlow<AuthorRef?> = _author.asStateFlow()

    private val paginator = ArticlePaginator(viewModelScope) { limit, offset ->
        repository.articlesByAuthor(authorId, limit = limit, offset = offset)
    }
    val state: StateFlow<ListUiState> = paginator.state

    init { load() }

    fun load() {
        viewModelScope.launch {
            repository.author(authorId).onSuccess { _author.value = it }
            paginator.loadFirst()
        }
    }

    fun loadMore() = paginator.loadMore()
}

/** Articles of one annual issue (`নিংশিং চে - YYYY` tag, any spelling). */
class IssueViewModel(
    private val repository: PortalRepository,
    val year: Int
) : ViewModel() {

    private val paginator = ArticlePaginator(viewModelScope) { limit, offset ->
        repository.articlesByIssue(year, limit = limit, offset = offset)
    }
    val state: StateFlow<ListUiState> = paginator.state

    init { load() }

    fun load() = paginator.loadFirst()

    fun loadMore() = paginator.loadMore()
}

// ---------------------------------------------------------------------------
// Explore
// ---------------------------------------------------------------------------

data class CategoryFacet(val category: CategoryRef, val articleCount: Int)

data class AuthorFacet(val author: AuthorRef, val articleCount: Int)

/** Everything the four Explore tabs show, loaded from the live API in one batch. */
data class ExploreData(
    val categories: List<CategoryFacet>,
    val authors: List<AuthorFacet>,
    val issues: List<IssueSummary>,
    val popular: List<ArticleSummary>
)

sealed interface ExploreUiState {
    data object Loading : ExploreUiState
    data class Ready(val data: ExploreData, val isRefreshing: Boolean = false) : ExploreUiState
    data class Error(val message: String) : ExploreUiState
}

/** "সামাজিক কার্যকলাপ": gallery entries + articles of the সমাজ ও সংস্কৃতি category. */
sealed interface SocialUiState {
    data object Loading : SocialUiState
    data class Ready(
        val galleries: List<GalleryItem>,
        val articles: List<ArticleSummary>,
        val isRefreshing: Boolean = false
    ) : SocialUiState
    data class Error(val message: String) : SocialUiState
}

/**
 * Explore ("অন্বেষণ ও সংগ্রহ").
 *
 * - **Categories**: the `categories` table with a real published-article count
 *   per category, derived from the facet scan (the table has no counter column).
 * - **Authors**: the `authors` table with a real article count; authors without
 *   a published article are listed last.
 * - **Issues**: annual `নিংশিং চে - YYYY` tags that actually have published
 *   articles (RPC from migration 013 when available, tag scan otherwise).
 * - **Popular & selected**: `is_special_article`/`is_feature` rows first, then
 *   the most viewed articles from the feed.
 */
class ExploreViewModel(private val repository: PortalRepository) : ViewModel() {

    private val _state = MutableStateFlow<ExploreUiState>(ExploreUiState.Loading)
    val state: StateFlow<ExploreUiState> = _state.asStateFlow()

    private val _offlineNotice = MutableStateFlow<String?>(null)
    val offlineNotice: StateFlow<String?> = _offlineNotice.asStateFlow()

    init { load() }

    fun load(force: Boolean = false) {
        viewModelScope.launch {
            val previous = (_state.value as? ExploreUiState.Ready)?.data
            _state.value = if (previous != null) ExploreUiState.Ready(previous, isRefreshing = true) else ExploreUiState.Loading

            val result = runCatching {
                coroutineScope {
                    val categories = async { repository.categories(forceRefresh = force) }
                    val authors = async { repository.authors(limit = 200, forceRefresh = force) }
                    val facets = async { repository.facets(forceRefresh = force) }
                    val issues = async { repository.issues(forceRefresh = force) }
                    val special = async { repository.specialArticles().getOrNull().orEmpty() }
                    val featured = async { repository.featuredArticles().getOrNull().orEmpty() }
                    val latest = async { repository.latestArticles(limit = PortalConfig.MAX_PAGE_SIZE).getOrNull()?.items.orEmpty() }

                    val facetRows = facets.await().getOrNull().orEmpty()
                    val categoryRefs = categories.await().getOrThrow()
                    val authorRefs = authors.await().getOrThrow()

                    val byCategoryId = facetRows.groupingBy { it.categoryId.orEmpty() }.eachCount()
                    val byCategorySlug = facetRows.groupingBy { it.categorySlug }.eachCount()
                    val byAuthor = facetRows.groupingBy { it.authorId.orEmpty() }.eachCount()

                    val categoryFacets = categoryRefs
                        .map { ref ->
                            CategoryFacet(
                                category = ref,
                                articleCount = byCategoryId[ref.id] ?: byCategorySlug[ref.slug] ?: 0
                            )
                        }
                        .sortedWith(compareByDescending<CategoryFacet> { it.articleCount }.thenBy { it.category.title })

                    val authorFacets = authorRefs
                        .map { ref -> AuthorFacet(author = ref, articleCount = byAuthor[ref.id] ?: 0) }
                        .sortedWith(
                            compareByDescending<AuthorFacet> { it.articleCount > 0 }
                                .thenByDescending { it.author.isVerified }
                                .thenByDescending { it.articleCount }
                                .thenBy { it.author.name }
                        )

                    val issueList = issues.await().getOrElse { error ->
                        if (facetRows.isEmpty()) throw error
                        // Derive from the facet scan so the tab still fills in.
                        facetRows.flatMap { row -> row.tags.mapNotNull { IssueTags.issueYear(it) }.distinct() }
                            .groupingBy { it }.eachCount()
                            .map { (year, count) -> IssueSummary(year, count) }
                            .sortedByDescending { it.year }
                    }

                    val curated = (special.await() + featured.await()).distinctBy { it.id }
                    val mostViewed = latest.await()
                        .filter { article -> curated.none { it.id == article.id } }
                        .sortedByDescending { it.viewsCount }
                    val popular = (curated + mostViewed).take(40)

                    ExploreData(
                        categories = categoryFacets,
                        authors = authorFacets,
                        issues = issueList,
                        popular = popular
                    )
                }
            }

            result
                .onSuccess { data ->
                    _state.value = ExploreUiState.Ready(data)
                    _offlineNotice.value = null
                }
                .onFailure { error ->
                    if (error is CancellationException) throw error
                    val message = (error as? PortalError).message()
                    if (previous != null) {
                        _state.value = ExploreUiState.Ready(previous)
                        _offlineNotice.value = message
                    } else {
                        _state.value = ExploreUiState.Error(message)
                    }
                }
        }
    }

    fun clearOfflineNotice() {
        _offlineNotice.value = null
    }

    // ----------------------------------------------------- social activities

    private val _socialState = MutableStateFlow<SocialUiState>(SocialUiState.Loading)
    val socialState: StateFlow<SocialUiState> = _socialState.asStateFlow()
    private var socialJob: Job? = null

    fun loadSocial(force: Boolean = false) {
        val current = _socialState.value
        if (!force && current is SocialUiState.Ready) return
        if (socialJob?.isActive == true) return
        socialJob = viewModelScope.launch {
            val previous = current as? SocialUiState.Ready
            _socialState.value = previous?.copy(isRefreshing = true) ?: SocialUiState.Loading
            val result = runCatching {
                coroutineScope {
                    val galleries = async {
                        repository.galleries(category = SOCIAL_CATEGORY_TITLE, limit = 40).getOrNull()?.items.orEmpty()
                    }
                    val articles = async {
                        val categories = repository.categories(forceRefresh = force).getOrNull().orEmpty()
                        val social = categories.firstOrNull { it.title.trim() == SOCIAL_CATEGORY_TITLE }
                            ?: categories.firstOrNull { it.title.contains("সমাজ") }
                        if (social == null) emptyList()
                        else repository.articlesByCategory(social.id, limit = PortalConfig.MAX_PAGE_SIZE)
                            .getOrThrow().items
                    }
                    SocialUiState.Ready(galleries = galleries.await(), articles = articles.await())
                }
            }
            result
                .onSuccess { _socialState.value = it }
                .onFailure { error ->
                    if (error is CancellationException) throw error
                    _socialState.value = previous?.copy(isRefreshing = false)
                        ?: SocialUiState.Error((error as? PortalError).message())
                }
        }
    }

    private companion object {
        const val SOCIAL_CATEGORY_TITLE = "সমাজ ও সংস্কৃতি"
    }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

class SearchViewModel(private val repository: PortalRepository) : ViewModel() {

    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    private val paginator = ArticlePaginator(viewModelScope) { limit, offset ->
        repository.searchArticles(_query.value, limit = limit, offset = offset)
    }
    val state: StateFlow<ListUiState> = paginator.state

    private val _suggestions = MutableStateFlow<List<String>>(emptyList())
    val suggestions: StateFlow<List<String>> = _suggestions.asStateFlow()

    private val _categories = MutableStateFlow<List<CategoryRef>>(emptyList())
    val categories: StateFlow<List<CategoryRef>> = _categories.asStateFlow()

    private val _songs = MutableStateFlow<List<MusicTrack>>(emptyList())
    val songs: StateFlow<List<MusicTrack>> = _songs.asStateFlow()

    private var musicCatalog: List<MusicTrack> = emptyList()
    private var debounceJob: Job? = null

    init {
        viewModelScope.launch {
            _categories.value = repository.categories().getOrNull().orEmpty()
        }
        viewModelScope.launch {
            _suggestions.value = repository.categories().getOrNull()
                ?.take(8)?.map { it.title }
                .orEmpty()
        }
        viewModelScope.launch {
            musicCatalog = repository.musicTracks(limit = 500).getOrNull().orEmpty()
            filterSongs()
        }
    }

    fun onQueryChange(value: String) {
        _query.value = value
        filterSongs()
        debounceJob?.cancel()
        if (value.trim().length < 2) {
            _state_reset()
            return
        }
        debounceJob = viewModelScope.launch {
            delay(320) // debounce so we do not fire a request per keystroke
            paginator.loadFirst()
        }
    }

    fun submit(query: String) {
        debounceJob?.cancel()
        _query.value = query
        filterSongs()
        paginator.loadFirst()
    }

    fun loadMore() = paginator.loadMore()

    private fun filterSongs() {
        val term = _query.value.trim()
        _songs.value = if (term.length < 2) {
            emptyList()
        } else {
            musicCatalog.filter { MusicCatalogIndex.matches(it, term) }
                .take(12)
        }
    }

    private fun _state_reset() {
        // Nothing to show before the term reaches two characters.
        viewModelScope.launch { paginator.loadFirst() }
    }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

class ReaderViewModelFactory(
    private val repository: PortalRepository,
    private val commenterDetailsStore: CommenterDetailsStore,
    private val googleAuthRepository: GoogleAuthRepository
) : ViewModelProvider.Factory {

    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = when {
        modelClass.isAssignableFrom(HomeViewModel::class.java) ->
            HomeViewModel(repository) as T
        modelClass.isAssignableFrom(ArticleViewModel::class.java) ->
            ArticleViewModel(repository, commenterDetailsStore, googleAuthRepository.currentUser) as T
        modelClass.isAssignableFrom(SearchViewModel::class.java) ->
            SearchViewModel(repository) as T
        modelClass.isAssignableFrom(ExploreViewModel::class.java) ->
            ExploreViewModel(repository) as T
        else -> throw IllegalArgumentException("Unknown ViewModel: ${modelClass.name}")
    }
}

class IssueViewModelFactory(
    private val repository: PortalRepository,
    private val year: Int
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T =
        IssueViewModel(repository, year) as T
}

/** Keyed factories for the parameterised list screens. */
class CategoryViewModelFactory(
    private val repository: PortalRepository,
    private val categorySlug: String
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T =
        CategoryViewModel(repository, categorySlug) as T
}

class AuthorViewModelFactory(
    private val repository: PortalRepository,
    private val authorId: String
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T =
        AuthorViewModel(repository, authorId) as T
}
