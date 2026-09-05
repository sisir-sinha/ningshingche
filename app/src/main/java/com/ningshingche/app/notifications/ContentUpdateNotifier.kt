package com.ningshingche.app.notifications

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.ningshingche.app.data.model.ReaderPreferences
import com.ningshingche.app.data.portal.HomeFeed
import com.ningshingche.app.data.portal.permalinkOf
import com.ningshingche.app.data.preferences.UserPreferencesRepository
import com.ningshingche.app.data.remote.AdminMessageRecord
import com.ningshingche.app.data.remote.UserNotificationRecord
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Turns a [HomeFeed] snapshot into Android system notifications.
 *
 * The first snapshot is a silent baseline. Later unseen items are posted only
 * when [notify] is true (background worker) and the matching setting is on.
 */
class ContentUpdateNotifier(
    private val context: Context,
    private val seenStore: SeenContentStore,
    private val notifications: AppNotificationManager,
    private val preferencesRepository: UserPreferencesRepository
) {
    private val mutex = Mutex()

    suspend fun ingest(feed: HomeFeed, notify: Boolean) = mutex.withLock {
        val prefs = preferencesRepository.readerPreferences.first()
        val versionCode = installedVersionCode()
        val settingsHash = settingsHash(feed)
        val incoming = noticesFrom(feed, versionCode, settingsHash, seenStore.lastVersionCode(), seenStore.lastSettingsHash())
        val seen = seenStore.seenKeys()
        val hasBaseline = seenStore.hasBaseline()
        val fresh = ContentUpdatePolicy.unseen(seen, incoming)

        if (!hasBaseline) {
            seenStore.markSeen(
                keys = incoming.map { it.seenKey },
                baseline = true,
                versionCode = versionCode,
                settingsHash = settingsHash
            )
            return
        }

        val enabled = fresh.filter { enabledFor(it.kind, prefs) }
        if (notify && prefs.notificationsEnabled) {
            ContentUpdatePolicy.drafts(hasBaseline = true, unseen = enabled).forEach { draft ->
                notifications.post(draft)
            }
        }

        seenStore.markSeen(
            keys = incoming.map { it.seenKey } + fresh.map { it.seenKey },
            versionCode = versionCode,
            settingsHash = settingsHash
        )
    }

    /**
     * Posts a system notification when the signed-in user receives a new
     * admin chat message or staff notice. The first inbox snapshot is silent.
     */
    suspend fun ingestInbox(
        userNotices: List<UserNotificationRecord>,
        messages: List<AdminMessageRecord>,
        notify: Boolean
    ) = mutex.withLock {
        val prefs = preferencesRepository.readerPreferences.first()
        val incoming = inboxNotices(userNotices, messages)
        if (incoming.isEmpty()) return
        val seen = seenStore.seenKeys()
        val hasInboxBaseline = incoming.any { it.seenKey in seen } ||
            seen.any { it.startsWith("${NotificationKind.MESSAGE.name}:") }
        val fresh = ContentUpdatePolicy.unseen(seen, incoming)

        if (!hasInboxBaseline) {
            seenStore.markSeen(keys = incoming.map { it.seenKey })
            return
        }

        val enabled = fresh.filter { enabledFor(it.kind, prefs) }
        if (notify && prefs.notificationsEnabled) {
            ContentUpdatePolicy.drafts(hasBaseline = true, unseen = enabled).forEach { draft ->
                notifications.post(draft)
            }
        }
        seenStore.markSeen(keys = incoming.map { it.seenKey } + fresh.map { it.seenKey })
    }

    private fun inboxNotices(
        notices: List<UserNotificationRecord>,
        messages: List<AdminMessageRecord>
    ): List<ContentNotice> {
        val fromChat = messages.filter { it.isFromAdmin && it.id.isNotBlank() }.map { item ->
            ContentNotice(
                kind = NotificationKind.MESSAGE,
                id = item.id,
                title = item.subject.ifBlank { "অ্যাডমিনের বার্তা" },
                body = item.body.take(180),
                uri = AppNotificationManager.ROUTE_INBOX
            )
        }
        val fromNotices = notices.filter {
            it.kind == UserNotificationRecord.KIND_ADMIN || it.kind == "staff_notice"
        }.map { item ->
            ContentNotice(
                kind = NotificationKind.MESSAGE,
                id = "notice-${item.id}",
                title = item.title.ifBlank { "অ্যাডমিনের বার্তা" },
                body = item.body.take(180),
                uri = AppNotificationManager.ROUTE_INBOX
            )
        }
        return (fromChat + fromNotices).distinctBy { it.id }
    }

    private fun noticesFrom(
        feed: HomeFeed,
        versionCode: Int,
        settingsHash: String,
        lastVersionCode: Int,
        lastSettingsHash: String
    ): List<ContentNotice> {
        val articles = (feed.latest + feed.hero + feed.special).distinctBy { it.id }.map { article ->
            ContentNotice(
                kind = NotificationKind.ARTICLE,
                id = article.id,
                title = article.title,
                body = article.subTitle.ifBlank { article.authorName },
                uri = permalinkOf(article.slug.ifBlank { article.id })
            )
        }
        val featured = feed.featured.map { article ->
            ContentNotice(
                kind = NotificationKind.FEATURED,
                id = article.id,
                title = article.title,
                body = article.authorName,
                uri = permalinkOf(article.slug.ifBlank { article.id })
            )
        }
        val videos = feed.videos.map { video ->
            ContentNotice(
                kind = NotificationKind.VIDEO,
                id = video.id,
                title = video.title,
                body = video.platform,
                uri = video.url
            )
        }
        val pdfs = feed.pdfBooks.map { book ->
            ContentNotice(
                kind = NotificationKind.PDF,
                id = book.id,
                title = book.title,
                body = book.authorOrEditor.ifBlank { book.category },
                uri = book.id
            )
        }
        val gallery = feed.gallery.map { item ->
            ContentNotice(
                kind = NotificationKind.GALLERY,
                id = item.id,
                title = item.title,
                body = item.category,
                uri = item.imageUrl
            )
        }
        val system = buildList {
            if (lastVersionCode > 0 && versionCode > lastVersionCode) {
                add(
                    ContentNotice(
                        kind = NotificationKind.SYSTEM,
                        id = "version-$versionCode",
                        title = "অ্যাপ আপডেট হয়েছে",
                        body = "নিংশিং চে-র নতুন সংস্করণ ইনস্টল আছে।",
                        uri = AppNotificationManager.ROUTE_SETTINGS
                    )
                )
            }
            if (lastSettingsHash.isNotBlank() && settingsHash.isNotBlank() && settingsHash != lastSettingsHash) {
                add(
                    ContentNotice(
                        kind = NotificationKind.SYSTEM,
                        id = "settings-$settingsHash",
                        title = "সাইট হালনাগাদ",
                        body = feed.settings.title.ifBlank { "নিংশিং চে" },
                        uri = AppNotificationManager.ROUTE_SETTINGS
                    )
                )
            }
        }
        return articles + featured + videos + pdfs + gallery + system
    }

    private fun enabledFor(kind: NotificationKind, prefs: ReaderPreferences): Boolean = when (kind) {
        NotificationKind.ARTICLE -> prefs.notificationNewArticles
        NotificationKind.FEATURED -> prefs.notificationFeatured
        NotificationKind.VIDEO -> prefs.notificationVideos
        NotificationKind.PDF -> prefs.notificationPdfs
        NotificationKind.SYSTEM -> prefs.notificationSystem
        NotificationKind.GALLERY -> prefs.notificationOther
        NotificationKind.MESSAGE -> prefs.notificationOther || prefs.notificationSystem
    }

    private fun settingsHash(feed: HomeFeed): String {
        val s = feed.settings
        return listOf(s.title, s.description, s.logoUrl, s.facebookUrl, s.youtubeUrl).joinToString("|")
    }

    private fun installedVersionCode(): Int {
        return runCatching {
            val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getPackageInfo(
                    context.packageName,
                    PackageManager.PackageInfoFlags.of(0)
                )
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(context.packageName, 0)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode.toInt()
            else @Suppress("DEPRECATION") info.versionCode
        }.getOrDefault(1)
    }
}
