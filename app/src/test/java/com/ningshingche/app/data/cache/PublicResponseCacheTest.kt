package com.ningshingche.app.data.cache

import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.nio.file.Files
import java.util.concurrent.TimeUnit

class PublicResponseCacheTest {
    private val server = MockWebServer()
    private lateinit var base: String
    private lateinit var cache: PublicResponseCache
    private lateinit var client: OkHttpClient
    private val temp = Files.createTempDirectory("public-cache-test").toFile()

    @Before fun setup() {
        val certificate = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverTls = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        server.useHttps(serverTls.sslSocketFactory(), false)
        server.start()
        base = server.url("/").toString().trimEnd('/')
        cache = PublicResponseCache(temp, "localhost", "anonymous-key", mapOf("blogs" to setOf("id,title")),
            refreshIntervalMs = TimeUnit.HOURS.toMillis(1))
        client = cache.install(OkHttpClient.Builder().sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager))
    }
    @After fun tearDown() {
        client.dispatcher.cancelAll()
        server.shutdown()
        client.dispatcher.executorService.shutdown()
        client.dispatcher.executorService.awaitTermination(5, TimeUnit.SECONDS)
        cache.close()
        temp.deleteRecursively()
    }
    private fun get(path: String = "/rest/v1/blogs?select=id%2Ctitle&status=eq.Publish") =
        Request.Builder().url(base + path).header("Authorization", "Bearer SECRET-READER-TOKEN").build()
    private fun response(body: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(body)
    private fun read(request: Request = get()) = client.newCall(request).execute().use { it.body!!.string() }

    @Test fun cacheHitReturnsImmediatelyAndBackgroundUsesOnlyAnonymousIdentity() {
        server.enqueue(response("[{\"title\":\"old\"}]"))
        assertEquals("[{\"title\":\"old\"}]", read())
        assertEquals("Bearer anonymous-key", server.takeRequest(3, TimeUnit.SECONDS)!!.getHeader("Authorization"))
        server.enqueue(response("[{\"title\":\"new\"}]"))
        assertEquals("[{\"title\":\"old\"}]", read())
        assertEquals("Bearer anonymous-key", server.takeRequest(3, TimeUnit.SECONDS)!!.getHeader("Authorization"))
        // Wait for background response to drain and its cache write to commit.
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        var body = ""
        while (System.nanoTime() < deadline) {
            body = read()
            if (body.contains("new")) break
            Thread.sleep(20)
        }
        assertTrue(body.contains("new"))
        assertNull(server.takeRequest(300, TimeUnit.MILLISECONDS))
        assertFalse(temp.walkTopDown().filter { it.isFile }.any { it.readBytes().toString(Charsets.ISO_8859_1).contains("SECRET-READER-TOKEN") })
    }

    @Test fun pagingHeadersSurviveTheDiskCache() {
        server.enqueue(response("[1]").setHeader("Content-Range", "0-0/37"))
        client.newCall(get()).execute().use { assertEquals("0-0/37", it.header("Content-Range")); it.body!!.string() }
        server.takeRequest(3, TimeUnit.SECONDS)
        server.enqueue(response("[1]").setHeader("Content-Range", "0-0/38"))
        client.newCall(get()).execute().use { assertEquals("0-0/37", it.header("Content-Range")); it.body!!.string() }
        assertNotNull(server.takeRequest(3, TimeUnit.SECONDS))
    }

    @Test fun privateOrUnapprovedRequestsAreNeverShared() {
        val paths = listOf("/rest/v1/profiles?select=id%2Ctitle", "/rest/v1/blogs?select=id%2Ctitle",
            "/rest/v1/blogs?select=*&status=eq.Publish", "/rest/v1/blogs?select=id%2Ctitle&status=eq.Publish&title=secret")
        for (path in paths) {
            // Even a wrongly public server header must not put private data on disk.
            server.enqueue(response("[]").setHeader("Cache-Control", "public, max-age=600"))
            server.enqueue(response("[]").setHeader("Cache-Control", "public, max-age=600"))
            read(get(path)); read(get(path))
            assertEquals("Bearer SECRET-READER-TOKEN", server.takeRequest(3, TimeUnit.SECONDS)!!.getHeader("Authorization"))
            assertEquals("Bearer SECRET-READER-TOKEN", server.takeRequest(3, TimeUnit.SECONDS)!!.getHeader("Authorization"))
        }
    }

    @Test fun noStoreAndNonPublicCookiesAreRespected() {
        for (extra in listOf("Cache-Control" to "no-store", "Cache-Control" to "no-cache",
            "Cache-Control" to "max-age=0", "Cache-Control" to "private", "Set-Cookie" to "session=private")) {
            server.enqueue(response("[]").setHeader(extra.first, extra.second))
            server.enqueue(response("[]").setHeader(extra.first, extra.second))
            read(); read()
            assertNotNull(server.takeRequest(3, TimeUnit.SECONDS)); assertNotNull(server.takeRequest(3, TimeUnit.SECONDS))
        }
    }

    @Test fun approvedCloudflareCookieDoesNotPreventPublicCaching() {
        server.enqueue(response("[1]").setHeader("Set-Cookie", "__cf_bm=opaque; Secure"))
        assertEquals("[1]", read())
        assertNotNull(server.takeRequest(3, TimeUnit.SECONDS))
        server.enqueue(response("[1]"))
        assertEquals("[1]", read())
        assertNotNull(server.takeRequest(3, TimeUnit.SECONDS)) // background revalidation only
    }

    @Test fun aServerFailureLeavesLastGoodDataAvailable() {
        server.enqueue(response("[1]"))
        assertEquals("[1]", read())
        assertNotNull(server.takeRequest(3, TimeUnit.SECONDS))
        server.enqueue(MockResponse().setResponseCode(503))
        assertEquals("[1]", read())
        assertNotNull(server.takeRequest(3, TimeUnit.SECONDS))
        assertEquals("[1]", read())
        assertNull(server.takeRequest(300, TimeUnit.MILLISECONDS))
    }

    @Test fun explicitClearRemovesPublicResponses() {
        server.enqueue(response("[1]"))
        assertEquals("[1]", read())
        server.takeRequest(3, TimeUnit.SECONDS)
        cache.clear()
        server.enqueue(response("[2]"))
        assertEquals("[2]", read())
        assertNotNull(server.takeRequest(3, TimeUnit.SECONDS))
    }

    @Test fun revokedContentIsEvictedInsteadOfKeptAsPublic() = runBlocking {
        server.enqueue(response("[1]"))
        assertEquals("[1]", read())
        server.takeRequest(3, TimeUnit.SECONDS)
        val changed = async(start = CoroutineStart.UNDISPATCHED) { cache.changes.first() }
        server.enqueue(MockResponse().setResponseCode(403))
        assertEquals("[1]", read())
        server.takeRequest(3, TimeUnit.SECONDS)
        withTimeout(5000) { changed.await() }
        server.enqueue(response("[2]"))
        assertEquals("[2]", read())
        assertNotNull(server.takeRequest(3, TimeUnit.SECONDS))
    }

    @Test fun diskCacheSurvivesReopeningAndWorksWithoutNetwork() {
        server.enqueue(response("[42]"))
        assertEquals("[42]", read())
        server.takeRequest(3, TimeUnit.SECONDS)
        cache.close()
        cache = PublicResponseCache(temp, "localhost", "anonymous-key", mapOf("blogs" to setOf("id,title")))
        val builder = client.newBuilder().apply {
            interceptors().clear()
            networkInterceptors().clear()
        }
        client = cache.install(builder)
        server.shutdown()
        assertEquals("[42]", read())
    }

    @Test fun postsAreNeverCachedOrConvertedToAnonymous() {
        val request = get().newBuilder().post("payload".toRequestBody()).build()
        for (i in 0..1) {
            server.enqueue(response("{}"))
            read(request)
            assertEquals("Bearer SECRET-READER-TOKEN", server.takeRequest(3, TimeUnit.SECONDS)!!.getHeader("Authorization"))
        }
    }

}
