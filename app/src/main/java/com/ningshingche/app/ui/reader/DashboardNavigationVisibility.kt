package com.ningshingche.app.ui.reader

/** The dashboard owns its four-tab bar; other destinations retain the reader bar. */
internal fun isDashboardRoute(route: String): Boolean =
    route == ReaderRoute.UserDashboardPattern || route == ReaderRoute.UserDashboard
