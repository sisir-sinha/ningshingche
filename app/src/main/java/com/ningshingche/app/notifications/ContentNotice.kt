package com.ningshingche.app.notifications

/**
 * One piece of live content that can produce a system notification.
 *
 * [seenKey] is stable across syncs so the first snapshot can be stored as a
 * baseline (no flood of historical items) and later snapshots only emit what
 * is actually new.
 */
enum class NotificationKind {
    ARTICLE,
    FEATURED,
    VIDEO,
    PDF,
    GALLERY,
    SYSTEM,
    MESSAGE
}

data class ContentNotice(
    val kind: NotificationKind,
    val id: String,
    val title: String,
    val body: String = "",
    val uri: String = ""
) {
    val seenKey: String get() = "${kind.name}:$id"
}

data class NotificationDraft(
    val kind: NotificationKind,
    val title: String,
    val body: String,
    val uri: String,
    val notificationId: Int,
    val itemCount: Int
)

object ContentUpdatePolicy {
    const val MAX_INDIVIDUAL = 3

    fun unseen(seenKeys: Set<String>, incoming: List<ContentNotice>): List<ContentNotice> =
        incoming.filter { it.id.isNotBlank() && it.seenKey !in seenKeys }

    /**
     * First successful snapshot is remembered, never notified. Later unseen
     * rows become drafts. More than [MAX_INDIVIDUAL] of one kind collapse into
     * a single summary so the shade is not flooded.
     */
    fun drafts(
        hasBaseline: Boolean,
        unseen: List<ContentNotice>
    ): List<NotificationDraft> {
        if (!hasBaseline || unseen.isEmpty()) return emptyList()
        return unseen.groupBy { it.kind }.flatMap { (kind, items) ->
            if (items.size > MAX_INDIVIDUAL) {
                listOf(
                    NotificationDraft(
                        kind = kind,
                        title = summaryTitle(kind, items.size),
                        body = items.take(4).joinToString(" · ") { it.title },
                        uri = items.first().uri,
                        notificationId = notificationId(kind, "summary"),
                        itemCount = items.size
                    )
                )
            } else {
                items.map { item ->
                    NotificationDraft(
                        kind = kind,
                        title = itemTitle(kind),
                        body = item.title,
                        uri = item.uri,
                        notificationId = notificationId(kind, item.id),
                        itemCount = 1
                    )
                }
            }
        }
    }

    fun itemTitle(kind: NotificationKind): String = when (kind) {
        NotificationKind.ARTICLE -> "নতুন প্রবন্ধ"
        NotificationKind.FEATURED -> "নির্বাচিত প্রবন্ধ"
        NotificationKind.VIDEO -> "নতুন ভিডিও"
        NotificationKind.PDF -> "নতুন PDF বই"
        NotificationKind.GALLERY -> "নতুন ছবি"
        NotificationKind.SYSTEM -> "সিস্টেম আপডেট"
        NotificationKind.MESSAGE -> "অ্যাডমিনের বার্তা"
    }

    fun summaryTitle(kind: NotificationKind, count: Int): String = when (kind) {
        NotificationKind.ARTICLE -> "${count}টি নতুন প্রবন্ধ"
        NotificationKind.FEATURED -> "${count}টি নির্বাচিত প্রবন্ধ"
        NotificationKind.VIDEO -> "${count}টি নতুন ভিডিও"
        NotificationKind.PDF -> "${count}টি নতুন PDF বই"
        NotificationKind.GALLERY -> "${count}টি নতুন ছবি"
        NotificationKind.SYSTEM -> "সিস্টেম আপডেট"
        NotificationKind.MESSAGE -> "${count}টি নতুন বার্তা"
    }

    fun notificationId(kind: NotificationKind, key: String): Int {
        val hashed = 31 * kind.ordinal + key.hashCode()
        return 41000 + (hashed and 0x7FFF)
    }
}
