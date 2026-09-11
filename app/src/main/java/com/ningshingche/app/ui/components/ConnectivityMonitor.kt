package com.ningshingche.app.ui.components

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

enum class NetStatus { Online, Weak, Offline }

fun connectivityStatus(context: Context): Flow<NetStatus> = callbackFlow {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    fun current(): NetStatus {
        val network = manager.activeNetwork ?: return NetStatus.Offline
        val caps = manager.getNetworkCapabilities(network) ?: return NetStatus.Offline
        val hasInternet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        val validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        if (!hasInternet) return NetStatus.Offline
        val down = caps.linkDownstreamBandwidthKbps
        val cellular = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
        val uncongested = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_CONGESTED)
        return when {
            !validated && down in 1..250 -> NetStatus.Weak
            cellular && down in 1..150 -> NetStatus.Weak
            !uncongested && cellular && down in 1..400 -> NetStatus.Weak
            hasInternet -> NetStatus.Online
            else -> NetStatus.Offline
        }
    }

    trySend(current())
    val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            trySend(current())
        }
        override fun onLost(network: Network) {
            trySend(current())
        }
        override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
            trySend(current())
        }
    }
    val request = NetworkRequest.Builder()
        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .build()
    runCatching { manager.registerNetworkCallback(request, callback) }
        .onFailure { manager.registerDefaultNetworkCallback(callback) }
    awaitClose { runCatching { manager.unregisterNetworkCallback(callback) } }
}.distinctUntilChanged()
