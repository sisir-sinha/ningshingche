package com.ningshingche.app.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ningshingche.app.R
import com.ningshingche.app.ui.i18n.t

/**
 * The mark of a verified author: the badge, its own colour, beside the name.
 *
 * It used to pulse — a two-second scale animation, forever, on every badge on the
 * screen. That is what infinite means: a badge in a list row kept the frame clock
 * awake for as long as it was visible, so the app never went idle and a list of
 * verified authors cost a frame's work per badge per frame, on top of the scroll.
 * The owner felt exactly that: "the app gets stuck or lags while scrolling down".
 *
 * A verification mark says the same thing standing still, so it does.
 */
@Composable
fun VerifiedBadge(
    modifier: Modifier = Modifier,
    size: Dp = 16.dp
) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier.size(size)
    ) {
        Icon(
            painter = painterResource(id = R.drawable.ic_verified_badge),
            contentDescription = t("যাচাইকৃত লেখক"),
            tint = Color.Unspecified,
            modifier = Modifier.size(size)
        )
    }
}
