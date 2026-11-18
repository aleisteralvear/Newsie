import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  PrivateAccessStatus,
  WorkspaceAuthMethod,
  WorkspaceSummary,
} from '../../core/common/types';
import {
  applyNewsieSchema,
  DEFAULT_WORKSPACE_ID,
} from '../../core/database/newsieDb';
import { NewsieRepository } from '../../core/database/repositories';
import {
  computeLockoutBackoffMs,
  decryptAesGcm,
  encryptAesGcm,
  hashPrivateAccessPhrase,
  MAX_PASSPHRASE_LENGTH,
  normalizePassphrase,
  provisionWorkspaceCredentials,
  validatePassphrasePolicy,
  verifyAndUnwrapWorkspaceKey,
  verifyPrivateAccessPhrase,
} from '../../core/security/workspaceCrypto';
import {
  verifyAttestationRegistration,
  verifyWebAuthnAssertion,
  WebAuthnAssertionInput,
  WebAuthnRegistrationInput,
} from '../../core/security/webauthn';

export type { WorkspaceSummary };

const DEFAULT_SESSION_ABSOLUTE_TTL_MS = 45 * 60 * 1000; // 45 minutes hard cap
const DEFAULT_DASHBOARD_TTL_MS = 15 * 60 * 1000; // 15 minutes dashboard cap
const CHALLENGE_TTL_MS = 120 * 1000; // 2 minutes WebAuthn challenge TTL
const SWEEP_INTERVAL_MS = 15 * 1000;

export const GENERIC_AUTH_FAILURE_MESSAGE =
  'Authentication failed. Verify your credentials.';

interface WorkspaceSnapshotPayload {
  categories: unknown[];
  sources: unknown[];
  articles: unknown[];
  readingHistory: unknown[];
  searchHistory: unknown[];
  feedConfigs: unknown[];
  preferences: unknown[];
}

type RecordType =
  | 'category'
  | 'source'
  | 'article'
  | 'reading_history'
  | 'search_history'
  | 'feed_config'
  | 'preferences';

interface ActiveSession {
  workspaceId: string;
  dek: Buffer;
  memDb: DatabaseSync;
  memRepo: NewsieRepository;
  recordDigests: Map<string, string>;
  createdAtMs: number;
  expiresAtMs: number;
  lastActivityMs: number;
}

interface DashboardSession {
  createdAtMs: number;
  expiresAtMs: number;
  lastActivityMs: number;
  authenticatedWorkspaceId: string;
}

interface PendingChallenge {
  challengeB64Url: string;
  purpose: 'register' | 'auth' | 'dashboard' | 'reauth';
  workspaceId?: string;
  rpId: string;
  expiresAtMs: number;
}

export interface WebAuthnCredentialView {
  credentialId: string;
  workspaceId: string;
  label: string;
  createdAt: string;
}

export interface ReauthProof {
  passphrase?: string;
  webauthn?: {
    challengeId: string;
    assertion: WebAuthnAssertionInput;
    expectedOrigins: string[];
  };
}

export interface WorkspaceManagerOptions {
  sessionTtlMs?: number;
  dashboardTtlMs?: number;
  sweepIntervalMs?: number;
  sealKeyPath?: string;
  sealKey?: Buffer;
}

export class WorkspaceAuthError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'WorkspaceAuthError';
  }
}

