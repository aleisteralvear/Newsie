# Newsie — Native Android Edition

Native Kotlin + Jetpack Compose + Material 3 client located in `/android`, preserving the existing web reference repository untouched.

## Architecture Overview

- `com.aleisteralvear.newsie.domain`: Core domain models, editorial baseline seed data (`isSample = true` clearly distinguished from verified live directory feeds), and article deduplication/normalization use cases (`ArticleNormalizer`).
- `com.aleisteralvear.newsie.security`:
  - `PassphraseKdf`: Unicode NFC normalization (`Normalizer.Form.NFC`), 8–1024 code-point bounds, **Argon2id** (`65,536 KiB` / `64 MiB`, `3` iterations, `1` parallelism, BouncyCastle pure-JVM implementation), plus RFC 5869 **HKDF-SHA256** separating verifier, KEK, and Method A Search Gate keys.
  - `WorkspaceCryptoEngine`: Random 256-bit per-workspace Data Encryption Keys (DEKs), **AES-256-GCM** with unique 96-bit `SecureRandom` IVs and AAD bound to `workspaceId | recordType | recordId | formatVersion`.
  - `AndroidKeystoreManager`: Hardware-backed **AndroidKeyStore** keys cleanly split between the database SQLCipher master key (`newsie_db_sqlcipher_master_v1`, wrapped blob in `noBackupFilesDir`) and per-workspace biometric keys (`newsie_ws_bio_<id>`, requiring `AUTH_BIOMETRIC_STRONG` per use via `BiometricPrompt.CryptoObject`). Attempts StrongBox when present, falls back safely to Hardware TEE (`Trusted Environment`), and detects `KeyPermanentlyInvalidatedException` without silent downgrade.
  - `WorkspaceVaultManager`: Holds active DEKs strictly in volatile memory, zeroes key byte arrays when locked, enforces rate-limiting backoff, supports PASSPHRASE / BIOMETRIC / BOTH (MFA) unlocking + passphrase recovery, atomic key + DEK rotation, inactivity timeouts, and authenticated workspace deletion.
- `com.aleisteralvear.newsie.data`: Room + **SQLCipher** (`SupportOpenHelperFactory`, `TRUNCATE` journal mode). Every private workspace entity (`articles`, `sources`, `categories`, `bookmarks`, `reading_history`, `search_history`, `saved_config`, `preferences`) is persisted continuously encrypted in `encrypted_workspace_records`.
- `com.aleisteralvear.newsie.network`: Direct on-device **OkHttp** fetching with `SsrfGuardingDns`, manual redirect re-validation (max 5 hops), 2 MB response size cap, conditional `ETag`/`Last-Modified`, XXE-hardened **XmlPullParser** (rejects `<!DOCTYPE` / `<!ENTITY`, disables DOCDECL) for RSS 2.0, Atom 1.0, and OPML 2.0.
- `com.aleisteralvear.newsie.workers`: **WorkManager** periodic sync honoring refresh intervals, Wi-Fi-only preference, battery constraints, and skipping locked private workspaces.
- `com.aleisteralvear.newsie.ui`: Jetpack Compose + Material 3 editorial theme (`#FBF9F5` Warm Paper / `#0B192C` Deep Navy / `#B0893E` Antique Gold), `FLAG_SECURE` window protection during any private session, app switcher blur shield, and adaptive phone/tablet navigation (`NavigationBar` / `NavigationRail` + two-column grid).

## Security Boundaries

- Android `allowBackup="false"`, restrictive `backup_rules.xml`, `data_extraction_rules.xml`, and `network_security_config.xml` (`cleartextTrafficPermitted="false"`).
- Hardware StrongBox/TEE behavior and biometric enrollment require physical Android hardware with enrolled Class 3 biometrics to validate end-to-end.
- No application-level encryption defeats a rooted OS, compromised kernel, or privileged memory inspection while plaintext is in active JVM heap (`String` values are garbage-collected by the ART runtime).
