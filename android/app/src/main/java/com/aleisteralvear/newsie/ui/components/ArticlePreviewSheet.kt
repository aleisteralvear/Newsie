package com.aleisteralvear.newsie.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aleisteralvear.newsie.domain.models.Article
import com.aleisteralvear.newsie.ui.theme.NewsieColors
import java.net.URI

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArticlePreviewSheet(
    article: Article,
    showImages: Boolean,
    onDismiss: () -> Unit,
    onToggleBookmark: (String) -> Unit,
) {
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val hostName = runCatching { URI(article.url).host ?: article.publisher }.getOrDefault(article.publisher)
    val paragraphs = article.excerpt.split("\n\n").filter { it.isNotBlank() }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "${article.categoryName.uppercase()} · ${article.publisher}",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.tertiary,
                    )
                    Text(
                        text = article.publishedLabel,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(
                        onClick = {
                            CustomTabsOpener.shareArticleUrl(context, article.title, article.publisher, article.url)
                        },
                    ) {
                        Icon(Icons.Outlined.Share, contentDescription = "Share article")
                    }
                    IconButton(onClick = { onToggleBookmark(article.id) }) {
                        Icon(
                            imageVector = if (article.isBookmarked) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
                            contentDescription = if (article.isBookmarked) "Remove bookmark" else "Bookmark article",
                            tint = if (article.isBookmarked) NewsieColors.AntiqueGold else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Outlined.Close, contentDescription = "Close article preview")
                    }
                }
            }

            HorizontalDivider(
                modifier = Modifier.padding(vertical = 12.dp),
                color = MaterialTheme.colorScheme.outlineVariant,
            )

            Text(
                text = article.title,
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = buildString {
                    if (!article.author.isNullOrBlank()) append("By ${article.author} · ")
                    append("${article.readTimeMinutes} min read")
                },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                letterSpacing = 0.8.sp,
            )

            if (showImages && !article.imageUrl.isNullOrBlank()) {
                Spacer(Modifier.height(14.dp))
                EditorialArticleImage(
                    imageUrl = article.imageUrl,
                    imageAlt = article.imageAlt,
                    publisher = article.publisher,
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(16f / 9f)
                        .clip(RoundedCornerShape(12.dp)),
                )
                if (article.imageAlt.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = article.imageAlt,
                        style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            paragraphs.forEach { para ->
                Text(
                    text = para,
                    style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 25.sp),
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Spacer(Modifier.height(12.dp))
            }

            HorizontalDivider(
                modifier = Modifier.padding(vertical = 10.dp),
                color = MaterialTheme.colorScheme.outlineVariant,
            )

            Text(
                text = "Showing syndicated feed excerpt in accordance with publisher feed terms.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = { CustomTabsOpener.openArticleUrl(context, article.url) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Open original at $hostName")
                Spacer(Modifier.width(8.dp))
                Icon(
                    imageVector = Icons.AutoMirrored.Outlined.OpenInNew,
                    contentDescription = null,
                )
            }
        }
    }
}
