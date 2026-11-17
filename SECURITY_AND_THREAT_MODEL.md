# Newsie Security Architecture & Threat Model

## 1. Assets Protected
- Private workspace subscriptions, cached articles, bookmarks, reading history, search history, and per-workspace preferences.
- Workspace Data Encryption Keys (DEKs) and Argon2id key-derivation salts/verifiers.
- Integrity and safety of outbound RSS/Atom/OPML feed fetches.

## 2. Trust Boundaries & Defenses
- **Passphrase Authentication:** Uses **Argon2id** (`16 MiB` memory, `3` iterations, unique `16-byte` random CSPRNG salt per workspace) supporting full UTF-8, spaces, symbols, and emoji passphrases (NFC-normalized). Plaintext passphrases are never persisted or logged.
- **Authenticated Encryption at Rest:** Each private workspace receives an independent random `256-bit` DEK. The DEK is wrapped with an Argon2id-derived Key Encryption Key (KEK) via **AES-256-GCM** (`12-byte` random IV, `16-byte` GCM authentication tag). When locked, all private workspace records are serialized, encrypted with the workspace DEK via AES-256-GCM into `encrypted_workspace_blobs`, purged from plaintext SQLite tables, and the in-memory DEK buffer is zeroized (`fill(0)`).
- **Strict Workspace Isolation:** Every `/api/*` request targeting a private workspace requires an opaque session token (`x-workspace-session`) bound exclusively to that `workspaceId`. Cross-workspace queries and unauthenticated reads return HTTP `401`/`403`.
- **Brute-Force Rate Limiting:** Failed unlock attempts increment per-workspace counters and enforce exponential backoff lockouts starting at 3 failures (`5s`, `10s`, `20s`, `40s`, `80s`, `160s`).
- **SSRF & XML Hardening:** User-supplied feed and OPML URLs are validated syntactically and via DNS resolution (`assertSafePublicUrl`) to reject `localhost`, RFC1918 private subnets, link-local metadata (`169.254.169.254`), and internal hostnames before fetching and after HTTP redirects. XML parsing rejects `<!DOCTYPE` and `<!ENTITY` declarations to block XXE and entity-expansion attacks.

## 3. Honest Platform & Recovery Limitations
- **Forgotten Passphrase Recovery:** Because workspace DEKs are cryptographically wrapped with the user's passphrase-derived KEK, Newsie cannot recover or reset a forgotten passphrase without destroying access to the locked ciphertext. Users are warned explicitly during workspace creation.
- **Biometrics & OS Control:** Where supported by the browser/OS (WebAuthn Platform Authenticators) or Android (`BiometricPrompt`), biometric enrollment and templates remain strictly under operating-system control; Newsie never collects or stores biometric templates.
- **Flash Storage Deletion:** Deleting a workspace erases all database rows, encrypted blobs, and wrapped keys in SQLite and zeroizes active memory buffers. However, on flash-backed SSD/eMMC storage with wear-leveling, remnants of previously unlinked pages may persist physically until overwritten by the storage controller.
