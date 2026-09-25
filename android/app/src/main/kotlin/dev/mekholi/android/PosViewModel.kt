package dev.mekholi.android

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.mekholi.android.data.AndroidConnectivity
import dev.mekholi.android.data.AndroidOutboxStore
import dev.mekholi.android.data.AndroidScheduler
import dev.mekholi.android.data.SessionStore
import dev.mekholi.core.ApiException
import dev.mekholi.core.CatalogRow
import dev.mekholi.core.CompleteSaleRequest
import dev.mekholi.core.FailureKind
import dev.mekholi.core.HttpTransport
import dev.mekholi.core.MekholiApi
import dev.mekholi.core.MekholiConfig
import dev.mekholi.core.Outbox
import dev.mekholi.core.PaymentMethodRow
import dev.mekholi.core.SaleItemPayload
import dev.mekholi.core.SalePaymentPayload
import dev.mekholi.core.SalesFloor
import dev.mekholi.core.Session
import dev.mekholi.core.SyncEngine
import dev.mekholi.core.SyncStatus
import dev.mekholi.core.classify
import dev.mekholi.core.describe
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

/** A line on the till's screen. Display only — the server prices the sale. */
data class CartLine(val row: CatalogRow, val qty: Double) {
    val subtotal: Double get() = row.price * qty
}

/**
 * The till's screen state.
 *
 * Every piece of business logic this class *could* have had lives in Postgres
 * instead: prices, taxes, discounts, stock and invoice numbers all arrive from
 * the RPC. What is left here is the part that is genuinely the device's job —
 * what is on screen, what is in the cart, and what is waiting to be sent.
 */
class PosViewModel(app: android.app.Application) : AndroidViewModel(app) {

    private val config = MekholiConfig(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY)
    private val sessionStore = SessionStore(app)
    private val outboxStore = AndroidOutboxStore(app)
    private val outbox = Outbox(outboxStore)

    val api = MekholiApi(config, HttpTransport(config))

    var session by mutableStateOf<Session?>(null)
        private set
    var floor by mutableStateOf<SalesFloor?>(null)
        private set
    var shopName by mutableStateOf("")
        private set
    var currency by mutableStateOf("BDT")
        private set
    var catalog by mutableStateOf<List<CatalogRow>>(emptyList())
        private set

    /** How the customer can pay. Loaded with the floor, not per sale. */
    var methods by mutableStateOf<List<PaymentMethodRow>>(emptyList())
        private set
    var search by mutableStateOf("")
        private set
    var busy by mutableStateOf(false)
        private set
    var message by mutableStateOf<String?>(null)
        private set
    var status by mutableStateOf(SyncStatus())
        private set

    val cart = mutableStateListOf<CartLine>()

    val total: Double get() = cart.sumOf { it.subtotal }

    /**
     * The engine owns the outbox's fate: it drains when connectivity returns,
     * retries on one timer, and reports what the shop is holding.
     */
    private val engine = SyncEngine(
        api = api,
        outbox = outbox,
        connectivity = AndroidConnectivity(app),
        token = { session?.accessToken },
        onStatus = { status = it },
        scheduler = AndroidScheduler(),
    )

    init {
        // A till that was closed with sales still queued must send them the
        // moment it is opened again, before anyone touches the screen.
        restore()
    }

    private fun restore() {
        val saved = sessionStore.load() ?: return
        session = saved
        engine.start()
    }

    /**
     * Sign in with a real password grant.
     *
     * The same call the browser makes, against the same GoTrue — which is the
     * point of a reference: if this only worked with a hand-made token, it
     * would prove nothing about a second client.
     */
    fun signIn(email: String, password: String) {
        viewModelScope.launch {
            busy = true
            try {
                val signedIn = withContext(Dispatchers.IO) { api.signIn(email, password) }
                onSignedIn(signedIn)
            } catch (error: Throwable) {
                message = describe(error)
            } finally {
                busy = false
            }
        }
    }

    fun onSignedIn(signedIn: Session) {
        sessionStore.save(signedIn)
        session = signedIn
        engine.start()
        loadFloorAndCatalog()
    }

