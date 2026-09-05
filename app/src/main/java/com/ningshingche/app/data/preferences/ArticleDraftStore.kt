package com.ningshingche.app.data.preferences

import android.content.Context

/** Local draft for New Article. Survives leaving the screen until the user submits. */
class ArticleDraftStore(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun title(): String = prefs.getString(KEY_TITLE, "").orEmpty()

    fun content(): String = prefs.getString(KEY_CONTENT, "").orEmpty()

    fun editorHeight(): Int = prefs.getInt(KEY_HEIGHT, 280).coerceIn(200, 720)

    fun save(title: String, content: String, editorHeight: Int? = null) {
        prefs.edit()
            .putString(KEY_TITLE, title)
            .putString(KEY_CONTENT, content)
            .apply {
                if (editorHeight != null) putInt(KEY_HEIGHT, editorHeight.coerceIn(200, 720))
            }
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val PREFS = "ningshingche_article_draft"
        private const val KEY_TITLE = "title"
        private const val KEY_CONTENT = "content"
        private const val KEY_HEIGHT = "editor_height"
    }
}
