package com.ningshingche.app.ui.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.ningshingche.app.data.ai.NinghsingCheAiAssistant
import com.ningshingche.app.data.local.ArticleAiChatStore
import com.ningshingche.app.data.auth.GoogleAuthException
import com.ningshingche.app.data.auth.GoogleAuthMapper
import com.ningshingche.app.NinghsingCheApp
import com.ningshingche.app.data.auth.GoogleAuthRepository
import com.ningshingche.app.data.remote.SupabaseClient
import com.ningshingche.app.data.remote.UserProfile
import com.ningshingche.app.data.model.AiChatMessage
import com.ningshingche.app.data.i18n.TranslationRepository
import com.ningshingche.app.data.model.AppThemeMode
import com.ningshingche.app.data.model.ContentLanguage
import com.ningshingche.app.data.model.Article
import com.ningshingche.app.data.model.Author
import com.ningshingche.app.data.model.Category
import com.ningshingche.app.data.model.PdfCategory
import com.ningshingche.app.data.model.PdfDocument
import com.ningshingche.app.data.model.PdfReaderSettings
import com.ningshingche.app.data.model.ReaderPreferences
import com.ningshingche.app.data.model.ReadingHistory
import com.ningshingche.app.data.model.YearArchive
import com.ningshingche.app.data.preferences.UserPreferencesRepository
import com.ningshingche.app.data.portal.PdfBook
import com.ningshingche.app.data.portal.PortalRepository
import com.ningshingche.app.data.repository.ArticleRepository
import com.ningshingche.app.data.repository.WebsiteSyncState
import java.io.File
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.UUID

// Home ViewModel
class HomeViewModel(
    private val repository: ArticleRepository
) : ViewModel() {

    val allArticles: StateFlow<List<Article>> = repository.getAllArticles()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val featuredArticles: StateFlow<List<Article>> = repository.getFeaturedArticles()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val categories: StateFlow<List<Category>> = repository.categories
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), repository.getCategories())

    val authors: StateFlow<List<Author>> = repository.authors
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), repository.getAuthors())

    val yearArchives: StateFlow<List<YearArchive>> = repository.yearArchives
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), repository.getYearArchives())

    val pdfDocuments: StateFlow<List<PdfDocument>> = repository.pdfDocuments
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), repository.getPdfDocuments())

    val syncState: StateFlow<WebsiteSyncState> = repository.syncState
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), WebsiteSyncState())

    val readingHistory: StateFlow<List<ReadingHistory>> = repository.getReadingHistory()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _scrollToTop = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val scrollToTop: SharedFlow<Unit> = _scrollToTop.asSharedFlow()


    fun refreshFromWebsite() {
        viewModelScope.launch {
            repository.syncFromWebsite()
        }
    }
}

data class SavedCategory(val slug: String, val title: String, val count: Int)

/**
 * App-wide saved-article state: the set of bookmarked ids plus a toggle. One
 * instance lives for the whole activity so every article card (home, lists,
 * explore, reader) shows the same save state instantly.
 */
class SavedArticlesViewModel(
    private val repository: ArticleRepository
) : ViewModel() {

    val savedIds: StateFlow<Set<String>> = repository.getAllBookmarks()
        .map { bookmarks -> bookmarks.map { it.articleId }.toSet() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptySet())

    fun toggle(articleId: String, announce: Boolean = true) {
        if (articleId.isBlank()) return
        val wasSaved = articleId in savedIds.value
        viewModelScope.launch { repository.toggleBookmark(articleId) }
        if (!announce) return
        if (wasSaved) {
            com.ningshingche.app.ui.components.AppToasts.undo("সংরক্ষণ সরানো হয়েছে") {
                toggle(articleId, announce = false)
            }
        } else {
            com.ningshingche.app.ui.components.AppToasts.undo("প্রবন্ধ সংরক্ষণ হয়েছে") {
                toggle(articleId, announce = false)
            }
        }
    }
}

