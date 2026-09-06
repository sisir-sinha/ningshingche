package com.ningshingche.app.portal

import com.ningshingche.app.data.portal.IssueTags
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The database stores annual-issue tags as `নিংশিং চে - ২০২৩` while older
 * clients wrote `নিংশিং চে-২০২৩`; every spelling must collapse to one key so
 * the "বার্ষিক সংখ্যা" tab and tag chips find the same articles.
 */
class IssueTagsTest {

    @Test
    fun `every known spelling of an issue tag yields the same year`() {
        listOf(
            "নিংশিং চে - ২০২৩",
            "নিংশিং চে-২০২৩",
            "নিংশিং চে-2023",
            "নিংশিংচে-2023",
            "#নিংশিং চে – ২০২৩",
            "  নিংশিং   চে — 2023 "
        ).forEach { spelling ->
            assertEquals(spelling, 2023, IssueTags.issueYear(spelling))
            assertEquals(spelling, "নিংশিংচে-2023", IssueTags.keyOf(spelling))
        }
    }

    @Test
    fun `topic tags are not issues`() {
        assertNull(IssueTags.issueYear("৮ম সংখ্যা"))
        assertNull(IssueTags.issueYear("মণিপুরি ভাষা আন্দোলন"))
        assertFalse(IssueTags.isIssue("ইতিহাস"))
    }

    @Test
    fun `issue variants include the spelling stored in the database`() {
        val variants = IssueTags.issueVariants(2023)
        assertTrue(variants.contains("নিংশিং চে - ২০২৩"))
        assertTrue(variants.contains("নিংশিং চে-২০২৩"))
        assertTrue(variants.all { IssueTags.issueYear(it) == 2023 })
    }

    @Test
    fun `matches compares by key not by spelling`() {
        val tags = listOf("নিংশিং চে - ২০২৪", "৯ম সংখ্যা")
        assertTrue(IssueTags.matches(tags, "নিংশিং চে-২০২৪"))
        assertTrue(IssueTags.matches(tags, "৯ম  সংখ্যা"))
        assertTrue(IssueTags.matchesIssue(tags, 2024))
        assertFalse(IssueTags.matchesIssue(tags, 2023))
    }

    @Test
    fun `parseYear accepts bare years in either digit system`() {
        assertEquals(2016, IssueTags.parseYear("২০১৬"))
        assertEquals(2016, IssueTags.parseYear("2016"))
        assertEquals(2022, IssueTags.parseYear("নিংশিং চে - ২০২২"))
        assertNull(IssueTags.parseYear("কবিতা"))
    }

    @Test
    fun `labels use Bengali digits`() {
        assertEquals("নিংশিং চে-২০২৫", IssueTags.issueLabel(2025))
        assertEquals("২০", IssueTags.toBengaliDigits(20))
    }
}
