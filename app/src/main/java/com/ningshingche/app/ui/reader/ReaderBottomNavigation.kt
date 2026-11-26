package com.ningshingche.app.ui.reader

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import com.ningshingche.app.ui.i18n.t
import com.ningshingche.app.ui.theme.Kalpurush

internal enum class ReaderBottomTab { Menu, Home, Music, Forum }

/** A detail page keeps its section selected; unrelated destinations select none. */
internal fun selectedReaderBottomTab(route: String, drawerOpen: Boolean): ReaderBottomTab? {
    if (drawerOpen) return ReaderBottomTab.Menu
    return when (route) {
        ReaderRoute.Home -> ReaderBottomTab.Home
        ReaderRoute.Music, ReaderRoute.MusicGenre, ReaderRoute.MusicArtist,
        ReaderRoute.MusicAlbum -> ReaderBottomTab.Music
        ReaderRoute.Forum, ReaderRoute.ForumRoom, ReaderRoute.ForumThread,
        ReaderRoute.ForumNew, ReaderRoute.ForumNewPattern -> ReaderBottomTab.Forum
        else -> null
    }
}

/** The drawer remains the existing sidebar; this bar only provides its entry point. */
@Composable
internal fun ReaderBottomNavigation(
    currentRoute: String,
    drawerOpen: Boolean,
    onMenu: () -> Unit,
    onHome: () -> Unit,
    onMusic: () -> Unit,
    onForum: () -> Unit
) {
    val selected = selectedReaderBottomTab(currentRoute, drawerOpen)
    NavigationBar(
        containerColor = MaterialTheme.colorScheme.surface,
        modifier = Modifier.testTag("reader_bottom_navigation")
    ) {
        NavigationBarItem(
            selected = selected == ReaderBottomTab.Menu, onClick = onMenu,
            icon = { Icon(Icons.Default.Menu, contentDescription = null) },
            label = { Text(t("মেনু"), fontFamily = Kalpurush, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            modifier = Modifier.testTag("bottom_menu")
        )
        NavigationBarItem(
            selected = selected == ReaderBottomTab.Home, onClick = onHome,
            icon = { Icon(Icons.Default.Home, contentDescription = null) },
            label = { Text(t("ঘর"), fontFamily = Kalpurush, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            modifier = Modifier.testTag("bottom_home")
        )
        NavigationBarItem(
            selected = selected == ReaderBottomTab.Music, onClick = onMusic,
            icon = { Icon(Icons.Default.MusicNote, contentDescription = null) },
            label = { Text(t("মিউজিক"), fontFamily = Kalpurush, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            modifier = Modifier.testTag("bottom_music")
        )
        NavigationBarItem(
            selected = selected == ReaderBottomTab.Forum, onClick = onForum,
            icon = { Icon(Icons.Default.Forum, contentDescription = null) },
            label = { Text(t("ফোরাম"), fontFamily = Kalpurush, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            modifier = Modifier.testTag("bottom_forum")
        )
    }
}
