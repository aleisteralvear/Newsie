import crypto from 'node:crypto';
import { NewsieRepository } from '../../core/database/repositories';
import { assertSafePublicUrl, UnsafeUrlError } from '../../core/security/urlGuard';
import { computeArticleFingerprint } from '../engine/normalizer';
import { FeedParseError, ParsedFeedResult, parseFeedXml } from '../parser/feedParser';

export interface FetchFeedResult {
  status: 'updated' | 'not_modified';
  etag?: string | null;
  lastModified?: string | null;
  parsed?: ParsedFeedResult;
}

export class FeedFetchError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_URL'
      | 'SSRF_BLOCKED'
      | 'AUTH_REQUIRED'
      | 'SERVER_ERROR'
      | 'NETWORK_FAILURE'
      | 'EMPTY_FEED'
      | 'INVALID_XML'
      | 'UNSUPPORTED_FORMAT'
      | 'XXE_REJECTED',
    message: string,
  ) {
    super(message);
    this.name = 'FeedFetchError';
  }
}

export async function fetchAndParseFeed(
  rawUrl: string,
  conditional?: { etag?: string; lastModified?: string },
): Promise<FetchFeedResult> {
  let safeUrl: URL;
  try {
    safeUrl = await assertSafePublicUrl(rawUrl);
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      throw new FeedFetchError(err.code, err.message);
    }
    throw new FeedFetchError('INVALID_URL', 'Invalid feed URL.');
  }

  const headers: Record<string, string> = {
    'User-Agent': 'Newsie/1.0 (+editorial-reader)',
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9',
  };
  if (conditional?.etag) headers['If-None-Match'] = conditional.etag;
  if (conditional?.lastModified) headers['If-Modified-Since'] = conditional.lastModified;

  let response: Response;
  try {
    response = await fetch(safeUrl.toString(), {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new FeedFetchError(
      'NETWORK_FAILURE',
      'Unable to reach publisher server before timeout.',
    );
  }

  // Re-validate final redirect destination to block redirect-based SSRF
  if (response.url) {
    try {
      await assertSafePublicUrl(response.url);
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        throw new FeedFetchError(err.code, 'Redirect target blocked for security.');
      }
    }
  }

  if (response.status === 304) {
    return {
      status: 'not_modified',
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    };
  }

  if (response.status === 401 || response.status === 403) {
    throw new FeedFetchError(
      'AUTH_REQUIRED',
      'Publisher requires authentication or blocked automated feed retrieval.',
    );
  }

  if (!response.ok) {
    throw new FeedFetchError(
      'SERVER_ERROR',
      `Publisher returned HTTP ${response.status}.`,
    );
  }

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) {
    throw new FeedFetchError(
      'UNSUPPORTED_FORMAT',
      'Feed payload exceeded maximum allowed 2 MB size.',
    );
  }

  try {
    const parsed = parseFeedXml(text, safeUrl.origin);
    return {
      status: 'updated',
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      parsed,
    };
  } catch (err) {
    if (err instanceof FeedParseError) {
      throw new FeedFetchError(err.code, err.message);
    }
    throw new FeedFetchError('INVALID_XML', 'Could not parse feed XML.');
  }
}

export interface SyncWorkspaceReport {
  checkedSources: number;
  updatedSources: number;
  insertedArticles: number;
  errors: { sourceId: string; sourceName: string; message: string }[];
  syncedAtIso: string;
}

export async function syncWorkspaceFeeds(
  repo: NewsieRepository,
  workspaceId: string,
): Promise<SyncWorkspaceReport> {
  const categories = repo.listCategories(workspaceId);
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const enabledSources = repo
    .listSources(workspaceId)
    .filter((s) => s.enabled && !s.url.includes('.example/'));

  let updatedSources = 0;
  let insertedArticles = 0;
  const errors: SyncWorkspaceReport['errors'] = [];

  for (const src of enabledSources) {
    const fullSrc = repo.getSourceById(workspaceId, src.id);
    try {
      const result = await fetchAndParseFeed(src.url, {
        etag: fullSrc?.etag,
        lastModified: fullSrc?.lastModified,
      });

      const nowIso = new Date().toISOString();
      if (result.status === 'not_modified') {
        repo.updateSourceFetchStatus(workspaceId, src.id, {
          etag: result.etag,
          lastModified: result.lastModified,
          lastFetchedAt: nowIso,
          lastError: null,
        });
        continue;
      }

      if (result.parsed) {
        updatedSources++;
        const categoryName = categoryNameById.get(src.categoryId) ?? 'World';
        for (const item of result.parsed.articles) {
          const fp = computeArticleFingerprint(
            src.name,
            item.title,
            item.normalizedUrl,
          );
          const { inserted } = repo.upsertArticle(workspaceId, {
            id: `art-${crypto.randomUUID().slice(0, 12)}`,
            sourceId: src.id,
            publisher: src.name,
            author: item.author,
            categoryId: src.categoryId,
            categoryName,
            title: item.title,
            description: item.description,
            excerpt: item.excerpt,
            url: item.url,
            normalizedUrl: item.normalizedUrl,
            externalGuid: item.guid,
            fingerprint: fp,
            imageUrl: item.imageUrl,
            imageAlt: item.title,
            publishedAtIso: item.publishedAtIso,
            readTimeMinutes: item.readTimeMinutes,
            keywords: item.keywords,
          });
          if (inserted) insertedArticles++;
        }

        repo.updateSourceFetchStatus(workspaceId, src.id, {
          etag: result.etag,
          lastModified: result.lastModified,
          lastFetchedAt: nowIso,
          lastError: null,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Feed sync failed.';
      repo.updateSourceFetchStatus(workspaceId, src.id, {
        lastError: msg,
      });
      errors.push({ sourceId: src.id, sourceName: src.name, message: msg });
    }
  }

  return {
    checkedSources: enabledSources.length,
    updatedSources,
    insertedArticles,
    errors,
    syncedAtIso: new Date().toISOString(),
  };
}
