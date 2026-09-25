package dev.mekholi.core.cli

import dev.mekholi.core.ApiException
import dev.mekholi.core.CompleteSaleRequest
import dev.mekholi.core.Connectivity
import dev.mekholi.core.FailureKind
import dev.mekholi.core.HttpTransport
import dev.mekholi.core.MekholiApi
import dev.mekholi.core.MekholiConfig
import dev.mekholi.core.Outbox
import dev.mekholi.core.OutboxStore
import dev.mekholi.core.QueuedWrite
import dev.mekholi.core.SaleItemPayload
import dev.mekholi.core.SalePaymentPayload
import dev.mekholi.core.Session
import dev.mekholi.core.SyncEngine
import dev.mekholi.core.anonConfig
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID

/**
 * The reference client, runnable.
 *
 * This is the file that answers the roadmap's last box — "Android reference:
 * login + POS against the same RPCs" — with something that actually runs. The
 * Android app in `android/app` is a Compose shell around exactly this core; the
 * core is plain Kotlin/JVM, so it can be executed here, against the live
 * project, by `npm run e2e:android`.
 *
 * Three commands, and the third is the interesting one:
 *
 *   `pos`      sign in, resolve the floor, read the catalogue, take a sale,
 *              resend that exact request — the server answers with the sale it
 *              already wrote, not a second one.
 *   `offline`  take a sale through a transport pointed at a dead address, so
 *              the outbox holds it. Nothing is sent.
 *   `sync`     drain the outbox over a working connection. This is a *separate
 *              process*: the queue survived a restart, exactly as it must on a
 *              till that was switched off at closing time.
 *   `retry`    put the refused writes back in line and drain. A refusal is
 *              parked until a person acts — the till's "Try again".
 *
 * Output is line-oriented (`key value...`) so a harness can assert on it; the
 * authority is always the database, which the harness checks separately.
 */
fun main(args: Array<String>) {
    val command = args.firstOrNull() ?: "pos"
    try {
        when (command) {
            "pos" -> pos()
            "offline" -> offline()
            "sync" -> sync()
            "retry" -> retry()
            else -> fail("unknown command '$command' (expected: pos, offline, sync, retry)")
        }
    } catch (error: ApiException) {
        fail("server refused: ${error.detail}")
    } catch (error: Throwable) {
        fail(error.message ?: error.toString())
    }
}

// ── Commands ──────────────────────────────────────────────────────────────

/**
 * The whole till, once: sign in, look, sell, and sell again by accident.
 */
private fun pos() {
    val context = Context.fromEnv()
    val session = context.api.signIn(context.email, context.password)
    println("signed-in ${session.userId ?: "?"}")

    val payload = context.api.sessionPayload(session.accessToken)
    val organization = payload.primary() ?: fail("this user belongs to no shop")
    println("org ${organization.organizationId} ${organization.name} ${organization.currency}")
    if (!payload.can("sales.create")) fail("this user may not create sales")

    val floor = context.api.salesFloor(session.accessToken, context.branchId)
    println("floor ${floor.branchId} ${floor.warehouseId} ${floor.registerId ?: "-"}")

    val rows = context.api.catalog(session.accessToken, floor.warehouseId)
    val product = rows.firstOrNull { it.variantId == context.variantId }
        ?: fail("variant ${context.variantId} is not in this shop's catalogue")
    println("catalog ${product.variantId} ${product.name} ${product.price} available=${product.available ?: "-"}")

    // The reference is minted here, before the first attempt — the same rule the
    // browser follows. If this call times out after the server committed, the
    // resend below finds the sale instead of creating a twin.
    val clientRef = UUID.randomUUID().toString()
    val priced = (product.price * context.quantity)
    val request = CompleteSaleRequest(
        branchId = floor.branchId,
        items = listOf(SaleItemPayload(product.variantId, context.quantity)),
        payments = listOf(SalePaymentPayload(context.methodId, priced)),
        registerId = floor.registerId,
        warehouseId = floor.warehouseId,
        clientRef = clientRef,
    )
    val body = context.api.encodeSale(request)

    val first = context.api.completeSale(session.accessToken, body)
    println("sale ${first.invoiceNo} ${first.saleId} total=${first.total}")

    val replay = context.api.completeSale(session.accessToken, body)
    println(
        "replay ${replay.invoiceNo} ${replay.saleId} " +
            "same=${replay.saleId == first.saleId}"
    )
    println("client-ref $clientRef")
}

