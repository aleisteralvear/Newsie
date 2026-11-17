import { DatabaseSync } from 'node:sqlite';
import {
  AppPreferences,
  Article,
  Category,
  NewsSource,
  SortOrder,
} from '../common/types';
import { DEFAULT_PREFERENCES } from '../preferences/themeManager';
import { DEFAULT_CATEGORIES } from '../../news/categories/defaultCategories';
import { SAMPLE_ARTICLES } from '../../news/articles/sampleArticles';
import { SAMPLE_SOURCES } from '../../sources/manager/sampleSources';
import { DEFAULT_WORKSPACE_ID } from './newsieDb';

export interface ArticlePageQuery {
  workspaceId: string;
  categoryIds?: string[];
  sourceIds?: string[];
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export interface ArticlePageResult {
  items: Article[];
  total: number;
  hasMore: boolean;
}

export interface ReadingHistoryEntry {
  id: number;
  articleId: string;
  publisher: string;
  title: string;
  openedAtIso: string;
  status: string;
}

export interface SavedFeedConfig {
  id: string;
  name: string;
  categoryIds: string[];
  sourceIds: string[];
  sortOrder: SortOrder;
}

export interface NewArticleRecord {
  id: string;
  sourceId: string;
  publisher: string;
  author?: string;
  categoryId: string;
  categoryName: string;
  title: string;
  description: string;
  excerpt: string;
  url: string;
  normalizedUrl: string;
  externalGuid?: string;
  fingerprint: string;
  imageUrl?: string;
  imageAlt: string;
  publishedAtIso: string;
  readTimeMinutes: number;
  keywords: string[];
}

export function formatRelativeTimeLabel(isoDate: string): string {
  const ts = Date.parse(isoDate);
  if (Number.isNaN(ts)) return 'Recent';
  const diffMin = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.round(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function mapArticleRow(row: Record<string, unknown>): Article {
  const publishedAtIso = String(row.published_at_iso);
  let keywords: string[] = [];
  try {
    keywords = JSON.parse(String(row.keywords_json || '[]'));
  } catch {
    keywords = [];
  }
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    publisher: String(row.publisher),
    author: row.author ? String(row.author) : undefined,
    categoryId: String(row.category_id),
    categoryName: String(row.category_name),
    title: String(row.title),
    description: String(row.description),
    excerpt: String(row.excerpt),
    url: String(row.url),
    imageUrl: row.image_url ? String(row.image_url) : undefined,
    imageAlt: String(row.image_alt || ''),
    publishedAtIso,
    publishedLabel: formatRelativeTimeLabel(publishedAtIso),
    readTimeMinutes: Number(row.read_time_minutes || 3),
    keywords,
    isBookmarked: Number(row.is_bookmarked) === 1,
  };
}

export class NewsieRepository {
  constructor(private readonly db: DatabaseSync) {}

  ensureWorkspaceInitialized(
    workspaceId: string = DEFAULT_WORKSPACE_ID,
    displayName: string = 'Main Edition',
    seedSampleContent: boolean = workspaceId === DEFAULT_WORKSPACE_ID,
  ): void {
    const existing = this.db
      .prepare('SELECT id FROM workspaces WHERE id = ?')
      .get(workspaceId);

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO workspaces (id, display_name, is_private, auth_method, created_at)
           VALUES (?, ?, ?, 'none', ?)`,
        )
        .run(
          workspaceId,
          displayName,
          workspaceId === DEFAULT_WORKSPACE_ID ? 0 : 1,
          new Date().toISOString(),
        );
    }

    const catCount = this.db
      .prepare('SELECT COUNT(*) as c FROM categories WHERE workspace_id = ?')
      .get(workspaceId) as { c: number };

    if (catCount.c === 0) {
      const insertCat = this.db.prepare(
        `INSERT INTO categories (id, workspace_id, name, enabled, is_custom, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const cat of DEFAULT_CATEGORIES) {
        insertCat.run(
          cat.id,
          workspaceId,
          cat.name,
          cat.enabled ? 1 : 0,
          cat.isCustom ? 1 : 0,
          cat.order,
        );
      }
    }

    const prefExisting = this.db
      .prepare('SELECT workspace_id FROM preferences WHERE workspace_id = ?')
      .get(workspaceId);
    if (!prefExisting) {
      this.db
        .prepare(
          'INSERT INTO preferences (workspace_id, prefs_json) VALUES (?, ?)',
        )
        .run(workspaceId, JSON.stringify(DEFAULT_PREFERENCES));
    }

    if (seedSampleContent) {
      const sourceCount = this.db
        .prepare('SELECT COUNT(*) as c FROM sources WHERE workspace_id = ?')
        .get(workspaceId) as { c: number };
      if (sourceCount.c === 0) {
        const insertSource = this.db.prepare(
          `INSERT INTO sources (id, workspace_id, name, url, format, category_id, enabled, description, last_fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const src of SAMPLE_SOURCES) {
          insertSource.run(
            src.id,
            workspaceId,
            src.name,
            src.url,
            src.format,
            src.categoryId,
            src.enabled ? 1 : 0,
            src.description,
            new Date().toISOString(),
          );
        }
      }

      const articleCount = this.db
        .prepare('SELECT COUNT(*) as c FROM articles WHERE workspace_id = ?')
        .get(workspaceId) as { c: number };
      if (articleCount.c === 0) {
        for (const art of SAMPLE_ARTICLES) {
          this.upsertArticle(workspaceId, {
            id: art.id,
            sourceId: art.sourceId,
            publisher: art.publisher,
            author: art.author,
            categoryId: art.categoryId,
            categoryName: art.categoryName,
            title: art.title,
            description: art.description,
            excerpt: art.excerpt,
            url: art.url,
            normalizedUrl: art.url.toLowerCase(),
            externalGuid: art.id,
            fingerprint: `${art.publisher.toLowerCase()}::${art.title.toLowerCase()}`,
            imageUrl: art.imageUrl,
            imageAlt: art.imageAlt,
            publishedAtIso: art.publishedAtIso,
            readTimeMinutes: art.readTimeMinutes,
            keywords: art.keywords,
          });
          if (art.isBookmarked) {
            this.setBookmark(workspaceId, art.id, true);
          }
        }
      }
    }
  }

  // Categories
  listCategories(workspaceId: string): Category[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, enabled, is_custom, sort_order
         FROM categories WHERE workspace_id = ? ORDER BY sort_order ASC`,
      )
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      enabled: Number(r.enabled) === 1,
      isCustom: Number(r.is_custom) === 1,
      order: Number(r.sort_order),
    }));
  }

