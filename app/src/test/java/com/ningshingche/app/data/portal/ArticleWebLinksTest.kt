package com.ningshingche.app.data.portal

import org.junit.Assert.*
import org.junit.Test
import java.net.URI

class ArticleWebLinksTest {
    private val slug = "মণিপুরী-সংকীর্তন-ধনকৃষ্ণ-অধিকারী"

    @Test fun websiteArticleUsesPublishedYearMonthAndEncodedSlug() {
        val url = websiteArticleUrl(slug, "2025-08-11")!!
        val uri = URI(url)
        assertEquals("ningshingche.com", uri.host)
        assertEquals("/2025/08/$slug.kehem", uri.path)
        assertEquals(slug, articleIdFromWebsiteUrl(url))
        assertEquals(slug, articleIdFromWebsiteUrl("$url/?source=share#top"))
    }

    @Test fun missingOrInvalidMetadataDoesNotInventAnArticleLink() {
        assertNull(websiteArticleUrl("", "2025-08-11"))
        assertNull(websiteArticleUrl("article", ""))
        assertNull(websiteArticleUrl("article", "2025-13-11"))
        assertNull(websiteArticleUrl("folder/article", "2025-08-11"))
        assertEquals("/2024/02/test.kehem", URI(websiteArticleUrl("test", "2024-02-29T12:00:00Z")!!).path)
    }

    @Test fun parsesOnlyArticleLinksAndKeepsPlusSign() {
        assertEquals("a+b c", articleIdFromWebsiteUrl(websiteArticleUrl("a+b c", "2025-08-11")!!))
        assertEquals(slug, articleIdFromWebsiteUrl("https://ningshingche.com/article/$slug"))
        assertNull(articleIdFromWebsiteUrl("https://example.org/2025/08/test.kehem"))
        assertNull(articleIdFromWebsiteUrl("https://ningshingche.com/category/poetry"))
        assertNull(articleIdFromWebsiteUrl("https://ningshingche.com/2025/13/test.kehem"))
        assertNull(articleIdFromWebsiteUrl("https://ningshingche.com/2025/08/test%2Fother.kehem"))
        assertNull(articleIdFromWebsiteUrl("https://user@ningshingche.com/2025/08/test.kehem"))
    }
}
