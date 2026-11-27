package com.ningshingche.app.comments

import android.app.Application
import android.util.Base64
import com.ningshingche.app.data.portal.PortalApi
import com.ningshingche.app.data.portal.PortalConfig
import com.ningshingche.app.data.portal.PortalError
import com.ningshingche.app.data.portal.PortalRepository
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class)
class CommentSessionTransportTest {
    private val userId = "22222222-2222-4222-8222-222222222222"
    private fun jwt(subject: String, anonymous: Boolean = false): String {
        fun encode(s: String) = Base64.encodeToString(s.toByteArray(), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        return encode("{\"alg\":\"HS256\"}") + "." + encode("{\"sub\":\"$subject\",\"role\":\"authenticated\",\"is_anonymous\":$anonymous}") + ".signature"
    }

    @Test fun `guest anonymous and different account never post but matching account does`() = runBlocking {
        MockWebServer().use { server ->
            val cert = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
            val serverTls = HandshakeCertificates.Builder().heldCertificate(cert).build()
            val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
            server.useHttps(serverTls.sslSocketFactory(), false)
            server.start()
            var token: String? = null
            PortalConfig.installReaderSession { token }
            try {
                val api = Retrofit.Builder().baseUrl(server.url("/rest/v1/"))
                    .client(PortalConfig.okHttpClient(debug = false).newBuilder()
                        .sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager).build())
                    .addConverterFactory(MoshiConverterFactory.create(PortalConfig.moshi)).build()
                    .create(PortalApi::class.java)
                val repo = PortalRepository(api)
                suspend fun submit() = repo.postComment(CommentApiFixture.BLOG_ID, "Title", "Reader", "", "Hello", userId = userId)
                assertTrue(submit().exceptionOrNull() is PortalError.SignedOut)
                token = jwt(userId, anonymous = true)
                assertTrue(submit().exceptionOrNull() is PortalError.SignedOut)
                token = jwt("33333333-3333-4333-8333-333333333333")
                assertTrue(submit().exceptionOrNull() is PortalError.SignedOut)
                assertEquals(0, server.requestCount)
                token = jwt(userId)
                server.enqueue(MockResponse().setResponseCode(201))
                assertTrue(submit().isSuccess)
                val request = server.takeRequest()
                assertEquals("Bearer $token", request.getHeader("Authorization"))
                assertNull(request.getHeader("X-Nsc-Comment-User"))
                assertEquals(1, server.requestCount)
            } finally { PortalConfig.installReaderSession { null } }
        }
    }
}
