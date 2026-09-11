package com.ningshingche.app.ui.reader

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.navDeepLink
import com.ningshingche.app.NinghsingCheApp
import com.ningshingche.app.data.model.AppThemeMode
import com.ningshingche.app.data.portal.IssueTags
import com.ningshingche.app.data.remote.SubmittedBlogRecord
import com.ningshingche.app.ui.navigation.ExploreTab
import com.ningshingche.app.ui.components.PortalDrawerContent
import com.ningshingche.app.ui.components.PortalDrawerWidth
import com.ningshingche.app.ui.screens.AboutScreen
import com.ningshingche.app.ui.screens.AiAssistantScreen
import com.ningshingche.app.ui.screens.AuthorsDirectoryScreen
import com.ningshingche.app.ui.screens.BookmarksScreen
import com.ningshingche.app.ui.screens.ExploreScreen
import com.ningshingche.app.ui.screens.FeaturedScreen
import com.ningshingche.app.ui.screens.LoginScreen
import com.ningshingche.app.ui.screens.NewArticleScreen
import com.ningshingche.app.ui.screens.NewMusicScreen
import com.ningshingche.app.data.music.MusicShelfKind
import com.ningshingche.app.ui.screens.PdfArchiveScreen
import com.ningshingche.app.ui.screens.PdfViewerScreen
import com.ningshingche.app.ui.screens.SettingsScreen
import com.ningshingche.app.ui.screens.SocialActivitiesScreen
import com.ningshingche.app.ui.screens.SplashScreen
import com.ningshingche.app.ui.screens.UserDashboardScreen

import com.ningshingche.app.ui.screens.UserProfileScreen
import com.ningshingche.app.ui.screens.FirstRunFlow
import com.ningshingche.app.ui.viewmodel.AiViewModel
import com.ningshingche.app.ui.viewmodel.BookmarksViewModel
import com.ningshingche.app.ui.viewmodel.SavedArticlesViewModel
import com.ningshingche.app.ui.components.BookmarkController
import com.ningshingche.app.ui.components.LocalBookmarkController
import com.ningshingche.app.ui.components.AppToastHost
import com.ningshingche.app.ui.components.AppToasts
import com.ningshingche.app.ui.components.LocalMusicController
import com.ningshingche.app.ui.components.MusicFullPlayerOverlay
import com.ningshingche.app.ui.components.MusicMiniPlayerBar
import com.ningshingche.app.ui.components.NetStatus
import com.ningshingche.app.ui.components.connectivityStatus
import com.ningshingche.app.ui.viewmodel.PdfArchiveViewModel
import com.ningshingche.app.ui.viewmodel.PdfViewerViewModel
import com.ningshingche.app.ui.viewmodel.ReaderWorkspaceViewModel
import com.ningshingche.app.ui.viewmodel.SettingsViewModel
import com.ningshingche.app.ui.viewmodel.ViewModelFactory
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.net.URLEncoder
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp

/**
 * Navigation routes for NingshingChe Portal.
 */
object ReaderRoute {
    const val Splash = "splash"
    const val Home = "home"
    const val Search = "search"
    const val Article = "article/{articleId}"
    const val Category = "category/{categorySlug}"
    const val Author = "author/{authorId}"
    const val AiAssistant = "ai_assistant"
    const val AiAssistantPattern = "ai_assistant?q={q}"
    const val Settings = "settings"
    const val Login = "login"
    const val FirstRun = "first_run"
    const val UserDashboard = "user_dashboard"
    const val UserDashboardPattern = "user_dashboard?tab={tab}&focus={focus}"
    const val UserProfile = "user_profile"
    const val NewArticle = "new_article"
    const val NewMusic = "new_music"
    const val Bookmarks = "bookmarks"
    const val PdfArchive = "pdf_archive"
    const val PdfViewer = "pdf_viewer/{pdfId}"
    const val Explore = "explore"
    const val ExplorePattern = "explore?tab={tab}"
    const val Issue = "issue/{year}"
    const val Featured = "featured"
    const val Videos = "videos"
    const val Music = "music"
    const val MusicGenre = "music_genre/{name}"
    const val MusicArtist = "music_artist/{name}"
    const val MusicAlbum = "music_album/{name}"
    const val About = "about"
    const val AuthorsDirectory = "authors_directory"
    const val SocialActivities = "social_activities"

    fun ai(question: String = ""): String {
        return if (question.isBlank()) AiAssistant else "ai_assistant?q=${encode(question)}"
    }

    fun article(idOrSlug: String, focus: String = "") : String {
        val base = "article/${encode(idOrSlug)}"
        return if (focus.isBlank()) base else "$base?focus=${encode(focus)}"
    }

