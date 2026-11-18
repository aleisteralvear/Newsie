import crypto from 'node:crypto';
import { argon2id } from 'hash-wasm';

export interface WrappedWorkspaceKey {
  saltHex: string;
  authHashHex: string;
  wrappedKeyBase64: string;
  keyIvBase64: string;
}

export interface EncryptedBlob {
  ivBase64: string;
  authTagBase64: string;
  ciphertextBase64: string;
}

export const MIN_PASSPHRASE_LENGTH = 8;
export const MAX_PASSPHRASE_LENGTH = 1024;

const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 16384, // 16 MiB memory-hard cost
  hashLength: 64, // 32 bytes auth verifier + 32 bytes KEK
  outputType: 'binary' as const,
};

export function normalizePassphrase(raw: string): string {
  return raw.normalize('NFC');
}

export function validatePassphrasePolicy(raw: string): string {
  const normalized = normalizePassphrase(raw);
  const codePointLength = Array.from(normalized).length;
  if (codePointLength < MIN_PASSPHRASE_LENGTH) {
    throw new Error(
      `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long.`,
    );
  }
  if (normalized.length > MAX_PASSPHRASE_LENGTH) {
    throw new Error(
      `Passphrase must not exceed ${MAX_PASSPHRASE_LENGTH} characters.`,
    );
  }
  return normalized;
}

async function deriveKeyPair(
  passphrase: string,
  salt: Uint8Array,
): Promise<{ authHash: Buffer; kek: Buffer }> {
  const normalized = Buffer.from(normalizePassphrase(passphrase), 'utf8');
  try {
    const raw = await argon2id({
      password: normalized,
      salt,
      ...ARGON2_PARAMS,
    });
    const buf = Buffer.from(raw);
    return {
      authHash: Buffer.from(buf.subarray(0, 32)),
      kek: Buffer.from(buf.subarray(32, 64)),
    };
  } finally {
    normalized.fill(0);
  }
}

export function encryptAesGcm(
  key: Buffer,
  plaintext: Buffer,
  aad?: string,
): EncryptedBlob {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) {
    cipher.setAAD(Buffer.from(aad, 'utf8'));
  }
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ivBase64: iv.toString('base64'),
    authTagBase64: authTag.toString('base64'),
    ciphertextBase64: encrypted.toString('base64'),
  };
}

export function decryptAesGcm(
  key: Buffer,
  blob: EncryptedBlob,
  aad?: string,
): Buffer {
  const iv = Buffer.from(blob.ivBase64, 'base64');
  const authTag = Buffer.from(blob.authTagBase64, 'base64');
  const ciphertext = Buffer.from(blob.ciphertextBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  if (aad) {
    decipher.setAAD(Buffer.from(aad, 'utf8'));
  }
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export async function provisionWorkspaceCredentials(
  passphrase: string,
  existingDek?: Buffer,
): Promise<{
  dek: Buffer;
  credentials: WrappedWorkspaceKey;
}> {
  const validated = validatePassphrasePolicy(passphrase);
  const salt = crypto.randomBytes(16);
  const dek = existingDek ? Buffer.from(existingDek) : crypto.randomBytes(32);
  const { authHash, kek } = await deriveKeyPair(validated, salt);

  try {
    const wrapped = encryptAesGcm(kek, dek);
    const wrappedCombined = Buffer.concat([
      Buffer.from(wrapped.authTagBase64, 'base64'),
      Buffer.from(wrapped.ciphertextBase64, 'base64'),
    ]).toString('base64');

    return {
      dek,
      credentials: {
        saltHex: salt.toString('hex'),
        authHashHex: authHash.toString('hex'),
        wrappedKeyBase64: wrappedCombined,
        keyIvBase64: wrapped.ivBase64,
      },
    };
  } finally {
    kek.fill(0);
    authHash.fill(0);
  }
}

export async function verifyAndUnwrapWorkspaceKey(
  passphrase: string,
  credentials: WrappedWorkspaceKey,
): Promise<Buffer | null> {
  if (!passphrase || passphrase.length > MAX_PASSPHRASE_LENGTH) {
    return null;
  }
  const salt = Buffer.from(credentials.saltHex, 'hex');
  const expectedAuth = Buffer.from(credentials.authHashHex, 'hex');
  const { authHash, kek } = await deriveKeyPair(passphrase, salt);

  try {
    if (
      authHash.length !== expectedAuth.length ||
      !crypto.timingSafeEqual(authHash, expectedAuth)
    ) {
      return null;
    }

    const combined = Buffer.from(credentials.wrappedKeyBase64, 'base64');
    const authTag = combined.subarray(0, 16);
    const ciphertext = combined.subarray(16);

    return decryptAesGcm(kek, {
      ivBase64: credentials.keyIvBase64,
      authTagBase64: authTag.toString('base64'),
      ciphertextBase64: ciphertext.toString('base64'),
    });
  } finally {
    kek.fill(0);
    authHash.fill(0);
  }
}

export async function hashPrivateAccessPhrase(phrase: string): Promise<{
  saltHex: string;
  hashHex: string;
}> {
  const validated = validatePassphrasePolicy(phrase);
  const salt = crypto.randomBytes(16);
  const { authHash, kek } = await deriveKeyPair(validated, salt);
  try {
    return {
      saltHex: salt.toString('hex'),
      hashHex: authHash.toString('hex'),
    };
  } finally {
    kek.fill(0);
    authHash.fill(0);
  }
}

export async function verifyPrivateAccessPhrase(
  candidate: string,
  saltHex: string,
  expectedHashHex: string,
): Promise<boolean> {
  if (!candidate || candidate.length > MAX_PASSPHRASE_LENGTH) {
    return false;
  }
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(expectedHashHex, 'hex');
  const { authHash, kek } = await deriveKeyPair(candidate, salt);
  try {
    return (
      authHash.length === expected.length &&
      crypto.timingSafeEqual(authHash, expected)
    );
  } finally {
    kek.fill(0);
    authHash.fill(0);
  }
}

export function computeLockoutBackoffMs(failedAttempts: number): number {
  if (failedAttempts < 3) return 0;
  const exponent = Math.min(failedAttempts - 3, 5);
  return 5000 * Math.pow(2, exponent); // 5s, 10s, 20s, 40s, 80s, 160s
}
