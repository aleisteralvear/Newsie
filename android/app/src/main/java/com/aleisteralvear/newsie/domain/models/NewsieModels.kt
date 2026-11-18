package com.aleisteralvear.newsie.domain.models

enum class AppTheme(val value: String) {
    LIGHT("light"),
    DARK("dark"),
    SYSTEM("system");

    companion object {
        fun fromValue(raw: String?): AppTheme =
            entries.firstOrNull { it.value == raw } ?: SYSTEM
    }
}

enum class ArticleLayoutDensity(val value: String) {
    EDITORIAL("editorial"),
    COMPACT("compact");

    companion object {
        fun fromValue(raw: String?): ArticleLayoutDensity =
            entries.firstOrNull { it.value == raw } ?: EDITORIAL
    }
}

enum class TextSizeOption(val value: String) {
    SMALL("small"),
    MEDIUM("medium"),
    LARGE("large");

    companion object {
        fun fromValue(raw: String?): TextSizeOption =
            entries.firstOrNull { it.value == raw } ?: MEDIUM
    }
}

enum class SortOrder(val value: String, val label: String) {
    NEWEST("newest", "Newest first"),
    OLDEST("oldest", "Oldest first"),
    PUBLISHER("publisher", "Publisher"),
    CATEGORY("category", "Category");

    companion object {
        fun fromValue(raw: String?): SortOrder =
            entries.firstOrNull { it.value == raw } ?: NEWEST
    }
}

enum class NotificationFrequency(val value: String, val label: String) {
    IMMEDIATE("immediate", "Immediate"),
    HOURLY("hourly", "Hourly digest"),
    DAILY("daily", "Daily briefing");

    companion object {
        fun fromValue(raw: String?): NotificationFrequency =
            entries.firstOrNull { it.value == raw } ?: IMMEDIATE
    }
}

enum class SearchScope(val value: String, val label: String) {
    CACHED("cached", "Cached"),
    SELECTED_SOURCES("selected_sources", "Selected Sources"),
    ALL_ENABLED("all_enabled", "All Enabled");
}

enum class FeedFormat(val value: String) {
    RSS("RSS"),
    ATOM("Atom");

    companion object {
        fun fromValue(raw: String?): FeedFormat =
            entries.firstOrNull { it.value.equals(raw, ignoreCase = true) } ?: RSS
    }
}

enum class WorkspaceAuthMethod(val value: String, val label: String) {
    NONE("none", "Unprotected (Public)"),
    PASSPHRASE("passphrase", "Passphrase"),
    BIOMETRIC("biometric", "Biometric (Strong)"),
    BOTH("both", "Biometric + Passphrase (MFA)");

    companion object {
        fun fromValue(raw: String?): WorkspaceAuthMethod =
            entries.firstOrNull { it.value == raw } ?: PASSPHRASE
    }
}

enum class NavTab(val label: String) {
    HOME("Home"),
    SEARCH("Search"),
    SAVED("Saved"),
    SOURCES("Sources"),
    SETTINGS("Settings"),
}

data class AppPreferences(
    val theme: AppTheme = AppTheme.SYSTEM,
    val layoutDensity: ArticleLayoutDensity = ArticleLayoutDensity.EDITORIAL,
    val showImages: Boolean = true,
    val textSize: TextSizeOption = TextSizeOption.MEDIUM,
    val articlesPerPage: Int = 20,
    val sortOrder: SortOrder = SortOrder.NEWEST,
    val refreshIntervalMinutes: Int = 60,
    val wifiOnlyUpdates: Boolean = false,
    val breakingNotifications: Boolean = false,
    val categoryNotifications: Boolean = false,
    val notificationFrequency: NotificationFrequency = NotificationFrequency.IMMEDIATE,
    val readingHistoryEnabled: Boolean = true,
    val searchHistoryEnabled: Boolean = true,
    val privacyScreenEnabled: Boolean = true,
) {
    companion object {
        val PAGE_SIZE_OPTIONS = listOf(10, 20, 30, 50, 100)
        val REFRESH_INTERVAL_OPTIONS = listOf(15, 30, 60, 180, 360, 720, 0)
    }
}

data class Category(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val isCustom: Boolean,
    val orderIndex: Int,
)

data class NewsSource(
    val id: String,
    val name: String,
    val url: String,
    val format: FeedFormat,
    val categoryId: String,
    val enabled: Boolean,
    val description: String = "",
    val lastUpdatedLabel: String = "Ready",
    val etag: String? = null,
    val lastModified: String? = null,
    val lastSyncError: String? = null,
    val isSample: Boolean = false,
)

data class DirectorySourceEntry(
    val id: String,
    val name: String,
    val url: String,
    val format: FeedFormat,
    val categoryId: String,
    val description: String,
)

data class Article(
    val id: String,
    val fingerprint: String,
    val sourceId: String,
    val publisher: String,
    val author: String? = null,
    val categoryId: String,
    val categoryName: String,
    val title: String,
    val description: String,
    val excerpt: String,
    val url: String,
    val imageUrl: String? = null,
    val imageAlt: String = "",
    val publishedAtIso: String,
    val publishedEpochMs: Long,
    val publishedLabel: String,
    val readTimeMinutes: Int,
    val keywords: List<String> = emptyList(),
    val isBookmarked: Boolean = false,
    val isSample: Boolean = false,
)

data class ReadingHistoryEntry(
    val id: String,
    val articleId: String,
    val publisher: String,
    val title: String,
    val openedAtEpochMs: Long,
    val openedAtLabel: String,
)

data class SavedFeedConfig(
    val id: String,
    val name: String,
    val categoryIds: List<String>,
    val sourceIds: List<String>,
    val sortOrder: SortOrder,
)

data class WorkspaceSummary(
    val id: String,
    val displayName: String,
    val isPrivate: Boolean,
    val isLocked: Boolean,
    val authMethod: WorkspaceAuthMethod,
    val autoLockMinutes: Int,
    val lastActivityEpochMs: Long?,
    val createdAtEpochMs: Long,
    val hasBiometricKey: Boolean,
    val biometricInvalidated: Boolean = false,
)

data class PrivateAccessStatus(
    val hasSearchPassphrase: Boolean = false,
    val doubleTapIntervalMs: Int = 350,
    val hasPrivateWorkspaces: Boolean = false,
    val hasAnyBiometricKeys: Boolean = false,
)

data class RefreshState(
    val isRefreshing: Boolean = false,
    val lastRefreshedEpochMs: Long? = null,
    val lastRefreshedLabel: String = "Local cache ready",
    val statusMessage: String? = null,
)

data class FeedPage(
    val items: List<Article>,
    val totalCount: Int,
    val hasMore: Boolean,
)

data class SourceSyncResult(
    val sourceId: String,
    val sourceName: String,
    val status: String, // "updated", "not_modified", "skipped", "error"
    val insertedCount: Int,
    val errorMessage: String? = null,
)

data class SyncReport(
    val workspaceId: String,
    val totalSourcesChecked: Int,
    val insertedArticles: Int,
    val updatedSources: Int,
    val notModifiedSources: Int,
    val failedSources: Int,
    val breakingCount: Int,
    val results: List<SourceSyncResult>,
)