    fun dashboard(tab: String = "notices", focus: String = ""): String {
        val safeTab = tab.ifBlank { "notices" }
        return "user_dashboard?tab=$safeTab&focus=${encode(focus)}"
    }
    fun category(slug: String) = "category/${encode(slug)}"
    fun author(id: String) = "author/${encode(id)}"
    fun pdfViewer(pdfId: String) = "pdf_viewer/${encode(pdfId)}"
    fun explore(tab: ExploreTab) = "explore?tab=${tab.key}"
    fun issue(year: Int) = "issue/$year"
    fun musicGenre(name: String) = "music_genre/${encode(name)}"
    fun musicArtist(name: String) = "music_artist/${encode(name)}"
    fun musicAlbum(name: String) = "music_album/${encode(name)}"

    /**
     * Where a tapped tag should go: annual-issue tags (`নিংশিং চে - ২০২৩`, any
     * spelling) open the issue list, a bare year too; anything else is treated
     * as a category slug/title and opens the category list.
     */
    fun forTag(tag: String): String {
        IssueTags.parseYear(tag)?.let { return issue(it) }
        return category(tag)
    }

    private fun encode(value: String) =
        URLEncoder.encode(value, "UTF-8").replace("+", "%20")
}

/**
 * Standard slide + fade route transitions applied to every destination so
 * pushes (bell → dashboard, dashboard → article, …) and pops animate
 * smoothly instead of switching instantly. Timing matches the old reader
 * feel: 280 ms in, 240 ms out, both directions.
 */
private val navEnter: AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
    slideInHorizontally(initialOffsetX = { it }, animationSpec = tween(280, easing = FastOutSlowInEasing)) +
        fadeIn(tween(280))
}
private val navExit: AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
    slideOutHorizontally(targetOffsetX = { it / 3 }, animationSpec = tween(240, easing = FastOutSlowInEasing)) +
        fadeOut(tween(240))
}
private val navPopEnter: AnimatedContentTransitionScope<NavBackStackEntry>.() -> EnterTransition = {
    slideInHorizontally(initialOffsetX = { -it / 3 }, animationSpec = tween(240, easing = FastOutSlowInEasing)) +
        fadeIn(tween(240))
}
private val navPopExit: AnimatedContentTransitionScope<NavBackStackEntry>.() -> ExitTransition = {
    slideOutHorizontally(targetOffsetX = { -it }, animationSpec = tween(280, easing = FastOutSlowInEasing)) +
        fadeOut(tween(280))
}