  createCustomCategory(workspaceId: string, name: string): Category {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Category name cannot be empty.');
    const id = `custom-${trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}-${Date.now().toString(36)}`;
    const maxRow = this.db
      .prepare(
        'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM categories WHERE workspace_id = ?',
      )
      .get(workspaceId) as { max_order: number };
    const order = Number(maxRow.max_order) + 1;
    this.db
      .prepare(
        `INSERT INTO categories (id, workspace_id, name, enabled, is_custom, sort_order)
         VALUES (?, ?, ?, 1, 1, ?)`,
      )
      .run(id, workspaceId, trimmed, order);
    return { id, name: trimmed, enabled: true, isCustom: true, order };
  }

  renameCustomCategory(workspaceId: string, categoryId: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Category name cannot be empty.');
    this.db
      .prepare(
        'UPDATE categories SET name = ? WHERE workspace_id = ? AND id = ? AND is_custom = 1',
      )
      .run(trimmed, workspaceId, categoryId);
  }

  deleteCustomCategory(workspaceId: string, categoryId: string): void {
    this.db
      .prepare(
        'DELETE FROM categories WHERE workspace_id = ? AND id = ? AND is_custom = 1',
      )
      .run(workspaceId, categoryId);
  }

  setCategoryEnabled(workspaceId: string, categoryId: string, enabled: boolean): void {
    this.db
      .prepare(
        'UPDATE categories SET enabled = ? WHERE workspace_id = ? AND id = ?',
      )
      .run(enabled ? 1 : 0, workspaceId, categoryId);
  }

