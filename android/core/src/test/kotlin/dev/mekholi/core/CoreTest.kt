package dev.mekholi.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.system.exitProcess

/**
 * The core's own tests — the rules that must hold when nobody is watching.
 *
 * The live end-to-end run (`npm run e2e:android`) proves the reference client
 * works against the real project, but it needs the network, credentials and
 * about thirty seconds. These run in a second, in CI, on nothing but the JDK:
 * they pin the decisions that are easy to get wrong and expensive to get wrong
 * — what an outbox does when the connection drops (keep the sale), what it does
 * when the server says no (keep it *and* park it for a person), that a duplicate
 * reference counts as success, and that a receipt whose money arrives as a
 * number is refused rather than quietly misread.
 *
 * Deliberately no test framework: this module has one dependency (the Kotlin
 * standard library) and a shop's client should not need a build system upgrade
 * to stay honest. `npm run test:android` compiles and runs this file; a failure
 * prints the check and exits non-zero.
 */
private class Check(val name: String, val pass: Boolean, val detail: String)

private val checks = mutableListOf<Check>()

private fun section(title: String) = println("\n-- $title --")

private fun check(name: String, pass: Boolean, detail: String = "") {
    checks += Check(name, pass, detail)
    val mark = if (pass) "PASS" else "FAIL"
    val suffix = if (detail.isEmpty()) "" else "  ($detail)"
    println("  $mark  $name$suffix")
}

// ── Fakes ─────────────────────────────────────────────────────────────────

/** A transport whose answers the test decides, and which remembers the asks. */
private class FakeTransport : Transport {
    var answer: (HttpRequest) -> HttpResponse = { HttpResponse(200, "{}") }
    val requests = mutableListOf<HttpRequest>()

    override fun send(request: HttpRequest): HttpResponse {
        requests += request
        return answer(request)
    }
}

private class FakeConnectivity(var online: Boolean = true) : Connectivity {
    override fun isOnline(): Boolean = online
    override fun onChange(listener: (Boolean) -> Unit): () -> Unit = {}
}

private class FakeScheduler : Scheduler {
    var scheduled = 0
    var cancelled = 0
    var lastTask: (() -> Unit)? = null

    override fun schedule(delayMs: Long, task: () -> Unit): () -> Unit {
        scheduled += 1
        lastTask = task
        return { cancelled += 1 }
    }
}

private const val RECEIPT =
    """{"sale_id":"5b0f8e0e-5b1e-4f2a-9a1d-9f0b1c2d3e4f","invoice_no":"INV-2026-000001",""" +
        """"status":"COMPLETED","subtotal":"40.00","discount":"0.00","tax":"0.00",""" +
        """"total":"40.00","paid":"40.00","change_due":"0.00"}"""

private fun apiOver(transport: Transport) =
    MekholiApi(anonConfig("https://example.invalid", "anon-key"), transport)

private fun engineOver(
    transport: Transport,
    outbox: Outbox,
    connectivity: Connectivity = FakeConnectivity(),
    scheduler: Scheduler? = null,
) = SyncEngine(
    api = apiOver(transport),
    outbox = outbox,
    connectivity = connectivity,
    token = { "access-token" },
    scheduler = scheduler,
)

fun main() {
    wire()
    outbox()
    sync()
    session()
    receipts()

    val failed = checks.filter { !it.pass }
    println("\n${checks.size - failed.size}/${checks.size} core checks passed")
    if (failed.isNotEmpty()) exitProcess(1)
}

// ── The wire ──────────────────────────────────────────────────────────────