// Bookmarks ViewModel
class BookmarksViewModel(
    private val repository: ArticleRepository
) : ViewModel() {

    private val _searchSavedQuery = MutableStateFlow("")
    val searchSavedQuery: StateFlow<String> = _searchSavedQuery.asStateFlow()

    private val _selectedCategoryFilter = MutableStateFlow<String?>(null)
    val selectedCategoryFilter: StateFlow<String?> = _selectedCategoryFilter.asStateFlow()

    /** Saved articles, newest save first (regardless of search/filter). */
    private val savedArticles: StateFlow<List<Article>> = combine(
        repository.getAllBookmarks(),
        repository.getAllArticles()
    ) { bookmarks, allArticles ->
        val savedAt = bookmarks.associate { it.articleId to it.savedAtTimestamp }
        allArticles.filter { it.id in savedAt }
            .sortedByDescending { savedAt[it.id] ?: 0L }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val savedCount: StateFlow<Int> = savedArticles
        .map { it.size }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0)

    /** Categories that actually contain saved articles, with counts. */
    val savedCategories: StateFlow<List<SavedCategory>> = savedArticles
        .map { articles ->
            articles.groupBy { it.categorySlug }
                .map { (slug, items) -> SavedCategory(slug, items.first().category.ifBlank { slug }, items.size) }
                .sortedWith(compareByDescending<SavedCategory> { it.count }.thenBy { it.title })
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val bookmarkedArticles: StateFlow<List<Article>> = combine(
        savedArticles,
        _searchSavedQuery,
        _selectedCategoryFilter
    ) { saved, query, categoryFilter ->
        saved.filter { art ->
            val matchQuery = query.isBlank() ||
                art.title.contains(query, ignoreCase = true) ||
                art.authorName.contains(query, ignoreCase = true) ||
                art.category.contains(query, ignoreCase = true)
            val matchCategory = categoryFilter == null || art.categorySlug == categoryFilter
            matchQuery && matchCategory
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun onSearchQueryChange(query: String) {
        _searchSavedQuery.value = query
    }

    fun setCategoryFilter(slug: String?) {
        _selectedCategoryFilter.value = if (_selectedCategoryFilter.value == slug) null else slug
    }

    fun removeBookmark(articleId: String, announce: Boolean = true) {
        viewModelScope.launch {
            repository.toggleBookmark(articleId)
        }
        if (announce) {
            com.ningshingche.app.ui.components.AppToasts.undo("সংরক্ষণ সরানো হয়েছে") {
                removeBookmark(articleId, announce = false)
            }
        }
    }
}

// AI Assistant ViewModel
class AiViewModel(
    private val aiAssistant: NinghsingCheAiAssistant,
    private val chatStore: ArticleAiChatStore
) : ViewModel() {

    private val welcomeMessage = AiChatMessage(
        id = "welcome",
        text = "নমস্কার! আমি নিংশিং চে AI সহকারী। বিষ্ণুপ্রিয়া মণিপুরি ভাষা, সাহিত্য, ঐতিহ্য ও সাধারণ জ্ঞানের প্রবন্ধ বিশ্লেষণ করে আমি সঠিক তথ্য প্রদান করি। ইঞ্চৌঘর, মিংকৌ, ভাষা আন্দোলন বা যেকোনো বিষয়ে প্রশ্ন করতে পারেন।",
        isUser = false,
        citations = emptyList(),
        suggestedQuestions = listOf(
            "বিষ্ণুপ্রিয়া মণিপুরি ভাষা আন্দোলনের ইতিহাস কী?",
            "মণিপুরি সমাজের ঐতিহ্যবাহী 'ইঞ্চৌঘর' কী?",
            "মণিপুরি সমাজে 'মিংকৌ' নামপ্রথা কী?"
        )
    )

    private val _messages = MutableStateFlow(listOf(welcomeMessage))
    val messages: StateFlow<List<AiChatMessage>> = _messages.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    val suggestedQuestions = listOf(
        "বিষ্ণুপ্রিয়া মণিপুরি ভাষা আন্দোলনের ইতিহাস কী?",
        "মণিপুরি সমাজের ঐতিহ্যবাহী 'ইঞ্চৌঘর' কী?",
        "মণিপুরি সমাজে 'মিংকৌ' নামপ্রথা কী?",
        "বিশু উৎসব কীভাবে পালিত হয়?",
        "শহীদ সুদেষ্ণা সিংহের আত্মত্যাগ সম্পর্কে বলুন",
        "মহারাস ও রাখাল রাসের বিশেষত্ব কী?"
    )

    init {
        viewModelScope.launch {
            val stored = chatStore.load(ArticleAiChatStore.GLOBAL_THREAD)
            if (stored.isNotEmpty()) {
                _messages.value = stored
            }
        }
    }

    fun sendQuestion(question: String) {
        if (question.isBlank() || _isLoading.value) return

        val userMessage = AiChatMessage(
            id = UUID.randomUUID().toString(),
            text = question.trim(),
            isUser = true
        )

        val currentHistory = _messages.value
        _messages.value = currentHistory + userMessage
        _isLoading.value = true
        persist(userMessage)

        viewModelScope.launch {
            try {
                val response = aiAssistant.answerQuestion(
                    userQuestion = question.trim(),
                    history = currentHistory
                )
                _messages.value = _messages.value + response
                persist(response)
            } catch (e: Exception) {
                val error = AiChatMessage(
                    id = UUID.randomUUID().toString(),
                    text = "দুঃখিত, তথ্য সংগ্রহে একটি ত্রুটি দেখা দিয়েছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।",
                    isUser = false
                )
                _messages.value = _messages.value + error
                persist(error)
            } finally {
                _isLoading.value = false
            }
        }
    }

    private fun persist(message: AiChatMessage) {
        viewModelScope.launch {
            chatStore.append(ArticleAiChatStore.GLOBAL_THREAD, message)
        }
    }
}

// Settings ViewModel
class SettingsViewModel(
    private val preferencesRepository: UserPreferencesRepository,
    private val articleRepository: ArticleRepository,
    private val googleAuthRepository: GoogleAuthRepository,
    private val supabaseClient: SupabaseClient,
    private val translations: TranslationRepository
) : ViewModel() {

    val preferences: StateFlow<ReaderPreferences> = preferencesRepository.readerPreferences
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), ReaderPreferences())

    val currentUser: StateFlow<UserProfile?> = googleAuthRepository.currentUser

    private val _googleAuthInProgress = MutableStateFlow(false)
    val googleAuthInProgress: StateFlow<Boolean> = _googleAuthInProgress.asStateFlow()

    private val _googleAuthMessage = MutableStateFlow<String?>(null)
    val googleAuthMessage: StateFlow<String?> = _googleAuthMessage.asStateFlow()

    fun signInWithGoogle(activityContext: android.content.Context) {
        if (_googleAuthInProgress.value) return
        viewModelScope.launch {
            _googleAuthInProgress.value = true
            _googleAuthMessage.value = null
            try {
                val result = googleAuthRepository.signInWithGoogle(activityContext)
                result.onSuccess {
                    _googleAuthMessage.value = null
                }.onFailure { error ->
                    if (error is GoogleAuthException.Cancelled || error is GoogleAuthException.InProgress) {
                        _googleAuthMessage.value = null
                    } else {
                        _googleAuthMessage.value = GoogleAuthMapper.userMessage(error)
                    }
                }
            } finally {
                _googleAuthInProgress.value = false
            }
        }
    }

    fun signOutAccount() {
        viewModelScope.launch {
            googleAuthRepository.signOut()
            _googleAuthMessage.value = null
        }
    }


    fun updateAppThemeMode(mode: AppThemeMode) {
        viewModelScope.launch {
            preferencesRepository.updateAppThemeMode(mode)
        }
    }

    /** Switches the interface language; the app fetches that language's file. */
    fun updateContentLanguage(language: ContentLanguage) {
        viewModelScope.launch {
            preferencesRepository.updateContentLanguage(language)
            translations.refresh(language)
        }
    }

    /** Pulls the current language file again (dashboard edits land without an update). */
    fun refreshTranslations() {
        viewModelScope.launch {
            val language = preferencesRepository.readerPreferences.first().contentLanguage
            translations.refresh(language)
        }
    }

    fun toggleNotificationsEnabled(enabled: Boolean) {
        viewModelScope.launch {
            preferencesRepository.updateNotificationsEnabled(enabled)
            supabaseClient.syncNotificationsEnabled(enabled)
        }
    }

    fun toggleNewArticlesNotif(enabled: Boolean) {
        viewModelScope.launch {
            preferencesRepository.updateNotificationNew(enabled)
        }
    }

    fun toggleFeaturedNotif(enabled: Boolean) {
        viewModelScope.launch {
            preferencesRepository.updateNotificationFeatured(enabled)
        }
    }

    fun toggleVideosNotif(enabled: Boolean) {
        viewModelScope.launch {
            preferencesRepository.updateNotificationVideos(enabled)
        }
    }

    fun togglePdfsNotif(enabled: Boolean) {
        viewModelScope.launch {
            preferencesRepository.updateNotificationPdfs(enabled)
        }
    }

    fun toggleSystemNotif(enabled: Boolean) {
        viewModelScope.launch {
            preferencesRepository.updateNotificationSystem(enabled)
        }
    }

    fun toggleOtherNotif(enabled: Boolean) {
        viewModelScope.launch {
            preferencesRepository.updateNotificationOther(enabled)
        }
    }

    fun completeOnboarding(onDone: () -> Unit = {}) {
        viewModelScope.launch {
            // The language was picked on the first step of the same flow, so both
            // flags land together and neither step can come back on its own.
            preferencesRepository.markLanguageChosen()
            preferencesRepository.markOnboardingComplete()
            onDone()
        }
    }

    fun clearCache() {
        viewModelScope.launch {
            articleRepository.clearAllCache()
        }
    }

    fun clearHistory() {
        viewModelScope.launch {
            articleRepository.clearHistory()
        }
    }
}

// PDF Archive ViewModel
class PdfArchiveViewModel(
    private val repository: ArticleRepository
) : ViewModel() {
    val categories: StateFlow<List<com.ningshingche.app.data.model.PdfCategory>> = repository.pdfCategories
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), repository.getPdfCategories())

    val allPdfDocuments: StateFlow<List<com.ningshingche.app.data.model.PdfDocument>> = repository.pdfDocuments
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), repository.getPdfDocuments())

    private val _selectedCategoryId = MutableStateFlow("pdf-cat-all")
    val selectedCategoryId: StateFlow<String> = _selectedCategoryId.asStateFlow()

    val filteredPdfs: StateFlow<List<com.ningshingche.app.data.model.PdfDocument>> = combine(
        repository.pdfDocuments,
        _selectedCategoryId
    ) { docs, categoryId ->
        if (categoryId == "pdf-cat-all" || categoryId.isBlank()) docs
        else docs.filter { it.categorySlug == categoryId || it.category == categoryId }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), repository.getPdfDocuments())

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    fun selectCategory(categoryId: String) {
        _selectedCategoryId.value = categoryId
        _isLoading.value = true
        viewModelScope.launch {
            kotlinx.coroutines.delay(150)
            _isLoading.value = false
        }
    }
}

