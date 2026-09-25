package dev.mekholi.android.data

import android.content.Context
import dev.mekholi.core.Session

/**
 * Where the signed-in till is remembered.
 *
 * `MODE_PRIVATE` and nothing else: the file is the app's own, and the refresh
 * token in it is the only credential on the device. A production build should
 * move this to `EncryptedSharedPreferences` (or the keystore) — it is written
 * this way because a reference app that reaches for a library to store two
 * strings hides the part a reader needs to see.
 *
 * No password is ever stored. The refresh token is the whole of it.
 */
class SessionStore(context: Context) {

    private val prefs = context.getSharedPreferences("mekholi-session", Context.MODE_PRIVATE)

    fun load(): Session? {
        val token = prefs.getString("access_token", null) ?: return null
        return Session(
            accessToken = token,
            refreshToken = prefs.getString("refresh_token", null),
            expiresAtMillis = prefs.getLong("expires_at", 0L),
            userId = prefs.getString("user_id", null),
        )
    }

    fun save(session: Session) {
        prefs.edit()
            .putString("access_token", session.accessToken)
            .putString("refresh_token", session.refreshToken)
            .putLong("expires_at", session.expiresAtMillis)
            .putString("user_id", session.userId)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }
}
