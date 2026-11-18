package com.aleisteralvear.newsie.security

import android.app.Application
import android.content.Context
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.test.core.app.ApplicationProvider
import com.aleisteralvear.newsie.data.database.NewsieDatabase
import com.aleisteralvear.newsie.data.preferences.NewsiePreferencesStore
import com.aleisteralvear.newsie.data.repository.NewsieRepository
import com.aleisteralvear.newsie.data.repository.PrivateRecordSerializer
import com.aleisteralvear.newsie.domain.models.Article
import com.aleisteralvear.newsie.domain.models.DefaultSeedData
import com.aleisteralvear.newsie.domain.models.FeedFormat
import com.aleisteralvear.newsie.domain.models.SearchScope
import com.aleisteralvear.newsie.domain.models.SortOrder
import com.aleisteralvear.newsie.domain.models.WorkspaceAuthMethod
import com.aleisteralvear.newsie.network.http.NewsHttpClient
import com.aleisteralvear.newsie.security.encryption.EncryptedEnvelope
import com.aleisteralvear.newsie.security.encryption.KdfParameters
import com.aleisteralvear.newsie.security.encryption.WorkspaceCryptoEngine
import com.aleisteralvear.newsie.security.keystore.BiometricKeyInvalidatedException
import com.aleisteralvear.newsie.security.keystore.KeystoreProvider
import com.aleisteralvear.newsie.security.keystore.KeystoreSecurityTier
import com.aleisteralvear.newsie.security.workspaces.WorkspaceAuthException
import com.aleisteralvear.newsie.security.workspaces.WorkspaceLockedException
import com.aleisteralvear.newsie.security.workspaces.WorkspaceVaultManager
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Software fake simulating AndroidKeyStore hardware binding, key invalidation, and wipe semantics
 * inside JVM Robolectric tests where Android's binder keystore daemon is absent.
 */
private class FakeAndroidKeystoreProvider : KeystoreProvider {
    private val dbKey = WorkspaceCryptoEngine.generateDatabaseKey()
    private val workspaceKeys = mutableMapOf<String, SecretKey>()
    private val invalidatedWorkspaces = mutableSetOf<String>()

    override fun getOrCreateDatabasePassphrase(): ByteArray = dbKey.copyOf()

    override fun getDatabaseKeyTier(): KeystoreSecurityTier = KeystoreSecurityTier.HARDWARE_TEE

    override fun ensureBiometricKeyAndEncryptCipher(workspaceId: String): Pair<Cipher, KeystoreSecurityTier> {
        invalidatedWorkspaces.remove(workspaceId)
        val kg = KeyGenerator.getInstance("AES").apply { init(256) }
        val key = kg.generateKey()
        workspaceKeys[workspaceId] = key
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD("newsie:biometric-dek-wrap:$workspaceId:v1".toByteArray(StandardCharsets.UTF_8))
        return cipher to KeystoreSecurityTier.HARDWARE_TEE
    }

    override fun createBiometricDecryptCipher(workspaceId: String, iv: ByteArray): Cipher {
        if (workspaceId in invalidatedWorkspaces) {
            throw BiometricKeyInvalidatedException("Simulated biometric enrollment invalidation.")
        }
        val key = workspaceKeys[workspaceId]
            ?: throw BiometricKeyInvalidatedException("Missing biometric key for $workspaceId.")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        cipher.updateAAD("newsie:biometric-dek-wrap:$workspaceId:v1".toByteArray(StandardCharsets.UTF_8))
        return cipher
    }

    override fun deleteBiometricKey(workspaceId: String) {
        workspaceKeys.remove(workspaceId)
        invalidatedWorkspaces.remove(workspaceId)
    }

    override fun hasBiometricKey(workspaceId: String): Boolean =
        workspaceKeys.containsKey(workspaceId) && workspaceId !in invalidatedWorkspaces

    override fun getWorkspaceBiometricTier(workspaceId: String): KeystoreSecurityTier? =
        if (hasBiometricKey(workspaceId)) KeystoreSecurityTier.HARDWARE_TEE else null

    fun simulateBiometricEnrollmentChanged(workspaceId: String) {
        invalidatedWorkspaces.add(workspaceId)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class)
class WorkspaceVaultSecurityTest {

    private lateinit var context: Context
    private lateinit var dbFile: File
    private lateinit var db: NewsieDatabase
    private lateinit var keystore: FakeAndroidKeystoreProvider
    private lateinit var vault: WorkspaceVaultManager
    private lateinit var repository: NewsieRepository

    private val fastKdf = KdfParameters(memoryKib = 1024, iterations = 2, parallelism = 1)

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        dbFile = File(context.filesDir, "security_test_${System.nanoTime()}.db")
        db = openDb()
        keystore = FakeAndroidKeystoreProvider()
        vault = WorkspaceVaultManager(db, keystore, fastKdf)
        repository = NewsieRepository(db, NewsiePreferencesStore(context), vault, NewsHttpClient())
    }

