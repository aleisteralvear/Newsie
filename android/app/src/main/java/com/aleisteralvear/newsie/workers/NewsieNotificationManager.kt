package com.aleisteralvear.newsie.workers

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.aleisteralvear.newsie.MainActivity
import com.aleisteralvear.newsie.R

object NewsieNotificationManager {
    const val CHANNEL_BREAKING = "newsie_breaking_dispatches"
    const val CHANNEL_CATEGORY = "newsie_category_digests"

    fun ensureChannels(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val breaking = NotificationChannel(
            CHANNEL_BREAKING,
            context.getString(R.string.notif_channel_breaking_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.notif_channel_breaking_desc)
            setShowBadge(true)
        }
        val category = NotificationChannel(
            CHANNEL_CATEGORY,
            context.getString(R.string.notif_channel_category_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = context.getString(R.string.notif_channel_category_desc)
        }
        manager.createNotificationChannel(breaking)
        manager.createNotificationChannel(category)
    }

    fun hasNotificationPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Posts ONLY public workspace local news summaries when enabled.
     * Private workspace counts, titles, or sources are NEVER surfaced in system notifications.
     */
    fun notifyPublicFeedUpdates(
        context: Context,
        insertedCount: Int,
        isBreaking: Boolean,
    ) {
        if (insertedCount <= 0 || !hasNotificationPermission(context)) return
        ensureChannels(context)

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            1001,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val channelId = if (isBreaking) CHANNEL_BREAKING else CHANNEL_CATEGORY
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("Newsie Dispatch")
            .setContentText("$insertedCount new ${if (insertedCount == 1) "story" else "stories"} available locally")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        try {
            NotificationManagerCompat.from(context).notify(2001, notification)
        } catch (_: SecurityException) {
            // Permission revoked concurrently; ignore cleanly
        }
    }
}
