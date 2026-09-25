package dev.mekholi.android.data

import android.os.Handler
import android.os.Looper
import dev.mekholi.core.Scheduler

/**
 * A one-shot timer on the main looper, for the sync engine's retry cadence.
 *
 * One timer, re-armed: `SyncEngine` cancels the previous handle before arming
 * the next, so a slow upload cannot be overtaken by its own retry. A
 * `setInterval` here would send the same sale twice — harmless server-side since
 * migration 044, and still work nobody asked for.
 */
class AndroidScheduler : Scheduler {
    private val handler = Handler(Looper.getMainLooper())

    override fun schedule(delayMs: Long, task: () -> Unit): () -> Unit {
        val runnable = Runnable { task() }
        handler.postDelayed(runnable, delayMs)
        return { handler.removeCallbacks(runnable) }
    }
}