private fun wire() {
    section("the wire")

    val queued = QueuedWrite(
        ref = "ref-1",
        kind = SyncEngine.KIND_COMPLETE_SALE,
        body = """{"p_branch_id":"b1"}""",
        createdAt = 1_790_000_000_000,
        attempts = 3,
        lastAttemptAt = 1_790_000_000_500,
        lastError = "forbidden: organization 9d",
        failed = true,
    )
    val json = Json { ignoreUnknownKeys = true }
    val restored = json.decodeFromString(
        QueuedWrite.serializer(),
        json.encodeToString(QueuedWrite.serializer(), queued),
    )
    check("a queued sale survives the JSON an outbox file holds", restored == queued, restored.ref)

    val transport = FakeTransport()
    val api = apiOver(transport)
    val body = api.encodeSale(
        CompleteSaleRequest(
            branchId = "b1",
            items = listOf(SaleItemPayload("v1", 3.0)),
            payments = listOf(SalePaymentPayload("m1", 120.0)),
            registerId = "r1",
            warehouseId = "w1",
            clientRef = "ref-9",
        )
    )
    val parsed = Json.parseToJsonElement(body).jsonObject
    check(
        "a sale body speaks the RPC's own parameter names",
        parsed.containsKey("p_branch_id") && parsed.containsKey("p_items") &&
            parsed.containsKey("p_payments") && parsed.containsKey("p_client_ref"),
        parsed.keys.sorted().joinToString(","),
    )
    val qty = parsed.getValue("p_items").jsonArray.first().jsonObject
        .getValue("qty").jsonPrimitive.content
    check(
        "quantities travel as whole units, the scale the server converts from",
        qty.toDouble() == 3.0,
        "qty=$qty",
    )
    check(
        "and the reference is inside the body, so a replay is the same request",
        parsed.getValue("p_client_ref").jsonPrimitive.content == "ref-9",
    )
}

// ── The outbox ────────────────────────────────────────────────────────────

private fun outbox() {
    section("the outbox")

    val minted = Outbox(InMemoryOutboxStore()).enqueue(SyncEngine.KIND_COMPLETE_SALE, "{}")
    check(
        "an enqueue with no reference mints one",
        minted.ref.isNotBlank() && minted.ref.length == 36,
        minted.ref,
    )

    val store = InMemoryOutboxStore()
    val queue = Outbox(store, now = { 1_000 }, newRef = { "generated" })
    queue.enqueue(SyncEngine.KIND_COMPLETE_SALE, "{}", "ref-authored")
    check(
        "a reference minted before the first attempt is the one kept",
        queue.find("ref-authored")?.ref == "ref-authored" && queue.find("generated") == null,
    )

    // "We could not ask". The classification happens in the engine (the
    // transport throws, `SyncEngine.send` turns that into a kind); the outbox
    // acts on the kind, and the two rules it can act on are here.
    // A clock the test owns: the drain orders by creation time, and two writes
    // in the same millisecond would otherwise be ordered by their references.
    var tick = 1_000L
    val offline = Outbox(InMemoryOutboxStore(), now = { tick++ })
    offline.enqueue(SyncEngine.KIND_COMPLETE_SALE, "{}", "ref-offline")
    offline.enqueue(SyncEngine.KIND_COMPLETE_SALE, "{}", "ref-after")
    val dropped = offline.drain { write ->
        if (write.ref == "ref-offline") {
            SendOutcome(false, FailureKind.OFFLINE, "Could not reach the shop's server.")
        } else {
            error("the drain sent a sale after one it could not deliver")
        }
    }
    check(
        "a sale the connection could not carry stops the drain, so nothing overtakes it",
        dropped.sent == 0 && dropped.stopped && dropped.remaining == 2,
        "sent=${dropped.sent} stopped=${dropped.stopped} remaining=${dropped.remaining}",
    )
    check(
        "and it stays pending, with the attempt recorded, waiting for the connection",
        offline.find("ref-offline")?.attempts == 1 &&
            offline.failures().isEmpty() &&
            offline.find("ref-after")?.attempts == 0,
        "attempts=${offline.find("ref-offline")?.attempts} untouched=${offline.find("ref-after")?.attempts}",
    )

    // Serial, oldest first: invoice numbers are a sequence, and a shop's books
    // that run out of order are not books. The references are named backwards on
    // purpose, so only the clock can produce the expected order.
    var elapsed = 5_000L
    val ordered = Outbox(InMemoryOutboxStore(), now = { elapsed++ })
    ordered.enqueue(SyncEngine.KIND_COMPLETE_SALE, "{}", "zzz-written-first")
    ordered.enqueue(SyncEngine.KIND_COMPLETE_SALE, "{}", "aaa-written-second")
    val order = mutableListOf<String>()
    ordered.drain { write ->
        order += write.ref
        SendOutcome(true)
    }
    check(
        "the queue drains oldest first, whatever the references say",
        order == listOf("zzz-written-first", "aaa-written-second"),
        order.joinToString(","),
    )

    // "The server said no": kept, parked, and out of the way of the next sale.
    val refused = Outbox(InMemoryOutboxStore())
    refused.enqueue(SyncEngine.KIND_COMPLETE_SALE, "{}", "ref-refused")
    refused.enqueue(SyncEngine.KIND_COMPLETE_SALE, "{}", "ref-next")
    val parked = refused.drain { write ->
        if (write.ref == "ref-refused") {
            SendOutcome(false, FailureKind.REFUSED, "forbidden: organization 9d")
        } else {
            SendOutcome(true)
        }
    }
    check(
        "a refusal parks the sale and lets the next one through",
        parked.failed == 1 && parked.sent == 1 && parked.stopped.not(),
        "sent=${parked.sent} failed=${parked.failed} remaining=${parked.remaining}",
    )
    check(
        "the parked sale carries the server's own words",
        refused.failures().singleOrNull()?.lastError == "forbidden: organization 9d",
        refused.failures().singleOrNull()?.lastError ?: "no failure",
    )
    check(
        "a parked sale is not pending: nothing will send it again by itself",
        refused.pending().isEmpty() && refused.size() == 1,
    )
    check("retrying puts it back in line", refused.retry("ref-refused") && refused.pending().size == 1)
    check(
        "and a retried sale goes",
        refused.drain { SendOutcome(true) }.sent == 1 && refused.find("ref-refused") == null,
    )
    // Discarding is the only thing that ever loses a sale, and it takes a
    // person deciding. It hands back what it removed so the screen can say what
    // went.
    val throwaway = Outbox(InMemoryOutboxStore())
    throwaway.enqueue(SyncEngine.KIND_COMPLETE_SALE, "{}", "ref-thrown")
    check(
        "discarding returns the write it threw away",
        throwaway.discard("ref-thrown")?.ref == "ref-thrown" &&
            throwaway.size() == 0 &&
            throwaway.discard("ref-thrown") == null,
    )
}

