package com.ningshingche.app.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Stars
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ningshingche.app.data.portal.ContributionStats
import com.ningshingche.app.data.portal.Contributor
import com.ningshingche.app.data.portal.ContributorBoard
import com.ningshingche.app.data.portal.PortalError
import com.ningshingche.app.ui.components.PortalAsyncImage
import com.ningshingche.app.ui.editorial.EditorialShape
import com.ningshingche.app.ui.editorial.EditorialSpace
import com.ningshingche.app.ui.editorial.EmptyState
import com.ningshingche.app.ui.editorial.ErrorState
import com.ningshingche.app.ui.editorial.Hairline
import com.ningshingche.app.ui.editorial.LocalEditorialTokens
import com.ningshingche.app.ui.editorial.toBengaliNumeral
import com.ningshingche.app.ui.theme.Kalpurush

/**
 * সেরা অবদানকারী — the monthly contributor board.
 *
 * A registered-reader page: the database refuses the RPC to anyone without a
 * session (the function is granted to `authenticated` alone), so the gate is
 * real and this screen only has to present it. A guest gets [onSignInClick].
 *
 * Every card opens that reader's public page, where their songs and articles
 * are listed — "linked to user_profile", as the owner asked.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContributorScreen(
    isSignedIn: Boolean,
    currentUserId: String?,
    loadBoard: suspend () -> Result<ContributorBoard>,
    loadOwnScore: suspend () -> ContributionStats?,
    onBackClick: () -> Unit,
    onSignInClick: () -> Unit,
    onContributorClick: (String) -> Unit
) {
    var board by remember { mutableStateOf<ContributorBoard?>(null) }
    var own by remember { mutableStateOf<ContributionStats?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    // A refused call is not a broken screen: it means the app has no session the
    // database will accept (usually an expired token), and the honest answer is
    // the sign-in gate again — not "for signed-in readers" shown to somebody who
    // is signed in.
    var refused by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var reloadToken by remember { mutableIntStateOf(0) }

    LaunchedEffect(isSignedIn, reloadToken) {
        if (!isSignedIn) {
            board = null
            own = null
            return@LaunchedEffect
        }
        loading = true
        error = null
        refused = false
        loadBoard()
            .onSuccess { board = it }
            .onFailure { failure ->
                error = failure.message ?: "তালিকা আনা যায়নি।"
                refused = failure is PortalError.SignedOut ||
                    (failure is PortalError.Http && failure.code in 401..403)
            }
        own = loadOwnScore()
        loading = false
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "সেরা অবদানকারী",
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold,
                            fontSize = 17.sp
                        )
                        val month = board?.monthKey.orEmpty()
                        if (month.isNotBlank()) {
                            Text(
                                text = "${monthLabel(month)}-এর তালিকা",
                                fontFamily = Kalpurush,
                                fontSize = 11.5.sp,
                                color = LocalEditorialTokens.current.inkMuted
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBackClick, modifier = Modifier.testTag("contributors_back")) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "পেছনে")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background
                )
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .testTag("contributors_screen")
        ) {
            when {
                !isSignedIn || (refused && board == null) -> SignedOutGate(onSignInClick, expired = refused)

                loading && board == null -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) { CircularProgressIndicator() }

                board == null -> ErrorState(
                    message = error ?: "তালিকা আনা যায়নি।",
                    onRetry = { reloadToken += 1 }
                )

                else -> {
                    val rows = board!!.contributors
                    val mine = own
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(bottom = 88.dp),
                        verticalArrangement = Arrangement.spacedBy(EditorialSpace.sm)
                    ) {
                        if (mine != null && !mine.isEmpty) {
                            item { MyStandingCard(points = mine.points) }
                        }

                        if (rows.isEmpty()) {
                            item {
                                EmptyState(
                                    message = "এই মাসে এখনো কেউ পয়েন্ট নেয়নি।",
                                    modifier = Modifier.padding(EditorialSpace.lg)
                                )
                            }
                        }

                        itemsIndexed(rows, key = { _, row -> row.userId }) { index, row ->
                            ContributorCard(
                                rank = index + 1,
                                contributor = row,
                                highlight = currentUserId != null && row.userId == currentUserId,
                                onClick = { onContributorClick(row.userId) }
                            )
                        }
                    }
                }
            }
        }
    }
}



/**
 * The reader's own points for the month, in one line.
 *
 * The weights used to be spelled out under this — fifty for an article, thirty
 * for a song, one per view — and the owner asked for the explanation to go. What
 * is left is the one number a reader opens this page for, and the card explains
 * nothing it does not have to.
 */
