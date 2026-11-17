import {
  AppPreferences,
  Article,
  Category,
  NewsSource,
  SortOrder,
  WorkspaceAuthMethod,
  WorkspaceSummary,
} from '../common/types';

export interface ArticlesPageResponse {
  items: Article[];
  total: number;
  hasMore: boolean;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Per-workspace opaque session tokens stored strictly in volatile JS memory (never localStorage)
const workspaceSessionTokens = new Map<string, string>();
let onUnauthorizedWorkspaceCallback: ((workspaceId: string) => void) | null = null;

export function setWorkspaceSessionToken(
  workspaceId: string,
  token: string | null,
): void {
  if (!token) {
    workspaceSessionTokens.delete(workspaceId);
  } else {
    workspaceSessionTokens.set(workspaceId, token);
  }
}

export function clearAllWorkspaceSessionTokens(): void {
  workspaceSessionTokens.clear();
}

export function setUnauthorizedWorkspaceHandler(
  handler: ((workspaceId: string) => void) | null,
): void {
  onUnauthorizedWorkspaceCallback = handler;
}

function authHeadersFor(workspaceId?: string): Record<string, string> {
  if (!workspaceId || workspaceId === 'default') return {};
  const token = workspaceSessionTokens.get(workspaceId);
  return token ? { 'x-workspace-session': token } : {};
}

async function requestJson<T>(
  url: string,
  init?: RequestInit & { workspaceId?: string },
): Promise<T> {
  const { workspaceId, headers, ...fetchInit } = init ?? {};
  const res = await fetch(url, {
    ...fetchInit,
    headers: {
      'Content-Type': 'application/json',
      ...authHeadersFor(workspaceId),
      ...(headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if ((res.status === 401 || res.status === 403) && workspaceId && workspaceId !== 'default') {
      workspaceSessionTokens.delete(workspaceId);
      onUnauthorizedWorkspaceCallback?.(workspaceId);
    }
    throw new ApiError(
      res.status,
      typeof data.error === 'string'
        ? data.error
        : typeof data.errorMessage === 'string'
          ? data.errorMessage
          : `Request failed (${res.status})`,
      typeof data.retryAfterSeconds === 'number'
        ? data.retryAfterSeconds
        : undefined,
    );
  }
  return data as T;
}

export const apiClient = {
  // Workspaces
  listWorkspaces: () =>
    requestJson<{ workspaces: WorkspaceSummary[] }>('/api/workspaces'),

  createWorkspace: async (payload: {
    displayName: string;
    passphrase: string;
    authMethod?: Exclude<WorkspaceAuthMethod, 'none'>;
    autoLockMinutes?: number;
  }) => {
    const res = await requestJson<{
      workspace: WorkspaceSummary;
      sessionToken: string;
      workspaces: WorkspaceSummary[];
    }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setWorkspaceSessionToken(res.workspace.id, res.sessionToken);
    return res;
  },

  unlockWorkspace: async (workspaceId: string, passphrase: string) => {
    const res = await requestJson<{
      workspace: WorkspaceSummary;
      sessionToken: string;
      workspaces: WorkspaceSummary[];
    }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ passphrase }),
    });
    setWorkspaceSessionToken(workspaceId, res.sessionToken);
    return res;
  },

  lockWorkspace: async (workspaceId: string) => {
    const res = await requestJson<{ workspaces: WorkspaceSummary[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/lock`,
      {
        method: 'POST',
        workspaceId,
      },
    );
    setWorkspaceSessionToken(workspaceId, null);
    return res;
  },

  renameWorkspace: (workspaceId: string, displayName: string) =>
    requestJson<{ workspaces: WorkspaceSummary[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}`,
      {
        method: 'PATCH',
        workspaceId,
        body: JSON.stringify({ displayName }),
      },
    ),

  updateWorkspaceSettings: (
    workspaceId: string,
    patch: {
      authMethod?: Exclude<WorkspaceAuthMethod, 'none'>;
      autoLockMinutes?: number;
    },
  ) =>
    requestJson<{ workspaces: WorkspaceSummary[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}`,
      {
        method: 'PATCH',
        workspaceId,
        body: JSON.stringify(patch),
      },
    ),

  deleteWorkspace: async (workspaceId: string) => {
    const res = await requestJson<{ workspaces: WorkspaceSummary[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}`,
      {
        method: 'DELETE',
        workspaceId,
      },
    );
    setWorkspaceSessionToken(workspaceId, null);
    return res;
  },

  // Categories
  getCategories: (workspaceId: string) =>
    requestJson<{ categories: Category[] }>(
      `/api/categories?workspaceId=${encodeURIComponent(workspaceId)}`,
      { workspaceId },
    ),

  createCategory: (workspaceId: string, name: string) =>
    requestJson<{ category: Category }>('/api/categories', {
      method: 'POST',
      workspaceId,
      body: JSON.stringify({ workspaceId, name }),
    }),

  updateCategory: (
    workspaceId: string,
    id: string,
    patch: { enabled?: boolean; name?: string },
  ) =>
    requestJson<{ categories: Category[] }>(
      `/api/categories/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        workspaceId,
        body: JSON.stringify({ workspaceId, ...patch }),
      },
    ),

  deleteCategory: (workspaceId: string, id: string) =>
    requestJson<{ categories: Category[] }>(
      `/api/categories/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: 'DELETE', workspaceId },
    ),

