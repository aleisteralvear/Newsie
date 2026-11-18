# Newsie Security Architecture & Threat Model

## 1. Assets Protected
- Private workspace subscriptions, cached articles, bookmarks, reading history, search history, feed configurations, and per-workspace preferences across all workspaces.
- Per-workspace `256-bit` Data Encryption Keys (DEKs) and Argon2id key-derivation salts/verifiers.
- Method A Private Access search passphrase verifier (Argon2id salted hash).
- WebAuthn platform passkey public keys (COSE EC2/RS256 -> SPKI) and server-side single-use challenges.
- Integrity and safety of outbound RSS/Atom/OPML feed fetches.

## 2. Trust Boundaries & Defenses
- **Passphrase Authentication & Unicode NFC:** Uses **Argon2id** (`16 MiB` memory, `3` iterations, unique `16-byte` random CSPRNG salt per secret) supporting full UTF-8, spaces, punctuation, and emoji passphrases (Unicode NFC-normalized, length `8..1024`). Plaintext passphrases are never persisted or logged, and verification uses constant-time `crypto.timingSafeEqual`.
- **Continuous AES-256-GCM Encryption at Rest (Even While Unlocked):**
  - The default public workspace uses standard SQLite tables.
  - Private workspaces (`is_private = 1`) **never** persist plaintext records into SQLite data tables (`categories`, `sources`, `articles`, `reading_history`, `search_history`, `saved_feed_configs`, `preferences`).
  - While unlocked, all private workspace operations execute against an isolated per-workspace `:memory:` SQLite instance (`DatabaseSync(':memory:')`), and every mutation flushes changed records transactionally (`BEGIN IMMEDIATE ... COMMIT`) to `encrypted_workspace_records` encrypted with the workspace DEK, a unique random `12-byte` IV per write, a `16-byte` GCM tag, and per-record Associated Authenticated Data (`${workspaceId}:${recordType}:${recordId}`).
  - Unexpected server crashes (`SIGKILL` / power loss) therefore leave zero plaintext private articles, sources, or histories on disk.
- **Private Access Entry Gate (Zero Pre-Auth Enumeration):**
  - **Method A (Search Passphrase):** Evaluated via Argon2id constant-time comparison **before** `/api/search` queries or `search_history` inserts; matching clears the field without entering search history or logs and triggers Private Access Verification.
  - **Method B (Search Control Double-Tap):** Configurable double-tap window (`200ms..800ms`, default `350ms`) plus keyboard alternatives (`Shift+Enter` on Search nav, `Alt+Shift+P`). Normal single-tap Search works normally, and no visible private-workspace shortcut is exposed in normal navigation bars or Settings.
  - Public API responses (`GET /api/workspaces` without dashboard/session credentials, `GET /api/private-access/status`) never expose private workspace names, IDs, or counts.
- **Genuine WebAuthn Verification (Web Environment):**
  - Registration and unlock verify single-use `32-byte` CSPRNG challenges (`120s` TTL, deleted immediately on attempt), client origin, `rpIdHash` (`SHA-256`), User Presence (`UP`), User Verification (`UV`), monotonic `signCount`, and ECDSA P-256 / RS256 signatures against stored SPKI public keys.
  - When a passkey is enrolled, `"biometric"` wraps a backup copy of the DEK under a server-local seal key (`data/.vault-seal.key`) released only upon verified WebAuthn assertion; `"both"` requires BOTH Argon2id passphrase unwrapping AND verified WebAuthn assertion.
- **Fresh Re-Authentication & Session Lifecycle:**
  - Changing workspace authentication policies, rotating passphrases, removing passkeys, and deleting private workspaces require fresh re-authentication (`passphrase` or WebAuthn assertion), not merely an ambient session token.
  - Session tokens (`32-byte` CSPRNG) are bound 1:1 to a single `workspaceId` in volatile server memory, paired with absolute server expiration TTL (`45m` workspace / `15m` dashboard) and background `15s` auto-lock sweepers (`1m / 5m / 15m / 30m / manual`). Tab close triggers `keepalive` token revocation and lock.
  - Search queries are sent in `POST /api/search` JSON bodies rather than URL query parameters.
- **SSRF & XML Hardening:** User-supplied feed and OPML URLs are validated syntactically and via DNS resolution (`assertSafePublicUrl`) to reject `localhost`, RFC1918 private subnets, link-local metadata (`169.254.169.254`), and internal hostnames before fetching and after HTTP redirects. XML parsing rejects `<!DOCTYPE` and `<!ENTITY` declarations.

## 3. Honest Platform & Memory Limitations
- **Web vs Native Android Hardware Boundary:** This application runs as a web app (React + Express + SQLite). Browser WebAuthn platform authenticators and server-local DEK sealing (`data/.vault-seal.key`) are **not** equivalent to Android `BiometricPrompt` bound to `AndroidKeyStore` hardware-backed StrongBox/TEE crypto objects. A future native Android build must implement `BiometricPrompt` + `AndroidKeyStore` directly in Kotlin.
- **Process RAM & Garbage Collection:** While DEK `Buffer`s are zeroized (`fill(0)`) and `:memory:` SQLite databases closed on lock/expiration/deletion, Node.js/V8 garbage collection and SQLite's C allocator may retain transient plaintext or key copies in process memory until overwritten by the allocator or OS. Client-side JS memory (`apiClient.ts`) also clears volatile tokens immediately, though browser string immutability applies until GC.
- **Forgotten Passphrase Recovery:** Passphrase-derived KEKs cannot be recovered if forgotten without destroying access to locked workspace ciphertext.
- **Flash Storage Deletion:** Deleting a workspace erases all database rows, encrypted records, and wrapped keys in SQLite. On flash-backed SSD/eMMC storage with wear-leveling, unlinked physical page remnants may persist until overwritten by the storage controller.