@Composable
private fun MyStandingCard(points: Int) {
    val tokens = LocalEditorialTokens.current
    Surface(
        shape = RoundedCornerShape(EditorialShape.card),
        color = tokens.accentSoft,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter, vertical = EditorialSpace.xs)
            .testTag("contributor_my_points")
    ) {
        Row(
            modifier = Modifier.padding(horizontal = EditorialSpace.md, vertical = EditorialSpace.sm),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Stars,
                contentDescription = null,
                tint = tokens.accent,
                modifier = Modifier.size(18.dp)
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = "আপনার পয়েন্ট",
                fontFamily = Kalpurush,
                fontSize = 13.5.sp,
                color = tokens.inkSoft,
                modifier = Modifier.weight(1f)
            )
            Text(
                text = toBengaliNumeral(points),
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

/** The gate a guest sees instead of the board. */
@Composable
private fun SignedOutGate(onSignInClick: () -> Unit, expired: Boolean = false) {
    val tokens = LocalEditorialTokens.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(EditorialSpace.xl),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = Icons.Default.Lock,
            contentDescription = null,
            tint = tokens.inkMuted,
            modifier = Modifier.size(40.dp)
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = "এই পাতা নিবন্ধিত পাঠকের জন্য",
            fontFamily = Kalpurush,
            fontWeight = FontWeight.Bold,
            fontSize = 17.sp,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = if (expired) {
                "আপনার সেশনের মেয়াদ শেষ হয়েছে। আবার সাইন ইন করলে তালিকা ও পয়েন্ট দেখা যাবে।"
            } else {
                "অবদানকারীর তালিকা ও আপনার নিজের পয়েন্ট দেখতে সাইন ইন করুন।"
            },
            fontFamily = Kalpurush,
            fontSize = 13.sp,
            color = tokens.inkMuted,
            textAlign = TextAlign.Center
        )
        Spacer(Modifier.height(16.dp))
        Button(onClick = onSignInClick, modifier = Modifier.testTag("contributors_sign_in")) {
            Text("সাইন ইন করুন", fontFamily = Kalpurush, fontWeight = FontWeight.Bold)
        }
    }
}

/**
 * One contributor: rank, picture, name, what they published, and their points.
 * The whole card is the link to that reader's public page.
 *
 * Laid out as two rows rather than one crowded line: who they are on top — a
 * picture the size of a person's face, their name, and the two counts that are
 * about work rather than time in the app — and their points on a row of their
 * own underneath, where the number has room to be the largest thing in the card.
 */
