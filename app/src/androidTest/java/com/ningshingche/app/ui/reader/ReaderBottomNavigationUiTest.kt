package com.ningshingche.app.ui.reader

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ReaderBottomNavigationUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun fourActionsAndDefaultHomeSelection() {
        val clicks = mutableListOf<String>()
        compose.setContent {
            MaterialTheme {
                ReaderBottomNavigation(
                    currentRoute = ReaderRoute.Home, drawerOpen = false,
                    onMenu = { clicks += "menu" }, onHome = { clicks += "home" },
                    onMusic = { clicks += "music" }, onForum = { clicks += "forum" }
                )
            }
        }
        compose.onNodeWithTag("bottom_home").assertIsSelected()
        listOf("menu", "home", "music", "forum").forEach { item ->
            compose.onNodeWithTag("bottom_$item").assertIsDisplayed().performClick()
        }
        assertEquals(listOf("menu", "home", "music", "forum"), clicks)
    }
}
