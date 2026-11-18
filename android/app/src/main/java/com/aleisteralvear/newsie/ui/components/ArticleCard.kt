package com.aleisteralvear.newsie.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.Newspaper
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.aleisteralvear.newsie.domain.models.Article
import com.aleisteralvear.newsie.domain.models.TextSizeOption
import com.aleisteralvear.newsie.ui.theme.NewsieColors

enum class ArticleCardVariant { LEAD, FEATURE, COMPACT }

@Composable
fun ArticleCard(
    article: Article,
    variant: ArticleCardVariant,
    showImages: Boolean,
    textSize: TextSizeOption,
    onToggleBookmark: (String) -> Unit,
    onOpenArticle: (Article) -> Unit,
    modifier: Modifier = Modifier,
) {
    val headlineSize = headlineFontSize(variant, textSize)
    val bodySize = bodyFontSize(textSize)

    when (variant) {
        ArticleCardVariant.LEAD -> {
            Column(
                modifier = modifier
                    .fillMaxWidth()
                    .clickable { onOpenArticle(article) }
                    .padding(bottom = 16.dp),
            ) {
                if (showImages) {
                    EditorialArticleImage(
                        imageUrl = article.imageUrl,
                        imageAlt = article.imageAlt,
                        publisher = article.publisher,
                        modifier = Modifier
                            .fillMaxWidth()
                            .aspectRatio(16f / 9f)
                            .clip(RoundedCornerShape(12.dp)),
                    )
                    Spacer(Modifier.height(14.dp))
                }
                ArticleMetaRow(article = article)
                Spacer(Modifier.height(6.dp))
                Text(
                    text = article.title,
                    style = MaterialTheme.typography.headlineMedium.copy(
                        fontSize = headlineSize,
                        lineHeight = headlineSize * 1.2f,
                    ),
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = article.description,
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontSize = bodySize,
                        lineHeight = bodySize * 1.48f,
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(10.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = { onOpenArticle(article) }) {
                        Text(
                            text = "READ BRIEFING",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.tertiary,
                            letterSpacing = 1.2.sp,
                        )
                    }
                    BookmarkIconButton(
                        isBookmarked = article.isBookmarked,
                        title = article.title,
                        onClick = { onToggleBookmark(article.id) },
                    )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }

        ArticleCardVariant.FEATURE -> {
            Surface(
                modifier = modifier
                    .fillMaxWidth()
                    .clickable { onOpenArticle(article) },
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    if (showImages) {
                        EditorialArticleImage(
                            imageUrl = article.imageUrl,
                            imageAlt = article.imageAlt,
                            publisher = article.publisher,
                            modifier = Modifier
                                .fillMaxWidth()
                                .aspectRatio(16f / 10f)
                                .clip(RoundedCornerShape(10.dp)),
                        )
                        Spacer(Modifier.height(10.dp))
                    }
                    ArticleMetaRow(article = article)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = article.title,
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontSize = headlineSize,
                            lineHeight = headlineSize * 1.22f,
                        ),
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = article.description,
                        style = MaterialTheme.typography.bodyMedium.copy(
                            fontSize = bodySize,
                            lineHeight = bodySize * 1.42f,
                        ),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(8.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(onClick = { onOpenArticle(article) }) {
                            Text(
                                text = "READ STORY",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.tertiary,
                                letterSpacing = 1.sp,
                            )
                        }
                        BookmarkIconButton(
                            isBookmarked = article.isBookmarked,
                            title = article.title,
                            onClick = { onToggleBookmark(article.id) },
                        )
                    }
                }
            }
        }

        ArticleCardVariant.COMPACT -> {
            Column(
                modifier = modifier
                    .fillMaxWidth()
                    .clickable { onOpenArticle(article) },
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 14.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Top,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        ArticleMetaRow(article = article)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = article.title,
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontSize = headlineSize,
                                lineHeight = headlineSize * 1.25f,
                            ),
                            color = MaterialTheme.colorScheme.onBackground,
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = article.description,
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontSize = bodySize,
                                lineHeight = bodySize * 1.4f,
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(horizontalAlignment = Alignment.End) {
                        if (showImages && !article.imageUrl.isNullOrBlank()) {
                            EditorialArticleImage(
                                imageUrl = article.imageUrl,
                                imageAlt = article.imageAlt,
                                publisher = article.publisher,
                                modifier = Modifier
                                    .size(width = 88.dp, height = 64.dp)
                                    .clip(RoundedCornerShape(8.dp)),
                            )
                            Spacer(Modifier.height(2.dp))
                        }
                        BookmarkIconButton(
                            isBookmarked = article.isBookmarked,
                            title = article.title,
                            onClick = { onToggleBookmark(article.id) },
                        )
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

@Composable
private fun ArticleMetaRow(article: Article) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text = article.categoryName.uppercase(),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.tertiary,
            maxLines = 1,
        )
        Text("·", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            text = article.publisher,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        Text("·", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            text = "${article.readTimeMinutes}m",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (article.isSample) {
            Text("·", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                text = "Sample",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.tertiary,
            )
        }
    }
}

@Composable
private fun BookmarkIconButton(
    isBookmarked: Boolean,
    title: String,
    onClick: () -> Unit,
) {
    IconButton(
        onClick = onClick,
        modifier = Modifier.semantics {
            contentDescription = if (isBookmarked) "Remove bookmark for $title" else "Bookmark $title"
        },
    ) {
        Icon(
            imageVector = if (isBookmarked) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
            contentDescription = null,
            tint = if (isBookmarked) NewsieColors.AntiqueGold else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun EditorialArticleImage(
    imageUrl: String?,
    imageAlt: String,
    publisher: String,
    modifier: Modifier = Modifier,
) {
    var failed by remember(imageUrl) { mutableStateOf(false) }

    if (imageUrl.isNullOrBlank() || failed) {
        Box(
            modifier = modifier.background(
                Brush.linearGradient(
                    colors = listOf(NewsieColors.DeepNavy, NewsieColors.NavyElevated),
                ),
            ),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(12.dp),
            ) {
                Icon(
                    imageVector = Icons.Outlined.Newspaper,
                    contentDescription = null,
                    tint = NewsieColors.AntiqueGoldLight,
                    modifier = Modifier.size(26.dp),
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = publisher,
                    fontFamily = FontFamily.Serif,
                    fontSize = 12.sp,
                    color = NewsieColors.WarmPaper.copy(alpha = 0.85f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    } else {
        AsyncImage(
            model = imageUrl,
            contentDescription = imageAlt.ifBlank { publisher },
            contentScale = ContentScale.Crop,
            onError = { failed = true },
            modifier = modifier,
        )
    }
}

private fun headlineFontSize(variant: ArticleCardVariant, textSize: TextSizeOption): TextUnit =
    when (variant) {
        ArticleCardVariant.LEAD -> when (textSize) {
            TextSizeOption.SMALL -> 21.sp
            TextSizeOption.MEDIUM -> 25.sp
            TextSizeOption.LARGE -> 29.sp
        }
        ArticleCardVariant.FEATURE -> when (textSize) {
            TextSizeOption.SMALL -> 17.sp
            TextSizeOption.MEDIUM -> 20.sp
            TextSizeOption.LARGE -> 23.sp
        }
        ArticleCardVariant.COMPACT -> when (textSize) {
            TextSizeOption.SMALL -> 15.sp
            TextSizeOption.MEDIUM -> 17.sp
            TextSizeOption.LARGE -> 20.sp
        }
    }

private fun bodyFontSize(textSize: TextSizeOption): TextUnit = when (textSize) {
    TextSizeOption.SMALL -> 13.sp
    TextSizeOption.MEDIUM -> 14.sp
    TextSizeOption.LARGE -> 16.sp
}
