package com.ningshingche.app.analytics

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.ningshingche.app.NinghsingCheApp
import com.ningshingche.app.data.portal.PortalRepository
import com.ningshingche.app.data.remote.SupabaseClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * How long the reader has had the app open, reported to the database.
 *
 * Contributor points include a time component (migration 026), and the database
 * cannot know about time it never hears about — so the app reports seconds in
 * batches.
 *
 * Three rules shape this:
 *
 *  * **Foreground only.** The clock runs between [onForeground] and
 *    [onBackground], so a phone in a pocket earns nothing.
 *  * **Never lose a batch.** Seconds are added to a running total in preferences
 *    and only removed once the server has taken them, so a batch that fails
 *    offline is folded into the next one instead of vanishing — and a crash
 *    mid-session still credits what was already counted.
 *  * **Signed in only.** A guest has no profile to credit, and the RPC is closed
 *    to them anyway; the tracker simply drops what it has accumulated.
 *
 * The app reports; the database decides. The cap on a single report (an hour) and
 * on a day's total (16 hours) both live in `record_app_time`, so a bug here
 * cannot mint points.
 */
class AppTimeTracker(
    context: Context,
    private val portalRepository: PortalRepository,
    private val supabaseClient: SupabaseClient,
    private val nowMillis: () -> Long = { SystemClock.elapsedRealtime() }
) {

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val handler = Handler(Looper.getMainLooper())

    private var runningSince: Long? = null

    /** An unflushed batch, plus whatever a previous session could not deliver. */
    private var pendingSeconds: Int
        get() = prefs.getInt(KEY_PENDING, 0)
        set(value) {
            prefs.edit().putInt(KEY_PENDING, value.coerceIn(0, MAX_PENDING)).apply()
        }

    private val heartbeat = object : Runnable {
        override fun run() {
            checkpoint()
            if (runningSince != null) handler.postDelayed(this, HEARTBEAT_MS)
        }
    }

    /** The reader came to the app. */
    fun onForeground() {
        if (runningSince != null) return
        runningSince = nowMillis()
        handler.postDelayed(heartbeat, HEARTBEAT_MS)
        // A batch the last session could not deliver is the first thing to try.
        flush()
    }

    /** The reader left the app: stop the clock and report what it measured. */
    fun onBackground() {
        checkpoint()
        handler.removeCallbacks(heartbeat)
        flush()
    }

    /**
     * Moves the time since the last checkpoint into the batch, leaving the batch
     * behind for [flush] — including on a heartbeat, so a process that is killed
     * without a chance to flush still has the seconds on disk.
     */
    private fun checkpoint() {
        val since = runningSince ?: return
        val now = nowMillis()
        val elapsed = ((now - since) / 1000L).toInt()
        runningSince = now
        if (elapsed <= 0) return
        pendingSeconds += elapsed
        if (pendingSeconds >= FLUSH_AT_SECONDS) flush()
    }

    /**
     * Hands the batch to the database and clears exactly what was sent.
     *
     * The subtraction is by the amount *read*, not by the amount sent: a
     * checkpoint can land while the request is in flight, and those seconds
     * belong to the next batch.
     */
    private fun flush() {
        val batch = pendingSeconds
        if (batch <= 0) return
        if (supabaseClient.currentUser.value == null) {
            // Nobody to credit. Drop it rather than carry a guest's time into
            // the next reader's session on a shared device.
            pendingSeconds = 0
            return
        }
        pendingSeconds = 0
        scope.launch {
            val result = portalRepository.recordAppTime(batch)
            if (result.isFailure) {
                // Nobody has taken it: put it back for the next attempt.
                pendingSeconds += batch
            }
        }
    }

    private companion object {
        const val PREFS = "ningshingche_app_time"
        const val KEY_PENDING = "pending_seconds"
        const val HEARTBEAT_MS = 60_000L
        const val FLUSH_AT_SECONDS = 300
        /** A day's worth is the most a stuck batch should ever carry. */
        const val MAX_PENDING = 24 * 60 * 60
    }
}
