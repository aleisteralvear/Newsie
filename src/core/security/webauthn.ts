import crypto from 'node:crypto';

export interface StoredWebAuthnCredential {
  credentialId: string;
  workspaceId: string;
  publicKeySpkiB64: string;
  algorithm: number;
  signCount: number;
  label: string;
}

export interface WebAuthnChallengeEntry {
  challenge: string;
  workspaceId: string;
  purpose: 'register' | 'authenticate';
  expiresAtMs: number;
  expectedOrigin: string;
  rpId: string;
}

export interface DecodedAuthData {
  rpIdHash: Buffer;
  flags: number;
  userPresent: boolean;
  userVerified: boolean;
  attestedCredentialDataIncluded: boolean;
  signCount: number;
  attestedCredential?: {
    credentialId: Buffer;
    publicKeySpkiB64: string;
    algorithm: number;
  };
}

export function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64url');
}

export function base64UrlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

// Minimal deterministic CBOR decoder covering unsigned ints, negative ints, byte strings,
// UTF-8 strings, arrays, and maps required for WebAuthn attestationObject & COSE keys.
export function decodeCbor(
  input: Buffer,
  offset = 0,
): { value: unknown; nextOffset: number } {
  if (offset >= input.length) {
    throw new Error('Unexpected end of CBOR input.');
  }
  const initial = input[offset];
  const major = initial >> 5;
  const additional = initial & 0x1f;
  let pos = offset + 1;

  const readLength = (): number => {
    if (additional < 24) return additional;
    if (additional === 24) {
      if (pos + 1 > input.length) throw new Error('Truncated CBOR uint8.');
      const val = input.readUInt8(pos);
      pos += 1;
      return val;
    }
    if (additional === 25) {
      if (pos + 2 > input.length) throw new Error('Truncated CBOR uint16.');
      const val = input.readUInt16BE(pos);
      pos += 2;
      return val;
    }
    if (additional === 26) {
      if (pos + 4 > input.length) throw new Error('Truncated CBOR uint32.');
      const val = input.readUInt32BE(pos);
      pos += 4;
      return val;
    }
    throw new Error(`Unsupported CBOR additional length encoding: ${additional}`);
  };

  if (major === 0) {
    return { value: readLength(), nextOffset: pos };
  }
  if (major === 1) {
    return { value: -1 - readLength(), nextOffset: pos };
  }
  if (major === 2) {
    const len = readLength();
    if (pos + len > input.length) throw new Error('Truncated CBOR byte string.');
    const slice = input.subarray(pos, pos + len);
    return { value: slice, nextOffset: pos + len };
  }
  if (major === 3) {
    const len = readLength();
    if (pos + len > input.length) throw new Error('Truncated CBOR text string.');
    const text = input.subarray(pos, pos + len).toString('utf8');
    return { value: text, nextOffset: pos + len };
  }
  if (major === 4) {
    const count = readLength();
    const arr: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const item = decodeCbor(input, pos);
      arr.push(item.value);
      pos = item.nextOffset;
    }
    return { value: arr, nextOffset: pos };
  }
  if (major === 5) {
    const count = readLength();
    const map = new Map<unknown, unknown>();
    for (let i = 0; i < count; i++) {
      const k = decodeCbor(input, pos);
      const v = decodeCbor(input, k.nextOffset);
      map.set(k.value, v.value);
      pos = v.nextOffset;
    }
    return { value: map, nextOffset: pos };
  }
  if (major === 7) {
    if (additional === 20) return { value: false, nextOffset: pos };
    if (additional === 21) return { value: true, nextOffset: pos };
    if (additional === 22) return { value: null, nextOffset: pos };
  }
  throw new Error(`Unsupported CBOR major type ${major}.`);
}

function encodeDerLength(len: number): Buffer {
  if (len < 128) return Buffer.from([len]);
  if (len < 256) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, len >> 8, len & 0xff]);
}

function derSequence(parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([0x30]), encodeDerLength(body.length), body]);
}

function derInteger(buf: Buffer): Buffer {
  let clean = buf;
  while (clean.length > 1 && clean[0] === 0 && (clean[1] & 0x80) === 0) {
    clean = clean.subarray(1);
  }
  if (clean[0] & 0x80) {
    clean = Buffer.concat([Buffer.from([0x00]), clean]);
  }
  return Buffer.concat([Buffer.from([0x02]), encodeDerLength(clean.length), clean]);
}

