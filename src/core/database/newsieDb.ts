import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_WORKSPACE_ID = 'default';

export function createDatabase(dbPath?: string): DatabaseSync {
  const resolvedPath = dbPath ?? path.resolve(process.cwd(), 'data', 'newsie.db');
  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      auth_method TEXT NOT NULL DEFAULT 'none',
      password_hash TEXT,
      salt TEXT,
      wrapped_key TEXT,
      key_iv TEXT,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until_ms INTEGER NOT NULL DEFAULT 0,
      auto_lock_minutes INTEGER NOT NULL DEFAULT 5,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_custom INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (workspace_id, id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      format TEXT NOT NULL,
      category_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      description TEXT NOT NULL DEFAULT '',
      etag TEXT,
      last_modified TEXT,
      last_fetched_at TEXT,
      last_error TEXT,
      PRIMARY KEY (workspace_id, id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      publisher TEXT NOT NULL,
      author TEXT,
      category_id TEXT NOT NULL,
      category_name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      url TEXT NOT NULL,
      normalized_url TEXT NOT NULL,
      external_guid TEXT,
      fingerprint TEXT NOT NULL,
      image_url TEXT,
      image_alt TEXT NOT NULL DEFAULT '',
      published_at_iso TEXT NOT NULL,
      read_time_minutes INTEGER NOT NULL DEFAULT 3,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      is_bookmarked INTEGER NOT NULL DEFAULT 0,
      bookmarked_at_iso TEXT,
      created_at_iso TEXT NOT NULL,
      PRIMARY KEY (workspace_id, id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_articles_ws_pub ON articles(workspace_id, published_at_iso DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_ws_cat ON articles(workspace_id, category_id, published_at_iso DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_ws_url ON articles(workspace_id, normalized_url);
    CREATE INDEX IF NOT EXISTS idx_articles_ws_fp ON articles(workspace_id, fingerprint);

    CREATE TABLE IF NOT EXISTS reading_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      article_id TEXT NOT NULL,
      publisher TEXT NOT NULL,
      title TEXT NOT NULL,
      opened_at_iso TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'opened',
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      query_text TEXT NOT NULL,
      searched_at_iso TEXT NOT NULL,
      UNIQUE(workspace_id, query_text),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saved_feed_configs (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category_ids_json TEXT NOT NULL,
      source_ids_json TEXT NOT NULL,
      sort_order TEXT NOT NULL,
      PRIMARY KEY (workspace_id, id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS preferences (
      workspace_id TEXT PRIMARY KEY,
      prefs_json TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS encrypted_workspace_blobs (
      workspace_id TEXT PRIMARY KEY,
      iv TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      updated_at_iso TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
  `);

  return db;
}
