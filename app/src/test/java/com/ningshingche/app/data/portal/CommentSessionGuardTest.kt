package com.ningshingche.app.data.portal

import org.junit.Assert.*
import org.junit.Test

class CommentSessionGuardTest {
    @Test fun `only a matching nonanonymous authenticated session is allowed`() {
        assertTrue(canSendComment("user-1", "user-1", "authenticated", false))
        assertFalse(canSendComment(null, "user-1", "authenticated", false))
        assertFalse(canSendComment("", "", "authenticated", false))
        assertFalse(canSendComment("user-1", null, "authenticated", false))
        assertFalse(canSendComment("user-1", "user-2", "authenticated", false))
        assertFalse(canSendComment("user-1", "user-1", "anon", false))
        assertFalse(canSendComment("user-1", "user-1", "authenticated", true))
    }
}
