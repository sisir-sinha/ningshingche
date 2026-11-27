package com.ningshingche.app.data.remote

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfileCompletenessTest {
    private val profile = UserProfile(
        id = "reader", email = "reader@example.test", fullName = "A B",
        firstName = "A", lastName = "B", avatarUrl = "https://example.test/avatar",
        about = "About", phone = "123", address = "Address", designation = "Writer",
        facebookId = ""
    )

    @Test fun facebookIsOptionalAndIdentityIsRequired() {
        assertTrue(profile.isProfileComplete)
        assertTrue(profile.copy(facebookId = "https://facebook.com/reader").isProfileComplete)
        assertFalse(profile.copy(designation = "").isProfileComplete)
        assertFalse(profile.copy(designation = " \t ", facebookId = "facebook").isProfileComplete)
        assertFalse(profile.copy(about = "").isProfileComplete)
    }
}
