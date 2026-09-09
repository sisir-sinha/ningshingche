package com.ningshingche.app.auth

import com.ningshingche.app.data.auth.GoogleAuthConfig
import com.ningshingche.app.data.auth.GoogleAuthException
import com.ningshingche.app.data.auth.GoogleAuthMapper
import com.ningshingche.app.data.remote.UserRole
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.net.UnknownHostException

@RunWith(RobolectricTestRunner::class)
class GoogleAuthMapperTest {

    @Test
    fun profileUsesGoogleMetadataAndAuthorRole() {
        val user = JSONObject(
            """
            {
              "id": "11111111-1111-1111-1111-111111111111",
              "email": "reader@example.com",
              "user_metadata": {
                "full_name": "সুকান্ত সিংহ",
                "avatar_url": "https://example.com/a.png"
              }
            }
            """.trimIndent()
        )
        val profile = GoogleAuthMapper.profileFromAuthUser(user)
        assertEquals("11111111-1111-1111-1111-111111111111", profile.id)
        assertEquals("reader@example.com", profile.email)
        assertEquals("সুকান্ত সিংহ", profile.fullName)
        assertEquals("https://example.com/a.png", profile.avatarUrl)
        assertEquals(UserRole.AUTHOR, profile.role)
        assertEquals(GoogleAuthConfig.PROVIDER_GOOGLE, profile.authProvider)
        assertFalse(profile.canAccessDashboard)
    }

    @Test
    fun profileFallsBackToNameAndPicture() {
        val user = JSONObject(
            """
            {
              "id": "abc",
              "user_metadata": {
                "name": "Sisir",
                "picture": "https://example.com/p.jpg",
                "email": "sisir@example.com"
              }
            }
            """.trimIndent()
        )
        val profile = GoogleAuthMapper.profileFromAuthUser(user)
        assertEquals("Sisir", profile.fullName)
        assertEquals("sisir@example.com", profile.email)
        assertEquals("https://example.com/p.jpg", profile.avatarUrl)
    }

    @Test
    fun splitDisplayNameHandlesSingleAndTwoPartNames() {
        assertEquals("Sisir" to "", GoogleAuthMapper.splitDisplayName("Sisir"))
        assertEquals("সুকান্ত" to "সিংহ", GoogleAuthMapper.splitDisplayName("সুকান্ত সিংহ"))
    }

    @Test
    fun completeProfileRequiresRequiredFields() {
        val incomplete = GoogleAuthMapper.profileFromAuthUser(
            JSONObject("""{"id":"1","email":"a@b.com","user_metadata":{"full_name":"A B"}}""")
        )
        assertFalse(incomplete.isProfileComplete)
        val complete = incomplete.copy(
            firstName = "A",
            lastName = "B",
            avatarUrl = "https://example.com/a.png",
            about = "লেখক",
            phone = "01700000000",
            address = "Sylhet",
            facebookId = "facebook.com/ab"
        )
        assertTrue(complete.isProfileComplete)
    }

    @Test
    fun jwtDetectionRejectsLocalAdminTokens() {
        assertFalse(GoogleAuthMapper.isSupabaseJwt("admin_auth_token"))
        assertFalse(GoogleAuthMapper.isSupabaseJwt(null))
        assertFalse(
            GoogleAuthMapper.isSupabaseJwt(
                fakeIdToken(mapOf("sub" to "1234567890", "iss" to "https://accounts.google.com"))
            )
        )
        assertTrue(
            GoogleAuthMapper.isSupabaseJwt(
                fakeIdToken(mapOf("sub" to "1234567890", "role" to "authenticated"))
            )
        )
        assertTrue(
            GoogleAuthMapper.isSupabaseJwt(
                fakeIdToken(mapOf("sub" to "1234567890", "iss" to "https://xyz.supabase.co/auth/v1"))
            )
        )
        assertTrue(
            GoogleAuthMapper.isSupabaseJwt(
                fakeIdToken(mapOf("sub" to "11111111-1111-1111-1111-111111111111"))
            )
        )
    }

    @Test
    fun userMessagesNeverExposeTokens() {
        val network = GoogleAuthMapper.userMessage(UnknownHostException("host"))
        assertEquals(
            "Unable to connect. Please check your internet connection and try again.",
            network
        )
        assertEquals("", GoogleAuthMapper.userMessage(GoogleAuthException.Cancelled()))
        val failed = GoogleAuthMapper.userMessage(GoogleAuthException.Failed("x"))
        assertFalse(failed.contains("eyJ"))
        assertFalse(failed.contains("secret", ignoreCase = true))
    }

    @Test
    fun sha256IsDeterministicHex() {
        val hex = GoogleAuthMapper.sha256Hex("ningshing-che")
        assertEquals(64, hex.length)
        assertEquals(hex, GoogleAuthMapper.sha256Hex("ningshing-che"))
        assertTrue(hex.matches(Regex("[0-9a-f]+")))
    }

    @Test
    fun timeoutIsNotTreatedAsUserCancel() {
        val failed = GoogleAuthException.Failed("Google সাইন-ইন সময় শেষ হয়েছে। আবার চেষ্টা করুন।")
        assertFalse(GoogleAuthMapper.isCancellation(failed))
        assertEquals(
            "Google সাইন-ইন সময় শেষ হয়েছে। আবার চেষ্টা করুন।",
            GoogleAuthMapper.userMessage(failed)
        )
    }

    @Test
    fun supabaseNonceSentOnlyWhenTokenHasMatchingHash() {
        val raw = "raw-nonce-value"
        val hashed = GoogleAuthMapper.sha256Hex(raw)
        val withHash = fakeIdToken(mapOf("nonce" to hashed))
        val withoutNonce = fakeIdToken(mapOf("sub" to "abc"))
        val withRaw = fakeIdToken(mapOf("nonce" to raw))
        assertEquals(raw, GoogleAuthMapper.supabaseNonce(withHash, raw))
        assertEquals("", GoogleAuthMapper.supabaseNonce(withoutNonce, raw))
        assertEquals("", GoogleAuthMapper.supabaseNonce(withRaw, raw))
        assertEquals("", GoogleAuthMapper.supabaseNonce("not-a-jwt", raw))
    }

    @Test
    fun developerConsoleErrorIsExplained() {
        val error = GoogleAuthException.Failed(
            "During begin sign in, failure response from one tap: 16: [28444] Developer console is not set up correctly."
        )
        assertTrue(GoogleAuthMapper.isDeveloperConsoleError(error))
        assertTrue(GoogleAuthMapper.userMessage(error).contains("SHA-1"))
    }

    private fun fakeIdToken(claims: Map<String, String>): String {
        val payload = org.json.JSONObject(claims).toString()
        val encoded = java.util.Base64.getUrlEncoder().withoutPadding()
            .encodeToString(payload.toByteArray(Charsets.UTF_8))
        return "eyJhbGciOiJub25lIn0.$encoded.sig"
    }
}
