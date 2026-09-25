package dev.mekholi.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * What went wrong, in the only two kinds the till cares about.
 *
 * `offline` means the question never reached the server — the write is kept and
 * retried, because retrying cannot make anything worse. `refused` means the
 * server answered, and repeating the question changes nothing: a sold-out line
 * stays sold out, a permission stays missing. Getting this backwards is the
 * expensive mistake — a refusal retried forever fills a queue nobody drains,
 * and a network failure marked as a refusal throws a real sale away.
 */
enum class FailureKind { OFFLINE, REFUSED }

class ApiException(
    val status: Int,
    val detail: String,
    val code: String? = null,
) : RuntimeException("HTTP $status: $detail") {
    /**
     * Any answer is an answer — with one exception worth keeping apart. An edge
     * 5xx with no SQLSTATE in the body (a proxy's error page) never reached the
     * database, so it is a connection problem, not a refusal: it is retried
     * automatically instead of being parked until a person notices. PostgREST
     * and plpgsql both put a SQLSTATE in the body's `code`, so a real database
     * error is never mistaken for one.
     */
    val kind: FailureKind
        get() = if (code == null && status >= 500) FailureKind.OFFLINE else FailureKind.REFUSED
}

/** A refusal, in words a shopkeeper can read. */
class MekholiRefusal(message: String) : RuntimeException(message)

fun classify(error: Throwable): FailureKind = when (error) {
    is NetworkUnavailableException -> FailureKind.OFFLINE
    is ApiException -> error.kind
    // A malformed response is not something to keep retrying either, but it is
    // also not the network's fault: treat it as a refusal so a person sees it.
    else -> FailureKind.REFUSED
}

fun describe(error: Throwable): String = when (error) {
    is ApiException ->
        if (error.kind == FailureKind.OFFLINE) "The server did not answer. This will be tried again."
        else error.detail
    is NetworkUnavailableException -> "Could not reach the shop's server."
    else -> error.message ?: "The sale could not be sent."
}

/**
 * The RPC surface, typed.
 *
 * Reads go through PostgREST's query syntax; writes go through functions, one
 * per named operation, exactly as the web client does. No pricing, no stock
 * arithmetic and no invoice numbering happens in this file — all three live in
 * Postgres, which is what makes two clients behave identically (spec §43).
 */
