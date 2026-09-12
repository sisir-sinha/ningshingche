package com.ningshingche.app.data.portal

import java.net.URLDecoder

/**
 * What a forum body means once it is out of the editor: its words, its pictures,
 * and its documents.
 *
 * A post is HTML, and a post carries files. The app draws those files itself —
 * a picture as a small preview, a PDF as its icon and its name — because the
 * app's text renderer turns an `<img>` into the one character HtmlCompat uses
 * for "an object I cannot draw" (U+FFFC, which a reader sees as a boxed "obj")
 * and a bare PDF link is a URL where a document should be.
 *
 * So the body is asked two questions separately: [forumBodyText] is what is read
 * as text — attachment markup removed so nothing stands in for a picture — and
 * [forumBodyImages] / [forumBodyDocs] are what is drawn as attachments under it.
 *
 * The markup is the whole protocol between the two sides of the app: a picture
 * is `<p><img src="…" alt="…"></p>` and a document is `<p><a href="…">name</a></p>`,
 * appended by [forumWithAttachments] at the moment the post is sent. The
 * migration's `forum_plain_text()` strips exactly the same tags, so the database
 * and the screen agree on what the words of a post are.
 */

private val ANY_TAG = Regex("<[^>]*>")
private val IMAGE_TAG = Regex("<img[^>]*>", RegexOption.IGNORE_CASE)
private val IMAGE_SRC = Regex("src\\s*=\\s*[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)
private val ANCHOR = Regex(
    "<a\\s[^>]*href\\s*=\\s*[\"']([^\"']+)[\"'][^>]*>(.*?)</a>",
    setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL)
)
private val PDF_IN_URL = Regex("\\.pdf($|[?#])", RegexOption.IGNORE_CASE)
private val WHITESPACE = Regex("\\s+")

/**
 * The body as markup, with the attachments taken out.
 *
 * This is what the text renderer is given: bold, italic and lists stay where the
 * reader put them, and the `<img>`-as-"obj" and the bare PDF URL are gone,
 * because both are drawn by the app as attachments instead.
 */
fun forumBodyMarkup(html: String): String =
    html.replace(IMAGE_TAG, " ")
        .replace(ANCHOR) { match ->
            // A document's anchor is drawn as a chip, so its label is not part of
            // the sentence either.
            if (isPdfReference(match.groupValues[1], match.groupValues[2])) " " else match.value
        }

/** The words a reader reads: no tags, and no placeholder for what is attached. */
fun forumBodyText(html: String): String =
    decodeEntities(forumBodyMarkup(html).replace(ANY_TAG, " "))
        .replace(WHITESPACE, " ")
        .trim()

/**
 * The same question for the gates: is there anything to post, and is it long
 * enough to be worth a length limit? Attachment markup does not count as words.
 */
fun forumPlainText(html: String): String = forumBodyText(html)

/** Whether the editor holds anything at all, empty markup aside. */
fun forumHasText(html: String): Boolean = forumPlainText(html).isNotBlank()

/** The pictures a post carries, in the order they were attached. */
fun forumBodyImages(html: String): List<String> =
    IMAGE_TAG.findAll(html).mapNotNull { tag ->
        IMAGE_SRC.find(tag.value)?.groupValues?.get(1)?.let(::cleanUrl)?.takeIf { it.isNotBlank() }
    }.toList()

/** The documents a post carries: a PDF link is a document, whatever it looks like. */
fun forumBodyDocs(html: String): List<ForumAttachment> =
    ANCHOR.findAll(html).mapNotNull { match ->
        val url = cleanUrl(match.groupValues[1])
        val label = match.groupValues[2].replace(ANY_TAG, " ").trim()
        if (!isPdfReference(url, label)) return@mapNotNull null
        ForumAttachment.fromReference(url, label)
    }.toList()

/** Everything attached to a post, pictures first, then documents. */
fun forumBodyAttachments(html: String): List<ForumAttachment> =
    forumBodyImages(html).map { ForumAttachment.fromReference(it, "") } + forumBodyDocs(html)

/**
 * The post as it goes out: what was written, then what was attached.
 *
 * Nothing is ever inserted into the body while it is being written — an
 * attachment is added here, on its way to the database, which is why the reader
 * never has a picture in the middle of a sentence to tap into by accident.
 */
fun forumWithAttachments(body: String, attachments: List<ForumAttachment>): String {
    if (attachments.isEmpty()) return body
    val suffix = attachments.joinToString(separator = "") { attachment ->
        val url = attachment.url.replace("\"", "").trim()
        if (url.isBlank()) {
            ""
        } else if (attachment.isImage) {
            "<p><img src=\"$url\" alt=\"${attachment.label.replace("\"", "")}\"></p>"
        } else {
            "<p><a href=\"$url\">${attachment.label.replace("\"", "")}</a></p>"
        }
    }
    return body + suffix
}

/** A PDF is recognised by where it points or by what it is called. */
fun isPdfReference(url: String, label: String): Boolean =
    PDF_IN_URL.containsMatchIn(url) || label.trim().lowercase().endsWith(".pdf")

private fun cleanUrl(raw: String): String = runCatching {
    URLDecoder.decode(raw.trim(), "UTF-8")
}.getOrDefault(raw.trim())

private fun decodeEntities(text: String): String = text
    .replace("&nbsp;", " ")
    .replace("&amp;", "&")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&quot;", "\"")
    .replace("&#39;", "'")
