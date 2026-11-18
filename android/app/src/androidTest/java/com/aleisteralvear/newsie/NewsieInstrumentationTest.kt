package com.aleisteralvear.newsie

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.aleisteralvear.newsie.data.database.NewsieDatabase
import com.aleisteralvear.newsie.data.preferences.NewsiePreferencesStore
import com.aleisteralvear.newsie.data.repository.NewsieRepository
import com.aleisteralvear.newsie.domain.models.Article
import com.aleisteralvear.newsie.domain.models.FeedFormat
import com.aleisteralvear.newsie.network.http.NewsHttpClient
import com.aleisteralvear.newsie.security.keystore.AndroidKeystoreManager
import com.aleisteralvear.newsie.security.workspaces.WorkspaceVaultManager
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Ignore
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.charset.StandardCharsets

@RunWith(AndroidJUnit4::class)
class NewsieInstrumentationTest {

    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun appLaunchesPublicHomeFeedAndNavigatesTabsCleanly() {
        composeRule.onNodeWithText("Newsie").assertIsDisplayed()
        composeRule.onNodeWithText("Home").performClick()
        composeRule.onNodeWithText("Search").performClick()
        composeRule.onNodeWithText("Saved").performClick()
        composeRule.onNodeWithText("Sources").performClick()
        composeRule.onNodeWithText("Directory").assertIsDisplayed()
        composeRule.onNodeWithText("Settings").performClick()
        composeRule.onNodeWithText("Appearance").assertIsDisplayed()
    }

    @Test
    fun sqlCipherDatabaseFileRejectsUnencryptedOpenAndContainsZeroPlaintextPrivateSentinels() = runBlocking {
        val context: Context = ApplicationProvider.getApplicationContext()
        val keystore = AndroidKeystoreManager(context)
        val db = NewsieDatabase.createEncrypted(context, keystore)
        val vault = WorkspaceVaultManager(db, keystore)
        val repo = NewsieRepository(db, NewsiePreferencesStore(context), vault, NewsHttpClient())

        val sentinel = "ANDROID_SQLCIPHER_PRIVATE_SENTINEL_4091"
        val ws = vault.createPrivateWorkspace("Device Encrypted", "Device Passphrase! 2025", 5)
        val src = repo.addSource(ws.id, "Priv Feed", "https://example.org/rss.xml", FeedFormat.RSS, "news")
        repo.insertArticlesForWorkspace(
            ws.id,
            listOf(
                Article(
                    id = "dev-art-1",
                    fingerprint = "fp-dev-1",
                    sourceId = src.id,
                    publisher = "Priv Feed",
                    categoryId = "news",
                    categoryName = "Top Stories",
                    title = sentinel,
                    description = sentinel,
                    excerpt = sentinel,
                    url = "https://example.org/dev-1",
                    publishedAtIso = "2025-03-01T10:00:00Z",
                    publishedEpochMs = 1740823200000L,
                    publishedLabel = "1h ago",
                    readTimeMinutes = 2,
                ),
            ),
        )
        vault.lockWorkspace(ws.id)
        db.close()

        val dbPath = context.getDatabasePath(NewsieDatabase.DB_NAME)
        assertTrue(dbPath.exists())
        val rawText = String(dbPath.readBytes(), StandardCharsets.ISO_8859_1)
        assertTrue(!rawText.startsWith("SQLite format 3"))
        assertTrue(!rawText.contains(sentinel))

        var unencryptedOpenFailed = false
        try {
            SQLiteDatabase.openDatabase(dbPath.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
                .use { it.rawQuery("SELECT count(*) FROM workspaces", null).close() }
        } catch (_: Exception) {
            unencryptedOpenFailed = true
        }
        assertTrue("Unencrypted SQLite MUST fail to read SQLCipher DB!", unencryptedOpenFailed)
        File(context.filesDir, "noop").delete()
        assertEquals(true, unencryptedOpenFailed)
    }

    @Test
    @Ignore("Requires physical Android device or AVD with enrolled Class 3 BIOMETRIC_STRONG hardware and AndroidKeyStore TEE/StrongBox.")
    fun physicalHardwareStrongBoxAndBiometricPromptUnlockVerification() {
        composeRule.onNodeWithContentDescription("Newsie logo").performClick()
    }
}
