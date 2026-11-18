package com.aleisteralvear.newsie.ui.workspace

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.aleisteralvear.newsie.security.encryption.PassphraseKdf
import com.aleisteralvear.newsie.domain.models.PrivateAccessStatus
import com.aleisteralvear.newsie.domain.models.WorkspaceAuthMethod
import com.aleisteralvear.newsie.domain.models.WorkspaceSummary
import com.aleisteralvear.newsie.security.biometric.BiometricCapabilityStatus

@Composable
fun PrivateAuthGateDialog(
    accessStatus: PrivateAccessStatus,
    biometricCapability: BiometricCapabilityStatus,
    busy: Boolean,
    errorMessage: String?,
    cooldownSeconds: Int,
    onDismiss: () -> Unit,
    onFirstTimeCreate: (displayName: String, passphrase: String, autoLockMinutes: Int) -> Unit,
    onAuthenticatePassphrase: (passphrase: String) -> Unit,
    onAuthenticateBiometric: () -> Unit,
) {
    val isFirstSetup = !accessStatus.hasPrivateWorkspaces
    var workspaceName by remember { mutableStateOf("") }
    var passphrase by remember { mutableStateOf("") }
    var confirmPass by remember { mutableStateOf("") }
    var autoLockMinutes by remember { mutableIntStateOf(5) }
    var showPass by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = {
            passphrase = ""
            confirmPass = ""
            onDismiss()
        },
        icon = {
            Icon(
                imageVector = if (isFirstSetup) Icons.Outlined.Shield else Icons.Outlined.Lock,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.tertiary,
            )
        },
        title = {
            Text(
                text = if (isFirstSetup) "Initialize Private Workspace" else "Private Access Verification",
                style = MaterialTheme.typography.headlineSmall,
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (isFirstSetup) {
                    Surface(
                        color = MaterialTheme.colorScheme.secondaryContainer,
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    ) {
                        Row(
                            modifier = Modifier.padding(10.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Icon(
                                Icons.Outlined.WarningAmber,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.tertiary,
                                modifier = Modifier.size(18.dp),
                            )
                            Text(
                                text = "Private workspaces use AES-256-GCM & Argon2id. Forgotten passphrases cannot be recovered and result in permanent data loss.",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }

                    OutlinedTextField(
                        value = workspaceName,
                        onValueChange = { if (it.length <= 60) workspaceName = it },
                        label = { Text("Workspace Name") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    PassphraseField(
                        value = passphrase,
                        onValueChange = { passphrase = it },
                        label = "Passphrase (min 8 chars, emoji/spaces OK)",
                        showText = showPass,
                        onToggleVisibility = { showPass = !showPass },
                    )
                    PassphraseField(
                        value = confirmPass,
                        onValueChange = { confirmPass = it },
                        label = "Confirm Passphrase",
                        showText = showPass,
                        onToggleVisibility = { showPass = !showPass },
                    )
                    Text("Auto-Lock Timeout", style = MaterialTheme.typography.labelMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(1 to "1m", 5 to "5m", 15 to "15m", 0 to "Manual").forEach { (mins, label) ->
                            FilterChip(
                                selected = autoLockMinutes == mins,
                                onClick = { autoLockMinutes = mins },
                                label = { Text(label) },
                            )
                        }
                    }
                } else {
                    Text(
                        text = "Verify a private workspace credential to access the Private Workspace Dashboard.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    if (biometricCapability.isReady && accessStatus.hasAnyBiometricKeys) {
                        OutlinedButton(
                            enabled = !busy && cooldownSeconds == 0,
                            onClick = onAuthenticateBiometric,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Outlined.Fingerprint, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("Verify with Strong Biometric")
                        }
                    }

                    PassphraseField(
                        value = passphrase,
                        onValueChange = { passphrase = it },
                        label = "Workspace Passphrase",
                        showText = showPass,
                        onToggleVisibility = { showPass = !showPass },
                    )
                }

                val displayError = localError ?: errorMessage
                if (displayError != null) {
                    Text(
                        text = displayError + if (cooldownSeconds > 0) " (${cooldownSeconds}s)" else "",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            Button(
                enabled = !busy && cooldownSeconds == 0,
                onClick = {
                    localError = null
                    if (isFirstSetup) {
                        if (workspaceName.isBlank()) {
                            localError = "Enter a workspace name."
                        } else if (PassphraseKdf.countCharacters(passphrase) < PassphraseKdf.MIN_CODE_POINTS) {
                            localError = "Passphrase must be at least 8 characters."
                        } else if (passphrase != confirmPass) {
                            localError = "Passphrases do not match."
                        } else {
                            val pass = passphrase
                            passphrase = ""
                            confirmPass = ""
                            onFirstTimeCreate(workspaceName.trim(), pass, autoLockMinutes)
                        }
                    } else {
                        if (passphrase.isEmpty()) {
                            localError = "Enter your workspace passphrase."
                        } else {
                            val pass = passphrase
                            passphrase = ""
                            onAuthenticatePassphrase(pass)
                        }
                    }
                },
            ) {
                if (busy) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    when {
                        cooldownSeconds > 0 -> "Wait ${cooldownSeconds}s"
                        isFirstSetup -> "Create & Enter"
                        else -> "Verify & Enter"
                    },
                )
            }
        },
        dismissButton = {
            TextButton(
                onClick = {
                    passphrase = ""
                    confirmPass = ""
                    onDismiss()
                },
            ) {
                Text("Cancel")
            }
        },
    )
}

@Composable
fun UnlockWorkspaceDialog(
    workspace: WorkspaceSummary,
    biometricCapability: BiometricCapabilityStatus,
    busy: Boolean,
    errorMessage: String?,
    cooldownSeconds: Int,
    onDismiss: () -> Unit,
    onUnlockPassphrase: (workspaceId: String, passphrase: String, isRecovery: Boolean) -> Unit,
    onUnlockBiometric: (workspaceId: String) -> Unit,
    onUnlockBothFactors: (workspaceId: String, passphrase: String) -> Unit,
) {
    var passphrase by remember(workspace.id) { mutableStateOf("") }
    var showPass by remember(workspace.id) { mutableStateOf(false) }
    var recoveryMode by remember(workspace.id) { mutableStateOf(workspace.biometricInvalidated) }

    AlertDialog(
        onDismissRequest = {
            passphrase = ""
            onDismiss()
        },
        icon = { Icon(Icons.Outlined.Lock, contentDescription = null) },
        title = {
            Text(
                text = "Unlock ${workspace.displayName}",
                style = MaterialTheme.typography.headlineSmall,
            )
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    text = "Protection policy: ${workspace.authMethod.label}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.tertiary,
                )

                if (workspace.biometricInvalidated) {
                    Surface(
                        color = MaterialTheme.colorScheme.errorContainer,
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        Text(
                            text = "Device biometric enrollment changed or Keystore key invalidated. Verify your workspace passphrase to recover cleanly.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(10.dp),
                        )
                    }
                }

                when {
                    recoveryMode -> {
                        PassphraseField(
                            value = passphrase,
                            onValueChange = { passphrase = it },
                            label = "Recovery Passphrase",
                            showText = showPass,
                            onToggleVisibility = { showPass = !showPass },
                        )
                    }

                    workspace.authMethod == WorkspaceAuthMethod.BIOMETRIC -> {
                        if (biometricCapability.isReady) {
                            Button(
                                enabled = !busy,
                                onClick = { onUnlockBiometric(workspace.id) },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Icon(Icons.Outlined.Fingerprint, contentDescription = null)
                                Spacer(Modifier.width(8.dp))
                                Text("Authenticate with Biometric")
                            }
                        } else {
                            Text(
                                text = biometricCapability.userMessage,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                        TextButton(onClick = { recoveryMode = true }) {
                            Text("Biometrics unavailable? Recover with Passphrase")
                        }
                    }

                    workspace.authMethod == WorkspaceAuthMethod.BOTH -> {
                        Text(
                            text = "Multi-factor policy requires BOTH your passphrase and hardware biometric confirmation.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        PassphraseField(
                            value = passphrase,
                            onValueChange = { passphrase = it },
                            label = "Workspace Passphrase (Factor 1)",
                            showText = showPass,
                            onToggleVisibility = { showPass = !showPass },
                        )
                        if (!biometricCapability.isReady) {
                            Text(
                                text = biometricCapability.userMessage,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                            TextButton(onClick = { recoveryMode = true }) {
                                Text("Passphrase Recovery (Reset Policy)")
                            }
                        }
                    }

                    else -> {
                        PassphraseField(
                            value = passphrase,
                            onValueChange = { passphrase = it },
                            label = "Workspace Passphrase",
                            showText = showPass,
                            onToggleVisibility = { showPass = !showPass },
                        )
                    }
                }

                if (errorMessage != null) {
                    Text(
                        text = errorMessage + if (cooldownSeconds > 0) " (${cooldownSeconds}s)" else "",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            when {
                recoveryMode || workspace.authMethod == WorkspaceAuthMethod.PASSPHRASE -> {
                    Button(
                        enabled = !busy && cooldownSeconds == 0 && passphrase.isNotEmpty(),
                        onClick = {
                            val pass = passphrase
                            passphrase = ""
                            onUnlockPassphrase(workspace.id, pass, recoveryMode)
                        },
                    ) {
                        Text(if (recoveryMode) "Recover & Unlock" else "Unlock")
                    }
                }
                workspace.authMethod == WorkspaceAuthMethod.BOTH && biometricCapability.isReady -> {
                    Button(
                        enabled = !busy && cooldownSeconds == 0 && passphrase.isNotEmpty(),
                        onClick = {
                            val pass = passphrase
                            passphrase = ""
                            onUnlockBothFactors(workspace.id, pass)
                        },
                    ) {
                        Icon(Icons.Outlined.Fingerprint, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Verify Passphrase + Biometric")
                    }
                }
            }
        },
        dismissButton = {
            TextButton(
                onClick = {
                    passphrase = ""
                    onDismiss()
                },
            ) {
                Text("Cancel")
            }
        },
    )
}

@Composable
fun CreateWorkspaceDialog(
    busy: Boolean,
    errorMessage: String?,
    onDismiss: () -> Unit,
    onCreate: (displayName: String, passphrase: String, autoLockMinutes: Int) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var autoLock by remember { mutableIntStateOf(5) }
    var showPass by remember { mutableStateOf(false) }
    var localErr by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = {
            pass = ""
            confirm = ""
            onDismiss()
        },
        title = { Text("New Private Workspace", style = MaterialTheme.typography.headlineSmall) },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    text = "Isolated AES-256-GCM vault with independent feeds, categories, bookmarks, history, and preferences. Forgotten passphrases cannot be recovered.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = name,
                    onValueChange = { if (it.length <= 60) name = it },
                    label = { Text("Workspace Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                PassphraseField(
                    value = pass,
                    onValueChange = { pass = it },
                    label = "Passphrase (min 8 chars)",
                    showText = showPass,
                    onToggleVisibility = { showPass = !showPass },
                )
                PassphraseField(
                    value = confirm,
                    onValueChange = { confirm = it },
                    label = "Confirm Passphrase",
                    showText = showPass,
                    onToggleVisibility = { showPass = !showPass },
                )
                Text("Auto-Lock Timeout", style = MaterialTheme.typography.labelMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(1 to "1m", 5 to "5m", 15 to "15m", 0 to "Manual").forEach { (mins, label) ->
                        FilterChip(
                            selected = autoLock == mins,
                            onClick = { autoLock = mins },
                            label = { Text(label) },
                        )
                    }
                }
                val err = localErr ?: errorMessage
                if (err != null) {
                    Text(err, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            Button(
                enabled = !busy,
                onClick = {
                    localErr = null
                    when {
                        name.isBlank() -> localErr = "Enter a workspace name."
                        PassphraseKdf.countCharacters(pass) < PassphraseKdf.MIN_CODE_POINTS -> localErr = "Minimum 8 characters required."
                        pass != confirm -> localErr = "Passphrases do not match."
                        else -> {
                            val raw = pass
                            pass = ""
                            confirm = ""
                            onCreate(name.trim(), raw, autoLock)
                        }
                    }
                },
            ) {
                Text("Create Workspace")
            }
        },
        dismissButton = {
            TextButton(
                onClick = {
                    pass = ""
                    confirm = ""
                    onDismiss()
                },
            ) {
                Text("Cancel")
            }
        },
    )
}

@Composable
fun PassphraseField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    showText: Boolean,
    onToggleVisibility: () -> Unit,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = true,
        visualTransformation = if (showText) VisualTransformation.None else PasswordVisualTransformation(),
        trailingIcon = {
            IconButton(onClick = onToggleVisibility) {
                Icon(
                    imageVector = if (showText) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                    contentDescription = if (showText) "Hide passphrase" else "Show passphrase",
                )
            }
        },
        modifier = modifier.fillMaxWidth(),
    )
}