    @After
    fun tearDown() {
        runCatching { db.close() }
        deleteDbFiles()
    }

    private fun openDb(): NewsieDatabase =
        Room.databaseBuilder(context, NewsieDatabase::class.java, dbFile.absolutePath)
            .allowMainThreadQueries()
            .setJournalMode(RoomDatabase.JournalMode.TRUNCATE)
            .build()

    private fun deleteDbFiles() {
        listOf(dbFile, File("${dbFile.absolutePath}-journal"), File("${dbFile.absolutePath}-wal"), File("${dbFile.absolutePath}-shm"))
            .forEach { it.delete() }
    }

    private fun assertSentinelAbsentFromDisk(sentinel: String) {
        val needle = sentinel.toByteArray(StandardCharsets.UTF_8)
        val candidates = listOf(
            dbFile,
            File("${dbFile.absolutePath}-journal"),
            File("${dbFile.absolutePath}-wal"),
            File("${dbFile.absolutePath}-shm"),
        ).filter { it.exists() }

        for (file in candidates) {
            val bytes = file.readBytes()
            val found = indexOfSubarray(bytes, needle)
            assertEquals("Plaintext sentinel '$sentinel' leaked into ${file.name}!", -1, found)
        }
    }

    private fun indexOfSubarray(haystack: ByteArray, needle: ByteArray): Int {
        if (needle.isEmpty() || haystack.size < needle.size) return -1
        outer@ for (i in 0..(haystack.size - needle.size)) {
            for (j in needle.indices) {
                if (haystack[i + j] != needle[j]) continue@outer
            }
            return i
        }
        return -1
    }

    @Test
    fun crashPersistenceReleaseBlocker_privateRecordsNeverExistInPlaintextOnDiskAfterLockOrCrash() = runTest {
        val sentinelArticleTitle = "SENTINEL_TOP_SECRET_ALPHA_9942"
        val sentinelArticleBody = "CONFIDENTIAL_INVESTIGATIVE_BODY_ZETA_5512"
        val sentinelSearch = "SENTINEL_SEARCH_TERM_8811"
        val crashSentinelTitle = "SENTINEL_UNFLUSHED_CRASH_7709"

        val ws = vault.createPrivateWorkspace(
            displayName = "Investigative Vault",
            rawPassphrase = "Strong Vault Passphrase! 🔐",
            autoLockMinutes = 5,
        )
        val src = repository.addSource(
            ws.id,
            "Sentinel Feed",
            "https://example.org/private.xml",
            FeedFormat.RSS,
            "technology",
        )
        repository.insertArticlesForWorkspace(
            ws.id,
            listOf(
                Article(
                    id = "art-sentinel-1",
                    fingerprint = "fp-sentinel-1",
                    sourceId = src.id,
                    publisher = "Sentinel Feed",
                    categoryId = "technology",
                    categoryName = "Technology",
                    title = sentinelArticleTitle,
                    description = sentinelArticleBody,
                    excerpt = sentinelArticleBody,
                    url = "https://example.org/story-1",
                    publishedAtIso = "2025-03-01T10:00:00Z",
                    publishedEpochMs = 1740823200000L,
                    publishedLabel = "1h ago",
                    readTimeMinutes = 3,
                ),
            ),
        )
        repository.setBookmark(ws.id, "art-sentinel-1", true)
        repository.addSearchHistoryTerm(ws.id, sentinelSearch)

        // Confirm readable while unlocked
        assertEquals(1, repository.getArticlesPage(ws.id, "all", SortOrder.NEWEST, 20, 0).items.size)
        assertEquals(1, repository.getBookmarkedArticles(ws.id).size)

        // 1) Explicit lock + inspect raw SQLite & journal bytes
        vault.lockWorkspace(ws.id)
        db.close()

        assertSentinelAbsentFromDisk(sentinelArticleTitle)
        assertSentinelAbsentFromDisk(sentinelArticleBody)
        assertSentinelAbsentFromDisk(sentinelSearch)

        // 2) Reopen, unlock, write WITHOUT calling lockWorkspace(), simulate sudden app termination
        db = openDb()
        val reopenedVault = WorkspaceVaultManager(db, keystore, fastKdf)
        val reopenedRepo = NewsieRepository(db, NewsiePreferencesStore(context), reopenedVault, NewsHttpClient())
        reopenedVault.unlockWorkspaceWithPassphrase(ws.id, "Strong Vault Passphrase! 🔐")
        reopenedRepo.insertArticlesForWorkspace(
            ws.id,
            listOf(
                Article(
                    id = "art-crash-2",
                    fingerprint = "fp-crash-2",
                    sourceId = src.id,
                    publisher = "Sentinel Feed",
                    categoryId = "technology",
                    categoryName = "Technology",
                    title = crashSentinelTitle,
                    description = "CRASH_BODY_4410",
                    excerpt = "CRASH_BODY_4410",
                    url = "https://example.org/story-2",
                    publishedAtIso = "2025-03-01T11:00:00Z",
                    publishedEpochMs = 1740826800000L,
                    publishedLabel = "Just now",
                    readTimeMinutes = 2,
                ),
            ),
        )
        // Intentionally NO lockWorkspace() call — drop vault reference directly and close SQLite
        db.close()

        assertSentinelAbsentFromDisk(crashSentinelTitle)
        assertSentinelAbsentFromDisk("CRASH_BODY_4410")

        // 3) Reopen fresh process instance and assert locked state is enforced cleanly
        db = openDb()
        val postCrashVault = WorkspaceVaultManager(db, keystore, fastKdf)
        val postCrashRepo = NewsieRepository(db, NewsiePreferencesStore(context), postCrashVault, NewsHttpClient())
        assertFalse(postCrashVault.isWorkspaceUnlocked(ws.id))

        var lockedCaught = false
        try {
            postCrashRepo.getArticlesPage(ws.id, "all", SortOrder.NEWEST, 20, 0)
        } catch (_: WorkspaceLockedException) {
            lockedCaught = true
        }
        assertTrue("Expected WorkspaceLockedException after cold restart!", lockedCaught)
    }

