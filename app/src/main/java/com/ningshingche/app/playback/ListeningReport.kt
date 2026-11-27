package com.ningshingche.app.playback

/** Only complete seconds are sent; keep the fractional remainder for the next report. */
internal fun unreportedListeningSeconds(listenedMs: Long, reportedMs: Long): Int =
    ((listenedMs - reportedMs).coerceAtLeast(0L) / 1000L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()

internal fun reportedListeningMillis(previousMs: Long, seconds: Int): Long =
    previousMs + seconds.coerceAtLeast(0).toLong() * 1000L
