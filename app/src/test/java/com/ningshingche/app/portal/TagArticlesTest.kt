package com.ningshingche.app.portal

import com.ningshingche.app.data.portal.PortalApi
import com.ningshingche.app.data.portal.PortalConfig
import com.ningshingche.app.data.portal.PortalError
import com.ningshingche.app.data.portal.PortalRepository
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

/** Exercises the real Retrofit filters and repository against a local server. */
class TagArticlesTest {
    private fun repository(server: MockWebServer): PortalRepository {
        val api = Retrofit.Builder().baseUrl(server.url("/rest/v1/"))
            .addConverterFactory(MoshiConverterFactory.create(PortalConfig.moshi))
            .build().create(PortalApi::class.java)
        return PortalRepository(api)
    }
    private fun json(body: String, code: Int = 200) = MockResponse()
        .setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test fun `topic tag uses normalised keys and published pages`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(json("""[{"id":"a","title":"Article","tags":["৭ম সংখ্যা"]}]""")
                .setHeader("Content-Range", "0-0/1"))
            val page = repository(server).articlesByTag("  #৭ম সংখ্যা  ", limit = 20, offset = 40).getOrThrow()
            assertEquals(listOf("a"), page.items.map { it.id })
            assertEquals(1, page.total)
            val query = server.takeRequest().requestUrl!!
            assertEquals("eq.Publish", query.queryParameter("status"))
            assertEquals("cs.{\"7মসংখ্যা\"}", query.queryParameter("tag_keys"))
            assertEquals("20", query.queryParameter("limit"))
            assertEquals("40", query.queryParameter("offset"))
        }
    }

    @Test fun `older schema scans all facets and filters by raw matching spellings`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(json("""{"code":"42703","message":"column tag_keys does not exist"}""", 400))
            val firstPage = (0 until 200).joinToString(",", "[", "]") { """{"id":"$it","tags":["other"]}""" }
            server.enqueue(json(firstPage))
            server.enqueue(json("""[{"id":"201","tags":[" #৯ম  সংখ্যা","9ম সংখ্যা","unrelated"]}]"""))
            server.enqueue(json("""[{"id":"a","title":"Article","tags":["9ম সংখ্যা"]}]""")
                .setHeader("Content-Range", "0-0/1"))
            val page = repository(server).articlesByTag("৯ম সংখ্যা").getOrThrow()
            assertEquals(listOf("a"), page.items.map { it.id })
            assertNotNull(server.takeRequest().requestUrl!!.queryParameter("tag_keys"))
            val scan1 = server.takeRequest().requestUrl!!
            val scan2 = server.takeRequest().requestUrl!!
            assertEquals("0", scan1.queryParameter("offset"))
            assertEquals("200", scan2.queryParameter("offset"))
            assertEquals("id.asc", scan2.queryParameter("order"))
            val result = server.takeRequest().requestUrl!!
            assertEquals("eq.Publish", result.queryParameter("status"))
            val filter = result.queryParameter("tags")!!
            assertTrue(filter.contains(" #৯ম  সংখ্যা"))
            assertTrue(filter.contains("9ম সংখ্যা"))
            assertTrue(filter.contains("৯ম সংখ্যা"))
            assertFalse(filter.contains("unrelated"))
        }
    }

    @Test fun `network and server errors are not reported as empty results`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(json("""{"message":"temporary failure"}""", 503))
            val result = repository(server).articlesByTag("সাহিত্য")
            assertTrue(result.exceptionOrNull() is PortalError.Http)
            assertEquals(1, server.requestCount)
        }
    }
}
