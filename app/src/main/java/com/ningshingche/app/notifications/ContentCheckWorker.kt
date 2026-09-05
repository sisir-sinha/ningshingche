package com.ningshingche.app.notifications

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.ningshingche.app.NinghsingCheApp
import java.util.concurrent.TimeUnit

class ContentCheckWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val app = applicationContext as? NinghsingCheApp ?: return Result.retry()
        val feed = app.portalRepository.homeFeed().getOrNull() ?: return Result.retry()
        app.contentUpdateNotifier.ingest(feed, notify = true)
        return Result.success()
    }

    companion object {
        const val PERIODIC_NAME = "nsc_content_notifications"
        const val ONE_SHOT_NAME = "nsc_content_notifications_once"

        fun schedule(context: Context) {
            runCatching {
                val constraints = Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
                val periodic = PeriodicWorkRequestBuilder<ContentCheckWorker>(3, TimeUnit.HOURS)
                    .setConstraints(constraints)
                    .build()
                val once = OneTimeWorkRequestBuilder<ContentCheckWorker>()
                    .setConstraints(constraints)
                    .setInitialDelay(20, TimeUnit.MINUTES)
                    .build()
                val work = WorkManager.getInstance(context)
                work.enqueueUniquePeriodicWork(
                    PERIODIC_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    periodic
                )
                work.enqueueUniqueWork(
                    ONE_SHOT_NAME,
                    ExistingWorkPolicy.KEEP,
                    once
                )
            }.onFailure {
                android.util.Log.w("ContentCheckWorker", "WorkManager schedule skipped: ${it.message}")
            }
        }
    }
}
