package com.aleisteralvear.newsie.security.encryption

import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.Arrays
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

data class EncryptedEnvelope(
    val iv: ByteArray,
    val ciphertext: ByteArray,
    val formatVersion: Int = CURRENT_FORMAT_VERSION,
) {
    companion object {
        const val CURRENT_FORMAT_VERSION = 1
    }
}

class WorkspaceCryptoException(message: String, cause: Throwable? = null) :
    SecurityException(message, cause)

object WorkspaceCryptoEngine {
    const val DEK_BYTES = 32 // 256-bit DEK
    const val GCM_IV_BYTES = 12 // 96-bit unique random nonce
    const val GCM_TAG_BITS = 128 // 128-bit GCM authentication tag
    const val FORMAT_VERSION = 1

    private val secureRandom = SecureRandom()

    fun generateDek(): ByteArray = ByteArray(DEK_BYTES).also {
        secureRandom.nextBytes(it)
    }

    fun generateDatabaseKey(): ByteArray = ByteArray(DEK_BYTES).also {
        secureRandom.nextBytes(it)
    }

    fun buildRecordAad(
        workspaceId: String,
        recordType: String,
        recordId: String,
        formatVersion: Int = FORMAT_VERSION,
    ): ByteArray =
        "ws=$workspaceId|type=$recordType|id=$recordId|v=$formatVersion"
            .toByteArray(StandardCharsets.UTF_8)

    fun buildKeyWrapAad(
        workspaceId: String,
        purpose: String,
        formatVersion: Int = FORMAT_VERSION,
    ): ByteArray =
        "wrap=$workspaceId|purpose=$purpose|v=$formatVersion"
            .toByteArray(StandardCharsets.UTF_8)

    fun encrypt(
        keyBytes: ByteArray,
        plaintext: ByteArray,
        aad: ByteArray,
        formatVersion: Int = FORMAT_VERSION,
    ): EncryptedEnvelope {
        require(keyBytes.size == DEK_BYTES) {
            "Expected 256-bit AES key, got ${keyBytes.size * 8} bits."
        }
        val iv = ByteArray(GCM_IV_BYTES)
        secureRandom.nextBytes(iv)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val keySpec = SecretKeySpec(keyBytes, "AES")
        val gcmSpec = GCMParameterSpec(GCM_TAG_BITS, iv)
        cipher.init(Cipher.ENCRYPT_MODE, keySpec, gcmSpec)
        cipher.updateAAD(aad)
        val ciphertext = cipher.doFinal(plaintext)
        return EncryptedEnvelope(
            iv = iv,
            ciphertext = ciphertext,
            formatVersion = formatVersion,
        )
    }

    fun decrypt(
        keyBytes: ByteArray,
        envelope: EncryptedEnvelope,
        aad: ByteArray,
    ): ByteArray {
        require(keyBytes.size == DEK_BYTES) {
            "Expected 256-bit AES key, got ${keyBytes.size * 8} bits."
        }
        if (envelope.iv.size != GCM_IV_BYTES) {
            throw WorkspaceCryptoException("Invalid AES-GCM nonce length.")
        }
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val keySpec = SecretKeySpec(keyBytes, "AES")
            val gcmSpec = GCMParameterSpec(GCM_TAG_BITS, envelope.iv)
            cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec)
            cipher.updateAAD(aad)
            cipher.doFinal(envelope.ciphertext)
        } catch (ex: AEADBadTagException) {
            throw WorkspaceCryptoException(
                "Authentication tag verification failed or key/AAD mismatch.",
                ex,
            )
        } catch (ex: Exception) {
            throw WorkspaceCryptoException("Decryption failed cleanly without partial output.", ex)
        }
    }

    fun wrapDekWithKek(
        kekBytes: ByteArray,
        dekBytes: ByteArray,
        workspaceId: String,
    ): EncryptedEnvelope {
        val aad = buildKeyWrapAad(workspaceId, purpose = "passphrase-dek-wrap")
        return encrypt(kekBytes, dekBytes, aad)
    }

    fun unwrapDekWithKek(
        kekBytes: ByteArray,
        envelope: EncryptedEnvelope,
        workspaceId: String,
    ): ByteArray {
        val aad = buildKeyWrapAad(workspaceId, purpose = "passphrase-dek-wrap", formatVersion = envelope.formatVersion)
        return decrypt(kekBytes, envelope, aad)
    }

    fun zeroize(vararg buffers: ByteArray?) {
        for (buf in buffers) {
            if (buf != null) {
                Arrays.fill(buf, 0.toByte())
            }
        }
    }
}
