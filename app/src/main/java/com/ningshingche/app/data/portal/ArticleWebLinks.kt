package com.ningshingche.app.data.portal

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.text.Normalizer

/** The website uses published_date, or created_at only when published_date is null. */
fun websiteArticleUrl(slug: String, date: String): String? {
    val clean = Normalizer.normalize(slug.trim(), Normalizer.Form.NFC)
    val parts = Regex("^(\\d{4})-(\\d{2})-(\\d{2})").find(date)?.groupValues ?: return null
    val month = parts[2].toIntOrNull() ?: return null
    val day = parts[3].toIntOrNull() ?: return null
    if (clean.isBlank() || clean.contains('/') || clean.contains('\\') ||
        month !in 1..12 || day !in 1..31) return null
    val encoded = URLEncoder.encode(clean, "UTF-8").replace("+", "%20")
    return "https://ningshingche.com/${parts[1]}/${parts[2]}/$encoded.kehem"
}

/** Return only article identifiers for this site's current and legacy links. */
fun articleIdFromWebsiteUrl(url: String): String? {
    val uri = try { URI(url.trim()) } catch (_: Exception) { return null }
    if (uri.scheme?.lowercase() !in setOf("https", "http") ||
        !uri.host.equals("ningshingche.com", ignoreCase = true) || uri.userInfo != null) return null
    val segments = uri.rawPath.orEmpty().trim('/').split('/')
    val raw = when {
        segments.size == 3 && segments[0].matches(Regex("\\d{4}")) &&
            segments[1].matches(Regex("0[1-9]|1[0-2]")) && segments[2].endsWith(".kehem") ->
            segments[2].removeSuffix(".kehem")
        segments.size == 2 && segments[0] == "article" -> segments[1]
        else -> return null
    }
    val decoded = try { URLDecoder.decode(raw.replace("+", "%2B"), "UTF-8") } catch (_: Exception) { return null }
    return decoded.takeIf { it.isNotBlank() && !it.contains('/') && !it.contains('\\') }
}
