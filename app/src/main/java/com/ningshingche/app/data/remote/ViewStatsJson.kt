package com.ningshingche.app.data.remote

import com.ningshingche.app.data.portal.ViewDay
import com.ningshingche.app.data.portal.ViewTotals
import org.json.JSONObject

/** A missing field means this server cannot supply the full metric, not that it is zero. */
internal fun parseViewTotals(json: JSONObject): ViewTotals = ViewTotals(
    articleViews = json.getLong("article_views").coerceAtLeast(0L),
    musicViews = json.getLong("music_views").coerceAtLeast(0L),
    forumViews = json.getLong("forum_views").coerceAtLeast(0L),
    visitors = json.getLong("visitors").coerceAtLeast(0L),
    registeredViews = json.getLong("registered_views").coerceAtLeast(0L),
    guestViews = json.getLong("guest_views").coerceAtLeast(0L),
    minutesListened = json.getLong("minutes_listened").coerceAtLeast(0L)
)

internal fun parseViewDay(json: JSONObject): ViewDay = ViewDay(
    day = json.getString("day").take(10).also { require(it.isNotBlank()) },
    views = json.getLong("views").coerceAtLeast(0L),
    visitors = json.getLong("visitors").coerceAtLeast(0L),
    minutesListened = json.getLong("minutes_listened").coerceAtLeast(0L)
)