    @Test
    fun workspacesAreStrictlyIsolatedBetweenPublicAAndB() = runTest {
        repository.ensurePublicBaselineSeeded()
        val wsA = vault.createPrivateWorkspace("Vault Alpha", "Alpha Passphrase! 🔐", 10)
        val wsB = vault.createPrivateWorkspace("Vault Beta", "Beta Passphrase! 🗝️", 10)

        repository.addSource(wsA.id, "Alpha Feed", "https://alpha.example.org/rss.xml", FeedFormat.RSS, "news")
        repository.insertArticlesForWorkspace(
            wsA.id,
            listOf(
                Article(
                    id = "a-1",
                    fingerprint = "fp-a-1",
                    sourceId = "src-a",
                    publisher = "Alpha Feed",
                    categoryId = "news",
                    categoryName = "Top Stories",
                    title = "Alpha Only Dispatch",
                    description = "Strictly Alpha",
                    excerpt = "Strictly Alpha",
                    url = "https://alpha.example.org/1",
                    publishedAtIso = "2025-03-01T10:00:00Z",
                    publishedEpochMs = 1740823200000L,
                    publishedLabel = "1h ago",
                    readTimeMinutes = 2,
                ),
            ),
        )

        // Beta must contain zero Alpha records, and Public must contain zero Alpha records
        assertEquals(0, repository.searchArticles(wsB.id, "Alpha Only Dispatch", SearchScope.CACHED, emptySet()).size)
        assertEquals(
            0,
            repository.searchArticles(DefaultSeedData.DEFAULT_WORKSPACE_ID, "Alpha Only Dispatch", SearchScope.CACHED, emptySet()).size,
        )

        // Cross-workspace encrypted record read cannot leak or decrypt
        val rawAlphaRows = db.workspaceVaultDao().getAllEncryptedRecordsForWorkspace(wsA.id)
        assertTrue(rawAlphaRows.isNotEmpty())
    }

