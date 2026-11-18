package com.aleisteralvear.newsie.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aleisteralvear.newsie.domain.models.Category

@Composable
fun CategoryManagerDialog(
    categories: List<Category>,
    onDismiss: () -> Unit,
    onCreateCategory: (String) -> Unit,
    onToggleCategory: (String, Boolean) -> Unit,
    onRenameCategory: (String, String) -> Unit,
    onDeleteCategory: (String) -> Unit,
    onMoveCategory: (String, Int) -> Unit,
) {
    var newCategoryName by remember { mutableStateOf("") }
    var editingId by remember { mutableStateOf<String?>(null) }
    var editingDraft by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = "Manage Categories",
                style = MaterialTheme.typography.headlineSmall,
            )
        },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = newCategoryName,
                        onValueChange = { if (it.length <= 40) newCategoryName = it },
                        label = { Text("New custom category") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = {
                            if (newCategoryName.isNotBlank()) {
                                onCreateCategory(newCategoryName.trim())
                                newCategoryName = ""
                            }
                        },
                    ) {
                        Text("Add")
                    }
                }
                Spacer(Modifier.height(12.dp))
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 360.dp),
                ) {
                    itemsIndexed(categories, key = { _, cat -> cat.id }) { index, cat ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            if (editingId == cat.id) {
                                OutlinedTextField(
                                    value = editingDraft,
                                    onValueChange = { if (it.length <= 40) editingDraft = it },
                                    singleLine = true,
                                    modifier = Modifier.weight(1f),
                                )
                                IconButton(
                                    onClick = {
                                        if (editingDraft.isNotBlank()) {
                                            onRenameCategory(cat.id, editingDraft.trim())
                                        }
                                        editingId = null
                                    },
                                ) {
                                    Icon(Icons.Outlined.Check, contentDescription = "Save category name")
                                }
                            } else {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = cat.name,
                                        style = MaterialTheme.typography.bodyMedium,
                                    )
                                    if (cat.isCustom) {
                                        Text(
                                            text = "Custom",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.tertiary,
                                        )
                                    }
                                }
                                IconButton(
                                    enabled = index > 0,
                                    onClick = { onMoveCategory(cat.id, -1) },
                                ) {
                                    Icon(Icons.Outlined.ArrowUpward, contentDescription = "Move ${cat.name} up")
                                }
                                IconButton(
                                    enabled = index < categories.lastIndex,
                                    onClick = { onMoveCategory(cat.id, 1) },
                                ) {
                                    Icon(Icons.Outlined.ArrowDownward, contentDescription = "Move ${cat.name} down")
                                }
                                IconButton(
                                    onClick = {
                                        editingId = cat.id
                                        editingDraft = cat.name
                                    },
                                ) {
                                    Icon(Icons.Outlined.Edit, contentDescription = "Rename ${cat.name}")
                                }
                                if (cat.isCustom) {
                                    IconButton(onClick = { onDeleteCategory(cat.id) }) {
                                        Icon(
                                            Icons.Outlined.Delete,
                                            contentDescription = "Delete ${cat.name}",
                                            tint = MaterialTheme.colorScheme.error,
                                        )
                                    }
                                }
                                Switch(
                                    checked = cat.enabled,
                                    onCheckedChange = { onToggleCategory(cat.id, it) },
                                )
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Done")
            }
        },
    )
}
