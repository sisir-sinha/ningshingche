package com.ningshingche.app.data.remote

import org.json.JSONObject
import java.util.UUID

data class UserNotificationRecord(
    val id: String = UUID.randomUUID().toString(),
    val userId: String,
    val kind: String,
    val title: String,
    val body: String = "",
    val relatedId: String = "",
    val isRead: Boolean = false,
    val createdAt: String = ""
) {
    val isArticle: Boolean get() = kind == KIND_ARTICLE
    val isComment: Boolean get() = kind == KIND_COMMENT
    val isAdminMessage: Boolean get() = kind == KIND_ADMIN

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("user_id", userId)
        put("kind", kind)
        put("title", title)
        put("body", body)
        put("related_id", relatedId)
        put("is_read", isRead)
    }

    companion object {
        const val KIND_ARTICLE = "article_published"
        const val KIND_COMMENT = "comment_published"
        const val KIND_ADMIN = "admin_message"

        fun fromJson(json: JSONObject): UserNotificationRecord = UserNotificationRecord(
            id = json.optString("id", UUID.randomUUID().toString()),
            userId = json.optString("user_id", ""),
            kind = json.optString("kind", ""),
            title = json.optString("title", ""),
            body = json.optString("body", ""),
            relatedId = json.optString("related_id", ""),
            isRead = json.optBoolean("is_read", false),
            createdAt = json.optString("created_at", "")
        )
    }
}

data class AdminMessageRecord(
    val id: String = UUID.randomUUID().toString(),
    val userId: String,
    val sender: String,
    val subject: String = "",
    val body: String,
    val isRead: Boolean = false,
    val createdAt: String = ""
) {
    val isFromUser: Boolean get() = sender.equals("user", ignoreCase = true)
    val isFromAdmin: Boolean get() = sender.equals("admin", ignoreCase = true)

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("user_id", userId)
        put("sender", sender)
        put("subject", subject)
        put("body", body)
        put("is_read", isRead)
    }

    companion object {
        fun fromJson(json: JSONObject): AdminMessageRecord = AdminMessageRecord(
            id = json.optString("id", UUID.randomUUID().toString()),
            userId = json.optString("user_id", ""),
            sender = json.optString("sender", "user"),
            subject = json.optString("subject", ""),
            body = json.optString("body", ""),
            isRead = json.optBoolean("is_read", false),
            createdAt = json.optString("created_at", "")
        )
    }
}

data class SubmittedMusicRecord(
    val id: String,
    val title: String,
    val artist: String = "",
    val album: String = "",
    val genre: String = "",
    val thumbnailUrl: String = "",
    val audioUrl: String = "",
    val createdAt: String = ""
) {
    companion object {
        fun fromJson(json: JSONObject): SubmittedMusicRecord = SubmittedMusicRecord(
            id = json.optString("id", UUID.randomUUID().toString()),
            title = json.optString("title", ""),
            artist = json.optString("artist", ""),
            album = json.optString("album", ""),
            genre = json.optString("genre", ""),
            thumbnailUrl = json.optString("thumbnail_url", ""),
            audioUrl = json.optString("audio_url", ""),
            createdAt = json.optString("created_at", "")
        )
    }
}

fun shortDateTime(iso: String): String {
    if (iso.isBlank()) return ""
    val parsed = parseIsoMillis(iso) ?: return iso.take(16).replace('T', ' ')
    val fmt = java.text.SimpleDateFormat("d MMM, h:mm a", java.util.Locale.getDefault())
    return fmt.format(parsed)
}

fun parseIsoMillis(iso: String): java.util.Date? {
    val candidates = listOf(
        "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXX",
        "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
        "yyyy-MM-dd'T'HH:mm:ssXXX",
        "yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd HH:mm:ss"
    )
    val trimmed = iso.trim()
    for (pattern in candidates) {
        val fmt = java.text.SimpleDateFormat(pattern, java.util.Locale.US)
        fmt.timeZone = java.util.TimeZone.getTimeZone("UTC")
        val value = runCatching { fmt.parse(trimmed) }.getOrNull()
        if (value != null) return value
    }
    val compact = trimmed.take(19).replace(' ', 'T')
    val fallback = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US)
    fallback.timeZone = java.util.TimeZone.getTimeZone("UTC")
    return runCatching { fallback.parse(compact) }.getOrNull()
}

fun messageAttachmentUrls(body: String): List<String> {
    if (body.isBlank()) return emptyList()
    val found = Regex("""https?://[^\s)]+""", RegexOption.IGNORE_CASE)
        .findAll(body)
        .map { it.value.trimEnd('.', ',', ';') }
        .distinct()
        .toList()
    return found.filter { url ->
        url.contains("i.ibb.co", true) ||
            url.contains("imgbb", true) ||
            url.endsWith(".jpg", true) ||
            url.endsWith(".jpeg", true) ||
            url.endsWith(".png", true) ||
            url.endsWith(".webp", true) ||
            url.endsWith(".gif", true)
    }
}

object InboxSync {
    fun noticesFromPublished(
        userId: String,
        articles: List<SubmittedBlogRecord>,
        comments: List<CommentRecord>,
        existingKeys: Set<String>
    ): List<UserNotificationRecord> {
        if (userId.isBlank()) return emptyList()
        val out = mutableListOf<UserNotificationRecord>()
        articles.filter {
            it.status.equals("Published", true) || it.status.equals("Approved", true)
        }.forEach { article ->
            val key = "${UserNotificationRecord.KIND_ARTICLE}:${article.id}"
            if (key !in existingKeys) {
                out += UserNotificationRecord(
                    userId = userId,
                    kind = UserNotificationRecord.KIND_ARTICLE,
                    title = "প্রবন্ধ প্রকাশিত হয়েছে",
                    body = article.title,
                    relatedId = article.id
                )
            }
        }
        comments.filter { it.isPublished }.forEach { comment ->
            val key = "${UserNotificationRecord.KIND_COMMENT}:${comment.id}"
            if (key !in existingKeys) {
                out += UserNotificationRecord(
                    userId = userId,
                    kind = UserNotificationRecord.KIND_COMMENT,
                    title = "মন্তব্য প্রকাশিত হয়েছে",
                    body = comment.content.take(160),
                    relatedId = comment.blogId.ifBlank { comment.id }
                )
            }
        }
        return out
    }
}
