import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, DEFAULT_WORKSPACE_ID } from '../database/newsieDb';
import { NewsieRepository } from '../database/repositories';
import {
  computeLockoutBackoffMs,
  decryptAesGcm,
  encryptAesGcm,
  provisionWorkspaceCredentials,
  validatePassphrasePolicy,
  verifyAndUnwrapWorkspaceKey,
} from './workspaceCrypto';
import {
  GENERIC_AUTH_FAILURE_MESSAGE,
  WorkspaceAuthError,
  WorkspaceManager,
} from '../../workspace/manager/workspaceManager';

function buildSpkiAndCoseP256(): {
  privateKey: crypto.KeyObject;
  coseKeyBytes: Buffer;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');

  // Minimal deterministic CBOR map: { 1: 2, 3: -7, -1: 1, -2: x, -3: y }
  const coseKeyBytes = Buffer.concat([
    Buffer.from([0xa5]),
    Buffer.from([0x01, 0x02]), // kty: EC2
    Buffer.from([0x03, 0x26]), // alg: -7 (ES256)
    Buffer.from([0x20, 0x01]), // crv: P-256
    Buffer.from([0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y,
  ]);
  return { privateKey, coseKeyBytes };
}

function buildAttestedCredentialAuthData(
  rpId: string,
  credentialIdRaw: Buffer,
  coseKeyBytes: Buffer,
  flags = 0x45, // UP | UV | AT
  signCount = 1,
): Buffer {
  const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
  const flagsBuf = Buffer.from([flags]);
  const counterBuf = Buffer.alloc(4);
  counterBuf.writeUInt32BE(signCount, 0);
  const aaguid = Buffer.alloc(16, 0);
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(credentialIdRaw.length, 0);
  return Buffer.concat([
    rpIdHash,
    flagsBuf,
    counterBuf,
    aaguid,
    lenBuf,
    credentialIdRaw,
    coseKeyBytes,
  ]);
}

test('Passphrase policy, Unicode NFC equivalence, and AES-256-GCM AAD integrity', async () => {
  assert.throws(() => validatePassphrasePolicy('short7!'));
  assert.throws(() => validatePassphrasePolicy('a'.repeat(1025)));

  const composed = 'Café Espressö ☕ 🔐 2026!';
  const decomposed = 'Cafe\u0301 Espresso\u0308 ☕ 🔐 2026!';
  const { dek, credentials } = await provisionWorkspaceCredentials(composed);
  assert.equal(dek.length, 32);

  const unwrapped = await verifyAndUnwrapWorkspaceKey(decomposed, credentials);
  assert.ok(unwrapped);
  assert.equal(Buffer.compare(dek, unwrapped), 0);

  const wrong = await verifyAndUnwrapWorkspaceKey('wrong passphrase 123', credentials);
  assert.equal(wrong, null);

  const encrypted = encryptAesGcm(
    dek,
    Buffer.from('secret editorial dispatch'),
    'ws-a:article:1',
  );
  const decrypted = decryptAesGcm(unwrapped, encrypted, 'ws-a:article:1');
  assert.equal(decrypted.toString('utf8'), 'secret editorial dispatch');

  // Wrong AAD or tampered ciphertext fails GCM tag check
  assert.throws(() => decryptAesGcm(unwrapped, encrypted, 'ws-b:article:1'));
  assert.throws(() =>
    decryptAesGcm(
      unwrapped,
      {
        ...encrypted,
        ciphertextBase64: Buffer.from('tampered').toString('base64'),
      },
      'ws-a:article:1',
    ),
  );

  dek.fill(0);
  unwrapped.fill(0);
});

test('Continuous encryption at rest leaves zero plaintext private records on disk and survives simulated crash', async () => {
  const db = createDatabase(':memory:');
  const repo = new NewsieRepository(db);
  repo.ensureWorkspaceInitialized(DEFAULT_WORKSPACE_ID);
  const sealKey = crypto.randomBytes(32);

  const manager1 = new WorkspaceManager(db, repo, {
    sweepIntervalMs: 0,
    sealKey,
  });

  const { workspace, sessionToken } = await manager1.createPrivateWorkspace({
    displayName: 'Investigative Desk',
    passphrase: 'Correct Horse Battery Staple 🗞️',
    issueDashboardToken: true,
  });

  // Duplicate workspace name rejected with 409
  await assert.rejects(
    () =>
      manager1.createPrivateWorkspace({
        displayName: 'investigative desk',
        passphrase: 'Another Valid Passphrase 123!',
      }),
    (err: unknown) => err instanceof WorkspaceAuthError && err.statusCode === 409,
  );

  // Public listing must NOT disclose private workspace names
  assert.equal(
    manager1.listPublicWorkspaces().some((w) => w.id === workspace.id),
    false,
  );

  const wsRepo = manager1.getAuthorizedRepository(workspace.id, sessionToken);
  wsRepo.addSource(workspace.id, {
    id: 'src-priv-1',
    name: 'Confidential Wire',
    url: 'https://private.example.org/rss.xml',
    format: 'RSS',
    categoryId: 'world',
    enabled: true,
    description: 'Confidential source',
  });
  wsRepo.upsertArticle(workspace.id, {
    id: 'art-priv-1',
    sourceId: 'src-priv-1',
    publisher: 'Confidential Wire',
    categoryId: 'world',
    categoryName: 'World',
    title: 'Sealed Source Brief',
    description: 'Encrypted on every write.',
    excerpt: 'Excerpt',
    url: 'https://private.example.org/story-1',
    normalizedUrl: 'https://private.example.org/story-1',
    fingerprint: 'fp-priv-1',
    imageAlt: '',
    publishedAtIso: new Date().toISOString(),
    readTimeMinutes: 4,
    keywords: ['brief'],
  });
  wsRepo.setBookmark(workspace.id, 'art-priv-1', true);
  wsRepo.addSearchHistory(workspace.id, 'classified query');
  manager1.syncEncryptedPrivateWorkspace(workspace.id);

  // CRITICAL CHECK: While STILL UNLOCKED, persistent DB has ZERO plaintext rows for private workspace
  for (const tbl of [
    'categories',
    'sources',
    'articles',
    'reading_history',
    'search_history',
    'preferences',
  ]) {
    const cnt = db
      .prepare(`SELECT COUNT(*) as c FROM ${tbl} WHERE workspace_id = ?`)
      .get(workspace.id) as { c: number };
    assert.equal(cnt.c, 0, `Expected 0 plaintext rows in ${tbl}`);
  }

  const encCount = db
    .prepare('SELECT COUNT(*) as c FROM encrypted_workspace_records WHERE workspace_id = ?')
    .get(workspace.id) as { c: number };
  assert.ok(encCount.c >= 18);

  // Simulate unexpected crash: spin up fresh WorkspaceManager without graceful lockWorkspace()
  const managerAfterCrash = new WorkspaceManager(db, repo, {
    sweepIntervalMs: 0,
    sealKey,
  });

  // Old session token is gone after process restart
  assert.throws(
    () => managerAfterCrash.getAuthorizedRepository(workspace.id, sessionToken),
    (err: unknown) => err instanceof WorkspaceAuthError && err.statusCode === 403,
  );

  // Re-unlocking restores every private record cleanly from continuous encrypted records
  const unlocked = await managerAfterCrash.unlockWorkspace(
    workspace.id,
    'Correct Horse Battery Staple 🗞️',
  );
  const wsRepo2 = managerAfterCrash.getAuthorizedRepository(
    workspace.id,
    unlocked.sessionToken,
  );
  assert.equal(wsRepo2.listSources(workspace.id)[0].name, 'Confidential Wire');
  assert.equal(wsRepo2.listBookmarkedArticles(workspace.id).length, 1);
  assert.deepEqual(wsRepo2.listSearchHistory(workspace.id), ['classified query']);

  // Tampering any encrypted record triggers GCM integrity error on unlock
  const rowToCorrupt = db
    .prepare(
      `SELECT record_type, record_id FROM encrypted_workspace_records
       WHERE workspace_id = ? AND record_type = 'article' LIMIT 1`,
    )
    .get(workspace.id) as { record_type: string; record_id: string };
  db.prepare(
    `UPDATE encrypted_workspace_records SET ciphertext = 'AAAA'
     WHERE workspace_id = ? AND record_type = ? AND record_id = ?`,
  ).run(workspace.id, rowToCorrupt.record_type, rowToCorrupt.record_id);

  await assert.rejects(() =>
    managerAfterCrash.unlockWorkspace(workspace.id, 'Correct Horse Battery Staple 🗞️'),
  );

  manager1.dispose();
  managerAfterCrash.dispose();
  db.close();
});

test('Method A search phrase, cross-workspace isolation, expiration TTL, lockout, and deletion re-auth', async () => {
  const db = createDatabase(':memory:');
  const repo = new NewsieRepository(db);
  repo.ensureWorkspaceInitialized(DEFAULT_WORKSPACE_ID);
  const manager = new WorkspaceManager(db, repo, {
    sessionTtlMs: 2000,
    dashboardTtlMs: 2000,
    sweepIntervalMs: 0,
    sealKey: crypto.randomBytes(32),
  });

  const wsA = await manager.createPrivateWorkspace({
    displayName: 'Workspace Alpha',
    passphrase: 'Alpha Secret Passphrase 1!',
    autoLockMinutes: 1,
    issueDashboardToken: true,
  });
  const wsB = await manager.createPrivateWorkspace({
    displayName: 'Workspace Beta',
    passphrase: 'Beta Secret Passphrase 2!',
  });

  assert.ok(wsA.dashboardToken);

  // Configure Method A Search Passphrase (stored hashed via Argon2id, normalized NFC)
  await manager.updatePrivateAccessConfig(wsA.dashboardToken, {
    searchPassphrase: 'Cafe\u0301-Vault-99!🔑',
    doubleTapIntervalMs: 420,
  });

  const gateStatus = manager.getPrivateAccessStatus();
  assert.equal(gateStatus.hasSearchPassphrase, true);
  assert.equal(gateStatus.doubleTapIntervalMs, 420);

  const gateRow = db
    .prepare('SELECT phrase_hash, phrase_salt FROM private_access_gate WHERE id = 1')
    .get() as { phrase_hash: string; phrase_salt: string };
  assert.notEqual(gateRow.phrase_hash, 'Café-Vault-99!🔑');
  assert.ok(gateRow.phrase_salt.length >= 32);

  assert.equal(
    (await manager.checkSearchPassphrase('Café-Vault-99!🔑')).matched,
    true,
  );
  assert.equal(
    (await manager.checkSearchPassphrase('normal news search')).matched,
    false,
  );

  // Reject too-short search passphrase
  await assert.rejects(() =>
    manager.updatePrivateAccessConfig(wsA.dashboardToken, {
      searchPassphrase: 'short',
    }),
  );

  // Cross-workspace token rejection (Workspace A token cannot touch B)
  assert.throws(
    () => manager.getAuthorizedRepository(wsB.workspace.id, wsA.sessionToken),
    (err: unknown) => err instanceof WorkspaceAuthError && err.statusCode === 403,
  );

  // Session TTL expiration & automatic lock via sweeper
  const futureMs = Date.now() + 3000;
  manager.sweepExpired(futureMs);
  assert.throws(
    () => manager.getAuthorizedRepository(wsA.workspace.id, wsA.sessionToken),
    (err: unknown) =>
      err instanceof WorkspaceAuthError &&
      (err.statusCode === 401 || err.statusCode === 403),
  );
  assert.throws(
    () => manager.getAuthorizedRepository(wsA.workspace.id, undefined),
    (err: unknown) => err instanceof WorkspaceAuthError && err.statusCode === 401,
  );

  // Generic error messages + brute-force lockout
  assert.equal(computeLockoutBackoffMs(2), 0);
  assert.equal(computeLockoutBackoffMs(3), 5000);
  for (let i = 0; i < 3; i++) {
    await assert.rejects(
      () => manager.unlockWorkspace(wsB.workspace.id, 'wrong-passphrase'),
      (err: unknown) =>
        err instanceof WorkspaceAuthError &&
        (i < 2 ? err.message === GENERIC_AUTH_FAILURE_MESSAGE : err.statusCode === 429),
    );
  }

  // Fresh re-authentication mandatory for destructive deletion & default cannot be deleted
  await assert.rejects(() =>
    manager.deleteWorkspace(DEFAULT_WORKSPACE_ID, { passphrase: 'anything' }),
  );

  // Clear lockout on A, unlock to obtain dashboardToken, then verify deletion requires fresh re-auth
  const authGate = await manager.authenticatePrivateEntryWithPassphrase(
    'Alpha Secret Passphrase 1!',
    'test-client',
  );
  await assert.rejects(
    () =>
      manager.deleteWorkspace(
        wsA.workspace.id,
        { passphrase: 'wrong-delete-pass' },
        authGate.dashboardToken,
      ),
    (err: unknown) => err instanceof WorkspaceAuthError && err.statusCode === 401,
  );

  await manager.deleteWorkspace(
    wsA.workspace.id,
    { passphrase: 'Alpha Secret Passphrase 1!' },
    authGate.dashboardToken,
  );
  assert.equal(
    manager
      .listAllWorkspacesAuthorized(authGate.dashboardToken)
      .some((w) => w.id === wsA.workspace.id),
    false,
  );

  manager.dispose();
  db.close();
});

test('WebAuthn ECDSA P-256 registration, biometric unlock, single-use replay rejection, and "both" MFA enforcement', async () => {
  const db = createDatabase(':memory:');
  const repo = new NewsieRepository(db);
  repo.ensureWorkspaceInitialized(DEFAULT_WORKSPACE_ID);
  const manager = new WorkspaceManager(db, repo, {
    sweepIntervalMs: 0,
    sealKey: crypto.randomBytes(32),
  });

  const created = await manager.createPrivateWorkspace({
    displayName: 'Biometric Vault',
    passphrase: 'Backup Passphrase 2026!',
    issueDashboardToken: true,
  });

  const rpId = 'localhost';
  const expectedOrigins = ['http://localhost:3000'];
  const { privateKey, coseKeyBytes } = buildSpkiAndCoseP256();
  const credId = Buffer.from('webauthn-cred-id-001');
  const credIdB64Url = credId.toString('base64url');

  // Step 1: Register WebAuthn credential
  const regOpts = manager.createWebAuthnRegistrationOptions({
    workspaceId: created.workspace.id,
    rpId,
    dashboardToken: created.dashboardToken,
    sessionToken: created.sessionToken,
  });

  const regClientData = Buffer.from(
    JSON.stringify({
      type: 'webauthn.create',
      challenge: regOpts.challenge,
      origin: expectedOrigins[0],
    }),
    'utf8',
  );
  const regAuthData = buildAttestedCredentialAuthData(rpId, credId, coseKeyBytes, 0x45, 1);
  const authDataKey = Buffer.from('authData', 'utf8');
  const regAttObj = Buffer.concat([
    Buffer.from([0xa1, 0x60 + authDataKey.length]),
    authDataKey,
    Buffer.from([0x58, regAuthData.length]),
    regAuthData,
  ]);

  manager.registerWebAuthnCredential({
    workspaceId: created.workspace.id,
    challengeId: regOpts.challengeId,
    expectedOrigins,
    label: 'Mac Touch ID',
    sessionToken: created.sessionToken,
    registration: {
      id: credIdB64Url,
      rawId: credIdB64Url,
      type: 'public-key',
      clientDataJSON: regClientData.toString('base64url'),
      attestationObject: regAttObj.toString('base64url'),
    },
  });

  // Switch auth policy to 'biometric' requiring fresh passphrase re-auth
  await manager.updateWorkspaceSettings(
    created.workspace.id,
    { authMethod: 'biometric' },
    { passphrase: 'Backup Passphrase 2026!' },
    created.dashboardToken,
    created.sessionToken,
  );
  manager.lockWorkspace(created.workspace.id);

  // Step 2: Unlock via real signed WebAuthn assertion
  const authOpts = manager.createWebAuthnAuthOptions({
    purpose: 'auth',
    rpId,
    workspaceId: created.workspace.id,
  });
  const authClientData = Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: authOpts.challenge,
      origin: expectedOrigins[0],
    }),
    'utf8',
  );
  const authData = Buffer.concat([
    crypto.createHash('sha256').update(rpId).digest(),
    Buffer.from([0x05]), // UP | UV
    Buffer.from([0, 0, 0, 2]), // signCount = 2
  ]);
  const clientHash = crypto.createHash('sha256').update(authClientData).digest();
  const signature = crypto.sign('sha256', Buffer.concat([authData, clientHash]), privateKey);

  const unlocked = manager.unlockWorkspaceWithWebAuthn({
    workspaceId: created.workspace.id,
    challengeId: authOpts.challengeId,
    expectedOrigins,
    assertion: {
      id: credIdB64Url,
      rawId: credIdB64Url,
      type: 'public-key',
      clientDataJSON: authClientData.toString('base64url'),
      authenticatorData: authData.toString('base64url'),
      signature: signature.toString('base64url'),
    },
  });
  assert.ok(unlocked.sessionToken);

  // Single-use replay of the same challenge MUST fail
  assert.throws(
    () =>
      manager.unlockWorkspaceWithWebAuthn({
        workspaceId: created.workspace.id,
        challengeId: authOpts.challengeId,
        expectedOrigins,
        assertion: {
          id: credIdB64Url,
          rawId: credIdB64Url,
          type: 'public-key',
          clientDataJSON: authClientData.toString('base64url'),
          authenticatorData: authData.toString('base64url'),
          signature: signature.toString('base64url'),
        },
      }),
    (err: unknown) => err instanceof WorkspaceAuthError && err.statusCode === 401,
  );

  // Switch authMethod to 'both' -> passphrase alone MUST fail!
  await manager.updateWorkspaceSettings(
    created.workspace.id,
    { authMethod: 'both' },
    { passphrase: 'Backup Passphrase 2026!' },
    created.dashboardToken,
    unlocked.sessionToken,
  );
  manager.lockWorkspace(created.workspace.id);

  await assert.rejects(
    () => manager.unlockWorkspace(created.workspace.id, 'Backup Passphrase 2026!'),
    (err: unknown) => err instanceof WorkspaceAuthError && err.statusCode === 401,
  );

  manager.dispose();
  db.close();
});
