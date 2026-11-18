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
  ReauthProof,
  WorkspaceAuthError,
  WorkspaceManager,
} from './src/workspace/manager/workspaceManager';

function resolveWorkspaceContext(req: Request): {
  workspaceId: string;
  sessionToken?: string;
} {
  const fromQuery =
    typeof req.query.workspaceId === 'string' && req.query.workspaceId.trim()
      ? req.query.workspaceId.trim()
      : undefined;
  const fromBody =
    req.body &&
    typeof req.body.workspaceId === 'string' &&
    req.body.workspaceId.trim()
      ? req.body.workspaceId.trim()
      : undefined;

  if (fromQuery && fromBody && fromQuery !== fromBody) {
    throw new WorkspaceAuthError(
      403,
      'Cross-workspace parameter mismatch rejected.',
    );
  }

  const workspaceId = fromBody || fromQuery || DEFAULT_WORKSPACE_ID;
  const headerToken = req.header('x-workspace-session') || undefined;

  if (workspaceId === DEFAULT_WORKSPACE_ID && headerToken) {
    throw new WorkspaceAuthError(
      403,
      'Private workspace session token cannot access the default workspace.',
    );
  }

  return { workspaceId, sessionToken: headerToken };
}

function resolveOriginContext(req: Request): {
  rpId: string;
  expectedOrigins: string[];
} {
  const rawHost = req.get('x-forwarded-host') || req.get('host') || 'localhost:3000';
  const hostNoPort = rawHost.split(',')[0].trim().split(':')[0];
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http')
    .split(',')[0]
    .trim();

  const origins = new Set<string>([
    `${proto}://${rawHost.split(',')[0].trim()}`,
    `https://${rawHost.split(',')[0].trim()}`,
    `http://${rawHost.split(',')[0].trim()}`,
  ]);

  const reqOrigin = req.get('origin');
  if (reqOrigin) {
    try {
      const parsed = new URL(reqOrigin);
      if (parsed.hostname === hostNoPort) {
        origins.add(parsed.origin);
      }
    } catch {
      // Ignore malformed Origin header
    }
  }

  return {
    rpId: hostNoPort,
    expectedOrigins: Array.from(origins),
  };
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

function parseReauthBody(req: Request, rawReauth: unknown): ReauthProof | undefined {
  if (!rawReauth || typeof rawReauth !== 'object') return undefined;
  const obj = rawReauth as Record<string, unknown>;
  const { expectedOrigins } = resolveOriginContext(req);
  if (typeof obj.passphrase === 'string' && obj.passphrase.length > 0) {
    return { passphrase: obj.passphrase };
  }
  if (obj.webauthn && typeof obj.webauthn === 'object') {
    const wa = obj.webauthn as Record<string, unknown>;
    return {
      webauthn: {
        challengeId: String(wa.challengeId || ''),
        assertion: wa.assertion as never,
        expectedOrigins,
      },
    };
  }
  return undefined;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const db = createDatabase();
  const repo = new NewsieRepository(db);
  repo.ensureWorkspaceInitialized(DEFAULT_WORKSPACE_ID);
  const workspaceManager = new WorkspaceManager(db, repo);

  const requireWorkspaceAccess = (
    req: Request,
    res: Response,
  ): { workspaceId: string; wsRepo: NewsieRepository } | null => {
    try {
      const { workspaceId, sessionToken } = resolveWorkspaceContext(req);
      const wsRepo = workspaceManager.getAuthorizedRepository(
        workspaceId,
        sessionToken,
      );
      return { workspaceId, wsRepo };
    } catch (err) {
      handleAuthError(res, err);
      return null;
    }
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Private Access Entry System (Method A search phrase + Method B double-tap + WebAuthn entry)
  app.get('/api/private-access/status', (_req, res) => {
    res.json(workspaceManager.getPrivateAccessStatus());
  });

  app.post('/api/private-access/check-phrase', async (req, res) => {
    const candidate =
      typeof req.body?.candidate === 'string' ? req.body.candidate : '';
    const result = await workspaceManager.checkSearchPassphrase(candidate);
    res.json(result);
  });

  app.post('/api/private-access/webauthn/options', (req, res) => {
    const { rpId } = resolveOriginContext(req);
    const purpose = (
      ['auth', 'dashboard', 'reauth'].includes(String(req.body?.purpose))
        ? req.body.purpose
        : 'dashboard'
    ) as 'auth' | 'dashboard' | 'reauth';
    const workspaceId =
      typeof req.body?.workspaceId === 'string' && req.body.workspaceId
        ? req.body.workspaceId
        : undefined;
    res.json(
      workspaceManager.createWebAuthnAuthOptions({
        purpose,
        rpId,
        workspaceId,
      }),
    );
  });

  app.post('/api/private-access/authenticate', async (req, res) => {
    try {
      const clientKey = req.ip || 'local';
      const { expectedOrigins } = resolveOriginContext(req);

      if (req.body?.challengeId && req.body?.assertion && !req.body?.passphrase) {
        const result = workspaceManager.authenticatePrivateEntryWithWebAuthn({
          challengeId: String(req.body.challengeId),
          assertion: req.body.assertion,
          expectedOrigins,
          clientKey,
        });
        return res.json(result);
      }

      const webauthnProof =
        req.body?.challengeId && req.body?.assertion
          ? {
              challengeId: String(req.body.challengeId),
              assertion: req.body.assertion,
              expectedOrigins,
            }
          : undefined;

      const result = await workspaceManager.authenticatePrivateEntryWithPassphrase(
        String(req.body?.passphrase || ''),
        clientKey,
        webauthnProof,
      );
      return res.json(result);
    } catch (err) {
      return handleAuthError(res, err);
    }
  });

  app.post('/api/private-access/logout', (req, res) => {
    const dashToken = req.header('x-private-dashboard') || undefined;
    workspaceManager.revokeDashboardSession(dashToken);
    res.json({ ok: true });
  });

  app.patch('/api/private-access/config', async (req, res) => {
    try {
      const dashToken = req.header('x-private-dashboard') || undefined;
      const status = await workspaceManager.updatePrivateAccessConfig(dashToken, {
        searchPassphrase:
          req.body?.searchPassphrase === null ||
          typeof req.body?.searchPassphrase === 'string'
            ? req.body.searchPassphrase
            : undefined,
        doubleTapIntervalMs:
          typeof req.body?.doubleTapIntervalMs === 'number'
            ? req.body.doubleTapIntervalMs
            : undefined,
      });
      res.json(status);
    } catch (err) {
      handleAuthError(res, err);
    }
  });

  // Workspaces Management (never leak private workspaces without dashboardToken or active session)
  app.get('/api/workspaces', (req, res) => {
    const dashToken = req.header('x-private-dashboard') || undefined;
    const activeId =
      typeof req.query.activeWorkspaceId === 'string'
        ? req.query.activeWorkspaceId
        : undefined;
    const sessionToken = req.header('x-workspace-session') || undefined;
    res.json({
      workspaces: workspaceManager.listWorkspacesForActiveContext(
        dashToken,
        activeId,
        sessionToken,
      ),
    });
  });

  app.post('/api/workspaces', async (req, res) => {
    try {
      const dashToken = req.header('x-private-dashboard') || undefined;
      const statusBefore = workspaceManager.getPrivateAccessStatus();
      // If private workspaces already exist, require an authenticated dashboard session to create another
      if (statusBefore.hasPrivateWorkspaces) {
        workspaceManager.assertDashboardSession(dashToken);
      }

      const issueDashboardToken =
        !statusBefore.hasPrivateWorkspaces ||
        Boolean(req.body?.issueDashboardToken);

      const result = await workspaceManager.createPrivateWorkspace({
        displayName: String(req.body?.displayName || ''),
        passphrase: String(req.body?.passphrase || ''),
        authMethod: req.body?.authMethod,
        autoLockMinutes:
          typeof req.body?.autoLockMinutes === 'number'
            ? req.body.autoLockMinutes
            : 5,
        issueDashboardToken,
      });

      const effectiveDash = result.dashboardToken || dashToken;
      res.status(201).json({
        ...result,
        workspaces: workspaceManager.listWorkspacesForActiveContext(
          effectiveDash,
          result.workspace.id,
          result.sessionToken,
        ),
      });
    } catch (err) {
      handleAuthError(res, err);
    }
  });

  app.post('/api/workspaces/:id/unlock', async (req, res) => {
    try {
      const dashToken = req.header('x-private-dashboard') || undefined;
      const { expectedOrigins } = resolveOriginContext(req);

      let result: { sessionToken: string; workspace: ReturnType<typeof workspaceManager.listPublicWorkspaces>[number] };

      if (req.body?.challengeId && req.body?.assertion && !req.body?.passphrase) {
        result = workspaceManager.unlockWorkspaceWithWebAuthn({
          workspaceId: req.params.id,
          challengeId: String(req.body.challengeId),
          assertion: req.body.assertion,
          expectedOrigins,
        });
      } else {
        const webauthnProof =
          req.body?.challengeId && req.body?.assertion
            ? {
                challengeId: String(req.body.challengeId),
                assertion: req.body.assertion,
                expectedOrigins,
              }
            : undefined;
        result = await workspaceManager.unlockWorkspace(
          req.params.id,
          String(req.body?.passphrase || ''),
          webauthnProof,
        );
      }

      res.json({
        ...result,
        workspaces: workspaceManager.listWorkspacesForActiveContext(
          dashToken,
          result.workspace.id,
          result.sessionToken,
        ),
      });
    } catch (err) {
      handleAuthError(res, err);
    }
  });

  app.post('/api/workspaces/:id/lock', (req, res) => {
    try {
      const ws = req.params.id;
      const dashToken = req.header('x-private-dashboard') || undefined;
      const sessionToken = req.header('x-workspace-session') || undefined;
      if (dashToken && workspaceManager.isDashboardTokenValid(dashToken)) {
        workspaceManager.lockWorkspace(ws);
      } else {
        workspaceManager.assertAuthorizedAccess(ws, sessionToken);
        workspaceManager.lockWorkspace(ws);
      }
      res.json({
        workspaces: workspaceManager.listWorkspacesForActiveContext(dashToken),
      });
    } catch (err) {
      handleAuthError(res, err);
    }
  });

  app.post('/api/workspaces/lock-all', (req, res) => {
    const dashToken =
      req.header('x-private-dashboard') ||
      (typeof req.body?.dashboardToken === 'string'
        ? req.body.dashboardToken
        : undefined);
    const bodyTokens = Array.isArray(req.body?.sessionTokens)
      ? req.body.sessionTokens.map(String)
      : [];
    const headerSession = req.header('x-workspace-session');
    if (headerSession) bodyTokens.push(headerSession);

    if (dashToken && workspaceManager.isDashboardTokenValid(dashToken)) {
      workspaceManager.lockAllPrivateWorkspaces();
    } else if (bodyTokens.length > 0) {
      const all = workspaceManager.getPrivateAccessStatus();
      if (all.hasPrivateWorkspaces) {
        // Only lock workspaces authorized by the submitted session tokens
        const wsIds = Array.isArray(req.body?.workspaceIds)
          ? req.body.workspaceIds.map(String)
          : [];
        for (const wsId of wsIds) {
          for (const tok of bodyTokens) {
            try {
              workspaceManager.assertAuthorizedAccess(wsId, tok);
              workspaceManager.lockWorkspace(wsId);
            } catch {
              // Ignore mismatched token/id pair
            }
          }
        }
      }
    }
    workspaceManager.revokeDashboardSession(dashToken);
    res.json({ ok: true });
  });

  app.patch('/api/workspaces/:id', async (req, res) => {
    try {
      const ws = req.params.id;
      const dashToken = req.header('x-private-dashboard') || undefined;
      const sessionToken = req.header('x-workspace-session') || undefined;

      if (typeof req.body?.displayName === 'string') {
        workspaceManager.renameWorkspace(
          ws,
          req.body.displayName,
          dashToken,
          sessionToken,
        );
      }

      if (
        req.body?.authMethod !== undefined ||
        typeof req.body?.autoLockMinutes === 'number' ||
        req.body?.newPassphrase !== undefined
      ) {
        await workspaceManager.updateWorkspaceSettings(
          ws,
          {
            authMethod: req.body.authMethod,
            autoLockMinutes: req.body.autoLockMinutes,
            newPassphrase: req.body.newPassphrase,
          },
          parseReauthBody(req, req.body?.reauth),
          dashToken,
          sessionToken,
        );
      }

      res.json({
        workspaces: workspaceManager.listWorkspacesForActiveContext(
          dashToken,
          ws,
          sessionToken,
        ),
      });
    } catch (err) {
      handleAuthError(res, err);
    }
  });

  app.delete('/api/workspaces/:id', async (req, res) => {
    try {
      const ws = req.params.id;
      const dashToken = req.header('x-private-dashboard') || undefined;
      const sessionToken = req.header('x-workspace-session') || undefined;
      await workspaceManager.deleteWorkspace(
        ws,
        parseReauthBody(req, req.body?.reauth),
        dashToken,
        sessionToken,
      );
      res.json({
        workspaces: workspaceManager.listWorkspacesForActiveContext(dashToken),
      });
    } catch (err) {
      handleAuthError(res, err);
    }
  });

  // WebAuthn Per-Workspace Credential Management
  app.post('/api/workspaces/:id/webauthn/register/options', (req, res) => {
    try {
      const { rpId } = resolveOriginContext(req);
      const dashToken = req.header('x-private-dashboard') || undefined;
      const sessionToken = req.header('x-workspace-session') || undefined;
      res.json(
        workspaceManager.createWebAuthnRegistrationOptions({
          workspaceId: req.params.id,
          rpId,
          dashboardToken: dashToken,
          sessionToken,
        }),
      );
    } catch (err) {
      handleAuthError(res, err);
    }
  });

  app.post('/api/workspaces/:id/webauthn/register/verify', (req, res) => {
    try {
      const { expectedOrigins } = resolveOriginContext(req);
      const sessionToken = req.header('x-workspace-session') || undefined;
      const dashToken = req.header('x-private-dashboard') || undefined;
      const cred = workspaceManager.registerWebAuthnCredential({
        workspaceId: req.params.id,
        challengeId: String(req.body?.challengeId || ''),
        registration: req.body?.registration,
        expectedOrigins,
        label: typeof req.body?.label === 'string' ? req.body.label : undefined,
        sessionToken,
      });
      res.status(201).json({
        credential: cred,
        workspaces: workspaceManager.listWorkspacesForActiveContext(
          dashToken,
          req.params.id,
          sessionToken,
        ),
      });
    } catch (err) {
      handleAuthError(res, err);
    }
  });

  app.get('/api/workspaces/:id/webauthn/credentials', (req, res) => {
    try {
      const dashToken = req.header('x-private-dashboard') || undefined;
      const sessionToken = req.header('x-workspace-session') || undefined;
      res.json({
        credentials: workspaceManager.listWebAuthnCredentials(
          req.params.id,
          dashToken,
          sessionToken,
        ),
      });
    } catch (err) {
      handleAuthError(res, err);
    }
  });

  app.delete('/api/workspaces/:id/webauthn/credentials/:credId', async (req, res) => {
    try {
      const dashToken = req.header('x-private-dashboard') || undefined;
      const sessionToken = req.header('x-workspace-session') || undefined;
      await workspaceManager.removeWebAuthnCredential({
        workspaceId: req.params.id,
        credentialId: req.params.credId,
        reauth: parseReauthBody(req, req.body?.reauth),
        dashboardToken: dashToken,
        sessionToken,
      });
      res.json({
        credentials: workspaceManager.listWebAuthnCredentials(
          req.params.id,
          dashToken,
          sessionToken,
        ),
        workspaces: workspaceManager.listWorkspacesForActiveContext(
          dashToken,
          req.params.id,
          sessionToken,
        ),
      });
    } catch (err) {
      handleAuthError(res, err);
    }
  });

  // Sync & Discovery
  app.post('/api/sync', async (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    try {
      const report = await syncWorkspaceFeeds(ctx.wsRepo, ctx.workspaceId);
      workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
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
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    res.json({ categories: ctx.wsRepo.listCategories(ctx.workspaceId) });
  });

  app.post('/api/categories', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    try {
      const created = ctx.wsRepo.createCustomCategory(
        ctx.workspaceId,
        String(req.body.name || ''),
      );
      workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
      res.status(201).json({
        category: created,
        categories: ctx.wsRepo.listCategories(ctx.workspaceId),
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/categories/reorder', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    const orderedIds = Array.isArray(req.body.orderedIds)
      ? req.body.orderedIds.map(String)
      : [];
    ctx.wsRepo.reorderCategories(ctx.workspaceId, orderedIds);
    workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
    res.json({ categories: ctx.wsRepo.listCategories(ctx.workspaceId) });
  });

  app.patch('/api/categories/:id', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    if (typeof req.body.enabled === 'boolean') {
      ctx.wsRepo.setCategoryEnabled(
        ctx.workspaceId,
        req.params.id,
        req.body.enabled,
      );
    }
    if (typeof req.body.name === 'string') {
      ctx.wsRepo.renameCustomCategory(
        ctx.workspaceId,
        req.params.id,
        req.body.name,
      );
    }
    workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
    res.json({ categories: ctx.wsRepo.listCategories(ctx.workspaceId) });
  });

  app.delete('/api/categories/:id', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    ctx.wsRepo.deleteCustomCategory(ctx.workspaceId, req.params.id);
    workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
    res.json({ categories: ctx.wsRepo.listCategories(ctx.workspaceId) });
  });

  // Sources
  app.get('/api/sources', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    res.json({ sources: ctx.wsRepo.listSources(ctx.workspaceId) });
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
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    try {
      const url = String(req.body.url || '').trim();
      const name = String(req.body.name || '').trim();
      const categoryId = String(req.body.categoryId || 'world');
      const format = (req.body.format === 'Atom' ? 'Atom' : 'RSS') as
        | 'RSS'
        | 'Atom';
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

          ctx.wsRepo.addSource(ctx.workspaceId, {
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
            ctx.wsRepo
              .listCategories(ctx.workspaceId)
              .find((c) => c.id === categoryId)?.name ?? 'World';
          for (const item of fetched.parsed.articles) {
            ctx.wsRepo.upsertArticle(ctx.workspaceId, {
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

          workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
          return res
            .status(201)
            .json({ sources: ctx.wsRepo.listSources(ctx.workspaceId) });
        }
      }

      ctx.wsRepo.addSource(ctx.workspaceId, {
        id: sourceId,
        name: finalName,
        url,
        format: finalFormat,
        categoryId,
        enabled: true,
        description: finalDesc,
      });
      workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
      return res
        .status(201)
        .json({ sources: ctx.wsRepo.listSources(ctx.workspaceId) });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/sources/:id/test', async (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    const src = ctx.wsRepo.getSourceById(ctx.workspaceId, req.params.id);
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
    ctx.wsRepo.updateSourceFetchStatus(ctx.workspaceId, src.id, {
      lastFetchedAt: preview.valid ? new Date().toISOString() : undefined,
      lastError: preview.valid ? null : preview.errorMessage ?? 'Feed check failed.',
    });
    workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
    return res.status(preview.valid ? 200 : 400).json(preview);
  });

  app.get('/api/opml/export', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    const xml = exportSourcesToOpml(
      ctx.wsRepo.listSources(ctx.workspaceId),
      ctx.wsRepo.listCategories(ctx.workspaceId),
    );
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="newsie-subscriptions.opml"',
    );
    res.send(xml);
  });

  app.post('/api/opml/import', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    try {
      const opmlXml = String(req.body.opmlXml || '');
      const entries = parseOpmlXml(opmlXml);
      const existingUrls = new Set(
        ctx.wsRepo.listSources(ctx.workspaceId).map((s) => s.url.toLowerCase()),
      );
      const categories = ctx.wsRepo.listCategories(ctx.workspaceId);

      let added = 0;
      for (const entry of entries) {
        if (existingUrls.has(entry.url.toLowerCase())) continue;
        const matchedCat = entry.categoryName
          ? categories.find(
              (c) => c.name.toLowerCase() === entry.categoryName?.toLowerCase(),
            )
          : undefined;
        ctx.wsRepo.addSource(ctx.workspaceId, {
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

      workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
      res.json({
        importedCount: added,
        sources: ctx.wsRepo.listSources(ctx.workspaceId),
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/sources/:id', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    ctx.wsRepo.updateSource(ctx.workspaceId, req.params.id, {
      enabled:
        typeof req.body.enabled === 'boolean' ? req.body.enabled : undefined,
      name: typeof req.body.name === 'string' ? req.body.name : undefined,
      categoryId:
        typeof req.body.categoryId === 'string'
          ? req.body.categoryId
          : undefined,
    });
    workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
    res.json({ sources: ctx.wsRepo.listSources(ctx.workspaceId) });
  });

  app.delete('/api/sources/:id', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    ctx.wsRepo.removeSource(ctx.workspaceId, req.params.id);
    workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
    res.json({ sources: ctx.wsRepo.listSources(ctx.workspaceId) });
  });

  // Articles, Bookmarks, Search, Preferences, Presets, History
  app.get('/api/articles', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    const categoryIds = req.query.categories
      ? String(req.query.categories).split(',').filter(Boolean)
      : undefined;
    const sourceIds = req.query.sources
      ? String(req.query.sources).split(',').filter(Boolean)
      : undefined;
    const sortOrder = (req.query.sort as SortOrder) || 'newest';
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    const page = ctx.wsRepo.queryArticlesPage({
      workspaceId: ctx.workspaceId,
      categoryIds,
      sourceIds,
      sortOrder,
      limit,
      offset,
    });
    res.json(page);
  });

  app.post('/api/articles/:id/bookmark', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    const bookmarked = Boolean(req.body.bookmarked);
    ctx.wsRepo.setBookmark(ctx.workspaceId, req.params.id, bookmarked);
    workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
    res.json({ ok: true, bookmarked });
  });

  app.get('/api/bookmarks', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    const sortOrder = (req.query.sort as SortOrder) || 'newest';
    res.json({
      items: ctx.wsRepo.listBookmarkedArticles(ctx.workspaceId, sortOrder),
    });
  });

  // Search via POST keeps search terms out of URL query strings/server URL history
  app.post('/api/search', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    const q = String(req.body?.q || '');
    const scope = String(req.body?.scope || 'cached') as
      | 'cached'
      | 'selected_sources'
      | 'all_enabled';
    const sourceIds = Array.isArray(req.body?.sources)
      ? req.body.sources.map(String).filter(Boolean)
      : [];
    const items = ctx.wsRepo.searchArticles(ctx.workspaceId, q, scope, sourceIds);
    res.json({ items });
  });

  app.get('/api/search/history', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    res.json({ history: ctx.wsRepo.listSearchHistory(ctx.workspaceId) });
  });

  app.post('/api/search/history', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    ctx.wsRepo.addSearchHistory(ctx.workspaceId, String(req.body.query || ''));
    workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
    res.json({ history: ctx.wsRepo.listSearchHistory(ctx.workspaceId) });
  });

  app.delete('/api/search/history', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    ctx.wsRepo.clearSearchHistory(ctx.workspaceId);
    workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
    res.json({ history: [] });
  });

  app.get('/api/preferences', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    res.json({ preferences: ctx.wsRepo.getPreferences(ctx.workspaceId) });
  });

  app.patch('/api/preferences', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    const preferences = ctx.wsRepo.updatePreferences(
      ctx.workspaceId,
      req.body.patch || {},
    );
    workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
    res.json({ preferences });
  });

  app.get('/api/feed-configs', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    res.json({ configs: ctx.wsRepo.listFeedConfigs(ctx.workspaceId) });
  });

  app.post('/api/feed-configs', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    const id = String(req.body.id || `cfg-${crypto.randomUUID().slice(0, 8)}`);
    ctx.wsRepo.saveFeedConfig(ctx.workspaceId, {
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
    workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
    res.status(201).json({ configs: ctx.wsRepo.listFeedConfigs(ctx.workspaceId) });
  });

  app.delete('/api/feed-configs/:id', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    ctx.wsRepo.deleteFeedConfig(ctx.workspaceId, req.params.id);
    workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
    res.json({ configs: ctx.wsRepo.listFeedConfigs(ctx.workspaceId) });
  });

  app.get('/api/reading-history', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    res.json({ entries: ctx.wsRepo.listReadingHistory(ctx.workspaceId) });
  });

  app.post('/api/reading-history', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    ctx.wsRepo.recordReadingHistory(ctx.workspaceId, {
      id: String(req.body.articleId || ''),
      publisher: String(req.body.publisher || ''),
      title: String(req.body.title || ''),
    });
    workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
    res
      .status(201)
      .json({ entries: ctx.wsRepo.listReadingHistory(ctx.workspaceId) });
  });

  app.delete('/api/reading-history', (req, res) => {
    const ctx = requireWorkspaceAccess(req, res);
    if (!ctx) return;
    ctx.wsRepo.clearReadingHistory(ctx.workspaceId);
    workspaceManager.syncEncryptedPrivateWorkspace(ctx.workspaceId);
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

startServer().catch((err) => {
  console.error('Failed to start Newsie server:', err);
  process.exit(1);
});
