package com.ningshingche.app.ui.screens

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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ningshingche.app.data.remote.CommentRecord
import com.ningshingche.app.data.remote.SubmittedBlogRecord
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
    val metrics by viewModel.metrics.collectAsStateWithLifecycle()
    val loading by viewModel.isLoading.collectAsStateWithLifecycle()
    var tab by remember { mutableIntStateOf(0) }

    LaunchedEffect(user?.id) {
        if (user != null) viewModel.refresh()
    }

    Scaffold(
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
                    val name = user?.composedFullName().orEmpty().ifBlank { "পাঠক" }
                    Text("স্বাগতম, $name", fontFamily = Kalpurush, fontWeight = FontWeight.Bold, fontSize = 20.sp)
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

                item { MetricsGrid(metrics) }

                item {
                    Button(
                        onClick = onInboxClick,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("dashboard_inbox_button")
                    ) {
                        Text("বিজ্ঞপ্তি ও অ্যাডমিন বার্তা", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
                    }
                }

                item {
                    TabRow(selectedTabIndex = tab) {
                        Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("প্রবন্ধ", fontFamily = Kalpurush) })
                        Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("মন্তব্য", fontFamily = Kalpurush) })
                    }
                }

                if (tab == 0) {
                    if (articles.isEmpty()) {
                        item { Text("এখনো কোনো প্রবন্ধ জমা দেননি।", fontFamily = Kalpurush) }
                    } else {
                        items(articles, key = { it.id }) { article ->
                            ArticleStatusCard(article)
                        }
                    }
                } else {
                    if (comments.isEmpty()) {
                        item { Text("আপনার কোনো মন্তব্য পাওয়া যায়নি।", fontFamily = Kalpurush) }
                    } else {
                        items(comments, key = { it.id }) { comment ->
                            CommentStatusCard(comment)
                        }
                    }
                }
                item { Spacer(Modifier.height(72.dp)) }
            }
        }
    }
}

@Composable
private fun MetricsGrid(metrics: ReaderMetrics) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            MetricCard("প্রবন্ধ", metrics.totalArticles.toString(), Modifier.weight(1f))
            MetricCard("প্রকাশিত", metrics.publishedArticles.toString(), Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            MetricCard("অপেক্ষমাণ", metrics.pendingArticles.toString(), Modifier.weight(1f))
            MetricCard("মন্তব্য", metrics.comments.toString(), Modifier.weight(1f))
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
        Column(Modifier.padding(14.dp)) {
            Text(value, fontFamily = Kalpurush, fontWeight = FontWeight.Bold, fontSize = 22.sp)
            Text(label, fontFamily = Kalpurush, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ArticleStatusCard(article: SubmittedBlogRecord) {
    Surface(shape = RoundedCornerShape(14.dp), tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
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
    Surface(shape = RoundedCornerShape(14.dp), tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
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
