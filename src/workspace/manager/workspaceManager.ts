import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_WORKSPACE_ID } from '../../core/database/newsieDb';
import { NewsieRepository } from '../../core/database/repositories';
import {
  computeLockoutBackoffMs,
  decryptAesGcm,
  encryptAesGcm,
  provisionWorkspaceCredentials,
  verifyAndUnwrapWorkspaceKey,
} from '../../core/security/workspaceCrypto';

export interface WorkspaceSummary {
  id: string;
  displayName: string;
  isPrivate: boolean;
  isLocked: boolean;
  authMethod: 'passphrase' | 'biometric' | 'both' | 'none';
  autoLockMinutes: number;
  createdAt: string;
}

interface WorkspaceSnapshotPayload {
  categories: unknown[];
  sources: unknown[];
  articles: unknown[];
  readingHistory: unknown[];
  searchHistory: unknown[];
  feedConfigs: unknown[];
  preferences: unknown[];
}

interface ActiveSession {
  workspaceId: string;
  dek: Buffer;
  lastActivityMs: number;
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
  // Maps opaque session token -> unlocked workspace DEK in memory only
  private readonly sessions = new Map<string, ActiveSession>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly repo: NewsieRepository,
  ) {}

  private isWorkspaceUnlockedInMemory(workspaceId: string): boolean {
    if (workspaceId === DEFAULT_WORKSPACE_ID) return true;
    for (const s of this.sessions.values()) {
      if (s.workspaceId === workspaceId) return true;
    }
    return false;
  }

  listWorkspaces(): WorkspaceSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, display_name, is_private, auth_method, auto_lock_minutes, created_at
         FROM workspaces ORDER BY is_private ASC, created_at ASC`,
      )
      .all() as Record<string, unknown>[];

    return rows.map((r) => {
      const id = String(r.id);
      const isPrivate = Number(r.is_private) === 1;
      return {
        id,
        displayName: String(r.display_name),
        isPrivate,
        isLocked: isPrivate && !this.isWorkspaceUnlockedInMemory(id),
        authMethod: String(r.auth_method) as WorkspaceSummary['authMethod'],
        autoLockMinutes: Number(r.auto_lock_minutes ?? 5),
        createdAt: String(r.created_at),
      };
    });
  }

  assertAuthorizedAccess(workspaceId: string, sessionToken?: string): void {
    if (workspaceId === DEFAULT_WORKSPACE_ID) return;

    const row = this.db
      .prepare('SELECT id, is_private, auto_lock_minutes FROM workspaces WHERE id = ?')
      .get(workspaceId) as
      | { id: string; is_private: number; auto_lock_minutes: number }
      | undefined;

    if (!row) {
      throw new WorkspaceAuthError(404, 'Workspace does not exist.');
    }
    if (row.is_private === 0) return;

    if (!sessionToken) {
      throw new WorkspaceAuthError(
        401,
        'Private workspace is locked. Unlock to access.',
      );
    }

    const session = this.sessions.get(sessionToken);
    if (!session || session.workspaceId !== workspaceId) {
      throw new WorkspaceAuthError(
        403,
        'Workspace session token is invalid for this workspace.',
      );
    }

    const autoLockMs = Number(row.auto_lock_minutes) * 60 * 1000;
    if (autoLockMs > 0 && Date.now() - session.lastActivityMs > autoLockMs) {
      this.lockWorkspace(workspaceId);
      throw new WorkspaceAuthError(
        401,
        'Workspace locked automatically due to inactivity.',
      );
    }

    session.lastActivityMs = Date.now();
  }

  async createPrivateWorkspace(params: {
    displayName: string;
    passphrase: string;
    authMethod?: 'passphrase' | 'biometric' | 'both';
    autoLockMinutes?: number;
  }): Promise<{ workspace: WorkspaceSummary; sessionToken: string }> {
    const displayName = params.displayName.trim();
    if (!displayName) {
      throw new WorkspaceAuthError(400, 'Workspace display name is required.');
    }

    const { dek, credentials } = await provisionWorkspaceCredentials(
      params.passphrase,
    );
    const id = `ws-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const authMethod = params.authMethod ?? 'passphrase';
    const autoLockMinutes = params.autoLockMinutes ?? 5;

    this.db
      .prepare(
        `INSERT INTO workspaces (
          id, display_name, is_private, auth_method, password_hash, salt,
          wrapped_key, key_iv, failed_attempts, locked_until_ms, auto_lock_minutes, created_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
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
        now,
      );

    this.repo.ensureWorkspaceInitialized(id, displayName, false);

    const sessionToken = crypto.randomBytes(24).toString('hex');
    this.sessions.set(sessionToken, {
      workspaceId: id,
      dek,
      lastActivityMs: Date.now(),
    });

    return {
      workspace: {
        id,
        displayName,
        isPrivate: true,
        isLocked: false,
        authMethod,
        autoLockMinutes,
        createdAt: now,
      },
      sessionToken,
    };
  }

  async unlockWorkspace(
    workspaceId: string,
    passphrase: string,
  ): Promise<{ sessionToken: string; workspace: WorkspaceSummary }> {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get(workspaceId) as Record<string, unknown> | undefined;

    if (!row || Number(row.is_private) === 0) {
      throw new WorkspaceAuthError(404, 'Private workspace not found.');
    }

    const lockedUntilMs = Number(row.locked_until_ms || 0);
    if (lockedUntilMs > Date.now()) {
      const waitSec = Math.ceil((lockedUntilMs - Date.now()) / 1000);
      throw new WorkspaceAuthError(
        429,
        `Too many failed unlock attempts. Try again in ${waitSec}s.`,
        waitSec,
      );
    }

    const dek = await verifyAndUnwrapWorkspaceKey(passphrase, {
      saltHex: String(row.salt),
      authHashHex: String(row.password_hash),
      wrappedKeyBase64: String(row.wrapped_key),
      keyIvBase64: String(row.key_iv),
    });

    if (!dek) {
      const nextFails = Number(row.failed_attempts || 0) + 1;
      const backoffMs = computeLockoutBackoffMs(nextFails);
      const nextLockedUntil = backoffMs > 0 ? Date.now() + backoffMs : 0;
      this.db
        .prepare(
          'UPDATE workspaces SET failed_attempts = ?, locked_until_ms = ? WHERE id = ?',
        )
        .run(nextFails, nextLockedUntil, workspaceId);

      const waitMsg =
        backoffMs > 0
          ? ` Locked for ${Math.ceil(backoffMs / 1000)}s.`
          : '';
      throw new WorkspaceAuthError(
        401,
        `Incorrect passphrase.${waitMsg}`,
        backoffMs > 0 ? Math.ceil(backoffMs / 1000) : undefined,
      );
    }

    this.db
      .prepare(
        'UPDATE workspaces SET failed_attempts = 0, locked_until_ms = 0 WHERE id = ?',
      )
      .run(workspaceId);

    // Decrypt and restore encrypted workspace snapshot if currently locked
    const blobRow = this.db
      .prepare(
        'SELECT iv, auth_tag, ciphertext FROM encrypted_workspace_blobs WHERE workspace_id = ?',
      )
      .get(workspaceId) as
      | { iv: string; auth_tag: string; ciphertext: string }
      | undefined;

    if (blobRow) {
      const plainBuf = decryptAesGcm(dek, {
        ivBase64: blobRow.iv,
        authTagBase64: blobRow.auth_tag,
        ciphertextBase64: blobRow.ciphertext,
      });
      const snapshot = JSON.parse(
        plainBuf.toString('utf8'),
      ) as WorkspaceSnapshotPayload;
      this.restoreSnapshotToTables(workspaceId, snapshot);
      this.db
        .prepare('DELETE FROM encrypted_workspace_blobs WHERE workspace_id = ?')
        .run(workspaceId);
    }

    // Revoke prior session tokens for this workspace cleanly
    this.clearSessionsForWorkspace(workspaceId, false);

    const sessionToken = crypto.randomBytes(24).toString('hex');
    this.sessions.set(sessionToken, {
      workspaceId,
      dek,
      lastActivityMs: Date.now(),
    });

    return {
      sessionToken,
      workspace: {
        id: workspaceId,
        displayName: String(row.display_name),
        isPrivate: true,
        isLocked: false,
        authMethod: String(row.auth_method) as WorkspaceSummary['authMethod'],
        autoLockMinutes: Number(row.auto_lock_minutes ?? 5),
        createdAt: String(row.created_at),
      },
    };
  }

  lockWorkspace(workspaceId: string): void {
    if (workspaceId === DEFAULT_WORKSPACE_ID) return;
    let activeDek: Buffer | null = null;
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId) {
        activeDek = session.dek;
        break;
      }
    }

    if (activeDek) {
      const snapshot = this.extractSnapshotFromTables(workspaceId);
      const encrypted = encryptAesGcm(
        activeDek,
        Buffer.from(JSON.stringify(snapshot), 'utf8'),
      );
      this.db
        .prepare(
          `INSERT INTO encrypted_workspace_blobs (workspace_id, iv, ciphertext, auth_tag, updated_at_iso)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET
             iv = excluded.iv,
             ciphertext = excluded.ciphertext,
             auth_tag = excluded.auth_tag,
             updated_at_iso = excluded.updated_at_iso`,
        )
        .run(
          workspaceId,
          encrypted.ivBase64,
          encrypted.ciphertextBase64,
          encrypted.authTagBase64,
          new Date().toISOString(),
        );

      this.purgePlaintextTablesForWorkspace(workspaceId);
    }

    this.clearSessionsForWorkspace(workspaceId, true);
  }

  renameWorkspace(workspaceId: string, displayName: string): void {
    const trimmed = displayName.trim();
    if (!trimmed) throw new WorkspaceAuthError(400, 'Name cannot be empty.');
    this.db
      .prepare('UPDATE workspaces SET display_name = ? WHERE id = ?')
      .run(trimmed, workspaceId);
  }

  updateWorkspaceSettings(
    workspaceId: string,
    patch: {
      authMethod?: 'passphrase' | 'biometric' | 'both';
      autoLockMinutes?: number;
    },
  ): void {
    if (patch.authMethod) {
      this.db
        .prepare('UPDATE workspaces SET auth_method = ? WHERE id = ?')
        .run(patch.authMethod, workspaceId);
    }
    if (typeof patch.autoLockMinutes === 'number') {
      this.db
        .prepare('UPDATE workspaces SET auto_lock_minutes = ? WHERE id = ?')
        .run(patch.autoLockMinutes, workspaceId);
    }
  }

  deleteWorkspace(workspaceId: string): void {
    if (workspaceId === DEFAULT_WORKSPACE_ID) {
      throw new WorkspaceAuthError(
        400,
        'The primary default workspace cannot be deleted.',
      );
    }
    this.clearSessionsForWorkspace(workspaceId, true);
    this.purgePlaintextTablesForWorkspace(workspaceId);
    this.db
      .prepare('DELETE FROM encrypted_workspace_blobs WHERE workspace_id = ?')
      .run(workspaceId);
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
  }

  private clearSessionsForWorkspace(workspaceId: string, zeroizeDek: boolean): void {
    for (const [token, session] of this.sessions.entries()) {
      if (session.workspaceId === workspaceId) {
        if (zeroizeDek) {
          session.dek.fill(0);
        }
        this.sessions.delete(token);
      }
    }
  }

  private extractSnapshotFromTables(workspaceId: string): WorkspaceSnapshotPayload {
    return {
      categories: this.db
        .prepare('SELECT * FROM categories WHERE workspace_id = ?')
        .all(workspaceId),
      sources: this.db
        .prepare('SELECT * FROM sources WHERE workspace_id = ?')
        .all(workspaceId),
      articles: this.db
        .prepare('SELECT * FROM articles WHERE workspace_id = ?')
        .all(workspaceId),
      readingHistory: this.db
        .prepare('SELECT * FROM reading_history WHERE workspace_id = ?')
        .all(workspaceId),
      searchHistory: this.db
        .prepare('SELECT * FROM search_history WHERE workspace_id = ?')
        .all(workspaceId),
      feedConfigs: this.db
        .prepare('SELECT * FROM saved_feed_configs WHERE workspace_id = ?')
        .all(workspaceId),
      preferences: this.db
        .prepare('SELECT * FROM preferences WHERE workspace_id = ?')
        .all(workspaceId),
    };
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

  private restoreSnapshotToTables(
    workspaceId: string,
    snapshot: WorkspaceSnapshotPayload,
  ): void {
    this.purgePlaintextTablesForWorkspace(workspaceId);

    const insertCat = this.db.prepare(
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

    const insertSrc = this.db.prepare(
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

    const insertArt = this.db.prepare(
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

    const insertHist = this.db.prepare(
      'INSERT INTO reading_history (workspace_id, article_id, publisher, title, opened_at_iso, status) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const row of snapshot.readingHistory as Record<string, unknown>[]) {
      insertHist.run(
        workspaceId,
        String(row.article_id),
        String(row.publisher),
        String(row.title),
        String(row.opened_at_iso),
        String(row.status || 'opened'),
      );
    }

    const insertSearch = this.db.prepare(
      'INSERT INTO search_history (workspace_id, query_text, searched_at_iso) VALUES (?, ?, ?)',
    );
    for (const row of snapshot.searchHistory as Record<string, unknown>[]) {
      insertSearch.run(
        workspaceId,
        String(row.query_text),
        String(row.searched_at_iso),
      );
    }

    const insertCfg = this.db.prepare(
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

    const insertPref = this.db.prepare(
      'INSERT INTO preferences (workspace_id, prefs_json) VALUES (?, ?)',
    );
    for (const row of snapshot.preferences as Record<string, unknown>[]) {
      insertPref.run(workspaceId, String(row.prefs_json));
    }
  }
}