  reorderCategories(workspaceId: string, orderedIds: string[]): void {
    const stmt = this.db.prepare(
      'UPDATE categories SET sort_order = ? WHERE workspace_id = ? AND id = ?',
    );
    orderedIds.forEach((id, idx) => {
      stmt.run(idx + 1, workspaceId, id);
    });
  }

  // Sources
  listSources(workspaceId: string): NewsSource[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, url, format, category_id, enabled, description, last_fetched_at, last_error
         FROM sources WHERE workspace_id = ? ORDER BY rowid DESC`,
      )
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      url: String(r.url),
      format: (String(r.format) === 'Atom' ? 'Atom' : 'RSS') as 'RSS' | 'Atom',
      categoryId: String(r.category_id),
      enabled: Number(r.enabled) === 1,
      description: String(r.description || ''),
      lastUpdatedLabel: r.last_error
        ? `Error: ${String(r.last_error)}`
        : r.last_fetched_at
          ? `Updated ${formatRelativeTimeLabel(String(r.last_fetched_at))}`
          : 'Never synced',
    }));
  }

  getSourceById(workspaceId: string, sourceId: string): (NewsSource & { etag?: string; lastModified?: string }) | null {
    const row = this.db
      .prepare(
        `SELECT id, name, url, format, category_id, enabled, description, etag, last_modified, last_fetched_at, last_error
         FROM sources WHERE workspace_id = ? AND id = ?`,
      )
      .get(workspaceId, sourceId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      name: String(row.name),
      url: String(row.url),
      format: (String(row.format) === 'Atom' ? 'Atom' : 'RSS') as 'RSS' | 'Atom',
      categoryId: String(row.category_id),
      enabled: Number(row.enabled) === 1,
      description: String(row.description || ''),
      etag: row.etag ? String(row.etag) : undefined,
      lastModified: row.last_modified ? String(row.last_modified) : undefined,
      lastUpdatedLabel: row.last_fetched_at
        ? `Updated ${formatRelativeTimeLabel(String(row.last_fetched_at))}`
        : 'Never synced',
    };
  }

  addSource(
    workspaceId: string,
    source: Omit<NewsSource, 'lastUpdatedLabel'> & {
      etag?: string;
      lastModified?: string;
      lastFetchedAt?: string;
    },
  ): NewsSource {
    this.db
      .prepare(
        `INSERT INTO sources (id, workspace_id, name, url, format, category_id, enabled, description, etag, last_modified, last_fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        source.id,
        workspaceId,
        source.name,
        source.url,
        source.format,
        source.categoryId,
        source.enabled ? 1 : 0,
        source.description,
        source.etag ?? null,
        source.lastModified ?? null,
        source.lastFetchedAt ?? null,
      );
    return {
      ...source,
      lastUpdatedLabel: source.lastFetchedAt
        ? `Updated ${formatRelativeTimeLabel(source.lastFetchedAt)}`
        : 'Added just now',
    };
  }

  updateSource(
    workspaceId: string,
    sourceId: string,
    patch: Partial<Pick<NewsSource, 'name' | 'categoryId' | 'enabled' | 'description'>>,
  ): void {
    const current = this.getSourceById(workspaceId, sourceId);
    if (!current) return;
    this.db
      .prepare(
        `UPDATE sources SET name = ?, category_id = ?, enabled = ?, description = ?
         WHERE workspace_id = ? AND id = ?`,
      )
      .run(
        patch.name ?? current.name,
        patch.categoryId ?? current.categoryId,
        (patch.enabled ?? current.enabled) ? 1 : 0,
        patch.description ?? current.description,
        workspaceId,
        sourceId,
      );
  }

