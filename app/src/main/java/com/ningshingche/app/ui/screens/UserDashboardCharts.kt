package com.ningshingche.app.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ningshingche.app.data.portal.ViewDay
import com.ningshingche.app.data.remote.CommentRecord
import com.ningshingche.app.data.remote.SubmittedBlogRecord
import com.ningshingche.app.data.remote.SubmittedMusicRecord
import com.ningshingche.app.ui.editorial.toBengaliNumeral
import com.ningshingche.app.ui.theme.Kalpurush
import java.util.Calendar

/**
 * Charts for the signed-in dashboard, drawn from the reader's own records.
 *
 * Everything here is plain Compose layout (no chart library, no Canvas text):
 * the project pins Compose to BOM 2024.09.00 and adding a charting dependency
 * for two small graphs is not worth the APK weight or the version risk.
 *
 * Time bucketting uses [Calendar], not `java.time`: `minSdk` is 24 and the
 * module has no core-library desugaring, so `java.time` would crash on
 * Android 7.
 */

private val BENGALI_MONTHS = listOf(
    "জানু", "ফেব", "মার্চ", "এপ্রিল", "মে", "জুন",
    "জুলাই", "আগস্ট", "সেপ্টে", "অক্টো", "নভে", "ডিসে"
)

/** One calendar month of the reader's activity. [month] is 0-based, like `Calendar.MONTH`. */
internal data class MonthlyActivity(
    val year: Int,
    val month: Int,
    val articles: Int,
    val songs: Int,
    val comments: Int
) {
    val label: String get() = BENGALI_MONTHS.getOrElse(month) { "" }
    val total: Int get() = articles + songs + comments
}

/**
 * Counts the reader's submissions per month for the last [months] months,
 * oldest bucket first. Records without a parsable `created_at` are ignored
 * rather than bucketed into the current month.
 */
internal fun monthlyActivity(
    articles: List<SubmittedBlogRecord>,
    tracks: List<SubmittedMusicRecord>,
    comments: List<CommentRecord>,
    months: Int = 6,
    now: Calendar = Calendar.getInstance()
): List<MonthlyActivity> {
    val cursor = (now.clone() as Calendar).apply { set(Calendar.DAY_OF_MONTH, 1) }
    val buckets = ArrayList<Pair<Int, Int>>(months)
    repeat(months) {
        buckets.add(cursor.get(Calendar.YEAR) to cursor.get(Calendar.MONTH))
        cursor.add(Calendar.MONTH, -1)
    }
    buckets.reverse()

    val articlesByMonth = articles.groupingBy { monthKey(it.createdAt) }.eachCount()
    val tracksByMonth = tracks.groupingBy { monthKey(it.createdAt) }.eachCount()
    val commentsByMonth = comments.groupingBy { monthKey(it.createdAt) }.eachCount()

    return buckets.map { (year, month) ->
        val key = "%04d-%02d".format(year, month + 1)
        MonthlyActivity(
            year = year,
            month = month,
            articles = articlesByMonth[key] ?: 0,
            songs = tracksByMonth[key] ?: 0,
            comments = commentsByMonth[key] ?: 0
        )
    }
}

/** `"2026-09-05T10:17:57.384108+00:00"` → `"2026-09"`; null when unparsable. */
private fun monthKey(createdAt: String): String? {
    if (createdAt.length < 7) return null
    val year = createdAt.substring(0, 4).toIntOrNull() ?: return null
    val month = createdAt.substring(5, 7).toIntOrNull() ?: return null
    if (month !in 1..12) return null
    return "%04d-%02d".format(year, month)
}

/**
 * The two dashboard graphs: contributions per month and where the reader's
 * articles stand. Sits under the metrics grid on the dashboard home tab.
 */
