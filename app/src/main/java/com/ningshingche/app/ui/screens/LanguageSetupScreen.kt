package com.ningshingche.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ningshingche.app.data.model.ContentLanguage
import com.ningshingche.app.ui.theme.Kalpurush

/**
 * The one question the app asks before anything else: which language to read in.
 *
 * It is shown once, while `ReaderPreferences.languageChosen` is false, and it is
 * the whole first-launch experience — no login, no onboarding, nothing to skip
 * past. Picking a language downloads that language's file straight away, so the
 * reader sees the interface in their language as soon as they continue. After
 * this, the language is changed from Settings like any other preference.
 *
 * The options are deliberately labelled in their own language (and their own
 * script), because this screen is read by someone who may not read the one the
 * app is currently in. For the same reason the surrounding copy is written here
 * rather than routed through [t]: the choice has not been made yet.
 */
@Composable
fun LanguageSetupScreen(
    selected: ContentLanguage,
    onSelect: (ContentLanguage) -> Unit,
    onContinue: () -> Unit
) {
    // Held locally so a tap feels immediate; the preference follows through.
    var chosen by remember(selected) { mutableStateOf(selected) }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .padding(horizontal = 24.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Translate,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(30.dp)
                )
            }

            Spacer(Modifier.height(20.dp))
            Text(
                text = "ভাষা বাছাই করুন",
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 24.sp,
                color = MaterialTheme.colorScheme.onBackground
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = "Choose your language · লাউখোল",
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(26.dp))

            ContentLanguage.entries.forEach { language ->
                LanguageChoiceCard(
                    title = language.displayName(),
                    subtitle = language.nativeHint(),
                    isSelected = language == chosen,
                    onClick = {
                        chosen = language
                        onSelect(language) // fetches that language's file
                    }
                )
                Spacer(Modifier.height(12.dp))
            }

            Spacer(Modifier.height(14.dp))
            Button(
                onClick = onContinue,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(14.dp)
            ) {
                Icon(Icons.Default.CheckCircle, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Text(
                    text = "শুরু করুন",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp
                )
            }

            Spacer(Modifier.height(14.dp))
            Text(
                text = "পরে সেটিংস থেকে ভাষা বদলাতে পারবেন।",
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun LanguageChoiceCard(
    title: String,
    subtitle: String,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = if (isSelected) {
            MaterialTheme.colorScheme.primary.copy(alpha = 0.10f)
        } else {
            MaterialTheme.colorScheme.surface
        },
        border = BorderStroke(
            width = if (isSelected) 2.dp else 1.dp,
            color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
        ),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .clickable { onClick() }
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = subtitle,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (isSelected) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(24.dp)
                )
            } else {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    color = Color.Transparent,
                    modifier = Modifier.size(22.dp)
                ) {}
            }
        }
    }
}

/** The language's name in the language itself. */
fun ContentLanguage.displayName(): String = when (this) {
    ContentLanguage.BENGALI -> "বাংলা"
    ContentLanguage.ENGLISH -> "English"
    ContentLanguage.BISHNUPRIYA -> "বিষ্ণুপ্রিয়া মণিপুরী"
}

private fun ContentLanguage.nativeHint(): String = when (this) {
    ContentLanguage.BENGALI -> "Bengali — the app's own language"
    ContentLanguage.ENGLISH -> "ইংরেজি"
    ContentLanguage.BISHNUPRIYA -> "বিষ্ণুপ্রিয়া মণিপুরী / Bishnupriya Manipuri"
}