function derBitString(buf: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from([0x00]), buf]);
  return Buffer.concat([Buffer.from([0x03]), encodeDerLength(body.length), body]);
}

export function coseKeyToSpkiB64(coseBuffer: Buffer): {
  spkiB64: string;
  algorithm: number;
} {
  const decoded = decodeCbor(coseBuffer).value;
  if (!(decoded instanceof Map)) {
    throw new Error('COSE public key must be a CBOR map.');
  }
  const kty = decoded.get(1);
  const alg = Number(decoded.get(3));

  // EC2 (P-256, alg -7 ES256)
  if (kty === 2 && alg === -7) {
    const crv = decoded.get(-1);
    const x = decoded.get(-2);
    const y = decoded.get(-3);
    if (crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) {
      throw new Error('Invalid EC2 P-256 COSE key coordinates.');
    }
    const uncompressedPoint = Buffer.concat([Buffer.from([0x04]), x, y]);
    // OID 1.2.840.10045.2.1 (ecPublicKey) + 1.2.840.10045.3.1.7 (prime256v1)
    const algId = Buffer.from('301306072a8648ce3d020106082a8648ce3d030107', 'hex');
    const spki = derSequence([algId, derBitString(uncompressedPoint)]);
    return { spkiB64: spki.toString('base64'), algorithm: alg };
  }

  // RSA (RS256, alg -257)
  if (kty === 3 && alg === -257) {
    const n = decoded.get(-1);
    const e = decoded.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) {
      throw new Error('Invalid RSA COSE public key parameters.');
    }
    const rsaPub = derSequence([derInteger(n), derInteger(e)]);
    const algId = Buffer.from('300d06092a864886f70d0101010500', 'hex');
    const spki = derSequence([algId, derBitString(rsaPub)]);
    return { spkiB64: spki.toString('base64'), algorithm: alg };
  }

  throw new Error(`Unsupported WebAuthn COSE key type (${String(kty)}) or algorithm (${alg}).`);
}

export function parseAuthenticatorData(authData: Buffer): DecodedAuthData {
  if (authData.length < 37) {
    throw new Error('Authenticator data is too short.');
  }
  const rpIdHash = authData.subarray(0, 32);
  const flags = authData[32];
  const userPresent = Boolean(flags & 0x01);
  const userVerified = Boolean(flags & 0x04);
  const attestedCredentialDataIncluded = Boolean(flags & 0x40);
  const signCount = authData.readUInt32BE(33);

  let attestedCredential: DecodedAuthData['attestedCredential'];
  if (attestedCredentialDataIncluded) {
    if (authData.length < 55) {
      throw new Error('Truncated attested credential data.');
    }
    const credLen = authData.readUInt16BE(53);
    const credStart = 55;
    const credEnd = credStart + credLen;
    if (authData.length <= credEnd) {
      throw new Error('Truncated credential identifier or COSE public key.');
    }
    const credentialId = authData.subarray(credStart, credEnd);
    const coseSlice = authData.subarray(credEnd);
    const { spkiB64, algorithm } = coseKeyToSpkiB64(coseSlice);
    attestedCredential = {
      credentialId,
      publicKeySpkiB64: spkiB64,
      algorithm,
    };
  }

  return {
    rpIdHash,
    flags,
    userPresent,
    userVerified,
    attestedCredentialDataIncluded,
    signCount,
    attestedCredential,
  };
}

export interface WebAuthnRegistrationInput {
  id: string;
  rawId?: string;
  type: string;
  attestationObject: string;
  clientDataJSON: string;
}

