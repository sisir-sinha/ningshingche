package com.ningshingche.app.ui.reader

import androidx.navigation.NavHostController

/**
 * Bottom tabs always lead to the section's main page, not a saved detail page.
 * Keep Home as the back-stack base, including when an external deep link opened
 * the app without Home in its stack. Do not restore saved drawer/tab stacks.
 */
internal fun NavHostController.navigateToBottomRoot(route: String) {
    require(route in setOf(ReaderRoute.Home, ReaderRoute.Music, ReaderRoute.Forum))

    val homeInStack = try {
        getBackStackEntry(ReaderRoute.Home)
        true
    } catch (_: IllegalArgumentException) {
        false
    }

    if (homeInStack) {
        // Drop every nested route, even when reselecting its currently active tab.
        popBackStack(ReaderRoute.Home, inclusive = false, saveState = false)
    } else {
        // A deep link may have built a stack without Home. Remove that stack and
        // put Home underneath Music/Forum so Back has a predictable destination.
        navigate(ReaderRoute.Home) {
            popUpTo(graph.id) { inclusive = false; saveState = false }
            launchSingleTop = true
            restoreState = false
        }
    }
    if (route != ReaderRoute.Home) {
        navigate(route) {
            launchSingleTop = true
            restoreState = false
        }
    }
}