/**
 * The connection is gone; the shop is not closed.
 *
 * A transport pointed at a dead address is what a dropped uplink looks like to
 * this client: the write cannot be sent, it lands in the outbox, and the till
 * keeps taking money. The sale is not attempted again here — the caller learns
 * the reference so it can be matched later.
 */
private fun offline() {
    val context = Context.fromEnv()
    val session = context.api.signIn(context.email, context.password)
    val floor = context.api.salesFloor(session.accessToken, context.branchId)
    val product = context.api.catalog(session.accessToken, floor.warehouseId)
        .firstOrNull { it.variantId == context.variantId }
        ?: fail("variant ${context.variantId} is not in this shop's catalogue")

    val deadApi = MekholiApi(
        MekholiConfig(context.offlineUrl, context.anonKey),
        HttpTransport(MekholiConfig(context.offlineUrl, context.anonKey)),
    )

    val outbox = Outbox(FileOutboxStore(context.outboxPath))
    val engine = SyncEngine(
        api = deadApi,
        outbox = outbox,
        connectivity = AlwaysOnline,
        token = { session.accessToken },
    )

    val clientRef = UUID.randomUUID().toString()
    val priced = product.price * context.quantity
    val body = context.api.encodeSale(
        CompleteSaleRequest(
            branchId = floor.branchId,
            items = listOf(SaleItemPayload(context.variantId, context.quantity)),
            payments = listOf(SalePaymentPayload(context.methodId, priced)),
            registerId = floor.registerId,
            warehouseId = floor.warehouseId,
            clientRef = clientRef,
        )
    )

    engine.enqueueSale(body, clientRef)
    val result = engine.drain()

    if (result.sent != 0) fail("a sale was sent through a dead connection")
    if (!result.stopped) fail("the outbox did not report the connection as gone")
    println("queued $clientRef remaining=${result.remaining}")
}

/**
 * Somewhere later, on a working connection: send what is waiting.
 *
 * This one is a fresh process. The outbox was a file, the till was switched
 * off, and the sale is still there — which is the property a shop actually
 * needs. The server recognises the reference and returns the sale it already
 * has, so running this twice is safe.
 */
private fun sync() {
    val context = Context.fromEnv()
    val session = context.api.signIn(context.email, context.password)

    val outbox = Outbox(FileOutboxStore(context.outboxPath))
    val engine = SyncEngine(
        api = context.api,
        outbox = outbox,
        connectivity = AlwaysOnline,
        token = { session.accessToken },
    )

    engine.refresh()
    for (write in outbox.list()) println("waiting ${write.ref} attempts=${write.attempts}")

    val result = engine.drain()
    println("drained sent=${result.sent} failed=${result.failed} remaining=${result.remaining}")
    for (write in outbox.failures()) println("failed ${write.ref} ${write.lastError ?: ""}")
    println("status pending=${engine.status.pending} settled=${engine.status.settled}")
}

/**
 * "Try again" — for the writes the server said no to.
 *
 * A refusal is parked, not retried on a timer: it will keep being refused until
 * something changes, and a queue that retried forever would hide why. This is
 * the reference client's equivalent of the button the till's queue panel shows,
 * and it is what proves the other half of the offline promise — a refusal keeps
 * the sale, and a person can send it again once the cause is gone.
 */