// ── The sync engine ───────────────────────────────────────────────────────

private fun sync() {
    section("the sync engine")

    val transport = FakeTransport()
    val outbox = Outbox(InMemoryOutboxStore())
    val connectivity = FakeConnectivity(online = false)
    val scheduler = FakeScheduler()
    val engine = engineOver(transport, outbox, connectivity, scheduler)

    transport.answer = { throw NetworkUnavailableException("no uplink") }
    engine.enqueueSale("{\"p_client_ref\":\"ref-1\"}", "ref-1")
    val offlineStatus = engine.start()

    check(
        "offline, the queue keeps the sale and says the books are not settled",
        offlineStatus.pending == 1 && !offlineStatus.settled && !offlineStatus.online,
        "pending=${offlineStatus.pending} settled=${offlineStatus.settled}",
    )
    check("and it does not schedule a timer for a connection that is down", scheduler.scheduled == 0)

    connectivity.online = true
    transport.answer = { HttpResponse(200, RECEIPT) }
    val drained = engine.drain()
    check(
        "online, the same queue sends it and settles",
        drained.sent == 1 && drained.remaining == 0 && engine.status.settled,
        "sent=${drained.sent} pending=${engine.status.pending}",
    )
    check(
        "the request carried the token and the exact stored body",
        transport.requests.last().token == "access-token" &&
            transport.requests.last().body == "{\"p_client_ref\":\"ref-1\"}",
    )
    check("a drain that emptied the queue schedules nothing", scheduler.scheduled == 0)

    // A duplicate reference is the outcome the outbox wanted: the sale is
    // already in the shop's books, so chasing it would be the bug.
    val duplicateTransport = FakeTransport()
    val duplicateOutbox = Outbox(InMemoryOutboxStore())
    val duplicateEngine = engineOver(duplicateTransport, duplicateOutbox)
    duplicateTransport.answer = {
        HttpResponse(
            409,
            "{\"code\":\"23505\",\"message\":\"duplicate key value violates unique constraint \\\"sales_client_ref_key\\\"\"}",
        )
    }
    duplicateEngine.enqueueSale("{\"p_client_ref\":\"ref-dup\"}", "ref-dup")
    val duplicate = duplicateEngine.drain()
    check(
        "a duplicate reference counts as sent, not as something to keep chasing",
        duplicate.sent == 1 && duplicateOutbox.size() == 0 && duplicateEngine.status.settled,
        "sent=${duplicate.sent} remaining=${duplicate.remaining}",
    )

    // Two drains at once would be two sends of the same sale. The engine is
    // single-flight, so a send that re-enters (a status listener asking to
    // drain, in the real app) gets the drain already running.
    val reentrantTransport = FakeTransport()
    val reentrantOutbox = Outbox(InMemoryOutboxStore())
    lateinit var reentrantEngine: SyncEngine
    var inner: DrainResult? = null
    reentrantTransport.answer = {
        inner = reentrantEngine.drain()
        HttpResponse(200, RECEIPT)
    }
    reentrantEngine = engineOver(reentrantTransport, reentrantOutbox)
    reentrantEngine.enqueueSale("{\"p_client_ref\":\"ref-2\"}", "ref-2")
    val outer = reentrantEngine.drain()
    check(
        "a drain re-entered from inside a send does not send twice",
        outer.sent == 1 && inner?.sent == 0 && reentrantTransport.requests.size == 1,
        "outer=${outer.sent} inner=${inner?.sent ?: "n/a"} requests=${reentrantTransport.requests.size}",
    )

    // One timer, re-armed: never two live timers racing a slow upload.
    val timerTransport = FakeTransport()
    val timerOutbox = Outbox(InMemoryOutboxStore())
    val timerScheduler = FakeScheduler()
    val timerEngine = engineOver(timerTransport, timerOutbox, scheduler = timerScheduler)
    timerTransport.answer = { throw NetworkUnavailableException("no uplink") }
    timerEngine.enqueueSale("{}", "ref-3")
    timerEngine.start()
    // What matters is not how often the timer is armed but how many are *live*:
    // `schedule` cancels the previous one before arming the next, so a slow
    // upload can never be raced by a second drain.
    check(
        "a queue with something in it keeps exactly one timer armed",
        timerScheduler.scheduled - timerScheduler.cancelled == 1,
        "scheduled=${timerScheduler.scheduled} cancelled=${timerScheduler.cancelled}",
    )
    timerEngine.drain()
    check(
        "and re-arming cancels the timer it replaces, so they never stack",
        timerScheduler.scheduled - timerScheduler.cancelled == 1 && timerScheduler.cancelled >= 1,
        "scheduled=${timerScheduler.scheduled} cancelled=${timerScheduler.cancelled}",
    )
    check(
        "firing the timer drains, and arms the next one",
        timerScheduler.lastTask?.let { task ->
            val before = timerScheduler.scheduled
            task()
            timerScheduler.scheduled > before
        } ?: false,
        "scheduled=${timerScheduler.scheduled}",
    )
}