@Composable
private fun ContributorCard(
    rank: Int,
    contributor: Contributor,
    highlight: Boolean = false,
    onClick: () -> Unit
) {
    val tokens = LocalEditorialTokens.current
    val medal = when (rank) {
        1 -> Color(0xFFD4A017)
        2 -> Color(0xFF9AA0A6)
        3 -> Color(0xFFB06E3B)
        else -> tokens.inkMuted
    }
    Surface(
        shape = RoundedCornerShape(EditorialShape.card),
        color = if (highlight) tokens.accentSoft else MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = EditorialSpace.gutter)
            .clickable(onClick = onClick)
            .testTag("contributor_card_$rank")
    ) {
        Column {
            Row(
                modifier = Modifier.padding(
                    start = EditorialSpace.md,
                    end = EditorialSpace.md,
                    top = EditorialSpace.md,
                    bottom = EditorialSpace.sm
                ),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(62.dp)
                        .clip(CircleShape)
                        .background(tokens.surfaceSunken),
                    contentAlignment = Alignment.Center
                ) {
                    if (contributor.avatarUrl.isNotBlank()) {
                        PortalAsyncImage(
                            url = contributor.avatarUrl,
                            contentDescription = contributor.name,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        Text(
                            text = contributor.name.trim().take(1).ifBlank { "ন" },
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold,
                            fontSize = 24.sp,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
                Spacer(Modifier.width(EditorialSpace.sm))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RankBadge(rank = rank, medal = medal)
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = contributor.name,
                            fontFamily = Kalpurush,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    // Only the two counts that are about the work itself.
                    Text(
                        text = "প্রবন্ধ ${toBengaliNumeral(contributor.stats.articles)} · " +
                            "গান ${toBengaliNumeral(contributor.stats.songs)}",
                        fontFamily = Kalpurush,
                        fontSize = 12.5.sp,
                        color = tokens.inkMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }

            Hairline(Modifier.padding(horizontal = EditorialSpace.md))

            Row(
                modifier = Modifier.padding(
                    start = EditorialSpace.md,
                    end = EditorialSpace.md,
                    top = EditorialSpace.sm,
                    bottom = EditorialSpace.sm
                ),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.Stars,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = toBengaliNumeral(contributor.points),
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    color = MaterialTheme.colorScheme.primary
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = "পয়েন্ট",
                    fontFamily = Kalpurush,
                    fontSize = 12.5.sp,
                    color = tokens.inkMuted
                )
                if (highlight) {
                    Spacer(Modifier.weight(1f))
                    Text(
                        text = "আপনি",
                        fontFamily = Kalpurush,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp,
                        color = tokens.accent
                    )
                }
            }
        }
    }
}

/** The medal or number that says where this reader stands. */
@Composable
private fun RankBadge(rank: Int, medal: Color) {
    Box(
        modifier = Modifier
            .size(26.dp)
            .clip(CircleShape)
            .background(if (rank <= 3) medal.copy(alpha = 0.18f) else Color.Transparent),
        contentAlignment = Alignment.Center
    ) {
        if (rank <= 3) {
            Icon(
                imageVector = Icons.Default.EmojiEvents,
                contentDescription = null,
                tint = medal,
                modifier = Modifier.size(16.dp)
            )
        } else {
            Text(
                text = toBengaliNumeral(rank),
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 13.sp,
                color = medal
            )
        }
    }
}





/** The twelve month names, in the order the database numbers them. */
private val BENGALI_MONTHS = listOf(
    "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
    "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"
)

/**
 * `2026-09` → `সেপ্টেম্বর`. The month key is the database's; the name is the
 * reader's, so the two never have to agree on a date format.
 *
 * An empty key — the board has not arrived yet — falls back to the month on the
 * device, which is what the caller is about to be shown anyway.
 */
internal fun monthNameOf(monthKey: String): String {
    val month = monthKey.split("-").getOrNull(1)?.toIntOrNull()
    if (month in 1..12) return BENGALI_MONTHS[month - 1]
    // Calendar, not java.time: minSdk is 24 and this module has no desugaring.
    @Suppress("DEPRECATION")
    val now = java.util.Calendar.getInstance().get(java.util.Calendar.MONTH)
    return BENGALI_MONTHS[now.coerceIn(0, 11)]
}

/**
 * `2026-09` → `সেপ্টেম্বর ২০২৬`. The board page's app bar wants the year too.
 */
internal fun monthLabel(monthKey: String): String {
    val year = monthKey.split("-").getOrNull(0)?.toIntOrNull() ?: return monthKey
    val month = monthKey.split("-").getOrNull(1)?.toIntOrNull()
    if (month == null || month !in 1..12) return monthKey
    return "${BENGALI_MONTHS[month - 1]} ${toBengaliNumeral(year)}"
}

/**
 * One row of the home page's board: the same five readers, drawn for a rail
 * rather than a page.
 *
 * The face is larger than it was and the pills are gone — articles, songs, views
 * and minutes in the app all used to sit under the name, which made a five-row
 * list look like a spreadsheet. What is left is who they are and what they
 * earned: the name, and the points as the one number on the row.
 */
@Composable
internal fun ContributorMiniRow(contributor: Contributor, rank: Int, onClick: () -> Unit) {
    val tokens = LocalEditorialTokens.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = EditorialSpace.md, vertical = EditorialSpace.xs),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = toBengaliNumeral(rank),
            fontFamily = Kalpurush,
            fontWeight = FontWeight.Bold,
            fontSize = 13.sp,
            color = if (rank <= 3) MaterialTheme.colorScheme.primary else tokens.inkMuted,
            modifier = Modifier.width(18.dp)
        )
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(tokens.surfaceSunken),
            contentAlignment = Alignment.Center
        ) {
            if (contributor.avatarUrl.isNotBlank()) {
                PortalAsyncImage(
                    url = contributor.avatarUrl,
                    contentDescription = contributor.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                Text(
                    text = contributor.name.trim().take(1).ifBlank { "ন" },
                    fontFamily = Kalpurush,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }
        Spacer(Modifier.width(EditorialSpace.sm))
        Column(Modifier.weight(1f)) {
            Text(
                text = contributor.name,
                fontFamily = Kalpurush,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.5.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = "প্রবন্ধ ${toBengaliNumeral(contributor.stats.articles)} · " +
                    "গান ${toBengaliNumeral(contributor.stats.songs)}",
                fontFamily = Kalpurush,
                fontSize = 11.5.sp,
                color = tokens.inkMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Spacer(Modifier.width(EditorialSpace.xs))
        Column(horizontalAlignment = Alignment.End) {
            Text(
                text = toBengaliNumeral(contributor.points),
                fontFamily = Kalpurush,
                fontWeight = FontWeight.Bold,
                fontSize = 17.sp,
                color = MaterialTheme.colorScheme.primary
            )
            Text(
                text = "পয়েন্ট",
                fontFamily = Kalpurush,
                fontSize = 10.5.sp,
                color = tokens.inkMuted
            )
        }
    }
}

/** Convenience for callers that have the board rows as a list. */
@Composable
internal fun ContributorList(
    contributors: List<Contributor>,
    onContributorClick: (String) -> Unit,
    header: (@Composable () -> Unit)? = null
) {
    Column(Modifier.fillMaxWidth()) {
        header?.invoke()
        contributors.forEachIndexed { index, contributor ->
            if (index > 0) Hairline(Modifier.padding(horizontal = EditorialSpace.md))
            ContributorMiniRow(
                contributor = contributor,
                rank = index + 1,
                onClick = { onContributorClick(contributor.userId) }
            )
        }
    }
}