private fun retry() {
    val context = Context.fromEnv()
    val session = context.api.signIn(context.email, context.password)

    val outbox = Outbox(FileOutboxStore(context.outboxPath))
    val engine = SyncEngine(
        api = context.api,
        outbox = outbox,
        connectivity = AlwaysOnline,
        token = { session.accessToken },
    )

    engine.refresh()
    val parked = outbox.failures().map { it.ref }
    println("requeued ${parked.size}")
    for (ref in parked) outbox.retry(ref)

    engine.refresh()
    val result = engine.drain()
    println("drained sent=${result.sent} failed=${result.failed} remaining=${result.remaining}")
    for (write in outbox.failures()) println("failed ${write.ref} ${write.lastError ?: ""}")
    println("status pending=${engine.status.pending} settled=${engine.status.settled}")
}

// ── Plumbing ──────────────────────────────────────────────────────────────

/**
 * A file-backed outbox.
 *
 * Android implements `OutboxStore` with SQLite (`AndroidOutboxStore`); the
 * reference CLI implements it with a file so the queue can be shown surviving a
 * process restart. Both satisfy the same three-method interface, which is the
 * point: the queue's rules live in `Outbox`, not in the storage.
 */
class FileOutboxStore(private val path: String) : OutboxStore {
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = false }

    private fun read(): List<QueuedWrite> {
        val file = File(path)
        if (!file.exists()) return emptyList()
        return runCatching { json.decodeFromString(ListSerializer, file.readText()) }.getOrDefault(emptyList())
    }

    private fun writeAll(writes: List<QueuedWrite>) {
        val file = File(path)
        file.parentFile?.mkdirs()
        file.writeText(json.encodeToString(ListSerializer, writes))
    }

    override fun list(): List<QueuedWrite> = read()
    override fun put(write: QueuedWrite) {
        writeAll(read().filter { it.ref != write.ref } + write)
    }
    override fun remove(ref: String) {
        writeAll(read().filter { it.ref != ref })
    }
    override fun find(ref: String): QueuedWrite? = read().firstOrNull { it.ref == ref }

    private companion object {
        val ListSerializer = kotlinx.serialization.builtins.ListSerializer(QueuedWrite.serializer())
    }
}

private object AlwaysOnline : Connectivity {
    override fun isOnline(): Boolean = true
    override fun onChange(listener: (Boolean) -> Unit): () -> Unit = {}
}

/** Everything the commands need, read from the environment the harness sets. */
private class Context(
    val api: MekholiApi,
    val anonKey: String,
    val email: String,
    val password: String,
    val branchId: String,
    val variantId: String,
    val methodId: String,
    val quantity: Double,
    val outboxPath: String,
    val offlineUrl: String,
) {
    companion object {
        fun fromEnv(): Context {
            val url = env("MEKHOLI_SUPABASE_URL")
            val anonKey = env("MEKHOLI_ANON_KEY")
            val config = anonConfig(url, anonKey)
            return Context(
                api = MekholiApi(config, HttpTransport(config)),
                anonKey = anonKey,
                email = env("MEKHOLI_EMAIL"),
                password = env("MEKHOLI_PASSWORD"),
                branchId = env("MEKHOLI_BRANCH_ID"),
                variantId = env("MEKHOLI_VARIANT_ID"),
                methodId = env("MEKHOLI_METHOD_ID"),
                quantity = env("MEKHOLI_QTY", "1").toDouble(),
                outboxPath = env("MEKHOLI_OUTBOX", "mekholi-outbox.json"),
                offlineUrl = env("MEKHOLI_OFFLINE_URL", "http://127.0.0.1:1"),
            )
        }

        private fun env(name: String, fallback: String? = null): String =
            System.getenv(name)?.takeIf { it.isNotBlank() }
                ?: fallback
                ?: throw IllegalStateException("$name is not set")
    }
}

/** Non-zero exit for the harness, with the reason on stdout rather than in a stack trace. */
private fun fail(message: String): Nothing {
    println("error $message")
    println("failed")
    System.out.flush()
    kotlin.system.exitProcess(1)
}