// ── The session ───────────────────────────────────────────────────────────

private fun session() {
    section("the session")

    val now = 1_790_000_000_000
    val soon = Session("access", "refresh", now + 30_000, "user-1")
    val later = Session("access", "refresh", now + 300_000, "user-1")
    check(
        "a token that expires inside the skew is already expired",
        soon.isExpired(now) && !later.isExpired(now),
        "soon=${soon.isExpired(now)} later=${later.isExpired(now)}",
    )
}

// ── The receipt ───────────────────────────────────────────────────────────

private fun receipts() {
    section("the receipt")

    val json = Json { ignoreUnknownKeys = true }
    val receipt = json.decodeFromString(CompletedSale.serializer(), RECEIPT)
    check(
        "a receipt decodes with every money field as text",
        receipt.total == "40.00" && receipt.invoiceNo == "INV-2026-000001" &&
            receipt.changeDue == "0.00",
        "total=${receipt.total}",
    )

    // The bug the live run found (migration 045): the receipt used to carry
    // numbers, and a strict client could not decode the sale it had just taken.
    // A number must be *refused*, not coerced — a receipt whose totals are
    // silently wrong is worse than one that fails loudly.
    val numeric = RECEIPT.replace("\"total\":\"40.00\"", "\"total\":40.00")
    val refused = runCatching {
        Json { ignoreUnknownKeys = true }.decodeFromString(CompletedSale.serializer(), numeric)
    }
    check(
        "a receipt that sends money as a number is refused, not misread",
        refused.isFailure,
        refused.exceptionOrNull()?.let { it::class.simpleName ?: "failure" } ?: "decoded anyway",
    )

    check(
        "a refusal keeps the server's words for the shopkeeper",
        describe(ApiException(42501, "forbidden: organization 9d", "42501")) ==
            "forbidden: organization 9d",
    )
    check(
        "an error code means the database answered, so it is a refusal",
        ApiException(42501, "forbidden: organization 9d", "42501").kind == FailureKind.REFUSED,
    )
    check(
        "an edge error that never reached the database is a connection failure, and is retried",
        ApiException(502, "<html>bad gateway</html>", null).kind == FailureKind.OFFLINE,
    )
    check(
        "a socket that failed is a connection failure",
        classify(NetworkUnavailableException("boom")) == FailureKind.OFFLINE,
    )
}
