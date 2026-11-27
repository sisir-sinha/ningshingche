package com.ningshingche.app.auth

import com.ningshingche.app.data.auth.EmailAuthRules
import org.junit.Assert.*
import org.junit.Test

class RegistrationEmailRulesTest {
    @Test fun legitimatePrivacyMailProvidersAreNotMarkedDisposable() {
        for (address in listOf("reader@tutanota.de", "reader@protonmail.ch", "reader@example.com")) {
            assertTrue(EmailAuthRules.isEmail(address))
            assertNull(EmailAuthRules.emailProblem(address))
        }
    }
    @Test fun temporaryAddressesAndInvalidEmailAreRejectedForSignup() {
        assertNotNull(EmailAuthRules.emailProblem("reader@mailinator.com"))
        assertNotNull(EmailAuthRules.emailProblem("invalid"))
        assertTrue(EmailAuthRules.isEmail("reader@mailinator.com")) // existing users may still sign in
    }
}
