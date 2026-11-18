import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  base64UrlEncode,
  verifyAttestationRegistration,
  verifyWebAuthnAssertion,
} from './webauthn';

// Helper to encode tiny canonical CBOR map for COSE EC2 P-256 test keys
function encodeCoseP256Cbor(x: Buffer, y: Buffer): Buffer {
  const cborBytes = (b: Buffer) =>
    Buffer.concat([Buffer.from([0x58, b.length]), b]);
  // Map of 5 entries:
  // 1 (kty): 2 (EC2)
  // 3 (alg): -7 (encoded 0x26)
  // -1 (crv, 0x20): 1 (P-256)
  // -2 (x, 0x21): bytes(32)
  // -3 (y, 0x22): bytes(32)
  return Buffer.concat([
    Buffer.from([0xa5]),
    Buffer.from([0x01, 0x02]),
    Buffer.from([0x03, 0x26]),
    Buffer.from([0x20, 0x01]),
    Buffer.from([0x21]),
    cborBytes(x),
    Buffer.from([0x22]),
    cborBytes(y),
  ]);
}

function encodeAttestationCbor(authData: Buffer): Buffer {
  const key = Buffer.from('authData', 'utf8');
  // Map { "authData": <authData> }
  const lenBytes =
    authData.length < 256
      ? Buffer.from([0x58, authData.length])
      : Buffer.from([0x59, authData.length >> 8, authData.length & 0xff]);
  return Buffer.concat([
    Buffer.from([0xa1]),
    Buffer.from([0x60 + key.length]),
    key,
    lenBytes,
    authData,
  ]);
}

test('WebAuthn verifies real ECDSA P-256 attestation registration and assertion signatures', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');

  const rpId = 'localhost';
  const expectedOrigin = 'http://localhost:3000';
  const challenge = base64UrlEncode(crypto.randomBytes(32));
  const rpIdHash = crypto.createHash('sha256').update(rpId).digest();

  const credId = crypto.randomBytes(16);
  const credLen = Buffer.alloc(2);
  credLen.writeUInt16BE(credId.length, 0);
  const aaguid = Buffer.alloc(16, 0);
  const coseKey = encodeCoseP256Cbor(x, y);

  // Flags: UP(0x01) | UV(0x04) | AT(0x40) = 0x45
  const signCountZero = Buffer.alloc(4, 0);
  const regAuthData = Buffer.concat([
    rpIdHash,
    Buffer.from([0x45]),
    signCountZero,
    aaguid,
    credLen,
    credId,
    coseKey,
  ]);
  const attObj = encodeAttestationCbor(regAuthData);
  const regClientData = Buffer.from(
    JSON.stringify({
      type: 'webauthn.create',
      challenge,
      origin: expectedOrigin,
    }),
  );

  const registered = verifyAttestationRegistration({
    attestationObjectB64Url: base64UrlEncode(attObj),
    clientDataJsonB64Url: base64UrlEncode(regClientData),
    expectedChallenge: challenge,
    expectedOrigin,
    rpId,
    requireUserVerification: true,
  });

  assert.equal(registered.credentialIdB64Url, base64UrlEncode(credId));
  assert.equal(registered.algorithm, -7);

  // Assertion ceremony
  const authChallenge = base64UrlEncode(crypto.randomBytes(32));
  const authClientData = Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: authChallenge,
      origin: expectedOrigin,
    }),
  );
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32BE(1, 0);
  // Flags: UP(0x01) | UV(0x04) = 0x05
  const assertAuthData = Buffer.concat([rpIdHash, Buffer.from([0x05]), countBuf]);
  const clientDataHash = crypto.createHash('sha256').update(authClientData).digest();
  const signature = crypto.sign(
    'sha256',
    Buffer.concat([assertAuthData, clientDataHash]),
    privateKey,
  );

  const verified = verifyWebAuthnAssertion({
    credential: {
      credentialId: registered.credentialIdB64Url,
      workspaceId: 'ws-test',
      publicKeySpkiB64: registered.publicKeySpkiB64,
      algorithm: registered.algorithm,
      signCount: 0,
      label: 'Test Authenticator',
    },
    authenticatorDataB64Url: base64UrlEncode(assertAuthData),
    clientDataJsonB64Url: base64UrlEncode(authClientData),
    signatureB64Url: base64UrlEncode(signature),
    expectedChallenge: authChallenge,
    expectedOrigin,
    rpId,
    requireUserVerification: true,
  });
  assert.equal(verified.nextSignCount, 1);

  // Origin mismatch fails
  assert.throws(() =>
    verifyWebAuthnAssertion({
      credential: {
        credentialId: registered.credentialIdB64Url,
        workspaceId: 'ws-test',
        publicKeySpkiB64: registered.publicKeySpkiB64,
        algorithm: registered.algorithm,
        signCount: 0,
        label: 'Test Authenticator',
      },
      authenticatorDataB64Url: base64UrlEncode(assertAuthData),
      clientDataJsonB64Url: base64UrlEncode(authClientData),
      signatureB64Url: base64UrlEncode(signature),
      expectedChallenge: authChallenge,
      expectedOrigin: 'https://evil.example',
      rpId,
      requireUserVerification: true,
    }),
  );
});
