package com.ningshingche.app.comments

import com.ningshingche.app.data.portal.PortalConfig
import com.ningshingche.app.data.portal.PortalError
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class PublicCommentApiTest {
    @Test
    fun `anonymous POST uses minimal response and pending status with phone`() = runBlocking {
        CommentApiFixture().use { api ->
            val result = api.repository.postComment(CommentApiFixture.BLOG_ID, "Article", "  পাঠক  ",
                " reader@example.test ", "  সুন্দর লেখা  ", phone = " +৮৮০ ১৭০০০০০০০০ ")
            assertTrue(result.isSuccess)
            val request = api.lastPost!!
            assertEquals("POST", request.method)
            assertEquals("/rest/v1/comments", request.path)
            assertEquals("return=minimal", request.getHeader("Prefer"))
            assertNull(request.getHeader("x-dashboard-session"))
            assertNull(request.getHeader("Cookie"))
            assertEquals("fixture-publishable-key", request.getHeader("apikey"))
            val body = PortalConfig.moshi.adapter(Map::class.java).fromJson(request.body.readUtf8())!!
            assertEquals(CommentApiFixture.BLOG_ID, body["blog_id"])
            assertEquals("Unpublish", body["status"])
            assertEquals("পাঠক", body["name"])
            assertEquals("reader@example.test", body["email"])
            assertEquals("+৮৮০ ১৭০০০০০০০০", body["phone"])
            assertEquals("সুন্দর লেখা", body["content"])
            assertEquals("", body["address"])
            assertFalse(body.containsKey("user_id"))
            assertEquals(1, api.posts.get())
        }
    }

    @Test
    fun `empty optional fields use empty strings not database nulls and 204 is success`() = runBlocking {
        CommentApiFixture().use { api ->
            api.responseCode = 204
            assertTrue(api.repository.postComment(CommentApiFixture.BLOG_ID, "Article", "Reader", null, "Comment").isSuccess)
            val body = PortalConfig.moshi.adapter(Map::class.java).fromJson(api.lastPost!!.body.readUtf8())!!
            assertEquals("", body["email"])
            assertEquals("", body["phone"])
            assertEquals("", body["address"])
            assertEquals("Unpublish", body["status"])
        }
    }

    @Test
    fun `HTTP failures return actual PostgREST message rather than false success`() = runBlocking {
        CommentApiFixture().use { api ->
            api.responseCode = 403
            api.responseBody = """{"code":"42501","message":"Comment rejected by policy"}"""
            val result = api.repository.postComment(CommentApiFixture.BLOG_ID, "Article", "Reader", "", "Comment")
            val error = result.exceptionOrNull() as PortalError.Http
            assertEquals(403, error.code)
            assertEquals("Comment rejected by policy", error.message)
            assertEquals(1, api.posts.get())
        }
    }
}
