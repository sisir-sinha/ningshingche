package com.ningshingche.app.i18n

import com.ningshingche.app.data.i18n.TranslationRepository
import com.ningshingche.app.data.model.ContentLanguage
import com.ningshingche.app.ui.i18n.TranslationTable
import com.ningshingche.app.ui.i18n.translate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The language file is edited in the dashboard and in spreadsheets, so the
 * reader has to survive quoting, CRLF, a BOM, embedded newlines and values that
 * are deliberately left blank. Blank means "not translated yet" — the key keeps
 * the app's own Bengali text — so those rows must be dropped rather than
 * resolved to an empty string.
 *
 * The dashboard's own reader is covered by backend/tests/languages.test.cjs;
 * both files are fed the same fixtures so the two implementations cannot drift.
 */
class TranslationCsvTest {

    private fun table(csv: String, language: ContentLanguage = ContentLanguage.BISHNUPRIYA) =
        TranslationTable(language, TranslationRepository.parseCsv(csv))

    @Test
    fun `header is skipped and plain pairs are read`() {
        val parsed = TranslationRepository.parseCsv("key,value\nগান,Elahan\nশিরোনাম,Title\n")
        assertEquals("Elahan", parsed["গান"])
        assertEquals("Title", parsed["শিরোনাম"])
        assertEquals(2, parsed.size)
    }

    @Test
    fun `quoted commas, doubled quotes and embedded newlines survive`() {
        val parsed = TranslationRepository.parseCsv(
            "key,value\n\"শিরোনাম, বই\",\"Title, book\"\n\"বলো \"\"হ্যাঁ\"\"\",\"say\nhello\"\n"
        )
        assertEquals("Title, book", parsed["শিরোনাম, বই"])
        assertEquals("say\nhello", parsed["বলো \"হ্যাঁ\""])
    }

    @Test
    fun `bom, CRLF and blank trailing lines are tolerated`() {
        val parsed = TranslationRepository.parseCsv("\uFEFFkey,value\r\nগান,Elahan\r\n\r\n")
        assertEquals(mapOf("গান" to "Elahan"), parsed)
    }

    @Test
    fun `a blank value means untranslated and falls back to Bengali`() {
        val csv = "key,value\nগান,\nনতুন,New\n"
        val parsed = TranslationRepository.parseCsv(csv)
        assertEquals(1, parsed.size)
        assertEquals("গান", translate(table(csv), "গান"))
        assertEquals("New", translate(table(csv), "নতুন"))
    }

    @Test
    fun `Bengali always resolves to the source text, table or not`() {
        val csv = "key,value\nগান,Elahan\n"
        val bengali = table(csv, ContentLanguage.BENGALI)
        assertEquals("গান", translate(bengali, "গান"))
        assertEquals("Elahan", translate(table(csv), "গান"))
    }

    @Test
    fun `numbered slots are filled from the call site`() {
        val csv = "key,value\nগান {1}টি,{1} songs\n"
        assertEquals("১২ songs", translate(table(csv), "গান {1}টি", "১২"))
    }

    @Test
    fun `a translation may reorder its values`() {
        val csv = "key,value\n{1} - {2},{2} — {1}\n"
        assertEquals("২০২৪ — নিংশিং চে", translate(table(csv), "{1} - {2}", "নিংশিং চে", "২০২৪"))
    }

    @Test
    fun `an unparsable file leaves the interface in Bengali`() {
        assertTrue(TranslationRepository.parseCsv("").isEmpty())
        assertTrue(TranslationRepository.parseCsv("\n\n").isEmpty())
        assertEquals("গান", translate(table("key,value\n"), "গান"))
    }

    @Test
    fun `later duplicate keys win, matching the dashboard`() {
        val parsed = TranslationRepository.parseCsv("key,value\nগান,First\nগান,Second\n")
        assertEquals("Second", parsed["গান"])
    }
}
