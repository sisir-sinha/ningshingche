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
                    relatedId = comment.id
                )
            }
        }
        return out
    }
}
