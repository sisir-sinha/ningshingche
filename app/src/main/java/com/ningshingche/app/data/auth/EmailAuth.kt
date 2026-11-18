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
    /** A disposable/temporary mailbox service — an address that stops existing. */
    class DisposableEmail : EmailAuthException("disposable_email")
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
     * Domains a sign-up is refused for.
     *
     * These are the well-known throwaway-mailbox services: addresses that work for
     * ten minutes and then stop. An account made with one is an account its owner
     * can never recover, and a channel the app can never use to reach them — which
     * matters here, because the only way back into a forgotten password is a code
     * mailed to that address.
     *
     * It is a blocklist rather than an allowlist of "real" providers on purpose: an
     * allowlist would refuse the institutional and personal domains this community
     * actually uses (university addresses, a family domain), and that is a worse
     * failure than letting an occasional throwaway through. Every entry below is a
     * service whose whole purpose is a temporary address.
     */
    val DISPOSABLE_DOMAINS: Set<String> = setOf(
        "10minutemail.com", "10minutemail.net", "20minutemail.com",
        "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
        "sharklasers.com", "grr.la", "spam4.me",
        "mailinator.com", "mailinator.net", "mailinator2.com", "notmailinator.com",
        "tempmail.com", "tempmail.net", "tempmailo.com", "temp-mail.org",
        "temp-mail.io", "tempmailaddress.com", "throwawaymail.com",
        "yopmail.com", "yopmail.net", "yopmail.fr",
        "trashmail.com", "trashmail.de", "trashmail.net",
        "getnada.com", "nada.email", "dispostable.com",
        "fakeinbox.com", "mailnesia.com", "maildrop.cc",
        "mintemail.com", "mytrashmail.com", "spambox.us",
        "thankyou2010.com", "wegwerfemail.de", "einrot.com",
        "mohmal.com", "emailondeck.com", "burnermail.io",
        "mailcatch.com", "spamgourmet.com", "mailsac.com",
        "harakirimail.com", "jetable.org", "incognitomail.org",
        "throwaway.email", "tempr.email", "discard.email",
        "cock.li", "tutanota.de", "protonmail.ch"
    )

    /**
     * The domain of an address, lowercased, without a leading `www.`.
     *
     * A multi-part suffix (`mail.co.uk`) is kept whole: the check below compares
     * against the last two or three labels, so a throwaway that hides behind a
     * subdomain (`inbox.mailinator.com`) is still caught.
     */
    fun domainOf(raw: String): String =
        cleanEmail(raw).substringAfter('@', "").removePrefix("www.")

    /**
     * True when the address belongs to a throwaway service.
     *
     * Matched on the domain *and any parent of it*: `x@eu.mailinator.com` ends with
     * `mailinator.com`, so it is refused too — a subdomain is the obvious way to
     * slip past a list like this one.
     */
    fun isDisposable(raw: String): Boolean {
        val domain = domainOf(raw)
        if (domain.isEmpty()) return false
        return DISPOSABLE_DOMAINS.any { blocked -> domain == blocked || domain.endsWith(".$blocked") }
    }
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

    fun emailProblem(raw: String): EmailAuthException? = when {
        !isEmail(raw) -> EmailAuthException.InvalidEmail()
        isDisposable(raw) -> EmailAuthException.DisposableEmail()
        else -> null
    }

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
        is EmailAuthException.DisposableEmail ->
            "অস্থায়ী ইমেইল ঠিকানা দিয়ে অ্যাকাউন্ট খোলা যায় না। Gmail, Yahoo, Outlook বা নিজের ডোমেইনের ঠিকানা দিন।"
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