@Composable
internal fun ContributionCharts(
    articles: List<SubmittedBlogRecord>,
    tracks: List<SubmittedMusicRecord>,
    comments: List<CommentRecord>,
    modifier: Modifier = Modifier
) {
    val activity = remember(articles, tracks, comments) {
        monthlyActivity(articles, tracks, comments)
    }
    val totalActivity = activity.sumOf { it.total }
    val published = articles.count {
        it.status.equals("Published", true) || it.status.equals("Approved", true)
    }
    val pending = articles.count { it.status.equals("Pending", true) }
    val rejected = articles.count { it.status.equals("Rejected", true) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = modifier) {
        ChartCard(
            title = "কার্যক্রম",
            subtitle = if (totalActivity > 0) {
                "শেষ ৬ মাসে মোট ${toBengaliNumeral(totalActivity)}টি"
            } else {
                "শেষ ৬ মাস"
            }
        ) {
            if (totalActivity == 0) {
                ChartEmptyHint("শেষ ছয় মাসে কোনো কার্যক্রম নেই।")
            } else {
                ActivityBars(activity)
                Spacer(Modifier.height(10.dp))
                Legend(
                    entries = listOf(
                        "প্রবন্ধ" to (activity.sumOf { it.articles } to MaterialTheme.colorScheme.primary),
                        "গান" to (activity.sumOf { it.songs } to MaterialTheme.colorScheme.tertiary),
                        "মন্তব্য" to (activity.sumOf { it.comments } to MaterialTheme.colorScheme.secondary)
                    )
                )
            }
        }

        ChartCard(
            title = "প্রবন্ধের অবস্থা",
            subtitle = "মোট ${toBengaliNumeral(articles.size)}টি জমা"
        ) {
            if (articles.isEmpty()) {
                ChartEmptyHint("এখনো কোনো প্রবন্ধ জমা দেওয়া হয়নি।")
            } else {
                StatusBar(published = published, pending = pending, rejected = rejected)
                Spacer(Modifier.height(10.dp))
                Legend(
                    entries = listOf(
                        "প্রকাশিত" to (published to MaterialTheme.colorScheme.primary),
                        "অপেক্ষমাণ" to (pending to MaterialTheme.colorScheme.tertiary),
                        "প্রত্যাখ্যাত" to (rejected to MaterialTheme.colorScheme.error)
                    )
                )
            }
        }
    }
}

/**
 * Views over time, from the database's own view events.
 *
 * The one graph on this screen that is not derived from the reader's local
 * records: each point is a day of counted views across the articles and songs
 * they published, so it keeps rising while nobody opens the dashboard. An empty
 * series (no views yet, or a database that has not run the migration) draws the
 * axis and says so rather than showing a flat line at zero.
 */
