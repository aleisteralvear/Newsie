package com.aleisteralvear.newsie.workers

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.aleisteralvear.newsie.NewsieApplication
import com.aleisteralvear.newsie.domain.models.AppPreferences
import com.aleisteralvear.newsie.domain.models.DefaultSeedData
import java.util.concurrent.TimeUnit

class FeedSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val app = applicationContext as? NewsieApplication ?: return Result.failure()
        val container = app.container
        val prefs = container.repository.getPreferences(DefaultSeedData.DEFAULT_WORKSPACE_ID)

        // Refresh only public workspace + any currently unlocked private workspace cleanly;
        // locked private workspaces are NEVER accessed or exposed in background sync.
        val publicReport = container.repository.syncWorkspace(DefaultSeedData.DEFAULT_WORKSPACE_ID)

        for (unlockedId in container.vaultManager.unlockedWorkspaceIds.value) {
            if (unlockedId != DefaultSeedData.DEFAULT_WORKSPACE_ID) {
                container.repository.syncWorkspace(unlockedId)
            }
        }

        if (publicReport.insertedArticles > 0 &&
            (prefs.breakingNotifications || prefs.categoryNotifications)
        ) {
            NewsieNotificationManager.notifyPublicFeedUpdates(
                context = applicationContext,
                insertedCount = publicReport.insertedArticles,
                isBreaking = prefs.breakingNotifications,
            )
        }

        return Result.success()
    }

    companion object {
        private const val WORK_NAME = "newsie_periodic_feed_sync"

        fun scheduleFromPreferences(context: Context, prefs: AppPreferences) {
            val wm = WorkManager.getInstance(context)
            if (prefs.refreshIntervalMinutes <= 0) {
                wm.cancelUniqueWork(WORK_NAME)
                return
            }

            val intervalMinutes = prefs.refreshIntervalMinutes.coerceAtLeast(15).toLong()
            val networkType = if (prefs.wifiOnlyUpdates) {
                NetworkType.UNMETERED
            } else {
                NetworkType.CONNECTED
            }

            val constraints = Constraints.Builder()
                .setRequiredNetworkType(networkType)
                .setRequiresBatteryNotLow(true)
                .build()

            val request = PeriodicWorkRequestBuilder<FeedSyncWorker>(
                intervalMinutes,
                TimeUnit.MINUTES,
            )
                .setConstraints(constraints)
                .build()

            wm.enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }
    }
}