@Composable
fun EditorialReaderApp(
    app: NinghsingCheApp,
    isDark: Boolean,
    themeMode: AppThemeMode,
    onCycleTheme: () -> Unit,
    pendingRoute: StateFlow<String?>? = null,
    onPendingRouteConsumed: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val navController = rememberNavController()
    val context = LocalContext.current
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val coroutineScope = rememberCoroutineScope()

    val portalFactory = ReaderViewModelFactory(
        app.portalRepository,
        app.commenterPreferencesRepository,
        app.googleAuthRepository
    )
    val mainFactory = ViewModelFactory(
        repository = app.articleRepository,
        preferencesRepository = app.preferencesRepository,
        aiAssistant = app.aiAssistant,
        googleAuthRepository = app.googleAuthRepository,
        context = context,
        supabaseClient = app.supabaseClient,
        portalRepository = app.portalRepository
    )
    val workspaceViewModel: ReaderWorkspaceViewModel = viewModel(factory = mainFactory)
    val savedArticlesViewModel: SavedArticlesViewModel = viewModel(factory = mainFactory)
    val savedIds by savedArticlesViewModel.savedIds.collectAsState()
    val bookmarkController = remember(savedIds) {
        BookmarkController(savedIds = savedIds, onToggle = savedArticlesViewModel::toggle)
    }
    val currentUser by app.googleAuthRepository.currentUser.collectAsState()
    val isSignedIn = currentUser != null
    val unreadCount by workspaceViewModel.unreadCount.collectAsState()
    LaunchedEffect(isSignedIn, currentUser?.id) {
        if (isSignedIn) workspaceViewModel.refreshInbox()
    }
    val readerPreferences by app.preferencesRepository.readerPreferences.collectAsState(
        initial = com.ningshingche.app.data.model.ReaderPreferences()
    )

    val openExternal: (String) -> Unit = { url ->
        if (url.isNotBlank()) {
            runCatching {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            }
        }
    }

    // Opening a published submission from the dashboard.
    //
    // Approval converts a submission into a blog and records the blog it made,
    // so the id to open is known rather than guessed at from the title. Older
    // rows that predate that column — and any that point at a blog which is
    // still a draft — fall back to the title search, and anything that resolves
    // to nothing returns false: the dashboard shows the submission's own
    // preview in that case instead of an error screen.
    val openSubmittedArticle: suspend (SubmittedBlogRecord) -> Boolean = { article ->
        val candidate = article.convertedBlogId.ifBlank { article.id }
        val direct = if (candidate.isNotBlank()) app.portalRepository.article(candidate) else null
        val resolved = when {
            direct?.isSuccess == true -> candidate
            else -> app.portalRepository.searchArticles(article.title, limit = 1)
                .getOrNull()?.items?.firstOrNull()?.id
        }
        if (resolved.isNullOrBlank()) {
            false
        } else {
            navController.navigate(ReaderRoute.article(resolved))
            true
        }
    }

    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route ?: ReaderRoute.Home
    val pendingHolder = remember { kotlinx.coroutines.flow.MutableStateFlow<String?>(null) }
    val launchRoute by (pendingRoute ?: pendingHolder).collectAsState()
    val playerUi by app.musicController.state.collectAsState()

    LaunchedEffect(launchRoute, currentRoute) {
        val route = launchRoute ?: return@LaunchedEffect
        val blocked = currentRoute == ReaderRoute.Splash ||
            currentRoute == ReaderRoute.FirstRun
        if (blocked) return@LaunchedEffect
        navController.navigate(route)
        onPendingRouteConsumed()
    }

    LaunchedEffect(Unit) {
        var last: NetStatus? = null
        connectivityStatus(context).collect { status ->
            val previous = last
            last = status
            if (previous == null && status == NetStatus.Online) return@collect
            when (status) {
                NetStatus.Offline -> AppToasts.openSettings("You are in Offline")
                NetStatus.Weak -> if (previous != NetStatus.Weak) {
                    AppToasts.show("Your internet connection is weak")
                }
                NetStatus.Online -> Unit
            }
        }
    }

    // Top-level destinations reached from the drawer: single instance each,
    // state saved/restored so switching back keeps scroll positions.
    fun navigateTopLevel(route: String) {
        navController.navigate(route) {
            popUpTo(ReaderRoute.Home) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }

    // Tab requested from the drawer ("বার্ষিক সংখ্যা" / "বিভাগসমূহ"). Carried as
    // explicit state (with a nonce) in addition to the route argument so the
    // Explore screen switches tabs even when it is already on top of the stack.
    var exploreTabRequest by remember { mutableStateOf<Pair<Int, ExploreTab>?>(null) }

    // Explore is one destination; the `tab` argument selects the page.
    // launchSingleTop + a changed argument (and the request nonce above)
    // delivers the new tab even when Explore is already on top.
    fun openExploreTab(tab: ExploreTab) {
        exploreTabRequest = ((exploreTabRequest?.first ?: 0) + 1) to tab
        navController.navigate(ReaderRoute.explore(tab)) {
            popUpTo(ReaderRoute.Home) { saveState = true }
            launchSingleTop = true
        }
    }

    // Swipe-to-open is enabled on every screen that shows the hamburger.
    val drawerGesturesEnabled = currentRoute == ReaderRoute.Home ||
        currentRoute == ReaderRoute.ExplorePattern ||
        currentRoute == ReaderRoute.Explore

    // Material3 measures the drawer sheet to learn where "closed" sits, and draws
    // it at offset 0 until that first measurement is in — which shows the panel for
    // a frame or two (~50 ms) on a cold start, over the splash. The sheet's contents
    // stay out of the tree until the splash has handed over: by then the measurement
    // is long done, and no screen before that can open the drawer anyway. The
    // placeholder measures the same width, so the anchor does not move when the real
    // sheet arrives.
    val drawerPanelReady = navBackStackEntry != null && currentRoute != ReaderRoute.Splash

    CompositionLocalProvider(
        LocalBookmarkController provides bookmarkController,
        LocalMusicController provides app.musicController
    ) {
    Box(Modifier.fillMaxSize()) {
    ModalNavigationDrawer(
        modifier = modifier,
        drawerState = drawerState,
        gesturesEnabled = drawerGesturesEnabled,
        drawerContent = {
            if (!drawerPanelReady) {
                Box(modifier = Modifier.fillMaxHeight().width(PortalDrawerWidth))
                return@ModalNavigationDrawer
            }
            PortalDrawerContent(
                currentRoute = currentRoute,
                isDark = isDark,
                themeMode = themeMode,
                onNavigate = { route ->
                    coroutineScope.launch {
                        drawerState.close()
                        navigateTopLevel(route)
                    }
                },
                onExploreTab = { tab ->
                    coroutineScope.launch {
                        drawerState.close()
                        openExploreTab(tab)
                    }
                },
                onCycleTheme = onCycleTheme,
                onShareApp = {
                    coroutineScope.launch {
                        drawerState.close()
                        val sendIntent = Intent().apply {
                            action = Intent.ACTION_SEND
                            putExtra(
                                Intent.EXTRA_TEXT,
                                "নিংশিং চে — বিষ্ণুপ্রিয়া মণিপুরি সাহিত্য ও সংস্কৃতি পোর্টাল\nhttps://ningshingche.com"
                            )
                            type = "text/plain"
                        }
                        context.startActivity(Intent.createChooser(sendIntent, "নিংশিং চে অ্যাপ শেয়ার করুন"))
                    }
                },
                onCloseDrawer = {
                    coroutineScope.launch { drawerState.close() }
                },
                isSignedIn = isSignedIn,
                dashboardUnreadCount = unreadCount
            )
        }
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
        NavHost(
            navController = navController,
            startDestination = ReaderRoute.Splash,
            modifier = Modifier.weight(1f)
        ) {
            // Splash Screen
            composable(ReaderRoute.Splash, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                SplashScreen(
                    onSplashComplete = {
                        // A first install goes through the three steps (language,
                        // sign-in, notifications) as one flow; afterwards the
                        // splash opens the reader straight away.
                        val dest = if (readerPreferences.onboardingComplete) {
                            ReaderRoute.Home
                        } else {
                            ReaderRoute.FirstRun
                        }
                        navController.navigate(dest) {
                            popUpTo(ReaderRoute.Splash) { inclusive = true }
                        }
                    }
                )
            }

            // Home Front Page
            composable(ReaderRoute.Home, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                val homeViewModel: HomeViewModel = viewModel(factory = portalFactory)
                HomeScreen(
                    viewModel = homeViewModel,
                    onArticleClick = { navController.navigate(ReaderRoute.article(it)) },
                    onCategoryClick = { navController.navigate(ReaderRoute.category(it.slug)) },
                    onAuthorClick = { navController.navigate(ReaderRoute.author(it.id)) },
                    onSearchClick = { navController.navigate(ReaderRoute.Search) },
                    onPdfClick = { book -> navController.navigate(ReaderRoute.pdfViewer(book.id)) },
                    onSeeAllPdf = { navController.navigate(ReaderRoute.PdfArchive) },
                    onSeeAllLatest = { navController.navigate(ReaderRoute.Featured) },
                    onSeeAllFeatured = { navController.navigate(ReaderRoute.Featured) },
                    onSeeAllCategories = { openExploreTab(ExploreTab.Categories) },
                    onSeeAllSpecial = { openExploreTab(ExploreTab.Popular) },
                    onSeeAllVideos = { navController.navigate(ReaderRoute.Videos) },
                    onSeeAllMusic = { navController.navigate(ReaderRoute.Music) },
                    onMenuClick = {
                        coroutineScope.launch { drawerState.open() }
                    },
                    onAiClick = {
                        navController.navigate(ReaderRoute.AiAssistant)
                    },
                    onAiPrompt = { question ->
                        navController.navigate(ReaderRoute.ai(question))
                    },
                    onLoginClick = { navController.navigate(ReaderRoute.Login) },
                    onDashboardClick = { navController.navigate(ReaderRoute.UserDashboard) },
                    onProfileClick = { navController.navigate(ReaderRoute.UserProfile) },
                    onNotificationsClick = { navController.navigate(ReaderRoute.dashboard("notices")) },
                    unreadCount = unreadCount,
                    onLogoutClick = { workspaceViewModel.signOut() },
                    isSignedIn = isSignedIn,
                    avatarUrl = currentUser?.avatarUrl.orEmpty(),
                    onNavigate = { route -> navController.navigate(route) },
                    onOpenLink = openExternal
                )
            }

            // Search Screen
            composable(ReaderRoute.Search, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                val searchViewModel: SearchViewModel = viewModel(factory = portalFactory)
                SearchScreen(
                    viewModel = searchViewModel,
                    onBackClick = { navController.popBackStack() },
                    onArticleClick = { navController.navigate(ReaderRoute.article(it)) },
                    onCategoryClick = { navController.navigate(ReaderRoute.category(it.slug)) },
                    onMusicArtistClick = { navController.navigate(ReaderRoute.musicArtist(it)) },
                    onMusicAlbumClick = { navController.navigate(ReaderRoute.musicAlbum(it)) },
                    onMusicGenreClick = { navController.navigate(ReaderRoute.musicGenre(it)) }
                )
            }

            composable(
                enterTransition = navEnter,
                exitTransition = navExit,
                popEnterTransition = navPopEnter,
                popExitTransition = navPopExit,
                route = "article/{articleId}?focus={focus}",
                arguments = listOf(
                    navArgument("articleId") { type = NavType.StringType },
                    navArgument("focus") { type = NavType.StringType; defaultValue = "" }
                )
            ) { entry ->
                val articleId = entry.arguments?.getString("articleId").orEmpty()
                val articleViewModel: ArticleViewModel = viewModel(factory = portalFactory)
                LaunchedEffect(articleId) { articleViewModel.load(articleId) }
                ArticleScreen(
                    viewModel = articleViewModel,
                    onBackClick = { navController.popBackStack() },
                    onRelatedClick = { navController.navigate(ReaderRoute.article(it)) },
                    scrollToComments = entry.arguments?.getString("focus") == "comments",
                    onCategoryClick = { categorySlug ->
                        if (categorySlug.isNotBlank()) navController.navigate(ReaderRoute.category(categorySlug))
                    },
                    onAuthorClick = { authorId ->
                        if (authorId.isNotBlank()) navController.navigate(ReaderRoute.author(authorId))
                    },
                    onTagClick = { tag ->
                        if (tag.isNotBlank()) navController.navigate(ReaderRoute.forTag(tag))
                    }
                )
            }

            // Article Detail Screen
            composable(
                enterTransition = navEnter,
                exitTransition = navExit,
                popEnterTransition = navPopEnter,
                popExitTransition = navPopExit,
                route = ReaderRoute.Article,
                arguments = listOf(navArgument("articleId") { type = NavType.StringType }),
                deepLinks = listOf(
                    navDeepLink { uriPattern = "https://ningshingche.com/article/{articleId}" },
                    navDeepLink { uriPattern = "http://ningshingche.com/article/{articleId}" },
                    navDeepLink { uriPattern = "https://ningshingche.com/{articleId}" },
                    navDeepLink { uriPattern = "http://ningshingche.com/{articleId}" }
                )
            ) { entry ->
                val articleId = entry.arguments?.getString("articleId").orEmpty()
                val articleViewModel: ArticleViewModel = viewModel(factory = portalFactory)
                LaunchedEffect(articleId) { articleViewModel.load(articleId) }
                ArticleScreen(
                    viewModel = articleViewModel,
                    onBackClick = { navController.popBackStack() },
                    onRelatedClick = { navController.navigate(ReaderRoute.article(it)) },
                    scrollToComments = entry.arguments?.getString("focus") == "comments",
                    onCategoryClick = { categorySlug ->
                        if (categorySlug.isNotBlank()) {
                            navController.navigate(ReaderRoute.category(categorySlug))
                        }
                    },
                    onAuthorClick = { authorId ->
                        if (authorId.isNotBlank()) {
                            navController.navigate(ReaderRoute.author(authorId))
                        }
                    },
                    onTagClick = { tag ->
                        if (tag.isNotBlank()) {
                            navController.navigate(ReaderRoute.forTag(tag))
                        }
                    }
                )
            }

            // Category Articles Screen
            composable(
                enterTransition = navEnter,
                exitTransition = navExit,
                popEnterTransition = navPopEnter,
                popExitTransition = navPopExit,
                route = ReaderRoute.Category,
                arguments = listOf(navArgument("categorySlug") { type = NavType.StringType })
            ) { entry ->
                val slug = entry.arguments?.getString("categorySlug").orEmpty()
                val categoryViewModel: CategoryViewModel = viewModel(
                    factory = CategoryViewModelFactory(app.portalRepository, slug)
                )
                CategoryScreen(
                    viewModel = categoryViewModel,
                    onBackClick = { navController.popBackStack() },
                    onArticleClick = { navController.navigate(ReaderRoute.article(it)) }
                )
            }

            // Annual issue (নিংশিং চে - YYYY) articles
            composable(
                enterTransition = navEnter,
                exitTransition = navExit,
                popEnterTransition = navPopEnter,
                popExitTransition = navPopExit,
                route = ReaderRoute.Issue,
                arguments = listOf(navArgument("year") { type = NavType.IntType })
            ) { entry ->
                val year = entry.arguments?.getInt("year") ?: 0
                val issueViewModel: IssueViewModel = viewModel(
                    factory = IssueViewModelFactory(app.portalRepository, year),
                    key = "issue-$year"
                )
                IssueScreen(
                    viewModel = issueViewModel,
                    onBackClick = { navController.popBackStack() },
                    onArticleClick = { navController.navigate(ReaderRoute.article(it)) }
                )
            }

            // Author Profile Screen
            composable(
                enterTransition = navEnter,
                exitTransition = navExit,
                popEnterTransition = navPopEnter,
                popExitTransition = navPopExit,
                route = ReaderRoute.Author,
                arguments = listOf(navArgument("authorId") { type = NavType.StringType })
            ) { entry ->
                val authorId = entry.arguments?.getString("authorId").orEmpty()
                val authorViewModel: AuthorViewModel = viewModel(
                    factory = AuthorViewModelFactory(app.portalRepository, authorId)
                )
                AuthorScreen(
                    viewModel = authorViewModel,
                    onBackClick = { navController.popBackStack() },
                    onArticleClick = { navController.navigate(ReaderRoute.article(it)) }
                )
            }

            // NingshingChe AI Assistant Screen
            composable(ReaderRoute.AiAssistant, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                val aiViewModel: AiViewModel = viewModel(factory = mainFactory)
                AiAssistantScreen(
                    viewModel = aiViewModel,
                    onBackClick = { navController.popBackStack() },
                    onArticleClick = { navController.navigate(ReaderRoute.article(it)) },
                    onMenuClick = {
                        coroutineScope.launch { drawerState.open() }
                    }
                )
            }

            composable(
                enterTransition = navEnter,
                exitTransition = navExit,
                popEnterTransition = navPopEnter,
                popExitTransition = navPopExit,
                route = ReaderRoute.AiAssistantPattern,
                arguments = listOf(
                    navArgument("q") { type = NavType.StringType; defaultValue = "" }
                )
            ) { entry ->
                val aiViewModel: AiViewModel = viewModel(factory = mainFactory)
                val question = java.net.URLDecoder.decode(
                    entry.arguments?.getString("q").orEmpty(),
                    "UTF-8"
                )
                AiAssistantScreen(
                    viewModel = aiViewModel,
                    onBackClick = { navController.popBackStack() },
                    onArticleClick = { navController.navigate(ReaderRoute.article(it)) },
                    onMenuClick = {
                        coroutineScope.launch { drawerState.open() }
                    },
                    initialQuestion = question
                )
            }

            // Settings Screen
            composable(ReaderRoute.Settings, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                val settingsViewModel: SettingsViewModel = viewModel(factory = mainFactory)
                SettingsScreen(
                    viewModel = settingsViewModel,
                    onBackClick = { navController.popBackStack() }
                )
            }

            composable(ReaderRoute.Login, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                val settingsViewModel: SettingsViewModel = viewModel(factory = mainFactory)
                LoginScreen(
                    viewModel = settingsViewModel,
                    onBackClick = { navController.popBackStack() },
                    onSignedIn = { navController.popBackStack() }
                )
            }

            // First install: language, sign-in and notifications as three steps
            // of one flow (see FirstRunFlow). Finish marks onboarding complete in
            // the same call, so this route is never reached twice.
            composable(ReaderRoute.FirstRun, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                val settingsViewModel: SettingsViewModel = viewModel(factory = mainFactory)
                FirstRunFlow(
                    selected = readerPreferences.contentLanguage,
                    onSelectLanguage = { language ->
                        coroutineScope.launch {
                            // Downloads that language's file immediately, so the
                            // steps after this one are already translated.
                            app.preferencesRepository.updateContentLanguage(language)
                            app.translations.refresh(language)
                        }
                    },
                    viewModel = settingsViewModel,
                    onFinished = {
                        navController.navigate(ReaderRoute.Home) {
                            popUpTo(ReaderRoute.FirstRun) { inclusive = true }
                        }
                    }
                )
            }

            composable(ReaderRoute.UserDashboard, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                UserDashboardScreen(
                    viewModel = workspaceViewModel,
                    onBackClick = { navController.popBackStack() },
                    onCompleteProfile = { navController.navigate(ReaderRoute.UserProfile) },
                    onNewArticle = { navController.navigate(ReaderRoute.NewArticle) },
                    onNewMusic = { navController.navigate(ReaderRoute.NewMusic) },
                    onOpenArticle = openSubmittedArticle,
                    onOpenComment = { comment ->
                        if (comment.blogId.isNotBlank()) {
                            navController.navigate(ReaderRoute.article(comment.blogId, "comments"))
                        }
                    }
                )
            }

            composable(
                enterTransition = navEnter,
                exitTransition = navExit,
                popEnterTransition = navPopEnter,
                popExitTransition = navPopExit,
                route = ReaderRoute.UserDashboardPattern,
                arguments = listOf(
                    navArgument("tab") { type = NavType.StringType; defaultValue = "home" },
                    navArgument("focus") { type = NavType.StringType; defaultValue = "" }
                )
            ) { entry ->
                val tabKey = entry.arguments?.getString("tab").orEmpty()
                val tab = when (tabKey) {
                    "notices" -> 1
                    "messages" -> 2
                    "content" -> 3
                    "comments" -> 4
                    else -> 0
                }
                // The focus id only belongs to the tab it was created for
                // (messages / content / comments); other tabs stay unfocused.
                val focus = entry.arguments?.getString("focus").orEmpty()
                UserDashboardScreen(
                    viewModel = workspaceViewModel,
                    onBackClick = { navController.popBackStack() },
                    onCompleteProfile = { navController.navigate(ReaderRoute.UserProfile) },
                    onNewArticle = { navController.navigate(ReaderRoute.NewArticle) },
                    onNewMusic = { navController.navigate(ReaderRoute.NewMusic) },
                    onOpenArticle = openSubmittedArticle,
                    onOpenComment = { comment ->
                        if (comment.blogId.isNotBlank()) {
                            navController.navigate(ReaderRoute.article(comment.blogId, "comments"))
                        }
                    },
                    initialTab = tab,
                    focusMessageId = if (tabKey == "messages") focus else "",
                    focusContentId = if (tabKey == "content") focus else "",
                    focusCommentId = if (tabKey == "comments") focus else ""
                )
            }

            composable(ReaderRoute.UserProfile, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                UserProfileScreen(
                    viewModel = workspaceViewModel,
                    onBackClick = { navController.popBackStack() }
                )
            }

            composable(ReaderRoute.NewArticle, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                NewArticleScreen(
                    viewModel = workspaceViewModel,
                    onBackClick = { navController.popBackStack() },
                    onCompleteProfile = { navController.navigate(ReaderRoute.UserProfile) }
                )
            }

            composable(ReaderRoute.NewMusic, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                NewMusicScreen(
                    viewModel = workspaceViewModel,
                    onBackClick = { navController.popBackStack() },
                    onCompleteProfile = { navController.navigate(ReaderRoute.UserProfile) }
                )
            }

            // Bookmarks / Saved Screen
            composable(ReaderRoute.Bookmarks, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                val bookmarksViewModel: BookmarksViewModel = viewModel(factory = mainFactory)
                BookmarksScreen(
                    viewModel = bookmarksViewModel,
                    onBackClick = { navController.popBackStack() },
                    onArticleClick = { navController.navigate(ReaderRoute.article(it)) }
                )
            }

            // PDF Archive Screen
            composable(ReaderRoute.PdfArchive, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                val pdfViewModel: PdfArchiveViewModel = viewModel(factory = mainFactory)
                PdfArchiveScreen(
                    viewModel = pdfViewModel,
                    onNavigateBack = { navController.popBackStack() },
                    onOpenPdf = { pdfId ->
                        navController.navigate(ReaderRoute.pdfViewer(pdfId))
                    }
                )
            }

            // PDF Viewer Screen
            composable(
                enterTransition = navEnter,
                exitTransition = navExit,
                popEnterTransition = navPopEnter,
                popExitTransition = navPopExit,
                route = ReaderRoute.PdfViewer,
                arguments = listOf(navArgument("pdfId") { type = NavType.StringType })
            ) { entry ->
                val pdfId = entry.arguments?.getString("pdfId").orEmpty()
                val pdfViewerViewModel: PdfViewerViewModel = viewModel(factory = mainFactory)
                PdfViewerScreen(
                    pdfId = pdfId,
                    viewModel = pdfViewerViewModel,
                    onNavigateBack = { navController.popBackStack() }
                )
            }

            // Explore: categories, authors, annual issues, popular
            composable(
                enterTransition = navEnter,
                exitTransition = navExit,
                popEnterTransition = navPopEnter,
                popExitTransition = navPopExit,
                route = ReaderRoute.ExplorePattern,
                arguments = listOf(
                    navArgument("tab") {
                        type = NavType.StringType
                        defaultValue = ExploreTab.Categories.key
                    }
                )
            ) { entry ->
                val tab = ExploreTab.fromKey(entry.arguments?.getString("tab"))
                val exploreViewModel: ExploreViewModel = viewModel(factory = portalFactory)
                ExploreScreen(
                    viewModel = exploreViewModel,
                    initialTab = tab,
                    tabRequest = exploreTabRequest,
                    onMenuClick = { coroutineScope.launch { drawerState.open() } },
                    onSearchClick = { navController.navigate(ReaderRoute.Search) },
                    onArticleClick = { navController.navigate(ReaderRoute.article(it)) },
                    onCategoryClick = { navController.navigate(ReaderRoute.category(it)) },
                    onAuthorClick = { navController.navigate(ReaderRoute.author(it)) },
                    onIssueClick = { navController.navigate(ReaderRoute.issue(it)) }
                )
            }

            composable(ReaderRoute.Videos, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                val homeViewModel: HomeViewModel = viewModel(factory = portalFactory)
                VideosScreen(
                    viewModel = homeViewModel,
                    onBackClick = { navController.popBackStack() }
                )
            }

            composable(ReaderRoute.Music, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                val homeViewModel: HomeViewModel = viewModel(factory = portalFactory)
                MusicScreen(
                    viewModel = homeViewModel,
                    onBackClick = { navController.popBackStack() },
                    onGenreClick = { navController.navigate(ReaderRoute.musicGenre(it)) },
                    onArtistClick = { navController.navigate(ReaderRoute.musicArtist(it)) },
                    onAlbumClick = { navController.navigate(ReaderRoute.musicAlbum(it)) }
                )
            }

            composable(
                enterTransition = navEnter,
                exitTransition = navExit,
                popEnterTransition = navPopEnter,
                popExitTransition = navPopExit,
                route = ReaderRoute.MusicGenre,
                arguments = listOf(navArgument("name") { type = NavType.StringType })
            ) { entry ->
                val homeViewModel: HomeViewModel = viewModel(factory = portalFactory)
                MusicEntityScreen(
                    kind = MusicShelfKind.Genre,
                    name = entry.arguments?.getString("name").orEmpty(),
                    viewModel = homeViewModel,
                    onBackClick = { navController.popBackStack() },
                    onArtistClick = { navController.navigate(ReaderRoute.musicArtist(it)) },
                    onAlbumClick = { navController.navigate(ReaderRoute.musicAlbum(it)) },
                    onGenreClick = { navController.navigate(ReaderRoute.musicGenre(it)) }
                )
            }

            composable(
                enterTransition = navEnter,
                exitTransition = navExit,
                popEnterTransition = navPopEnter,
                popExitTransition = navPopExit,
                route = ReaderRoute.MusicArtist,
                arguments = listOf(navArgument("name") { type = NavType.StringType })
            ) { entry ->
                val homeViewModel: HomeViewModel = viewModel(factory = portalFactory)
                MusicEntityScreen(
                    kind = MusicShelfKind.Artist,
                    name = entry.arguments?.getString("name").orEmpty(),
                    viewModel = homeViewModel,
                    onBackClick = { navController.popBackStack() },
                    onArtistClick = { navController.navigate(ReaderRoute.musicArtist(it)) },
                    onAlbumClick = { navController.navigate(ReaderRoute.musicAlbum(it)) },
                    onGenreClick = { navController.navigate(ReaderRoute.musicGenre(it)) }
                )
            }

            composable(
                enterTransition = navEnter,
                exitTransition = navExit,
                popEnterTransition = navPopEnter,
                popExitTransition = navPopExit,
                route = ReaderRoute.MusicAlbum,
                arguments = listOf(navArgument("name") { type = NavType.StringType })
            ) { entry ->
                val homeViewModel: HomeViewModel = viewModel(factory = portalFactory)
                MusicEntityScreen(
                    kind = MusicShelfKind.Album,
                    name = entry.arguments?.getString("name").orEmpty(),
                    viewModel = homeViewModel,
                    onBackClick = { navController.popBackStack() },
                    onArtistClick = { navController.navigate(ReaderRoute.musicArtist(it)) },
                    onAlbumClick = { navController.navigate(ReaderRoute.musicAlbum(it)) },
                    onGenreClick = { navController.navigate(ReaderRoute.musicGenre(it)) }
                )
            }

            // Featured Articles Screen
            composable(ReaderRoute.Featured, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                val homeViewModel: com.ningshingche.app.ui.viewmodel.HomeViewModel = viewModel(factory = mainFactory)
                FeaturedScreen(
                    viewModel = homeViewModel,
                    onBackClick = { navController.popBackStack() },
                    onArticleClick = { navController.navigate(ReaderRoute.article(it)) }
                )
            }

            // About Screen
            composable(ReaderRoute.About, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                AboutScreen(onBackClick = { navController.popBackStack() })
            }

            // Authors Directory Screen
            composable(ReaderRoute.AuthorsDirectory, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                val exploreViewModel: ExploreViewModel = viewModel(factory = portalFactory)
                AuthorsDirectoryScreen(
                    viewModel = exploreViewModel,
                    onBackClick = { navController.popBackStack() },
                    onAuthorClick = { navController.navigate(ReaderRoute.author(it)) }
                )
            }

            // Social Activities Screen
            composable(ReaderRoute.SocialActivities, enterTransition = navEnter, exitTransition = navExit, popEnterTransition = navPopEnter, popExitTransition = navPopExit) {
                val exploreViewModel: ExploreViewModel = viewModel(factory = portalFactory)
                SocialActivitiesScreen(
                    viewModel = exploreViewModel,
                    onBackClick = { navController.popBackStack() },
                    onArticleClick = { navController.navigate(ReaderRoute.article(it)) }
                )
            }

        }
        MusicMiniPlayerBar(controller = app.musicController)
        }
    }
    MusicFullPlayerOverlay(controller = app.musicController)
    AppToastHost(
        modifier = Modifier.padding(
            // Clears the mini player, which is 52dp of content below the
            // system navigation bar inset.
            bottom = if (playerUi.visible && !playerUi.expanded) 56.dp else 0.dp
        )
    )
    }
    }
}
