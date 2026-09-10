package com.ningshingche.app.notifications

import android.content.Intent
import com.ningshingche.app.ui.reader.ReaderRoute

fun routeFromLaunchIntent(intent: Intent?): String? {
    if (intent == null) return null
    val extraRoute = intent.getStringExtra(AppNotificationManager.EXTRA_ROUTE).orEmpty()
    val target = intent.getStringExtra(AppNotificationManager.EXTRA_TARGET_ID).orEmpty()
        .substringAfterLast('/')
        .substringBefore('?')
    when (extraRoute) {
        AppNotificationManager.ROUTE_ARTICLE,
        AppNotificationManager.ROUTE_COMMENT ->
            if (target.isNotBlank() && target != AppNotificationManager.ROUTE_INBOX) {
                return ReaderRoute.article(target)
            }
        AppNotificationManager.ROUTE_PDF ->
            if (target.isNotBlank()) return ReaderRoute.pdfViewer(target)
        AppNotificationManager.ROUTE_INBOX -> return ReaderRoute.dashboard("messages")
        AppNotificationManager.ROUTE_SETTINGS -> return ReaderRoute.Settings
        AppNotificationManager.ROUTE_VIDEOS -> return ReaderRoute.Videos
        AppNotificationManager.ROUTE_MUSIC -> return ReaderRoute.Music
        AppNotificationManager.ROUTE_HOME -> return ReaderRoute.Home
    }
    val data = intent.data ?: return null
    val path = data.path.orEmpty()
    if (path.contains("/article/")) {
        val slug = path.substringAfterLast('/').substringBefore('?')
        if (slug.isNotBlank()) return ReaderRoute.article(slug)
    }
    return null
}