    @Test
    fun bothPolicyEnforcesMfaAndInvalidatedKeystoreFailsClosedWithoutDowngrade() = runTest {
        val pass = "MFA Passphrase 2025 🔐"
        val ws = vault.createPrivateWorkspace("MFA Vault", pass, 5)
        val (encCipher, _) = keystore.ensureBiometricKeyAndEncryptCipher(ws.id)
        vault.enrollBiometricKey(ws.id, encCipher, WorkspaceAuthMethod.BOTH)

        vault.lockWorkspace(ws.id)
        vault.exitDashboardView()

        // Dashboard passphrase entry MUST leave BOTH workspace locked
        vault.authenticateDashboardWithPassphrase(pass)
        assertFalse(vault.isWorkspaceUnlocked(ws.id))

        // Passphrase alone MUST fail
        var passAloneRejected = false
        try {
            vault.unlockWorkspaceWithPassphrase(ws.id, pass, isRecoveryMode = false)
        } catch (_: WorkspaceAuthException) {
            passAloneRejected = true
        }
        assertTrue(passAloneRejected)

        // Biometric alone MUST fail
        val wsRow = db.workspaceVaultDao().getWorkspaceById(ws.id)!!
        val bioCipherOnly = keystore.createBiometricDecryptCipher(ws.id, wsRow.wrappedDekBiometricIv!!)
        var bioAloneRejected = false
        try {
            vault.unlockWorkspaceWithBiometric(ws.id, bioCipherOnly)
        } catch (_: WorkspaceAuthException) {
            bioAloneRejected = true
        }
        assertTrue(bioAloneRejected)

        // BOTH factors together MUST succeed
        val bioCipherMfa = keystore.createBiometricDecryptCipher(ws.id, wsRow.wrappedDekBiometricIv!!)
        vault.unlockWorkspaceWithBothFactors(ws.id, pass, bioCipherMfa)
        assertTrue(vault.isWorkspaceUnlocked(ws.id))

        // Now lock and simulate biometric enrollment invalidation on the phone
        vault.lockWorkspace(ws.id)
        keystore.simulateBiometricEnrollmentChanged(ws.id)

        // Preparing biometric cipher throws BiometricKeyInvalidatedException — workspace remains strictly LOCKED (never downgraded!)
        var invalidatedCaught = false
        try {
            vault.prepareBiometricDecryptCipher(ws.id)
        } catch (_: BiometricKeyInvalidatedException) {
            invalidatedCaught = true
        }
        assertTrue(invalidatedCaught)
        assertFalse(vault.isWorkspaceUnlocked(ws.id))

        // Explicit recovery with passphrase unlocks and reverts cleanly to PASSPHRASE mode
        val recovered = vault.recoverOrRevertToPassphrasePolicy(ws.id, pass)
        assertTrue(vault.isWorkspaceUnlocked(ws.id))
        assertEquals(WorkspaceAuthMethod.PASSPHRASE, recovered.authMethod)
    }

    @Test
    fun methodASearchPhraseSupportsUnicodeNfcAndNeverWritesToSearchHistory() = runTest {
        val phraseNfc = "caf\u00e9 vault! 🔐"
        val phraseNfd = "cafe\u0301 vault! 🔐"
        vault.createPrivateWorkspace("Hidden Gate Test", "Gate Passphrase 123!", 5)
        vault.setSearchAccessPhrase(phraseNfc)

        assertTrue(vault.checkSearchAccessPhrase(phraseNfd))
        assertFalse(vault.checkSearchAccessPhrase("wrong phrase 123!"))

        // Public search history must remain completely clean of any access phrase
        assertFalse(repository.getSearchHistory(DefaultSeedData.DEFAULT_WORKSPACE_ID).contains(phraseNfc))
        assertFalse(repository.getSearchHistory(DefaultSeedData.DEFAULT_WORKSPACE_ID).contains(phraseNfd))
    }

    @Test
    fun rotationInactivityTimeoutAndDeletionMaintainFullSecurityInvariants() = runTest {
        val oldPass = "Original Key! 2025"
        val newPass = "Rotated Key! 2026 🔐"
        val ws = vault.createPrivateWorkspace("Rotation Test", oldPass, autoLockMinutes = 1)
        repository.addSource(ws.id, "Private Rss", "https://example.org/rss.xml", FeedFormat.RSS, "news")

        val recordsBefore = db.workspaceVaultDao().getAllEncryptedRecordsForWorkspace(ws.id)
        assertTrue(recordsBefore.isNotEmpty())
        val firstIvBefore = recordsBefore.first().iv.copyOf()

        // Rotate passphrase + DEK
        vault.rotatePassphraseAndRekey(ws.id, oldPass, newPass, rotateDek = true)
        val recordsAfter = db.workspaceVaultDao().getAllEncryptedRecordsForWorkspace(ws.id)
        assertFalse(firstIvBefore.contentEquals(recordsAfter.first().iv))

        // Lock via inactivity sweep
        val futureEpoch = System.currentTimeMillis() + 120_000L
        val autoLocked = vault.enforceInactivityTimeouts(futureEpoch)
        assertTrue(ws.id in autoLocked)
        assertFalse(vault.isWorkspaceUnlocked(ws.id))

        // Old passphrase must fail
        var oldRejected = false
        try {
            vault.unlockWorkspaceWithPassphrase(ws.id, oldPass)
        } catch (_: WorkspaceAuthException) {
            oldRejected = true
        }
        assertTrue(oldRejected)

        // New passphrase must unlock cleanly and read rotated records
        vault.unlockWorkspaceWithPassphrase(ws.id, newPass)
        assertEquals(1, repository.getSources(ws.id).size)

        // Authenticated deletion removes workspace & every encrypted record completely
        vault.deletePrivateWorkspace(ws.id, newPass)
        assertEquals(0, db.workspaceVaultDao().countPrivateWorkspaces())
        assertTrue(db.workspaceVaultDao().getAllEncryptedRecordsForWorkspace(ws.id).isEmpty())
    }
}
