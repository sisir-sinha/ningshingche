package com.ningshingche.app.ui.reader

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test

/** Real Navigation Compose stacks, exercised through the actual bottom bar. */
class BottomNavigationRoutingUiTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var nav: NavHostController

    private fun showGraph(start: String = ReaderRoute.Home) {
        compose.setContent {
            MaterialTheme {
                nav = rememberNavController()
                Column(Modifier.fillMaxSize()) {
                    NavHost(navController = nav, startDestination = start, modifier = Modifier.weight(1f)) {
                        composable(ReaderRoute.Home) { Text("home page") }
                        composable(ReaderRoute.Music) { Text("music page") }
                        composable(ReaderRoute.Forum) { Text("forum page") }
                        composable("article-detail") { Text("article") }
                        composable("music-detail") { Text("music detail") }
                        composable("forum-detail") { Text("forum detail") }
                        composable("external-entry") { Text("external") }
                    }
                    ReaderBottomNavigation(
                        currentRoute = nav.currentDestination?.route.orEmpty(),
                        drawerOpen = false, onMenu = {},
                        onHome = { nav.navigateToBottomRoot(ReaderRoute.Home) },
                        onMusic = { nav.navigateToBottomRoot(ReaderRoute.Music) },
                        onForum = { nav.navigateToBottomRoot(ReaderRoute.Forum) }
                    )
                }
            }
        }
        compose.waitForIdle()
    }

    private fun navigate(route: String) {
        compose.runOnIdle { nav.navigate(route) }
        compose.waitForIdle()
    }

    private fun tap(tab: String, expected: String) {
        compose.onNodeWithTag("bottom_$tab").performClick()
        compose.runOnIdle { assertEquals(expected, nav.currentDestination?.route) }
    }

    @Test fun eachBottomTabAlwaysOpensItsMainPage() {
        showGraph()
        navigate("article-detail")
        tap("home", ReaderRoute.Home)
        navigate("article-detail")
        tap("music", ReaderRoute.Music)
        navigate("music-detail")
        tap("music", ReaderRoute.Music)
        navigate("forum-detail")
        tap("forum", ReaderRoute.Forum)
        navigate("forum-detail")
        tap("forum", ReaderRoute.Forum)
        compose.runOnIdle {
            nav.popBackStack()
            assertEquals(ReaderRoute.Home, nav.currentDestination?.route)
        }
    }

    @Test fun savedStacksAreNotRestoredByTheBottomTabs() {
        showGraph()
        navigate(ReaderRoute.Music)
        navigate("music-detail")
        compose.runOnIdle {
            nav.navigate(ReaderRoute.Forum) {
                popUpTo(ReaderRoute.Home) { saveState = true }
                restoreState = true
            }
        }
        tap("music", ReaderRoute.Music)
        compose.runOnIdle {
            assertFalse(runCatching { nav.getBackStackEntry("music-detail") }.isSuccess)
        }
    }

    @Test fun deepLinkWithoutHomeGetsHomeAsBackStackBase() {
        showGraph(start = "external-entry")
        tap("forum", ReaderRoute.Forum)
        compose.runOnIdle {
            nav.popBackStack()
            assertEquals(ReaderRoute.Home, nav.currentDestination?.route)
        }
        navigate("article-detail")
        tap("home", ReaderRoute.Home)
    }
}
