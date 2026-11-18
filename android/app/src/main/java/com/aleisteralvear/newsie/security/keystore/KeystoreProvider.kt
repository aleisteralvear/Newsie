package com.aleisteralvear.newsie.security.keystore

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import com.aleisteralvear.newsie.security.encryption.WorkspaceCryptoEngine
import org.json.JSONObject
import java.io.File
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

enum class KeystoreSecurityTier(val label: String) {
    STRONGBOX("StrongBox Hardware Security Module"),
    HARDWARE_TEE("TEE Hardware-Backed Keystore"),
    SOFTWARE_ONLY("Software Keystore (No Hardware Security Module Detected)");
}

class BiometricKeyInvalidatedException(message: String, cause: Throwable? = null) :
    SecurityException(message, cause)

class KeystoreUnavailableException(message: String, cause: Throwable? = null) :
    SecurityException(message, cause)

interface KeystoreProvider {
    fun getOrCreateDatabasePassphrase(): ByteArray
    fun getDatabaseKeyTier(): KeystoreSecurityTier
    fun ensureBiometricKeyAndEncryptCipher(workspaceId: String): Pair<Cipher, KeystoreSecurityTier>
    fun createBiometricDecryptCipher(workspaceId: String, iv: ByteArray): Cipher
    fun deleteBiometricKey(workspaceId: String)
    fun hasBiometricKey(workspaceId: String): Boolean
    fun getWorkspaceBiometricTier(workspaceId: String): KeystoreSecurityTier?
}

/**
 * Manages hardware-backed AndroidKeyStore AES-256-GCM keys cleanly separated by purpose:
 * 1) DB master key alias ("newsie_db_sqlcipher_master_v1") for SQLCipher key wrapping
 *    stored inside noBackupFilesDir (never SharedPreferences or DataStore).
 * 2) Per-workspace biometric authentication-bound AES-256-GCM keys ("newsie_ws_bio_<id>")
 *    requiring fresh BIOMETRIC_STRONG confirmation per unlock via BiometricPrompt.CryptoObject.
 */
class AndroidKeystoreManager(private val context: Context) : KeystoreProvider {
    private val keyStore: KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    private val dbKeyFile = File(context.noBackupFilesDir, "newsie_vault_db.key.json")

    @Synchronized
    override fun getOrCreateDatabasePassphrase(): ByteArray {
        val dbAlias = DB_MASTER_ALIAS
        if (dbKeyFile.exists() && keyStore.containsAlias(dbAlias)) {
            return unwrapExistingDbKey(dbAlias)
        }
        // Fail closed rather than silently creating a mismatched database key if DB already exists
        val dbFile = context.getDatabasePath("newsie_vault.db")
        if (dbFile.exists() && (!dbKeyFile.exists() || !keyStore.containsAlias(dbAlias))) {
            throw KeystoreUnavailableException(
                "Database master Keystore key is missing while encrypted database exists.",
            )
        }

        val secretKey = generateOrGetMasterKey(dbAlias, requireUserAuth = false)
        val rawDbKey = WorkspaceCryptoEngine.generateDatabaseKey()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        cipher.updateAAD(DB_KEY_AAD)
        val ciphertext = cipher.doFinal(rawDbKey)
        val iv = cipher.iv

        val payload = JSONObject().apply {
            put("v", 1)
            put("iv", Base64.getEncoder().encodeToString(iv))
            put("ct", Base64.getEncoder().encodeToString(ciphertext))
        }

        dbKeyFile.parentFile?.mkdirs()
        val tmp = File(dbKeyFile.parentFile, "${dbKeyFile.name}.tmp")
        tmp.writeText(payload.toString(), StandardCharsets.UTF_8)
        if (!tmp.renameTo(dbKeyFile)) {
            tmp.copyTo(dbKeyFile, overwrite = true)
            tmp.delete()
        }
        return rawDbKey
    }

    override fun getDatabaseKeyTier(): KeystoreSecurityTier =
        inspectAliasSecurityTier(DB_MASTER_ALIAS) ?: KeystoreSecurityTier.SOFTWARE_ONLY

    override fun ensureBiometricKeyAndEncryptCipher(
        workspaceId: String,
    ): Pair<Cipher, KeystoreSecurityTier> {
        val alias = biometricAlias(workspaceId)
        deleteBiometricKey(workspaceId)
        val secretKey = generateOrGetMasterKey(alias, requireUserAuth = true)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        cipher.updateAAD(biometricAad(workspaceId))
        val tier = inspectAliasSecurityTier(alias) ?: KeystoreSecurityTier.SOFTWARE_ONLY
        return cipher to tier
    }

