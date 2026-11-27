package com.ningshingche.app.notifications

import android.content.Intent
import com.ningshingche.app.ui.reader.ReaderRoute
import com.ningshingche.app.data.portal.articleIdFromWebsiteUrl

fun routeFromLaunchIntent(intent: Intent?): String? {
    if (intent == null) return null
    val extraRoute = intent.getStringExtra(AppNotificationManager.EXTRA_ROUTE).orEmpty()
    val rawTarget = intent.getStringExtra(AppNotificationManager.EXTRA_TARGET_ID).orEmpty()
    val isArticle = extraRoute == AppNotificationManager.ROUTE_ARTICLE ||
        extraRoute == AppNotificationManager.ROUTE_COMMENT
    val target = if (isArticle && (rawTarget.startsWith("https://") || rawTarget.startsWith("http://"))) {
        articleIdFromWebsiteUrl(rawTarget).orEmpty()
    } else {
        val segment = android.net.Uri.decode(rawTarget.substringBefore('?').trimEnd('/').substringAfterLast('/'))
        if (isArticle) segment.removeSuffix(".kehem") else segment
    }
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
    val slug = articleIdFromWebsiteUrl(data.toString()) ?: return null
    return ReaderRoute.article(slug)
}
