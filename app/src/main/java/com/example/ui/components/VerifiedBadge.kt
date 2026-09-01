package com.example.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.example.R

@Composable
fun VerifiedBadge(
    modifier: Modifier = Modifier,
    size: Dp = 16.dp,
    animated: Boolean = true
) {
    val scale = if (animated) {
        val infiniteTransition = rememberInfiniteTransition(label = "verifiedBadgePulse")
        val animatedScale by infiniteTransition.animateFloat(
            initialValue = 1.0f,
            targetValue = 1.09f,
            animationSpec = infiniteRepeatable(
                animation = tween(1200, easing = FastOutSlowInEasing),
                repeatMode = RepeatMode.Reverse
            ),
            label = "badgeScale"
        )
        animatedScale
    } else {
        1.0f
    }

    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(size)
            .scale(scale)
    ) {
        Icon(
            painter = painterResource(id = R.drawable.ic_verified_badge),
            contentDescription = "যাচাইকৃত লেখক",
            tint = Color.Unspecified,
            modifier = Modifier.size(size)
        )
    }
}

