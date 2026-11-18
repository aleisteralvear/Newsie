package com.aleisteralvear.newsie.security.encryption

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.Normalizer
import java.util.Arrays
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

data class KdfParameters(
    val memoryKib: Int = DEFAULT_MEMORY_KIB,
    val iterations: Int = DEFAULT_ITERATIONS,
    val parallelism: Int = DEFAULT_PARALLELISM,
) {
    companion object {
        // Production target: 64 MiB, 3 iterations, parallelism 1 per security specification §6.3.
        const val DEFAULT_MEMORY_KIB: Int = 65_536
        const val DEFAULT_ITERATIONS: Int = 3
        const val DEFAULT_PARALLELISM: Int = 1
        const val SALT_BYTES: Int = 16
        const val KEY_BYTES: Int = 32
    }
}

class PassphrasePolicyException(message: String) : IllegalArgumentException(message)

data class DerivedPassphraseMaterial(
    val authVerifier: ByteArray,
    val kek: ByteArray,
    val salt: ByteArray,
    val params: KdfParameters,
) {
    fun clearKeys() {
        Arrays.fill(authVerifier, 0.toByte())
        Arrays.fill(kek, 0.toByte())
    }
}

object PassphraseKdf {
    const val MIN_CODE_POINTS = 8
    const val MAX_UTF16_LENGTH = 1024

    private val secureRandom = SecureRandom()

    fun normalizeNfc(rawInput: String): String =
        Normalizer.normalize(rawInput, Normalizer.Form.NFC)

    fun countCharacters(rawInput: String): Int {
        val normalized = normalizeNfc(rawInput)
        var count = 0
        var i = 0
        var afterZwj = false
        while (i < normalized.length) {
            val cp = normalized.codePointAt(i)
            i += Character.charCount(cp)
            val type = Character.getType(cp)
            val isCombiningOrModifier =
                type == Character.NON_SPACING_MARK.toInt() ||
                    type == Character.ENCLOSING_MARK.toInt() ||
                    type == Character.COMBINING_SPACING_MARK.toInt() ||
                    cp in 0xFE00..0xFE0F ||
                    cp in 0xE0100..0xE01EF
            if (cp == 0x200D) {
                afterZwj = true
                continue
            }
            if (isCombiningOrModifier) {
                continue
            }
            if (afterZwj) {
                afterZwj = false
                continue
            }
            count++
        }
        return count
    }

    fun validatePassphrase(rawInput: String): String {
        val normalized = normalizeNfc(rawInput)
        val charCount = countCharacters(normalized)
        if (charCount < MIN_CODE_POINTS) {
            throw PassphrasePolicyException(
                "Passphrase must be at least $MIN_CODE_POINTS characters.",
            )
        }
        if (normalized.length > MAX_UTF16_LENGTH) {
            throw PassphrasePolicyException(
                "Passphrase must not exceed $MAX_UTF16_LENGTH characters.",
            )
        }
        return normalized
    }

    fun generateSalt(): ByteArray = ByteArray(KdfParameters.SALT_BYTES).also {
        secureRandom.nextBytes(it)
    }

    /**
     * Derives independent domain-separated keys via Argon2id -> HKDF-SHA256.
     * Supports arbitrary UTF-8 including spaces, punctuation, and emoji via NFC normalization.
     */
    fun deriveWorkspaceKeys(
        rawPassphrase: String,
        salt: ByteArray = generateSalt(),
        params: KdfParameters = KdfParameters(),
        contextId: String,
    ): DerivedPassphraseMaterial {
        val master = deriveRawArgon2id(rawPassphrase, salt, params)
        return try {
            val authVerifier = hkdfSha256(
                ikm = master,
                salt = salt,
                info = "newsie:workspace-verifier:v1:$contextId".toByteArray(StandardCharsets.UTF_8),
                length = KdfParameters.KEY_BYTES,
            )
            val kek = hkdfSha256(
                ikm = master,
                salt = salt,
                info = "newsie:workspace-kek:v1:$contextId".toByteArray(StandardCharsets.UTF_8),
                length = KdfParameters.KEY_BYTES,
            )
            DerivedPassphraseMaterial(
                authVerifier = authVerifier,
                kek = kek,
                salt = salt.copyOf(),
                params = params,
            )
        } finally {
            Arrays.fill(master, 0.toByte())
        }
    }

    /**
     * Derives a dedicated verifier for Method A Search Access Phrase, completely domain-separated
     * from workspace authentication or DEK encryption keys.
     */
    fun deriveSearchAccessVerifier(
        rawPhrase: String,
        salt: ByteArray = generateSalt(),
        params: KdfParameters = KdfParameters(),
    ): ByteArray {
        val normalized = validatePassphrase(rawPhrase)
        val master = deriveRawArgon2id(normalized, salt, params)
        return try {
            hkdfSha256(
                ikm = master,
                salt = salt,
                info = "newsie:search-access-gate:v1".toByteArray(StandardCharsets.UTF_8),
                length = KdfParameters.KEY_BYTES,
            )
        } finally {
            Arrays.fill(master, 0.toByte())
        }
    }

    fun verifyConstantTime(expected: ByteArray, candidate: ByteArray): Boolean =
        expected.isNotEmpty() && MessageDigest.isEqual(expected, candidate)

    private fun deriveRawArgon2id(
        rawInput: String,
        salt: ByteArray,
        params: KdfParameters,
    ): ByteArray {
        val normalized = normalizeNfc(rawInput)
        val inputBytes = normalized.toByteArray(StandardCharsets.UTF_8)
        val output = ByteArray(KdfParameters.KEY_BYTES)
        return try {
            val argonParams = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
                .withVersion(Argon2Parameters.ARGON2_VERSION_13)
                .withSalt(salt)
                .withMemoryAsKB(params.memoryKib)
                .withIterations(params.iterations)
                .withParallelism(params.parallelism)
                .build()
            val generator = Argon2BytesGenerator()
            generator.init(argonParams)
            generator.generateBytes(inputBytes, output)
            output
        } finally {
            Arrays.fill(inputBytes, 0.toByte())
        }
    }

    /**
     * RFC 5869 HKDF-SHA256 for strict key separation across independent purposes.
     */
    fun hkdfSha256(
        ikm: ByteArray,
        salt: ByteArray,
        info: ByteArray,
        length: Int,
    ): ByteArray {
        val hmacAlg = "HmacSHA256"
        val effectiveSalt = if (salt.isEmpty()) ByteArray(32) else salt
        val prkMac = Mac.getInstance(hmacAlg)
        prkMac.init(SecretKeySpec(effectiveSalt, hmacAlg))
        val prk = prkMac.doFinal(ikm)

        return try {
            val result = ByteArray(length)
            var t = ByteArray(0)
            var offset = 0
            var counter: Byte = 1
            while (offset < length) {
                val expandMac = Mac.getInstance(hmacAlg)
                expandMac.init(SecretKeySpec(prk, hmacAlg))
                expandMac.update(t)
                expandMac.update(info)
                expandMac.update(counter)
                t = expandMac.doFinal()
                val copyLen = minOf(t.size, length - offset)
                System.arraycopy(t, 0, result, offset, copyLen)
                offset += copyLen
                counter = (counter + 1).toByte()
            }
            Arrays.fill(t, 0.toByte())
            result
        } finally {
            Arrays.fill(prk, 0.toByte())
        }
    }
}
