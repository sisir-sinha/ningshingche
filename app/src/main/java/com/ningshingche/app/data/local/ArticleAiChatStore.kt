package com.ningshingche.app.data.local

import com.ningshingche.app.data.model.AiChatMessage

class ArticleAiChatStore(private val dao: ChatDao) {

    suspend fun load(articleId: String): List<AiChatMessage> {
        if (articleId.isBlank()) return emptyList()
        return dao.getMessagesForArticle(articleId).map { it.toAi() }
    }

    suspend fun append(articleId: String, message: AiChatMessage) {
        if (articleId.isBlank()) return
        dao.insertMessage(message.toEntity(articleId))
    }
}

private fun ChatMessageEntity.toAi() = AiChatMessage(
    id = id,
    text = text,
    isUser = isUser,
    timestamp = timestamp,
    offerOnline = offerOnline
)

private fun AiChatMessage.toEntity(articleId: String) = ChatMessageEntity(
    id = id,
    text = text,
    isUser = isUser,
    timestamp = timestamp,
    offerOnline = offerOnline,
    articleId = articleId
)
