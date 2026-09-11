package com.ningshingche.app.portal

import com.ningshingche.app.data.portal.SearchQuery
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The reader's search filter, pinned to behaviour checked against the live
 * database rather than guessed:
 *
 *  - `or=(title.ilike."*মণিপুরী*",…)` returns rows, and `author_name.ilike`
 *    finds `মণিপুরী সংকীর্তন` by its author;
 *  - `tags.ilike.…` is rejected by Postgres (`42883` — the column is `text[]`),
 *    which is why tags are not in [SearchQuery.COLUMNS];
 *  - one pattern holding a space (`"*মণিপুরী ব্যান্ড*"`, what the app used to
 *    send) returns none, while two conditions find `বাংলাদেশে মণিপুরী যত ব্যান্ড`;
 *  - `content.ilike."*কমলগঞ্জ*"` finds three articles whose titles never mention
 *    it — which is why the body is searched;
 *  - an unquoted comma inside the expression is answered with `PGRST100`.
 */
class SearchQueryTest {

    @Test
    fun `a single word matches every searched column`() {
        val filter = SearchQuery.build("গান")!!
        assertEquals("or", filter.parameter)
        assertEquals(
            "(title.ilike.\"*গান*\",sub_title.ilike.\"*গান*\",slug.ilike.\"*গান*\"," +
                "author_name.ilike.\"*গান*\",content.ilike.\"*গান*\")",
            filter.value
        )
        assertTrue("the value must not repeat the parameter name", !filter.value.startsWith("or"))
        assertTrue("the body must be searched", filter.value.contains("content.ilike"))
        assertTrue("the author must be searched", filter.value.contains("author_name.ilike"))
        assertTrue("tags are text[] and cannot be ilike'd", !filter.value.contains("tags.ilike"))
    }

    @Test
    fun `several words become separate conditions, not one phrase`() {
        val filter = SearchQuery.build("মণিপুরী ব্যান্ড")!!
        assertEquals("and", filter.parameter)
        assertTrue(filter.value.startsWith("(")) // "(or(…),or(…))"
        assertTrue(filter.value.startsWith("(or("))
        assertTrue(filter.value.contains("or(title.ilike.\"*মণিপুরী*\""))
        assertTrue(filter.value.contains("or(title.ilike.\"*ব্যান্ড*\""))
        assertEquals(2, filter.value.split("title.ilike").size - 1)
    }

    @Test
    fun `extra whitespace and empty words are dropped`() {
        val filter = SearchQuery.build("   মণিপুরী   ব্যান্ড  ")!!
        assertEquals(2, filter.value.split("or(").size - 1)
        assertEquals("and", filter.parameter)
    }

    @Test
    fun `more than four words are capped`() {
        val filter = SearchQuery.build("এক দুই তিন চার পাঁচ ছয়")!!
        assertEquals(SearchQuery.MAX_TERMS, filter.value.split("or(").size - 1)
    }

    @Test
    fun `punctuation in the reader's text is quoted, not left to break the filter`() {
        // Without the quotes this is the request PostgREST answers with PGRST100.
        val filter = SearchQuery.build("গান, নাটক")!!
        assertTrue(filter.value.contains("\"*গান,*\""))
        assertTrue(filter.value.contains("\"*নাটক*\""))
        val brackets = SearchQuery.build("(গান)")!!
        assertTrue(brackets.value.contains("\"*(গান)*\""))
    }

    @Test
    fun `a quote typed by the reader is escaped inside the pattern`() {
        val filter = SearchQuery.build("গান\"নাটক")!!
        assertTrue(filter.value.contains("\\\""))
        assertEquals("\"*a\\\"b*\"", SearchQuery.likeValue("a\"b"))
        assertEquals("\"*a\\\\b*\"", SearchQuery.likeValue("a\\b"))
    }

    @Test
    fun `too short a query builds nothing`() {
        assertNull(SearchQuery.build(""))
        assertNull(SearchQuery.build(" "))
        assertNull(SearchQuery.build("গ"))
    }

    @Test
    fun `the value is percent-encoded for transport, spaces as %20`() {
        val encoded = SearchQuery.encode(SearchQuery.build("মণিপুরী ব্যান্ড")!!.value)
        // Java's URLEncoder leaves `.`, `-`, `*` and `_` alone, so the wildcards
        // travel raw and PostgREST reads them as wildcards.
        // "(or(title.ilike."*মণিপুরী*",…),or(…))" once percent-encoded.
        assertTrue(encoded.startsWith("%28or%28title.ilike.%22*"))
        assertTrue("no plus signs in a PostgREST filter", !encoded.contains("+"))
        assertTrue(encoded.contains("%20"))
        assertTrue("wildcards survive encoding", encoded.contains("*"))
        assertTrue("quotes travel encoded", encoded.contains("%22"))
    }
}
