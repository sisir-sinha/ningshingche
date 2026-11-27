package com.ningshingche.app.data.portal

import java.io.IOException

/** Internal to the app's Retrofit/OkHttp pipeline; never sent to the server. */
internal const val COMMENT_USER_HEADER = "X-Nsc-Comment-User"

/** An IOException is safe to throw from an OkHttp interceptor. */
internal class CommentSessionRequired : IOException("Authenticated comment session required")

/** Supabase still verifies the JWT signature; this prevents accidental guest/other-account POSTs. */
internal fun canSendComment(expectedUser: String?, subject: String?, role: String?, anonymous: Boolean): Boolean =
    !expectedUser.isNullOrBlank() && subject == expectedUser && role == "authenticated" && !anonymous
