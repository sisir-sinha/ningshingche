package com.ningshingche.app.comments

import com.ningshingche.app.data.portal.PortalConfig
import com.ningshingche.app.data.portal.PortalError
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class PublicCommentApiTest {
    private val userId = "22222222-2222-4222-8222-222222222222"

    @Test fun `signed in POST sends author ID and pending status`() = runBlocking {
        CommentApiFixture().use { api ->
            val result = api.repository.postComment(CommentApiFixture.BLOG_ID, "Article", "  পাঠক  ",
                " reader@example.test ", "  সুন্দর লেখা  ", phone = " +৮৮০ ১৭০০০০০০০০ ", userId = userId)
            assertTrue(result.isSuccess)
            val request = api.lastPost!!
            assertEquals("POST", request.method)
            assertEquals("return=minimal", request.getHeader("Prefer"))
            val body = PortalConfig.moshi.adapter(Map::class.java).fromJson(request.body.readUtf8())!!
            assertEquals(userId, body["user_id"])
            assertEquals("Unpublish", body["status"])
            assertEquals("পাঠক", body["name"])
            assertEquals("reader@example.test", body["email"])
            assertEquals("+৮৮০ ১৭০০০০০০০০", body["phone"])
            assertEquals("সুন্দর লেখা", body["content"])
        }
    }

    @Test fun `blank account id never posts`() = runBlocking {
        CommentApiFixture().use { api ->
            val result = api.repository.postComment(CommentApiFixture.BLOG_ID, "Article", "Reader", null, "Comment", userId = "")
            assertTrue(result.exceptionOrNull() is PortalError.SignedOut)
            assertEquals(0, api.posts.get())
        }
    }

    @Test fun `server denial does not report success`() = runBlocking {
        CommentApiFixture().use { api ->
            api.responseCode = 403
            api.responseBody = """{"code":"42501","message":"Comment rejected by policy"}"""
            val result = api.repository.postComment(CommentApiFixture.BLOG_ID, "Article", "Reader", "", "Comment", userId = userId)
            assertTrue(result.isFailure)
            assertEquals(1, api.posts.get())
        }
    }
}