    fun signOut() {
        engine.stop()
        sessionStore.clear()
        session = null
        floor = null
        catalog = emptyList()
        cart.clear()
    }

    fun loadFloorAndCatalog() {
        val current = session ?: return
        viewModelScope.launch {
            busy = true
            try {
                withContext(Dispatchers.IO) {
                    val payload = api.sessionPayload(current.accessToken)
                    val organization = payload.primary()
                        ?: throw IllegalStateException("This account belongs to no shop yet.")
                    // Primary first, exactly as the web client resolves it: a
                    // single-counter shop has one branch, and a shop with several
                    // would let the cashier choose.
                    val branch = api.listBranches(current.accessToken).firstOrNull()
                        ?: throw IllegalStateException("This shop has no branches yet.")
                    val resolvedFloor = api.salesFloor(current.accessToken, branch.id)
                    floor = resolvedFloor
                    shopName = organization.name
                    currency = organization.currency
                    methods = api.paymentMethods(current.accessToken)
                    catalog = api.catalog(current.accessToken, resolvedFloor.warehouseId)
                }
                message = null
            } catch (error: Throwable) {
                // Offline at start-up is a normal state, not a failure: the
                // catalogue and the queue are both on the device, and the till
                // can still take money.
                message = describe(error)
            } finally {
                busy = false
            }
        }
    }

    fun onSearchChange(value: String) {
        search = value
        val current = session ?: return
        val resolvedFloor = floor ?: return
        viewModelScope.launch {
            catalog = withContext(Dispatchers.IO) {
                runCatching { api.catalog(current.accessToken, resolvedFloor.warehouseId, value) }
                    // A search that cannot reach the server keeps the list it
                    // had: showing an empty shop because the uplink blinked is
                    // the worst possible answer at a counter.
                    .getOrElse { catalog }
            }
        }
    }

    fun add(row: CatalogRow) {
        val existing = cart.indexOfFirst { it.row.variantId == row.variantId }
        if (existing >= 0) {
            cart[existing] = cart[existing].copy(qty = cart[existing].qty + 1)
        } else {
            cart.add(CartLine(row, 1.0))
        }
    }

    fun remove(line: CartLine) {
        cart.remove(line)
    }

    fun dismissMessage() {
        message = null
    }

    /**
     * Take the money.
     *
     * The reference is minted *before* the attempt; the body is built once and
     * reused verbatim if the sale has to be queued. That is what makes a
     * resend after a dropped connection return the sale already stored instead
     * of a second one (migration 044) — and it is the same sequence the browser
     * client follows, which is the point of a reference implementation.
     */
    fun pay(methodId: String) {
        val current = session ?: return
        val resolvedFloor = floor ?: return
        if (cart.isEmpty()) return

        val clientRef = UUID.randomUUID().toString()
        val body = api.encodeSale(
            CompleteSaleRequest(
                branchId = resolvedFloor.branchId,
                items = cart.map { SaleItemPayload(it.row.variantId, it.qty) },
                payments = listOf(SalePaymentPayload(methodId, total)),
                registerId = resolvedFloor.registerId,
                warehouseId = resolvedFloor.warehouseId,
                clientRef = clientRef,
            )
        )

        viewModelScope.launch {
            busy = true
            try {
                val sale = withContext(Dispatchers.IO) { api.completeSale(current.accessToken, body) }
                cart.clear()
                message = "Sale ${sale.invoiceNo} · ${sale.total} $currency"
            } catch (error: ApiException) {
                // The server answered. Retrying changes nothing, so the sale
                // stays on screen where the cashier can fix it.
                message = "Refused: ${describe(error)}"
            } catch (error: Throwable) {
                if (classify(error) == FailureKind.OFFLINE) {
                    engine.enqueueSale(body, clientRef)
                    engine.refresh()
                    cart.clear()
                    message = "Saved on this device — it will sync when the connection returns."
                } else {
                    message = describe(error)
                }
            } finally {
                busy = false
            }
        }
    }

    fun retryQueue() {
        viewModelScope.launch { withContext(Dispatchers.IO) { engine.drain() } }
    }

    fun discard(ref: String) {
        engine.discard(ref)
    }

    override fun onCleared() {
        engine.stop()
        super.onCleared()
    }
}
