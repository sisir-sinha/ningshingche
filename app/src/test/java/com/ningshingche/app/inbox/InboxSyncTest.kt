package com.ningshingche.app.inbox

import com.ningshingche.app.data.remote.CommentRecord
import com.ningshingche.app.data.remote.InboxSync
import com.ningshingche.app.data.remote.SubmittedBlogRecord
import com.ningshingche.app.data.remote.UserNotificationRecord
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class InboxSyncTest {

    @Test
    fun publishedArticleAndCommentBecomeNotices() {
        val articles = listOf(
            SubmittedBlogRecord(id = "a1", title = "প্রবন্ধ এক", writerName = "লেখক", content = "লেখা", status = "Published"),
            SubmittedBlogRecord(id = "a2", title = "খসড়া", writerName = "লেখক", content = "লেখা", status = "Pending")
        )
        val comments = listOf(
            CommentRecord(id = "c1", blogId = "b", name = "পাঠক", content = "ভালো", status = "Publish"),
            CommentRecord(id = "c2", blogId = "b", name = "পাঠক", content = "অপেক্ষা", status = "Unpublish")
        )
        val notices = InboxSync.noticesFromPublished("user-1", articles, comments, emptySet())
        assertEquals(2, notices.size)
        assertTrue(notices.any { it.kind == UserNotificationRecord.KIND_ARTICLE && it.relatedId == "a1" })
        assertTrue(notices.any { it.kind == UserNotificationRecord.KIND_COMMENT && it.relatedId == "c1" })
    }

    @Test
    fun alreadyNotifiedKeysAreSkipped() {
        val articles = listOf(
            SubmittedBlogRecord(id = "a1", title = "প্রবন্ধ", writerName = "লেখক", content = "লেখা", status = "Approved")
        )
        val notices = InboxSync.noticesFromPublished(
            userId = "user-1",
            articles = articles,
            comments = emptyList(),
            existingKeys = setOf("${UserNotificationRecord.KIND_ARTICLE}:a1")
        )
        assertTrue(notices.isEmpty())
    }
}
