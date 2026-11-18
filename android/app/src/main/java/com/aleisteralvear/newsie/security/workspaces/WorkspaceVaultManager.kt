package com.aleisteralvear.newsie.security.workspaces

import androidx.room.withTransaction
import com.aleisteralvear.newsie.data.database.NewsieDatabase
import com.aleisteralvear.newsie.data.entities.EncryptedWorkspaceRecordEntity
import com.aleisteralvear.newsie.data.entities.PrivateAccessGateEntity
import com.aleisteralvear.newsie.data.entities.WorkspaceEntity
import com.aleisteralvear.newsie.data.repository.PrivateRecordSerializer
import com.aleisteralvear.newsie.domain.models.AppPreferences
import com.aleisteralvear.newsie.domain.models.DefaultSeedData
import com.aleisteralvear.newsie.domain.models.PrivateAccessStatus
import com.aleisteralvear.newsie.domain.models.WorkspaceAuthMethod
import com.aleisteralvear.newsie.domain.models.WorkspaceSummary
import com.aleisteralvear.newsie.security.encryption.EncryptedEnvelope
import com.aleisteralvear.newsie.security.encryption.KdfParameters
import com.aleisteralvear.newsie.security.encryption.PassphraseKdf
import com.aleisteralvear.newsie.security.encryption.WorkspaceCryptoEngine
import com.aleisteralvear.newsie.security.keystore.BiometricKeyInvalidatedException
import com.aleisteralvear.newsie.security.keystore.KeystoreProvider
import com.aleisteralvear.newsie.security.keystore.KeystoreUnavailableException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher

class WorkspaceLockedException(message: String) : SecurityException(message)
class WorkspaceAuthException(message: String, val retryAfterSeconds: Int = 0) : SecurityException(message)

