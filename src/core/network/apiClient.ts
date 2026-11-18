import {
  AppPreferences,
  Article,
  Category,
  NewsSource,
  PrivateAccessStatus,
  SortOrder,
  WorkspaceAuthMethod,
  WorkspaceSummary,
} from '../common/types';

export interface ArticlesPageResponse {
  items: Article[];
  total: number;
  hasMore: boolean;
}

export interface WebAuthnCredentialView {
  credentialId: string;
  workspaceId: string;
  label: string;
  createdAt: string;
}

export interface ClientReauthProof {
  passphrase?: string;
  webauthn?: {
    challengeId: string;
    assertion: {
      id: string;
      rawId: string;
      type: string;
      authenticatorData: string;
      clientDataJSON: string;
      signature: string;
    };
  };
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

// Per-workspace opaque session tokens & dashboard token strictly in volatile JS memory (never localStorage)
const workspaceSessionTokens = new Map<string, string>();
let privateDashboardToken: string | null = null;
let onUnauthorizedWorkspaceCallback: ((workspaceId: string) => void) | null = null;
let onUnauthorizedDashboardCallback: (() => void) | null = null;

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

export function setPrivateDashboardToken(token: string | null): void {
  privateDashboardToken = token;
}

export function hasPrivateDashboardToken(): boolean {
  return Boolean(privateDashboardToken);
}

export function clearAllWorkspaceSessionTokens(): void {
  workspaceSessionTokens.clear();
  privateDashboardToken = null;
}

export function setUnauthorizedWorkspaceHandler(
  handler: ((workspaceId: string) => void) | null,
): void {
  onUnauthorizedWorkspaceCallback = handler;
}

export function setUnauthorizedDashboardHandler(
  handler: (() => void) | null,
): void {
  onUnauthorizedDashboardCallback = handler;
}

function authHeadersFor(
  workspaceId?: string,
  includeDashboard: boolean = false,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (workspaceId && workspaceId !== 'default') {
    const token = workspaceSessionTokens.get(workspaceId);
    if (token) out['x-workspace-session'] = token;
  }
  if (includeDashboard && privateDashboardToken) {
    out['x-private-dashboard'] = privateDashboardToken;
  }
  return out;
}

async function requestJson<T>(
  url: string,
  init?: RequestInit & {
    workspaceId?: string;
    includeDashboard?: boolean;
    skipSessionEviction?: boolean;
  },
): Promise<T> {
  const {
    workspaceId,
    includeDashboard,
    skipSessionEviction,
    headers,
    ...fetchInit
  } = init ?? {};
  const res = await fetch(url, {
    ...fetchInit,
    headers: {
      'Content-Type': 'application/json',
      ...authHeadersFor(workspaceId, Boolean(includeDashboard)),
      ...(headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (
      !skipSessionEviction &&
      (res.status === 401 || res.status === 403) &&
      workspaceId &&
      workspaceId !== 'default'
    ) {
      workspaceSessionTokens.delete(workspaceId);
      onUnauthorizedWorkspaceCallback?.(workspaceId);
    }
    if (
      !skipSessionEviction &&
      res.status === 401 &&
      includeDashboard &&
      privateDashboardToken
    ) {
      privateDashboardToken = null;
      onUnauthorizedDashboardCallback?.();
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

// WebAuthn Browser Helpers
function base64UrlToUint8Array(b64u: string): Uint8Array {
  const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
  const b64 = (b64u + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return arr;
}

function arrayBufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function isPlatformBiometricAvailable(): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    !window.PublicKeyCredential ||
    typeof window.PublicKeyCredential
      .isUserVerifyingPlatformAuthenticatorAvailable !== 'function'
  ) {
    return false;
  }
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function runBrowserWebAuthnRegistration(options: {
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  excludeCredentialIds: string[];
}): Promise<{
  id: string;
  rawId: string;
  type: string;
  clientDataJSON: string;
  attestationObject: string;
}> {
  if (!navigator.credentials?.create) {
    throw new Error('WebAuthn passkey enrollment is not supported in this browser.');
  }

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: base64UrlToUint8Array(options.challenge) as BufferSource,
      rp: options.rp,
      user: {
        id: base64UrlToUint8Array(options.user.id) as BufferSource,
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      excludeCredentials: options.excludeCredentialIds.map((id) => ({
        type: 'public-key',
        id: base64UrlToUint8Array(id) as BufferSource,
      })),
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;

  if (!cred) {
    throw new Error('Biometric registration was cancelled.');
  }

  const resp = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: arrayBufferToBase64Url(cred.rawId),
    type: cred.type,
    clientDataJSON: arrayBufferToBase64Url(resp.clientDataJSON),
    attestationObject: arrayBufferToBase64Url(resp.attestationObject),
  };
}

export async function runBrowserWebAuthnAssertion(options: {
  challenge: string;
  rpId: string;
  allowCredentialIds: string[];
}): Promise<{
  id: string;
  rawId: string;
  type: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}> {
  if (!navigator.credentials?.get) {
    throw new Error('WebAuthn biometric authentication is not supported on this device.');
  }

  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: base64UrlToUint8Array(options.challenge) as BufferSource,
      rpId: options.rpId,
      allowCredentials: options.allowCredentialIds.map((id) => ({
        type: 'public-key',
        id: base64UrlToUint8Array(id) as BufferSource,
      })),
      userVerification: 'required',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;

  if (!cred) {
    throw new Error('Biometric verification was cancelled.');
  }

  const resp = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: arrayBufferToBase64Url(cred.rawId),
    type: cred.type,
    clientDataJSON: arrayBufferToBase64Url(resp.clientDataJSON),
    authenticatorData: arrayBufferToBase64Url(resp.authenticatorData),
    signature: arrayBufferToBase64Url(resp.signature),
  };
}

export const apiClient = {
  // Private Access Gate (Method A + Method B + WebAuthn entry)
  getPrivateAccessStatus: () =>
    requestJson<PrivateAccessStatus>('/api/private-access/status'),

  checkSearchPassphrase: (candidate: string) =>
    requestJson<{ matched: boolean }>('/api/private-access/check-phrase', {
      method: 'POST',
      body: JSON.stringify({ candidate }),
    }),

  getWebAuthnAuthOptions: (
    purpose: 'auth' | 'dashboard' | 'reauth',
    workspaceId?: string,
  ) =>
    requestJson<{
      challengeId: string;
      challenge: string;
      rpId: string;
      allowCredentialIds: string[];
    }>('/api/private-access/webauthn/options', {
      method: 'POST',
      body: JSON.stringify({ purpose, workspaceId }),
    }),

  authenticatePrivateEntry: async (payload: {
    passphrase?: string;
    challengeId?: string;
    assertion?: unknown;
  }) => {
    const res = await requestJson<{
      dashboardToken: string;
      workspace: WorkspaceSummary;
      sessionToken: string;
      workspaces: WorkspaceSummary[];
    }>('/api/private-access/authenticate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setPrivateDashboardToken(res.dashboardToken);
    setWorkspaceSessionToken(res.workspace.id, res.sessionToken);
    return res;
  },

  logoutPrivateDashboard: async () => {
    if (!privateDashboardToken) return;
    const tok = privateDashboardToken;
    privateDashboardToken = null;
    await fetch('/api/private-access/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-private-dashboard': tok,
      },
    }).catch(() => undefined);
  },

  updatePrivateAccessConfig: (patch: {
    searchPassphrase?: string | null;
    doubleTapIntervalMs?: number;
  }) =>
    requestJson<PrivateAccessStatus>('/api/private-access/config', {
      method: 'PATCH',
      includeDashboard: true,
      body: JSON.stringify(patch),
    }),

  // Workspaces
  listWorkspaces: (activeWorkspaceId?: string) => {
    const qs = activeWorkspaceId
      ? `?activeWorkspaceId=${encodeURIComponent(activeWorkspaceId)}`
      : '';
    return requestJson<{ workspaces: WorkspaceSummary[] }>(
      `/api/workspaces${qs}`,
      {
        workspaceId: activeWorkspaceId,
        includeDashboard: true,
      },
    );
  },

  createWorkspace: async (payload: {
    displayName: string;
    passphrase: string;
    authMethod?: Exclude<WorkspaceAuthMethod, 'none'>;
    autoLockMinutes?: number;
    issueDashboardToken?: boolean;
  }) => {
    const res = await requestJson<{
      workspace: WorkspaceSummary;
      sessionToken: string;
      dashboardToken?: string;
      workspaces: WorkspaceSummary[];
    }>('/api/workspaces', {
      method: 'POST',
      includeDashboard: true,
      body: JSON.stringify(payload),
    });
    setWorkspaceSessionToken(res.workspace.id, res.sessionToken);
    if (res.dashboardToken) {
      setPrivateDashboardToken(res.dashboardToken);
    }
    return res;
  },

  unlockWorkspace: async (
    workspaceId: string,
    payload: {
      passphrase?: string;
      challengeId?: string;
      assertion?: unknown;
    },
  ) => {
    const res = await requestJson<{
      workspace: WorkspaceSummary;
      sessionToken: string;
      workspaces: WorkspaceSummary[];
    }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/unlock`, {
      method: 'POST',
      includeDashboard: true,
      skipSessionEviction: true,
      body: JSON.stringify(payload),
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
        includeDashboard: true,
      },
    );
    setWorkspaceSessionToken(workspaceId, null);
    return res;
  },

  lockAllKeepalive: () => {
    const workspaceIds = Array.from(workspaceSessionTokens.keys());
    const sessionTokens = Array.from(workspaceSessionTokens.values());
    const dash = privateDashboardToken;
    if (workspaceIds.length === 0 && !dash) return;

    void fetch('/api/workspaces/lock-all', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...(dash ? { 'x-private-dashboard': dash } : {}),
      },
      body: JSON.stringify({
        workspaceIds,
        sessionTokens,
        dashboardToken: dash,
      }),
    }).catch(() => undefined);

    clearAllWorkspaceSessionTokens();
  },

  renameWorkspace: (workspaceId: string, displayName: string) =>
    requestJson<{ workspaces: WorkspaceSummary[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}`,
      {
        method: 'PATCH',
        workspaceId,
        includeDashboard: true,
        body: JSON.stringify({ displayName }),
      },
    ),

  updateWorkspaceSettings: (
    workspaceId: string,
    patch: {
      authMethod?: Exclude<WorkspaceAuthMethod, 'none'>;
      autoLockMinutes?: number;
      newPassphrase?: string;
    },
    reauth?: ClientReauthProof,
  ) =>
    requestJson<{ workspaces: WorkspaceSummary[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}`,
      {
        method: 'PATCH',
        workspaceId,
        includeDashboard: true,
        skipSessionEviction: Boolean(reauth),
        body: JSON.stringify({ ...patch, reauth }),
      },
    ),

  deleteWorkspace: async (workspaceId: string, reauth: ClientReauthProof) => {
    const res = await requestJson<{ workspaces: WorkspaceSummary[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}`,
      {
        method: 'DELETE',
        workspaceId,
        includeDashboard: true,
        skipSessionEviction: true,
        body: JSON.stringify({ reauth }),
      },
    );
    setWorkspaceSessionToken(workspaceId, null);
    return res;
  },

  // WebAuthn Per-Workspace Credentials
  getWebAuthnRegisterOptions: (workspaceId: string) =>
    requestJson<{
      challengeId: string;
      challenge: string;
      rp: { name: string; id: string };
      user: { id: string; name: string; displayName: string };
      excludeCredentialIds: string[];
    }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/webauthn/register/options`, {
      method: 'POST',
      workspaceId,
      includeDashboard: true,
    }),

  verifyWebAuthnRegistration: (
    workspaceId: string,
    payload: {
      challengeId: string;
      label?: string;
      registration: unknown;
    },
  ) =>
    requestJson<{
      credential: WebAuthnCredentialView;
      workspaces: WorkspaceSummary[];
    }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/webauthn/register/verify`, {
      method: 'POST',
      workspaceId,
      includeDashboard: true,
      body: JSON.stringify(payload),
    }),

  listWebAuthnCredentials: (workspaceId: string) =>
    requestJson<{ credentials: WebAuthnCredentialView[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/webauthn/credentials`,
      {
        workspaceId,
        includeDashboard: true,
      },
    ),

  removeWebAuthnCredential: (
    workspaceId: string,
    credentialId: string,
    reauth: ClientReauthProof,
  ) =>
    requestJson<{
      credentials: WebAuthnCredentialView[];
      workspaces: WorkspaceSummary[];
    }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/webauthn/credentials/${encodeURIComponent(credentialId)}`,
      {
        method: 'DELETE',
        workspaceId,
        includeDashboard: true,
        skipSessionEviction: true,
        body: JSON.stringify({ reauth }),
      },
    ),

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

  // Articles, Bookmarks, Search (POST body prevents URL query logs), Preferences, Presets, History
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
  ) =>
    requestJson<{ items: Article[] }>('/api/search', {
      method: 'POST',
      workspaceId,
      body: JSON.stringify({ workspaceId, q, scope, sources: sourceIds }),
    }),

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
