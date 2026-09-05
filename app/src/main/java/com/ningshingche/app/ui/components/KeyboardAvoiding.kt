package com.ningshingche.app.ui.components

import android.view.WindowManager
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider

/**
 * Bottom inset equal to the software keyboard (or the nav bar when the
 * keyboard is closed). Apply on any column that holds a focused text field
 * so the field stays visible. Safe to stack: Compose uses the remaining
 * unconsumed inset, so it will not double-pad.
 */
fun Modifier.keyboardAvoidingPadding(): Modifier = composed {
    windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars))
}

/**
 * Dialog / [androidx.compose.material3.ModalBottomSheet] hosts often ignore
 * the activity's `adjustResize`. Force the host window to report IME insets
 * so [keyboardAvoidingPadding] has a real keyboard height to use.
 */
@Composable
fun DialogImeAdjustResize() {
    val view = LocalView.current
    DisposableEffect(view) {
        var parent = view.parent
        var provider: DialogWindowProvider? = null
        while (parent != null) {
            if (parent is DialogWindowProvider) {
                provider = parent
                break
            }
            parent = parent.parent
        }
        val window = provider?.window
        if (window == null) {
            onDispose { }
        } else {
            val previous = window.attributes.softInputMode
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            onDispose { window.setSoftInputMode(previous) }
        }
    }
}