  updateSourceFetchStatus(
    workspaceId: string,
    sourceId: string,
    status: {
      etag?: string | null;
      lastModified?: string | null;
      lastFetchedAt?: string;
      lastError?: string | null;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE sources
         SET etag = COALESCE(?, etag),
             last_modified = COALESCE(?, last_modified),
             last_fetched_at = COALESCE(?, last_fetched_at),
             last_error = ?
         WHERE workspace_id = ? AND id = ?`,
      )
      .run(
        status.etag ?? null,
        status.lastModified ?? null,
        status.lastFetchedAt ?? null,
        status.lastError ?? null,
        workspaceId,
        sourceId,
      );
  }

  removeSource(workspaceId: string, sourceId: string): void {
    this.db
      .prepare('DELETE FROM articles WHERE workspace_id = ? AND source_id = ?')
      .run(workspaceId, sourceId);
    this.db
      .prepare('DELETE FROM sources WHERE workspace_id = ? AND id = ?')
      .run(workspaceId, sourceId);
  }

  // Articles + Deduplication + Pagination
  upsertArticle(workspaceId: string, article: NewArticleRecord): { inserted: boolean } {
    const existing = this.db
      .prepare(
        `SELECT id FROM articles
         WHERE workspace_id = ?
           AND (
             normalized_url = ?
             OR (external_guid IS NOT NULL AND external_guid = ? AND source_id = ?)
             OR fingerprint = ?
           )
         LIMIT 1`,
      )
      .get(
        workspaceId,
        article.normalizedUrl,
        article.externalGuid ?? '',
        article.sourceId,
        article.fingerprint,
      ) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE articles
           SET title = ?, description = ?, excerpt = ?, image_url = COALESCE(?, image_url), published_at_iso = ?
           WHERE workspace_id = ? AND id = ?`,
        )
        .run(
          article.title,
          article.description,
          article.excerpt,
          article.imageUrl ?? null,
          article.publishedAtIso,
          workspaceId,
          existing.id,
        );
      return { inserted: false };
    }

    this.db
      .prepare(
        `INSERT INTO articles (
          id, workspace_id, source_id, publisher, author, category_id, category_name,
          title, description, excerpt, url, normalized_url, external_guid, fingerprint,
          image_url, image_alt, published_at_iso, read_time_minutes, keywords_json,
          is_bookmarked, created_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        article.id,
        workspaceId,
        article.sourceId,
        article.publisher,
        article.author ?? null,
        article.categoryId,
        article.categoryName,
        article.title,
        article.description,
        article.excerpt,
        article.url,
        article.normalizedUrl,
        article.externalGuid ?? null,
        article.fingerprint,
        article.imageUrl ?? null,
        article.imageAlt,
        article.publishedAtIso,
        article.readTimeMinutes,
        JSON.stringify(article.keywords),
        new Date().toISOString(),
      );
    return { inserted: true };
  }

  queryArticlesPage(query: ArticlePageQuery): ArticlePageResult {
    const conditions: string[] = [
      'a.workspace_id = ?',
      's.enabled = 1',
      'c.enabled = 1',
    ];
    const params: (string | number)[] = [query.workspaceId];

    if (query.categoryIds && query.categoryIds.length > 0 && !query.categoryIds.includes('all')) {
      const placeholders = query.categoryIds.map(() => '?').join(',');
      conditions.push(`a.category_id IN (${placeholders})`);
      params.push(...query.categoryIds);
    }

    if (query.sourceIds && query.sourceIds.length > 0) {
      const placeholders = query.sourceIds.map(() => '?').join(',');
      conditions.push(`a.source_id IN (${placeholders})`);
      params.push(...query.sourceIds);
    }

    const whereSql = conditions.join(' AND ');

    let orderSql = 'a.published_at_iso DESC';
    if (query.sortOrder === 'oldest') orderSql = 'a.published_at_iso ASC';
    else if (query.sortOrder === 'publisher') orderSql = 'a.publisher ASC, a.published_at_iso DESC';
    else if (query.sortOrder === 'category') orderSql = 'a.category_name ASC, a.published_at_iso DESC';

    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) as total
         FROM articles a
         JOIN sources s ON s.workspace_id = a.workspace_id AND s.id = a.source_id
         LEFT JOIN categories c ON c.workspace_id = a.workspace_id AND c.id = a.category_id
         WHERE ${whereSql}`,
      )
      .get(...params) as { total: number };

