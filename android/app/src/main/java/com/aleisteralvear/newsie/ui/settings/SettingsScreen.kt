package com.aleisteralvear.newsie.ui.settings

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aleisteralvear.newsie.domain.models.AppPreferences
import com.aleisteralvear.newsie.domain.models.AppTheme
import com.aleisteralvear.newsie.domain.models.ArticleLayoutDensity
import com.aleisteralvear.newsie.domain.models.NotificationFrequency
import com.aleisteralvear.newsie.domain.models.SortOrder
import com.aleisteralvear.newsie.domain.models.TextSizeOption
import com.aleisteralvear.newsie.workers.NewsieNotificationManager

@Composable
fun SettingsScreen(
    preferences: AppPreferences,
    onUpdatePreferences: ((AppPreferences) -> AppPreferences) -> Unit,
    onClearSearchHistory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var notifGranted by remember {
        mutableStateOf(NewsieNotificationManager.hasNotificationPermission(context))
    }
    val notifPermLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
        notifGranted = granted
    }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = "CONFIGURATION",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.tertiary,
                )
                Text(
                    text = "Settings",
                    style = MaterialTheme.typography.displaySmall,
                )
            }
        }

        item {
            SettingsCard(title = "Appearance") {
                SettingChipGroup(
                    label = "Theme",
                    description = "Warm paper light mode or deep navy dark mode",
                    options = AppTheme.entries.map { it to it.value.replaceFirstChar(Char::uppercase) },
                    selected = preferences.theme,
                    onSelect = { mode -> onUpdatePreferences { it.copy(theme = mode) } },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingChipGroup(
                    label = "Article Layout",
                    description = "Editorial salience hierarchy or compact headline list",
                    options = ArticleLayoutDensity.entries.map {
                        it to it.value.replaceFirstChar(Char::uppercase)
                    },
                    selected = preferences.layoutDensity,
                    onSelect = { d -> onUpdatePreferences { it.copy(layoutDensity = d) } },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingChipGroup(
                    label = "Text Size",
                    description = "Adjust headline and excerpt typography scale",
                    options = TextSizeOption.entries.map { it to it.value.replaceFirstChar(Char::uppercase) },
                    selected = preferences.textSize,
                    onSelect = { size -> onUpdatePreferences { it.copy(textSize = size) } },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingSwitchRow(
                    label = "Display Article Images",
                    description = "Show editorial photography on feed cards and previews",
                    checked = preferences.showImages,
                    onCheckedChange = { v -> onUpdatePreferences { it.copy(showImages = v) } },
                )
            }
        }

        item {
            SettingsCard(title = "News Preferences") {
                SettingChipGroup(
                    label = "Articles Per Page",
                    description = "Number of stories loaded per pagination step",
                    options = AppPreferences.PAGE_SIZE_OPTIONS.map { it to "$it" },
                    selected = preferences.articlesPerPage,
                    onSelect = { count -> onUpdatePreferences { it.copy(articlesPerPage = count) } },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingChipGroup(
                    label = "Default Article Sorting",
                    description = "Ordering applied across Home feed dispatches",
                    options = SortOrder.entries.map { it to it.label },
                    selected = preferences.sortOrder,
                    onSelect = { ord -> onUpdatePreferences { it.copy(sortOrder = ord) } },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingChipGroup(
                    label = "Background Refresh Interval",
                    description = "WorkManager schedule respecting Android battery limits",
                    options = listOf(
                        15 to "15m",
                        30 to "30m",
                        60 to "1h",
                        180 to "3h",
                        360 to "6h",
                        720 to "12h",
                        0 to "Manual",
                    ),
                    selected = preferences.refreshIntervalMinutes,
                    onSelect = { mins -> onUpdatePreferences { it.copy(refreshIntervalMinutes = mins) } },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingSwitchRow(
                    label = "Wi-Fi Only Updates",
                    description = "Defer automatic background sync on metered mobile networks",
                    checked = preferences.wifiOnlyUpdates,
                    onCheckedChange = { v -> onUpdatePreferences { it.copy(wifiOnlyUpdates = v) } },
                )
            }
        }

        item {
            SettingsCard(title = "Notifications & Privacy") {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !notifGranted) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Notification Permission", style = MaterialTheme.typography.titleSmall)
                            Text(
                                "Required on Android 13+ for local feed alerts",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        OutlinedButton(
                            onClick = { notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) },
                        ) {
                            Text("Allow")
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }

                SettingSwitchRow(
                    label = "Breaking News Alerts",
                    description = "Post local Android notifications when major updates arrive",
                    checked = preferences.breakingNotifications,
                    onCheckedChange = { v ->
                        if (v && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !notifGranted) {
                            notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        }
                        onUpdatePreferences { it.copy(breakingNotifications = v) }
                    },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingSwitchRow(
                    label = "Category Digest Alerts",
                    description = "Summarize new items in enabled public categories",
                    checked = preferences.categoryNotifications,
                    onCheckedChange = { v ->
                        if (v && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !notifGranted) {
                            notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        }
                        onUpdatePreferences { it.copy(categoryNotifications = v) }
                    },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingChipGroup(
                    label = "Notification Frequency",
                    description = "Local notification cadence",
                    options = NotificationFrequency.entries.map { it to it.label },
                    selected = preferences.notificationFrequency,
                    onSelect = { freq -> onUpdatePreferences { it.copy(notificationFrequency = freq) } },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingSwitchRow(
                    label = "Reading History",
                    description = "Record opened articles locally within this workspace",
                    checked = preferences.readingHistoryEnabled,
                    onCheckedChange = { v -> onUpdatePreferences { it.copy(readingHistoryEnabled = v) } },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingSwitchRow(
                    label = "Search History",
                    description = "Remember recent local searches on the Search tab",
                    checked = preferences.searchHistoryEnabled,
                    onCheckedChange = { v -> onUpdatePreferences { it.copy(searchHistoryEnabled = v) } },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SettingSwitchRow(
                    label = "Privacy Screen Shield",
                    description = "Hide reading views immediately when switching away from app",
                    checked = preferences.privacyScreenEnabled,
                    onCheckedChange = { v -> onUpdatePreferences { it.copy(privacyScreenEnabled = v) } },
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Clear stored search history",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedButton(onClick = onClearSearchHistory) {
                        Text("Clear History")
                    }
                }
            }
        }

        item {
            SettingsCard(title = "About Newsie") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    InfoPairRow("Release", "1.0 (Native Android)")
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    InfoPairRow("Storage & Encryption", "Room + SQLCipher · Android Keystore")
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    InfoPairRow("Feed Protocols", "RSS 2.0 · Atom 1.0 · OPML 2.0")
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    InfoPairRow("Data Handling", "Local-only · Zero Telemetry · No Account Required")
                }
            }
        }
    }
}

@Composable
private fun SettingsCard(
    title: String,
    content: @Composable () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(8.dp))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Spacer(Modifier.height(6.dp))
            content()
        }
    }
}

@Composable
private fun <T> SettingChipGroup(
    label: String,
    description: String,
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
) {
    Column(modifier = Modifier.padding(vertical = 8.dp)) {
        Text(text = label, style = MaterialTheme.typography.titleSmall)
        Text(
            text = description,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            options.forEach { (value, title) ->
                FilterChip(
                    selected = value == selected,
                    onClick = { onSelect(value) },
                    label = { Text(title) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primary,
                        selectedLabelColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                )
            }
        }
    }
}

@Composable
private fun SettingSwitchRow(
    label: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text(text = label, style = MaterialTheme.typography.titleSmall)
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun InfoPairRow(key: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(text = key, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text = value, style = MaterialTheme.typography.labelMedium)
    }
}