private fun PdfBook.toPdfDocument(): com.ningshingche.app.data.model.PdfDocument =
    com.ningshingche.app.data.model.PdfDocument(
        id = id,
        title = title,
        edition = edition,
        category = category,
        categorySlug = category,
        year = year,
        authorOrEditor = authorOrEditor,
        pageCount = pageCount,
        fileSizeMb = fileSizeMb.toFloat(),
        pdfUrl = fileUrl,
        coverImageUrl = coverUrl,
        description = description
    )

// PDF Viewer ViewModel
class PdfViewerViewModel(
    private val repository: ArticleRepository,
    private val portalRepository: PortalRepository,
    private val context: Context,
    private val preferencesRepository: UserPreferencesRepository
) : ViewModel() {
    private val _pdfDocument = MutableStateFlow<com.ningshingche.app.data.model.PdfDocument?>(null)
    val pdfDocument: StateFlow<com.ningshingche.app.data.model.PdfDocument?> = _pdfDocument.asStateFlow()

    private val _pageCount = MutableStateFlow(0)
    val pageCount: StateFlow<Int> = _pageCount.asStateFlow()

    private val _currentPage = MutableStateFlow(0)
    val currentPage: StateFlow<Int> = _currentPage.asStateFlow()

    private val _isLoading = MutableStateFlow(true)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private val _downloadStatus = MutableStateFlow<String?>(null)
    val downloadStatus: StateFlow<String?> = _downloadStatus.asStateFlow()

    private val _localFile = MutableStateFlow<File?>(null)
    val localFile: StateFlow<File?> = _localFile.asStateFlow()

    val readerSettings: StateFlow<PdfReaderSettings> = preferencesRepository.pdfReaderSettings
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PdfReaderSettings())

    private var loadedPdfId: String = ""

    fun loadPdf(pdfId: String) {
        _isLoading.value = true
        _errorMessage.value = null
        _pageCount.value = 0
        _localFile.value = null
        viewModelScope.launch {
            val decoded = runCatching { java.net.URLDecoder.decode(pdfId, "UTF-8") }.getOrDefault(pdfId)
            var doc = repository.getPdfDocumentById(decoded) ?: repository.getPdfDocumentById(pdfId)
            if (doc == null) {
                val books = portalRepository.pdfBooks().getOrNull().orEmpty()
                val book = books.find { it.id == decoded || it.id == pdfId }
                if (book != null) doc = book.toPdfDocument()
            }
            _pdfDocument.value = doc
            loadedPdfId = doc?.id.orEmpty()
            if (doc == null) {
                _errorMessage.value = "বইটি খোলা যায়নি।"
                _isLoading.value = false
                return@launch
            }
            if (doc.pdfUrl.isBlank() && doc.downloadUrl.isBlank()) {
                _errorMessage.value = "এই বইয়ের পিডিএফ লিংক নেই।"
                _isLoading.value = false
                return@launch
            }
            _currentPage.value = preferencesRepository.pdfLastPage(doc.id)
            try {
                val file = com.ningshingche.app.util.PdfHelper.downloadPdfFile(context, doc)
                _localFile.value = file
            } catch (e: Exception) {
                _errorMessage.value = e.message ?: "পিডিএফ খোলা যায়নি।"
                _isLoading.value = false
            }
        }
    }

    fun onDocumentLoaded(pages: Int) {
        _pageCount.value = pages
        _isLoading.value = false
        if (_currentPage.value >= pages) _currentPage.value = (pages - 1).coerceAtLeast(0)
    }

    fun onPageChanged(page: Int, pages: Int) {
        _currentPage.value = page.coerceAtLeast(0)
        if (pages > 0) _pageCount.value = pages
        val id = loadedPdfId
        if (id.isNotBlank()) {
            viewModelScope.launch { preferencesRepository.savePdfLastPage(id, page) }
        }
    }

    fun onViewerError(message: String) {
        _errorMessage.value = message.ifBlank { "পিডিএফ খোলা যায়নি।" }
        _isLoading.value = false
    }

    fun updateSettings(settings: PdfReaderSettings) {
        viewModelScope.launch { preferencesRepository.updatePdfReaderSettings(settings) }
    }

    fun downloadPdf() {
        val doc = _pdfDocument.value ?: return
        viewModelScope.launch {
            _downloadStatus.value = "ডাউনলোড হচ্ছে..."
            val result = com.ningshingche.app.util.PdfHelper.savePdfToDownloads(context, doc)
            _downloadStatus.value = result.getOrElse { "ডাউনলোড ব্যর্থ হয়েছে: ${it.message}" }
        }
    }

    fun sharePdf() {
        val doc = _pdfDocument.value ?: return
        val file = _localFile.value ?: return
        com.ningshingche.app.util.PdfHelper.sharePdfFile(context, doc, file)
    }

    fun openExternally() {
        val file = _localFile.value ?: return
        com.ningshingche.app.util.PdfHelper.openInExternalApp(context, file)
    }

    fun clearStatus() {
        _downloadStatus.value = null
    }
}