export class WorkspaceManager {
  // Maps opaque session token -> isolated decrypted :memory: DB + DEK (strictly volatile RAM)
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly dashboardSessions = new Map<string, DashboardSession>();
  private readonly pendingChallenges = new Map<string, PendingChallenge>();
  private readonly gateFailures = new Map<
    string,
    { count: number; lockedUntilMs: number }
  >();
  private readonly sessionTtlMs: number;
  private readonly dashboardTtlMs: number;
  private readonly sealKey: Buffer;
  private readonly sweepTimer: NodeJS.Timeout | null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly repo: NewsieRepository,
    options: WorkspaceManagerOptions = {},
  ) {
    this.sessionTtlMs =
      options.sessionTtlMs ?? DEFAULT_SESSION_ABSOLUTE_TTL_MS;
    this.dashboardTtlMs = options.dashboardTtlMs ?? DEFAULT_DASHBOARD_TTL_MS;
    this.sealKey = options.sealKey
      ? Buffer.from(options.sealKey)
      : loadOrCreateVaultSealKey(options.sealKeyPath);

    const intervalMs = options.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
    if (intervalMs > 0) {
      this.sweepTimer = setInterval(() => this.sweepExpired(), intervalMs);
      this.sweepTimer.unref();
    } else {
      this.sweepTimer = null;
    }
  }

  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
    this.lockAllPrivateWorkspaces();
    this.dashboardSessions.clear();
    this.pendingChallenges.clear();
    this.sealKey.fill(0);
  }

  sweepExpired(now: number = Date.now()): void {
    // 1. Clean expired single-use WebAuthn challenges
    for (const [id, ch] of this.pendingChallenges.entries()) {
      if (ch.expiresAtMs <= now) {
        this.pendingChallenges.delete(id);
      }
    }

    // 2. Expire dashboard sessions
    for (const [token, ds] of this.dashboardSessions.entries()) {
      if (
        ds.expiresAtMs <= now ||
        now - ds.lastActivityMs > this.dashboardTtlMs
      ) {
        this.dashboardSessions.delete(token);
      }
    }

    // 3. Enforce absolute TTL & workspace inactivity auto-lock
    const toLock = new Set<string>();
    for (const session of this.sessions.values()) {
      if (session.expiresAtMs <= now) {
        toLock.add(session.workspaceId);
        continue;
      }
      const row = this.db
        .prepare('SELECT auto_lock_minutes FROM workspaces WHERE id = ?')
        .get(session.workspaceId) as { auto_lock_minutes: number } | undefined;
      const autoLockMs = Number(row?.auto_lock_minutes ?? 5) * 60 * 1000;
      if (autoLockMs > 0 && now - session.lastActivityMs >= autoLockMs) {
        toLock.add(session.workspaceId);
      }
    }
    for (const wsId of toLock) {
      this.lockWorkspace(wsId);
    }
  }

  private getSessionByWorkspace(workspaceId: string): ActiveSession | null {
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId) return session;
    }
    return null;
  }

  private isWorkspaceUnlockedInMemory(workspaceId: string): boolean {
    if (workspaceId === DEFAULT_WORKSPACE_ID) return true;
    return this.getSessionByWorkspace(workspaceId) !== null;
  }

  // Only returns public non-private workspace list unless dashboardToken is verified
  listPublicWorkspaces(): WorkspaceSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, display_name, is_private, auth_method, auto_lock_minutes, last_activity_at, created_at
         FROM workspaces WHERE is_private = 0 ORDER BY created_at ASC`,
      )
      .all() as Record<string, unknown>[];

    return rows.map((r) => this.mapWorkspaceSummary(r));
  }

  listAllWorkspacesAuthorized(dashboardToken?: string): WorkspaceSummary[] {
    this.assertDashboardSession(dashboardToken);
    return this.queryAllWorkspacesInternal();
  }

  listWorkspacesForActiveContext(
    dashboardToken?: string,
    activeWorkspaceId?: string,
    sessionToken?: string,
  ): WorkspaceSummary[] {
    if (dashboardToken && this.isDashboardTokenValid(dashboardToken)) {
      return this.queryAllWorkspacesInternal();
    }
    if (
      activeWorkspaceId &&
      activeWorkspaceId !== DEFAULT_WORKSPACE_ID &&
      sessionToken
    ) {
      try {
        this.assertAuthorizedAccess(activeWorkspaceId, sessionToken);
        const row = this.db
          .prepare(
            `SELECT id, display_name, is_private, auth_method, auto_lock_minutes, last_activity_at, created_at
             FROM workspaces WHERE id = ? OR is_private = 0 ORDER BY is_private ASC, created_at ASC`,
          )
          .all(activeWorkspaceId) as Record<string, unknown>[];
        return row.map((r) => this.mapWorkspaceSummary(r));
      } catch {
        // Fall through to public list
      }
    }
    return this.listPublicWorkspaces();
  }

  private queryAllWorkspacesInternal(): WorkspaceSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, display_name, is_private, auth_method, auto_lock_minutes, last_activity_at, created_at
         FROM workspaces ORDER BY is_private ASC, created_at ASC`,
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapWorkspaceSummary(r));
  }

  private mapWorkspaceSummary(r: Record<string, unknown>): WorkspaceSummary {
    const id = String(r.id);
    const isPrivate = Number(r.is_private) === 1;
    const credCountRow = isPrivate
      ? (this.db
          .prepare(
            'SELECT COUNT(*) as c FROM webauthn_credentials WHERE workspace_id = ?',
          )
          .get(id) as { c: number })
      : { c: 0 };

    return {
      id,
      displayName: String(r.display_name),
      isPrivate,
      isLocked: isPrivate && !this.isWorkspaceUnlockedInMemory(id),
      authMethod: String(r.auth_method) as WorkspaceSummary['authMethod'],
      autoLockMinutes: Number(r.auto_lock_minutes ?? 5),
      lastActivityAt: r.last_activity_at
        ? String(r.last_activity_at)
        : null,
      createdAt: String(r.created_at),
      hasBiometricCredential: credCountRow.c > 0,
    };
  }

  getPrivateAccessStatus(): PrivateAccessStatus {
    const gate = this.db
      .prepare(
        'SELECT phrase_hash, double_tap_interval_ms FROM private_access_gate WHERE id = 1',
      )
      .get() as
      | { phrase_hash: string | null; double_tap_interval_ms: number }
      | undefined;

    const privCount = (
      this.db
        .prepare('SELECT COUNT(*) as c FROM workspaces WHERE is_private = 1')
        .get() as { c: number }
    ).c;

    const bioCount = (
      this.db
        .prepare('SELECT COUNT(*) as c FROM webauthn_credentials')
        .get() as { c: number }
    ).c;

    return {
      hasSearchPassphrase: Boolean(gate?.phrase_hash),
      doubleTapIntervalMs: Number(gate?.double_tap_interval_ms ?? 350),
      hasPrivateWorkspaces: privCount > 0,
      hasAnyBiometricCredentials: bioCount > 0,
    };
  }

  isDashboardTokenValid(token?: string): boolean {
    if (!token) return false;
    const ds = this.dashboardSessions.get(token);
    if (!ds) return false;
    const now = Date.now();
    if (
      ds.expiresAtMs <= now ||
      now - ds.lastActivityMs > this.dashboardTtlMs
    ) {
      this.dashboardSessions.delete(token);
      return false;
    }
    return true;
  }

  assertDashboardSession(dashboardToken?: string): DashboardSession {
    if (!dashboardToken) {
      throw new WorkspaceAuthError(401, 'Private dashboard authentication required.');
    }
    const ds = this.dashboardSessions.get(dashboardToken);
    const now = Date.now();
    if (
      !ds ||
      ds.expiresAtMs <= now ||
      now - ds.lastActivityMs > this.dashboardTtlMs
    ) {
      if (dashboardToken) this.dashboardSessions.delete(dashboardToken);
      throw new WorkspaceAuthError(
        401,
        'Private dashboard session expired. Authenticate again.',
      );
    }
    ds.lastActivityMs = now;
    return ds;
  }

  revokeDashboardSession(dashboardToken?: string): void {
    if (dashboardToken) {
      this.dashboardSessions.delete(dashboardToken);
    }
  }

  // Method A & B configuration (requires authenticated Private Dashboard)
  async updatePrivateAccessConfig(
    dashboardToken: string | undefined,
    patch: {
      searchPassphrase?: string | null;
      doubleTapIntervalMs?: number;
    },
  ): Promise<PrivateAccessStatus> {
    this.assertDashboardSession(dashboardToken);
    const nowIso = new Date().toISOString();

    if (patch.searchPassphrase !== undefined) {
      if (patch.searchPassphrase === null || patch.searchPassphrase === '') {
        this.db
          .prepare(
            'UPDATE private_access_gate SET phrase_hash = NULL, phrase_salt = NULL, failed_attempts = 0, locked_until_ms = 0, updated_at = ? WHERE id = 1',
          )
          .run(nowIso);
      } else {
        const { saltHex, hashHex } = await hashPrivateAccessPhrase(
          patch.searchPassphrase,
        );
        this.db
          .prepare(
            'UPDATE private_access_gate SET phrase_hash = ?, phrase_salt = ?, failed_attempts = 0, locked_until_ms = 0, updated_at = ? WHERE id = 1',
          )
          .run(hashHex, saltHex, nowIso);
      }
    }

    if (typeof patch.doubleTapIntervalMs === 'number') {
      const clamped = Math.max(200, Math.min(800, Math.round(patch.doubleTapIntervalMs)));
      this.db
        .prepare(
          'UPDATE private_access_gate SET double_tap_interval_ms = ?, updated_at = ? WHERE id = 1',
        )
        .run(clamped, nowIso);
    }

    return this.getPrivateAccessStatus();
  }

  // Method A verification: constant-time Argon2id check BEFORE search API / history
  async checkSearchPassphrase(candidate: string): Promise<{ matched: boolean }> {
    if (
      typeof candidate !== 'string' ||
      candidate.length === 0 ||
      candidate.length > MAX_PASSPHRASE_LENGTH
    ) {
      return { matched: false };
    }

    const row = this.db
      .prepare(
        'SELECT phrase_hash, phrase_salt FROM private_access_gate WHERE id = 1',
      )
      .get() as
      | { phrase_hash: string | null; phrase_salt: string | null }
      | undefined;

    if (!row?.phrase_hash || !row?.phrase_salt) {
      return { matched: false };
    }

    const matched = await verifyPrivateAccessPhrase(
      candidate,
      row.phrase_salt,
      row.phrase_hash,
    );
    return { matched };
  }

  // Returns authorized NewsieRepository (:memory: for private workspaces, persistent db for default)
  getAuthorizedRepository(
    workspaceId: string,
    sessionToken?: string,
  ): NewsieRepository {
    if (workspaceId === DEFAULT_WORKSPACE_ID) {
      return this.repo;
    }
    const session = this.assertAuthorizedSession(workspaceId, sessionToken);
    return session.memRepo;
  }

  // Persists mutated records from isolated :memory: DB -> AES-256-GCM records in persistent DB
  syncEncryptedPrivateWorkspace(workspaceId: string): void {
    if (workspaceId === DEFAULT_WORKSPACE_ID) return;
    const session = this.getSessionByWorkspace(workspaceId);
    if (!session) return;
    this.flushSessionToEncryptedStore(session);
  }

  assertAuthorizedAccess(workspaceId: string, sessionToken?: string): void {
    if (workspaceId === DEFAULT_WORKSPACE_ID) return;
    this.assertAuthorizedSession(workspaceId, sessionToken);
  }

  private assertAuthorizedSession(
    workspaceId: string,
    sessionToken?: string,
  ): ActiveSession {
    const row = this.db
      .prepare('SELECT id, is_private, auto_lock_minutes FROM workspaces WHERE id = ?')
      .get(workspaceId) as
      | { id: string; is_private: number; auto_lock_minutes: number }
      | undefined;

    if (!row) {
      throw new WorkspaceAuthError(404, 'Workspace does not exist.');
    }
    if (row.is_private === 0) {
      throw new WorkspaceAuthError(400, 'Default workspace has no private session.');
    }

    if (!sessionToken) {
      throw new WorkspaceAuthError(
        401,
        'Workspace is locked. Authentication required.',
      );
    }

    const session = this.sessions.get(sessionToken);
    if (!session || session.workspaceId !== workspaceId) {
      throw new WorkspaceAuthError(
        403,
        'Workspace session token is invalid or bound to another workspace.',
      );
    }

    const now = Date.now();
    if (now >= session.expiresAtMs) {
      this.lockWorkspace(workspaceId);
      throw new WorkspaceAuthError(
        401,
        'Workspace session expired. Please unlock again.',
      );
    }

    const autoLockMs = Number(row.auto_lock_minutes) * 60 * 1000;
    if (autoLockMs > 0 && now - session.lastActivityMs >= autoLockMs) {
      this.lockWorkspace(workspaceId);
      throw new WorkspaceAuthError(
        401,
        'Workspace locked automatically due to inactivity.',
      );
    }

    session.lastActivityMs = now;
    this.db
      .prepare('UPDATE workspaces SET last_activity_at = ? WHERE id = ?')
      .run(new Date(now).toISOString(), workspaceId);

    return session;
  }

  async createPrivateWorkspace(params: {
    displayName: string;
    passphrase: string;
    authMethod?: Exclude<WorkspaceAuthMethod, 'none'>;
    autoLockMinutes?: number;
    issueDashboardToken?: boolean;
  }): Promise<{
    workspace: WorkspaceSummary;
    sessionToken: string;
    dashboardToken?: string;
  }> {
    const displayName = normalizePassphrase(params.displayName).trim();
    if (!displayName) {
      throw new WorkspaceAuthError(400, 'Workspace display name is required.');
    }
    if (displayName.length > 60) {
      throw new WorkspaceAuthError(
        400,
        'Workspace display name must be 60 characters or fewer.',
      );
    }

    const duplicate = this.db
      .prepare(
        'SELECT id FROM workspaces WHERE LOWER(display_name) = LOWER(?) LIMIT 1',
      )
      .get(displayName);
    if (duplicate) {
      throw new WorkspaceAuthError(
        409,
        'A workspace with this name already exists.',
      );
    }

    let validatedPassphrase: string;
    try {
      validatedPassphrase = validatePassphrasePolicy(params.passphrase);
    } catch (err) {
      throw new WorkspaceAuthError(400, (err as Error).message);
    }

    const authMethod = params.authMethod ?? 'passphrase';
    if (!['passphrase', 'biometric', 'both'].includes(authMethod)) {
      throw new WorkspaceAuthError(400, 'Unsupported authentication method.');
    }

    const autoLockMinutes = validateAutoLockMinutes(params.autoLockMinutes ?? 5);
    const { dek, credentials } = await provisionWorkspaceCredentials(
      validatedPassphrase,
    );

    const id = `ws-${crypto.randomUUID().slice(0, 12)}`;
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    const memDb = this.createIsolatedMemoryDb();
    const memRepo = new NewsieRepository(memDb);

    try {
      this.db.exec('BEGIN IMMEDIATE');
      this.db
        .prepare(
          `INSERT INTO workspaces (
            id, display_name, is_private, auth_method, password_hash, salt,
            wrapped_key, key_iv, failed_attempts, locked_until_ms, auto_lock_minutes, last_activity_at, created_at
          ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
        )
        .run(
          id,
          displayName,
          authMethod,
          credentials.authHashHex,
          credentials.saltHex,
          credentials.wrappedKeyBase64,
          credentials.keyIvBase64,
          autoLockMinutes,
          nowIso,
          nowIso,
        );

      // Initialize categories & preferences ONLY inside isolated :memory: DB, then flush encrypted records
      memRepo.ensureWorkspaceInitialized(id, displayName, false);
      const session: ActiveSession = {
        workspaceId: id,
        dek,
        memDb,
        memRepo,
        recordDigests: new Map(),
        createdAtMs: nowMs,
        expiresAtMs: nowMs + this.sessionTtlMs,
        lastActivityMs: nowMs,
      };
      this.flushSessionToEncryptedStore(session, true);
      this.db.exec('COMMIT');

      const sessionToken = crypto.randomBytes(32).toString('hex');
      this.sessions.set(sessionToken, session);

      let dashboardToken: string | undefined;
      if (params.issueDashboardToken) {
        dashboardToken = crypto.randomBytes(32).toString('hex');
        this.dashboardSessions.set(dashboardToken, {
          createdAtMs: nowMs,
          expiresAtMs: nowMs + this.dashboardTtlMs,
          lastActivityMs: nowMs,
          authenticatedWorkspaceId: id,
        });
      }

      return {
        workspace: {
          id,
          displayName,
          isPrivate: true,
          isLocked: false,
          authMethod,
          autoLockMinutes,
          lastActivityAt: nowIso,
          createdAt: nowIso,
          hasBiometricCredential: false,
        },
        sessionToken,
        dashboardToken,
      };
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore rollback if transaction was not active
      }
      memDb.close();
      dek.fill(0);
      throw err;
    }
  }

  // Unlock a specific workspace by passphrase (or passphrase+WebAuthn when authMethod === 'both')
  async unlockWorkspace(
    workspaceId: string,
    passphrase: string,
    webauthnProof?: {
      challengeId: string;
      assertion: WebAuthnAssertionInput;
      expectedOrigins: string[];
    },
  ): Promise<{ sessionToken: string; workspace: WorkspaceSummary }> {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get(workspaceId) as Record<string, unknown> | undefined;

    if (!row || Number(row.is_private) === 0) {
      throw new WorkspaceAuthError(401, GENERIC_AUTH_FAILURE_MESSAGE);
    }

    const lockedUntilMs = Number(row.locked_until_ms || 0);
    if (lockedUntilMs > Date.now()) {
      const waitSec = Math.ceil((lockedUntilMs - Date.now()) / 1000);
      throw new WorkspaceAuthError(
        429,
        `Too many failed authentication attempts. Try again in ${waitSec}s.`,
        waitSec,
      );
    }

    const authMethod = String(row.auth_method) as Exclude<WorkspaceAuthMethod, 'none'>;
    const credCount = (
      this.db
        .prepare(
          'SELECT COUNT(*) as c FROM webauthn_credentials WHERE workspace_id = ?',
        )
        .get(workspaceId) as { c: number }
    ).c;

    if (authMethod === 'both' && credCount > 0) {
      if (!webauthnProof) {
        throw new WorkspaceAuthError(
          401,
          'This workspace requires both your passphrase and biometric passkey verification.',
        );
      }
      this.verifyWebAuthnProofForWorkspace(
        workspaceId,
        webauthnProof.challengeId,
        webauthnProof.assertion,
        webauthnProof.expectedOrigins,
        'auth',
      );
    }

    const dek = await verifyAndUnwrapWorkspaceKey(passphrase, {
      saltHex: String(row.salt),
      authHashHex: String(row.password_hash),
      wrappedKeyBase64: String(row.wrapped_key),
      keyIvBase64: String(row.key_iv),
    });

    if (!dek) {
      this.recordWorkspaceAuthFailure(workspaceId, Number(row.failed_attempts || 0));
    }

    return this.openDecryptedSessionWithDek(row, dek);
  }

  // Unlock a workspace using a verified WebAuthn biometric assertion (when authMethod === 'biometric')
  unlockWorkspaceWithWebAuthn(params: {
    workspaceId: string;
    challengeId: string;
    assertion: WebAuthnAssertionInput;
    expectedOrigins: string[];
  }): { sessionToken: string; workspace: WorkspaceSummary } {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get(params.workspaceId) as Record<string, unknown> | undefined;

    if (!row || Number(row.is_private) === 0) {
      throw new WorkspaceAuthError(401, GENERIC_AUTH_FAILURE_MESSAGE);
    }

    const lockedUntilMs = Number(row.locked_until_ms || 0);
    if (lockedUntilMs > Date.now()) {
      const waitSec = Math.ceil((lockedUntilMs - Date.now()) / 1000);
      throw new WorkspaceAuthError(
        429,
        `Too many failed authentication attempts. Try again in ${waitSec}s.`,
        waitSec,
      );
    }

    const authMethod = String(row.auth_method);
    if (authMethod === 'both') {
      throw new WorkspaceAuthError(
        401,
        'This workspace requires passphrase + biometric verification.',
      );
    }
    if (authMethod !== 'biometric') {
      throw new WorkspaceAuthError(401, GENERIC_AUTH_FAILURE_MESSAGE);
    }

    const credRow = this.verifyWebAuthnProofForWorkspace(
      params.workspaceId,
      params.challengeId,
      params.assertion,
      params.expectedOrigins,
      'auth',
    );

    if (!credRow.wrapped_dek || !credRow.wrapped_dek_iv) {
      throw new WorkspaceAuthError(401, GENERIC_AUTH_FAILURE_MESSAGE);
    }

    const combined = Buffer.from(credRow.wrapped_dek, 'base64');
    const authTag = combined.subarray(0, 16);
    const ciphertext = combined.subarray(16);
    const dek = decryptAesGcm(
      this.sealKey,
      {
        ivBase64: credRow.wrapped_dek_iv,
        authTagBase64: authTag.toString('base64'),
        ciphertextBase64: ciphertext.toString('base64'),
      },
      `${params.workspaceId}:webauthn:${credRow.credential_id}`,
    );

    return this.openDecryptedSessionWithDek(row, dek);
  }

  // Private Entry Gate authentication: verifies credentials without pre-disclosing private workspaces
  async authenticatePrivateEntryWithPassphrase(
    passphrase: string,
    clientKey: string = 'local',
    webauthnProof?: {
      challengeId: string;
      assertion: WebAuthnAssertionInput;
      expectedOrigins: string[];
    },
  ): Promise<{
    dashboardToken: string;
    workspace: WorkspaceSummary;
    sessionToken: string;
    workspaces: WorkspaceSummary[];
  }> {
    this.assertGateNotLockedOut(clientKey);

    if (
      !passphrase ||
      passphrase.length < 1 ||
      passphrase.length > MAX_PASSPHRASE_LENGTH
    ) {
      this.recordGateFailure(clientKey);
    }

    const privateRows = this.db
      .prepare('SELECT * FROM workspaces WHERE is_private = 1 ORDER BY created_at ASC')
      .all() as Record<string, unknown>[];

    let matchedRow: Record<string, unknown> | null = null;
    let matchedDek: Buffer | null = null;

    for (const row of privateRows) {
      const dek = await verifyAndUnwrapWorkspaceKey(passphrase, {
        saltHex: String(row.salt),
        authHashHex: String(row.password_hash),
        wrappedKeyBase64: String(row.wrapped_key),
        keyIvBase64: String(row.key_iv),
      });
      if (dek) {
        if (!matchedRow) {
          matchedRow = row;
          matchedDek = dek;
        } else {
          dek.fill(0);
        }
      }
    }

    if (!matchedRow || !matchedDek) {
      this.recordGateFailure(clientKey);
    }

    const wsId = String(matchedRow.id);
    const lockedUntilMs = Number(matchedRow.locked_until_ms || 0);
    if (lockedUntilMs > Date.now()) {
      matchedDek.fill(0);
      const waitSec = Math.ceil((lockedUntilMs - Date.now()) / 1000);
      throw new WorkspaceAuthError(
        429,
        `Too many failed authentication attempts. Try again in ${waitSec}s.`,
        waitSec,
      );
    }

    const authMethod = String(matchedRow.auth_method);
    const credCount = (
      this.db
        .prepare(
          'SELECT COUNT(*) as c FROM webauthn_credentials WHERE workspace_id = ?',
        )
        .get(wsId) as { c: number }
    ).c;

    if (authMethod === 'both' && credCount > 0) {
      if (!webauthnProof) {
        matchedDek.fill(0);
        throw new WorkspaceAuthError(
          401,
          'Biometric verification is also required for this workspace.',
        );
      }
      try {
        this.verifyWebAuthnProofForWorkspace(
          wsId,
          webauthnProof.challengeId,
          webauthnProof.assertion,
          webauthnProof.expectedOrigins,
          'dashboard',
        );
      } catch (err) {
        matchedDek.fill(0);
        throw err;
      }
    }

    this.gateFailures.delete(clientKey);
    const opened = this.openDecryptedSessionWithDek(matchedRow, matchedDek);
    const now = Date.now();
    const dashboardToken = crypto.randomBytes(32).toString('hex');
    this.dashboardSessions.set(dashboardToken, {
      createdAtMs: now,
      expiresAtMs: now + this.dashboardTtlMs,
      lastActivityMs: now,
      authenticatedWorkspaceId: wsId,
    });

    return {
      dashboardToken,
      workspace: opened.workspace,
      sessionToken: opened.sessionToken,
      workspaces: this.queryAllWorkspacesInternal(),
    };
  }

  authenticatePrivateEntryWithWebAuthn(params: {
    challengeId: string;
    assertion: WebAuthnAssertionInput;
    expectedOrigins: string[];
    clientKey?: string;
  }): {
    dashboardToken: string;
    workspace: WorkspaceSummary;
    sessionToken: string;
    workspaces: WorkspaceSummary[];
  } {
    const clientKey = params.clientKey ?? 'local';
    this.assertGateNotLockedOut(clientKey);

    const credRow = this.db
      .prepare('SELECT * FROM webauthn_credentials WHERE credential_id = ?')
      .get(params.assertion.id) as
      | {
          credential_id: string;
          workspace_id: string;
          public_key_spki_b64: string;
          algorithm: number;
          sign_count: number;
          wrapped_dek: string | null;
          wrapped_dek_iv: string | null;
        }
      | undefined;

    if (!credRow) {
      this.consumeChallenge(params.challengeId, 'dashboard');
      this.recordGateFailure(clientKey);
    }

    const wsRow = this.db
      .prepare('SELECT * FROM workspaces WHERE id = ? AND is_private = 1')
      .get(credRow.workspace_id) as Record<string, unknown> | undefined;

    if (!wsRow || String(wsRow.auth_method) === 'both') {
      this.consumeChallenge(params.challengeId, 'dashboard');
      this.recordGateFailure(clientKey);
    }

    try {
      this.verifyWebAuthnProofForWorkspace(
        credRow.workspace_id,
        params.challengeId,
        params.assertion,
        params.expectedOrigins,
        'dashboard',
      );
    } catch (err) {
      this.recordGateFailure(clientKey, err instanceof WorkspaceAuthError ? err : undefined);
    }

    if (!credRow.wrapped_dek || !credRow.wrapped_dek_iv) {
      this.recordGateFailure(clientKey);
    }

    const combined = Buffer.from(credRow.wrapped_dek, 'base64');
    const dek = decryptAesGcm(
      this.sealKey,
      {
        ivBase64: credRow.wrapped_dek_iv,
        authTagBase64: combined.subarray(0, 16).toString('base64'),
        ciphertextBase64: combined.subarray(16).toString('base64'),
      },
      `${credRow.workspace_id}:webauthn:${credRow.credential_id}`,
    );

    this.gateFailures.delete(clientKey);
    const opened = this.openDecryptedSessionWithDek(wsRow, dek);
    const now = Date.now();
    const dashboardToken = crypto.randomBytes(32).toString('hex');
    this.dashboardSessions.set(dashboardToken, {
      createdAtMs: now,
      expiresAtMs: now + this.dashboardTtlMs,
      lastActivityMs: now,
      authenticatedWorkspaceId: credRow.workspace_id,
    });

    return {
      dashboardToken,
      workspace: opened.workspace,
      sessionToken: opened.sessionToken,
      workspaces: this.queryAllWorkspacesInternal(),
    };
  }

  private openDecryptedSessionWithDek(
    row: Record<string, unknown>,
    dek: Buffer,
  ): { sessionToken: string; workspace: WorkspaceSummary } {
    const workspaceId = String(row.id);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    this.db
      .prepare(
        'UPDATE workspaces SET failed_attempts = 0, locked_until_ms = 0, last_activity_at = ? WHERE id = ?',
      )
      .run(nowIso, workspaceId);

    const memDb = this.createIsolatedMemoryDb();
    const memRepo = new NewsieRepository(memDb);

    try {
      const encryptedRows = this.db
        .prepare(
          `SELECT record_type, record_id, iv, auth_tag, ciphertext
           FROM encrypted_workspace_records WHERE workspace_id = ?`,
        )
        .all(workspaceId) as {
        record_type: RecordType;
        record_id: string;
        iv: string;
        auth_tag: string;
        ciphertext: string;
      }[];

      const digests = new Map<string, string>();

      if (encryptedRows.length > 0) {
        this.loadEncryptedRecordsIntoMemoryDb(
          workspaceId,
          String(row.display_name),
          memDb,
          dek,
          encryptedRows,
          digests,
        );
      } else {
        // Legacy fallback migration: if pre-upgrade blob or plaintext table exists
        const legacyBlob = this.db
          .prepare(
            'SELECT iv, auth_tag, ciphertext FROM encrypted_workspace_blobs WHERE workspace_id = ?',
          )
          .get(workspaceId) as
          | { iv: string; auth_tag: string; ciphertext: string }
          | undefined;

        if (legacyBlob) {
          const plainBuf = decryptAesGcm(dek, {
            ivBase64: legacyBlob.iv,
            authTagBase64: legacyBlob.auth_tag,
            ciphertextBase64: legacyBlob.ciphertext,
          });
          const snapshot = JSON.parse(
            plainBuf.toString('utf8'),
          ) as WorkspaceSnapshotPayload;
          this.restoreSnapshotIntoMemoryDb(
            workspaceId,
            String(row.display_name),
            memDb,
            snapshot,
          );
          const tempSession: ActiveSession = {
            workspaceId,
            dek,
            memDb,
            memRepo,
            recordDigests: digests,
            createdAtMs: nowMs,
            expiresAtMs: nowMs + this.sessionTtlMs,
            lastActivityMs: nowMs,
          };
          this.db.exec('BEGIN IMMEDIATE');
          this.flushSessionToEncryptedStore(tempSession, true);
          this.db
            .prepare('DELETE FROM encrypted_workspace_blobs WHERE workspace_id = ?')
            .run(workspaceId);
          this.db.exec('COMMIT');
        } else {
          memRepo.ensureWorkspaceInitialized(
            workspaceId,
            String(row.display_name),
            false,
          );
        }
      }

      // Purge any legacy plaintext rows for this private workspace on disk immediately
      this.purgePlaintextTablesForWorkspace(workspaceId);

      // Revoke any prior sessions for this workspace before creating the fresh token
      this.clearSessionsForWorkspace(workspaceId, true);

      const sessionToken = crypto.randomBytes(32).toString('hex');
      this.sessions.set(sessionToken, {
        workspaceId,
        dek,
        memDb,
        memRepo,
        recordDigests: digests,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + this.sessionTtlMs,
        lastActivityMs: nowMs,
      });

      return {
        sessionToken,
        workspace: this.mapWorkspaceSummary({
          ...row,
          last_activity_at: nowIso,
        }),
      };
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore
      }
      memDb.close();
      dek.fill(0);
      if (err instanceof WorkspaceAuthError) throw err;
      throw new WorkspaceAuthError(
        500,
        'Unable to decrypt workspace data. Ciphertext integrity verification failed.',
      );
    }
  }

  lockWorkspace(workspaceId: string): void {
    if (workspaceId === DEFAULT_WORKSPACE_ID) return;
    const session = this.getSessionByWorkspace(workspaceId);
    if (session) {
      try {
        this.flushSessionToEncryptedStore(session);
      } catch {
        // Even if flush fails, guarantee volatile memory/DEK is purged
      }
    }
    this.purgePlaintextTablesForWorkspace(workspaceId);
    this.clearSessionsForWorkspace(workspaceId, true);
  }

  lockAllPrivateWorkspaces(): void {
    const privateIds = new Set<string>();
    for (const s of this.sessions.values()) {
      privateIds.add(s.workspaceId);
    }
    for (const id of privateIds) {
      this.lockWorkspace(id);
    }
    this.dashboardSessions.clear();
  }

  renameWorkspace(
    workspaceId: string,
    displayName: string,
    dashboardToken?: string,
    sessionToken?: string,
  ): void {
    if (workspaceId === DEFAULT_WORKSPACE_ID) {
      throw new WorkspaceAuthError(
        400,
        'The primary default workspace cannot be renamed.',
      );
    }
    this.assertManagementAuthorization(workspaceId, dashboardToken, sessionToken);

    const trimmed = normalizePassphrase(displayName).trim();
    if (!trimmed) throw new WorkspaceAuthError(400, 'Name cannot be empty.');
    if (trimmed.length > 60) {
      throw new WorkspaceAuthError(400, 'Name must be 60 characters or fewer.');
    }

    const dup = this.db
      .prepare(
        'SELECT id FROM workspaces WHERE LOWER(display_name) = LOWER(?) AND id != ? LIMIT 1',
      )
      .get(trimmed, workspaceId);
    if (dup) {
      throw new WorkspaceAuthError(
        409,
        'A workspace with this name already exists.',
      );
    }

    this.db
      .prepare('UPDATE workspaces SET display_name = ? WHERE id = ?')
      .run(trimmed, workspaceId);

    const active = this.getSessionByWorkspace(workspaceId);
    if (active) {
      active.memDb
        .prepare('UPDATE workspaces SET display_name = ? WHERE id = ?')
        .run(trimmed, workspaceId);
    }
  }

  async updateWorkspaceSettings(
    workspaceId: string,
    patch: {
      authMethod?: Exclude<WorkspaceAuthMethod, 'none'>;
      autoLockMinutes?: number;
      newPassphrase?: string;
    },
    reauth?: ReauthProof,
    dashboardToken?: string,
    sessionToken?: string,
  ): Promise<void> {
    if (workspaceId === DEFAULT_WORKSPACE_ID) {
      throw new WorkspaceAuthError(
        400,
        'Default workspace does not use private security settings.',
      );
    }
    this.assertManagementAuthorization(workspaceId, dashboardToken, sessionToken);

    const changingAuth =
      patch.authMethod !== undefined || patch.newPassphrase !== undefined;

    if (changingAuth) {
      const verifiedDek = await this.verifyFreshReauthForWorkspace(
        workspaceId,
        reauth,
      );
      try {
        if (patch.authMethod) {
          if (!['passphrase', 'biometric', 'both'].includes(patch.authMethod)) {
            throw new WorkspaceAuthError(400, 'Invalid authentication method.');
          }
          if (
            patch.authMethod === 'biometric' ||
            patch.authMethod === 'both'
          ) {
            const credCount = (
              this.db
                .prepare(
                  'SELECT COUNT(*) as c FROM webauthn_credentials WHERE workspace_id = ?',
                )
                .get(workspaceId) as { c: number }
            ).c;
            if (credCount === 0) {
              throw new WorkspaceAuthError(
                400,
                'Enroll a biometric passkey before requiring WebAuthn authentication.',
              );
            }
          }
          this.db
            .prepare('UPDATE workspaces SET auth_method = ? WHERE id = ?')
            .run(patch.authMethod, workspaceId);
        }

        if (patch.newPassphrase !== undefined) {
          let validated: string;
          try {
            validated = validatePassphrasePolicy(patch.newPassphrase);
          } catch (err) {
            throw new WorkspaceAuthError(400, (err as Error).message);
          }
          const activeSession = this.getSessionByWorkspace(workspaceId);
          const dekToWrap = activeSession?.dek ?? verifiedDek;
          if (!dekToWrap) {
            throw new WorkspaceAuthError(
              401,
              'Fresh passphrase re-authentication is required to rotate encryption keys.',
            );
          }
          const { dek, credentials } = await provisionWorkspaceCredentials(
            validated,
            dekToWrap,
          );
          dek.fill(0); // Session keeps its existing dek Buffer; this rotated copy is discarded cleanly
          this.db
            .prepare(
              `UPDATE workspaces
               SET password_hash = ?, salt = ?, wrapped_key = ?, key_iv = ?
               WHERE id = ?`,
            )
            .run(
              credentials.authHashHex,
              credentials.saltHex,
              credentials.wrappedKeyBase64,
              credentials.keyIvBase64,
              workspaceId,
            );
        }
      } finally {
        verifiedDek?.fill(0);
      }
    }

    if (typeof patch.autoLockMinutes === 'number') {
      const validatedMins = validateAutoLockMinutes(patch.autoLockMinutes);
      this.db
        .prepare('UPDATE workspaces SET auto_lock_minutes = ? WHERE id = ?')
        .run(validatedMins, workspaceId);
    }
  }

  async deleteWorkspace(
    workspaceId: string,
    reauth: ReauthProof | undefined,
    dashboardToken?: string,
    sessionToken?: string,
  ): Promise<void> {
    if (workspaceId === DEFAULT_WORKSPACE_ID) {
      throw new WorkspaceAuthError(
        400,
        'The primary default workspace cannot be deleted.',
      );
    }
    this.assertManagementAuthorization(workspaceId, dashboardToken, sessionToken);

    const dek = await this.verifyFreshReauthForWorkspace(workspaceId, reauth);
    dek?.fill(0);

    this.clearSessionsForWorkspace(workspaceId, true);
    this.purgePlaintextTablesForWorkspace(workspaceId);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('DELETE FROM encrypted_workspace_records WHERE workspace_id = ?')
        .run(workspaceId);
      this.db
        .prepare('DELETE FROM encrypted_workspace_blobs WHERE workspace_id = ?')
        .run(workspaceId);
      this.db
        .prepare('DELETE FROM webauthn_credentials WHERE workspace_id = ?')
        .run(workspaceId);
      this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // WebAuthn registration & assertion flows
  createWebAuthnRegistrationOptions(params: {
    workspaceId: string;
    rpId: string;
    dashboardToken?: string;
    sessionToken?: string;
  }): {
    challengeId: string;
    challenge: string;
    rp: { name: string; id: string };
    user: { id: string; name: string; displayName: string };
    excludeCredentialIds: string[];
  } {
    this.assertAuthorizedAccess(params.workspaceId, params.sessionToken);
    if (params.dashboardToken) {
      this.assertDashboardSession(params.dashboardToken);
    }

    const row = this.db
      .prepare('SELECT id, display_name FROM workspaces WHERE id = ? AND is_private = 1')
      .get(params.workspaceId) as { id: string; display_name: string } | undefined;
    if (!row) {
      throw new WorkspaceAuthError(404, 'Private workspace not found.');
    }

    const challengeId = crypto.randomUUID();
    const challengeB64Url = crypto.randomBytes(32).toString('base64url');
    this.pendingChallenges.set(challengeId, {
      challengeB64Url,
      purpose: 'register',
      workspaceId: params.workspaceId,
      rpId: params.rpId,
      expiresAtMs: Date.now() + CHALLENGE_TTL_MS,
    });

    const existingCreds = this.db
      .prepare(
        'SELECT credential_id FROM webauthn_credentials WHERE workspace_id = ?',
      )
      .all(params.workspaceId) as { credential_id: string }[];

    return {
      challengeId,
      challenge: challengeB64Url,
      rp: { name: 'Newsie', id: params.rpId },
      user: {
        id: Buffer.from(params.workspaceId, 'utf8').toString('base64url'),
        name: row.id,
        displayName: row.display_name,
      },
      excludeCredentialIds: existingCreds.map((c) => c.credential_id),
    };
  }

  registerWebAuthnCredential(params: {
    workspaceId: string;
    challengeId: string;
    registration: WebAuthnRegistrationInput;
    expectedOrigins: string[];
    label?: string;
    sessionToken?: string;
  }): WebAuthnCredentialView {
    const session = this.assertAuthorizedSession(
      params.workspaceId,
      params.sessionToken,
    );
    const challenge = this.consumeChallenge(
      params.challengeId,
      'register',
      params.workspaceId,
    );

    const verified = verifyAttestationRegistration({
      attestationObjectB64Url: params.registration.attestationObject,
      clientDataJsonB64Url: params.registration.clientDataJSON,
      expectedChallenge: challenge.challengeB64Url,
      expectedOrigin: params.expectedOrigins,
      rpId: challenge.rpId,
      requireUserVerification: true,
    });

    const wrapped = encryptAesGcm(
      this.sealKey,
      session.dek,
      `${params.workspaceId}:webauthn:${verified.credentialIdB64Url}`,
    );
    const wrappedCombined = Buffer.concat([
      Buffer.from(wrapped.authTagBase64, 'base64'),
      Buffer.from(wrapped.ciphertextBase64, 'base64'),
    ]).toString('base64');

    const nowIso = new Date().toISOString();
    const label = (params.label || 'Platform Passkey').trim().slice(0, 60);

    this.db
      .prepare(
        `INSERT INTO webauthn_credentials (
          credential_id, workspace_id, public_key_spki_b64, algorithm,
          sign_count, label, wrapped_dek, wrapped_dek_iv, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        verified.credentialIdB64Url,
        params.workspaceId,
        verified.publicKeySpkiB64,
        verified.algorithm,
        verified.signCount,
        label,
        wrappedCombined,
        wrapped.ivBase64,
        nowIso,
      );

    return {
      credentialId: verified.credentialIdB64Url,
      workspaceId: params.workspaceId,
      label,
      createdAt: nowIso,
    };
  }

  listWebAuthnCredentials(
    workspaceId: string,
    dashboardToken?: string,
    sessionToken?: string,
  ): WebAuthnCredentialView[] {
    this.assertManagementAuthorization(workspaceId, dashboardToken, sessionToken);
    const rows = this.db
      .prepare(
        `SELECT credential_id, workspace_id, label, created_at
         FROM webauthn_credentials WHERE workspace_id = ? ORDER BY created_at DESC`,
      )
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => ({
      credentialId: String(r.credential_id),
      workspaceId: String(r.workspace_id),
      label: String(r.label),
      createdAt: String(r.created_at),
    }));
  }

  async removeWebAuthnCredential(params: {
    workspaceId: string;
    credentialId: string;
    reauth: ReauthProof | undefined;
    dashboardToken?: string;
    sessionToken?: string;
  }): Promise<void> {
    this.assertManagementAuthorization(
      params.workspaceId,
      params.dashboardToken,
      params.sessionToken,
    );
    const dek = await this.verifyFreshReauthForWorkspace(
      params.workspaceId,
      params.reauth,
    );
    dek?.fill(0);

    this.db
      .prepare(
        'DELETE FROM webauthn_credentials WHERE workspace_id = ? AND credential_id = ?',
      )
      .run(params.workspaceId, params.credentialId);

    const remaining = (
      this.db
        .prepare(
          'SELECT COUNT(*) as c FROM webauthn_credentials WHERE workspace_id = ?',
        )
        .get(params.workspaceId) as { c: number }
    ).c;
    if (remaining === 0) {
      this.db
        .prepare(
          `UPDATE workspaces SET auth_method = 'passphrase' WHERE id = ? AND auth_method IN ('biometric', 'both')`,
        )
        .run(params.workspaceId);
    }
  }

  createWebAuthnAuthOptions(params: {
    purpose: 'auth' | 'dashboard' | 'reauth';
    rpId: string;
    workspaceId?: string;
  }): {
    challengeId: string;
    challenge: string;
    rpId: string;
    allowCredentialIds: string[];
  } {
    const challengeId = crypto.randomUUID();
    const challengeB64Url = crypto.randomBytes(32).toString('base64url');

    let credRows: { credential_id: string }[];
    if (params.workspaceId) {
      credRows = this.db
        .prepare(
          'SELECT credential_id FROM webauthn_credentials WHERE workspace_id = ?',
        )
        .all(params.workspaceId) as { credential_id: string }[];
    } else {
      credRows = this.db
        .prepare('SELECT credential_id FROM webauthn_credentials')
        .all() as { credential_id: string }[];
    }

    this.pendingChallenges.set(challengeId, {
      challengeB64Url,
      purpose: params.purpose,
      workspaceId: params.workspaceId,
      rpId: params.rpId,
      expiresAtMs: Date.now() + CHALLENGE_TTL_MS,
    });

    return {
      challengeId,
      challenge: challengeB64Url,
      rpId: params.rpId,
      allowCredentialIds: credRows.map((c) => c.credential_id),
    };
  }

  // ---- Internal helpers ----

  private assertManagementAuthorization(
    workspaceId: string,
    dashboardToken?: string,
    sessionToken?: string,
  ): void {
    const hasDash = dashboardToken && this.isDashboardTokenValid(dashboardToken);
    if (hasDash) {
      const exists = this.db
        .prepare('SELECT id FROM workspaces WHERE id = ? AND is_private = 1')
        .get(workspaceId);
      if (!exists) throw new WorkspaceAuthError(404, 'Workspace does not exist.');
      this.assertDashboardSession(dashboardToken);
      return;
    }
    this.assertAuthorizedAccess(workspaceId, sessionToken);
  }

  private async verifyFreshReauthForWorkspace(
    workspaceId: string,
    reauth?: ReauthProof,
  ): Promise<Buffer | null> {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE id = ? AND is_private = 1')
      .get(workspaceId) as Record<string, unknown> | undefined;
    if (!row) throw new WorkspaceAuthError(404, 'Workspace not found.');

    const lockedUntilMs = Number(row.locked_until_ms || 0);
    if (lockedUntilMs > Date.now()) {
      const waitSec = Math.ceil((lockedUntilMs - Date.now()) / 1000);
      throw new WorkspaceAuthError(
        429,
        `Too many failed authentication attempts. Try again in ${waitSec}s.`,
        waitSec,
      );
    }

    if (!reauth) {
      throw new WorkspaceAuthError(
        401,
        'Fresh authentication is required to complete this action.',
      );
    }

    if (typeof reauth.passphrase === 'string' && reauth.passphrase.length > 0) {
      const dek = await verifyAndUnwrapWorkspaceKey(reauth.passphrase, {
        saltHex: String(row.salt),
        authHashHex: String(row.password_hash),
        wrappedKeyBase64: String(row.wrapped_key),
        keyIvBase64: String(row.key_iv),
      });
      if (!dek) {
        this.recordWorkspaceAuthFailure(
          workspaceId,
          Number(row.failed_attempts || 0),
        );
      }
      this.db
        .prepare(
          'UPDATE workspaces SET failed_attempts = 0, locked_until_ms = 0 WHERE id = ?',
        )
        .run(workspaceId);
      return dek;
    }

    if (reauth.webauthn) {
      this.verifyWebAuthnProofForWorkspace(
        workspaceId,
        reauth.webauthn.challengeId,
        reauth.webauthn.assertion,
        reauth.webauthn.expectedOrigins,
        'reauth',
      );
      this.db
        .prepare(
          'UPDATE workspaces SET failed_attempts = 0, locked_until_ms = 0 WHERE id = ?',
        )
        .run(workspaceId);
      return null;
    }

    throw new WorkspaceAuthError(
      401,
      'Fresh passphrase or WebAuthn verification is required.',
    );
  }

  private consumeChallenge(
    challengeId: string,
    purpose: PendingChallenge['purpose'],
    expectedWorkspaceId?: string,
  ): PendingChallenge {
    const ch = this.pendingChallenges.get(challengeId);
    // Always delete immediately so challenges are strictly single-use
    this.pendingChallenges.delete(challengeId);
    if (!ch || ch.expiresAtMs <= Date.now() || ch.purpose !== purpose) {
      throw new WorkspaceAuthError(401, 'Authentication challenge expired or invalid.');
    }
    if (
      expectedWorkspaceId &&
      ch.workspaceId &&
      ch.workspaceId !== expectedWorkspaceId
    ) {
      throw new WorkspaceAuthError(401, 'Authentication challenge mismatch.');
    }
    return ch;
  }

  private verifyWebAuthnProofForWorkspace(
    workspaceId: string,
    challengeId: string,
    assertion: WebAuthnAssertionInput,
    expectedOrigins: string[],
    purpose: PendingChallenge['purpose'],
  ): {
    credential_id: string;
    public_key_spki_b64: string;
    algorithm: number;
    sign_count: number;
    wrapped_dek: string | null;
    wrapped_dek_iv: string | null;
  } {
    const challenge = this.consumeChallenge(challengeId, purpose, workspaceId);
    const credRow = this.db
      .prepare(
        `SELECT credential_id, public_key_spki_b64, algorithm, sign_count, wrapped_dek, wrapped_dek_iv
         FROM webauthn_credentials WHERE workspace_id = ? AND credential_id = ?`,
      )
      .get(workspaceId, assertion.id) as
      | {
          credential_id: string;
          public_key_spki_b64: string;
          algorithm: number;
          sign_count: number;
          wrapped_dek: string | null;
          wrapped_dek_iv: string | null;
        }
      | undefined;

    if (!credRow) {
      throw new WorkspaceAuthError(401, GENERIC_AUTH_FAILURE_MESSAGE);
    }

    try {
      const result = verifyWebAuthnAssertion({
        credential: {
          credentialId: credRow.credential_id,
          workspaceId,
          publicKeySpkiB64: credRow.public_key_spki_b64,
          algorithm: credRow.algorithm,
          signCount: credRow.sign_count,
          label: 'Platform Passkey',
        },
        authenticatorDataB64Url: assertion.authenticatorData,
        clientDataJsonB64Url: assertion.clientDataJSON,
        signatureB64Url: assertion.signature,
        expectedChallenge: challenge.challengeB64Url,
        expectedOrigin: expectedOrigins,
        rpId: challenge.rpId,
        requireUserVerification: true,
      });

      this.db
        .prepare(
          'UPDATE webauthn_credentials SET sign_count = ? WHERE credential_id = ?',
        )
        .run(result.nextSignCount, credRow.credential_id);

      return credRow;
    } catch {
      throw new WorkspaceAuthError(401, GENERIC_AUTH_FAILURE_MESSAGE);
    }
  }

  private recordWorkspaceAuthFailure(
    workspaceId: string,
    prevAttempts: number,
  ): never {
    const nextFails = prevAttempts + 1;
    const backoffMs = computeLockoutBackoffMs(nextFails);
    const nextLockedUntil = backoffMs > 0 ? Date.now() + backoffMs : 0;
    this.db
      .prepare(
        'UPDATE workspaces SET failed_attempts = ?, locked_until_ms = ? WHERE id = ?',
      )
      .run(nextFails, nextLockedUntil, workspaceId);

    if (backoffMs > 0) {
      const waitSec = Math.ceil(backoffMs / 1000);
      throw new WorkspaceAuthError(
        429,
        `Too many failed authentication attempts. Try again in ${waitSec}s.`,
        waitSec,
      );
    }
    throw new WorkspaceAuthError(401, GENERIC_AUTH_FAILURE_MESSAGE);
  }

  private assertGateNotLockedOut(clientKey: string): void {
    const rec = this.gateFailures.get(clientKey);
    if (rec && rec.lockedUntilMs > Date.now()) {
      const waitSec = Math.ceil((rec.lockedUntilMs - Date.now()) / 1000);
      throw new WorkspaceAuthError(
        429,
        `Too many failed authentication attempts. Try again in ${waitSec}s.`,
        waitSec,
      );
    }
  }

  private recordGateFailure(
    clientKey: string,
    overrideError?: WorkspaceAuthError,
  ): never {
    const prev = this.gateFailures.get(clientKey)?.count ?? 0;
    const next = prev + 1;
    const backoffMs = computeLockoutBackoffMs(next);
    const lockedUntilMs = backoffMs > 0 ? Date.now() + backoffMs : 0;
    this.gateFailures.set(clientKey, { count: next, lockedUntilMs });

    if (backoffMs > 0) {
      const waitSec = Math.ceil(backoffMs / 1000);
      throw new WorkspaceAuthError(
        429,
        `Too many failed authentication attempts. Try again in ${waitSec}s.`,
        waitSec,
      );
    }
    if (overrideError) throw overrideError;
    throw new WorkspaceAuthError(401, GENERIC_AUTH_FAILURE_MESSAGE);
  }

  private clearSessionsForWorkspace(workspaceId: string, zeroizeDek: boolean): void {
    for (const [token, session] of this.sessions.entries()) {
      if (session.workspaceId === workspaceId) {
        if (zeroizeDek) {
          session.dek.fill(0);
          try {
            session.memDb.close();
          } catch {
            // Already closed
          }
        }
        this.sessions.delete(token);
      }
    }
  }

  private createIsolatedMemoryDb(): DatabaseSync {
    const memDb = new DatabaseSync(':memory:');
    applyNewsieSchema(memDb);
    return memDb;
  }

  private flushSessionToEncryptedStore(
    session: ActiveSession,
    insideOuterTransaction: boolean = false,
  ): void {
    const workspaceId = session.workspaceId;
    const rows = this.collectAllRecordsFromDb(session.memDb, workspaceId);
    const activeKeys = new Set<string>();
    const nowIso = new Date().toISOString();

    if (!insideOuterTransaction) {
      this.db.exec('BEGIN IMMEDIATE');
    }
    try {
      const upsertStmt = this.db.prepare(
        `INSERT INTO encrypted_workspace_records (
          workspace_id, record_type, record_id, iv, auth_tag, ciphertext, updated_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, record_type, record_id) DO UPDATE SET
          iv = excluded.iv,
          auth_tag = excluded.auth_tag,
          ciphertext = excluded.ciphertext,
          updated_at_iso = excluded.updated_at_iso`,
      );

      for (const rec of rows) {
        const key = `${rec.recordType}::${rec.recordId}`;
        activeKeys.add(key);
        const json = JSON.stringify(rec.payload);
        const digest = crypto.createHash('sha256').update(json).digest('hex');

        if (session.recordDigests.get(key) === digest) {
          continue;
        }

        const aad = `${workspaceId}:${rec.recordType}:${rec.recordId}`;
        const encrypted = encryptAesGcm(
          session.dek,
          Buffer.from(json, 'utf8'),
          aad,
        );
        upsertStmt.run(
          workspaceId,
          rec.recordType,
          rec.recordId,
          encrypted.ivBase64,
          encrypted.authTagBase64,
          encrypted.ciphertextBase64,
          nowIso,
        );
        session.recordDigests.set(key, digest);
      }

      // Remove deleted records from persistent encrypted store
      const delStmt = this.db.prepare(
        'DELETE FROM encrypted_workspace_records WHERE workspace_id = ? AND record_type = ? AND record_id = ?',
      );
      for (const cachedKey of Array.from(session.recordDigests.keys())) {
        if (!activeKeys.has(cachedKey)) {
          const splitIdx = cachedKey.indexOf('::');
          const rt = cachedKey.slice(0, splitIdx);
          const rid = cachedKey.slice(splitIdx + 2);
          delStmt.run(workspaceId, rt, rid);
          session.recordDigests.delete(cachedKey);
        }
      }

      if (!insideOuterTransaction) {
        this.db.exec('COMMIT');
      }
    } catch (err) {
      if (!insideOuterTransaction) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // Ignore
        }
      }
      throw err;
    }
  }

  private collectAllRecordsFromDb(
    db: DatabaseSync,
    workspaceId: string,
  ): { recordType: RecordType; recordId: string; payload: Record<string, unknown> }[] {
    const out: {
      recordType: RecordType;
      recordId: string;
      payload: Record<string, unknown>;
    }[] = [];

    const tables: { table: string; type: RecordType; idCol: string }[] = [
      { table: 'categories', type: 'category', idCol: 'id' },
      { table: 'sources', type: 'source', idCol: 'id' },
      { table: 'articles', type: 'article', idCol: 'id' },
      { table: 'reading_history', type: 'reading_history', idCol: 'id' },
      { table: 'search_history', type: 'search_history', idCol: 'id' },
      { table: 'saved_feed_configs', type: 'feed_config', idCol: 'id' },
      { table: 'preferences', type: 'preferences', idCol: 'workspace_id' },
    ];

    for (const t of tables) {
      const rows = db
        .prepare(`SELECT * FROM ${t.table} WHERE workspace_id = ?`)
        .all(workspaceId) as Record<string, unknown>[];
      for (const r of rows) {
        const recordId =
          t.type === 'preferences' ? 'prefs' : String(r[t.idCol]);
        out.push({ recordType: t.type, recordId, payload: r });
      }
    }
    return out;
  }

  private loadEncryptedRecordsIntoMemoryDb(
    workspaceId: string,
    displayName: string,
    memDb: DatabaseSync,
    dek: Buffer,
    encryptedRows: {
      record_type: RecordType;
      record_id: string;
      iv: string;
      auth_tag: string;
      ciphertext: string;
    }[],
    digests: Map<string, string>,
  ): void {
    memDb
      .prepare(
        `INSERT OR IGNORE INTO workspaces (id, display_name, is_private, auth_method, created_at)
         VALUES (?, ?, 1, 'none', ?)`,
      )
      .run(workspaceId, displayName, new Date().toISOString());

    const snapshot: WorkspaceSnapshotPayload = {
      categories: [],
      sources: [],
      articles: [],
      readingHistory: [],
      searchHistory: [],
      feedConfigs: [],
      preferences: [],
    };

    for (const row of encryptedRows) {
      const aad = `${workspaceId}:${row.record_type}:${row.record_id}`;
      const plainBuf = decryptAesGcm(
        dek,
        {
          ivBase64: row.iv,
          authTagBase64: row.auth_tag,
          ciphertextBase64: row.ciphertext,
        },
        aad,
      );
      const jsonStr = plainBuf.toString('utf8');
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      const digest = crypto.createHash('sha256').update(jsonStr).digest('hex');
      digests.set(`${row.record_type}::${row.record_id}`, digest);

      switch (row.record_type) {
        case 'category':
          snapshot.categories.push(parsed);
          break;
        case 'source':
          snapshot.sources.push(parsed);
          break;
        case 'article':
          snapshot.articles.push(parsed);
          break;
        case 'reading_history':
          snapshot.readingHistory.push(parsed);
          break;
        case 'search_history':
          snapshot.searchHistory.push(parsed);
          break;
        case 'feed_config':
          snapshot.feedConfigs.push(parsed);
          break;
        case 'preferences':
          snapshot.preferences.push(parsed);
          break;
      }
    }

    this.restoreSnapshotIntoMemoryDb(workspaceId, displayName, memDb, snapshot);
  }

  private purgePlaintextTablesForWorkspace(workspaceId: string): void {
    const tables = [
      'reading_history',
      'search_history',
      'saved_feed_configs',
      'articles',
      'sources',
      'categories',
      'preferences',
    ];
    for (const table of tables) {
      this.db
        .prepare(`DELETE FROM ${table} WHERE workspace_id = ?`)
        .run(workspaceId);
    }
  }

  private restoreSnapshotIntoMemoryDb(
    workspaceId: string,
    displayName: string,
    targetDb: DatabaseSync,
    snapshot: WorkspaceSnapshotPayload,
  ): void {
    targetDb
      .prepare(
        `INSERT OR IGNORE INTO workspaces (id, display_name, is_private, auth_method, created_at)
         VALUES (?, ?, 1, 'none', ?)`,
      )
      .run(workspaceId, displayName, new Date().toISOString());

    const insertCat = targetDb.prepare(
      'INSERT INTO categories (id, workspace_id, name, enabled, is_custom, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const row of snapshot.categories as Record<string, unknown>[]) {
      insertCat.run(
        String(row.id),
        workspaceId,
        String(row.name),
        Number(row.enabled),
        Number(row.is_custom),
        Number(row.sort_order),
      );
    }

    const insertSrc = targetDb.prepare(
      `INSERT INTO sources (id, workspace_id, name, url, format, category_id, enabled, description, etag, last_modified, last_fetched_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of snapshot.sources as Record<string, unknown>[]) {
      insertSrc.run(
        String(row.id),
        workspaceId,
        String(row.name),
        String(row.url),
        String(row.format),
        String(row.category_id),
        Number(row.enabled),
        String(row.description || ''),
        row.etag ? String(row.etag) : null,
        row.last_modified ? String(row.last_modified) : null,
        row.last_fetched_at ? String(row.last_fetched_at) : null,
        row.last_error ? String(row.last_error) : null,
      );
    }

    const insertArt = targetDb.prepare(
      `INSERT INTO articles (
        id, workspace_id, source_id, publisher, author, category_id, category_name,
        title, description, excerpt, url, normalized_url, external_guid, fingerprint,
        image_url, image_alt, published_at_iso, read_time_minutes, keywords_json,
        is_bookmarked, bookmarked_at_iso, created_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of snapshot.articles as Record<string, unknown>[]) {
      insertArt.run(
        String(row.id),
        workspaceId,
        String(row.source_id),
        String(row.publisher),
        row.author ? String(row.author) : null,
        String(row.category_id),
        String(row.category_name),
        String(row.title),
        String(row.description),
        String(row.excerpt),
        String(row.url),
        String(row.normalized_url),
        row.external_guid ? String(row.external_guid) : null,
        String(row.fingerprint),
        row.image_url ? String(row.image_url) : null,
        String(row.image_alt || ''),
        String(row.published_at_iso),
        Number(row.read_time_minutes || 3),
        String(row.keywords_json || '[]'),
        Number(row.is_bookmarked || 0),
        row.bookmarked_at_iso ? String(row.bookmarked_at_iso) : null,
        String(row.created_at_iso || new Date().toISOString()),
      );
    }

    const insertHist = targetDb.prepare(
      'INSERT INTO reading_history (id, workspace_id, article_id, publisher, title, opened_at_iso, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const row of snapshot.readingHistory as Record<string, unknown>[]) {
      insertHist.run(
        Number(row.id),
        workspaceId,
        String(row.article_id),
        String(row.publisher),
        String(row.title),
        String(row.opened_at_iso),
        String(row.status || 'opened'),
      );
    }

    const insertSearch = targetDb.prepare(
      'INSERT INTO search_history (id, workspace_id, query_text, searched_at_iso) VALUES (?, ?, ?, ?)',
    );
    for (const row of snapshot.searchHistory as Record<string, unknown>[]) {
      insertSearch.run(
        Number(row.id),
        workspaceId,
        String(row.query_text),
        String(row.searched_at_iso),
      );
    }

    const insertCfg = targetDb.prepare(
      'INSERT INTO saved_feed_configs (id, workspace_id, name, category_ids_json, source_ids_json, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const row of snapshot.feedConfigs as Record<string, unknown>[]) {
      insertCfg.run(
        String(row.id),
        workspaceId,
        String(row.name),
        String(row.category_ids_json),
        String(row.source_ids_json),
        String(row.sort_order),
      );
    }

    const insertPref = targetDb.prepare(
      'INSERT INTO preferences (workspace_id, prefs_json) VALUES (?, ?)',
    );
    for (const row of snapshot.preferences as Record<string, unknown>[]) {
      insertPref.run(workspaceId, String(row.prefs_json));
    }
  }
}

function validateAutoLockMinutes(val: number): number {
  const allowed = [0, 1, 5, 15, 30];
  if (!Number.isFinite(val) || !allowed.includes(val)) {
    throw new WorkspaceAuthError(
      400,
      'Auto-lock interval must be 1, 5, 15, 30 minutes, or 0 (manual).',
    );
  }
  return val;
}

function loadOrCreateVaultSealKey(customPath?: string): Buffer {
  const keyPath =
    customPath ?? path.resolve(process.cwd(), 'data', '.vault-seal.key');
  try {
    if (fs.existsSync(keyPath)) {
      const hex = fs.readFileSync(keyPath, 'utf8').trim();
      const buf = Buffer.from(hex, 'hex');
      if (buf.length === 32) return buf;
    }
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    const fresh = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, fresh.toString('hex'), { mode: 0o600 });
    return fresh;
  } catch {
    return crypto.randomBytes(32);
  }
}
