package com.ningshingche.app.notifications

import android.content.Intent
import android.net.Uri
import com.ningshingche.app.data.portal.websiteArticleUrl
import com.ningshingche.app.ui.reader.ReaderRoute
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ArticleLaunchRouteTest {
    @Test fun currentWebsiteLinkAndOlderNotificationsOpenTheArticle() {
        val slug = "মণিপুরী-সংকীর্তন-ধনকৃষ্ণ-অধিকারী"
        val url = websiteArticleUrl(slug, "2025-08-11")!!
        assertEquals(ReaderRoute.article(slug), routeFromLaunchIntent(Intent(Intent.ACTION_VIEW, Uri.parse("$url/"))))
        val notification = Intent().putExtra(AppNotificationManager.EXTRA_ROUTE, AppNotificationManager.ROUTE_ARTICLE)
            .putExtra(AppNotificationManager.EXTRA_TARGET_ID, "$url/")
        assertEquals(ReaderRoute.article(slug), routeFromLaunchIntent(notification))
        assertEquals(ReaderRoute.article(slug), routeFromLaunchIntent(Intent(Intent.ACTION_VIEW, Uri.parse("https://ningshingche.com/article/$slug"))))
    }

    @Test fun categoryLinksAreNotMistakenForArticles() {
        assertNull(routeFromLaunchIntent(Intent(Intent.ACTION_VIEW, Uri.parse("https://ningshingche.com/category/poetry"))))
    }
}
