package com.aleisteralvear.newsie.security

import com.aleisteralvear.newsie.security.encryption.EncryptedEnvelope
import com.aleisteralvear.newsie.security.encryption.WorkspaceCryptoEngine
import com.aleisteralvear.newsie.security.encryption.WorkspaceCryptoException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import java.nio.charset.StandardCharsets

class WorkspaceCryptoEngineTest {

    @Test
    fun encryptAndDecrypt_roundTripsWithUniqueNonces() {
        val dek = WorkspaceCryptoEngine.generateDek()
        assertEquals(32, dek.size)

        val aad = WorkspaceCryptoEngine.buildRecordAad("ws-1", "article", "art-1", 1)
        val plaintext = "Confidential private briefing body".toByteArray(StandardCharsets.UTF_8)

        val env1 = WorkspaceCryptoEngine.encrypt(dek, plaintext, aad)
        val env2 = WorkspaceCryptoEngine.encrypt(dek, plaintext, aad)

        assertEquals(12, env1.iv.size)
        assertFalse(env1.iv.contentEquals(env2.iv))
        assertFalse(env1.ciphertext.contentEquals(env2.ciphertext))

        val decrypted = WorkspaceCryptoEngine.decrypt(dek, env1, aad)
        assertArrayEquals(plaintext, decrypted)
    }

    @Test
    fun aadMismatch_throwsWorkspaceCryptoExceptionAcrossWorkspaceTypeIdOrVersion() {
        val dek = WorkspaceCryptoEngine.generateDek()
        val plaintext = "Secret payload".toByteArray(StandardCharsets.UTF_8)
        val goodAad = WorkspaceCryptoEngine.buildRecordAad("ws-alpha", "article", "art-99", 1)
        val env = WorkspaceCryptoEngine.encrypt(dek, plaintext, goodAad)

        assertThrows(WorkspaceCryptoException::class.java) {
            WorkspaceCryptoEngine.decrypt(
                dek,
                env,
                WorkspaceCryptoEngine.buildRecordAad("ws-beta", "article", "art-99", 1),
            )
        }
        assertThrows(WorkspaceCryptoException::class.java) {
            WorkspaceCryptoEngine.decrypt(
                dek,
                env,
                WorkspaceCryptoEngine.buildRecordAad("ws-alpha", "bookmark", "art-99", 1),
            )
        }
        assertThrows(WorkspaceCryptoException::class.java) {
            WorkspaceCryptoEngine.decrypt(
                dek,
                env,
                WorkspaceCryptoEngine.buildRecordAad("ws-alpha", "article", "art-100", 1),
            )
        }
        assertThrows(WorkspaceCryptoException::class.java) {
            WorkspaceCryptoEngine.decrypt(
                dek,
                env,
                WorkspaceCryptoEngine.buildRecordAad("ws-alpha", "article", "art-99", 2),
            )
        }
    }

    @Test
    fun tamperedCiphertextOrWrongKey_failsAuthenticationCleanly() {
        val dek = WorkspaceCryptoEngine.generateDek()
        val otherDek = WorkspaceCryptoEngine.generateDek()
        val aad = WorkspaceCryptoEngine.buildRecordAad("ws-alpha", "source", "src-1", 1)
        val env = WorkspaceCryptoEngine.encrypt(dek, "https://example.com/rss".toByteArray(), aad)

        val corrupted = EncryptedEnvelope(
            iv = env.iv.copyOf(),
            ciphertext = env.ciphertext.copyOf().also { it[it.lastIndex] = (it[it.lastIndex].toInt() xor 0xFF).toByte() },
            formatVersion = env.formatVersion,
        )

        assertThrows(WorkspaceCryptoException::class.java) {
            WorkspaceCryptoEngine.decrypt(dek, corrupted, aad)
        }
        assertThrows(WorkspaceCryptoException::class.java) {
            WorkspaceCryptoEngine.decrypt(otherDek, env, aad)
        }
    }
}
