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

const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 16384, // 16 MiB — responsive in WASM while memory-hard
  hashLength: 64, // 32 bytes auth verifier + 32 bytes KEK
  outputType: 'binary' as const,
};

async function deriveKeyPair(
  passphrase: string,
  salt: Uint8Array,
): Promise<{ authHash: Buffer; kek: Buffer }> {
  const normalized = Buffer.from(passphrase.normalize('NFC'), 'utf8');
  const raw = await argon2id({
    password: normalized,
    salt,
    ...ARGON2_PARAMS,
  });
  const buf = Buffer.from(raw);
  return {
    authHash: buf.subarray(0, 32),
    kek: buf.subarray(32, 64),
  };
}

export function encryptAesGcm(key: Buffer, plaintext: Buffer): EncryptedBlob {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ivBase64: iv.toString('base64'),
    authTagBase64: authTag.toString('base64'),
    ciphertextBase64: encrypted.toString('base64'),
  };
}

export function decryptAesGcm(key: Buffer, blob: EncryptedBlob): Buffer {
  const iv = Buffer.from(blob.ivBase64, 'base64');
  const authTag = Buffer.from(blob.authTagBase64, 'base64');
  const ciphertext = Buffer.from(blob.ciphertextBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export async function provisionWorkspaceCredentials(passphrase: string): Promise<{
  dek: Buffer;
  credentials: WrappedWorkspaceKey;
}> {
  if (passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters long.');
  }
  const salt = crypto.randomBytes(16);
  const dek = crypto.randomBytes(32);
  const { authHash, kek } = await deriveKeyPair(passphrase, salt);

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

export function computeLockoutBackoffMs(failedAttempts: number): number {
  if (failedAttempts < 3) return 0;
  const exponent = Math.min(failedAttempts - 3, 5);
  return 5000 * Math.pow(2, exponent); // 5s, 10s, 20s, 40s, 80s, 160s
}
