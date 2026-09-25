package dev.mekholi.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.mekholi.android.CartLine
import dev.mekholi.android.PosViewModel

/**
 * A till, and nothing more.
 *
 * Search (or scan — a barcode reader types into the search field on every
 * Android device that has one), tap to add, take payment, see what is waiting
 * to sync. It is small on purpose: the same screen in the web client is bigger
 * because it has the keyboard shortcuts, the plugin slots and the receipt
 * designer. What this proves is the part that is *shared* — the reads, the
 * write, and the queue that survives the connection.
 */
@Composable
fun PosScreen(viewModel: PosViewModel, onSignOut: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize().padding(12.dp)) {

        // ── Header: the shop, and the state of the queue ──────────────────
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text(viewModel.shopName.ifBlank { "Mekholi" }, style = MaterialTheme.typography.titleMedium)
                Text(
                    viewModel.floor?.let { "${it.branchName} · ${it.warehouseName}" } ?: "Resolving the floor…",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            TextButton(onClick = onSignOut) { Text("Sign out") }
        }

        SyncBar(viewModel)

        viewModel.message?.let { message ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(message, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { viewModel.dismissMessage() }) { Text("Dismiss") }
            }
        }

        OutlinedTextField(
            value = viewModel.search,
            onValueChange = { viewModel.onSearchChange(it) },
            label = { Text("Search or scan") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        )

        // ── Catalogue ─────────────────────────────────────────────────────
        LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            items(viewModel.catalog, key = { it.variantId }) { row ->
                Card(
                    modifier = Modifier.fillMaxWidth().clickable { viewModel.add(row) }
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(row.name + (row.variantName?.let { " · $it" } ?: ""))
                            Text(
                                row.effectiveSku ?: row.sku ?: "",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            // Display only. The price on the slip is the one
                            // the server returns with the sale.
                            Text("${row.price}", fontWeight = FontWeight.Medium)
                            Text(
                                row.available?.let { "stock $it" } ?: "—",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
            }
        }

        HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

        // ── The cart ──────────────────────────────────────────────────────
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            for (line in viewModel.cart) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(lineDescription(line), modifier = Modifier.weight(1f))
                    Text("${line.subtotal}")
                    TextButton(onClick = { viewModel.remove(line) }) { Text("×") }
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Total ${viewModel.total} ${viewModel.currency}",
                style = MaterialTheme.typography.titleMedium,
            )
            Button(
                onClick = { viewModel.methods.firstOrNull()?.let { viewModel.pay(it.id) } },
                enabled = viewModel.cart.isNotEmpty() && !viewModel.busy &&
                    viewModel.methods.isNotEmpty(),
            ) {
                Text("Take payment")
            }
        }
    }
}

private fun lineDescription(line: CartLine): String =
    "${line.qty} × ${line.row.name}" + (line.row.variantName?.let { " ($it)" } ?: "")

/**
 * What the shop is holding.
 *
 * The same information the browser's chip shows, for the same reason: a cashier
 * who cannot tell whether the last three sales reached the server will take
 * them again by hand — which is the failure this whole phase exists to prevent.
 */
@Composable
private fun SyncBar(viewModel: PosViewModel) {
    val status = viewModel.status
    val text = when {
        status.failed > 0 -> "${status.failed} sale(s) refused — someone has to decide"
        status.syncing -> "Sending ${status.pending}…"
        status.pending > 0 -> "${status.pending} sale(s) waiting to sync"
        !status.online -> "Offline — sales are saved on this device"
        else -> "Online"
    }

    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = MaterialTheme.typography.bodySmall)
        if (status.pending > 0 || status.failed > 0) {
            OutlinedButton(onClick = { viewModel.retryQueue() }) { Text("Send now") }
        }
    }
}
