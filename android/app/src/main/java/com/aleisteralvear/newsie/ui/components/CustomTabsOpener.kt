package com.aleisteralvear.newsie.ui.components

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.ui.graphics.toArgb
import com.aleisteralvear.newsie.network.security.UrlSecurityGuard
import com.aleisteralvear.newsie.ui.theme.NewsieColors

object CustomTabsOpener {
    fun openArticleUrl(context: Context, rawUrl: String): Boolean {
        val safeUri = try {
            UrlSecurityGuard.validateFeedUrlSyntax(rawUrl, allowCleartextHttp = true)
            Uri.parse(rawUrl)
        } catch (_: Exception) {
            return false
        }

        return try {
            val colors = CustomTabColorSchemeParams.Builder()
                .setToolbarColor(NewsieColors.DeepNavy.toArgb())
                .build()
            val customTabs = CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(colors)
                .setShowTitle(true)
                .setShareState(CustomTabsIntent.SHARE_STATE_ON)
                .build()
            customTabs.launchUrl(context, safeUri)
            true
        } catch (_: Exception) {
            runCatching {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, safeUri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }.isSuccess
        }
    }

    fun shareArticleUrl(context: Context, title: String, publisher: String, url: String) {
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "$publisher — $title")
            putExtra(Intent.EXTRA_TEXT, "$publisher — $title\n$url")
        }
        val chooser = Intent.createChooser(sendIntent, "Share article").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { context.startActivity(chooser) }
    }
}
