package com.ningshingche.app.data.auth

/**
 * Email and password, as a second way in beside Google.
 *
 * Supabase already has the `email` provider switched on for this project, so
 * nothing here needs a server change: the app posts to `/auth/v1` and gets the
 * same session shape the Google grant returns. What the two flows share is the
 * session, not the credentials — a reader who signs up with an address can later
 * sign in with Google on the same address only if Supabase links the identities,
 * which it does by verified email.
 *
 * The rules below exist because Supabase answers every rejection with the same
 * envelope shape and a machine code, and because a Bengali reader should not be
 * shown `invalid_grant`. Validation lives here rather than in the screens so the
 * view model and any future caller enforce the same thing.
 */

sealed class EmailAuthException(message: String) : Exception(message) {
    class InvalidEmail : EmailAuthException("invalid_email")
    class WeakPassword : EmailAuthException("weak_password")
    class WrongCredentials : EmailAuthException("wrong_credentials")
    class AlreadyRegistered : EmailAuthException("already_registered")
    class NotConfirmed : EmailAuthException("not_confirmed")
    class InvalidCode : EmailAuthException("invalid_code")
    class RateLimited : EmailAuthException("rate_limited")
    class Network : EmailAuthException("network")
    class NoSession : EmailAuthException("no_session")
    class Failed(message: String) : EmailAuthException(message)
}

object EmailAuthRules {
    /**
     * Supabase's own floor is six, and a six-character password is a weak one.
     * Eight is enforced here for anything the app *creates* — a new account or a
     * new password. Signing in is deliberately not checked against this: a reader
     * whose password predates the rule must still be able to get in.
     */
    const val MIN_PASSWORD = 8

    /** Supabase's recovery email carries a six-digit token. */
    const val CODE_LENGTH = 6

    fun cleanEmail(raw: String): String = raw.trim().lowercase()

    /**
     * Deliberately loose: one `@`, something either side, a dot in the domain, no
     * whitespace. A stricter pattern rejects addresses that are legal, and the
     * server validates properly anyway — this only catches typing mistakes before
     * a round trip.
     */
    fun isEmail(raw: String): Boolean {
        val clean = cleanEmail(raw)
        if (clean.length < 5 || clean.length > 254) return false
        if (clean.count { it == '@' } != 1) return false
        if (clean.any { it.isWhitespace() }) return false
        val at = clean.indexOf('@')
        val local = clean.substring(0, at)
        val domain = clean.substring(at + 1)
        return local.isNotEmpty() &&
            domain.length >= 3 &&
            domain.contains('.') &&
            !domain.startsWith('.') &&
            !domain.endsWith('.')
    }

    fun emailProblem(raw: String): EmailAuthException? =
        if (isEmail(raw)) null else EmailAuthException.InvalidEmail()

    fun passwordProblem(raw: String): EmailAuthException? =
        if (raw.length < MIN_PASSWORD) EmailAuthException.WeakPassword() else null

    /** Digits only, at most six — a code pasted with spaces or dashes still works. */
    fun cleanCode(raw: String): String = raw.filter { it.isDigit() }.take(CODE_LENGTH)

    fun codeProblem(raw: String): EmailAuthException? =
        if (cleanCode(raw).length == CODE_LENGTH) null else EmailAuthException.InvalidCode()
}

object EmailAuthMessages {

    fun userMessage(error: Throwable): String = when (error) {
        is EmailAuthException.InvalidEmail -> "সঠিক ইমেইল ঠিকানা লিখুন।"
        is EmailAuthException.WeakPassword ->
            "পাসওয়ার্ড অন্তত ${EmailAuthRules.MIN_PASSWORD} অক্ষরের হতে হবে।"
        is EmailAuthException.WrongCredentials ->
            "ইমেইল বা পাসওয়ার্ড মিলছে না। আবার চেষ্টা করুন।"
        is EmailAuthException.AlreadyRegistered ->
            "এই ইমেইলে আগেই অ্যাকাউন্ট আছে। সাইন ইন করুন।"
        is EmailAuthException.NotConfirmed ->
            "ইমেইলটি এখনো নিশ্চিত হয়নি। মেইলের লিংকটি খুলে আবার চেষ্টা করুন।"
        is EmailAuthException.InvalidCode ->
            "কোডটি মিলছে না। মেইলে আসা ৬ সংখ্যার কোডটি দিন।"
        is EmailAuthException.RateLimited ->
            "অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।"
        is EmailAuthException.Network ->
            "ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না। আবার চেষ্টা করুন।"
        is EmailAuthException.NoSession ->
            "সেশন শেষ হয়ে গেছে। আবার সাইন ইন করুন।"
        else -> "কিছু একটা ভুল হয়েছে। আবার চেষ্টা করুন।"
    }
}
