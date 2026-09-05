package com.ningshingche.app.notifications

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.seenContentStore: DataStore<Preferences> by preferencesDataStore(
    name = "ningshingche_seen_content"
)

class SeenContentStore(private val context: Context) {

    private object Keys {
        val SEEN = stringSetPreferencesKey("seen_keys")
        val BASELINE = booleanPreferencesKey("has_baseline")
        val VERSION_CODE = intPreferencesKey("notified_version_code")
        val SETTINGS_HASH = stringPreferencesKey("notified_settings_hash")
    }

    suspend fun seenKeys(): Set<String> =
        context.seenContentStore.data.map { it[Keys.SEEN].orEmpty() }.first()

    suspend fun hasBaseline(): Boolean =
        context.seenContentStore.data.map { it[Keys.BASELINE] ?: false }.first()

    suspend fun lastVersionCode(): Int =
        context.seenContentStore.data.map { it[Keys.VERSION_CODE] ?: 0 }.first()

    suspend fun lastSettingsHash(): String =
        context.seenContentStore.data.map { it[Keys.SETTINGS_HASH].orEmpty() }.first()

    suspend fun markSeen(
        keys: Collection<String>,
        baseline: Boolean? = null,
        versionCode: Int? = null,
        settingsHash: String? = null
    ) {
        if (keys.isEmpty() && baseline == null && versionCode == null && settingsHash == null) return
        context.seenContentStore.edit { prefs ->
            if (keys.isNotEmpty()) {
                val merged = prefs[Keys.SEEN].orEmpty().toMutableSet()
                merged.addAll(keys)
                // Cap growth so a long-lived install cannot unbounded-grow prefs.
                prefs[Keys.SEEN] = if (merged.size > 4000) merged.toList().takeLast(3000).toSet() else merged
            }
            if (baseline == true) prefs[Keys.BASELINE] = true
            if (versionCode != null) prefs[Keys.VERSION_CODE] = versionCode
            if (settingsHash != null) prefs[Keys.SETTINGS_HASH] = settingsHash
        }
    }
}
