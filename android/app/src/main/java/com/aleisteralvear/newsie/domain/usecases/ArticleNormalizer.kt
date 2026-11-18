package com.aleisteralvear.newsie.domain.usecases

import com.aleisteralvear.newsie.domain.models.Article
import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ceil

object ArticleNormalizer {
    private val trackingParams = setOf(
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "fbclid",
        "gclid",
        "mc_cid",
        "mc_eid",
        "ref",
        "source",
    )

    private val htmlTagRegex = Regex("<[^>]+>")
    private val whitespaceRegex = Regex("\\s+")

    fun normalizeArticleUrl(rawUrl: String): String {
        val trimmed = rawUrl.trim()
        return try {
            val uri = URI(trimmed)
            val scheme = (uri.scheme ?: "https").lowercase(Locale.US)
            val host = uri.host?.lowercase(Locale.US) ?: return trimmed
            val port = if (uri.port != -1 &&
                !((scheme == "https" && uri.port == 443) || (scheme == "http" && uri.port == 80))
            ) ":${uri.port}" else ""
            val path = uri.rawPath?.takeIf { it.isNotEmpty() } ?: "/"
            val filteredQuery = uri.rawQuery
                ?.split("&")
                ?.filter { pair ->
                    val key = pair.substringBefore("=").lowercase(Locale.US)
                    key.isNotEmpty() && key !in trackingParams
                }
                ?.joinToString("&")
                ?.takeIf { it.isNotEmpty() }
            buildString {
                append(scheme).append("://").append(host).append(port).append(path)
                if (filteredQuery != null) append("?").append(filteredQuery)
            }
        } catch (_: Exception) {
            trimmed
        }
    }

    fun computeFingerprint(publisher: String, title: String, url: String): String {
        val normPub = publisher.trim().lowercase(Locale.US)
        val normTitle = title.trim().lowercase(Locale.US).replace(whitespaceRegex, " ")
        val normUrl = normalizeArticleUrl(url).lowercase(Locale.US)
        val payload = "$normPub::$normTitle::$normUrl".toByteArray(StandardCharsets.UTF_8)
        val digest = MessageDigest.getInstance("SHA-256").digest(payload)
        return digest.take(12).joinToString("") { "%02x".format(it) }
    }

    fun stripHtmlToPlainText(raw: String): String {
        if (raw.isBlank()) return ""
        return raw
            .replace(Regex("(?i)<br\\s*/?>"), "\n")
            .replace(Regex("(?i)</p>"), "\n\n")
            .replace(htmlTagRegex, " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&apos;", "'")
            .replace("&nbsp;", " ")
            .replace(Regex("[ \\t\\x0B\\f\\r]+"), " ")
            .replace(Regex("\\n{3,}"), "\n\n")
            .trim()
    }

    fun estimateReadTimeMinutes(text: String): Int {
        val words = text.trim().split(whitespaceRegex).count { it.isNotBlank() }
        return maxOf(1, ceil(words / 220.0).toInt())
    }

    fun parseFlexibleTimestamp(rawDate: String?, fallbackEpochMs: Long = System.currentTimeMillis()): Long {
        if (rawDate.isNullOrBlank()) return fallbackEpochMs
        val trimmed = rawDate.trim()
        runCatching { return Instant.parse(trimmed).toEpochMilli() }
        runCatching { return OffsetDateTime.parse(trimmed, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant().toEpochMilli() }
        runCatching { return ZonedDateTime.parse(trimmed, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() }
        val rfcVariants = listOf(
            "EEE, dd MMM yyyy HH:mm:ss zzz",
            "EEE, d MMM yyyy HH:mm:ss Z",
            "EEE, dd MMM yyyy HH:mm:ss Z",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd",
        )
        for (pattern in rfcVariants) {
            runCatching {
                val fmt = DateTimeFormatter.ofPattern(pattern, Locale.US)
                return ZonedDateTime.parse(trimmed, fmt).toInstant().toEpochMilli()
            }
        }
        return fallbackEpochMs
    }

    fun formatRelativeLabel(epochMs: Long, nowMs: Long = System.currentTimeMillis()): String {
        val diffMs = (nowMs - epochMs).coerceAtLeast(0L)
        val mins = diffMs / 60_000L
        return when {
            mins < 2L -> "Just now"
            mins < 60L -> "${mins}m ago"
            mins < 24L * 60L -> "${mins / 60L}h ago"
            else -> "${mins / (24L * 60L)}d ago"
        }
    }

    fun deduplicate(existingFingerprints: Set<String>, candidates: List<Article>): List<Article> {
        val seen = existingFingerprints.toMutableSet()
        val unique = mutableListOf<Article>()
        for (item in candidates) {
            if (seen.add(item.fingerprint)) {
                unique.add(item)
            }
        }
        return unique
    }
}
