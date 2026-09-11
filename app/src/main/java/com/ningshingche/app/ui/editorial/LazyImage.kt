package com.ningshingche.app.ui.editorial

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp


@Composable
fun ShimmerPlaceholder(modifier: Modifier = Modifier) {
    Box(modifier = modifier.background(rememberShimmerBrush()))
}

@Composable
fun ImagePlaceholder(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(EditorialShape.thumb),
    broken: Boolean = false
) {
    val tokens = LocalEditorialTokens.current
    Box(
        modifier = modifier
            .clip(shape)
            .background(tokens.surfaceSunken)
            .border(1.dp, tokens.rule, shape),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = if (broken) Icons.Default.BrokenImage else Icons.Default.Image,
            contentDescription = null,
            tint = tokens.inkMuted,
            modifier = Modifier.fillMaxSize(0.35f)
        )
    }
}