    override fun createBiometricDecryptCipher(workspaceId: String, iv: ByteArray): Cipher {
        val alias = biometricAlias(workspaceId)
        val entry = keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry
            ?: throw BiometricKeyInvalidatedException(
                "Biometric Keystore key is missing. Unlock with your passphrase to re-enroll.",
            )
        val secretKey = entry.secretKey
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                secretKey,
                GCMParameterSpec(WorkspaceCryptoEngine.GCM_TAG_BITS, iv),
            )
            cipher.updateAAD(biometricAad(workspaceId))
            cipher
        } catch (ex: KeyPermanentlyInvalidatedException) {
            throw BiometricKeyInvalidatedException(
                "Biometric enrollment changed on this device. Unlock with your passphrase to re-bind biometrics.",
                ex,
            )
        } catch (ex: Exception) {
            throw KeystoreUnavailableException(
                "Unable to initialize Keystore biometric cipher cleanly.",
                ex,
            )
        }
    }

    override fun deleteBiometricKey(workspaceId: String) {
        val alias = biometricAlias(workspaceId)
        runCatching {
            if (keyStore.containsAlias(alias)) {
                keyStore.deleteEntry(alias)
            }
        }
    }

    override fun hasBiometricKey(workspaceId: String): Boolean =
        runCatching { keyStore.containsAlias(biometricAlias(workspaceId)) }.getOrDefault(false)

    override fun getWorkspaceBiometricTier(workspaceId: String): KeystoreSecurityTier? =
        inspectAliasSecurityTier(biometricAlias(workspaceId))

    private fun unwrapExistingDbKey(alias: String): ByteArray {
        val entry = keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry
            ?: throw KeystoreUnavailableException("SQLCipher Keystore key missing.")
        return try {
            val json = JSONObject(dbKeyFile.readText(StandardCharsets.UTF_8))
            val iv = Base64.getDecoder().decode(json.getString("iv"))
            val ct = Base64.getDecoder().decode(json.getString("ct"))
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                entry.secretKey,
                GCMParameterSpec(WorkspaceCryptoEngine.GCM_TAG_BITS, iv),
            )
            cipher.updateAAD(DB_KEY_AAD)
            cipher.doFinal(ct)
        } catch (ex: Exception) {
            throw KeystoreUnavailableException("Failed to decrypt SQLCipher key from AndroidKeyStore.", ex)
        }
    }

    private fun generateOrGetMasterKey(alias: String, requireUserAuth: Boolean): SecretKey {
        if (keyStore.containsAlias(alias)) {
            (keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.secretKey?.let {
                return it
            }
        }

        val preferStrongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)

        if (preferStrongBox) {
            try {
                return generateKeyInternal(alias, requireUserAuth, useStrongBox = true)
            } catch (_: StrongBoxUnavailableException) {
                // Fall back to standard hardware TEE/Keystore cleanly when StrongBox cannot hold key
            } catch (_: Exception) {
                // Retry without StrongBox flag if OEM StrongBox hal rejects parameters
            }
        }
        return generateKeyInternal(alias, requireUserAuth, useStrongBox = false)
    }

    private fun generateKeyInternal(
        alias: String,
        requireUserAuth: Boolean,
        useStrongBox: Boolean,
    ): SecretKey {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val builder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && useStrongBox) {
            builder.setIsStrongBoxBacked(true)
        }

        if (requireUserAuth) {
            builder.setUserAuthenticationRequired(true)
            builder.setInvalidatedByBiometricEnrollment(true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                builder.setUserAuthenticationParameters(
                    0, // Require per-use authentication with CryptoObject
                    KeyProperties.AUTH_BIOMETRIC_STRONG,
                )
            } else {
                @Suppress("DEPRECATION")
                builder.setUserAuthenticationValidityDurationSeconds(-1)
            }
        }

        generator.init(builder.build())
        return generator.generateKey()
    }

    private fun inspectAliasSecurityTier(alias: String): KeystoreSecurityTier? {
        return try {
            val entry = keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry ?: return null
            val factory = SecretKeyFactory.getInstance(entry.secretKey.algorithm, ANDROID_KEYSTORE)
            val info = factory.getKeySpec(entry.secretKey, KeyInfo::class.java) as KeyInfo
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                when (info.securityLevel) {
                    KeyProperties.SECURITY_LEVEL_STRONGBOX -> KeystoreSecurityTier.STRONGBOX
                    KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> KeystoreSecurityTier.HARDWARE_TEE
                    else -> KeystoreSecurityTier.SOFTWARE_ONLY
                }
            } else {
                @Suppress("DEPRECATION")
                if (info.isInsideSecureHardware) {
                    KeystoreSecurityTier.HARDWARE_TEE
                } else {
                    KeystoreSecurityTier.SOFTWARE_ONLY
                }
            }
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val DB_MASTER_ALIAS = "newsie_db_sqlcipher_master_v1"
        private val DB_KEY_AAD = "newsie:sqlcipher:db-master-key:v1".toByteArray(StandardCharsets.UTF_8)

        fun biometricAlias(workspaceId: String): String = "newsie_ws_bio_$workspaceId"
        fun biometricAad(workspaceId: String): ByteArray =
            "newsie:biometric-dek-wrap:$workspaceId:v1".toByteArray(StandardCharsets.UTF_8)
    }
}
