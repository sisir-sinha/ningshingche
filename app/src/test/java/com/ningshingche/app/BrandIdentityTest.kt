package com.ningshingche.app

import android.app.Application
import android.content.ComponentName
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Verifies the installed identity, generated namespace and resolved manifest together. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class BrandIdentityTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Test
    fun `application ID and generated classes use the branded namespace`() {
        assertEquals("com.ningshingche.app", BuildConfig.APPLICATION_ID)
        assertEquals(BuildConfig.APPLICATION_ID, context.packageName)
        assertEquals("com.ningshingche.app.BuildConfig", BuildConfig::class.java.name)
        assertEquals("com.ningshingche.app.R", R::class.java.name)
    }

    @Test
    fun `launcher retains the Bengali brand name`() {
        assertEquals("নিংশিং চে", context.getString(R.string.app_name))
        assertEquals("নিংশিং চে", context.applicationInfo.loadLabel(context.packageManager).toString())
    }

    @Test
    fun `launcher activity resolves to the migrated class`() {
        val info = context.packageManager.getActivityInfo(ComponentName(context, MainActivity::class.java), 0)
        assertEquals("com.ningshingche.app.MainActivity", info.name)
        assertEquals("com.ningshingche.app", info.packageName)
        assertEquals("com.ningshingche.app.NinghsingCheApp", NinghsingCheApp::class.java.name)
    }

    @Test
    fun `file sharing authority follows the new application ID and stays private`() {
        val info = context.packageManager.resolveContentProvider("com.ningshingche.app.provider", 0)
        assertNotNull(info)
        assertEquals("androidx.core.content.FileProvider", info!!.name)
        assertEquals("com.ningshingche.app", info.packageName)
        assertFalse(info.exported)
    }
}
