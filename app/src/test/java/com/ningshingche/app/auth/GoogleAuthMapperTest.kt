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
    fun jwtDetectionRejectsLocalAdminTokens() {
        assertFalse(GoogleAuthMapper.isSupabaseJwt("admin_auth_token"))
        assertFalse(GoogleAuthMapper.isSupabaseJwt(null))
        assertTrue(
            GoogleAuthMapper.isSupabaseJwt(
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.suffixvalue"
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
}
