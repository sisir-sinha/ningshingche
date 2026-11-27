package com.ningshingche.app.ui.reader

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DashboardNavigationVisibilityTest {
    @Test fun hidesAppBarOnlyForDashboardDestination() {
        assertTrue(isDashboardRoute(ReaderRoute.UserDashboardPattern))
        assertTrue(isDashboardRoute(ReaderRoute.UserDashboard))
        listOf(ReaderRoute.Home, ReaderRoute.UserProfile, ReaderRoute.NewArticle,
            ReaderRoute.Music, ReaderRoute.Forum, ReaderRoute.Article).forEach {
            assertFalse("App bar unexpectedly hidden for $it", isDashboardRoute(it))
        }
    }
}
