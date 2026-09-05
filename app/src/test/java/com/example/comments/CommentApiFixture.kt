package com.example.comments

import com.example.data.portal.PortalApi
import com.example.data.portal.PortalConfig
import com.example.data.portal.PortalRepository
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

/** Uses the real Retrofit API/DTO adapters. All traffic stays on MockWebServer. */
internal class CommentApiFixture : AutoCloseable {
    val server = MockWebServer()
    val posts = AtomicInteger()
    val enteredPost = CountDownLatch(1)
    val releasePost = CountDownLatch(1)
    @Volatile var blockPosts = false
    @Volatile var responseCode = 201
    @Volatile var responseBody = ""
    @Volatile var lastPost: RecordedRequest? = null
    val repository: PortalRepository

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.requestUrl?.encodedPath.orEmpty()
                if (request.method == "POST" && path == "/rest/v1/comments") {
                    lastPost = request
                    posts.incrementAndGet()
                    enteredPost.countDown()
                    if (blockPosts) releasePost.await(10, TimeUnit.SECONDS)
                    return MockResponse().setResponseCode(responseCode)
                        .setHeader("Content-Type", "application/json").setBody(responseBody)
                }
                if (request.method == "GET" && path == "/rest/v1/blogs") {
                    return MockResponse().setHeader("Content-Type", "application/json").setBody(
                        """[{"id":"$BLOG_ID","title":"নিংশিং চে","slug":"article","content":"Article text","status":"Publish"}]"""
                    )
                }
                if (request.method == "GET" && path == "/rest/v1/comments") {
                    return MockResponse().setHeader("Content-Type", "application/json").setBody("[]")
                }
                return MockResponse().setResponseCode(404)
            }
        }
        server.start()
        val client = OkHttpClient.Builder()
            .retryOnConnectionFailure(false)
            .addInterceptor { chain ->
                chain.proceed(chain.request().newBuilder()
                    .header("apikey", "fixture-publishable-key")
                    .header("Authorization", "Bearer fixture-publishable-key")
                    .build())
            }.build()
        val api = Retrofit.Builder().baseUrl(server.url("/rest/v1/"))
            .client(client).addConverterFactory(MoshiConverterFactory.create(PortalConfig.moshi))
            .build().create(PortalApi::class.java)
        repository = PortalRepository(api)
    }

    override fun close() {
        releasePost.countDown()
        server.shutdown()
    }

    companion object {
        const val BLOG_ID = "11111111-1111-4111-8111-111111111111"
    }
}
