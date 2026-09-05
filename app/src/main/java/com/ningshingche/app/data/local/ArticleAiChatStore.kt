package com.ningshingche.app.data.local

import com.ningshingche.app.data.model.AiChatMessage
import com.ningshingche.app.data.model.ArticleCitation
import org.json.JSONArray
import org.json.JSONObject

class ArticleAiChatStore(private val dao: ChatDao) {

    suspend fun load(articleId: String): List<AiChatMessage> {
        if (articleId.isBlank()) return emptyList()
        return dao.getMessagesForArticle(articleId).map { it.toAi() }
    }

    suspend fun append(articleId: String, message: AiChatMessage) {
        if (articleId.isBlank()) return
        dao.insertMessage(message.toEntity(articleId))
    }

    companion object {
        const val GLOBAL_THREAD = "global"
    }
}

private fun ChatMessageEntity.toAi(): AiChatMessage {
    val (citations, suggested) = parsePayload(citationsRaw)
    return AiChatMessage(
        id = id,
        text = text,
        isUser = isUser,
        timestamp = timestamp,
        citations = citations,
        offerOnline = offerOnline,
        suggestedQuestions = suggested
    )
}

private fun AiChatMessage.toEntity(articleId: String): ChatMessageEntity {
    val payload = JSONObject().apply {
        put("citations", JSONArray().also { array ->
            citations.forEach { citation ->
                array.put(
                    JSONObject()
                        .put("articleId", citation.articleId)
                        .put("title", citation.title)
                        .put("author", citation.author)
                        .put("category", citation.category)
                        .put("snippet", citation.snippet)
                )
            }
        })
        put("suggestedQuestions", JSONArray().also { array ->
            suggestedQuestions.forEach { array.put(it) }
        })
    }
    return ChatMessageEntity(
        id = id,
        text = text,
        isUser = isUser,
        timestamp = timestamp,
        citationsRaw = payload.toString(),
        offerOnline = offerOnline,
        articleId = articleId
    )
}

private fun parsePayload(raw: String): Pair<List<ArticleCitation>, List<String>> {
    if (raw.isBlank() || raw == "[]") return emptyList<ArticleCitation>() to emptyList()
    return try {
        val trimmed = raw.trim()
        if (trimmed.startsWith("[")) {
            parseCitations(JSONArray(trimmed)) to emptyList()
        } else {
            val obj = JSONObject(trimmed)
            val citations = obj.optJSONArray("citations")?.let { parseCitations(it) } ?: emptyList()
            val suggested = obj.optJSONArray("suggestedQuestions")?.let { array ->
                buildList {
                    for (i in 0 until array.length()) add(array.optString(i))
                }.filter { it.isNotBlank() }
            } ?: emptyList()
            citations to suggested
        }
    } catch (_: Exception) {
        emptyList<ArticleCitation>() to emptyList()
    }
}

private fun parseCitations(array: JSONArray): List<ArticleCitation> = buildList {
    for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        add(
            ArticleCitation(
                articleId = item.optString("articleId"),
                title = item.optString("title"),
                author = item.optString("author"),
                category = item.optString("category"),
                snippet = item.optString("snippet")
            )
        )
    }
}
