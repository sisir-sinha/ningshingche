package com.ningshingche.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.ningshingche.app.data.model.ContentLanguage
import com.ningshingche.app.ui.viewmodel.SettingsViewModel

/** Steps in [FirstRunFlow]: language, sign-in, notifications. */
const val FIRST_RUN_STEPS = 3

/**
 * The first-install experience, as one flow with three steps.
 *
 * The three questions a new reader has to answer — which language to read in,
 * whether to sign in, whether to allow notifications — used to be separate
 * screens reached one after another, each with its own button wording. They are
 * steps here: one screen at a time, a single Next at the bottom of each, and the
 * last button finishes the flow and opens the reader.
 *
 * A row of dots at the top says how many steps are left, and the steps keep
 * their own layouts and wording (see [LanguageSetupScreen], [WelcomeLoginScreen]
 * and [WelcomeNotificationsScreen]); only the button labels change, so each one
 * reads as a step rather than a place.
 *
 * Finish lands on the notification step, which is the last thing asked: enabling
 * there also triggers the Android permission dialog, and declining still
 * completes the flow. The reader is never stuck here — the flag that closes the
 * flow (`ReaderPreferences.onboardingComplete`) is set either way, and every one
 * of these choices stays editable in Settings afterwards.
 */
@Composable
fun FirstRunFlow(
    selected: ContentLanguage,
    onSelectLanguage: (ContentLanguage) -> Unit,
    viewModel: SettingsViewModel,
    onFinished: () -> Unit
) {
    // Survives the rotation that the Google sign-in dialog can cause, so the
    // reader does not land back on step one.
    var step by rememberSaveable { mutableStateOf(0) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .testTag("first_run_flow")
    ) {
        when (step) {
            0 -> LanguageSetupScreen(
                selected = selected,
                onSelect = onSelectLanguage,
                onContinue = { step = 1 },
                continueLabel = "পরবর্তী"
            )

            1 -> WelcomeLoginScreen(
                viewModel = viewModel,
                onSignedIn = { step = 2 },
                onSkip = { step = 2 },
                skipLabel = "সাইন-ইন ছাড়া পরবর্তী"
            )

            else -> WelcomeNotificationsScreen(
                viewModel = viewModel,
                onFinished = onFinished,
                finishLabel = "চালু করে শেষ করুন"
            )
        }

        FirstRunStepDots(
            current = step,
            total = FIRST_RUN_STEPS,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .systemBarsPadding()
                .padding(top = 18.dp)
        )
    }
}

/** The three dots: filled up to the current step, wider for the step in hand. */
@Composable
private fun FirstRunStepDots(current: Int, total: Int, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        repeat(total) { index ->
            val active = index <= current
            Box(
                modifier = Modifier
                    .size(width = if (index == current) 22.dp else 8.dp, height = 8.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(
                        if (active) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.outlineVariant
                    )
            )
        }
    }
}
