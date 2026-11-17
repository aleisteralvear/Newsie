import crypto from 'node:crypto';
import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createDatabase, DEFAULT_WORKSPACE_ID } from './src/core/database/newsieDb';
import { NewsieRepository } from './src/core/database/repositories';
import { SortOrder } from './src/core/common/types';
import {
  fetchAndParseFeed,
  syncWorkspaceFeeds,
} from './src/news/feeds/aggregator';
import { computeArticleFingerprint } from './src/news/engine/normalizer';
import { SOURCE_DIRECTORY } from './src/sources/discovery/sourceDirectory';
import { validateAndPreviewFeed } from './src/sources/validation/sourceValidator';
import { exportSourcesToOpml, parseOpmlXml } from './src/sources/manager/opml';
import {
  WorkspaceAuthError,
  WorkspaceManager,
} from './src/workspace/manager/workspaceManager';

function resolveWorkspaceContext(req: Request): {
  workspaceId: string;
  sessionToken?: string;
} {
  const fromQuery = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  const fromBody =
    req.body && typeof req.body.workspaceId === 'string' ? req.body.workspaceId : undefined;
  const workspaceId = fromBody || fromQuery || DEFAULT_WORKSPACE_ID;
  const headerToken = req.header('x-workspace-session');
  return { workspaceId, sessionToken: headerToken || undefined };
}