export interface WebAuthnAssertionInput {
  id: string;
  rawId?: string;
  type: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

export function verifyClientDataJson(params: {
  clientDataJsonB64Url: string;
  expectedType: 'webauthn.create' | 'webauthn.get';
  expectedChallenge: string;
  expectedOrigin: string | string[];
}): Buffer {
  const rawBuf = base64UrlDecode(params.clientDataJsonB64Url);
  const parsed = JSON.parse(rawBuf.toString('utf8')) as {
    type?: string;
    challenge?: string;
    origin?: string;
  };
  if (parsed.type !== params.expectedType) {
    throw new Error('Invalid WebAuthn ceremony type.');
  }
  if (parsed.challenge !== params.expectedChallenge) {
    throw new Error('WebAuthn challenge mismatch or expired.');
  }
  const allowed = Array.isArray(params.expectedOrigin)
    ? params.expectedOrigin
    : [params.expectedOrigin];
  const originLower = (parsed.origin || '').toLowerCase();
  if (
    !parsed.origin ||
    !allowed.some((item) => item.toLowerCase() === originLower)
  ) {
    throw new Error('WebAuthn origin verification failed.');
  }
  return rawBuf;
}

export function verifyAttestationRegistration(params: {
  attestationObjectB64Url: string;
  clientDataJsonB64Url: string;
  expectedChallenge: string;
  expectedOrigin: string | string[];
  rpId: string;
  requireUserVerification?: boolean;
}): {
  credentialIdB64Url: string;
  publicKeySpkiB64: string;
  algorithm: number;
  signCount: number;
} {
  verifyClientDataJson({
    clientDataJsonB64Url: params.clientDataJsonB64Url,
    expectedType: 'webauthn.create',
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: params.expectedOrigin,
  });

  const attBytes = base64UrlDecode(params.attestationObjectB64Url);
  const decoded = decodeCbor(attBytes).value;
  if (!(decoded instanceof Map)) {
    throw new Error('Invalid WebAuthn attestation object.');
  }
  const authData = decoded.get('authData');
  if (!Buffer.isBuffer(authData)) {
    throw new Error('Missing authData inside WebAuthn attestation.');
  }

  const parsedAuth = parseAuthenticatorData(authData);
  const expectedRpHash = crypto.createHash('sha256').update(params.rpId, 'utf8').digest();
  if (!crypto.timingSafeEqual(parsedAuth.rpIdHash, expectedRpHash)) {
    throw new Error('WebAuthn Relying Party ID verification failed.');
  }
  if (!parsedAuth.userPresent) {
    throw new Error('WebAuthn user presence flag was not set.');
  }
  if (params.requireUserVerification && !parsedAuth.userVerified) {
    throw new Error('Biometric/platform user verification was not confirmed.');
  }
  if (!parsedAuth.attestedCredential) {
    throw new Error('WebAuthn attestation omitted public key credential data.');
  }

  return {
    credentialIdB64Url: base64UrlEncode(parsedAuth.attestedCredential.credentialId),
    publicKeySpkiB64: parsedAuth.attestedCredential.publicKeySpkiB64,
    algorithm: parsedAuth.attestedCredential.algorithm,
    signCount: parsedAuth.signCount,
  };
}

export function verifyWebAuthnAssertion(params: {
  credential: StoredWebAuthnCredential;
  authenticatorDataB64Url: string;
  clientDataJsonB64Url: string;
  signatureB64Url: string;
  expectedChallenge: string;
  expectedOrigin: string | string[];
  rpId: string;
  requireUserVerification?: boolean;
}): { nextSignCount: number } {
  const clientDataBuf = verifyClientDataJson({
    clientDataJsonB64Url: params.clientDataJsonB64Url,
    expectedType: 'webauthn.get',
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: params.expectedOrigin,
  });

  const authData = base64UrlDecode(params.authenticatorDataB64Url);
  const parsedAuth = parseAuthenticatorData(authData);
  const expectedRpHash = crypto.createHash('sha256').update(params.rpId, 'utf8').digest();
  if (!crypto.timingSafeEqual(parsedAuth.rpIdHash, expectedRpHash)) {
    throw new Error('WebAuthn Relying Party ID verification failed.');
  }
  if (!parsedAuth.userPresent) {
    throw new Error('WebAuthn user presence check failed.');
  }
  if (params.requireUserVerification && !parsedAuth.userVerified) {
    throw new Error('Platform biometric verification failed.');
  }
  if (
    parsedAuth.signCount > 0 &&
    params.credential.signCount > 0 &&
    parsedAuth.signCount <= params.credential.signCount
  ) {
    throw new Error('WebAuthn signature counter indicates potential cloned credential.');
  }

  const clientDataHash = crypto.createHash('sha256').update(clientDataBuf).digest();
  const signedPayload = Buffer.concat([authData, clientDataHash]);
  const signature = base64UrlDecode(params.signatureB64Url);
  const spkiDer = Buffer.from(params.credential.publicKeySpkiB64, 'base64');
  const keyObj = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });

  const verified = crypto.verify('sha256', signedPayload, keyObj, signature);
  if (!verified) {
    throw new Error('WebAuthn cryptographic signature verification failed.');
  }

  return {
    nextSignCount:
      parsedAuth.signCount > 0 ? parsedAuth.signCount : params.credential.signCount,
  };
}
