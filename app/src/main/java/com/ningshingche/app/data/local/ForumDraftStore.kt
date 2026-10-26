package com.ningshingche.app.data.local

import android.content.Context
import com.ningshingche.app.data.portal.ForumAttachment
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import org.json.JSONObject

/**
 * What the reader typed, kept until it has been posted.
 *
 * The owner asked for the composer and the reply box to remember their contents
 * — text, pictures, the room that was picked — until the post actually succeeds.
 * Nothing here knows about the network: the screens save as the reader types and
 * clear the entry only after the database has answered, so a lost connection
 * costs a glance at the draft rather than the draft itself.
 *
 * One file, `filesDir/forum_drafts`, and no backup: a draft is a private thing on
 * one device, not something to carry to a new phone.
 *
 * Preferences rather than the Room database because a draft is a handful of
 * strings that has to be readable the instant the composer opens — a schema
 * migration for two text boxes would be a poor trade. The body is stored as the
 * HTML the editor produced, which is exactly what the composer puts back into it.
 */
private val Context.forumDrafts: androidx.datastore.core.DataStore<Preferences> by
    preferencesDataStore(name = "forum_drafts")

class ForumDraftStore(private val context: Context) {

    /** The new-discussion screen, all of it. */
    data class ComposerDraft(
        val categorySlug: String = "",
        val title: String = "",
        val body: String = "",
        val coverImageUrl: String = "",
        val coverDeleteUrl: String = "",
        /** Files attached to the post, which never enter the editor's HTML. */
        val attachments: List<ForumAttachment> = emptyList()
    ) {
        /** True when there is nothing worth coming back for. */
        val isEmpty: Boolean
            get() = title.isBlank() && bodyIsEmpty(body) &&
                coverImageUrl.isBlank() && attachments.isEmpty()

        companion object {
            /**
             * A rich editor that has been touched and emptied again leaves markup
             * behind — `<br>`, an empty paragraph, a stray `&nbsp;`. Treating that
             * as "the reader wrote something" would offer a draft of nothing, so
             * the tags and the non-breaking spaces come out before the question is
             * asked.
             */
            fun bodyIsEmpty(html: String): Boolean =
                html.replace(TAG, "").replace("&nbsp;", " ").isBlank()

            private val TAG = Regex("<[^>]*>")
        }
    }

    /** One reply box: the text, the files, and which answer it was answering. */
    data class ReplyDraft(
        val body: String = "",
        val parentId: String = "",
        val attachments: List<ForumAttachment> = emptyList()
    ) {
        val isEmpty: Boolean get() = ComposerDraft.bodyIsEmpty(body)
    }

    private object Keys {
        val COMPOSER = stringPreferencesKey("composer")
        const val REPLY_PREFIX = "reply."

        fun reply(discussionId: String) = stringPreferencesKey(REPLY_PREFIX + discussionId)
    }

    /** The composer as it was left, or null when there is nothing to restore. */
    suspend fun composer(): ComposerDraft? = read(Keys.COMPOSER)?.let { raw ->
        runCatching {
            val json = JSONObject(raw)
            ComposerDraft(
                categorySlug = json.optString("categorySlug", ""),
                title = json.optString("title", ""),
                body = json.optString("body", ""),
                coverImageUrl = json.optString("coverImageUrl", ""),
                coverDeleteUrl = json.optString("coverDeleteUrl", ""),
                attachments = json.optJSONArray("attachments").toAttachments()
                    .ifEmpty { json.optJSONArray("images").toStringList().map(::attachmentFromUrl) }
            ).takeUnless { it.isEmpty }
        }.getOrNull()
    }

    /** Saved on every change; cheap, because it is a few hundred bytes at most. */
    suspend fun saveComposer(draft: ComposerDraft) {
        if (draft.isEmpty) {
            clearComposer()
            return
        }
        val json = JSONObject()
            .put("categorySlug", draft.categorySlug)
            .put("title", draft.title)
            .put("body", draft.body)
            .put("coverImageUrl", draft.coverImageUrl)
            .put("coverDeleteUrl", draft.coverDeleteUrl)
            .put("attachments", draft.attachments.toJsonArray())
            .toString()
        context.forumDrafts.edit { it[Keys.COMPOSER] = json }
    }

    /** After a post that succeeded, and only then. */
    suspend fun clearComposer() {
        context.forumDrafts.edit { it.remove(Keys.COMPOSER) }
    }

    /**
     * The reply box for one discussion. Keyed by the thread, so a reader can
     * leave a half-written answer in one thread, read another, and come back to
     * the first one exactly as they left it.
     */
    suspend fun reply(discussionId: String): ReplyDraft? {
        val id = discussionId.trim()
        if (id.isBlank()) return null
        return read(Keys.reply(id))?.let { raw ->
            runCatching {
                val json = JSONObject(raw)
                ReplyDraft(
                    body = json.optString("body", ""),
                    parentId = json.optString("parentId", ""),
                    attachments = json.optJSONArray("attachments").toAttachments()
                        .ifEmpty { json.optJSONArray("images").toStringList().map(::attachmentFromUrl) }
                ).takeUnless { it.isEmpty }
            }.getOrNull()
        }
    }

    suspend fun saveReply(discussionId: String, draft: ReplyDraft) {
        val id = discussionId.trim()
        if (id.isBlank()) return
        if (draft.isEmpty) {
            clearReply(id)
            return
        }
        val json = JSONObject()
            .put("body", draft.body)
            .put("parentId", draft.parentId)
            .put("attachments", draft.attachments.toJsonArray())
            .toString()
        context.forumDrafts.edit { it[Keys.reply(id)] = json }
    }

    suspend fun clearReply(discussionId: String) {
        val id = discussionId.trim()
        if (id.isBlank()) return
        context.forumDrafts.edit { it.remove(Keys.reply(id)) }
    }

    private suspend fun read(key: Preferences.Key<String>): String? =
        context.forumDrafts.data.first()[key]

    /** A missing or malformed list of files is an empty one, never a crash. */
    private fun org.json.JSONArray?.toStringList(): List<String> {
        val array = this ?: return emptyList()
        return (0 until array.length()).mapNotNull { index ->
            array.optString(index, "").takeIf { it.isNotBlank() }
        }
    }

    /** One file, with everything a chip needs to say what it is. */
    private fun List<ForumAttachment>.toJsonArray(): org.json.JSONArray {
        val array = org.json.JSONArray()
        forEach { attachment ->
            if (attachment.url.isBlank()) return@forEach
            array.put(
                JSONObject()
                    .put("url", attachment.url)
                    .put("name", attachment.name)
                    .put("mimeType", attachment.mimeType)
                    .put("sizeBytes", attachment.sizeBytes)
            )
        }
        return array
    }

    private fun org.json.JSONArray?.toAttachments(): List<ForumAttachment> {
        val array = this ?: return emptyList()
        return (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val url = item.optString("url", "")
            if (url.isBlank()) return@mapNotNull null
            ForumAttachment(
                url = url,
                name = item.optString("name", ""),
                mimeType = item.optString("mimeType", ""),
                sizeBytes = item.optLong("sizeBytes", 0L)
            )
        }
    }

    /**
     * A draft written before the app took PDFs stored its pictures as bare URLs.
     * It is read back as what it is, so an upgrade does not lose the draft.
     */
    private fun attachmentFromUrl(url: String): ForumAttachment =
        ForumAttachment.fromReference(url, "")
}