function handleAuthError(res: Response, err: unknown) {
  if (err instanceof WorkspaceAuthError) {
    return res.status(err.statusCode).json({
      error: err.message,
      retryAfterSeconds: err.retryAfterSeconds,
    });
  }
  return res.status(400).json({ error: (err as Error).message });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const db = createDatabase();
  const repo = new NewsieRepository(db);
  repo.ensureWorkspaceInitialized(DEFAULT_WORKSPACE_ID);
  const workspaceManager = new WorkspaceManager(db, repo);

  const requireWorkspaceAccess = (req: Request, res: Response): string | null => {
    const { workspaceId, sessionToken } = resolveWorkspaceContext(req);
    try {
      workspaceManager.assertAuthorizedAccess(workspaceId, sessionToken);
      return workspaceId;
    } catch (err) {
      handleAuthError(res, err);
      return null;
    }
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Workspaces Management
  app.get('/api/workspaces', (_req, res) => {
    res.json({ workspaces: workspaceManager.listWorkspaces() });
  });

  app.post('/api/workspaces', async (req, res) => {
    try {
      const result = await workspaceManager.createPrivateWorkspace({
        displayName: String(req.body.displayName || ''),
        passphrase: String(req.body.passphrase || ''),
        authMethod: req.body.authMethod,
        autoLockMinutes:
          typeof req.body.autoLockMinutes === 'number'
            ? req.body.autoLockMinutes
            : 5,
      });
      res.status(201).json({
        ...result,
        workspaces: workspaceManager.listWorkspaces(),
      });
    } catch (err) {
      handleAuthError(res, err);
    }
  });

  app.post('/api/workspaces/:id/unlock', async (req, res) => {
    try {
      const result = await workspaceManager.unlockWorkspace(
        req.params.id,
        String(req.body.passphrase || ''),
      );
      res.json({
        ...result,
        workspaces: workspaceManager.listWorkspaces(),
      });
    } catch (err) {
      handleAuthError(res, err);
    }
  });

  app.post('/api/workspaces/:id/lock', (req, res) => {
    const ws = requireWorkspaceContextMatchesParam(req, res, workspaceManager);
    if (!ws) return;
    workspaceManager.lockWorkspace(ws);
    res.json({ workspaces: workspaceManager.listWorkspaces() });
  });

  app.patch('/api/workspaces/:id', (req, res) => {
    const ws = requireWorkspaceContextMatchesParam(req, res, workspaceManager);
    if (!ws) return;
    try {
      if (typeof req.body.displayName === 'string') {
        workspaceManager.renameWorkspace(ws, req.body.displayName);
      }
      if (req.body.authMethod || typeof req.body.autoLockMinutes === 'number') {
        workspaceManager.updateWorkspaceSettings(ws, {
          authMethod: req.body.authMethod,
          autoLockMinutes: req.body.autoLockMinutes,
        });
      }
      res.json({ workspaces: workspaceManager.listWorkspaces() });
    } catch (err) {
      handleAuthError(res, err);
    }
  });

  app.delete('/api/workspaces/:id', (req, res) => {
    const ws = requireWorkspaceContextMatchesParam(req, res, workspaceManager);
    if (!ws) return;
    try {
      workspaceManager.deleteWorkspace(ws);
      res.json({ workspaces: workspaceManager.listWorkspaces() });
    } catch (err) {
      handleAuthError(res, err);
    }
  });

  // Sync & Discovery
  app.post('/api/sync', async (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    try {
      const report = await syncWorkspaceFeeds(repo, ws);
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/directory', (_req, res) => {
    res.json({ directory: SOURCE_DIRECTORY });
  });

  // Categories
  app.get('/api/categories', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    res.json({ categories: repo.listCategories(ws) });
  });

  app.post('/api/categories', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    try {
      const created = repo.createCustomCategory(ws, String(req.body.name || ''));
      res.status(201).json({ category: created, categories: repo.listCategories(ws) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/categories/reorder', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds.map(String) : [];
    repo.reorderCategories(ws, orderedIds);
    res.json({ categories: repo.listCategories(ws) });
  });

  app.patch('/api/categories/:id', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    if (typeof req.body.enabled === 'boolean') {
      repo.setCategoryEnabled(ws, req.params.id, req.body.enabled);
    }
    if (typeof req.body.name === 'string') {
      repo.renameCustomCategory(ws, req.params.id, req.body.name);
    }
    res.json({ categories: repo.listCategories(ws) });
  });

  app.delete('/api/categories/:id', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    repo.deleteCustomCategory(ws, req.params.id);
    res.json({ categories: repo.listCategories(ws) });
  });

  // Sources
  app.get('/api/sources', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    res.json({ sources: repo.listSources(ws) });
  });

  app.post('/api/sources/validate', async (req, res) => {
    const url = String(req.body.url || '');
    const preview = await validateAndPreviewFeed(url);
    res.status(preview.valid ? 200 : 400).json({
      ...preview,
      error: preview.valid ? undefined : preview.errorMessage,
    });
  });

  app.post('/api/sources', async (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    try {
      const url = String(req.body.url || '').trim();
      const name = String(req.body.name || '').trim();
      const categoryId = String(req.body.categoryId || 'world');
      const format = (req.body.format === 'Atom' ? 'Atom' : 'RSS') as 'RSS' | 'Atom';
      const description = String(req.body.description || '');
      const skipNetwork = Boolean(req.body.skipNetwork);

      const sourceId = `src-${crypto.randomUUID().slice(0, 10)}`;
      let finalName = name || new URL(url).hostname.replace(/^www\./, '');
      let finalFormat = format;
      let finalDesc = description;
      let etag: string | undefined;
      let lastModified: string | undefined;
      let fetchedAt: string | undefined;

      if (!skipNetwork) {
        const fetched = await fetchAndParseFeed(url);
        if (fetched.parsed) {
          finalName = name || fetched.parsed.title;
          finalFormat = fetched.parsed.format;
          finalDesc = description || fetched.parsed.description;
          etag = fetched.etag ?? undefined;
          lastModified = fetched.lastModified ?? undefined;
          fetchedAt = new Date().toISOString();

          repo.addSource(ws, {
            id: sourceId,
            name: finalName,
            url,
            format: finalFormat,
            categoryId,
            enabled: true,
            description: finalDesc,
            etag,
            lastModified,
            lastFetchedAt: fetchedAt,
          });

          const catName =
            repo.listCategories(ws).find((c) => c.id === categoryId)?.name ?? 'World';
          for (const item of fetched.parsed.articles) {
            repo.upsertArticle(ws, {
              id: `art-${crypto.randomUUID().slice(0, 12)}`,
              sourceId,
              publisher: finalName,
              author: item.author,
              categoryId,
              categoryName: catName,
              title: item.title,
              description: item.description,
              excerpt: item.excerpt,
              url: item.url,
              normalizedUrl: item.normalizedUrl,
              externalGuid: item.guid,
              fingerprint: computeArticleFingerprint(
                finalName,
                item.title,
                item.normalizedUrl,
              ),
              imageUrl: item.imageUrl,
              imageAlt: item.title,
              publishedAtIso: item.publishedAtIso,
              readTimeMinutes: item.readTimeMinutes,
              keywords: item.keywords,
            });
          }

          return res.status(201).json({ sources: repo.listSources(ws) });
        }
      }

      repo.addSource(ws, {
        id: sourceId,
        name: finalName,
        url,
        format: finalFormat,
        categoryId,
        enabled: true,
        description: finalDesc,
      });
      return res.status(201).json({ sources: repo.listSources(ws) });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/sources/:id/test', async (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    const src = repo.getSourceById(ws, req.params.id);
    if (!src) return res.status(404).json({ error: 'Source not found.' });
    if (src.url.includes('.example/')) {
      return res.json({
        valid: true,
        url: src.url,
        format: src.format,
        title: src.name,
        articleCount: 1,
      });
    }
    const preview = await validateAndPreviewFeed(src.url);
    repo.updateSourceFetchStatus(ws, src.id, {
      lastFetchedAt: preview.valid ? new Date().toISOString() : undefined,
      lastError: preview.valid ? null : preview.errorMessage ?? 'Feed check failed.',
    });
    return res.status(preview.valid ? 200 : 400).json(preview);
  });

  app.get('/api/opml/export', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    const xml = exportSourcesToOpml(repo.listSources(ws), repo.listCategories(ws));
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="newsie-subscriptions.opml"');
    res.send(xml);
  });

  app.post('/api/opml/import', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    try {
      const opmlXml = String(req.body.opmlXml || '');
      const entries = parseOpmlXml(opmlXml);
      const existingUrls = new Set(
        repo.listSources(ws).map((s) => s.url.toLowerCase()),
      );
      const categories = repo.listCategories(ws);

      let added = 0;
      for (const entry of entries) {
        if (existingUrls.has(entry.url.toLowerCase())) continue;
        const matchedCat = entry.categoryName
          ? categories.find(
              (c) => c.name.toLowerCase() === entry.categoryName?.toLowerCase(),
            )
          : undefined;
        repo.addSource(ws, {
          id: `src-${crypto.randomUUID().slice(0, 10)}`,
          name: entry.name,
          url: entry.url,
          format: entry.url.toLowerCase().includes('atom') ? 'Atom' : 'RSS',
          categoryId: matchedCat?.id ?? 'world',
          enabled: true,
          description: 'Imported via OPML subscription file.',
        });
        existingUrls.add(entry.url.toLowerCase());
        added++;
      }

      res.json({ importedCount: added, sources: repo.listSources(ws) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/sources/:id', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    repo.updateSource(ws, req.params.id, {
      enabled: typeof req.body.enabled === 'boolean' ? req.body.enabled : undefined,
      name: typeof req.body.name === 'string' ? req.body.name : undefined,
      categoryId: typeof req.body.categoryId === 'string' ? req.body.categoryId : undefined,
    });
    res.json({ sources: repo.listSources(ws) });
  });

  app.delete('/api/sources/:id', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    repo.removeSource(ws, req.params.id);
    res.json({ sources: repo.listSources(ws) });
  });

  // Articles, Bookmarks, Search, Preferences, Presets, History
  app.get('/api/articles', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    const categoryIds = req.query.categories
      ? String(req.query.categories).split(',').filter(Boolean)
      : undefined;
    const sourceIds = req.query.sources
      ? String(req.query.sources).split(',').filter(Boolean)
      : undefined;
    const sortOrder = (req.query.sort as SortOrder) || 'newest';
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    const page = repo.queryArticlesPage({
      workspaceId: ws,
      categoryIds,
      sourceIds,
      sortOrder,
      limit,
      offset,
    });
    res.json(page);
  });

  app.post('/api/articles/:id/bookmark', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    const bookmarked = Boolean(req.body.bookmarked);
    repo.setBookmark(ws, req.params.id, bookmarked);
    res.json({ ok: true, bookmarked });
  });

  app.get('/api/bookmarks', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    const sortOrder = (req.query.sort as SortOrder) || 'newest';
    res.json({ items: repo.listBookmarkedArticles(ws, sortOrder) });
  });

  app.get('/api/search', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    const q = String(req.query.q || '');
    const scope = String(req.query.scope || 'cached') as
      | 'cached'
      | 'selected_sources'
      | 'all_enabled';
    const sourceIds = req.query.sources
      ? String(req.query.sources).split(',').filter(Boolean)
      : [];
    const items = repo.searchArticles(ws, q, scope, sourceIds);
    res.json({ items });
  });

  app.get('/api/search/history', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    res.json({ history: repo.listSearchHistory(ws) });
  });

  app.post('/api/search/history', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    repo.addSearchHistory(ws, String(req.body.query || ''));
    res.json({ history: repo.listSearchHistory(ws) });
  });

  app.delete('/api/search/history', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    repo.clearSearchHistory(ws);
    res.json({ history: [] });
  });

  app.get('/api/preferences', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    res.json({ preferences: repo.getPreferences(ws) });
  });

  app.patch('/api/preferences', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    const preferences = repo.updatePreferences(ws, req.body.patch || {});
    res.json({ preferences });
  });

  app.get('/api/feed-configs', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    res.json({ configs: repo.listFeedConfigs(ws) });
  });

  app.post('/api/feed-configs', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    const id = String(req.body.id || `cfg-${crypto.randomUUID().slice(0, 8)}`);
    repo.saveFeedConfig(ws, {
      id,
      name: String(req.body.name || 'Saved View'),
      categoryIds: Array.isArray(req.body.categoryIds)
        ? req.body.categoryIds.map(String)
        : [],
      sourceIds: Array.isArray(req.body.sourceIds)
        ? req.body.sourceIds.map(String)
        : [],
      sortOrder: (req.body.sortOrder as SortOrder) || 'newest',
    });
    res.status(201).json({ configs: repo.listFeedConfigs(ws) });
  });

  app.delete('/api/feed-configs/:id', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    repo.deleteFeedConfig(ws, req.params.id);
    res.json({ configs: repo.listFeedConfigs(ws) });
  });

  app.get('/api/reading-history', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    res.json({ entries: repo.listReadingHistory(ws) });
  });

  app.post('/api/reading-history', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    repo.recordReadingHistory(ws, {
      id: String(req.body.articleId || ''),
      publisher: String(req.body.publisher || ''),
      title: String(req.body.title || ''),
    });
    res.status(201).json({ entries: repo.listReadingHistory(ws) });
  });

  app.delete('/api/reading-history', (req, res) => {
    const ws = requireWorkspaceAccess(req, res);
    if (!ws) return;
    repo.clearReadingHistory(ws);
    res.json({ entries: [] });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });

    // HMR is intentionally disabled in this runtime; keep @vite/client exports intact
    // (updateStyle, createHotContext, injectQuery) while skipping the failing WS connect.
    app.get('/@vite/client', async (_req, res, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result) return next();
        const patched = result.code.replace(
          'transport.connect(createHMRHandler(handleMessage));',
          '/* HMR WebSocket disabled */',
        );
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.send(patched);
      } catch {
        next();
      }
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Newsie server listening on port ${port}`);
  });
}

function requireWorkspaceContextMatchesParam(
  req: Request,
  res: Response,
  workspaceManager: WorkspaceManager,
): string | null {
  const ws = req.params.id;
  const sessionToken = req.header('x-workspace-session') || undefined;
  try {
    workspaceManager.assertAuthorizedAccess(ws, sessionToken);
    return ws;
  } catch (err) {
    handleAuthError(res, err);
    return null;
  }
}

startServer().catch((err) => {
  console.error('Failed to start Newsie server:', err);
  process.exit(1);
});
