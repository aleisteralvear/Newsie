package com.aleisteralvear.newsie.ui.sources

import android.content.Intent
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material.icons.outlined.FileUpload
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aleisteralvear.newsie.data.repository.SourcePreviewResult
import com.aleisteralvear.newsie.domain.models.Category
import com.aleisteralvear.newsie.domain.models.DirectorySourceEntry
import com.aleisteralvear.newsie.domain.models.FeedFormat
import com.aleisteralvear.newsie.domain.models.NewsSource
import kotlinx.coroutines.launch
import java.nio.charset.StandardCharsets

@Composable
fun SourcesScreen(
    sources: List<NewsSource>,
    directory: List<DirectorySourceEntry>,
    categories: List<Category>,
    sourcePreview: SourcePreviewResult?,
    busy: Boolean,
    statusMessage: String?,
    errorMessage: String?,
    onToggleSource: (String) -> Unit,
    onUpdateSource: (String, String, String) -> Unit,
    onDeleteSource: (String) -> Unit,
    onTestSource: (String) -> Unit,
    onValidatePreview: (String, String) -> Unit,
    onAddSource: (String, String, FeedFormat, String, String) -> Unit,
    onImportOpml: (String) -> Unit,
    onBuildOpmlExport: suspend () -> String,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var activeSubTab by remember { mutableIntStateOf(0) }
    var editingSource by remember { mutableStateOf<NewsSource?>(null) }
    var opmlPasteDialogOpen by remember { mutableStateOf(false) }

    val openOpmlLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) {
            runCatching {
                context.contentResolver.openInputStream(uri)?.use { stream ->
                    stream.readBytes().toString(StandardCharsets.UTF_8)
                }
            }.getOrNull()?.let(onImportOpml)
        }
    }

    Column(modifier = modifier.fillMaxSize()) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
            Text(
                text = "PUBLISHER FEEDS & OPML",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.tertiary,
            )
            Text(
                text = "Sources",
                style = MaterialTheme.typography.displaySmall,
            )
        }

        if (statusMessage != null) {
            Surface(
                color = MaterialTheme.colorScheme.secondaryContainer,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                shape = RoundedCornerShape(10.dp),
            ) {
                Text(
                    text = statusMessage,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier.padding(12.dp),
                )
            }
        }

        if (errorMessage != null) {
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                shape = RoundedCornerShape(10.dp),
            ) {
                Text(
                    text = errorMessage,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(12.dp),
                )
            }
        }

        TabRow(selectedTabIndex = activeSubTab) {
            Tab(selected = activeSubTab == 0, onClick = { activeSubTab = 0 }, text = { Text("Subscribed (${sources.size})") })
            Tab(selected = activeSubTab == 1, onClick = { activeSubTab = 1 }, text = { Text("Directory") })
            Tab(selected = activeSubTab == 2, onClick = { activeSubTab = 2 }, text = { Text("Add / OPML") })
        }

        when (activeSubTab) {
            0 -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (sources.isEmpty()) {
                    item {
                        Text(
                            text = "No feeds in this workspace yet. Subscribe from the Directory or add a custom RSS/Atom feed.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                items(sources, key = { it.id }) { src ->
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(
                            modifier = Modifier.padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = "${src.format.value} · ${src.categoryId.uppercase()}" +
                                            if (src.isSample) " · SAMPLE" else "",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.tertiary,
                                    )
                                    Text(text = src.name, style = MaterialTheme.typography.titleMedium)
                                    Text(
                                        text = src.url,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Switch(
                                    checked = src.enabled,
                                    onCheckedChange = { onToggleSource(src.id) },
                                )
                            }
                            if (!src.lastSyncError.isNullOrBlank()) {
                                Text(
                                    text = "Error: ${src.lastSyncError}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            } else {
                                Text(
                                    text = src.lastUpdatedLabel,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.End,
                            ) {
                                TextButton(enabled = !busy, onClick = { onTestSource(src.id) }) {
                                    Icon(Icons.Outlined.PlayArrow, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Test Sync")
                                }
                                IconButton(onClick = { editingSource = src }) {
                                    Icon(Icons.Outlined.Edit, contentDescription = "Edit ${src.name}")
                                }
                                IconButton(onClick = { onDeleteSource(src.id) }) {
                                    Icon(
                                        Icons.Outlined.Delete,
                                        contentDescription = "Delete ${src.name}",
                                        tint = MaterialTheme.colorScheme.error,
                                    )
                                }
                            }
                        }
                    }
                }
            }

            1 -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(directory, key = { it.id }) { entry ->
                    val alreadyAdded = sources.any { it.url.equals(entry.url, ignoreCase = true) }
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.surface,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(
                            modifier = Modifier.padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Text(
                                text = "${entry.format.value} · ${entry.categoryId.uppercase()}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.tertiary,
                            )
                            Text(text = entry.name, style = MaterialTheme.typography.titleMedium)
                            Text(
                                text = entry.description,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = entry.url,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.weight(1f),
                                )
                                Spacer(Modifier.width(8.dp))
                                Button(
                                    enabled = !alreadyAdded,
                                    onClick = {
                                        onAddSource(
                                            entry.name,
                                            entry.url,
                                            entry.format,
                                            entry.categoryId,
                                            entry.description,
                                        )
                                    },
                                ) {
                                    Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text(if (alreadyAdded) "Added" else "Subscribe")
                                }
                            }
                        }
                    }
                }
            }

            2 -> {
                var customUrl by remember { mutableStateOf("") }
                var customName by remember { mutableStateOf("") }
                var customCategoryId by remember { mutableStateOf("news") }

                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    item {
                        Surface(
                            shape = RoundedCornerShape(14.dp),
                            color = MaterialTheme.colorScheme.surface,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Text("Add RSS or Atom Feed", style = MaterialTheme.typography.titleLarge)
                                OutlinedTextField(
                                    value = customUrl,
                                    onValueChange = { customUrl = it },
                                    label = { Text("HTTPS Feed URL") },
                                    placeholder = { Text("https://example.org/feed.xml") },
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth(),
                                )
                                OutlinedTextField(
                                    value = customName,
                                    onValueChange = { customName = it },
                                    label = { Text("Source Title (optional, auto-detected on validate)") },
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth(),
                                )
                                Text(
                                    text = "Assign Category:",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .horizontalScroll(rememberScrollState()),
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    categories.filter { it.enabled }.forEach { cat ->
                                        FilterChip(
                                            selected = customCategoryId == cat.id,
                                            onClick = { customCategoryId = cat.id },
                                            label = { Text(cat.name) },
                                        )
                                    }
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedButton(
                                        enabled = !busy && customUrl.isNotBlank(),
                                        onClick = { onValidatePreview(customUrl, customCategoryId) },
                                    ) {
                                        if (busy) {
                                            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                                            Spacer(Modifier.width(6.dp))
                                        }
                                        Text("Validate & Preview")
                                    }
                                    Button(
                                        enabled = customUrl.isNotBlank(),
                                        onClick = {
                                            val preview = sourcePreview
                                            val title = customName.trim().ifBlank {
                                                preview?.detectedTitle ?: "Custom Feed"
                                            }
                                            val fmt = preview?.detectedFormat ?: FeedFormat.RSS
                                            onAddSource(
                                                title,
                                                preview?.normalizedUrl ?: customUrl.trim(),
                                                fmt,
                                                customCategoryId,
                                                preview?.detectedDescription ?: "",
                                            )
                                            customUrl = ""
                                            customName = ""
                                        },
                                    ) {
                                        Text("Add Source")
                                    }
                                }
                            }
                        }
                    }

                    if (sourcePreview != null) {
                        item {
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(
                                    modifier = Modifier.padding(14.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Text(
                                        text = "Preview · ${sourcePreview.detectedTitle} (${sourcePreview.detectedFormat.value})",
                                        style = MaterialTheme.typography.titleMedium,
                                    )
                                    sourcePreview.sampleArticles.forEach { art ->
                                        Text(
                                            text = "• ${art.title}",
                                            style = MaterialTheme.typography.bodySmall,
                                        )
                                    }
                                }
                            }
                        }
                    }

                    item {
                        Surface(
                            shape = RoundedCornerShape(14.dp),
                            color = MaterialTheme.colorScheme.surface,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Text("OPML 2.0 Backup & Migration", style = MaterialTheme.typography.titleLarge)
                                Text(
                                    text = "Import subscriptions from an OPML XML file or export your current workspace feed list.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedButton(
                                        onClick = {
                                            openOpmlLauncher.launch(arrayOf("text/xml", "application/xml", "*/*"))
                                        },
                                    ) {
                                        Icon(Icons.Outlined.FileUpload, contentDescription = null, modifier = Modifier.size(16.dp))
                                        Spacer(Modifier.width(6.dp))
                                        Text("Import File")
                                    }
                                    OutlinedButton(onClick = { opmlPasteDialogOpen = true }) {
                                        Text("Paste XML")
                                    }
                                }
                                Button(
                                    onClick = {
                                        scope.launch {
                                            val opml = onBuildOpmlExport()
                                            val sendIntent = Intent(Intent.ACTION_SEND).apply {
                                                type = "text/xml"
                                                putExtra(Intent.EXTRA_SUBJECT, "Newsie OPML Subscriptions")
                                                putExtra(Intent.EXTRA_TEXT, opml)
                                            }
                                            context.startActivity(
                                                Intent.createChooser(sendIntent, "Export OPML"),
                                            )
                                        }
                                    },
                                ) {
                                    Icon(Icons.Outlined.FileDownload, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("Export & Share OPML")
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    editingSource?.let { src ->
        var editName by remember(src.id) { mutableStateOf(src.name) }
        var editCat by remember(src.id) { mutableStateOf(src.categoryId) }
        AlertDialog(
            onDismissRequest = { editingSource = null },
            title = { Text("Edit Source") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = editName,
                        onValueChange = { editName = it },
                        label = { Text("Source Title") },
                        singleLine = true,
                    )
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        categories.filter { it.enabled }.forEach { cat ->
                            FilterChip(
                                selected = editCat == cat.id,
                                onClick = { editCat = cat.id },
                                label = { Text(cat.name) },
                            )
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        onUpdateSource(src.id, editName, editCat)
                        editingSource = null
                    },
                ) {
                    Text("Save")
                }
            },
            dismissButton = {
                TextButton(onClick = { editingSource = null }) {
                    Text("Cancel")
                }
            },
        )
    }

    if (opmlPasteDialogOpen) {
        var xmlDraft by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { opmlPasteDialogOpen = false },
            title = { Text("Import OPML XML") },
            text = {
                OutlinedTextField(
                    value = xmlDraft,
                    onValueChange = { xmlDraft = it },
                    label = { Text("Paste OPML 2.0 XML") },
                    minLines = 5,
                    maxLines = 10,
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        onImportOpml(xmlDraft)
                        opmlPasteDialogOpen = false
                    },
                ) {
                    Text("Import")
                }
            },
            dismissButton = {
                TextButton(onClick = { opmlPasteDialogOpen = false }) {
                    Text("Cancel")
                }
            },
        )
    }
}