// Factory
class ViewModelFactory(
    private val repository: ArticleRepository,
    private val preferencesRepository: UserPreferencesRepository,
    private val aiAssistant: NinghsingCheAiAssistant,
    private val googleAuthRepository: GoogleAuthRepository,
    private val context: Context,
    private val supabaseClient: SupabaseClient,
    private val portalRepository: PortalRepository,
    private val translations: TranslationRepository = NinghsingCheApp.instance.translations
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return when {
            modelClass.isAssignableFrom(HomeViewModel::class.java) -> HomeViewModel(repository) as T
            modelClass.isAssignableFrom(BookmarksViewModel::class.java) -> BookmarksViewModel(repository) as T
            modelClass.isAssignableFrom(SavedArticlesViewModel::class.java) -> SavedArticlesViewModel(repository) as T
            modelClass.isAssignableFrom(AiViewModel::class.java) -> AiViewModel(
                aiAssistant,
                ArticleAiChatStore(com.ningshingche.app.data.local.AppDatabase.getInstance(context).chatDao())
            ) as T
            modelClass.isAssignableFrom(SettingsViewModel::class.java) -> SettingsViewModel(preferencesRepository, repository, googleAuthRepository, supabaseClient, translations) as T
            modelClass.isAssignableFrom(PdfArchiveViewModel::class.java) -> PdfArchiveViewModel(repository) as T
            modelClass.isAssignableFrom(PdfViewerViewModel::class.java) ->
                PdfViewerViewModel(repository, portalRepository, context, preferencesRepository) as T
            modelClass.isAssignableFrom(ReaderWorkspaceViewModel::class.java) -> ReaderWorkspaceViewModel(googleAuthRepository, supabaseClient) as T
            else -> throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
