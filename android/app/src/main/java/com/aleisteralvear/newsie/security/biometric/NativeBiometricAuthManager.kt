package com.aleisteralvear.newsie.security.biometric

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import javax.crypto.Cipher
import kotlin.coroutines.resume

enum class BiometricCapabilityStatus(
    val isReady: Boolean,
    val userMessage: String,
) {
    READY(
        isReady = true,
        userMessage = "Strong biometric hardware and Keystore enrollment ready.",
    ),
    NONE_ENROLLED(
        isReady = false,
        userMessage = "No strong biometrics enrolled in Android device settings. Passphrase protection remains active.",
    ),
    NO_HARDWARE(
        isReady = false,
        userMessage = "This device lacks Class 3 (BIOMETRIC_STRONG) biometric hardware required for hardware-bound workspace keys.",
    ),
    HARDWARE_UNAVAILABLE(
        isReady = false,
        userMessage = "Biometric hardware is currently unavailable.",
    ),
    SECURITY_UPDATE_REQUIRED(
        isReady = false,
        userMessage = "A system security update is required before strong biometrics can be used.",
    );
}

sealed interface BiometricPromptResult {
    data class Authenticated(val cipher: Cipher) : BiometricPromptResult
    data object Cancelled : BiometricPromptResult
    data class Error(val errorCode: Int, val message: String) : BiometricPromptResult
}

object NativeBiometricAuthManager {
    private const val ALLOWED_AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG

    fun checkCapability(context: Context): BiometricCapabilityStatus {
        val manager = BiometricManager.from(context)
        return when (manager.canAuthenticate(ALLOWED_AUTHENTICATORS)) {
            BiometricManager.BIOMETRIC_SUCCESS -> BiometricCapabilityStatus.READY
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> BiometricCapabilityStatus.NONE_ENROLLED
            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE,
            BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED -> BiometricCapabilityStatus.NO_HARDWARE
            BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED ->
                BiometricCapabilityStatus.SECURITY_UPDATE_REQUIRED
            else -> BiometricCapabilityStatus.HARDWARE_UNAVAILABLE
        }
    }

    suspend fun authenticateWithCrypto(
        activity: FragmentActivity,
        cipher: Cipher,
        title: String,
        subtitle: String,
        negativeButtonText: String = "Cancel",
    ): BiometricPromptResult = suspendCancellableCoroutine { continuation ->
        val executor = ContextCompat.getMainExecutor(activity)
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val returnedCipher = result.cryptoObject?.cipher
                if (!continuation.isActive) return
                if (returnedCipher == null) {
                    continuation.resume(
                        BiometricPromptResult.Error(
                            BiometricPrompt.ERROR_UNABLE_TO_PROCESS,
                            "Biometric authentication succeeded without returning cryptographic key object.",
                        ),
                    )
                } else {
                    continuation.resume(BiometricPromptResult.Authenticated(returnedCipher))
                }
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                if (!continuation.isActive) return
                if (errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                    errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                    errorCode == BiometricPrompt.ERROR_CANCELED
                ) {
                    continuation.resume(BiometricPromptResult.Cancelled)
                } else {
                    continuation.resume(BiometricPromptResult.Error(errorCode, errString.toString()))
                }
            }

            override fun onAuthenticationFailed() {
                // Keep prompt open for additional retries until Android signals lockout or cancellation
            }
        }

        val prompt = BiometricPrompt(activity, executor, callback)
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(ALLOWED_AUTHENTICATORS)
            .setNegativeButtonText(negativeButtonText)
            .setConfirmationRequired(true)
            .build()

        continuation.invokeOnCancellation {
            runCatching { prompt.cancelAuthentication() }
        }

        prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }
}
