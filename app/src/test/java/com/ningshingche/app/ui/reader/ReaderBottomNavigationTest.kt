package com.ningshingche.app.ui.reader

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReaderBottomNavigationTest {
    @Test fun sectionSelectionIncludesDetailRoutes() {
        assertEquals(ReaderBottomTab.Home, selectedReaderBottomTab(ReaderRoute.Home, false))
        listOf(ReaderRoute.Music, ReaderRoute.MusicGenre, ReaderRoute.MusicArtist, ReaderRoute.MusicAlbum)
            .forEach { assertEquals(ReaderBottomTab.Music, selectedReaderBottomTab(it, false)) }
        listOf(ReaderRoute.Forum, ReaderRoute.ForumRoom, ReaderRoute.ForumThread, ReaderRoute.ForumNewPattern)
            .forEach { assertEquals(ReaderBottomTab.Forum, selectedReaderBottomTab(it, false)) }
        assertNull(selectedReaderBottomTab(ReaderRoute.Article, false))
        assertEquals(ReaderBottomTab.Menu, selectedReaderBottomTab(ReaderRoute.Home, true))
    }
}
