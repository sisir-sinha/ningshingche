package com.ningshingche.app.playback

import org.junit.Assert.assertEquals
import org.junit.Test

class ListeningReportTest {
    @Test fun preservesFractionAcrossReports() {
        val first = unreportedListeningSeconds(30_399L, 0L)
        assertEquals(30, first)
        val reported = reportedListeningMillis(0L, first)
        assertEquals(30_000L, reported)
        assertEquals(1, unreportedListeningSeconds(31_500L, reported))
    }
    @Test fun noNegativeAndNoSubsecondReports() {
        assertEquals(0, unreportedListeningSeconds(20_999L, 20_000L))
        assertEquals(0, unreportedListeningSeconds(19_000L, 20_000L))
        assertEquals(20_000L, reportedListeningMillis(20_000L, 0))
    }
}
