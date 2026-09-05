package com.ningshingche.app.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentUpdatePolicyTest {

    private fun notice(kind: NotificationKind, id: String, title: String = id) =
        ContentNotice(kind = kind, id = id, title = title, uri = "https://ningshingche.com/$id")

    @Test
    fun unseenSkipsIdsAlreadyRemembered() {
        val incoming = listOf(
            notice(NotificationKind.ARTICLE, "a1", "এক"),
            notice(NotificationKind.ARTICLE, "a2", "দুই"),
            notice(NotificationKind.VIDEO, "v1", "ভিডিও")
        )
        val unseen = ContentUpdatePolicy.unseen(setOf("ARTICLE:a1"), incoming)
        assertEquals(listOf("a2", "v1"), unseen.map { it.id })
    }

    @Test
    fun firstSnapshotProducesNoDrafts() {
        val unseen = listOf(notice(NotificationKind.ARTICLE, "a1"))
        assertTrue(ContentUpdatePolicy.drafts(hasBaseline = false, unseen = unseen).isEmpty())
    }

    @Test
    fun fewNewItemsStayIndividual() {
        val unseen = listOf(
            notice(NotificationKind.PDF, "p1", "বই এক"),
            notice(NotificationKind.PDF, "p2", "বই দুই")
        )
        val drafts = ContentUpdatePolicy.drafts(hasBaseline = true, unseen = unseen)
        assertEquals(2, drafts.size)
        assertEquals("নতুন PDF বই", drafts[0].title)
        assertEquals("বই এক", drafts[0].body)
    }

    @Test
    fun manyNewItemsCollapseToSummary() {
        val unseen = (1..5).map { notice(NotificationKind.ARTICLE, "a$it", "প্রবন্ধ $it") }
        val drafts = ContentUpdatePolicy.drafts(hasBaseline = true, unseen = unseen)
        assertEquals(1, drafts.size)
        assertEquals("5টি নতুন প্রবন্ধ", drafts.single().title)
        assertEquals(5, drafts.single().itemCount)
    }

    @Test
    fun kindsStaySeparateWhenCollapsing() {
        val unseen = (1..4).map { notice(NotificationKind.VIDEO, "v$it") } +
            listOf(notice(NotificationKind.SYSTEM, "ver", "অ্যাপ আপডেট হয়েছে"))
        val drafts = ContentUpdatePolicy.drafts(hasBaseline = true, unseen = unseen)
        assertEquals(2, drafts.size)
        assertTrue(drafts.any { it.kind == NotificationKind.VIDEO && it.itemCount == 4 })
        assertTrue(drafts.any { it.kind == NotificationKind.SYSTEM && it.itemCount == 1 })
    }
}
