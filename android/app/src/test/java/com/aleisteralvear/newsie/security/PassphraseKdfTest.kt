package com.aleisteralvear.newsie.security

import com.aleisteralvear.newsie.security.encryption.KdfParameters
import com.aleisteralvear.newsie.security.encryption.PassphraseKdf
import com.aleisteralvear.newsie.security.encryption.PassphrasePolicyException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PassphraseKdfTest {

    // Fast test params preserve Argon2id + HKDF logic in milliseconds; production constants test separately.
    private val fastParams = KdfParameters(memoryKib = 1024, iterations = 2, parallelism = 1)

    @Test
    fun validatePassphrase_enforcesMinCodePointsAndSupportsUnicodeEmojiSpacesPunctuation() {
        assertThrows(PassphrasePolicyException::class.java) {
            PassphraseKdf.validatePassphrase("short7!")
        }
        // 7 emoji should fail even though UTF-16 length is 14!
        assertThrows(PassphrasePolicyException::class.java) {
            PassphraseKdf.validatePassphrase("🔒🔐🔑🗝️📰🛡️🔏")
        }
        val overMax = "a".repeat(1025)
        assertThrows(PassphrasePolicyException::class.java) {
            PassphraseKdf.validatePassphrase(overMax)
        }

        val validComplex = "Café Noir! 2025 🔐📰"
        assertEquals(PassphraseKdf.normalizeNfc(validComplex), PassphraseKdf.validatePassphrase(validComplex))
    }

    @Test
    fun unicodeNfcNormalization_derivesIdenticalArgon2idKeysForCanonicalForms() {
        val decomposed = "cafe\u0301 secre\u0302t! 🔑" // NFD combining marks
        val composed = "caf\u00e9 secr\u00eat! 🔑" // NFC precomposed
        assertNotEquals(decomposed, composed)

        val salt = ByteArray(16) { (it + 1).toByte() }
        val k1 = PassphraseKdf.deriveWorkspaceKeys(decomposed, salt, fastParams, contextId = "ws-1")
        val k2 = PassphraseKdf.deriveWorkspaceKeys(composed, salt, fastParams, contextId = "ws-1")
        val s1 = PassphraseKdf.deriveSearchAccessVerifier(decomposed, salt, fastParams)
        val s2 = PassphraseKdf.deriveSearchAccessVerifier(composed, salt, fastParams)

        try {
            assertArrayEquals(k1.authVerifier, k2.authVerifier)
            assertArrayEquals(k1.kek, k2.kek)
            assertArrayEquals(s1, s2)
        } finally {
            k1.clearKeys()
            k2.clearKeys()
        }
    }

    @Test
    fun hkdfDomainSeparation_neverSharesKeysAcrossVerifierKekAndSearchGate() {
        val phrase = "My Strong Phrase! 🔐"
        val salt = ByteArray(16) { 0x4A.toByte() }
        val wsKeys = PassphraseKdf.deriveWorkspaceKeys(phrase, salt, fastParams, contextId = "ws-alpha")
        val wsOtherKeys = PassphraseKdf.deriveWorkspaceKeys(phrase, salt, fastParams, contextId = "ws-beta")
        val searchVerifier = PassphraseKdf.deriveSearchAccessVerifier(phrase, salt, fastParams)

        try {
            assertFalse(wsKeys.authVerifier.contentEquals(wsKeys.kek))
            assertFalse(wsKeys.authVerifier.contentEquals(searchVerifier))
            assertFalse(wsKeys.kek.contentEquals(searchVerifier))
            assertFalse(wsKeys.authVerifier.contentEquals(wsOtherKeys.authVerifier))
            assertFalse(wsKeys.kek.contentEquals(wsOtherKeys.kek))
        } finally {
            wsKeys.clearKeys()
            wsOtherKeys.clearKeys()
        }
    }

    @Test
    fun productionArgon2idParameters_matchSpec64MiB3IterationsAndVerifyConstantTime() {
        assertEquals(65_536, KdfParameters.DEFAULT_MEMORY_KIB)
        assertEquals(3, KdfParameters.DEFAULT_ITERATIONS)
        assertEquals(1, KdfParameters.DEFAULT_PARALLELISM)

        val salt = PassphraseKdf.generateSalt()
        val derived = PassphraseKdf.deriveWorkspaceKeys(
            rawPassphrase = "Production Vault Key 2025! 🔐",
            salt = salt,
            params = KdfParameters(),
            contextId = "ws-prod",
        )
        val tampered = derived.authVerifier.copyOf().also { it[0] = (it[0].toInt() xor 0x01).toByte() }

        try {
            assertEquals(32, derived.authVerifier.size)
            assertEquals(32, derived.kek.size)
            assertTrue(PassphraseKdf.verifyConstantTime(derived.authVerifier, derived.authVerifier.copyOf()))
            assertFalse(PassphraseKdf.verifyConstantTime(derived.authVerifier, tampered))
        } finally {
            derived.clearKeys()
        }
    }
}