@Composable
internal fun ViewsOverTimeChart(
    series: List<ViewDay>,
    totalViews: Long,
    days: Int = 30,
    modifier: Modifier = Modifier
) {
    val counted = series.sumOf { it.views }
    val peak = series.maxOfOrNull { it.views } ?: 0L
    val accent = MaterialTheme.colorScheme.primary

    ChartCard(
        title = "সময়ের সাথে ভিউ",
        subtitle = if (totalViews > 0L) {
            "মোট ${toBengaliNumeral(totalViews)} · শেষ ${toBengaliNumeral(days)} দিনে ${toBengaliNumeral(counted)}"
        } else {
            "শেষ ${toBengaliNumeral(days)} দিন"
        },
        modifier = modifier
    ) {
        if (series.isEmpty()) {
            ChartEmptyHint("ভিউয়ের তথ্য এখনো পাওয়া যায়নি।")
            return@ChartCard
        }
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(120.dp)
        ) {
            val span = series.size.coerceAtLeast(2) - 1
            val top = peak.coerceAtLeast(1L).toFloat()
            val stepX = size.width / span
            fun point(index: Int): Offset {
                val value = series[index].views.coerceAtLeast(0L).toFloat()
                val y = size.height - (value / top) * (size.height - 6f) - 3f
                return Offset(index * stepX, y)
            }
            // Baseline, so an empty day still reads as a day.
            drawLine(
                color = accent.copy(alpha = 0.25f),
                start = Offset(0f, size.height - 1f),
                end = Offset(size.width, size.height - 1f),
                strokeWidth = 1f
            )
            val line = Path().apply {
                moveTo(point(0).x, point(0).y)
                for (index in 1..span) {
                    val current = point(index)
                    lineTo(current.x, current.y)
                }
            }
            // The fill under the line is the same path closed to the baseline.
            val area = Path().apply {
                addPath(line)
                lineTo(size.width, size.height)
                lineTo(0f, size.height)
                close()
            }
            drawPath(path = area, color = accent.copy(alpha = 0.12f))
            drawPath(
                path = line,
                color = accent,
                style = Stroke(width = 2.5f)
            )
            if (peak == 0L) {
                drawLine(
                    color = accent.copy(alpha = 0.5f),
                    start = Offset(0f, size.height / 2f),
                    end = Offset(size.width, size.height / 2f),
                    strokeWidth = 2f,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(12f, 10f))
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = series.first().day.takeLast(5),
                style = com.ningshingche.app.ui.editorial.EditorialType.Caption,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "সর্বোচ্চ ${toBengaliNumeral(peak)}",
                style = com.ningshingche.app.ui.editorial.EditorialType.Caption,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = series.last().day.takeLast(5),
                style = com.ningshingche.app.ui.editorial.EditorialType.Caption,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun ChartCard(
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, fontFamily = Kalpurush, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(
                subtitle,
                fontFamily = Kalpurush,
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(Modifier.height(12.dp))
            content()
        }
    }
}

@Composable
private fun ActivityBars(activity: List<MonthlyActivity>) {
    val peak = activity.maxOfOrNull { maxOf(it.articles, it.songs, it.comments) } ?: 0
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        activity.forEach { month ->
            Column(
                modifier = Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    modifier = Modifier.height(BAR_AREA_HEIGHT),
                    contentAlignment = Alignment.BottomCenter
                ) {
                    Row(
                        verticalAlignment = Alignment.Bottom,
                        horizontalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        MiniBar(month.articles, peak, MaterialTheme.colorScheme.primary)
                        MiniBar(month.songs, peak, MaterialTheme.colorScheme.tertiary)
                        MiniBar(month.comments, peak, MaterialTheme.colorScheme.secondary)
                    }
                }
                Spacer(Modifier.height(6.dp))
                Text(month.label, fontFamily = Kalpurush, fontSize = 10.sp, maxLines = 1)
            }
        }
    }
}

/** A single bar. Zero stays visible as a faint stub so the month is not blank. */
@Composable
private fun MiniBar(value: Int, peak: Int, color: Color) {
    val height = when {
        value <= 0 -> 3.dp
        peak <= 0 -> 3.dp
        else -> (BAR_AREA_HEIGHT * (value.toFloat() / peak)).coerceAtLeast(6.dp)
    }
    Box(
        modifier = Modifier
            .width(9.dp)
            .height(height)
            .clip(RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp))
            .background(if (value > 0) color else color.copy(alpha = 0.20f))
    )
}

/** One stacked bar: each status is a share of the reader's submitted articles. */
@Composable
private fun StatusBar(published: Int, pending: Int, rejected: Int) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(14.dp)
            .clip(RoundedCornerShape(7.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
    ) {
        if (published > 0) {
            Box(
                Modifier
                    .weight(published.toFloat())
                    .fillMaxHeight()
                    .background(MaterialTheme.colorScheme.primary)
            )
        }
        if (pending > 0) {
            Box(
                Modifier
                    .weight(pending.toFloat())
                    .fillMaxHeight()
                    .background(MaterialTheme.colorScheme.tertiary)
            )
        }
        if (rejected > 0) {
            Box(
                Modifier
                    .weight(rejected.toFloat())
                    .fillMaxHeight()
                    .background(MaterialTheme.colorScheme.error)
            )
        }
    }
}

@Composable
private fun Legend(entries: List<Pair<String, Pair<Int, Color>>>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        entries.forEach { (label, valueColor) ->
            val (value, color) = valueColor
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp)
            ) {
                Box(
                    Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(color)
                )
                Text(
                    "${label} ${toBengaliNumeral(value)}",
                    fontFamily = Kalpurush,
                    fontSize = 11.sp
                )
            }
        }
    }
}

@Composable
private fun ChartEmptyHint(text: String) {
    Text(
        text,
        fontFamily = Kalpurush,
        fontSize = 12.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
}

private val BAR_AREA_HEIGHT = 96.dp
