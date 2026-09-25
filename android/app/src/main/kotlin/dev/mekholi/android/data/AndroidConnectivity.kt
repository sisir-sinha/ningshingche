package dev.mekholi.android.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import dev.mekholi.core.Connectivity

/**
 * The platform's opinion about the connection, handed to the sync engine.
 *
 * Treated as a *hint* throughout: it decides when the till tries, never whether
 * a sale is safe. A captive portal and a dead uplink both report "online", and
 * the only trustworthy report is what the last request did.
 */
class AndroidConnectivity(context: Context) : Connectivity {

    private val manager = context.getSystemService(ConnectivityManager::class.java)

    override fun isOnline(): Boolean {
        val network = manager.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    /** Fires when connectivity appears or disappears — the trigger to drain. */
    override fun onChange(listener: (Boolean) -> Unit): () -> Unit {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = listener(true)
            override fun onLost(network: Network) = listener(false)
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                listener(capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))
            }
        }
        manager.registerDefaultNetworkCallback(callback)
        return { manager.unregisterNetworkCallback(callback) }
    }
}
