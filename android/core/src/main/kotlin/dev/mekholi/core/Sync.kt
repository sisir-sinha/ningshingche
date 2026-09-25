package dev.mekholi.core

/**
 * The connection, as the platform sees it.
 *
 * A hint, never the truth: a captive portal reports "online" and a shop with a
 * dead uplink reports "online" too. It decides *when to try*, never whether a
 * sale is safe — the outbox's own results are the truth.
 */
interface Connectivity {
    fun isOnline(): Boolean
    /** Returns an unsubscribe function. Fires in both directions. */
    fun onChange(listener: (Boolean) -> Unit): () -> Unit
}

/** A one-shot timer, so nothing in this module needs an Android `Handler`. */
interface Scheduler {
    fun schedule(delayMs: Long, task: () -> Unit): () -> Unit
}

data class SyncStatus(
    val online: Boolean = true,
    val pending: Int = 0,
    val failed: Int = 0,
    val syncing: Boolean = false,
    val lastSyncedAt: Long? = null,
    val lastError: String? = null,
) {
    /** True when nothing is left to send, and nothing a person must decide about. */
    val settled: Boolean get() = pending == 0 && failed == 0
}

/**
 * Sends what the outbox is holding, and says what it is holding.
 *
 * Same shape and same guarantees as `SyncEngine` in the web client
 * (`src/shared/repositories/offline/sync.ts`), because the two are answering
 * the same question and a shop that switched between them must not be able to
 * tell which one it was using.
 */
class SyncEngine(
    private val api: MekholiApi,
    private val outbox: Outbox,
    private val connectivity: Connectivity,
    /** The live token: a till is signed in for hours, and tokens expire. */
    private val token: () -> String?,
    private val onStatus: (SyncStatus) -> Unit = {},
    private val scheduler: Scheduler? = null,
    private val intervalMs: Long = 20_000,
    private val now: () -> Long = { System.currentTimeMillis() },
) {

    private var unsubscribe: (() -> Unit)? = null
    private var cancelTimer: (() -> Unit)? = null
    private var draining = false

    var status: SyncStatus = SyncStatus()
        private set

    fun start(): SyncStatus {
        if (unsubscribe == null) {
            unsubscribe = connectivity.onChange { online ->
                publish(status.copy(online = online))
                if (online) drain()
            }
        }
        refresh()
        if (status.online && status.pending > 0) drain()
        schedule()
        return status
    }

    fun stop() {
        unsubscribe?.invoke()
        unsubscribe = null
        cancelTimer?.invoke()
        cancelTimer = null
    }

    /** Recompute the counts from the outbox, and publish. */
    fun refresh(): SyncStatus {
        publish(
            status.copy(
                online = connectivity.isOnline(),
                pending = outbox.pending().size,
                failed = outbox.failures().size,
            )
        )
        return status
    }

    /**
     * Try now, whether or not the platform thinks there is a connection.
     *
     * Single-flight: a drain that is already running is returned rather than
     * started again, because two drains racing is how the same sale gets sent
     * twice — which the server would survive (§044) but which is still work
     * nobody asked for.
     */
    @Synchronized
    fun drain(): DrainResult {
        if (draining) return DrainResult(0, 0, true, outbox.size())
        draining = true
        publish(status.copy(syncing = true))

        val result = try {
            outbox.drain { send(it) }
        } finally {
            draining = false
            publish(status.copy(syncing = false))
            refresh()
            schedule()
        }

        if (result.sent > 0 && !result.stopped) {
            publish(status.copy(lastSyncedAt = now(), lastError = null))
        }
        return result
    }

    /** Put a refused sale back in line and try again. */
    fun retry(ref: String) {
        outbox.retry(ref)
        refresh()
        drain()
    }

    fun discard(ref: String): QueuedWrite? {
        val removed = outbox.discard(ref)
        refresh()
        return removed
    }

    fun failures(): List<QueuedWrite> = outbox.failures()

    /**
     * Keep a sale the connection would not take, and hand back its reference.
     *
     * The body is the exact JSON of the RPC call — minted by `MekholiApi.encodeSale`
     * from the request the till built — so the replay is the same request with
     * the same reference, which is the whole of the exactly-once story.
     */
    fun enqueueSale(body: String, ref: String): QueuedWrite =
        outbox.enqueue(KIND_COMPLETE_SALE, body, ref)

    /**
     * One send of one queued sale.
     *
     * `23505` is the unique index on `(organization_id, client_ref)` saying
     * another attempt already wrote this sale — that is the outcome the outbox
     * wanted, so it counts as success. Treating it as a refusal would leave the
     * shop chasing a sale it already has.
     */
    private fun send(write: QueuedWrite): SendOutcome {
        val accessToken = token()
            ?: return SendOutcome(false, FailureKind.OFFLINE, "Not signed in.")
        return try {
            if (write.kind == KIND_COMPLETE_SALE) {
                api.completeSale(accessToken, write.body)
            }
            SendOutcome(true)
        } catch (error: ApiException) {
            if (error.code == DUPLICATE_KEY) SendOutcome(true)
            else SendOutcome(false, FailureKind.REFUSED, describe(error))
        } catch (error: Throwable) {
            val kind = classify(error)
            SendOutcome(false, kind, describe(error))
        }
    }

    private fun publish(next: SyncStatus) {
        val was = status
        status = next
        if (was != next) onStatus(next)
    }

    /**
     * One timer, re-armed rather than repeated. A `setInterval` racing a slow
     * upload is how a queue sends the same sale twice.
     */
    private fun schedule() {
        val timers = scheduler ?: return
        cancelTimer?.invoke()
        cancelTimer = null
        if (status.pending == 0 || !status.online) return
        cancelTimer = timers.schedule(intervalMs) { drain() }
    }

    companion object {
        const val KIND_COMPLETE_SALE = "sale.complete"
        const val DUPLICATE_KEY = "23505"
    }
}