    const rows = this.db
      .prepare(
        `SELECT a.*
         FROM articles a
         JOIN sources s ON s.workspace_id = a.workspace_id AND s.id = a.source_id
         LEFT JOIN categories c ON c.workspace_id = a.workspace_id AND c.id = a.category_id
         WHERE ${whereSql}
         ORDER BY ${orderSql}
         LIMIT ? OFFSET ?`,
      )
      .all(...params, query.limit, query.offset) as Record<string, unknown>[];

    const total = Number(countRow.total);
    return {
      items: rows.map(mapArticleRow),
      total,
      hasMore: query.offset + rows.length < total,
    };
  }

  searchArticles(
    workspaceId: string,
    rawQuery: string,
    scope: 'cached' | 'selected_sources' | 'all_enabled' = 'cached',
    selectedSourceIds: string[] = [],
  ): Article[] {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean);

    const conditions = ['a.workspace_id = ?'];
    const params: (string | number)[] = [workspaceId];

    if (scope === 'all_enabled') {
      conditions.push('s.enabled = 1');
    } else if (scope === 'selected_sources' && selectedSourceIds.length > 0) {
      conditions.push(`a.source_id IN (${selectedSourceIds.map(() => '?').join(',')})`);
      params.push(...selectedSourceIds);
    }

    for (const term of terms) {
      const like = `%${term}%`;
      conditions.push(
        '(LOWER(a.title) LIKE ? OR LOWER(a.description) LIKE ? OR LOWER(a.publisher) LIKE ? OR LOWER(a.category_name) LIKE ? OR LOWER(a.keywords_json) LIKE ?)',
      );
      params.push(like, like, like, like, like);
    }

    const rows = this.db
      .prepare(
        `SELECT a.*
         FROM articles a
         LEFT JOIN sources s ON s.workspace_id = a.workspace_id AND s.id = a.source_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY a.published_at_iso DESC
         LIMIT 80`,
      )
      .all(...params) as Record<string, unknown>[];

    return rows.map(mapArticleRow);
  }

  listBookmarkedArticles(workspaceId: string, sortOrder: SortOrder = 'newest'): Article[] {
    let orderSql = 'published_at_iso DESC';
    if (sortOrder === 'oldest') orderSql = 'published_at_iso ASC';
    else if (sortOrder === 'publisher') orderSql = 'publisher ASC, published_at_iso DESC';
    else if (sortOrder === 'category') orderSql = 'category_name ASC, published_at_iso DESC';

    const rows = this.db
      .prepare(
        `SELECT * FROM articles WHERE workspace_id = ? AND is_bookmarked = 1 ORDER BY ${orderSql}`,
      )
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map(mapArticleRow);
  }

  setBookmark(workspaceId: string, articleId: string, bookmarked: boolean): void {
    this.db
      .prepare(
        `UPDATE articles
         SET is_bookmarked = ?, bookmarked_at_iso = ?
         WHERE workspace_id = ? AND id = ?`,
      )
      .run(
        bookmarked ? 1 : 0,
        bookmarked ? new Date().toISOString() : null,
        workspaceId,
        articleId,
      );
  }

  // Reading & Search History
  recordReadingHistory(
    workspaceId: string,
    article: { id: string; publisher: string; title: string },
  ): void {
    this.db
      .prepare(
        `INSERT INTO reading_history (workspace_id, article_id, publisher, title, opened_at_iso, status)
         VALUES (?, ?, ?, ?, ?, 'opened')`,
      )
      .run(
        workspaceId,
        article.id,
        article.publisher,
        article.title,
        new Date().toISOString(),
      );
  }

  listReadingHistory(workspaceId: string, limit = 30): ReadingHistoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, article_id, publisher, title, opened_at_iso, status
         FROM reading_history WHERE workspace_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(workspaceId, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      articleId: String(r.article_id),
      publisher: String(r.publisher),
      title: String(r.title),
      openedAtIso: String(r.opened_at_iso),
      status: String(r.status),
    }));
  }

  clearReadingHistory(workspaceId: string): void {
    this.db
      .prepare('DELETE FROM reading_history WHERE workspace_id = ?')
      .run(workspaceId);
  }

  addSearchHistory(workspaceId: string, queryText: string): void {
    const trimmed = queryText.trim();
    if (!trimmed) return;
    this.db
      .prepare(
        `INSERT INTO search_history (workspace_id, query_text, searched_at_iso)
         VALUES (?, ?, ?)
         ON CONFLICT(workspace_id, query_text) DO UPDATE SET searched_at_iso = excluded.searched_at_iso`,
      )
      .run(workspaceId, trimmed, new Date().toISOString());
  }

  listSearchHistory(workspaceId: string, limit = 10): string[] {
    const rows = this.db
      .prepare(
        `SELECT query_text FROM search_history
         WHERE workspace_id = ? ORDER BY searched_at_iso DESC LIMIT ?`,
      )
      .all(workspaceId, limit) as { query_text: string }[];
    return rows.map((r) => r.query_text);
  }

  clearSearchHistory(workspaceId: string): void {
    this.db
      .prepare('DELETE FROM search_history WHERE workspace_id = ?')
      .run(workspaceId);
  }

  // Saved Feed Configs
  listFeedConfigs(workspaceId: string): SavedFeedConfig[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, category_ids_json, source_ids_json, sort_order FROM saved_feed_configs WHERE workspace_id = ?',
      )
      .all(workspaceId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      categoryIds: JSON.parse(String(r.category_ids_json)),
      sourceIds: JSON.parse(String(r.source_ids_json)),
      sortOrder: String(r.sort_order) as SortOrder,
    }));
  }

  saveFeedConfig(workspaceId: string, cfg: SavedFeedConfig): void {
    this.db
      .prepare(
        `INSERT INTO saved_feed_configs (id, workspace_id, name, category_ids_json, source_ids_json, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, id) DO UPDATE SET
           name = excluded.name,
           category_ids_json = excluded.category_ids_json,
           source_ids_json = excluded.source_ids_json,
           sort_order = excluded.sort_order`,
      )
      .run(
        cfg.id,
        workspaceId,
        cfg.name,
        JSON.stringify(cfg.categoryIds),
        JSON.stringify(cfg.sourceIds),
        cfg.sortOrder,
      );
  }

  deleteFeedConfig(workspaceId: string, id: string): void {
    this.db
      .prepare('DELETE FROM saved_feed_configs WHERE workspace_id = ? AND id = ?')
      .run(workspaceId, id);
  }

  // Preferences
  getPreferences(workspaceId: string): AppPreferences {
    const row = this.db
      .prepare('SELECT prefs_json FROM preferences WHERE workspace_id = ?')
      .get(workspaceId) as { prefs_json: string } | undefined;
    if (!row) return { ...DEFAULT_PREFERENCES };
    try {
      return { ...DEFAULT_PREFERENCES, ...JSON.parse(row.prefs_json) };
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  updatePreferences(
    workspaceId: string,
    patch: Partial<AppPreferences>,
  ): AppPreferences {
    const merged = { ...this.getPreferences(workspaceId), ...patch };
    this.db
      .prepare(
        `INSERT INTO preferences (workspace_id, prefs_json) VALUES (?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET prefs_json = excluded.prefs_json`,
      )
      .run(workspaceId, JSON.stringify(merged));
    return merged;
  }
}
