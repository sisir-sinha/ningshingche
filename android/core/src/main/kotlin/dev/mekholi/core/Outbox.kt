package dev.mekholi.core

import kotlinx.serialization.Serializable
import java.util.UUID

/**
 * A sale that has been taken but not yet accepted by the server.
 *
 * `body` is the exact JSON of the `complete_sale` call, stored rather than
 * rebuilt: a replay must be the same request, or "the same reference" means
 * nothing. `ref` is the client reference inside that body — minted once, before
 * the first attempt.
 */
@Serializable
data class QueuedWrite(
    val ref: String,
    val kind: String,
    val body: String,
    val createdAt: Long,
    val attempts: Int = 0,
    val lastAttemptAt: Long? = null,
    val lastError: String? = null,
    val failed: Boolean = false,
)

/** Where the outbox lives. Android implements this with SQLite; tests, in memory. */
interface OutboxStore {
    fun list(): List<QueuedWrite>
    fun put(write: QueuedWrite)
    fun remove(ref: String)
    fun find(ref: String): QueuedWrite?
}

class InMemoryOutboxStore : OutboxStore {
    private val writes = LinkedHashMap<String, QueuedWrite>()
    override fun list(): List<QueuedWrite> = writes.values.toList()
    override fun put(write: QueuedWrite) { writes[write.ref] = write }
    override fun remove(ref: String) { writes.remove(ref) }
    override fun find(ref: String): QueuedWrite? = writes[ref]
}

data class SendOutcome(val ok: Boolean, val failure: FailureKind? = null, val message: String? = null)

data class DrainResult(val sent: Int, val failed: Int, val stopped: Boolean, val remaining: Int)

/**
 * The outbox, with the same rules as the browser's write queue.
 *
 * Those rules are short enough to state completely, and each one is a decision:
 *
 *   · **serial, oldest first.** One send in flight. A sale that cannot be sent
 *     must not let later sales overtake it — invoice numbers are a sequence,
 *     and a shop's books that run out of order are not books.
 *   · **a network failure keeps the write** and stops the drain, recording the
 *     attempt so the indicator can say "tried 4 times" rather than pretending
 *     nothing happened.
 *   · **a refusal is kept too**, marked failed, and does not block the queue:
 *     one sold-out line must not hold back the rest of the afternoon. A person
 *     decides about it — this file never throws a sale away.
 *   · **success deletes it.** The server owns that sale now, and keeping a copy
 *     would invite replaying it.
 */
class Outbox(
    private val store: OutboxStore,
    private val now: () -> Long = { System.currentTimeMillis() },
    private val newRef: () -> String = { UUID.randomUUID().toString() },
) {

    /** Take responsibility for a write and hand back its reference. */
    fun enqueue(kind: String, body: String, ref: String? = null): QueuedWrite {
        val write = QueuedWrite(
            ref = ref ?: newRef(),
            kind = kind,
            body = body,
            createdAt = now(),
        )
        store.put(write)
        return write
    }

    /** Everything waiting, oldest first, including what a person still owes a decision. */
    fun list(): List<QueuedWrite> = store.list().sortedWith(compareBy({ it.createdAt }, { it.ref }))

    fun pending(): List<QueuedWrite> = list().filter { !it.failed }

    fun failures(): List<QueuedWrite> = list().filter { it.failed }

    fun size(): Int = store.list().size

    fun find(ref: String): QueuedWrite? = store.find(ref)

    fun drain(send: (QueuedWrite) -> SendOutcome): DrainResult {
        var sent = 0
        var failed = 0
        var stopped = false

        for (write in list()) {
            if (write.failed) continue

            val started = now()
            val outcome = send(write)
            val attempt = write.copy(attempts = write.attempts + 1, lastAttemptAt = started)

            if (outcome.ok) {
                store.remove(write.ref)
                sent += 1
                continue
            }

            if (outcome.failure == FailureKind.OFFLINE) {
                store.put(attempt.copy(lastError = outcome.message))
                stopped = true
                break
            }

            store.put(
                attempt.copy(
                    failed = true,
                    lastError = outcome.message ?: "The server refused this sale.",
                )
            )
            failed += 1
        }

        return DrainResult(sent, failed, stopped, store.list().size)
    }

    /** Put a refused write back in line. A human decided this. */
    fun retry(ref: String): Boolean {
        val write = store.find(ref) ?: return false
        store.put(write.copy(failed = false, lastError = null))
        return true
    }

    /** Throw a write away. Only ever from an explicit choice. */
    fun discard(ref: String): QueuedWrite? {
        val write = store.find(ref) ?: return null
        store.remove(ref)
        return write
    }
}
