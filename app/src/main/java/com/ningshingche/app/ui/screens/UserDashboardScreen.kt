package com.ningshingche.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.ningshingche.app.data.remote.AdminMessageRecord
import com.ningshingche.app.data.remote.CommentRecord
import com.ningshingche.app.data.remote.SubmittedBlogRecord
import com.ningshingche.app.data.remote.UserNotificationRecord
import com.ningshingche.app.data.remote.UserProfile
import com.ningshingche.app.ui.theme.Kalpurush
import com.ningshingche.app.ui.viewmodel.ReaderMetrics
import com.ningshingche.app.ui.viewmodel.ReaderWorkspaceViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UserDashboardScreen(
    viewModel: ReaderWorkspaceViewModel,
    onBackClick: () -> Unit,
    onCompleteProfile: () -> Unit,
    onNewArticle: () -> Unit,
    onInboxClick: () -> Unit = {}
) {
    val user by viewModel.currentUser.collectAsStateWithLifecycle()
    val articles by viewModel.articles.collectAsStateWithLifecycle()
    val comments by viewModel.comments.collectAsStateWithLifecycle()
    val notifications by viewModel.notifications.collectAsStateWithLifecycle()
    val messages by viewModel.adminMessages.collectAsStateWithLifecycle()
    val unread by viewModel.unreadCount.collectAsStateWithLifecycle()
    val metrics by viewModel.metrics.collectAsStateWithLifecycle()
    val loading by viewModel.isLoading.collectAsStateWithLifecycle()
    val saving by viewModel.isSaving.collectAsStateWithLifecycle()
    val status by viewModel.message.collectAsStateWithLifecycle()
    var tab by remember { mutableIntStateOf(0) }

    LaunchedEffect(user?.id) {
        if (user != null) viewModel.refresh()
    }

    val snackbarHostState = remember { SnackbarHostState() }
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
                title = { Text("আমার ড্যাশবোর্ড", fontFamily = Kalpurush, fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBackClick, modifier = Modifier.testTag("user_dashboard_back")) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "ফিরুন")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background)
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = {
                    if (user?.isProfileComplete == true) onNewArticle() else onCompleteProfile()
                },
                modifier = Modifier.testTag("user_dashboard_new_article")
            ) {
                Icon(Icons.Default.Add, contentDescription = "নতুন প্রবন্ধ")
            }
        }
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = loading,
            onRefresh = { viewModel.refresh() },
            modifier = Modifier.fillMaxSize().padding(padding)
        ) {
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                item {
                    UserInfoCard(
                        user = user,
                        onEditProfile = onCompleteProfile
                    )
                }

                if (user?.isProfileComplete != true) {
                    item {
                        Surface(
                            color = MaterialTheme.colorScheme.errorContainer,
                            shape = RoundedCornerShape(14.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    "প্রোফাইল অসম্পূর্ণ। নতুন প্রবন্ধ জমা দিতে আগে প্রোফাইল পূরণ করুন।",
                                    fontFamily = Kalpurush
                                )
                                Button(onClick = onCompleteProfile, modifier = Modifier.testTag("complete_profile_cta")) {
                                    Text("প্রোফাইল সম্পূর্ণ করুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }
                }

                item {
                    MetricsGrid(
                        metrics = metrics,
                        unread = unread,
                        messageCount = messages.size
                    )
                }

                item {
                    TabRow(selectedTabIndex = tab) {
                        Tab(
                            selected = tab == 0,
                            onClick = { tab = 0 },
                            text = {
                                Text(
                                    if (unread > 0) "বিজ্ঞপ্তি ($unread)" else "বিজ্ঞপ্তি",
                                    fontFamily = Kalpurush
                                )
                            }
                        )
                        Tab(
                            selected = tab == 1,
                            onClick = { tab = 1 },
                            text = { Text("বার্তা", fontFamily = Kalpurush) }
                        )
                        Tab(
                            selected = tab == 2,
                            onClick = { tab = 2 },
                            text = { Text("প্রবন্ধ", fontFamily = Kalpurush) }
                        )
                        Tab(
                            selected = tab == 3,
                            onClick = { tab = 3 },
                            text = { Text("মন্তব্য", fontFamily = Kalpurush) }
                        )
                    }
                }

                when (tab) {
                    0 -> {
                        if (notifications.isEmpty()) {
                            item {
                                EmptyHint("এখনো কোনো বিজ্ঞপ্তি নেই। প্রবন্ধ বা মন্তব্য প্রকাশিত হলে এখানে দেখাবে।")
                            }
                        } else {
                            items(notifications, key = { "n-${it.id}" }) { notice ->
                                NotificationCard(
                                    notice = notice,
                                    onOpen = { viewModel.markNotificationRead(notice.id) }
                                )
                            }
                        }
                    }
                    1 -> {
                        if (messages.isEmpty()) {
                            item {
                                EmptyHint("অ্যাডমিনকে প্রশ্ন বা অনুরোধ পাঠান। উত্তর এখানে দেখাবে।")
                            }
                        } else {
                            items(messages, key = { "m-${it.id}" }) { item ->
                                MessageCard(item)
                            }
                        }
                        item {
                            AdminMessageComposer(
                                saving = saving,
                                onSend = { subject, body -> viewModel.sendAdminMessage(subject, body) },
                                onSeeAll = onInboxClick
                            )
                        }
                    }
                    2 -> {
                        if (articles.isEmpty()) {
                            item { EmptyHint("এখনো কোনো প্রবন্ধ জমা দেননি।") }
                        } else {
                            items(articles, key = { "a-${it.id}" }) { article ->
                                ArticleStatusCard(article)
                            }
                        }
                    }
                    else -> {
                        if (comments.isEmpty()) {
                            item { EmptyHint("আপনার কোনো মন্তব্য পাওয়া যায়নি।") }
                        } else {
                            items(comments, key = { "c-${it.id}" }) { comment ->
                                CommentStatusCard(comment)
                            }
                        }
                    }
                }
                item { Spacer(Modifier.height(72.dp)) }
            }
        }
    }
}

@Composable
private fun UserInfoCard(
    user: UserProfile?,
    onEditProfile: () -> Unit
) {
    val name = user?.composedFullName().orEmpty().ifBlank { "পাঠক" }
    Surface(
        shape = RoundedCornerShape(16.dp),
        tonalElevation = 2.dp,
        modifier = Modifier
            .fillMaxWidth()
            .testTag("dashboard_user_info")
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(shape = CircleShape, modifier = Modifier.size(64.dp)) {
                    if (!user?.avatarUrl.isNullOrBlank()) {
                        AsyncImage(
                            model = user?.avatarUrl,
                            contentDescription = "প্রোফাইল ছবি",
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize().clip(CircleShape)
                        )
                    } else {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(36.dp))
                        }
                    }
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(name, fontFamily = Kalpurush, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                    if (!user?.designation.isNullOrBlank()) {
                        Text(user?.designation.orEmpty(), fontFamily = Kalpurush, fontSize = 13.sp)
                    }
                    Text(
                        if (user?.isProfileComplete == true) "প্রোফাইল সম্পূর্ণ" else "প্রোফাইল অসম্পূর্ণ",
                        fontFamily = Kalpurush,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
            InfoLine("ইমেইল", user?.email.orEmpty().ifBlank { "—" })
            InfoLine("ফোন", user?.phone.orEmpty().ifBlank { "—" })
            InfoLine("ঠিকানা", user?.address.orEmpty().ifBlank { "—" })
            InfoLine("Facebook", user?.facebookId.orEmpty().ifBlank { "—" })
            if (!user?.location.isNullOrBlank()) {
                InfoLine("অবস্থান", user?.location.orEmpty())
            }
            if (!user?.about.isNullOrBlank()) {
                Text(user?.about.orEmpty(), fontFamily = Kalpurush, fontSize = 13.sp)
            }
            OutlinedButton(
                onClick = onEditProfile,
                modifier = Modifier.fillMaxWidth().testTag("dashboard_edit_profile")
            ) {
                Text("প্রোফাইল সম্পাদনা", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun InfoLine(label: String, value: String) {
    Column {
        Text(label, fontFamily = Kalpurush, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontFamily = Kalpurush, fontSize = 14.sp)
    }
}

@Composable
private fun MetricsGrid(metrics: ReaderMetrics, unread: Int, messageCount: Int) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("dashboard_metrics")) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            MetricCard("প্রবন্ধ", metrics.totalArticles.toString(), Modifier.weight(1f))
            MetricCard("প্রকাশিত", metrics.publishedArticles.toString(), Modifier.weight(1f))
            MetricCard("মন্তব্য", metrics.comments.toString(), Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            MetricCard("অপেক্ষমাণ", metrics.pendingArticles.toString(), Modifier.weight(1f))
            MetricCard("বিজ্ঞপ্তি", unread.toString(), Modifier.weight(1f))
            MetricCard("বার্তা", messageCount.toString(), Modifier.weight(1f))
        }
    }
}

@Composable
private fun MetricCard(label: String, value: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(value, fontFamily = Kalpurush, fontWeight = FontWeight.Bold, fontSize = 20.sp)
            Text(label, fontFamily = Kalpurush, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun EmptyHint(text: String) {
    Text(text, fontFamily = Kalpurush, modifier = Modifier.padding(vertical = 8.dp))
}

@Composable
private fun NotificationCard(
    notice: UserNotificationRecord,
    onOpen: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = if (notice.isRead) {
            MaterialTheme.colorScheme.surface
        } else {
            MaterialTheme.colorScheme.primaryContainer
        },
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .testTag("dashboard_notice_${notice.id}")
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(notice.title, fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
            if (notice.body.isNotBlank()) {
                Text(notice.body, fontFamily = Kalpurush, fontSize = 13.sp)
            }
            Text(
                when (notice.kind) {
                    UserNotificationRecord.KIND_ARTICLE -> "প্রবন্ধ"
                    UserNotificationRecord.KIND_COMMENT -> "মন্তব্য"
                    UserNotificationRecord.KIND_ADMIN -> "অ্যাডমিন"
                    "staff_notice" -> "অ্যাডমিন"
                    else -> notice.kind
                },
                fontFamily = Kalpurush,
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

@Composable
private fun MessageCard(item: AdminMessageRecord) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = if (item.isFromAdmin) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant
        },
        modifier = Modifier.fillMaxWidth().testTag("dashboard_message_${item.id}")
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                if (item.isFromAdmin) "অ্যাডমিন" else "আপনি",
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 12.sp
            )
            if (item.subject.isNotBlank()) {
                Text(item.subject, fontFamily = Kalpurush, fontWeight = FontWeight.SemiBold)
            }
            Text(item.body, fontFamily = Kalpurush, fontSize = 14.sp)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.End),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (item.createdAt.isNotBlank()) {
                    Text(
                        shortDateTime(item.createdAt),
                        fontFamily = Kalpurush,
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                if (!item.isFromAdmin) {
                    Icon(
                        imageVector = if (item.isRead) Icons.Default.DoneAll else Icons.Default.Done,
                        contentDescription = if (item.isRead) "দেখা হয়েছে" else "পাঠানো হয়েছে",
                        tint = if (item.isRead) Color(0xFF25D366) else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun AdminMessageComposer(
    status: String?,
    saving: Boolean,
    onSend: (String, String) -> Unit,
    onSeeAll: () -> Unit
) {
    var subject by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("dashboard_message_composer")) {
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
            label = { Text("অ্যাডমিনকে বার্তা", fontFamily = Kalpurush) },
            minLines = 3,
            modifier = Modifier.fillMaxWidth().testTag("dashboard_admin_message_body")
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedButton(onClick = onSeeAll, modifier = Modifier.weight(1f)) {
                Text("সব বার্তা", fontFamily = Kalpurush)
            }
            Button(
                onClick = {
                    onSend(subject, body)
                    body = ""
                },
                enabled = !saving && body.isNotBlank(),
                modifier = Modifier.testTag("dashboard_admin_message_send")
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null)
                Text(" পাঠান", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun ArticleStatusCard(article: SubmittedBlogRecord) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().testTag("dashboard_article_${article.id}")
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(article.title, fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
            Text(
                statusLabel(article.status),
                fontFamily = Kalpurush,
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

@Composable
private fun CommentStatusCard(comment: CommentRecord) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().testTag("dashboard_comment_${comment.id}")
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (comment.blogTitle.isNotBlank()) {
                Text(comment.blogTitle, fontFamily = Kalpurush, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            }
            Text(comment.content, fontFamily = Kalpurush, fontSize = 14.sp, maxLines = 4)
            Text(
                if (comment.isPublished) "প্রকাশিত" else "পর্যালোচনায়",
                fontFamily = Kalpurush,
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

private fun statusLabel(status: String): String {
    return when (status.lowercase()) {
        "pending" -> "অপেক্ষমাণ"
        "published", "approved" -> "প্রকাশিত"
        "rejected" -> "প্রত্যাখ্যাত"
        "reviewed" -> "পর্যালোচিত"
        else -> status
    }
}
