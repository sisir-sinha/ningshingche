package com.example.data.preferences

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map

/** Only reusable identity fields belong here. Comment text must never be persisted. */
data class CommenterDetails(
    val name: String = "",
    val email: String = "",
    val phone: String = ""
)

interface CommenterDetailsStore {
    val details: Flow<CommenterDetails>
    suspend fun save(details: CommenterDetails)
}

/**
 * App-private DataStore. The Application creates it in noBackupFilesDir so these
 * personal details are not included in Android cloud backups/device transfers.
 */
class CommenterPreferencesRepository(
    private val dataStore: DataStore<Preferences>
) : CommenterDetailsStore {
    private object Keys {
        val NAME = stringPreferencesKey("commenter_name")
        val EMAIL = stringPreferencesKey("commenter_email")
        val PHONE = stringPreferencesKey("commenter_phone")
    }

    override val details: Flow<CommenterDetails> = dataStore.data
        .catch { error ->
            if (error is IOException) emit(emptyPreferences()) else throw error
        }
        .map { values ->
            CommenterDetails(
                name = values[Keys.NAME].orEmpty(),
                email = values[Keys.EMAIL].orEmpty(),
                phone = values[Keys.PHONE].orEmpty()
            )
        }

    override suspend fun save(details: CommenterDetails) {
        dataStore.edit { values ->
            values[Keys.NAME] = details.name.trim()
            // Empty optional inputs deliberately replace previously saved values.
            values[Keys.EMAIL] = details.email.trim()
            values[Keys.PHONE] = details.phone.trim()
        }
    }
}
