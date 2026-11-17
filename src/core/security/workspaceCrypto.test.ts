import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, DEFAULT_WORKSPACE_ID } from '../database/newsieDb';
import { NewsieRepository } from '../database/repositories';
import {
  computeLockoutBackoffMs,
  decryptAesGcm,
  encryptAesGcm,
  provisionWorkspaceCredentials,
  verifyAndUnwrapWorkspaceKey,
} from './workspaceCrypto';
import {
  WorkspaceAuthError,
  WorkspaceManager,
} from '../../workspace/manager/workspaceManager';

test('Argon2id + AES-256-GCM supports Unicode, spaces, symbols, and emoji passphrases', async () => {
  const passphrase = 'Cold coffee & café ☕ 🔐 2026!';
  const { dek, credentials } = await provisionWorkspaceCredentials(passphrase);
  assert.equal(dek.length, 32);

  const unwrapped = await verifyAndUnwrapWorkspaceKey(passphrase, credentials);
  assert.ok(unwrapped);
  assert.equal(Buffer.compare(dek, unwrapped), 0);

  const wrong = await verifyAndUnwrapWorkspaceKey('wrong passphrase', credentials);
  assert.equal(wrong, null);

  const encrypted = encryptAesGcm(dek, Buffer.from('secret editorial dispatch'));
  const decrypted = decryptAesGcm(unwrapped, encrypted);
  assert.equal(decrypted.toString('utf8'), 'secret editorial dispatch');

  // Tampered auth tag must fail AES-GCM verification
  assert.throws(() =>
    decryptAesGcm(unwrapped, {
      ...encrypted,
      ciphertextBase64: Buffer.from('tampered').toString('base64'),
    }),
  );
});

test('WorkspaceManager enforces strict isolation, encrypted lock, rate limiting, and deletion', async () => {
  const db = createDatabase(':memory:');
  const repo = new NewsieRepository(db);
  repo.ensureWorkspaceInitialized(DEFAULT_WORKSPACE_ID);
  const manager = new WorkspaceManager(db, repo);

  const { workspace, sessionToken } = await manager.createPrivateWorkspace({
    displayName: 'Investigative Desk',
    passphrase: 'Correct Horse Battery Staple 🗞️',
  });

  // Isolation: another workspace's token or missing token must fail
  assert.throws(
    () => manager.assertAuthorizedAccess(workspace.id, undefined),
    (err: unknown) => err instanceof WorkspaceAuthError && err.statusCode === 401,
  );
  assert.throws(
    () => manager.assertAuthorizedAccess(workspace.id, 'forged-token'),
    (err: unknown) => err instanceof WorkspaceAuthError && err.statusCode === 403,
  );
  manager.assertAuthorizedAccess(workspace.id, sessionToken);

  // Add private record inside private workspace
  repo.addSource(workspace.id, {
    id: 'src-priv-1',
    name: 'Private Archive',
    url: 'https://private.example.org/rss.xml',
    format: 'RSS',
    categoryId: 'world',
    enabled: true,
    description: 'Confidential source',
  });

  // Lock workspace -> plaintext tables purged & encrypted blob stored
  manager.lockWorkspace(workspace.id);
  assert.equal(repo.listSources(workspace.id).length, 0);
  const blobCount = db
    .prepare('SELECT COUNT(*) as c FROM encrypted_workspace_blobs WHERE workspace_id = ?')
    .get(workspace.id) as { c: number };
  assert.equal(blobCount.c, 1);

  // Failed attempts trigger progressive rate limiting
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => manager.unlockWorkspace(workspace.id, 'bad-pass'));
  }
  await assert.rejects(
    () => manager.unlockWorkspace(workspace.id, 'Correct Horse Battery Staple 🗞️'),
    (err: unknown) => err instanceof WorkspaceAuthError && err.statusCode === 429,
  );

  // Reset lockout timestamp to verify real unlock restores encrypted sources
  db.prepare('UPDATE workspaces SET locked_until_ms = 0 WHERE id = ?').run(workspace.id);
  const unlocked = await manager.unlockWorkspace(
    workspace.id,
    'Correct Horse Battery Staple 🗞️',
  );
  assert.ok(unlocked.sessionToken);
  assert.equal(repo.listSources(workspace.id).length, 1);
  assert.equal(repo.listSources(workspace.id)[0].name, 'Private Archive');

  // Default workspace remains completely untouched
  assert.ok(repo.listSources(DEFAULT_WORKSPACE_ID).length >= 8);

  // Delete workspace removes encrypted data and key material
  manager.deleteWorkspace(workspace.id);
  assert.equal(
    manager.listWorkspaces().some((w) => w.id === workspace.id),
    false,
  );
  assert.equal(computeLockoutBackoffMs(2), 0);
  assert.equal(computeLockoutBackoffMs(3), 5000);

  db.close();
});