class MekholiApi(
    private val config: MekholiConfig,
    private val transport: Transport,
    private val json: Json = Json { ignoreUnknownKeys = true; explicitNulls = false },
) {

    // ── Auth ──────────────────────────────────────────────────────────────

    fun signIn(email: String, password: String): Session {
        val response = transport.send(
            HttpRequest(
                method = "POST",
                path = "/auth/v1/token?grant_type=password",
                body = json.encodeToString(SignInRequest.serializer(), SignInRequest(email, password)),
            )
        )
        require(response)
        return json.decodeFromString(SignInResponse.serializer(), response.body).toSession()
    }

    /**
     * A till is signed in for a whole shift, and an access token lasts an hour.
     * A drain that ran with an expired token would come back as a *refusal*,
     * which is the wrong verdict for the wrong reason — so the session is
     * refreshed before the queue is drained, not after it fails.
     */
    fun refreshSession(refreshToken: String): Session {
        val body = json.encodeToString(
            RefreshRequest.serializer(),
            RefreshRequest(refreshToken),
        )
        val response = transport.send(
            HttpRequest(
                method = "POST",
                path = "/auth/v1/token?grant_type=refresh_token",
                body = body,
            )
        )
        require(response)
        return json.decodeFromString(SignInResponse.serializer(), response.body).toSession()
    }

    /** Who this token is, and what it may do. Called once per app start. */
    fun sessionPayload(token: String): SessionPayload {
        val body = json.encodeToString(JsonObject.serializer(), buildJsonObject {})
        val response = transport.send(post("/rest/v1/rpc/session_payload", token, body))
        require(response)
        return json.decodeFromString(SessionPayload.serializer(), response.body)
    }

    // ── The floor ─────────────────────────────────────────────────────────

    /**
     * Branch, stock room and register — resolved the way the web client does,
     * from the same tables, in the same order of preference: the retail-floor
     * warehouse first, because that is the one `complete_sale` decrements when
     * the client does not name one.
     */
    fun salesFloor(token: String, branchId: String): SalesFloor {
        val branches = get<BranchRow>(token, "/rest/v1/branches", "select=id,name&id=eq.$branchId")
        val branch = branches.firstOrNull() ?: throw MekholiRefusal("Branch not found")

        val warehouses = get<WarehouseRow>(
            token,
            "/rest/v1/warehouses",
            "select=id,name,is_retail_floor&branch_id=eq.$branchId"
                + "&deleted_at=is.null&order=is_retail_floor.desc",
        )
        val warehouse = warehouses.firstOrNull()
            ?: throw MekholiRefusal("This branch has no stock location")

        val registers = get<RegisterRow>(
            token,
            "/rest/v1/registers",
            "select=id,name&branch_id=eq.$branchId&is_active=is.true&order=name",
        )

        // A session is open while `closed_at` is null — there is no status column.
        val sessions = get<RegisterSessionRow>(
            token,
            "/rest/v1/register_sessions",
            "select=id,register_id,opened_at,closed_at&branch_id=eq.$branchId"
                + "&closed_at=is.null&order=opened_at.desc&limit=1",
        )

        return SalesFloor(
            branchId = branch.id,
            branchName = branch.name,
            warehouseId = warehouse.id,
            warehouseName = warehouse.name,
            registerId = registers.firstOrNull()?.id,
            registerName = registers.firstOrNull()?.name,
            sessionId = sessions.firstOrNull()?.id,
        )
    }

    /**
     * The shop's branches, primary first — the same order the web client uses
     * when it decides which counter this till is working at.
     */
    fun listBranches(token: String): List<BranchListRow> = get(
        token,
        "/rest/v1/branches",
        "select=id,name,code,is_primary&deleted_at=is.null&order=is_primary.desc,name",
    )

    /** How the customer paid. A till without one cannot close a sale. */
    fun paymentMethods(token: String): List<PaymentMethodRow> = get(
        token,
        "/rest/v1/payment_methods",
        "select=id,name,key,is_active&is_active=is.true&order=sort_order,name",
    )

    // ── Catalogue ─────────────────────────────────────────────────────────

    /**
     * The POS hot path: search, priced, with stock for one warehouse.
     *
     * Unstocked variants have a null `warehouse_id` and must still appear — a
     * brand-new product with no stock yet is exactly what a shop adds first.
     */
    fun catalog(
        token: String,
        warehouseId: String,
        search: String? = null,
        limit: Int = 50,
    ): List<CatalogRow> {
        val filters = StringBuilder()
            .append("select=").append(CATALOG_SELECT)
            .append("&or=(warehouse_id.eq.").append(warehouseId).append(",warehouse_id.is.null)")
        if (!search.isNullOrBlank()) {
            val term = search.trim().replace("*", "")
            filters.append("&or=(name.ilike.*").append(term).append("*,search_text.ilike.*").append(term).append("*)")
        }
        filters.append("&order=name.asc&limit=").append(limit)
        return get(token, "/rest/v1/pos_catalog", filters.toString())
    }

    // ── Writes ────────────────────────────────────────────────────────────

    fun openRegister(token: String, registerId: String, openingCash: Double): String {
        val body = json.encodeToString(
            OpenRegisterRequest.serializer(),
            OpenRegisterRequest(registerId, openingCash),
        )
        val response = transport.send(post("/rest/v1/rpc/open_register", token, body))
        require(response)
        return response.body.trim().trim('"')
    }

    /**
     * The only way a sale is written — for this client as much as for the web
     * one. `body` is passed as the exact string that will be sent, because the
     * outbox stores that string and replays it byte for byte.
     */
    fun completeSale(token: String, body: String): CompletedSale {
        val response = transport.send(post("/rest/v1/rpc/complete_sale", token, body))
        require(response)
        return json.decodeFromString(CompletedSale.serializer(), response.body)
    }

    fun encodeSale(request: CompleteSaleRequest): String =
        json.encodeToString(CompleteSaleRequest.serializer(), request)

    // ── Plumbing ──────────────────────────────────────────────────────────

    private fun post(path: String, token: String, body: String) =
        HttpRequest(method = "POST", path = path, body = body, token = token)

    private inline fun <reified T> get(token: String, path: String, query: String): List<T> {
        val response = transport.send(
            HttpRequest(method = "GET", path = "$path?$query", token = token)
        )
        require(response)
        return json.decodeFromString(
            kotlinx.serialization.builtins.ListSerializer(
                kotlinx.serialization.serializer<T>()
            ),
            response.body,
        )
    }

    /**
     * A status is not a verdict. PostgREST answers with the database's own
     * error object, and that message is the one worth showing: "insufficient
     * stock: Soap has 2" tells a cashier what to do, "HTTP 400" does not.
     */
    private fun require(response: HttpResponse) {
        if (response.isSuccess) return
        val parsed = runCatching { json.parseToJsonElement(response.body) as? JsonObject }.getOrNull()
        val detail = (parsed?.get("message") as? JsonPrimitive)?.content
            ?: response.body.take(200).ifBlank { "the server refused the request" }
        val code = (parsed?.get("code") as? JsonPrimitive)?.content
        throw ApiException(response.status, detail, code)
    }

    private companion object {
        const val CATALOG_SELECT =
            "organization_id,product_id,name,sku,description,image_url,track_stock,allow_negative," +
                "tax_inclusive,category_id,category_name,reorder_point,metadata,variant_id,variant_name," +
                "effective_sku,price,cost,is_default,unit_label,decimal_quantity,tax_rate,warehouse_id,available"
    }
}

/**
 * A signed-in till.
 *
 * Held in memory and (on Android) in the app's own storage; never in a place a
 * backup or a log can reach. The refresh token is what lets a shift outlive an
 * access token; the access token is what every RPC carries.
 */
data class Session(
    val accessToken: String,
    val refreshToken: String?,
    val expiresAtMillis: Long,
    val userId: String?,
) {
    fun isExpired(now: Long = System.currentTimeMillis(), skewMs: Long = 60_000): Boolean =
        now + skewMs >= expiresAtMillis
}

private fun SignInResponse.toSession(): Session = Session(
    accessToken = accessToken,
    refreshToken = refreshToken,
    expiresAtMillis = System.currentTimeMillis() + (expiresIn ?: 3600L) * 1000L,
    userId = user?.id,
)

/** The anon key is the only key this app has, and it is the right one (spec §44). */
fun anonConfig(baseUrl: String, anonKey: String) = MekholiConfig(baseUrl, anonKey)
