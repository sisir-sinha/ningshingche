package com.ningshingche.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ningshingche.app.data.remote.AdminMessageRecord
import com.ningshingche.app.data.remote.UserNotificationRecord
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.viewmodel.ReaderWorkspaceViewModel
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

private val TickGreen = Color(0xFF25D366)
private const val PAGE = 25

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
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(user?.id) {
        if (user != null) {
            viewModel.refreshInbox(markSeen = true)
        }
    }

    LaunchedEffect(status) {
        val text = status ?: return@LaunchedEffect
        if (text.isBlank()) return@LaunchedEffect
        snackbarHostState.showSnackbar(text)
        viewModel.clearMessage()
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
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
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
        ) {
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
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            kindLabel(notice.kind),
                            fontFamily = Kalpurush,
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.primary
                        )
                        if (notice.createdAt.isNotBlank()) {
                            Text(
                                shortDateTime(notice.createdAt),
                                fontFamily = Kalpurush,
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AdminMessagePane(
    messages: List<AdminMessageRecord>,
    saving: Boolean,
    onSend: (String, String) -> Unit
) {
    var subject by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    val ordered = remember(messages) { messages.sortedBy { it.createdAt } }
    var window by remember { mutableIntStateOf(PAGE) }
    val visible = remember(ordered, window) { ordered.takeLast(window.coerceAtMost(ordered.size.coerceAtLeast(0))) }
    val listState = rememberLazyListState()

    LaunchedEffect(ordered.lastOrNull()?.id) {
        if (visible.isNotEmpty()) {
            listState.scrollToItem(visible.lastIndex)
        }
    }

    Column(Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (window < ordered.size) {
                item(key = "older") {
                    TextButton(
                        onClick = { window = (window + PAGE).coerceAtMost(ordered.size) },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("আগের বার্তা", fontFamily = Kalpurush)
                    }
                }
            }
            if (ordered.isEmpty()) {
                item {
                    Text(
                        "অ্যাডমিনকে প্রশ্ন বা অনুরোধ পাঠান। উত্তর এখানে দেখাবে।",
                        fontFamily = Kalpurush,
                        modifier = Modifier.padding(8.dp)
                    )
                }
            }
            items(visible, key = { it.id }) { item ->
                ChatBubble(item)
            }
        }

        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedTextField(
                value = subject,
                onValueChange = { subject = it },
                label = { Text("বিষয় (ঐচ্ছিক)", fontFamily = Kalpurush) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it },
                    label = { Text("বার্তা", fontFamily = Kalpurush) },
                    minLines = 1,
                    maxLines = 4,
                    modifier = Modifier
                        .weight(1f)
                        .testTag("admin_message_body")
                )
                IconButton(
                    onClick = {
                        onSend(subject, body)
                        body = ""
                    },
                    enabled = !saving && body.isNotBlank(),
                    modifier = Modifier.testTag("admin_message_send")
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "পাঠান")
                }
            }
        }
    }
}

@Composable
private fun ChatBubble(item: AdminMessageRecord) {
    val fromAdmin = item.isFromAdmin
    Box(modifier = Modifier.fillMaxWidth()) {
        Surface(
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = 16.dp,
                bottomStart = if (fromAdmin) 4.dp else 16.dp,
                bottomEnd = if (fromAdmin) 16.dp else 4.dp
            ),
            color = if (fromAdmin) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.secondaryContainer
            },
            modifier = Modifier
                .align(if (fromAdmin) Alignment.CenterStart else Alignment.CenterEnd)
                .widthIn(max = 320.dp)
                .testTag("inbox_message_${item.id}")
        ) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    if (fromAdmin) "অ্যাডমিন" else "আপনি",
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp
                )
                if (item.subject.isNotBlank()) {
                    Text(item.subject, fontFamily = Kalpurush, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                }
                Text(item.body, fontFamily = Kalpurush, fontSize = 15.sp)
                Row(
                    modifier = Modifier.align(Alignment.End),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        shortDateTime(item.createdAt),
                        fontFamily = Kalpurush,
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (!fromAdmin) {
                        Icon(
                            imageVector = if (item.isRead) Icons.Default.DoneAll else Icons.Default.Done,
                            contentDescription = if (item.isRead) "দেখা হয়েছে" else "পাঠানো হয়েছে",
                            tint = if (item.isRead) TickGreen else MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(0.dp)
                        )
                    }
                }
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

internal fun shortDateTime(iso: String): String {
    if (iso.isBlank()) return ""
    val parsed = parseIsoMillis(iso) ?: return iso.take(16).replace('T', ' ')
    val fmt = SimpleDateFormat("d MMM, h:mm a", Locale.getDefault())
    return fmt.format(parsed)
}

internal fun parseIsoMillis(iso: String): java.util.Date? {
    val candidates = listOf(
        "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXX",
        "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
        "yyyy-MM-dd'T'HH:mm:ssXXX",
        "yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd HH:mm:ss"
    )
    val trimmed = iso.trim()
    for (pattern in candidates) {
        val fmt = SimpleDateFormat(pattern, Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        val value = runCatching { fmt.parse(trimmed) }.getOrNull()
        if (value != null) return value
    }
    val compact = trimmed.take(19).replace(' ', 'T')
    val fallback = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
    fallback.timeZone = TimeZone.getTimeZone("UTC")
    return runCatching { fallback.parse(compact) }.getOrNull()
}