  reorderCategories: (workspaceId: string, orderedIds: string[]) =>
    requestJson<{ categories: Category[] }>('/api/categories/reorder', {
      method: 'POST',
      workspaceId,
      body: JSON.stringify({ workspaceId, orderedIds }),
    }),

  // Directory & Sync
  getDirectory: () =>
    requestJson<{
      directory: {
        id: string;
        name: string;
        url: string;
        format: 'RSS' | 'Atom';
        categoryId: string;
        description: string;
      }[];
    }>('/api/directory'),

  syncWorkspace: (workspaceId: string) =>
    requestJson<{
      checkedSources: number;
      updatedSources: number;
      insertedArticles: number;
      errors: { sourceId: string; sourceName: string; message: string }[];
      syncedAtIso: string;
    }>('/api/sync', {
      method: 'POST',
      workspaceId,
      body: JSON.stringify({ workspaceId }),
    }),

  // Sources & OPML
  validateFeedUrl: (url: string) =>
    requestJson<{
      valid: boolean;
      url: string;
      httpsRecommendedWarning?: string;
      format?: 'RSS' | 'Atom';
      title?: string;
      description?: string;
      articleCount?: number;
      sampleHeadlines?: string[];
      errorCode?: string;
      errorMessage?: string;
    }>('/api/sources/validate', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  addSource: (payload: {
    workspaceId: string;
    url: string;
    name?: string;
    categoryId: string;
    format?: 'RSS' | 'Atom';
    description?: string;
    skipNetwork?: boolean;
  }) =>
    requestJson<{ sources: NewsSource[] }>('/api/sources', {
      method: 'POST',
      workspaceId: payload.workspaceId,
      body: JSON.stringify(payload),
    }),

  testSource: (workspaceId: string, sourceId: string) =>
    requestJson<{
      valid: boolean;
      articleCount?: number;
      errorMessage?: string;
    }>(`/api/sources/${encodeURIComponent(sourceId)}/test`, {
      method: 'POST',
      workspaceId,
      body: JSON.stringify({ workspaceId }),
    }),

  exportOpml: async (workspaceId: string): Promise<string> => {
    const res = await fetch(
      `/api/opml/export?workspaceId=${encodeURIComponent(workspaceId)}`,
      { headers: authHeadersFor(workspaceId) },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(
        res.status,
        typeof data.error === 'string' ? data.error : 'Unable to export OPML.',
      );
    }
    return res.text();
  },

  importOpml: (workspaceId: string, opmlXml: string) =>
    requestJson<{ importedCount: number; sources: NewsSource[] }>(
      '/api/opml/import',
      {
        method: 'POST',
        workspaceId,
        body: JSON.stringify({ workspaceId, opmlXml }),
      },
    ),

  getSources: (workspaceId: string) =>
    requestJson<{ sources: NewsSource[] }>(
      `/api/sources?workspaceId=${encodeURIComponent(workspaceId)}`,
      { workspaceId },
    ),

  updateSource: (
    workspaceId: string,
    id: string,
    patch: Partial<Pick<NewsSource, 'enabled' | 'name' | 'categoryId'>>,
  ) =>
    requestJson<{ sources: NewsSource[] }>(
      `/api/sources/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        workspaceId,
        body: JSON.stringify({ workspaceId, ...patch }),
      },
    ),

  deleteSource: (workspaceId: string, id: string) =>
    requestJson<{ sources: NewsSource[] }>(
      `/api/sources/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: 'DELETE', workspaceId },
    ),

  // Articles, Bookmarks, Search, Preferences, Presets, History
  getArticles: (params: {
    workspaceId: string;
    categoryIds?: string[];
    sourceIds?: string[];
    sortOrder: SortOrder;
    limit: number;
    offset: number;
  }) => {
    const qs = new URLSearchParams({
      workspaceId: params.workspaceId,
      sort: params.sortOrder,
      limit: String(params.limit),
      offset: String(params.offset),
    });
    if (params.categoryIds && params.categoryIds.length > 0) {
      qs.set('categories', params.categoryIds.join(','));
    }
    if (params.sourceIds && params.sourceIds.length > 0) {
      qs.set('sources', params.sourceIds.join(','));
    }
    return requestJson<ArticlesPageResponse>(`/api/articles?${qs.toString()}`, {
      workspaceId: params.workspaceId,
    });
  },

