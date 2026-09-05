package com.ningshingche.app.data.auth

/**
 * Google OAuth client IDs used by native ID-token sign-in.
 *
 * The **Web** client ID is the audience for the ID token that Supabase Auth
 * validates. It is not a secret. The Android client ID is registered in Google
 * Cloud against `com.ningshingche.app` and the debug SHA-1; it is not sent in
 * the Credential Manager request.
 *
 * Never put the Google Web Client Secret or a Supabase service_role key here.
 */
object GoogleAuthConfig {
    const val WEB_CLIENT_ID =
        "141826905564-ccalo1vt0s66ab2gh4rl11o3g8koefvi.apps.googleusercontent.com"

    const val ANDROID_CLIENT_ID =
        "141826905564-bm1iaekr3j2p5a081g2c7du8ivknr2jf.apps.googleusercontent.com"

    const val PROVIDER_GOOGLE = "google"
    const val PROVIDER_PASSWORD = "password"
    const val PROVIDER_LOCAL = "local"
}
