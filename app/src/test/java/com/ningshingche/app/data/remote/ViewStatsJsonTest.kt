package com.ningshingche.app.data.remote

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ViewStatsJsonTest {
    @Test fun parsesEveryNonzeroTotal() {
        val result = parseViewTotals(JSONObject("""{"article_views":2,"music_views":3,"forum_views":4,"visitors":5,"registered_views":6,"guest_views":7,"minutes_listened":16}"""))
        assertEquals(2L, result.articleViews)
        assertEquals(3L, result.musicViews)
        assertEquals(4L, result.forumViews)
        assertEquals(5L, result.visitors)
        assertEquals(6L, result.registeredViews)
        assertEquals(7L, result.guestViews)
        assertEquals(16L, result.minutesListened)
    }
    @Test fun parsesDailyVisitorsAndListening() {
        val day = parseViewDay(JSONObject("""{"day":"2026-11-21","views":10,"visitors":4,"minutes_listened":8}"""))
        assertEquals("2026-11-21", day.day)
        assertEquals(10L, day.views)
        assertEquals(4L, day.visitors)
        assertEquals(8L, day.minutesListened)
    }
    @Test fun missingAndMalformedFieldsAreErrorsNotZero() {
        assertTrue(runCatching { parseViewTotals(JSONObject("""{"article_views":0,"music_views":0}""")) }.isFailure)
        assertTrue(runCatching { parseViewDay(JSONObject("""{"day":"2026-11-21","views":0}""")) }.isFailure)
        assertTrue(runCatching { parseViewTotals(JSONObject("""{"article_views":"bad","music_views":0,"forum_views":0,"visitors":0,"registered_views":0,"guest_views":0,"minutes_listened":0}""")) }.isFailure)
    }
    @Test fun negativeCountersAreClamped() {
        val result = parseViewTotals(JSONObject("""{"article_views":-1,"music_views":0,"forum_views":0,"visitors":0,"registered_views":0,"guest_views":0,"minutes_listened":-2}"""))
        assertEquals(0L, result.articleViews)
        assertEquals(0L, result.minutesListened)
    }
}