  setBookmark: (workspaceId: string, articleId: string, bookmarked: boolean) =>
    requestJson<{ ok: boolean; bookmarked: boolean }>(
      `/api/articles/${encodeURIComponent(articleId)}/bookmark`,
      {
        method: 'POST',
        workspaceId,
        body: JSON.stringify({ workspaceId, bookmarked }),
      },
    ),

  getBookmarks: (workspaceId: string, sortOrder: SortOrder) =>
    requestJson<{ items: Article[] }>(
      `/api/bookmarks?workspaceId=${encodeURIComponent(workspaceId)}&sort=${encodeURIComponent(sortOrder)}`,
      { workspaceId },
    ),

  searchArticles: (
    workspaceId: string,
    q: string,
    scope: 'cached' | 'selected_sources' | 'all_enabled',
    sourceIds: string[] = [],
  ) => {
    const qs = new URLSearchParams({
      workspaceId,
      q,
      scope,
    });
    if (sourceIds.length > 0) qs.set('sources', sourceIds.join(','));
    return requestJson<{ items: Article[] }>(`/api/search?${qs.toString()}`, {
      workspaceId,
    });
  },

  getSearchHistory: (workspaceId: string) =>
    requestJson<{ history: string[] }>(
      `/api/search/history?workspaceId=${encodeURIComponent(workspaceId)}`,
      { workspaceId },
    ),

  addSearchHistory: (workspaceId: string, query: string) =>
    requestJson<{ history: string[] }>('/api/search/history', {
      method: 'POST',
      workspaceId,
      body: JSON.stringify({ workspaceId, query }),
    }),

  clearSearchHistory: (workspaceId: string) =>
    requestJson<{ history: string[] }>(
      `/api/search/history?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: 'DELETE', workspaceId },
    ),

  getPreferences: (workspaceId: string) =>
    requestJson<{ preferences: AppPreferences }>(
      `/api/preferences?workspaceId=${encodeURIComponent(workspaceId)}`,
      { workspaceId },
    ),

  updatePreferences: (workspaceId: string, patch: Partial<AppPreferences>) =>
    requestJson<{ preferences: AppPreferences }>('/api/preferences', {
      method: 'PATCH',
      workspaceId,
      body: JSON.stringify({ workspaceId, patch }),
    }),

  getFeedConfigs: (workspaceId: string) =>
    requestJson<{
      configs: {
        id: string;
        name: string;
        categoryIds: string[];
        sourceIds: string[];
        sortOrder: SortOrder;
      }[];
    }>(`/api/feed-configs?workspaceId=${encodeURIComponent(workspaceId)}`, {
      workspaceId,
    }),

  saveFeedConfig: (
    workspaceId: string,
    config: {
      id?: string;
      name: string;
      categoryIds: string[];
      sourceIds: string[];
      sortOrder: SortOrder;
    },
  ) =>
    requestJson<{
      configs: {
        id: string;
        name: string;
        categoryIds: string[];
        sourceIds: string[];
        sortOrder: SortOrder;
      }[];
    }>('/api/feed-configs', {
      method: 'POST',
      workspaceId,
      body: JSON.stringify({ workspaceId, ...config }),
    }),

  deleteFeedConfig: (workspaceId: string, id: string) =>
    requestJson<{
      configs: {
        id: string;
        name: string;
        categoryIds: string[];
        sourceIds: string[];
        sortOrder: SortOrder;
      }[];
    }>(
      `/api/feed-configs/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: 'DELETE', workspaceId },
    ),

  getReadingHistory: (workspaceId: string) =>
    requestJson<{
      entries: {
        id: number;
        articleId: string;
        publisher: string;
        title: string;
        openedAtIso: string;
        status: string;
      }[];
    }>(`/api/reading-history?workspaceId=${encodeURIComponent(workspaceId)}`, {
      workspaceId,
    }),

  recordReadingHistory: (
    workspaceId: string,
    article: { articleId: string; publisher: string; title: string },
  ) =>
    requestJson<{
      entries: {
        id: number;
        articleId: string;
        publisher: string;
        title: string;
        openedAtIso: string;
        status: string;
      }[];
    }>('/api/reading-history', {
      method: 'POST',
      workspaceId,
      body: JSON.stringify({ workspaceId, ...article }),
    }),

  clearReadingHistory: (workspaceId: string) =>
    requestJson<{ entries: [] }>(
      `/api/reading-history?workspaceId=${encodeURIComponent(workspaceId)}`,
      { method: 'DELETE', workspaceId },
    ),
};
