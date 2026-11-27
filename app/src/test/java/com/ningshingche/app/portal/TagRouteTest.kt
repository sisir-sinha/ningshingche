package com.ningshingche.app.portal

import com.ningshingche.app.ui.reader.ReaderRoute
import java.net.URLDecoder
import org.junit.Assert.*
import org.junit.Test

class TagRouteTest {
    @Test fun `topic tags are encoded as a tag route`() {
        val tag = " #৭ম সংখ্যা/ঐতিহ্য?x=1&y=+ "
        val route = ReaderRoute.forTag(tag)
        assertTrue(route.startsWith("tag/"))
        assertFalse(route.substringAfter("tag/").contains('/'))
        assertFalse(route.contains('?'))
        assertFalse(route.contains('#'))
        assertEquals(tag, URLDecoder.decode(route.substringAfter("tag/"), "UTF-8"))
    }

    @Test fun `annual issue tags keep their issue destination`() {
        assertEquals("issue/2023", ReaderRoute.forTag("নিংশিং চে - ২০২৩"))
        assertEquals("issue/2024", ReaderRoute.forTag("২০২৪"))
    }
}
