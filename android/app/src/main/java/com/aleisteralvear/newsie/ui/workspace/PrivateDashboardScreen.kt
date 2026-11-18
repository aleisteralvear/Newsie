package com.aleisteralvear.newsie.ui.workspace

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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import com.aleisteralvear.newsie.security.encryption.PassphraseKdf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aleisteralvear.newsie.domain.models.PrivateAccessStatus
import com.aleisteralvear.newsie.domain.models.WorkspaceAuthMethod
import com.aleisteralvear.newsie.domain.models.WorkspaceSummary
import com.aleisteralvear.newsie.security.biometric.BiometricCapabilityStatus
import kotlin.math.roundToInt

@Composable
fun PrivateDashboardScreen(
    workspaces: List<WorkspaceSummary>,
    activeWorkspaceId: String,
    accessStatus: PrivateAccessStatus,
    biometricCapability: BiometricCapabilityStatus,
    noticeMessage: String?,
    errorMessage: String?,
    onBackToReader: () -> Unit,
    onLockAllAndExit: () -> Unit,
    onCreateNewWorkspace: () -> Unit,
    onOpenOrUnlockWorkspace: (WorkspaceSummary) -> Unit,
    onLockWorkspace: (String) -> Unit,
    onRenameWorkspace: (String, String) -> Unit,
    onUpdateAutoLock: (String, Int) -> Unit,
    onEnrollBiometric: (WorkspaceSummary, WorkspaceAuthMethod) -> Unit,
    onRotatePassphrase: (String, String, String) -> Unit,
    onDeleteWorkspace: (WorkspaceSummary, String) -> Unit,
    onSaveSearchPhrase: (String?) -> Unit,
    onSaveDoubleTapMs: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    var renameTarget by remember { mutableStateOf<WorkspaceSummary?>(null) }
    var securityTarget by remember { mutableStateOf<WorkspaceSummary?>(null) }
    var deleteTarget by remember { mutableStateOf<WorkspaceSummary?>(null) }

    var phraseDraft by remember { mutableStateOf("") }
    var phraseConfirm by remember { mutableStateOf("") }
    var showPhrase by remember { mutableStateOf(false) }
    var phraseLocalErr by remember { mutableStateOf<String?>(null) }
    var doubleTapDraft by remember(accessStatus.doubleTapIntervalMs) {
        mutableIntStateOf(accessStatus.doubleTapIntervalMs)
    }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = "PROTECTED VAULT MANAGEMENT (FLAG_SECURE)",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.tertiary,
                )
                Text(
                    text = "Private Workspace Dashboard",
                    style = MaterialTheme.typography.displaySmall,
                )
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(onClick = onBackToReader) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Reader")
                    }
                    OutlinedButton(onClick = onLockAllAndExit) {
                        Icon(Icons.Outlined.Lock, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Lock All & Exit")
                    }
                    Button(onClick = onCreateNewWorkspace) {
                        Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("New Workspace")
                    }
                }
            }
        }

        if (noticeMessage != null) {
            item {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = noticeMessage,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }
        }

        if (errorMessage != null) {
            item {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = errorMessage,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }
        }

        item {
            Text(
                text = "Workspaces (${workspaces.size})",
                style = MaterialTheme.typography.titleLarge,
            )
        }

        items(workspaces, key = { it.id }) { ws ->
            val isActive = ws.id == activeWorkspaceId
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(
                    width = if (isActive) 2.dp else 1.dp,
                    color = if (isActive) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.outlineVariant,
                ),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = ws.displayName,
                            style = MaterialTheme.typography.titleLarge,
                        )
                        Text(
                            text = if (ws.isLocked) "LOCKED (AES-256-GCM)" else "UNLOCKED",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (ws.isLocked) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.tertiary,
                        )
                    }
                    Text(
                        text = buildString {
                            append(ws.authMethod.label)
                            append(" · Auto-lock: ")
                            append(if (ws.autoLockMinutes == 0) "Manual" else "${ws.autoLockMinutes}m")
                            if (ws.biometricInvalidated) append(" · Biometric key invalidated")
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Button(onClick = { onOpenOrUnlockWorkspace(ws) }) {
                            Icon(
                                if (ws.isLocked) Icons.Outlined.LockOpen else Icons.Outlined.LockOpen,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text(if (ws.isLocked) "Unlock & Open" else "Open")
                        }
                        if (!ws.isLocked) {
                            OutlinedButton(onClick = { onLockWorkspace(ws.id) }) {
                                Icon(Icons.Outlined.Lock, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("Lock")
                            }
                        }
                        OutlinedButton(onClick = { renameTarget = ws }) {
                            Icon(Icons.Outlined.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Rename")
                        }
                        OutlinedButton(onClick = { securityTarget = ws }) {
                            Icon(Icons.Outlined.Key, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Security")
                        }
                        OutlinedButton(
                            onClick = { deleteTarget = ws },
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        ) {
                            Icon(Icons.Outlined.Delete, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Delete")
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
                    Text(
                        text = "Method A · Search Access Phrase",
                        style = MaterialTheme.typography.titleLarge,
                    )
                    Text(
                        text = if (accessStatus.hasSearchPassphrase) {
                            "Configured (Argon2id verifier). Entering this phrase in Search opens verification cleanly without touching search history."
                        } else {
                            "Not configured. Set an 8–1024 character phrase (Unicode, spaces, and emoji supported)."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    PassphraseField(
                        value = phraseDraft,
                        onValueChange = { phraseDraft = it },
                        label = "New search access phrase",
                        showText = showPhrase,
                        onToggleVisibility = { showPhrase = !showPhrase },
                    )
                    PassphraseField(
                        value = phraseConfirm,
                        onValueChange = { phraseConfirm = it },
                        label = "Confirm access phrase",
                        showText = showPhrase,
                        onToggleVisibility = { showPhrase = !showPhrase },
                    )
                    if (phraseLocalErr != null) {
                        Text(
                            phraseLocalErr!!,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        if (accessStatus.hasSearchPassphrase) {
                            TextButton(onClick = { onSaveSearchPhrase(null) }) {
                                Text("Remove Phrase")
                            }
                        } else {
                            Spacer(Modifier.width(1.dp))
                        }
                        Button(
                            onClick = {
                                phraseLocalErr = null
                                when {
                                    PassphraseKdf.countCharacters(phraseDraft) < PassphraseKdf.MIN_CODE_POINTS ->
                                        phraseLocalErr = "Phrase must be at least 8 characters."
                                    phraseDraft != phraseConfirm ->
                                        phraseLocalErr = "Phrases do not match."
                                    else -> {
                                        val saved = phraseDraft
                                        phraseDraft = ""
                                        phraseConfirm = ""
                                        onSaveSearchPhrase(saved)
                                    }
                                }
                            },
                        ) {
                            Text("Save Phrase")
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
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = "Method B · Search Navigation Double-Tap (${doubleTapDraft}ms)",
                        style = MaterialTheme.typography.titleLarge,
                    )
                    Text(
                        text = "Adjust double-tap speed window between 200ms and 800ms (default 350ms). Single tap always opens Search.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Slider(
                        value = doubleTapDraft.toFloat(),
                        onValueChange = { doubleTapDraft = (it / 50f).roundToInt() * 50 },
                        onValueChangeFinished = { onSaveDoubleTapMs(doubleTapDraft) },
                        valueRange = 200f..800f,
                    )
                }
            }
        }
    }

    renameTarget?.let { ws ->
        var nameDraft by remember(ws.id) { mutableStateOf(ws.displayName) }
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("Rename Workspace") },
            text = {
                OutlinedTextField(
                    value = nameDraft,
                    onValueChange = { if (it.length <= 60) nameDraft = it },
                    label = { Text("Display Name") },
                    singleLine = true,
                )
            },
            confirmButton = {
                Button(
                    enabled = nameDraft.isNotBlank(),
                    onClick = {
                        onRenameWorkspace(ws.id, nameDraft.trim())
                        renameTarget = null
                    },
                ) {
                    Text("Save")
                }
            },
            dismissButton = {
                TextButton(onClick = { renameTarget = null }) { Text("Cancel") }
            },
        )
    }

    securityTarget?.let { ws ->
        var autoLock by remember(ws.id) { mutableIntStateOf(ws.autoLockMinutes) }
        var curPass by remember(ws.id) { mutableStateOf("") }
        var newPass by remember(ws.id) { mutableStateOf("") }
        var confirmNew by remember(ws.id) { mutableStateOf("") }
        var showSecPass by remember(ws.id) { mutableStateOf(false) }
        var secErr by remember { mutableStateOf<String?>(null) }

        AlertDialog(
            onDismissRequest = { securityTarget = null },
            title = { Text("Security · ${ws.displayName}") },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text("Auto-Lock Timeout", style = MaterialTheme.typography.labelMedium)
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        listOf(1 to "1m", 5 to "5m", 15 to "15m", 30 to "30m", 0 to "Manual").forEach { (m, l) ->
                            FilterChip(
                                selected = autoLock == m,
                                onClick = {
                                    autoLock = m
                                    onUpdateAutoLock(ws.id, m)
                                },
                                label = { Text(l) },
                            )
                        }
                    }

                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Text("Hardware Biometric Keystore Policy", style = MaterialTheme.typography.labelMedium)
                    if (!biometricCapability.isReady) {
                        Text(
                            text = biometricCapability.userMessage,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    } else if (ws.isLocked) {
                        Text(
                            text = "Unlock this workspace first before enrolling or re-binding an AndroidKeyStore biometric key.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        Row(
                            modifier = Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            OutlinedButton(
                                onClick = { onEnrollBiometric(ws, WorkspaceAuthMethod.BIOMETRIC) },
                            ) {
                                Icon(Icons.Outlined.Fingerprint, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("Enable Biometric")
                            }
                            OutlinedButton(
                                onClick = { onEnrollBiometric(ws, WorkspaceAuthMethod.BOTH) },
                            ) {
                                Text("Enable Biometric + Pass (MFA)")
                            }
                        }
                    }

                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Text("Rotate Passphrase & 256-bit DEK", style = MaterialTheme.typography.labelMedium)
                    PassphraseField(
                        value = curPass,
                        onValueChange = { curPass = it },
                        label = "Current Passphrase",
                        showText = showSecPass,
                        onToggleVisibility = { showSecPass = !showSecPass },
                    )
                    PassphraseField(
                        value = newPass,
                        onValueChange = { newPass = it },
                        label = "New Passphrase (min 8 chars)",
                        showText = showSecPass,
                        onToggleVisibility = { showSecPass = !showSecPass },
                    )
                    PassphraseField(
                        value = confirmNew,
                        onValueChange = { confirmNew = it },
                        label = "Confirm New Passphrase",
                        showText = showSecPass,
                        onToggleVisibility = { showSecPass = !showSecPass },
                    )
                    if (secErr != null) {
                        Text(secErr!!, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                }
            },
            confirmButton = {
                Button(
                    enabled = curPass.isNotEmpty() && newPass.isNotEmpty(),
                    onClick = {
                        secErr = null
                        when {
                            PassphraseKdf.countCharacters(newPass) < PassphraseKdf.MIN_CODE_POINTS ->
                                secErr = "New passphrase must be at least 8 characters."
                            newPass != confirmNew ->
                                secErr = "New passphrases do not match."
                            else -> {
                                val oldP = curPass
                                val newP = newPass
                                curPass = ""
                                newPass = ""
                                confirmNew = ""
                                onRotatePassphrase(ws.id, oldP, newP)
                                securityTarget = null
                            }
                        }
                    },
                ) {
                    Text("Rotate Keys")
                }
            },
            dismissButton = {
                TextButton(onClick = { securityTarget = null }) { Text("Close") }
            },
        )
    }

    deleteTarget?.let { ws ->
        var delPass by remember(ws.id) { mutableStateOf("") }
        var showDel by remember(ws.id) { mutableStateOf(false) }

        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Delete \"${ws.displayName}\"?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = "This permanently destroys this workspace's encryption keys, articles, sources, bookmarks, and history. Re-authentication is required.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                    PassphraseField(
                        value = delPass,
                        onValueChange = { delPass = it },
                        label = "Verify Current Passphrase",
                        showText = showDel,
                        onToggleVisibility = { showDel = !showDel },
                    )
                }
            },
            confirmButton = {
                Button(
                    enabled = delPass.isNotEmpty(),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                    onClick = {
                        val p = delPass
                        delPass = ""
                        onDeleteWorkspace(ws, p)
                        deleteTarget = null
                    },
                ) {
                    Text("Confirm Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) { Text("Cancel") }
            },
        )
    }
}
