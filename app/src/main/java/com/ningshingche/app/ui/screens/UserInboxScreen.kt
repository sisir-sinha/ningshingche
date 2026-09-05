package com.ningshingche.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ningshingche.app.data.remote.AdminMessageRecord
import com.ningshingche.app.data.remote.UserNotificationRecord
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.viewmodel.ReaderWorkspaceViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UserInboxScreen(
    viewModel: ReaderWorkspaceViewModel,
    onBackClick: () -> Unit
) {
    val user by viewModel.currentUser.collectAsStateWithLifecycle()
    val notifications by viewModel.notifications.collectAsStateWithLifecycle()
    val messages by viewModel.adminMessages.collectAsStateWithLifecycle()
    val saving by viewModel.isSaving.collectAsStateWithLifecycle()
    val status by viewModel.message.collectAsStateWithLifecycle()
    var tab by remember { mutableIntStateOf(0) }

    LaunchedEffect(user?.id) {
        if (user != null) viewModel.refreshInbox()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("বিজ্ঞপ্তি", fontFamily = Kalpurush, fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBackClick, modifier = Modifier.testTag("user_inbox_back")) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "ফিরুন")
                    }
                },
                actions = {
                    if (tab == 0 && notifications.any { !it.isRead }) {
                        IconButton(onClick = { viewModel.markAllNotificationsRead() }) {
                            Icon(Icons.Default.DoneAll, contentDescription = "সব পঠিত")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background)
            )
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            TabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("বিজ্ঞপ্তি", fontFamily = Kalpurush) })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("অ্যাডমিন বার্তা", fontFamily = Kalpurush) })
            }
            if (tab == 0) {
                NotificationList(
                    notifications = notifications,
                    onOpen = { viewModel.markNotificationRead(it.id) }
                )
            } else {
                AdminMessagePane(
                    messages = messages,
                    status = status,
                    saving = saving,
                    onSend = { subject, body -> viewModel.sendAdminMessage(subject, body) }
                )
            }
        }
    }
}

@Composable
private fun NotificationList(
    notifications: List<UserNotificationRecord>,
    onOpen: (UserNotificationRecord) -> Unit
) {
    if (notifications.isEmpty()) {
        Text(
            "এখনো কোনো বিজ্ঞপ্তি নেই। প্রবন্ধ বা মন্তব্য প্রকাশিত হলে এখানে দেখাবে।",
            fontFamily = Kalpurush,
            modifier = Modifier.padding(16.dp)
        )
        return
    }
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        items(notifications, key = { it.id }) { notice ->
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = if (notice.isRead) {
                    MaterialTheme.colorScheme.surface
                } else {
                    MaterialTheme.colorScheme.primaryContainer
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpen(notice) }
                    .testTag("inbox_notice_${notice.id}")
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(notice.title, fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                    if (notice.body.isNotBlank()) {
                        Text(notice.body, fontFamily = Kalpurush, fontSize = 13.sp)
                    }
                    Text(
                        kindLabel(notice.kind),
                        fontFamily = Kalpurush,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
        }
    }
}

@Composable
private fun AdminMessagePane(
    messages: List<AdminMessageRecord>,
    status: String?,
    saving: Boolean,
    onSend: (String, String) -> Unit
) {
    var subject by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (messages.isEmpty()) {
                item {
                    Text(
                        "অ্যাডমিনকে প্রশ্ন বা অনুরোধ পাঠান। উত্তর এখানে দেখাবে।",
                        fontFamily = Kalpurush
                    )
                }
            }
            items(messages, key = { it.id }) { item ->
                val fromAdmin = item.isFromAdmin
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    color = if (fromAdmin) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.surfaceVariant
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            if (fromAdmin) "অ্যাডমিন" else "আপনি",
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.sp
                        )
                        if (item.subject.isNotBlank()) {
                            Text(item.subject, fontFamily = Kalpurush, fontWeight = FontWeight.SemiBold)
                        }
                        Text(item.body, fontFamily = Kalpurush, fontSize = 14.sp)
                    }
                }
            }
        }

        Column(
            Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (!status.isNullOrBlank()) {
                Text(status, fontFamily = Kalpurush, fontSize = 12.sp, color = MaterialTheme.colorScheme.primary)
            }
            OutlinedTextField(
                value = subject,
                onValueChange = { subject = it },
                label = { Text("বিষয় (ঐচ্ছিক)", fontFamily = Kalpurush) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = body,
                onValueChange = { body = it },
                label = { Text("বার্তা", fontFamily = Kalpurush) },
                minLines = 3,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("admin_message_body")
            )
            Button(
                onClick = {
                    onSend(subject, body)
                    body = ""
                },
                enabled = !saving && body.isNotBlank(),
                modifier = Modifier
                    .align(Alignment.End)
                    .testTag("admin_message_send")
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null)
                Spacer(Modifier.height(0.dp))
                Text(" পাঠান", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
            }
        }
    }
}

private fun kindLabel(kind: String): String = when (kind) {
    UserNotificationRecord.KIND_ARTICLE -> "প্রবন্ধ"
    UserNotificationRecord.KIND_COMMENT -> "মন্তব্য"
    UserNotificationRecord.KIND_ADMIN -> "অ্যাডমিন"
    "staff_notice" -> "অ্যাডমিন"
    else -> kind
}
