package com.example.data.ai

import com.example.BuildConfig
import com.example.data.model.AiChatMessage
import com.example.data.model.Article
import com.example.data.model.ArticleCitation
import com.example.data.model.Author
import com.example.data.model.Category
import com.example.data.model.PdfDocument
import com.example.data.portal.GalleryItem
import com.example.data.portal.PortalRepository
import com.example.data.portal.VideoItem
import com.example.data.repository.ArticleRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * The Ningshing Che AI Assistant.
 *
 * Highly capable, grounded AI scholar powered by gemini-3.5-flash with deep
 * specialization in Bishnupriya Manipuri language, literature, culture, history,
 * arts, personalities, and the Supabase digital archive.
 */
class NinghsingCheAiAssistant(
    private val repository: ArticleRepository,
    private val portalRepository: PortalRepository? = null
) {

    private val httpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    /**
     * Complete local knowledge snapshot loaded from Supabase database.
     */
    private data class Knowledge(
        val articles: List<Article>,
        val authors: List<Author>,
        val categories: List<Category>,
        val pdfs: List<PdfDocument>,
        val galleries: List<GalleryItem>,
        val videos: List<VideoItem>
    )

    suspend fun answerQuestion(
        userQuestion: String,
        history: List<AiChatMessage> = emptyList()
    ): AiChatMessage = withContext(Dispatchers.IO) {
        val query = userQuestion.trim()
        val knowledge = loadKnowledge()

        val tokens = tokenize(query)
        val ranked = rank(query, tokens, knowledge)

        val citations = ranked.map { (article, _) ->
            ArticleCitation(
                articleId = article.id,
                title = article.title,
                author = article.authorName,
                category = article.category,
                snippet = article.excerpt.ifBlank { article.content.take(160) }
            )
        }.distinctBy { it.articleId }

        // Try Gemini 3.5 Flash first, then fallback to OpenRouter API, then local archive reasoning
        var aiAnswer = tryCallGemini(query, ranked, knowledge, history)
        if (aiAnswer.isNullOrBlank()) {
            aiAnswer = tryCallOpenRouter(query, ranked, knowledge, history)
        }

        val rawAnswer = if (!aiAnswer.isNullOrBlank()) {
            aiAnswer
        } else if (ranked.isEmpty()) {
            buildNoInformation(query, knowledge)
        } else {
            buildAnswer(query, ranked, knowledge)
        }

        val (finalAnswer, suggestedFollowUps) = extractAnswerAndQuestions(
            rawText = rawAnswer,
            query = query,
            ranked = ranked,
            knowledge = knowledge
        )

        AiChatMessage(
            id = UUID.randomUUID().toString(),
            text = finalAnswer,
            isUser = false,
            timestamp = System.currentTimeMillis(),
            citations = citations,
            offerOnline = false,
            suggestedQuestions = suggestedFollowUps
        )
    }

    /**
     * Web-grounded query for external or live updates.
     */
    suspend fun answerOnline(userQuestion: String): AiChatMessage = withContext(Dispatchers.IO) {
        val query = userQuestion.trim()
        val onlineAnswer = tryCallGeminiWebSearch(query)

        val rawText = if (!onlineAnswer.isNullOrBlank()) {
            onlineAnswer
        } else {
            "দুঃখিত, অনলাইন থেকে তথ্য আনা যায়নি (AI কী কনফিগার করা নেই বা সংযোগ ব্যর্থ হয়েছে)। অনুগ্রহ করে পুনরায় চেষ্টা করুন।"
        }

        val knowledge = loadKnowledge()
        val tokens = tokenize(query)
        val ranked = rank(query, tokens, knowledge)
        val (finalAnswer, suggestedFollowUps) = extractAnswerAndQuestions(
            rawText = rawText,
            query = query,
            ranked = ranked,
            knowledge = knowledge
        )

        AiChatMessage(
            id = UUID.randomUUID().toString(),
            text = finalAnswer,
            isUser = false,
            timestamp = System.currentTimeMillis(),
            citations = emptyList(),
            offerOnline = false,
            suggestedQuestions = suggestedFollowUps
        )
    }

    // ------------------------------------------------------------------ knowledge

    private suspend fun loadKnowledge(): Knowledge {
        val articles = repository.getAllArticles().first()
        val live = articles.filter { !it.id.startsWith("art-") }
        val pool = if (live.isNotEmpty()) live else articles

        val authors = runCatching { repository.getAuthors() }.getOrDefault(emptyList())
        val categories = runCatching { repository.getCategories() }.getOrDefault(emptyList())
        val pdfs = runCatching { repository.getPdfDocuments() }.getOrDefault(emptyList())

        var galleries: List<GalleryItem> = emptyList()
        var videos: List<VideoItem> = emptyList()
        val portal = portalRepository
        if (portal != null) {
            runCatching { portal.galleries(limit = 30).getOrNull()?.items }
                .onSuccess { galleries = it.orEmpty() }
            runCatching { portal.videos(limit = 30).getOrNull() }
                .onSuccess { videos = it.orEmpty() }
        }

        return Knowledge(pool, authors, categories, pdfs, galleries, videos)
    }

    // ------------------------------------------------------------------ ranking

    private fun rank(
        query: String,
        tokens: List<String>,
        knowledge: Knowledge
    ): List<Pair<Article, Int>> {
        return knowledge.articles
            .map { article ->
                val points = score(article, tokens, query)
                article to points
            }
            .filter { it.second > 0 }
            .sortedWith(
                compareByDescending<Pair<Article, Int>> { it.second }
                    .thenByDescending { it.first.isFeatured }
            )
            .take(6)
    }

    private fun tokenize(query: String): List<String> {
        return query.lowercase()
            .split(Regex("""[\s,।.?!:;“”"'()\[\]{}]+"""))
            .map { it.trim() }
            .filter { it.length >= 2 }
            .distinct()
    }

    private fun score(article: Article, tokens: List<String>, raw: String): Int {
        val title = article.title
        val excerpt = article.excerpt
        val content = article.content
        val tags = article.tags.joinToString(" ")
        val meta = "${article.category} ${article.authorName} ${article.publishedDate}"
        var points = 0

        val q = raw.lowercase()
        val t = title.lowercase()
        if (t == q) points += 140
        else if (t.contains(q) || q.contains(t)) points += 80

        if (excerpt.contains(raw, ignoreCase = true)) points += 15
        if (tags.contains(raw, ignoreCase = true)) points += 12

        tokens.forEach { token ->
            if (title.contains(token, ignoreCase = true)) points += 10
            if (tags.contains(token, ignoreCase = true)) points += 6
            if (excerpt.contains(token, ignoreCase = true)) points += 4
            if (meta.contains(token, ignoreCase = true)) points += 3
            if (content.contains(token, ignoreCase = true)) points += 2
        }
        return points
    }

    // ------------------------------------------------------------------ gemini

    private fun geminiKey(): String {
        return runCatching { BuildConfig.GEMINI_API_KEY }.getOrNull().orEmpty()
    }

    private fun openRouterKey(): String {
        return runCatching { BuildConfig.OPENROUTER_API_KEY }.getOrNull().orEmpty()
    }

    private fun isKeyConfigured(key: String): Boolean =
        key.isNotBlank() && !key.startsWith("AIzaSyDummy") && !key.startsWith("sk-or-v1-dummy")

    private fun buildContextPrompt(
        query: String,
        ranked: List<Pair<Article, Int>>,
        knowledge: Knowledge
    ): String {
        val archiveContext = buildString {
            if (ranked.isNotEmpty()) {
                append("### নিংশিং চে ডাটাবেজের প্রাসঙ্গিক নিবন্ধসমূহ:\n")
                append(ranked.take(5).joinToString("\n---\n") { (article, _) ->
                    val bodySnippet = if (article.content.isNotBlank()) {
                        article.content.take(800)
                    } else {
                        article.excerpt
                    }
                    "**শিরোনাম:** ${article.title}\n" +
                        "**লেখক:** ${article.authorName}\n" +
                        "**বিভাগ:** ${article.category}\n" +
                        "**ট্যাগ:** ${article.tags.joinToString(", ")}\n" +
                        "**মূল পাঠ্যাংশ/সারসংক্ষেপ:** $bodySnippet"
                })
            }

            val relevantAuthors = knowledge.authors
                .filter { author -> query.contains(author.name, ignoreCase = true) || ranked.any { it.first.authorName == author.name } }
                .take(3)
            if (relevantAuthors.isNotEmpty()) {
                append("\n\n### সম্পর্কিত লেখক পরিচিতি:\n")
                append(relevantAuthors.joinToString("\n") {
                    "- **${it.name}**: ${it.designation} (${it.bio.take(150)})"
                })
            }

            val relevantPdfs = knowledge.pdfs
                .filter { pdf -> tokensMatched(pdf.title, query) }
                .take(3)
            if (relevantPdfs.isNotEmpty()) {
                append("\n\n### সংশ্লিষ্ট বই/ই-বুক তালিকা:\n")
                append(relevantPdfs.joinToString("\n") {
                    "- **${it.title}** (লেখক/সম্পাদক: ${it.authorOrEditor}, প্রকাশকাল: ${it.year})"
                })
            }
        }

        return buildString {
            if (archiveContext.isNotBlank()) {
                append(archiveContext)
                append("\n\n---\n")
            }
            append("ব্যবহারকারীর প্রশ্ন: $query")
        }
    }

    private val systemInstructionText = """
        You are 'Ninghsing Che AI' (নিংশিং চে এআই), a highly capable, knowledgeable, and trained AI expert specializing in Bishnupriya Manipuri language, literature, culture, history, heritage, arts, personalities, festivals, and general knowledge.

        Guidelines for your responses:
        1. Provide comprehensive, deeply informative, and intellectually rich answers in elegant Bengali.
        2. Structure your response clearly using clean Markdown formatting with headers (###), bold key terms, organized bullet points, and numbered lists where suitable.
        3. When relevant archive articles or authors are provided in the context, synthesize their facts accurately and cite them seamlessly (e.g. সূত্র: "প্রবন্ধের শিরোনাম" — লেখক: লেখকের নাম).
        4. If the question asks about Bishnupriya Manipuri culture (e.g., Inchaughar, Minkou, Language Movement, Sudeshna Sinha, Bishu festival, Rasleela, poetry, folklore, grammar), deliver a thorough, historically accurate, and culturally authentic explanation.
        5. If the question is a general knowledge, translation, literary, or analytical inquiry, answer it with full depth, accuracy, and clarity.
        6. Do NOT start your reply with repetitive self-introductions (e.g. "আমি নিংশিং চে AI..."). Dive straight into the authoritative, well-reasoned answer.
        7. At the very end of your response, provide 2 to 3 insightful, concise follow-up questions in Bengali that the user can tap to explore further. Format them at the end under:
        ### সম্পর্কিত জিজ্ঞাসা:
        - [প্রথম প্রাসঙ্গিক প্রশ্ন]
        - [দ্বিতীয় প্রাসঙ্গিক প্রশ্ন]
        - [তৃতীয় প্রাসঙ্গিক প্রশ্ন]
    """.trimIndent()

    /**
     * Primary grounded reasoning call to Gemini 3.5 Flash.
     */
    private fun tryCallGemini(
        query: String,
        ranked: List<Pair<Article, Int>>,
        knowledge: Knowledge,
        history: List<AiChatMessage>
    ): String? {
        val apiKey = geminiKey()
        if (!isKeyConfigured(apiKey)) return null

        return try {
            val endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=$apiKey"
            val userPromptWithContext = buildContextPrompt(query, ranked, knowledge)

            // Build multi-turn conversational contents
            val contentsArray = JSONArray()

            val recentHistory = history
                .filter { it.id != "welcome" }
                .takeLast(6)

            recentHistory.forEach { msg ->
                val role = if (msg.isUser) "user" else "model"
                contentsArray.put(JSONObject().apply {
                    put("role", role)
                    put("parts", JSONArray().apply {
                        put(JSONObject().apply {
                            put("text", msg.text)
                        })
                    })
                })
            }

            // Append current prompt
            contentsArray.put(JSONObject().apply {
                put("role", "user")
                put("parts", JSONArray().apply {
                    put(JSONObject().apply {
                        put("text", userPromptWithContext)
                    })
                })
            })

            val jsonBody = JSONObject().apply {
                put("contents", contentsArray)
                put("systemInstruction", JSONObject().apply {
                    put("parts", JSONArray().apply {
                        put(JSONObject().apply {
                            put("text", systemInstructionText)
                        })
                    })
                })
                put("generationConfig", JSONObject().apply {
                    put("temperature", 0.6)
                    put("topP", 0.95)
                })
            }

            val request = Request.Builder()
                .url(endpoint)
                .post(jsonBody.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val jsonResponse = JSONObject(response.body?.string().orEmpty())
                    val candidates = jsonResponse.optJSONArray("candidates")
                    val text = candidates?.optJSONObject(0)
                        ?.optJSONObject("content")
                        ?.optJSONArray("parts")
                        ?.optJSONObject(0)
                        ?.optString("text")
                    text?.takeIf { it.isNotBlank() }?.trim()
                } else null
            }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Fallback reasoning call to OpenRouter API (supports openrouter models e.g. google/gemini-2.0-flash-001 or meta-llama/llama-3.3-70b-instruct).
     */
    private fun tryCallOpenRouter(
        query: String,
        ranked: List<Pair<Article, Int>>,
        knowledge: Knowledge,
        history: List<AiChatMessage>
    ): String? {
        val apiKey = openRouterKey()
        if (!isKeyConfigured(apiKey)) return null

        return try {
            val endpoint = "https://openrouter.ai/api/v1/chat/completions"
            val userPromptWithContext = buildContextPrompt(query, ranked, knowledge)

            val messagesArray = JSONArray()

            // System prompt
            messagesArray.put(JSONObject().apply {
                put("role", "system")
                put("content", systemInstructionText)
            })

            val recentHistory = history
                .filter { it.id != "welcome" }
                .takeLast(6)

            recentHistory.forEach { msg ->
                messagesArray.put(JSONObject().apply {
                    put("role", if (msg.isUser) "user" else "assistant")
                    put("content", msg.text)
                })
            }

            // User prompt with context
            messagesArray.put(JSONObject().apply {
                put("role", "user")
                put("content", userPromptWithContext)
            })

            val jsonBody = JSONObject().apply {
                put("model", "google/gemini-2.0-flash-001")
                put("messages", messagesArray)
                put("temperature", 0.6)
                put("max_tokens", 1500)
            }

            val request = Request.Builder()
                .url(endpoint)
                .addHeader("Authorization", "Bearer $apiKey")
                .addHeader("HTTP-Referer", "https://ningshingche.com")
                .addHeader("X-Title", "Ninghsing Che App")
                .post(jsonBody.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val jsonResponse = JSONObject(response.body?.string().orEmpty())
                    val choices = jsonResponse.optJSONArray("choices")
                    val message = choices?.optJSONObject(0)?.optJSONObject("message")
                    val text = message?.optString("content")
                    text?.takeIf { it.isNotBlank() }?.trim()
                } else null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun tokensMatched(text: String, query: String): Boolean {
        val qTokens = tokenize(query)
        return qTokens.any { token -> text.contains(token, ignoreCase = true) }
    }

    /** General-knowledge answer with Google web-search grounding. */
    private fun tryCallGeminiWebSearch(query: String): String? {
        val apiKey = geminiKey()
        if (!isKeyConfigured(apiKey)) return null

        return try {
            val endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=$apiKey"

            val jsonBody = JSONObject().apply {
                put("contents", JSONArray().apply {
                    put(JSONObject().apply {
                        put("role", "user")
                        put("parts", JSONArray().apply {
                            put(JSONObject().apply {
                                put("text", query)
                            })
                        })
                    })
                })
                put("tools", JSONArray().apply {
                    put(JSONObject().apply {
                        put("googleSearch", JSONObject())
                    })
                })
                put("systemInstruction", JSONObject().apply {
                    put("parts", JSONArray().apply {
                        put(JSONObject().apply {
                            put("text", "You are Ninghsing Che AI. Answer in articulate, natural Bengali with structured Markdown. Do not introduce yourself.")
                        })
                    })
                })
            }

            val request = Request.Builder()
                .url(endpoint)
                .post(jsonBody.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val jsonResponse = JSONObject(response.body?.string().orEmpty())
                    val candidates = jsonResponse.optJSONArray("candidates")
                    candidates?.optJSONObject(0)
                        ?.optJSONObject("content")
                        ?.optJSONArray("parts")
                        ?.optJSONObject(0)
                        ?.optString("text")
                        ?.takeIf { it.isNotBlank() }
                        ?.trim()
                } else null
            }
        } catch (_: Exception) {
            null
        }
    }

    // ------------------------------------------------------------------ fallback

    private fun buildAnswer(
        query: String,
        matches: List<Pair<Article, Int>>,
        knowledge: Knowledge
    ): String {
        val top = matches.first().first
        val snippet = top.content.ifBlank { top.excerpt }
            .replace(Regex("""\s+"""), " ")
            .take(450)
            .trim()
        val more = matches.drop(1).take(3).joinToString("\n") { (article, _) ->
            "• **${article.title}** — ${article.authorName} (${article.category})"
        }
        return buildString {
            append("### ${top.title}\n\n")
            if (snippet.isNotBlank()) {
                append(snippet)
                if (snippet.length >= 400) append("…")
                append("\n\n")
            }
            append("**লেখক:** ${top.authorName} | **বিভাগ:** ${top.category} | **প্রকাশকাল:** ${top.publishedDate}\n")
            if (more.isNotBlank()) {
                append("\n#### এই বিষয়ে আরও প্রাসঙ্গিক প্রবন্ধ:\n")
                append(more)
            }
            append("\n\n_নিচে তথ্যসূত্র কার্ড থেকে মূল প্রবন্ধ পড়তে পারেন।_")
        }
    }

    private fun buildNoInformation(
        query: String,
        knowledge: Knowledge
    ): String {
        val cats = knowledge.categories
            .take(6)
            .joinToString(" • ") { "${it.name} (${it.articleCount})" }
        return """
            এই প্রশ্নের ("$query") সাথে সরাসরি সম্পর্কিত কোনো প্রবন্ধ ডাটাবেজে চিহ্নিত করা যায়নি।

            বর্তমানে নিংশিং চে ডাটাবেজে **${knowledge.articles.size}টি প্রবন্ধ**, **${knowledge.authors.size}জন লেখক**, **${knowledge.pdfs.size}টি PDF বই**, এবং বহু ফটো-ভিডিও আর্কাইভ সংরক্ষিত আছে।

            **প্রধান বিভাগসমূহ:** ${cats.ifBlank { "সাধারণ" }}

            আপনি চাইলে কোনো নির্দিষ্ট লেখক, উৎসব (যেমন বিষু, রাস), ভাষা আন্দোলন, ঐতিহ্য বা প্রবন্ধের শিরোনাম দিয়ে প্রশ্ন করতে পারেন।
        """.trimIndent()
    }

    private fun extractAnswerAndQuestions(
        rawText: String,
        query: String,
        ranked: List<Pair<Article, Int>>,
        knowledge: Knowledge
    ): Pair<String, List<String>> {
        val headers = listOf(
            "### সম্পর্কিত জিজ্ঞাসা:",
            "### সম্পর্কিত প্রশ্ন:",
            "### সম্পর্কিত প্রশ্নসমূহ:",
            "**সম্পর্কিত জিজ্ঞাসা:**",
            "**সম্পর্কিত প্রশ্ন:**",
            "সম্পর্কিত জিজ্ঞাসা:",
            "সম্পর্কিত প্রশ্ন:"
        )

        var splitIndex = -1
        var matchedHeader = ""
        for (header in headers) {
            val idx = rawText.indexOf(header)
            if (idx != -1 && (splitIndex == -1 || idx < splitIndex)) {
                splitIndex = idx
                matchedHeader = header
            }
        }

        val questions = mutableListOf<String>()
        val cleanAnswer: String

        if (splitIndex != -1) {
            cleanAnswer = rawText.substring(0, splitIndex).trim()
            val questionsSection = rawText.substring(splitIndex + matchedHeader.length).trim()
            val lines = questionsSection.lines()
            for (line in lines) {
                val trimmed = line.trim()
                if (trimmed.startsWith("-") || trimmed.startsWith("•") || trimmed.startsWith("*")) {
                    val q = trimmed.drop(1).trim().removeSurrounding("**").removeSurrounding("\"").trim()
                    if (q.isNotBlank() && q.length > 4 && q !in questions) {
                        questions.add(q)
                    }
                } else if (trimmed.matches(Regex("""^\d+[\.\)]\s*.*"""))) {
                    val q = trimmed.replace(Regex("""^\d+[\.\)]\s*"""), "").trim().removeSurrounding("**").removeSurrounding("\"").trim()
                    if (q.isNotBlank() && q.length > 4 && q !in questions) {
                        questions.add(q)
                    }
                }
            }
        } else {
            cleanAnswer = rawText.trim()
        }

        if (questions.isEmpty()) {
            questions.addAll(generateFallbackQuestions(query, ranked, knowledge))
        }

        return Pair(cleanAnswer, questions.take(3))
    }

    private fun generateFallbackQuestions(
        query: String,
        ranked: List<Pair<Article, Int>>,
        knowledge: Knowledge
    ): List<String> {
        val qLower = query.lowercase()
        val list = mutableListOf<String>()

        if (qLower.contains("ইঞ্চৌঘর") || qLower.contains("ঘর") || qLower.contains("গৃহ") || qLower.contains("বাড়ি")) {
            list.add("ঐতিহ্যবাহী ইঞ্চৌঘরের বিভিন্ন অংশের নাম ও সামাজিক তাৎপর্য কী?")
            list.add("ইঞ্চৌঘরের স্থাপত্যরীতিতে বাঁশ ও কাঠের ব্যবহার কীভাবে হয়?")
            list.add("আধুনিক যুগে মণিপুরি ইঞ্চৌঘরের ঐতিহ্য কীভাবে সংরক্ষিত হচ্ছে?")
        } else if (qLower.contains("সুদেষ্ণা") || qLower.contains("ভাষা আন্দোলন") || qLower.contains("১৬ মার্চ") || qLower.contains("শহীদ")) {
            list.add("১৯৯৬ সালের ১৬ মার্চের ভাষা আন্দোলনের পটভূমি কী ছিল?")
            list.add("শহীদ সুদেষ্ণা সিংহ ছাড়া আর কারা ভাষা আন্দোলনে ভূমিকা রেখেছিলেন?")
            list.add("বিষ্ণুপ্রিয়া মণিপুরি ভাষার সাংবিধানিক স্বীকৃতির ইতিহাস কী?")
        } else if (qLower.contains("মিংকৌ") || qLower.contains("নাম") || qLower.contains("ডাকনাম")) {
            list.add("বিষ্ণুপ্রিয়া মণিপুরি সমাজে মিংকৌ নাম রাখার নিয়মাবলী কী?")
            list.add("মিংকৌ এবং মূল নামের মধ্যে সামাজিক পার্থক্য ও প্রয়োগ কী?")
            list.add("প্রাচীনকালের কিছু জনপ্রিয় ঐতিহাসিক মিংকৌ নাম কী কী?")
        } else if (qLower.contains("রাস") || qLower.contains("রাসলীলা") || qLower.contains("নৃত্য") || qLower.contains("মহারাস")) {
            list.add("মহারাস, নিত্যরাস ও রাখাল রাসের মধ্যে পার্থক্য কী?")
            list.add("মণিপুরি রাসলীলায় গোপী ও কৃষ্ণের বেশভূষার বৈশিষ্ট্য কী?")
            list.add("রাস উৎসবে ব্যবহৃত মণিপুরি মৃদঙ্গ ও খোল বাদ্যযন্ত্রের বিশেষত্ব কী?")
        } else if (qLower.contains("বিশু") || qLower.contains("উৎসব") || qLower.contains("সংক্রান্তি")) {
            list.add("বিশু উৎসবে ঐতিহ্যবাহী খাদ্যাভ্যাস ও পোশাক কেমন হয়?")
            list.add("বিষ্ণুপ্রিয়া মণিপুরিদের অন্যান্য প্রধান সামাজিক ও ধর্মীয় উৎসব কী কী?")
            list.add("বিশু উৎসবের উৎপত্তি ও পৌরাণিক তাৎপর্য কী?")
        } else if (ranked.isNotEmpty()) {
            val top = ranked.first().first
            if (top.title.isNotBlank()) {
                list.add("«${top.title}» সম্পর্কে আরও বিস্তারিত তথ্য জানা যাবে কি?")
            }
            if (top.authorName.isNotBlank() && top.authorName != "সম্পাদকীয়") {
                list.add("লেখক ${top.authorName}-এর অন্যান্য উল্লেখযোগ্য প্রবন্ধ ও গ্রন্থ কী কী?")
            }
            if (top.category.isNotBlank()) {
                list.add("${top.category} বিষয়ক অন্যান্য গবেষণা প্রবন্ধ কী কী আছে?")
            }
        }

        if (list.size < 2) {
            list.add("বিষ্ণুপ্রিয়া মণিপুরি ভাষা ও সাহিত্যের উৎপত্তি সম্পর্কে জানতে চাই")
            list.add("নিংশিং চে ডিজিটাল আর্কাইভে এ বিষয়ে আর কী কী তথ্য আছে?")
        }

        return list.distinct().take(3)
    }

    // ------------------------------------------------------------------ Article-Specific AI Q&A (Strictly Grounded)

    /**
     * Answers queries, generates summaries, and provides insights STRICTLY and EXCLUSIVELY
     * based on the provided article content.
     */
    suspend fun answerArticleSpecificQuestion(
        articleTitle: String,
        authorName: String,
        category: String,
        articleContentHtml: String,
        userQuestion: String,
        history: List<AiChatMessage> = emptyList()
    ): AiChatMessage = withContext(Dispatchers.IO) {
        val query = userQuestion.trim()
        val plainTextContent = cleanHtmlToPlainText(articleContentHtml)

        var aiAnswer = tryCallGeminiForArticle(articleTitle, authorName, category, plainTextContent, query, history)
        if (aiAnswer.isNullOrBlank()) {
            aiAnswer = tryCallOpenRouterForArticle(articleTitle, authorName, category, plainTextContent, query, history)
        }

        val rawAnswer = if (!aiAnswer.isNullOrBlank()) {
            aiAnswer
        } else {
            buildArticleLocalFallback(articleTitle, authorName, category, plainTextContent, query)
        }

        val (finalAnswer, suggestedFollowUps) = extractAnswerAndQuestions(
            rawText = rawAnswer,
            query = query,
            ranked = emptyList(),
            knowledge = Knowledge(emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyList())
        )

        AiChatMessage(
            id = UUID.randomUUID().toString(),
            text = finalAnswer,
            isUser = false,
            timestamp = System.currentTimeMillis(),
            citations = listOf(
                ArticleCitation(
                    articleId = "",
                    title = articleTitle,
                    author = authorName,
                    category = category,
                    snippet = plainTextContent.take(220)
                )
            ),
            suggestedFollowUps = if (suggestedFollowUps.isNotEmpty()) suggestedFollowUps else listOf(
                "এই নিবন্ধের মূল বার্তা বা সিদ্ধান্ত কী?",
                "নিবন্ধটিতে উল্লেখিত গুরুত্বপূর্ণ বিষয়গুলো সংক্ষেপে লিখুন",
                "লেখক এখানে কোন কোন দিককে বেশি গুরুত্ব দিয়েছেন?"
            )
        )
    }

    private fun cleanHtmlToPlainText(html: String): String {
        return html
            .replace(Regex("<style[^>]*>.*?</style>", RegexOption.DOT_MATCHES_ALL), " ")
            .replace(Regex("<script[^>]*>.*?</script>", RegexOption.DOT_MATCHES_ALL), " ")
            .replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n")
            .replace(Regex("</p>", RegexOption.IGNORE_CASE), "\n\n")
            .replace(Regex("</li>", RegexOption.IGNORE_CASE), "\n")
            .replace(Regex("<h[1-6][^>]*>(.*?)</h[1-6]>", RegexOption.IGNORE_CASE), "\n\n### $1\n")
            .replace(Regex("<[^>]*>"), " ")
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace(Regex("\\n\\s*\\n+"), "\n\n")
            .trim()
    }

    private fun buildArticleSystemInstruction(
        articleTitle: String,
        authorName: String,
        category: String
    ): String {
        return """
            You are 'Ninghsing Che Article AI' (নিবন্ধ এআই সহায়িকা).
            You are an expert reading assistant strictly analyzing the specific article titled: "$articleTitle" by "$authorName" (Category: $category).

            STRICT MANDATES:
            1. You MUST formulate all answers STRICTLY and EXCLUSIVELY based on the text and facts provided in this specific article.
            2. Provide rich, highly structured, and elegant responses in Bengali using clean Markdown formatting (bold terms, bullet points, headers).
            3. If the user asks for a summary ("সারসংক্ষেপ"), provide a well-organized breakdown including:
               - **মূল প্রতিপাদ্য:** (Core Theme)
               - **প্রধান আলোচনাসমূহ:** (Key Discussion Points in bullet points)
               - **সিদ্ধান্ত ও তাৎপর্য:** (Conclusion & Takeaway)
            4. If the user asks a question whose answer is NOT mentioned or cannot be derived from this article, politely and clearly state:
               "এই নিবন্ধে এই বিষয়ে কোনো তথ্য উল্লেখ করা হয়নি। নিংশিং চে মূল এআই সহায়িকায় প্রশ্নটি জিজ্ঞাসা করতে পারেন।"
            5. Never hallucinate, extrapolate, or invent external facts not present in this article.
            6. At the very end, include 2 to 3 relevant follow-up questions about this article formatted as:
            ### সম্পর্কিত জিজ্ঞাসা:
            - [প্রথম প্রাসঙ্গিক প্রশ্ন]
            - [দ্বিতীয় প্রাসঙ্গিক প্রশ্ন]
        """.trimIndent()
    }

    private fun tryCallGeminiForArticle(
        articleTitle: String,
        authorName: String,
        category: String,
        plainTextContent: String,
        query: String,
        history: List<AiChatMessage>
    ): String? {
        val apiKey = geminiKey()
        if (!isKeyConfigured(apiKey)) return null

        return try {
            val endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=$apiKey"
            val systemInstruction = buildArticleSystemInstruction(articleTitle, authorName, category)

            val contextAndPrompt = buildString {
                append("### মূল নিবন্ধের পাঠ্যাংশ:\n")
                append("**শিরোনাম:** $articleTitle\n")
                append("**লেখক:** $authorName\n")
                append("**বিভাগ:** $category\n\n")
                append(plainTextContent.take(12000))
                append("\n\n---\n")
                append("ব্যবহারকারীর প্রশ্ন / নির্দেশ: $query")
            }

            val contentsArray = JSONArray()
            val recentHistory = history
                .filter { it.id != "welcome" }
                .takeLast(4)

            recentHistory.forEach { msg ->
                val role = if (msg.isUser) "user" else "model"
                contentsArray.put(JSONObject().apply {
                    put("role", role)
                    put("parts", JSONArray().apply {
                        put(JSONObject().apply {
                            put("text", msg.text)
                        })
                    })
                })
            }

            contentsArray.put(JSONObject().apply {
                put("role", "user")
                put("parts", JSONArray().apply {
                    put(JSONObject().apply {
                        put("text", contextAndPrompt)
                    })
                })
            })

            val jsonBody = JSONObject().apply {
                put("contents", contentsArray)
                put("systemInstruction", JSONObject().apply {
                    put("parts", JSONArray().apply {
                        put(JSONObject().apply {
                            put("text", systemInstruction)
                        })
                    })
                })
                put("generationConfig", JSONObject().apply {
                    put("temperature", 0.3) // Lower temperature for grounded factual Q&A
                    put("topP", 0.95)
                })
            }

            val request = Request.Builder()
                .url(endpoint)
                .post(jsonBody.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val jsonResponse = JSONObject(response.body?.string().orEmpty())
                    val candidates = jsonResponse.optJSONArray("candidates")
                    val text = candidates?.optJSONObject(0)
                        ?.optJSONObject("content")
                        ?.optJSONArray("parts")
                        ?.optJSONObject(0)
                        ?.optString("text")
                    text?.takeIf { it.isNotBlank() }?.trim()
                } else null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun tryCallOpenRouterForArticle(
        articleTitle: String,
        authorName: String,
        category: String,
        plainTextContent: String,
        query: String,
        history: List<AiChatMessage>
    ): String? {
        val apiKey = openRouterKey()
        if (!isKeyConfigured(apiKey)) return null

        return try {
            val endpoint = "https://openrouter.ai/api/v1/chat/completions"
            val systemInstruction = buildArticleSystemInstruction(articleTitle, authorName, category)

            val contextAndPrompt = buildString {
                append("### মূল নিবন্ধের পাঠ্যাংশ:\n")
                append("**শিরোনাম:** $articleTitle\n")
                append("**লেখক:** $authorName\n")
                append("**বিভাগ:** $category\n\n")
                append(plainTextContent.take(12000))
                append("\n\n---\n")
                append("ব্যবহারকারীর প্রশ্ন / নির্দেশ: $query")
            }

            val messagesArray = JSONArray()
            messagesArray.put(JSONObject().apply {
                put("role", "system")
                put("content", systemInstruction)
            })

            val recentHistory = history
                .filter { it.id != "welcome" }
                .takeLast(4)

            recentHistory.forEach { msg ->
                messagesArray.put(JSONObject().apply {
                    put("role", if (msg.isUser) "user" else "assistant")
                    put("content", msg.text)
                })
            }

            messagesArray.put(JSONObject().apply {
                put("role", "user")
                put("content", contextAndPrompt)
            })

            val jsonBody = JSONObject().apply {
                put("model", "google/gemini-2.0-flash-001")
                put("messages", messagesArray)
                put("temperature", 0.3)
            }

            val request = Request.Builder()
                .url(endpoint)
                .addHeader("Authorization", "Bearer $apiKey")
                .post(jsonBody.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val jsonResponse = JSONObject(response.body?.string().orEmpty())
                    val choices = jsonResponse.optJSONArray("choices")
                    val message = choices?.optJSONObject(0)?.optJSONObject("message")
                    message?.optString("content")?.takeIf { it.isNotBlank() }?.trim()
                } else null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun buildArticleLocalFallback(
        articleTitle: String,
        authorName: String,
        category: String,
        plainText: String,
        query: String
    ): String {
        val q = query.lowercase()
        val isSummary = q.contains("সারসংক্ষেপ") || q.contains("summary") || q.contains("সংক্ষেপ") || q.contains("মূল বিষয়")
        val paragraphs = plainText.split("\n\n").map { it.trim() }.filter { it.length > 30 }

        return buildString {
            append("### «$articleTitle» — নিবন্ধ বিশ্লেষণ\n\n")
            if (authorName.isNotBlank()) {
                append("**লেখক:** $authorName")
                if (category.isNotBlank()) append(" • **বিভাগ:** $category")
                append("\n\n")
            }

            if (isSummary || paragraphs.size <= 2) {
                append("**নিবন্ধের মূল বার্তা ও সারসংক্ষেপ:**\n")
                if (paragraphs.isNotEmpty()) {
                    append(paragraphs.first())
                    append("\n\n")
                    if (paragraphs.size > 1) {
                        append("**গুরুত্বপূর্ণ অংশসমূহ:**\n")
                        paragraphs.drop(1).take(3).forEach { p ->
                            append("- ${p.take(220)}...\n")
                        }
                    }
                } else {
                    append(plainText.take(500))
                }
            } else {
                // Find best matching paragraphs
                val matchedParagraphs = paragraphs.filter { p ->
                    val pLow = p.lowercase()
                    query.split(" ").filter { it.length > 2 }.any { pLow.contains(it.lowercase()) }
                }

                if (matchedParagraphs.isNotEmpty()) {
                    append("**নিবন্ধ থেকে প্রাপ্ত প্রাসঙ্গিক অংশ:**\n\n")
                    matchedParagraphs.take(2).forEach { p ->
                        append("> $p\n\n")
                    }
                } else {
                    append("নিবন্ধের প্রথম অংশ থেকে প্রাপ্ত সারসংক্ষেপ:\n\n")
                    append(paragraphs.first())
                    append("\n\n")
                }
            }

            append("\n---\n*তথ্যসূত্র: নিংশিং চে ডিজিটাল আর্কাইভের «$articleTitle» নিবন্ধ*")
        }
    }
}

