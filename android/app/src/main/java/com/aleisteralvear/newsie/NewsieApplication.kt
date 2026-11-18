package com.aleisteralvear.newsie

import android.app.Application
import com.aleisteralvear.newsie.workers.NewsieNotificationManager

class NewsieApplication : Application() {
    val container: AppContainer by lazy { AppContainer(this) }

    override fun onCreate() {
        super.onCreate()
        NewsieNotificationManager.ensureChannels(this)
    }
}
