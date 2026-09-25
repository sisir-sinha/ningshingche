package dev.mekholi.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The wire shapes, as PostgREST and GoTrue actually speak them.
 *
 * Every name here is checked against the generated contract
 * (`contracts/api-contract.json`) by `npm run check:android`: a parameter that
 * does not exist on the function, or a column the view does not expose, fails
 * the check rather than the sale. The Kotlin side of "Android needs no rewrite"
 * is this file plus `Outbox.kt` — nothing above them knows what a device is.
 *
 * Money crosses as major units (the shop's currency), quantities as whole
 * units, exactly as the web client sends them; Postgres converts to minor units
 * and milli-units internally. A client that pre-converted would be a second
 * implementation of pricing, and pricing belongs to the server (spec §43).
 */

// ── GoTrue ────────────────────────────────────────────────────────────────

@Serializable
data class SignInRequest(val email: String, val password: String)

@Serializable
data class RefreshRequest(@SerialName("refresh_token") val refreshToken: String)

@Serializable
data class AuthUser(val id: String? = null, val email: String? = null)

@Serializable
data class SignInResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String? = null,
    @SerialName("expires_in") val expiresIn: Long? = null,
    val user: AuthUser? = null,
)

// ── session_payload ───────────────────────────────────────────────────────
//
// Mirrors `public.session_payload()` and, in the web client,
// `src/app/state/session.ts`. Change one, change all three.

@Serializable
data class OrganizationMembership(
    @SerialName("organization_id") val organizationId: String,
    val name: String,
    val slug: String,
    val currency: String,
    val timezone: String,
    /**
     * The shop's business type, as a key into the taxonomy the web client
     * ships (`data/shop_categories.json`). It is what decides which fields a
     * shop meets first — but that decision belongs to the client's UI, so this
     * is carried and not interpreted here.
     */
    @SerialName("shop_type") val shopType: String? = null,
    @SerialName("role_names") val roleNames: List<String> = emptyList(),
    @SerialName("role_keys") val roleKeys: List<String> = emptyList(),
    @SerialName("is_owner") val isOwner: Boolean = false,
    /** Wildcards already expanded server-side: an owner holds `sales.create`. */
    val permissions: List<String> = emptyList(),
)

@Serializable
data class SessionPayload(
    @SerialName("user_id") val userId: String? = null,
    val organizations: List<OrganizationMembership> = emptyList(),
) {
    /** The shop the till is working in, and the only one it ever reads. */
    fun primary(): OrganizationMembership? = organizations.firstOrNull()

    fun can(permission: String): Boolean {
        val organization = primary() ?: return false
        val domain = permission.substringBefore('.')
        return organization.permissions.any { it == permission || it == "$domain.*" || it == "*" }
    }
}

// ── The sales floor ───────────────────────────────────────────────────────

@Serializable
data class BranchRow(val id: String, val name: String)

@Serializable
data class WarehouseRow(
    val id: String,
    val name: String,
    @SerialName("is_retail_floor") val isRetailFloor: Boolean = false,
)

@Serializable
data class BranchListRow(
    val id: String,
    val name: String,
    val code: String? = null,
    @SerialName("is_primary") val isPrimary: Boolean = false,
)

@Serializable
data class PaymentMethodRow(
    val id: String,
    val name: String,
    val key: String? = null,
    @SerialName("is_active") val isActive: Boolean = true,
)

@Serializable
data class RegisterRow(val id: String, val name: String)

@Serializable
data class RegisterSessionRow(
    val id: String,
    @SerialName("register_id") val registerId: String,
    @SerialName("opened_at") val openedAt: String? = null,
    @SerialName("closed_at") val closedAt: String? = null,
)

/** Branch, stock room and register, resolved once — the same trio as `SalesFloor`. */
data class SalesFloor(
    val branchId: String,
    val branchName: String,
    val warehouseId: String,
    val warehouseName: String,
    val registerId: String?,
    val registerName: String?,
    val sessionId: String?,
)

// ── The catalogue the POS renders ─────────────────────────────────────────

@Serializable
data class CatalogRow(
    @SerialName("organization_id") val organizationId: String? = null,
    @SerialName("product_id") val productId: String,
    val name: String,
    val sku: String? = null,
    val description: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("track_stock") val trackStock: Boolean = false,
    @SerialName("allow_negative") val allowNegative: Boolean = false,
    @SerialName("tax_inclusive") val taxInclusive: Boolean = false,
    @SerialName("category_id") val categoryId: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("reorder_point") val reorderPoint: Double? = null,
    val metadata: Map<String, kotlinx.serialization.json.JsonElement> = emptyMap(),
    @SerialName("variant_id") val variantId: String,
    @SerialName("variant_name") val variantName: String? = null,
    @SerialName("effective_sku") val effectiveSku: String? = null,
    val price: Double = 0.0,
    val cost: Double = 0.0,
    @SerialName("is_default") val isDefault: Boolean = false,
    @SerialName("unit_label") val unitLabel: String? = null,
    @SerialName("decimal_quantity") val decimalQuantity: Boolean = false,
    @SerialName("tax_rate") val taxRate: Double = 0.0,
    @SerialName("warehouse_id") val warehouseId: String? = null,
    val available: Double? = null,
)

// ── complete_sale ─────────────────────────────────────────────────────────

@Serializable
data class SaleItemPayload(
    @SerialName("variant_id") val variantId: String,
    /** Whole units, or a fraction of one for weight-priced goods. */
    val qty: Double,
    @SerialName("discount_type") val discountType: String? = null,
    @SerialName("discount_value") val discountValue: Double? = null,
)

@Serializable
data class SalePaymentPayload(
    @SerialName("method_id") val methodId: String,
    val amount: Double,
    val reference: String? = null,
)

/**
 * The arguments of `public.complete_sale`, named exactly as Postgres names
 * them — which is also exactly how PostgREST matches a JSON body to a call.
 *
 * `clientRef` is the spine of the offline story: it is minted before the first
 * attempt and never regenerated, so a resend after a dropped connection
 * returns the sale already stored instead of writing a second one
 * (migration 044). Null means "this sale was never queued", which is every
 * sale taken with a working connection.
 */
@Serializable
data class CompleteSaleRequest(
    @SerialName("p_branch_id") val branchId: String,
    @SerialName("p_items") val items: List<SaleItemPayload>,
    @SerialName("p_payments") val payments: List<SalePaymentPayload>,
    @SerialName("p_register_id") val registerId: String? = null,
    @SerialName("p_customer_id") val customerId: String? = null,
    @SerialName("p_warehouse_id") val warehouseId: String? = null,
    @SerialName("p_discount_type") val discountType: String? = null,
    @SerialName("p_discount_value") val discountValue: Double? = null,
    @SerialName("p_note") val note: String? = null,
    @SerialName("p_held_sale_id") val heldSaleId: String? = null,
    @SerialName("p_client_ref") val clientRef: String? = null,
)

/** The receipt the server built from the row it stored. */
@Serializable
data class CompletedSale(
    @SerialName("sale_id") val saleId: String,
    @SerialName("invoice_no") val invoiceNo: String,
    val status: String,
    val subtotal: String = "0.00",
    val discount: String = "0.00",
    val tax: String = "0.00",
    val total: String = "0.00",
    val paid: String = "0.00",
    @SerialName("change_due") val changeDue: String = "0.00",
)

@Serializable
data class OpenRegisterRequest(
    @SerialName("p_register_id") val registerId: String,
    @SerialName("p_opening_cash") val openingCash: Double,
    @SerialName("p_note") val note: String? = null,
)
