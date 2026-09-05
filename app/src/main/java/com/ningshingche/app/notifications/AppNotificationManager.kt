package com.ningshingche.app.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.ningshingche.app.MainActivity
import com.ningshingche.app.R

/**
 * Thin wrapper around Android's [NotificationManager]. Channels are created
 * once; posting is a no-op when the user (or OS) has disabled that channel.
 */
class AppNotificationManager(private val context: Context) {

    companion object {
        const val CHANNEL_ARTICLES = "nsc_articles"
        const val CHANNEL_VIDEOS = "nsc_videos"
        const val CHANNEL_PDFS = "nsc_pdfs"
        const val CHANNEL_SYSTEM = "nsc_system"
        const val CHANNEL_GENERAL = "nsc_general"
        const val CHANNEL_MESSAGES = "nsc_messages"

        const val EXTRA_ROUTE = "nsc_route"
        const val EXTRA_TARGET_ID = "nsc_target_id"
        const val ROUTE_HOME = "home"
        const val ROUTE_ARTICLE = "article"
        const val ROUTE_PDF = "pdf"
        const val ROUTE_SETTINGS = "settings"
        const val ROUTE_INBOX = "user_inbox"
    }

    fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channels = listOf(
            NotificationChannel(CHANNEL_ARTICLES, "নতুন প্রবন্ধ", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "নতুন ও নির্বাচিত প্রবন্ধ প্রকাশিত হলে"
            },
            NotificationChannel(CHANNEL_VIDEOS, "নতুন ভিডিও", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "নতুন ভিডিও যোগ হলে"
            },
            NotificationChannel(CHANNEL_PDFS, "নতুন PDF বই", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "নতুন PDF বই প্রকাশিত হলে"
            },
            NotificationChannel(CHANNEL_SYSTEM, "সিস্টেম আপডেট", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "অ্যাপ ও সাইট হালনাগাদ"
            },
            NotificationChannel(CHANNEL_GENERAL, "অন্যান্য", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "গ্যালারি ও অন্যান্য আপডেট"
            },
            NotificationChannel(CHANNEL_MESSAGES, "অ্যাডমিন বার্তা", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "অ্যাডমিন নতুন বার্তা পাঠালে"
            }
        )
        manager.createNotificationChannels(channels)
    }

    fun areNotificationsEnabled(): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()

    fun post(draft: NotificationDraft) {
        if (!areNotificationsEnabled()) return
        val channel = channelFor(draft.kind)
        val pending = pendingIntent(draft)
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(ContextCompat.getColor(context, R.color.portal_maroon))
            .setContentTitle(draft.title)
            .setContentText(draft.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(draft.body))
            .setAutoCancel(true)
            .setPriority(priorityFor(draft.kind))
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setContentIntent(pending)
            .setGroup("nsc_${draft.kind.name}")
            .build()
        runCatching {
            NotificationManagerCompat.from(context).notify(draft.notificationId, notification)
        }
    }

    private fun channelFor(kind: NotificationKind): String = when (kind) {
        NotificationKind.ARTICLE, NotificationKind.FEATURED -> CHANNEL_ARTICLES
        NotificationKind.VIDEO -> CHANNEL_VIDEOS
        NotificationKind.PDF -> CHANNEL_PDFS
        NotificationKind.SYSTEM -> CHANNEL_SYSTEM
        NotificationKind.GALLERY -> CHANNEL_GENERAL
        NotificationKind.MESSAGE -> CHANNEL_MESSAGES
    }

    private fun priorityFor(kind: NotificationKind): Int = when (kind) {
        NotificationKind.ARTICLE, NotificationKind.FEATURED, NotificationKind.SYSTEM, NotificationKind.MESSAGE ->
            NotificationCompat.PRIORITY_HIGH
        else -> NotificationCompat.PRIORITY_DEFAULT
    }

    private fun pendingIntent(draft: NotificationDraft): PendingIntent {
        val uri = draft.uri
        val intent = when {
            uri.startsWith("http://") || uri.startsWith("https://") ->
                Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
                    `package` = if (uri.contains("ningshingche.com")) context.packageName else null
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                }
            else -> Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(EXTRA_ROUTE, routeFor(draft.kind))
                putExtra(EXTRA_TARGET_ID, draft.uri)
            }
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getActivity(context, draft.notificationId, intent, flags)
    }

    private fun routeFor(kind: NotificationKind): String = when (kind) {
        NotificationKind.ARTICLE, NotificationKind.FEATURED -> ROUTE_ARTICLE
        NotificationKind.PDF -> ROUTE_PDF
        NotificationKind.SYSTEM -> ROUTE_SETTINGS
        else -> ROUTE_HOME
    }
}
