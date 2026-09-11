package com.ningshingche.app.data.i18n

import android.content.Context
import com.ningshingche.app.data.model.ContentLanguage
import com.ningshingche.app.data.remote.SupabaseConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * The interface language files, fetched from the dashboard and cached on disk.
 *
 * The dashboard (`Languages` page) writes one `key,value` CSV per language into
 * `public.app_language_files`; this class asks for the language the reader
 * picked, stores the CSV under `filesDir/i18n/`, and hands the parsed table to
 * the UI. Keys are the Bengali strings written in the app, so a language file
 * only has to translate what it knows — anything absent stays Bengali.
 *
 * Order of business: the cached table is available immediately (offline first),
 * then a refresh replaces it when the server copy is newer.
 *
 * Bengali is fetched like the other languages. Its file is empty until an editor
 * rewrites a word on the dashboard's Languages page, and until then every lookup
 * misses and the app shows the string it was compiled with — so the file costs
 * one request and changes nothing. Once a row is there (`লেখক` -> `লেখকবৃন্দ`)
 * the app shows the rewritten wording for that key, which is how the Bengali
 * column becomes editable without the lookup ever depending on it.
 */
class TranslationRepository(context: Context) {

    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val flows = ConcurrentHashMap<ContentLanguage, MutableStateFlow<Map<String, String>>>()
    private val loaded = ConcurrentHashMap<ContentLanguage, Boolean>()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    /** The parsed table for [language]; fills itself from cache, then the network. */
    fun strings(language: ContentLanguage): StateFlow<Map<String, String>> {
        val flow = flows.getOrPut(language) { MutableStateFlow<Map<String, String>>(emptyMap()) }
        if (loaded.putIfAbsent(language, true) == null) {
            scope.launch {
                val cached = readCache(language)
                if (cached.isNotEmpty()) flow.value = cached
                refresh(language)
            }
        }
        // The same instance every call: Compose keys its collection on the flow,
        // so a fresh wrapper per recomposition would re-subscribe every frame.
        return flow
    }

    /** Forces a fetch — used by the language switch and the Settings refresh. */
    suspend fun refresh(language: ContentLanguage): Result<Map<String, String>> =
        fetch(language).onSuccess { table ->
            flows.getOrPut(language) { MutableStateFlow<Map<String, String>>(emptyMap()) }.value = table
        }

    private suspend fun fetch(language: ContentLanguage): Result<Map<String, String>> =
        withContext(Dispatchers.IO) {
            val url = "${SupabaseConfig.restBaseUrl}/app_language_files" +
                "?select=csv&lang=eq.${language.code()}"
            val request = Request.Builder()
                .url(url)
                .addHeader("apikey", SupabaseConfig.supabaseKey)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.supabaseKey}")
                .addHeader("Accept", "application/json")
                .build()
            try {
                http.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        return@withContext Result.failure(Exception("ভাষা ফাইল আনা যায়নি (${response.code})।"))
                    }
                    val body = response.body?.string().orEmpty()
                    val csv = JSONArray(body).optJSONObject(0)?.optString("csv").orEmpty()
                    if (csv.isBlank()) {
                        // The row exists but nobody has published a file yet.
                        return@withContext Result.success(emptyMap())
                    }
                    val table = parseCsv(csv)
                    writeCache(language, csv)
                    Result.success(table)
                }
            } catch (error: Exception) {
                Result.failure(error)
            }
        }

    private fun cacheFile(language: ContentLanguage): File {
        val dir = File(appContext.filesDir, CACHE_DIR)
        if (!dir.exists()) dir.mkdirs()
        return File(dir, "${language.code()}.csv")
    }

    private val memory = ConcurrentHashMap<ContentLanguage, Map<String, String>>()

    private fun readCache(language: ContentLanguage): Map<String, String> {
        memory[language]?.let { return it }
        val file = cacheFile(language)
        if (!file.exists()) return emptyMap()
        val table = runCatching { parseCsv(file.readText(Charsets.UTF_8)) }.getOrDefault(emptyMap())
        memory[language] = table
        return table
    }

    private fun writeCache(language: ContentLanguage, csv: String) {
        runCatching {
            cacheFile(language).writeText(csv, Charsets.UTF_8)
            memory.remove(language)
        }
    }

    companion object {
        private const val CACHE_DIR = "i18n"

        /**
         * `key,value` CSV with quoted fields, as written by the dashboard.
         * Keys are unique; a later row wins, matching the dashboard's own rule.
         */
        fun parseCsv(text: String): Map<String, String> {
            val rows = splitCsv(text)
            if (rows.isEmpty()) return emptyMap()
            val table = LinkedHashMap<String, String>(rows.size)
            rows.forEachIndexed { index, cells ->
                // The first row is the header unless it is the only row.
                if (index == 0 && cells.size >= 2 && cells[0].trim().equals("key", true)) return@forEachIndexed
                val key = cells.getOrNull(0)?.trim().orEmpty()
                if (key.isEmpty()) return@forEachIndexed
                val value = cells.drop(1).joinToString(",").trim()
                if (value.isEmpty()) return@forEachIndexed
                table[key] = value
            }
            return table
        }

        /** RFC4180-ish reader: quoted fields, doubled quotes, CRLF, embedded newlines. */
        private fun splitCsv(text: String): List<List<String>> {
            val clean = text.removePrefix("\uFEFF")
            val rows = ArrayList<List<String>>()
            var row = ArrayList<String>()
            val field = StringBuilder()
            var quoted = false
            var index = 0
            while (index < clean.length) {
                val char = clean[index]
                if (quoted) {
                    when {
                        char == '"' && clean.getOrNull(index + 1) == '"' -> {
                            field.append('"')
                            index++
                        }
                        char == '"' -> quoted = false
                        else -> field.append(char)
                    }
                } else {
                    when (char) {
                        '"' -> quoted = true
                        ',' -> {
                            row.add(field.toString())
                            field.setLength(0)
                        }
                        '\n' -> {
                            row.add(field.toString())
                            field.setLength(0)
                            rows.add(row)
                            row = ArrayList()
                        }
                        '\r' -> Unit
                        else -> field.append(char)
                    }
                }
                index++
            }
            if (field.isNotEmpty() || row.isNotEmpty()) {
                row.add(field.toString())
                rows.add(row)
            }
            return rows.filter { cells -> cells.any { it.isNotBlank() } }
        }
    }
}

/** The `lang` column value for a language. */
fun ContentLanguage.code(): String = when (this) {
    ContentLanguage.BENGALI -> "bn"
    ContentLanguage.ENGLISH -> "en"
    ContentLanguage.BISHNUPRIYA -> "bpy"
}
