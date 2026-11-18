package com.aleisteralvear.newsie.ui.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BookmarkAdd
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aleisteralvear.newsie.domain.models.Article
import com.aleisteralvear.newsie.domain.models.ArticleLayoutDensity
import com.aleisteralvear.newsie.domain.models.Category
import com.aleisteralvear.newsie.domain.models.DefaultSeedData
import com.aleisteralvear.newsie.domain.models.RefreshState
import com.aleisteralvear.newsie.domain.models.SavedFeedConfig
import com.aleisteralvear.newsie.domain.models.SortOrder
import com.aleisteralvear.newsie.domain.models.TextSizeOption
import com.aleisteralvear.newsie.ui.components.ArticleCard
import com.aleisteralvear.newsie.ui.components.ArticleCardVariant

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    articles: List<Article>,
    totalArticles: Int,
    hasMore: Boolean,
    isLoadingMore: Boolean,
    loadError: String?,
    categories: List<Category>,
    selectedCategoryId: String,
    sortOrder: SortOrder,
    savedConfigs: List<SavedFeedConfig>,
    layoutDensity: ArticleLayoutDensity,
    showImages: Boolean,
    textSize: TextSizeOption,
    refreshState: RefreshState,
    isTabletLayout: Boolean,
    onSelectCategory: (String) -> Unit,
    onChangeSortOrder: (SortOrder) -> Unit,
    onApplySavedConfig: (SavedFeedConfig) -> Unit,
    onSaveFeedConfig: (String) -> Unit,
    onOpenCategoryManager: () -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onToggleBookmark: (String) -> Unit,
    onOpenArticle: (Article) -> Unit,
    onGoToSources: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var showSortMenu by remember { mutableStateOf(false) }
    var showSavedMenu by remember { mutableStateOf(false) }
    var showSaveViewField by remember { mutableStateOf(false) }
    var viewNameDraft by remember { mutableStateOf("") }

    val selectedCategoryName = if (selectedCategoryId == DefaultSeedData.ALL_NEWS_CATEGORY_ID) {
        "All News"
    } else {
        categories.firstOrNull { it.id == selectedCategoryId }?.name ?: "News"
    }

    PullToRefreshBox(
        isRefreshing = refreshState.isRefreshing,
        onRefresh = onRefresh,
        modifier = modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = if (isTabletLayout) 28.dp else 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = selectedCategoryName.uppercase(),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.tertiary,
                    )
                    Text(
                        text = "Today's Dispatch",
                        style = MaterialTheme.typography.displaySmall,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                    Text(
                        text = buildString {
                            append(refreshState.statusMessage ?: refreshState.lastRefreshedLabel)
                            append(" · ${articles.size} of $totalArticles stories")
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box {
                        OutlinedButton(onClick = { showSortMenu = true }) {
                            Icon(Icons.Outlined.Tune, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(sortOrder.label, style = MaterialTheme.typography.labelMedium)
                        }
                        DropdownMenu(
                            expanded = showSortMenu,
                            onDismissRequest = { showSortMenu = false },
                        ) {
                            SortOrder.entries.forEach { order ->
                                DropdownMenuItem(
                                    text = { Text(order.label) },
                                    onClick = {
                                        showSortMenu = false
                                        onChangeSortOrder(order)
                                    },
                                )
                            }
                        }
                    }

                    if (savedConfigs.isNotEmpty()) {
                        Box {
                            OutlinedButton(onClick = { showSavedMenu = true }) {
                                Text("Views (${savedConfigs.size})", style = MaterialTheme.typography.labelMedium)
                            }
                            DropdownMenu(
                                expanded = showSavedMenu,
                                onDismissRequest = { showSavedMenu = false },
                            ) {
                                savedConfigs.forEach { cfg ->
                                    DropdownMenuItem(
                                        text = { Text(cfg.name) },
                                        onClick = {
                                            showSavedMenu = false
                                            onApplySavedConfig(cfg)
                                        },
                                    )
                                }
                            }
                        }
                    }

                    OutlinedButton(onClick = { showSaveViewField = !showSaveViewField }) {
                        Icon(Icons.Outlined.BookmarkAdd, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Save View", style = MaterialTheme.typography.labelMedium)
                    }

                    OutlinedButton(onClick = onOpenCategoryManager) {
                        Icon(Icons.Outlined.Category, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Categories", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }

            if (showSaveViewField) {
                item {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            OutlinedTextField(
                                value = viewNameDraft,
                                onValueChange = { if (it.length <= 50) viewNameDraft = it },
                                label = { Text("Preset name") },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                            Spacer(Modifier.width(8.dp))
                            Button(
                                onClick = {
                                    if (viewNameDraft.isNotBlank()) {
                                        onSaveFeedConfig(viewNameDraft.trim())
                                        viewNameDraft = ""
                                        showSaveViewField = false
                                    }
                                },
                            ) {
                                Text("Save")
                            }
                        }
                    }
                }
            }

            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val chipColors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primary,
                        selectedLabelColor = MaterialTheme.colorScheme.onPrimary,
                    )
                    FilterChip(
                        selected = selectedCategoryId == DefaultSeedData.ALL_NEWS_CATEGORY_ID,
                        onClick = { onSelectCategory(DefaultSeedData.ALL_NEWS_CATEGORY_ID) },
                        label = { Text("All News") },
                        colors = chipColors,
                    )
                    categories.filter { it.enabled }.forEach { cat ->
                        FilterChip(
                            selected = selectedCategoryId == cat.id,
                            onClick = { onSelectCategory(cat.id) },
                            label = { Text(cat.name) },
                            colors = chipColors,
                        )
                    }
                }
                HorizontalDivider(
                    modifier = Modifier.padding(top = 6.dp),
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
            }

            if (loadError != null) {
                item {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.errorContainer,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            modifier = Modifier.padding(14.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = loadError,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                                modifier = Modifier.weight(1f),
                            )
                            TextButton(onClick = onRefresh) {
                                Text("Retry")
                            }
                        }
                    }
                }
            }

            if (articles.isEmpty()) {
                item {
                    Surface(
                        shape = RoundedCornerShape(14.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(
                            modifier = Modifier.padding(24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text(
                                text = "No stories in $selectedCategoryName",
                                style = MaterialTheme.typography.headlineSmall,
                            )
                            Text(
                                text = "No indexed articles match this category yet, or its source is disabled in Sources.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                if (selectedCategoryId != DefaultSeedData.ALL_NEWS_CATEGORY_ID) {
                                    Button(onClick = { onSelectCategory(DefaultSeedData.ALL_NEWS_CATEGORY_ID) }) {
                                        Text("View All News")
                                    }
                                }
                                OutlinedButton(onClick = onGoToSources) {
                                    Text("Manage Sources")
                                }
                            }
                        }
                    }
                }
            } else if (layoutDensity == ArticleLayoutDensity.EDITORIAL) {
                val lead = articles.first()
                val features = articles.drop(1).take(2)
                val listItems = articles.drop(3)

                item(key = "lead-${lead.id}") {
                    ArticleCard(
                        article = lead,
                        variant = ArticleCardVariant.LEAD,
                        showImages = showImages,
                        textSize = textSize,
                        onToggleBookmark = onToggleBookmark,
                        onOpenArticle = onOpenArticle,
                    )
                }

                if (features.isNotEmpty()) {
                    item(key = "features-section") {
                        if (isTabletLayout && features.size == 2) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(16.dp),
                            ) {
                                features.forEach { feat ->
                                    ArticleCard(
                                        article = feat,
                                        variant = ArticleCardVariant.FEATURE,
                                        showImages = showImages,
                                        textSize = textSize,
                                        onToggleBookmark = onToggleBookmark,
                                        onOpenArticle = onOpenArticle,
                                        modifier = Modifier.weight(1f),
                                    )
                                }
                            }
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                                features.forEach { feat ->
                                    ArticleCard(
                                        article = feat,
                                        variant = ArticleCardVariant.FEATURE,
                                        showImages = showImages,
                                        textSize = textSize,
                                        onToggleBookmark = onToggleBookmark,
                                        onOpenArticle = onOpenArticle,
                                    )
                                }
                            }
                        }
                    }
                }

                if (listItems.isNotEmpty()) {
                    item {
                        Text(
                            text = "Latest Reporting",
                            style = MaterialTheme.typography.titleLarge,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                    }
                    if (isTabletLayout) {
                        val rows = listItems.chunked(2)
                        items(rows, key = { row -> row.joinToString("-") { it.id } }) { pair ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(20.dp),
                            ) {
                                pair.forEach { art ->
                                    ArticleCard(
                                        article = art,
                                        variant = ArticleCardVariant.COMPACT,
                                        showImages = showImages,
                                        textSize = textSize,
                                        onToggleBookmark = onToggleBookmark,
                                        onOpenArticle = onOpenArticle,
                                        modifier = Modifier.weight(1f),
                                    )
                                }
                                if (pair.size == 1) Spacer(Modifier.weight(1f))
                            }
                        }
                    } else {
                        items(listItems, key = { it.id }) { art ->
                            ArticleCard(
                                article = art,
                                variant = ArticleCardVariant.COMPACT,
                                showImages = showImages,
                                textSize = textSize,
                                onToggleBookmark = onToggleBookmark,
                                onOpenArticle = onOpenArticle,
                            )
                        }
                    }
                }
            } else {
                items(articles, key = { it.id }) { art ->
                    ArticleCard(
                        article = art,
                        variant = ArticleCardVariant.COMPACT,
                        showImages = showImages,
                        textSize = textSize,
                        onToggleBookmark = onToggleBookmark,
                        onOpenArticle = onOpenArticle,
                    )
                }
            }

            if (articles.isNotEmpty()) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 12.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (hasMore) {
                            OutlinedButton(
                                enabled = !isLoadingMore,
                                onClick = onLoadMore,
                            ) {
                                if (isLoadingMore) {
                                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                                    Spacer(Modifier.width(8.dp))
                                }
                                Text("Load more stories")
                            }
                        } else {
                            Text(
                                text = "End of dispatch · $totalArticles stories shown",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}
