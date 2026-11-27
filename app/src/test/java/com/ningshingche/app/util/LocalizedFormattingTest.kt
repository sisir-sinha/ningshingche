package com.ningshingche.app.util

import com.ningshingche.app.data.model.ContentLanguage
import java.util.TimeZone
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class LocalizedFormattingTest {
    private val original = TimeZone.getDefault()
    private val en = ContentLanguage.ENGLISH
    private val bn = ContentLanguage.BENGALI

    @Before fun setUp() { TimeZone.setDefault(TimeZone.getTimeZone("UTC")) }
    @After fun tearDown() { TimeZone.setDefault(original) }

    @Test fun datesFollowLanguageWhenSwitchedRepeatedly() {
        assertEquals("27 July, 2025", LocalizedFormatting.date("2025-07-27", en))
        val bengali = LocalizedFormatting.date("2025-07-27", bn)
        assertTrue(bengali.contains("জুলাই"))
        assertTrue(bengali.contains("২০২৫"))
        assertEquals("27 July, 2025", LocalizedFormatting.date("2025-07-27", en))
        assertEquals("27 July, 2025", LocalizedFormatting.date("২৭ জুলাই, ২০২৫", en))
        assertEquals("", LocalizedFormatting.date("", en))
    }

    @Test fun clockUsesOffsetAndDeviceTimeZone() {
        assertEquals("12 September, 3:45 PM", LocalizedFormatting.dateTime("2026-09-12T15:45:00Z", en))
        assertEquals("12 September, 3:45 PM", LocalizedFormatting.dateTime("2026-09-12T21:15:00+05:30", en))
        assertEquals("12 September, 3:45 PM", LocalizedFormatting.dateTime("2026-09-12T21:45:00+0600", en))
        assertEquals("12 September, 3:45 PM", LocalizedFormatting.dateTime("2026-09-12T21:45:00+06", en))
        val bengali = LocalizedFormatting.dateTime("2026-09-12T15:45:00.111+00:00", bn)
        assertTrue(bengali.contains("সেপ্টেম্বর"))
        assertTrue(bengali.contains("৩:৪৫"))
        assertTrue(bengali.contains("অপরাহ্ণ"))
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Dhaka"))
        assertEquals("12 September, 9:45 PM", LocalizedFormatting.dateTime("2026-09-12T15:45:00Z", en))
    }

    @Test fun numbersFollowLanguageWithoutChangingOtherText() {
        assertEquals("1 / 2026", LocalizedFormatting.digits("১ / ২০২৬", en))
        assertEquals("১ / ২০২৬", LocalizedFormatting.digits("1 / 2026", bn))
        assertEquals("১ / ২০২৬", LocalizedFormatting.digits("1 / 2026", ContentLanguage.BISHNUPRIYA))
        assertEquals("0", LocalizedFormatting.digits("০", en))
    }
}
