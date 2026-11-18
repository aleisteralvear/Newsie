package com.aleisteralvear.newsie.domain

import com.aleisteralvear.newsie.domain.models.AppPreferences
import com.aleisteralvear.newsie.domain.models.DefaultSeedData
import com.aleisteralvear.newsie.domain.models.WorkspaceAuthMethod
import com.aleisteralvear.newsie.domain.models.WorkspaceSummary
import com.aleisteralvear.newsie.domain.usecases.ArticleNormalizer
import com.aleisteralvear.newsie.ui.NewsieUiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ArticleNormalizerAndUiStateTest {

    @Test
    fun normalizeArticleUrl_stripsTrackingParametersAndNormalizesSchemeHost() {
        val cleaned = ArticleNormalizer.normalizeArticleUrl(
            "HTTPS://Example.ORG:443/world/story?id=42&utm_source=x&fbclid=abc&gclid=xyz",
        )
        assertEquals("https://example.org/world/story?id=42", cleaned)
    }

    @Test
    fun parseFlexibleTimestamp_supportsIso8601AndRfc1123() {
        val iso = ArticleNormalizer.parseFlexibleTimestamp("2025-02-18T14:30:00Z")
        val rfc = ArticleNormalizer.parseFlexibleTimestamp("Tue, 18 Feb 2025 14:30:00 GMT")
        assertEquals(iso, rfc)
    }

    @Test
    fun requiresFlagSecure_activatesStrictlyForAllPrivateContextsAndInactiveInPublic() {
        val publicState = NewsieUiState()
        assertFalse(publicState.requiresFlagSecure)

        assertTrue(publicState.copy(showPrivateAuthModal = true).requiresFlagSecure)
        assertTrue(publicState.copy(showPrivateDashboard = true).requiresFlagSecure)
        assertTrue(publicState.copy(showCreateWorkspaceModal = true).requiresFlagSecure)
        assertTrue(publicState.copy(activeWorkspaceIsPrivate = true).requiresFlagSecure)
        assertTrue(
            publicState.copy(
                showUnlockTargetModal = WorkspaceSummary(
                    id = "ws-1",
                    displayName = "Vault",
                    isPrivate = true,
                    isLocked = true,
                    authMethod = WorkspaceAuthMethod.PASSPHRASE,
                    autoLockMinutes = 5,
                    lastActivityEpochMs = null,
                    createdAtEpochMs = 1L,
                    hasBiometricKey = false,
                ),
            ).requiresFlagSecure,
        )
    }

    @Test
    fun seedDataContainsBaselineCategoriesSourcesAndSampleArticles() {
        assertTrue(DefaultSeedData.defaultCategories.size >= 5)
        assertTrue(DefaultSeedData.sampleSources.isNotEmpty())
        assertTrue(DefaultSeedData.sampleArticles.isNotEmpty())
        assertTrue(DefaultSeedData.curatedDirectory.all { it.url.startsWith("https://") })
        assertTrue(15 in AppPreferences.REFRESH_INTERVAL_OPTIONS)
        assertTrue(20 in AppPreferences.PAGE_SIZE_OPTIONS)
    }
}