class WorkspaceVaultManager(
    private val db: NewsieDatabase,
    private val keystoreProvider: KeystoreProvider,
    private val kdfParameters: KdfParameters = KdfParameters(),
) {
    private val vaultDao = db.workspaceVaultDao()

    // Active plaintext DEKs exist strictly in volatile memory while a workspace is unlocked.
    private val activeDeks = ConcurrentHashMap<String, ByteArray>()
    private val lastActivityByWorkspace = ConcurrentHashMap<String, Long>()
    private val failedAttempts = ConcurrentHashMap<String, Int>()
    private val lockedUntilEpochMs = ConcurrentHashMap<String, Long>()

    @Volatile
    private var dashboardAuthenticated = false

    private val _unlockedWorkspaceIds = MutableStateFlow<Set<String>>(emptySet())
    val unlockedWorkspaceIds: StateFlow<Set<String>> = _unlockedWorkspaceIds.asStateFlow()

    private val _dashboardAuthState = MutableStateFlow(false)
    val dashboardAuthState: StateFlow<Boolean> = _dashboardAuthState.asStateFlow()

    fun isWorkspaceUnlocked(workspaceId: String): Boolean {
        if (workspaceId == DefaultSeedData.DEFAULT_WORKSPACE_ID) return true
        return activeDeks.containsKey(workspaceId)
    }

    fun isDashboardAuthenticated(): Boolean = dashboardAuthenticated

    fun exitDashboardView() {
        dashboardAuthenticated = false
        _dashboardAuthState.value = false
    }

    /**
     * Returns only an opaque internal workspace ID for initializing BiometricPrompt
     * CryptoObject before authentication; never exposes workspace names or counts to UI.
     */
    suspend fun getBiometricTargetWorkspaceIdForGate(): String? {
        val candidate = vaultDao.getPrivateWorkspaces().firstOrNull {
            it.biometricEnabled && it.wrappedDekBiometric != null
        }
        return candidate?.id
    }

    /**
     * Public access status intentionally excludes workspace names, IDs, or counts.
     */
    suspend fun getPublicPrivateAccessStatus(): PrivateAccessStatus {
        val gate = vaultDao.getPrivateAccessGate()
        val count = vaultDao.countPrivateWorkspaces()
        val hasBio = vaultDao.hasAnyBiometricPrivateWorkspaces()
        return PrivateAccessStatus(
            hasSearchPassphrase = gate?.searchPhraseVerifier != null && gate.searchPhraseSalt != null,
            doubleTapIntervalMs = gate?.doubleTapIntervalMs ?: 350,
            hasPrivateWorkspaces = count > 0,
            hasAnyBiometricKeys = hasBio,
        )
    }

    suspend fun setSearchAccessPhrase(rawPhrase: String?): PrivateAccessStatus {
        requireDashboardAuth()
        val current = vaultDao.getPrivateAccessGate()
        val doubleTap = current?.doubleTapIntervalMs ?: 350
        val updated = if (rawPhrase == null) {
            PrivateAccessGateEntity(
                id = 1,
                searchPhraseSalt = null,
                searchPhraseVerifier = null,
                kdfMemoryKib = kdfParameters.memoryKib,
                kdfIterations = kdfParameters.iterations,
                kdfParallelism = kdfParameters.parallelism,
                doubleTapIntervalMs = doubleTap,
            )
        } else {
            val normalized = PassphraseKdf.validatePassphrase(rawPhrase)
            val salt = PassphraseKdf.generateSalt()
            val verifier = PassphraseKdf.deriveSearchAccessVerifier(normalized, salt, kdfParameters)
            PrivateAccessGateEntity(
                id = 1,
                searchPhraseSalt = salt,
                searchPhraseVerifier = verifier,
                kdfMemoryKib = kdfParameters.memoryKib,
                kdfIterations = kdfParameters.iterations,
                kdfParallelism = kdfParameters.parallelism,
                doubleTapIntervalMs = doubleTap,
            )
        }
        vaultDao.upsertPrivateAccessGate(updated)
        return getPublicPrivateAccessStatus()
    }

    suspend fun setDoubleTapIntervalMs(intervalMs: Int): PrivateAccessStatus {
        requireDashboardAuth()
        val clamped = intervalMs.coerceIn(200, 800)
        val current = vaultDao.getPrivateAccessGate()
        val updated = PrivateAccessGateEntity(
            id = 1,
            searchPhraseSalt = current?.searchPhraseSalt,
            searchPhraseVerifier = current?.searchPhraseVerifier,
            kdfMemoryKib = current?.kdfMemoryKib ?: kdfParameters.memoryKib,
            kdfIterations = current?.kdfIterations ?: kdfParameters.iterations,
            kdfParallelism = current?.kdfParallelism ?: kdfParameters.parallelism,
            doubleTapIntervalMs = clamped,
        )
        vaultDao.upsertPrivateAccessGate(updated)
        return getPublicPrivateAccessStatus()
    }

    /**
     * Method A local verifier check. Uses NFC normalization + salted Argon2id + constant-time comparison.
     * NEVER transmits the candidate phrase over the network, stores it in history, or writes it to logs.
     */
    suspend fun checkSearchAccessPhrase(rawInput: String): Boolean {
        val gate = vaultDao.getPrivateAccessGate() ?: return false
        val salt = gate.searchPhraseSalt ?: return false
        val expected = gate.searchPhraseVerifier ?: return false
        val normalized = PassphraseKdf.normalizeNfc(rawInput)
        if (PassphraseKdf.countCharacters(normalized) < PassphraseKdf.MIN_CODE_POINTS ||
            normalized.length > PassphraseKdf.MAX_UTF16_LENGTH
        ) {
            return false
        }
        val params = KdfParameters(gate.kdfMemoryKib, gate.kdfIterations, gate.kdfParallelism)
        val candidate = PassphraseKdf.deriveSearchAccessVerifier(normalized, salt, params)
        return try {
            PassphraseKdf.verifyConstantTime(expected, candidate)
        } finally {
            WorkspaceCryptoEngine.zeroize(candidate)
        }
    }

    suspend fun createPrivateWorkspace(
        displayName: String,
        rawPassphrase: String,
        autoLockMinutes: Int,
        authenticateDashboard: Boolean = true,
    ): WorkspaceSummary {
        val cleanName = displayName.trim()
        require(cleanName.isNotEmpty() && cleanName.length <= 60) {
            "Workspace name must be between 1 and 60 characters."
        }
        val normalizedPass = PassphraseKdf.validatePassphrase(rawPassphrase)
        val workspaceId = "ws-${UUID.randomUUID()}"
        val now = System.currentTimeMillis()
        val dek = WorkspaceCryptoEngine.generateDek()
        val derived = PassphraseKdf.deriveWorkspaceKeys(
            rawPassphrase = normalizedPass,
            params = kdfParameters,
            contextId = workspaceId,
        )

        return try {
            val wrappedPass = WorkspaceCryptoEngine.wrapDekWithKek(derived.kek, dek, workspaceId)
            val entity = WorkspaceEntity(
                id = workspaceId,
                displayName = cleanName,
                isPrivate = true,
                authMethod = WorkspaceAuthMethod.PASSPHRASE.value,
                autoLockMinutes = autoLockMinutes.coerceAtLeast(0),
                passphraseSalt = derived.salt,
                passphraseVerifier = derived.authVerifier.copyOf(),
                kdfMemoryKib = kdfParameters.memoryKib,
                kdfIterations = kdfParameters.iterations,
                kdfParallelism = kdfParameters.parallelism,
                wrappedDekPassphrase = wrappedPass.ciphertext,
                wrappedDekPassphraseIv = wrappedPass.iv,
                wrappedDekPassphraseVersion = wrappedPass.formatVersion,
                wrappedDekBiometric = null,
                wrappedDekBiometricIv = null,
                biometricEnabled = false,
                lastActivityEpochMs = now,
                createdAtEpochMs = now,
            )

            // Seed initial encrypted categories + preferences inside the same atomic transaction
            val initialRecords = buildList {
                DefaultSeedData.defaultCategories.forEach { cat ->
                    add(
                        encryptRecordWithDek(
                            workspaceId = workspaceId,
                            dek = dek,
                            recordType = PrivateRecordSerializer.TYPE_CATEGORY,
                            recordId = cat.id,
                            plaintext = PrivateRecordSerializer.encodeCategory(cat),
                            nowMs = now,
                        ),
                    )
                }
                add(
                    encryptRecordWithDek(
                        workspaceId = workspaceId,
                        dek = dek,
                        recordType = PrivateRecordSerializer.TYPE_PREFERENCES,
                        recordId = PrivateRecordSerializer.PREFERENCES_RECORD_ID,
                        plaintext = PrivateRecordSerializer.encodePreferences(AppPreferences()),
                        nowMs = now,
                    ),
                )
            }

            vaultDao.replaceEncryptedRecordsAndWorkspace(entity, initialRecords)

            storeActiveDek(workspaceId, dek.copyOf(), now)
            if (authenticateDashboard) {
                dashboardAuthenticated = true
                _dashboardAuthState.value = true
            }
            toSummary(entity)
        } finally {
            WorkspaceCryptoEngine.zeroize(dek)
            derived.clearKeys()
        }
    }

    /**
     * Authenticates entry into the Private Workspace Dashboard using a private workspace passphrase.
     * Enforces MFA: workspaces configured as 'both' verify entry cleanly but remain LOCKED until
     * both passphrase and biometric crypto confirmation are supplied.
     */
    suspend fun authenticateDashboardWithPassphrase(rawPassphrase: String): WorkspaceSummary {
        enforceRateLimit("dashboard_gate")
        val normalized = PassphraseKdf.normalizeNfc(rawPassphrase)
        val workspaces = vaultDao.getPrivateWorkspaces()
        if (workspaces.isEmpty()) {
            throw WorkspaceAuthException("No private workspaces have been created yet.")
        }

        for (ws in workspaces) {
            val params = KdfParameters(ws.kdfMemoryKib, ws.kdfIterations, ws.kdfParallelism)
            val derived = PassphraseKdf.deriveWorkspaceKeys(
                rawPassphrase = normalized,
                salt = ws.passphraseSalt,
                params = params,
                contextId = ws.id,
            )
            try {
                if (PassphraseKdf.verifyConstantTime(ws.passphraseVerifier, derived.authVerifier)) {
                    clearRateLimit("dashboard_gate")
                    dashboardAuthenticated = true
                    _dashboardAuthState.value = true
                    if (WorkspaceAuthMethod.fromValue(ws.authMethod) == WorkspaceAuthMethod.PASSPHRASE) {
                        val dek = WorkspaceCryptoEngine.unwrapDekWithKek(
                            kekBytes = derived.kek,
                            envelope = EncryptedEnvelope(
                                iv = ws.wrappedDekPassphraseIv,
                                ciphertext = ws.wrappedDekPassphrase,
                                formatVersion = ws.wrappedDekPassphraseVersion,
                            ),
                            workspaceId = ws.id,
                        )
                        val now = System.currentTimeMillis()
                        storeActiveDek(ws.id, dek, now)
                        vaultDao.updateLastActivity(ws.id, now)
                    }
                    return toSummary(ws)
                }
            } finally {
                derived.clearKeys()
            }
        }

        val retrySeconds = recordFailure("dashboard_gate")
        throw WorkspaceAuthException(
            "Invalid private credential.",
            retryAfterSeconds = retrySeconds,
        )
    }

    /**
     * Authenticates entry into the Private Workspace Dashboard using an unlocked BIOMETRIC_STRONG Cipher.
     */
    suspend fun authenticateDashboardWithBiometric(
        workspaceId: String,
        authenticatedDecryptCipher: Cipher,
    ): WorkspaceSummary {
        val ws = vaultDao.getWorkspaceById(workspaceId)
            ?: throw WorkspaceAuthException("Private workspace not found.")
        val method = WorkspaceAuthMethod.fromValue(ws.authMethod)
        val wrapped = ws.wrappedDekBiometric
            ?: throw WorkspaceAuthException("No hardware biometric key enrolled for this workspace.")

        val decryptedDek = try {
            authenticatedDecryptCipher.doFinal(wrapped)
        } catch (ex: Exception) {
            throw WorkspaceAuthException("Biometric cryptographic unwrap failed: ${ex.message}")
        }

        dashboardAuthenticated = true
        _dashboardAuthState.value = true

        if (method == WorkspaceAuthMethod.BIOMETRIC) {
            val now = System.currentTimeMillis()
            storeActiveDek(ws.id, decryptedDek, now)
            vaultDao.updateLastActivity(ws.id, now)
        } else {
            // For BOTH (MFA), biometric alone MUST NOT unlock the workspace DEK!
            WorkspaceCryptoEngine.zeroize(decryptedDek)
        }
        return toSummary(ws)
    }

    suspend fun listPrivateWorkspacesForDashboard(): List<WorkspaceSummary> {
        requireDashboardAuth()
        return vaultDao.getPrivateWorkspaces().map { toSummary(it) }
    }

    suspend fun getWorkspaceSummaryForDashboard(workspaceId: String): WorkspaceSummary? {
        requireDashboardAuth()
        return vaultDao.getWorkspaceById(workspaceId)?.let { toSummary(it) }
    }

    suspend fun unlockWorkspaceWithPassphrase(
        workspaceId: String,
        rawPassphrase: String,
        isRecoveryMode: Boolean = false,
    ): WorkspaceSummary {
        enforceRateLimit(workspaceId)
        val ws = vaultDao.getWorkspaceById(workspaceId)
            ?: throw WorkspaceAuthException("Workspace not found.")
        val method = WorkspaceAuthMethod.fromValue(ws.authMethod)

        if (method == WorkspaceAuthMethod.BOTH && !isRecoveryMode) {
            throw WorkspaceAuthException(
                "This workspace requires BOTH your passphrase and strong biometric verification.",
            )
        }
        if (method == WorkspaceAuthMethod.BIOMETRIC && !isRecoveryMode) {
            throw WorkspaceAuthException(
                "Use biometric authentication or choose passphrase recovery if biometrics changed.",
            )
        }

        val normalized = PassphraseKdf.normalizeNfc(rawPassphrase)
        val params = KdfParameters(ws.kdfMemoryKib, ws.kdfIterations, ws.kdfParallelism)
        val derived = PassphraseKdf.deriveWorkspaceKeys(
            rawPassphrase = normalized,
            salt = ws.passphraseSalt,
            params = params,
            contextId = ws.id,
        )
        return try {
            if (!PassphraseKdf.verifyConstantTime(ws.passphraseVerifier, derived.authVerifier)) {
                val wait = recordFailure(workspaceId)
                throw WorkspaceAuthException("Incorrect passphrase.", retryAfterSeconds = wait)
            }
            val dek = WorkspaceCryptoEngine.unwrapDekWithKek(
                kekBytes = derived.kek,
                envelope = EncryptedEnvelope(
                    iv = ws.wrappedDekPassphraseIv,
                    ciphertext = ws.wrappedDekPassphrase,
                    formatVersion = ws.wrappedDekPassphraseVersion,
                ),
                workspaceId = ws.id,
            )
            clearRateLimit(workspaceId)
            val now = System.currentTimeMillis()
            storeActiveDek(ws.id, dek, now)
            vaultDao.updateLastActivity(ws.id, now)
            toSummary(ws)
        } finally {
            derived.clearKeys()
        }
    }

    /**
     * Unlocks a BIOMETRIC-only workspace strictly by decrypting wrappedDekBiometric
     * using the BiometricPrompt-authenticated CryptoObject Cipher.
     */
    suspend fun unlockWorkspaceWithBiometric(
        workspaceId: String,
        authenticatedDecryptCipher: Cipher,
    ): WorkspaceSummary {
        val ws = vaultDao.getWorkspaceById(workspaceId)
            ?: throw WorkspaceAuthException("Workspace not found.")
        val method = WorkspaceAuthMethod.fromValue(ws.authMethod)
        if (method == WorkspaceAuthMethod.BOTH) {
            throw WorkspaceAuthException(
                "Biometric alone cannot unlock a Biometric + Passphrase workspace.",
            )
        }
        if (!ws.biometricEnabled || ws.wrappedDekBiometric == null) {
            throw WorkspaceAuthException("Biometric authentication is not enabled for this workspace.")
        }
        val dek = try {
            authenticatedDecryptCipher.doFinal(ws.wrappedDekBiometric)
        } catch (ex: Exception) {
            throw BiometricKeyInvalidatedException(
                "Biometric decryption failed. Use your passphrase recovery option.",
                ex,
            )
        }
        val now = System.currentTimeMillis()
        storeActiveDek(ws.id, dek, now)
        vaultDao.updateLastActivity(ws.id, now)
        return toSummary(ws)
    }

    /**
     * Unlocks a BOTH (MFA) workspace: requires verified Argon2id passphrase unwrap AND verified
     * AndroidKeyStore BiometricPrompt CryptoObject decrypt, proving both factors match cleanly.
     */
    suspend fun unlockWorkspaceWithBothFactors(
        workspaceId: String,
        rawPassphrase: String,
        authenticatedDecryptCipher: Cipher,
    ): WorkspaceSummary {
        enforceRateLimit(workspaceId)
        val ws = vaultDao.getWorkspaceById(workspaceId)
            ?: throw WorkspaceAuthException("Workspace not found.")
        val wrappedBio = ws.wrappedDekBiometric
            ?: throw BiometricKeyInvalidatedException("Biometric credential missing; use passphrase recovery.")

        val normalized = PassphraseKdf.normalizeNfc(rawPassphrase)
        val params = KdfParameters(ws.kdfMemoryKib, ws.kdfIterations, ws.kdfParallelism)
        val derived = PassphraseKdf.deriveWorkspaceKeys(
            rawPassphrase = normalized,
            salt = ws.passphraseSalt,
            params = params,
            contextId = ws.id,
        )
        var passDek: ByteArray? = null
        var bioDek: ByteArray? = null
        return try {
            if (!PassphraseKdf.verifyConstantTime(ws.passphraseVerifier, derived.authVerifier)) {
                val wait = recordFailure(workspaceId)
                throw WorkspaceAuthException("Incorrect passphrase.", retryAfterSeconds = wait)
            }
            passDek = WorkspaceCryptoEngine.unwrapDekWithKek(
                kekBytes = derived.kek,
                envelope = EncryptedEnvelope(
                    iv = ws.wrappedDekPassphraseIv,
                    ciphertext = ws.wrappedDekPassphrase,
                    formatVersion = ws.wrappedDekPassphraseVersion,
                ),
                workspaceId = ws.id,
            )
            bioDek = try {
                authenticatedDecryptCipher.doFinal(wrappedBio)
            } catch (ex: Exception) {
                throw BiometricKeyInvalidatedException(
                    "Biometric verification failed. Use passphrase recovery if device biometrics changed.",
                    ex,
                )
            }
            if (!MessageDigest.isEqual(passDek, bioDek)) {
                throw WorkspaceAuthException("Cryptographic factor mismatch detected.")
            }
            clearRateLimit(workspaceId)
            val now = System.currentTimeMillis()
            storeActiveDek(ws.id, passDek.copyOf(), now)
            vaultDao.updateLastActivity(ws.id, now)
            toSummary(ws)
        } finally {
            WorkspaceCryptoEngine.zeroize(passDek, bioDek)
            derived.clearKeys()
        }
    }

    /**
     * Wraps the workspace DEK under a newly authenticated AndroidKeyStore BIOMETRIC_STRONG Cipher
     * obtained from BiometricPrompt.CryptoObject.
     */
    suspend fun enrollBiometricKey(
        workspaceId: String,
        authenticatedEncryptCipher: Cipher,
        newAuthMethod: WorkspaceAuthMethod,
    ): WorkspaceSummary {
        require(
            newAuthMethod == WorkspaceAuthMethod.BIOMETRIC ||
                newAuthMethod == WorkspaceAuthMethod.BOTH,
        ) { "Biometric enrollment requires BIOMETRIC or BOTH policy." }

        val activeDek = activeDeks[workspaceId]
            ?: throw WorkspaceLockedException("Unlock workspace first before binding biometric key.")
        val ws = vaultDao.getWorkspaceById(workspaceId)
            ?: throw WorkspaceAuthException("Workspace not found.")

        val wrappedBio = authenticatedEncryptCipher.doFinal(activeDek)
        val iv = authenticatedEncryptCipher.iv
            ?: throw KeystoreUnavailableException("Biometric cipher did not produce an IV.")

        val updated = ws.copy(
            authMethod = newAuthMethod.value,
            wrappedDekBiometric = wrappedBio,
            wrappedDekBiometricIv = iv,
            biometricEnabled = true,
            lastActivityEpochMs = System.currentTimeMillis(),
        )
        vaultDao.upsertWorkspace(updated)
        return toSummary(updated)
    }

    /**
     * Clears biometric binding (or reverts to PASSPHRASE) after explicit passphrase recovery or re-auth.
     */
    suspend fun recoverOrRevertToPassphrasePolicy(
        workspaceId: String,
        rawPassphrase: String,
    ): WorkspaceSummary {
        unlockWorkspaceWithPassphrase(workspaceId, rawPassphrase, isRecoveryMode = true)
        val ws = vaultDao.getWorkspaceById(workspaceId)!!
        keystoreProvider.deleteBiometricKey(workspaceId)
        val updated = ws.copy(
            authMethod = WorkspaceAuthMethod.PASSPHRASE.value,
            wrappedDekBiometric = null,
            wrappedDekBiometricIv = null,
            biometricEnabled = false,
            lastActivityEpochMs = System.currentTimeMillis(),
        )
        vaultDao.upsertWorkspace(updated)
        return toSummary(updated)
    }

    suspend fun prepareBiometricDecryptCipher(workspaceId: String): Cipher {
        val ws = vaultDao.getWorkspaceById(workspaceId)
            ?: throw WorkspaceAuthException("Workspace not found.")
        val iv = ws.wrappedDekBiometricIv
            ?: throw BiometricKeyInvalidatedException("No biometric IV stored for this workspace.")
        return keystoreProvider.createBiometricDecryptCipher(workspaceId, iv)
    }

    suspend fun renameWorkspace(workspaceId: String, newName: String): WorkspaceSummary {
        requireDashboardAuth()
        val trimmed = newName.trim()
        require(trimmed.isNotEmpty() && trimmed.length <= 60) {
            "Workspace name must be 1–60 characters."
        }
        vaultDao.renameWorkspace(workspaceId, trimmed)
        return toSummary(vaultDao.getWorkspaceById(workspaceId)!!)
    }

    suspend fun updateAutoLockMinutes(workspaceId: String, minutes: Int): WorkspaceSummary {
        requireDashboardAuth()
        val ws = vaultDao.getWorkspaceById(workspaceId)
            ?: throw WorkspaceAuthException("Workspace not found.")
        val updated = ws.copy(autoLockMinutes = minutes.coerceAtLeast(0))
        vaultDao.upsertWorkspace(updated)
        return toSummary(updated)
    }

    /**
     * Rotates BOTH the passphrase verifier/KEK AND optionally rotates the underlying 256-bit DEK
     * by re-encrypting every record inside an atomic SQLite transaction with fresh 96-bit IVs.
     * Requires fresh verification of the current passphrase.
     */
    suspend fun rotatePassphraseAndRekey(
        workspaceId: String,
        currentRawPassphrase: String,
        newRawPassphrase: String,
        rotateDek: Boolean = true,
    ): WorkspaceSummary {
        val ws = vaultDao.getWorkspaceById(workspaceId)
            ?: throw WorkspaceAuthException("Workspace not found.")

        val currentNorm = PassphraseKdf.normalizeNfc(currentRawPassphrase)
        val newNorm = PassphraseKdf.validatePassphrase(newRawPassphrase)

        val oldParams = KdfParameters(ws.kdfMemoryKib, ws.kdfIterations, ws.kdfParallelism)
        val oldDerived = PassphraseKdf.deriveWorkspaceKeys(
            rawPassphrase = currentNorm,
            salt = ws.passphraseSalt,
            params = oldParams,
            contextId = workspaceId,
        )
        var oldDek: ByteArray? = null
        var newDek: ByteArray? = null
        val newDerived = PassphraseKdf.deriveWorkspaceKeys(
            rawPassphrase = newNorm,
            params = kdfParameters,
            contextId = workspaceId,
        )

        return try {
            if (!PassphraseKdf.verifyConstantTime(ws.passphraseVerifier, oldDerived.authVerifier)) {
                throw WorkspaceAuthException("Current passphrase verification failed.")
            }
            oldDek = WorkspaceCryptoEngine.unwrapDekWithKek(
                kekBytes = oldDerived.kek,
                envelope = EncryptedEnvelope(
                    iv = ws.wrappedDekPassphraseIv,
                    ciphertext = ws.wrappedDekPassphrase,
                    formatVersion = ws.wrappedDekPassphraseVersion,
                ),
                workspaceId = workspaceId,
            )

            val targetDek = if (rotateDek) {
                WorkspaceCryptoEngine.generateDek().also { newDek = it }
            } else {
                oldDek.copyOf().also { newDek = it }
            }

            val existingRecords = vaultDao.getAllEncryptedRecordsForWorkspace(workspaceId)
            val now = System.currentTimeMillis()
            val reEncryptedRecords = existingRecords.map { rec ->
                val oldAad = WorkspaceCryptoEngine.buildRecordAad(
                    workspaceId,
                    rec.recordType,
                    rec.recordId,
                    rec.formatVersion,
                )
                val plaintext = WorkspaceCryptoEngine.decrypt(
                    keyBytes = oldDek,
                    envelope = EncryptedEnvelope(rec.iv, rec.ciphertext, rec.formatVersion),
                    aad = oldAad,
                )
                try {
                    encryptRecordWithDek(
                        workspaceId = workspaceId,
                        dek = targetDek,
                        recordType = rec.recordType,
                        recordId = rec.recordId,
                        plaintext = plaintext,
                        nowMs = now,
                    )
                } finally {
                    WorkspaceCryptoEngine.zeroize(plaintext)
                }
            }

            val wrappedNewPass = WorkspaceCryptoEngine.wrapDekWithKek(newDerived.kek, targetDek, workspaceId)

            // If DEK rotated while biometric was previously enrolled, old biometric blob is stale
            // until user re-authenticates BiometricPrompt; safest behavior disables stale biometric blob.
            if (rotateDek && ws.biometricEnabled) {
                keystoreProvider.deleteBiometricKey(workspaceId)
            }

            val updatedWs = ws.copy(
                authMethod = if (rotateDek && ws.biometricEnabled) {
                    WorkspaceAuthMethod.PASSPHRASE.value
                } else {
                    ws.authMethod
                },
                passphraseSalt = newDerived.salt,
                passphraseVerifier = newDerived.authVerifier.copyOf(),
                kdfMemoryKib = kdfParameters.memoryKib,
                kdfIterations = kdfParameters.iterations,
                kdfParallelism = kdfParameters.parallelism,
                wrappedDekPassphrase = wrappedNewPass.ciphertext,
                wrappedDekPassphraseIv = wrappedNewPass.iv,
                wrappedDekPassphraseVersion = wrappedNewPass.formatVersion,
                wrappedDekBiometric = if (rotateDek) null else ws.wrappedDekBiometric,
                wrappedDekBiometricIv = if (rotateDek) null else ws.wrappedDekBiometricIv,
                biometricEnabled = if (rotateDek) false else ws.biometricEnabled,
                lastActivityEpochMs = now,
            )

            db.withTransaction {
                vaultDao.replaceEncryptedRecordsAndWorkspace(updatedWs, reEncryptedRecords)
            }

            if (isWorkspaceUnlocked(workspaceId)) {
                storeActiveDek(workspaceId, targetDek.copyOf(), now)
            }
            toSummary(updatedWs)
        } finally {
            WorkspaceCryptoEngine.zeroize(oldDek, newDek)
            oldDerived.clearKeys()
            newDerived.clearKeys()
        }
    }

    suspend fun deletePrivateWorkspace(
        workspaceId: String,
        rawPassphrase: String,
        biometricCipherForBothPolicy: Cipher? = null,
    ) {
        val ws = vaultDao.getWorkspaceById(workspaceId)
            ?: throw WorkspaceAuthException("Workspace not found.")
        val method = WorkspaceAuthMethod.fromValue(ws.authMethod)

        if (method == WorkspaceAuthMethod.BOTH) {
            val cipher = biometricCipherForBothPolicy
                ?: throw WorkspaceAuthException(
                    "Deletion requires both passphrase and biometric confirmation for this workspace.",
                )
            unlockWorkspaceWithBothFactors(workspaceId, rawPassphrase, cipher)
        } else {
            unlockWorkspaceWithPassphrase(workspaceId, rawPassphrase, isRecoveryMode = true)
        }

        lockWorkspace(workspaceId)
        keystoreProvider.deleteBiometricKey(workspaceId)
        vaultDao.deleteWorkspaceCompletely(workspaceId)
    }

    fun lockWorkspace(workspaceId: String) {
        val dek = activeDeks.remove(workspaceId)
        WorkspaceCryptoEngine.zeroize(dek)
        lastActivityByWorkspace.remove(workspaceId)
        _unlockedWorkspaceIds.value = activeDeks.keys.toSet()
    }

    fun lockAll() {
        val keys = activeDeks.keys.toList()
        keys.forEach { key ->
            WorkspaceCryptoEngine.zeroize(activeDeks.remove(key))
        }
        lastActivityByWorkspace.clear()
        dashboardAuthenticated = false
        _dashboardAuthState.value = false
        _unlockedWorkspaceIds.value = emptySet()
    }

    fun recordUserActivity(workspaceId: String) {
        if (workspaceId != DefaultSeedData.DEFAULT_WORKSPACE_ID && activeDeks.containsKey(workspaceId)) {
            lastActivityByWorkspace[workspaceId] = System.currentTimeMillis()
        }
    }

    /**
     * Enforces configured inactivity lock durations across all unlocked private workspaces.
     * Returns IDs of workspaces locked during this sweep.
     */
    suspend fun enforceInactivityTimeouts(nowEpochMs: Long = System.currentTimeMillis()): List<String> {
        val lockedNow = mutableListOf<String>()
        for (workspaceId in activeDeks.keys.toList()) {
            val ws = vaultDao.getWorkspaceById(workspaceId) ?: continue
            if (ws.autoLockMinutes <= 0) continue
            val last = lastActivityByWorkspace[workspaceId] ?: ws.createdAtEpochMs
            if (nowEpochMs - last >= ws.autoLockMinutes * 60_000L) {
                lockWorkspace(workspaceId)
                lockedNow.add(workspaceId)
            }
        }
        return lockedNow
    }

    /**
     * Reads and decrypts all records of a given type strictly for the specified unlocked workspace.
     * Never returns partial plaintext if ANY record fails GCM authentication.
     */
    suspend fun <T> readDecryptedRecords(
        workspaceId: String,
        recordType: String,
        decoder: (ByteArray) -> T,
    ): List<T> {
        val dek = activeDeks[workspaceId]
            ?: throw WorkspaceLockedException("Private workspace $workspaceId is locked.")
        val rows = vaultDao.getEncryptedRecordsByType(workspaceId, recordType)
        val result = ArrayList<T>(rows.size)
        for (row in rows) {
            val aad = WorkspaceCryptoEngine.buildRecordAad(
                workspaceId = row.workspaceId,
                recordType = row.recordType,
                recordId = row.recordId,
                formatVersion = row.formatVersion,
            )
            val plaintext = WorkspaceCryptoEngine.decrypt(
                keyBytes = dek,
                envelope = EncryptedEnvelope(row.iv, row.ciphertext, row.formatVersion),
                aad = aad,
            )
            try {
                result.add(decoder(plaintext))
            } finally {
                WorkspaceCryptoEngine.zeroize(plaintext)
            }
        }
        return result
    }

    suspend fun writeEncryptedRecord(
        workspaceId: String,
        recordType: String,
        recordId: String,
        plaintext: ByteArray,
    ) {
        val dek = activeDeks[workspaceId]
            ?: throw WorkspaceLockedException("Private workspace $workspaceId is locked.")
        try {
            val entity = encryptRecordWithDek(
                workspaceId = workspaceId,
                dek = dek,
                recordType = recordType,
                recordId = recordId,
                plaintext = plaintext,
                nowMs = System.currentTimeMillis(),
            )
            vaultDao.upsertEncryptedRecord(entity)
        } finally {
            WorkspaceCryptoEngine.zeroize(plaintext)
        }
    }

    suspend fun writeEncryptedBatch(
        workspaceId: String,
        items: List<Triple<String, String, ByteArray>>,
    ) {
        if (items.isEmpty()) return
        val dek = activeDeks[workspaceId]
            ?: throw WorkspaceLockedException("Private workspace $workspaceId is locked.")
        val now = System.currentTimeMillis()
        try {
            val entities = items.map { (type, id, plaintext) ->
                encryptRecordWithDek(workspaceId, dek, type, id, plaintext, now)
            }
            vaultDao.upsertEncryptedRecords(entities)
        } finally {
            items.forEach { (_, _, pt) -> WorkspaceCryptoEngine.zeroize(pt) }
        }
    }

    suspend fun deleteEncryptedRecord(workspaceId: String, recordType: String, recordId: String) {
        requireUnlocked(workspaceId)
        vaultDao.deleteEncryptedRecord(workspaceId, recordType, recordId)
    }

    suspend fun deleteEncryptedRecordsByType(workspaceId: String, recordType: String) {
        requireUnlocked(workspaceId)
        vaultDao.deleteEncryptedRecordsByType(workspaceId, recordType)
    }

    fun requireUnlocked(workspaceId: String) {
        if (workspaceId != DefaultSeedData.DEFAULT_WORKSPACE_ID && !activeDeks.containsKey(workspaceId)) {
            throw WorkspaceLockedException("Workspace is locked and requires authentication.")
        }
    }

    private fun requireDashboardAuth() {
        if (!dashboardAuthenticated) {
            throw SecurityException("Private Dashboard authentication required.")
        }
    }

    private fun storeActiveDek(workspaceId: String, dek: ByteArray, nowMs: Long) {
        val old = activeDeks.put(workspaceId, dek)
        WorkspaceCryptoEngine.zeroize(old)
        lastActivityByWorkspace[workspaceId] = nowMs
        _unlockedWorkspaceIds.value = activeDeks.keys.toSet()
    }

    private fun encryptRecordWithDek(
        workspaceId: String,
        dek: ByteArray,
        recordType: String,
        recordId: String,
        plaintext: ByteArray,
        nowMs: Long,
    ): EncryptedWorkspaceRecordEntity {
        val aad = WorkspaceCryptoEngine.buildRecordAad(
            workspaceId = workspaceId,
            recordType = recordType,
            recordId = recordId,
            formatVersion = WorkspaceCryptoEngine.FORMAT_VERSION,
        )
        val envelope = WorkspaceCryptoEngine.encrypt(dek, plaintext, aad)
        return EncryptedWorkspaceRecordEntity(
            workspaceId = workspaceId,
            recordType = recordType,
            recordId = recordId,
            iv = envelope.iv,
            ciphertext = envelope.ciphertext,
            formatVersion = envelope.formatVersion,
            updatedAtEpochMs = nowMs,
        )
    }

    private fun toSummary(entity: WorkspaceEntity): WorkspaceSummary {
        val method = WorkspaceAuthMethod.fromValue(entity.authMethod)
        val keyMissing = entity.biometricEnabled && !keystoreProvider.hasBiometricKey(entity.id)
        return WorkspaceSummary(
            id = entity.id,
            displayName = entity.displayName,
            isPrivate = entity.isPrivate,
            isLocked = entity.isPrivate && !activeDeks.containsKey(entity.id),
            authMethod = method,
            autoLockMinutes = entity.autoLockMinutes,
            lastActivityEpochMs = entity.lastActivityEpochMs,
            createdAtEpochMs = entity.createdAtEpochMs,
            hasBiometricKey = entity.biometricEnabled && !keyMissing,
            biometricInvalidated = keyMissing,
        )
    }

    private fun enforceRateLimit(bucket: String) {
        val until = lockedUntilEpochMs[bucket] ?: return
        val remainingMs = until - System.currentTimeMillis()
        if (remainingMs > 0) {
            val secs = ((remainingMs + 999) / 1000).toInt()
            throw WorkspaceAuthException(
                "Too many failed authentication attempts. Wait ${secs}s before retrying.",
                retryAfterSeconds = secs,
            )
        }
    }

    private fun recordFailure(bucket: String): Int {
        val count = (failedAttempts[bucket] ?: 0) + 1
        failedAttempts[bucket] = count
        val delaySeconds = when {
            count <= 2 -> 0
            count == 3 -> 2
            count == 4 -> 5
            count == 5 -> 15
            else -> 30
        }
        if (delaySeconds > 0) {
            lockedUntilEpochMs[bucket] = System.currentTimeMillis() + delaySeconds * 1000L
        }
        return delaySeconds
    }

    private fun clearRateLimit(bucket: String) {
        failedAttempts.remove(bucket)
        lockedUntilEpochMs.remove(bucket)
    }
}
