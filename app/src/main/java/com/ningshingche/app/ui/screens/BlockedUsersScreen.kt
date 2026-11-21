package com.ningshingche.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.ningshingche.app.data.portal.PortalRepository
import com.ningshingche.app.ui.i18n.t
import com.ningshingche.app.ui.i18n.tNow
import com.ningshingche.app.ui.theme.Kalpurush
import kotlinx.coroutines.launch

/** Account-scoped list. Failed reads and writes are never presented as success. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BlockedUsersScreen(repository: PortalRepository, onBack: () -> Unit) {
    var users by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(refresh) {
        loading = true
        error = null
        repository.blockedUserIds().onSuccess { ids ->
            val names = mutableMapOf<String, String>()
            for (id in ids) {
                names[id] = repository.publicProfile(id).getOrNull()?.name?.ifBlank { id } ?: id
            }
            users = names
        }.onFailure { error = tNow("তালিকা লোড হয়নি। আবার চেষ্টা করুন।") }
        loading = false
    }
    confirm?.let { id ->
        AlertDialog(
            onDismissRequest = { if (!busy) confirm = null },
            title = { Text(t("ব্লক খুলুন?"), fontFamily = Kalpurush) },
            text = { Text(users[id].orEmpty(), fontFamily = Kalpurush) },
            confirmButton = {
                TextButton(enabled = !busy, onClick = {
                    busy = true
                    scope.launch {
                        repository.unblockUser(id).onSuccess { success ->
                            if (success) users = users - id
                            else error = tNow("ব্লক খোলা যায়নি। আবার চেষ্টা করুন।")
                        }.onFailure { error = tNow("ব্লক খোলা যায়নি। আবার চেষ্টা করুন।") }
                        busy = false
                        confirm = null
                    }
                }) { Text(t("ব্লক খুলুন"), fontFamily = Kalpurush) }
            },
            dismissButton = { TextButton(enabled = !busy, onClick = { confirm = null }) { Text(t("বাতিল")) } }
        )
    }
    Scaffold(topBar = {
        TopAppBar(title = { Text(t("ব্লক করা ব্যবহারকারী"), fontFamily = Kalpurush) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = t("পেছনে")) } })
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().padding(16.dp)) {
            if (loading) CircularProgressIndicator()
            if (error != null) {
                Text(error.orEmpty(), color = MaterialTheme.colorScheme.error, fontFamily = Kalpurush)
                TextButton(onClick = { refresh++ }) { Text(t("আবার চেষ্টা করুন"), fontFamily = Kalpurush) }
            } else if (!loading && users.isEmpty()) {
                Text(t("কাউকে ব্লক করা নেই।"), fontFamily = Kalpurush)
            }
            LazyColumn {
                items(users.keys.toList(), key = { it }) { id ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(users[id].orEmpty(), modifier = Modifier.weight(1f), fontFamily = Kalpurush)
                        TextButton(onClick = { confirm = id }, modifier = Modifier.testTag("unblock_user")) {
                            Text(t("ব্লক খুলুন"), fontFamily = Kalpurush)
                        }
                    }
                }
            }
        }
    }
}
