package com.ningshingche.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.ningshingche.app.data.music.MusicGenres
import com.ningshingche.app.ui.theme.Kalpurush

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GenreCombobox(
    selected: List<String>,
    onSelectedChange: (List<String>) -> Unit,
    modifier: Modifier = Modifier
) {
    var query by remember { mutableStateOf("") }

    fun addTokens(raw: String) {
        val extra = MusicGenres.parse(raw)
        if (extra.isEmpty()) return
        onSelectedChange((selected + extra).distinctBy { it.lowercase() })
        query = ""
    }

    fun toggle(option: String) {
        onSelectedChange(
            if (selected.any { it.equals(option, ignoreCase = true) }) {
                selected.filterNot { it.equals(option, ignoreCase = true) }
            } else {
                selected + option
            }
        )
    }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("ধরন / ক্যাটাগরি", fontFamily = Kalpurush, style = MaterialTheme.typography.labelLarge)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            val extras = selected.filter { option ->
                MusicGenres.ALL.none { it.equals(option, ignoreCase = true) }
            }
            (MusicGenres.ALL + extras).forEach { option ->
                val on = selected.any { it.equals(option, ignoreCase = true) }
                FilterChip(
                    selected = on,
                    onClick = { toggle(option) },
                    label = { Text(option, fontFamily = Kalpurush) }
                )
            }
        }
        OutlinedTextField(
            value = query,
            onValueChange = { next ->
                if (next.contains(',') || next.contains('\t') || next.contains(';') || next.contains('\n')) {
                    addTokens(next)
                } else {
                    query = next
                }
            },
            label = { Text("অন্য ধরন লিখুন", fontFamily = Kalpurush) },
            placeholder = { Text("কমা বা ট্যাব চাপলে চিপ হবে", fontFamily = Kalpurush) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { addTokens(query) }),
            modifier = Modifier
                .fillMaxWidth()
                .onPreviewKeyEvent { event ->
                    if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    when (event.key) {
                        Key.Tab, Key.Enter, Key.NumPadEnter, Key.Comma -> {
                            addTokens(query)
                            true
                        }
                        else -> false
                    }
                }
        )
    }
}
