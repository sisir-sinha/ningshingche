package com.ningshingche.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.ningshingche.app.data.music.MusicGenres
import com.ningshingche.app.ui.theme.Kalpurush

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun GenreCombobox(
    selected: List<String>,
    onSelectedChange: (List<String>) -> Unit,
    modifier: Modifier = Modifier
) {
    var query by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }
    val suggestions = remember(query, selected) {
        val needle = query.trim()
        MusicGenres.ALL.filter { option ->
            selected.none { it.equals(option, ignoreCase = true) } &&
                (needle.isEmpty() || option.contains(needle, ignoreCase = true))
        }
    }

    fun addTokens(raw: String) {
        val extra = MusicGenres.parse(raw)
        if (extra.isEmpty()) return
        val merged = (selected + extra).distinctBy { it.lowercase() }
        onSelectedChange(merged)
        query = ""
        expanded = true
    }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (selected.isNotEmpty()) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                selected.forEach { genre ->
                    InputChip(
                        selected = true,
                        onClick = { onSelectedChange(selected.filterNot { it == genre }) },
                        label = { Text(genre, fontFamily = Kalpurush) },
                        trailingIcon = {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = "সরান",
                                modifier = Modifier.size(16.dp)
                            )
                        },
                        colors = InputChipDefaults.inputChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer
                        )
                    )
                }
            }
        }
        ExposedDropdownMenuBox(
            expanded = expanded && suggestions.isNotEmpty(),
            onExpandedChange = { expanded = it }
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = { next ->
                    if (next.contains(',') || next.contains('\t') || next.contains(';') || next.contains('\n')) {
                        addTokens(next)
                    } else {
                        query = next
                        expanded = true
                    }
                },
                label = { Text("ধরন / ক্যাটাগরি", fontFamily = Kalpurush) },
                placeholder = { Text("তালিকা থেকে বেছে নিন বা লিখে কমা/ট্যাব চাপুন", fontFamily = Kalpurush) },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded && suggestions.isNotEmpty()) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { addTokens(query) }),
                modifier = Modifier
                    .menuAnchor()
                    .fillMaxWidth()
                    .onPreviewKeyEvent { event ->
                        if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                        when (event.key) {
                            Key.Tab, Key.Enter, Key.NumPadEnter, Key.Comma -> {
                                addTokens(query)
                                true
                            }
                            Key.Backspace -> {
                                if (query.isEmpty() && selected.isNotEmpty()) {
                                    onSelectedChange(selected.dropLast(1))
                                    true
                                } else false
                            }
                            else -> false
                        }
                    }
            )
            ExposedDropdownMenu(
                expanded = expanded && suggestions.isNotEmpty(),
                onDismissRequest = { expanded = false }
            ) {
                suggestions.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option, fontFamily = Kalpurush, fontWeight = FontWeight.Medium) },
                        onClick = {
                            addTokens(option)
                            expanded = true
                        }
                    )
                }
            }
        }
        Text(
            "একাধিক ধরন যোগ করা যায়। কমা বা ট্যাব চাপলে চিপ তৈরি হয়।",
            fontFamily = Kalpurush,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
