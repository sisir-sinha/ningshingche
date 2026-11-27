package com.ningshingche.app.auth

import android.content.Context
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import com.ningshingche.app.data.remote.SupabaseClient
import com.ningshingche.app.data.remote.UserProfile
import com.ningshingche.app.data.remote.UserRole
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** All requests are redirected to a local server; no live accounts are made. */
@RunWith(RobolectricTestRunner::class)
class RegistrationProfileSaveTest {
    private lateinit var context: Context
    private val id = "11111111-1111-4111-8111-111111111111"
    private fun json(body: String, code: Int = 200) = MockResponse()
        .setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)
    private fun token(): String {
        fun enc(s: String) = Base64.encodeToString(s.toByteArray(), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        return enc("{\"alg\":\"HS256\"}") + "." + enc("{\"sub\":\"$id\",\"role\":\"authenticated\",\"exp\":4102444800}") + ".signature"
    }
    private fun profile() = UserProfile(id = id, email = "reader@example.test", fullName = "Reader Name",
        firstName = "Reader", lastName = "Name", role = UserRole.AUTHOR,
        phone = "+8801712345678", address = "Sylhet", avatarUrl = "https://example.test/a.png")

    @Before fun clearSession() {
        context = ApplicationProvider.getApplicationContext()
        context.getSharedPreferences("supabase_auth_session", Context.MODE_PRIVATE).edit().clear().commit()
    }
    private fun client(server: MockWebServer): SupabaseClient {
        val http = OkHttpClient.Builder().addInterceptor { chain ->
            val original = chain.request()
            val url = server.url(original.url.encodedPath).newBuilder()
                .encodedQuery(original.url.encodedQuery).build()
            chain.proceed(original.newBuilder().url(url).build())
        }.build()
        return SupabaseClient(context, http).also {
            it.saveSession(token(), profile(), expiresAt = 4102444800000L)
        }
    }

    @Test fun newProfilePersistsOptionalFieldsBeforeReportingSuccess() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(json("[]"))
            server.enqueue(json("""[{"id":"$id","name":"Reader Name","first_name":"Reader","last_name":"Name","phone":"+8801712345678","address":"Sylhet","avatar_url":"https://example.test/a.png"}]""", 201))
            val client = client(server)
            val saved = client.upsertReaderProfile(profile()).getOrThrow()
            assertEquals("Sylhet", saved.address)
            assertEquals("+8801712345678", saved.phone)
            assertEquals("GET", server.takeRequest().method)
            val request = server.takeRequest()
            assertEquals("POST", request.method)
            val body = JSONObject(request.body.readUtf8())
            assertEquals("Sylhet", body.getString("address"))
            assertEquals("+8801712345678", body.getString("phone"))
        }
    }

    @Test fun failedLookupNeverOverwritesAndKeepsLocalDetails() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(json("""{"message":"offline"}""", 503))
            val client = client(server)
            assertTrue(client.upsertReaderProfile(profile()).isFailure)
            assertEquals(1, server.requestCount)
            assertEquals("Sylhet", client.currentUser.value?.address)
        }
    }

    @Test fun deniedOrEmptyWriteNeverPretendsToHaveSaved() = runBlocking {
        for (response in listOf(json("""{"message":"denied"}""", 403), json("[]", 201))) {
            MockWebServer().use { server ->
                server.enqueue(json("[]"))
                server.enqueue(response)
                val client = client(server)
                assertTrue(client.upsertReaderProfile(profile()).isFailure)
                assertEquals("+8801712345678", client.currentUser.value?.phone)
            }
        }
    }

    @Test fun existingProfileKeepsStoredDetailsAndFillsNewOptionalFields() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(json("""[{"id":"$id","name":"Reader Name","first_name":"Reader","last_name":"Name","about":"existing biography","phone":"","address":""}]"""))
            server.enqueue(json("""[{"id":"$id","name":"Reader Name","first_name":"Reader","last_name":"Name","about":"existing biography","phone":"+8801712345678","address":"Sylhet"}]"""))
            val result = client(server).upsertReaderProfile(profile()).getOrThrow()
            assertEquals("existing biography", result.about)
            server.takeRequest()
            val patch = server.takeRequest()
            assertEquals("PATCH", patch.method)
            val body = JSONObject(patch.body.readUtf8())
            assertEquals("existing biography", body.getString("about"))
            assertEquals("Sylhet", body.getString("address"))
        }
    }

    @Test fun editingCanRecoverWhenInitialProfileInsertWasDenied() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(json("[]")) // update matched no row
            server.enqueue(json("[]")) // confirm the row is absent
            server.enqueue(json("[]")) // upsert lookup
            server.enqueue(json("""[{"id":"$id","name":"Reader Name","first_name":"Reader","last_name":"Name","phone":"+8801712345678","address":"Sylhet"}]""", 201))
            assertEquals("Sylhet", client(server).updateReaderProfile(profile()).getOrThrow().address)
            assertEquals(listOf("PATCH", "GET", "GET", "POST"), (1..4).map { server.takeRequest().method })
        }
    }

}
