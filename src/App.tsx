import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, ShieldAlert } from 'lucide-react';
import {
  AppPreferences,
  Article,
  Category,
  NavTab,
  NewsSource,
  PrivateAccessStatus,
  RefreshState,
  SortOrder,
  WorkspaceAuthMethod,
  WorkspaceSummary,
} from './core/common/types';
import {
  apiClient,
  hasPrivateDashboardToken,
  setUnauthorizedDashboardHandler,
  setUnauthorizedWorkspaceHandler,
} from './core/network/apiClient';
import {
  DEFAULT_PREFERENCES,
  applyThemeToDocument,
} from './core/preferences/themeManager';
import {
  ALL_NEWS_CATEGORY_ID,
  DEFAULT_CATEGORIES,
} from './news/categories/defaultCategories';
import { canStartRefresh, toggleArticleBookmark } from './news/engine/feedEngine';
import { SAMPLE_ARTICLES } from './news/articles/sampleArticles';
import { SAMPLE_SOURCES } from './sources/manager/sampleSources';
import {
  readBrowserNetworkCondition,
  shouldRunScheduledSync,
} from './workers/refreshScheduler';
import {
  ReadingHistoryItem,
  SavedScreen,
} from './ui/bookmarks/SavedScreen';
import { ArticlePreviewModal } from './ui/components/ArticlePreviewModal';
import { BottomNav } from './ui/components/BottomNav';
import { CategoryManagerModal } from './ui/components/CategoryManagerModal';
import { TopBar } from './ui/components/TopBar';
import { WorkspaceModal } from './ui/components/WorkspaceModal';
import { HomeScreen, SavedFeedConfigItem } from './ui/home/HomeScreen';
import { SearchScope, SearchScreen } from './ui/search/SearchScreen';
import { SettingsScreen } from './ui/settings/SettingsScreen';
import { DirectoryEntry, SourcesScreen } from './ui/sources/SourcesScreen';
import { PrivateAuthModal } from './ui/workspace/PrivateAuthModal';
import { PrivateDashboard } from './ui/workspace/PrivateDashboard';

const DEFAULT_WORKSPACES: WorkspaceSummary[] = [
  {
    id: 'default',
    displayName: 'Default Workspace',
    isPrivate: false,
    isLocked: false,
    authMethod: 'none',
    autoLockMinutes: 0,
    lastActivityAt: null,
    createdAt: new Date(0).toISOString(),
    hasBiometricCredential: false,
  },
];

const DEFAULT_ACCESS_STATUS: PrivateAccessStatus = {
  hasSearchPassphrase: false,
  doubleTapIntervalMs: 350,
  hasPrivateWorkspaces: false,
  hasAnyBiometricCredentials: false,
};

export default function App() {
  const [workspaces, setWorkspaces] =
    useState<WorkspaceSummary[]>(DEFAULT_WORKSPACES);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('default');
  const [accessStatus, setAccessStatus] =
    useState<PrivateAccessStatus>(DEFAULT_ACCESS_STATUS);

  const [isPrivateAuthModalOpen, setIsPrivateAuthModalOpen] = useState(false);
  const [isPrivateDashboardOpen, setIsPrivateDashboardOpen] = useState(false);
  const [workspaceModalMode, setWorkspaceModalMode] = useState<
    'create' | 'unlock' | null
  >(null);
  const [unlockTargetWorkspace, setUnlockTargetWorkspace] =
    useState<WorkspaceSummary | null>(null);
  const [isPrivacyBlurred, setIsPrivacyBlurred] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [preferences, setPreferences] =
    useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    ALL_NEWS_CATEGORY_ID,
  );
  const [sources, setSources] = useState<NewsSource[]>(SAMPLE_SOURCES);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [articles, setArticles] = useState<Article[]>(SAMPLE_ARTICLES);
  const [totalArticles, setTotalArticles] = useState(SAMPLE_ARTICLES.length);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [savedConfigs, setSavedConfigs] = useState<SavedFeedConfigItem[]>([]);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('cached');
  const [searchSelectedSourceIds, setSearchSelectedSourceIds] = useState<
    string[]
  >([]);
  const [searchResults, setSearchResults] = useState<Article[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

  const [bookmarkedArticles, setBookmarkedArticles] = useState<Article[]>(
    SAMPLE_ARTICLES.filter((a) => a.isBookmarked),
  );
  const [readingHistory, setReadingHistory] = useState<ReadingHistoryItem[]>(
    [],
  );

  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(
    null,
  );
  const [refreshState, setRefreshState] = useState<RefreshState>({
    isRefreshing: false,
    lastRefreshedAtIso: new Date().toISOString(),
    lastRefreshedLabel: 'Synced locally',
    statusMessage: null,
  });

  const refreshLockRef = useRef(false);
  const lastActivityRef = useRef(Date.now());
  const searchTimerRef = useRef<number | null>(null);

  const activeWorkspace = useMemo(
    () =>
      workspaces.find((w) => w.id === activeWorkspaceId) ??
      workspaces[0] ??
      null,
    [workspaces, activeWorkspaceId],
  );

  const clearVolatileWorkspaceViewState = useCallback(() => {
    setArticles([]);
    setTotalArticles(0);
    setHasMore(false);
    setSources([]);
    setCategories(DEFAULT_CATEGORIES);
    setBookmarkedArticles([]);
    setReadingHistory([]);
    setSearchResults([]);
    setSearchHistory([]);
    setSavedConfigs([]);
    setSelectedArticleId(null);
    setSearchQuery('');
    setSelectedCategoryId(ALL_NEWS_CATEGORY_ID);
    setSearchSelectedSourceIds([]);
  }, []);

  const refreshPrivateAccessStatus = useCallback(async () => {
    try {
      const status = await apiClient.getPrivateAccessStatus();
      setAccessStatus(status);
      return status;
    } catch {
      return accessStatus;
    }
  }, [accessStatus]);

  useEffect(() => {
    void apiClient
      .getPrivateAccessStatus()
      .then(setAccessStatus)
      .catch(() => undefined);
  }, []);

  // Ensure document.title never reveals private workspace titles
  useEffect(() => {
    document.title = 'Newsie';
  }, [activeWorkspaceId, isPrivateDashboardOpen]);

  useEffect(() => {
    applyThemeToDocument(preferences.theme);
    if (preferences.theme !== 'system' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyThemeToDocument('system');
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [preferences.theme]);

  const loadFeedPage = useCallback(
    async (
      workspaceId: string,
      offset: number,
      append: boolean,
      prefs: AppPreferences,
      categoryId: string,
    ) => {
      try {
        setLoadError(null);
        const res = await apiClient.getArticles({
          workspaceId,
          categoryIds:
            categoryId === ALL_NEWS_CATEGORY_ID ? undefined : [categoryId],
          sortOrder: prefs.sortOrder,
          limit: prefs.articlesPerPage,
          offset,
        });
        setArticles((prev) => (append ? [...prev, ...res.items] : res.items));
        setTotalArticles(res.total);
        setHasMore(res.hasMore);
      } catch (err) {
        setLoadError((err as Error).message || 'Unable to load articles.');
      }
    },
    [],
  );

  const hydrateWorkspace = useCallback(
    async (workspaceId: string) => {
      try {
        const wsListRes = await apiClient.listWorkspaces(workspaceId);
        setWorkspaces(wsListRes.workspaces);

        const targetWs = wsListRes.workspaces.find((w) => w.id === workspaceId);
        if (targetWs?.isPrivate && targetWs.isLocked) {
          clearVolatileWorkspaceViewState();
          setUnlockTargetWorkspace(targetWs);
          setWorkspaceModalMode('unlock');
          return;
        }

        const [
          prefsRes,
          catsRes,
          srcsRes,
          dirRes,
          configsRes,
          histRes,
          searchHistRes,
          bookmarksRes,
        ] = await Promise.all([
          apiClient.getPreferences(workspaceId),
          apiClient.getCategories(workspaceId),
          apiClient.getSources(workspaceId),
          apiClient.getDirectory(),
          apiClient.getFeedConfigs(workspaceId),
          apiClient.getReadingHistory(workspaceId),
          apiClient.getSearchHistory(workspaceId),
          apiClient.getBookmarks(workspaceId, 'newest'),
        ]);

        setPreferences(prefsRes.preferences);
        setCategories(catsRes.categories);
        setSources(srcsRes.sources);
        setDirectory(dirRes.directory);
        setSavedConfigs(configsRes.configs);
        setReadingHistory(histRes.entries);
        setSearchHistory(searchHistRes.history);
        setBookmarkedArticles(bookmarksRes.items);

        await loadFeedPage(
          workspaceId,
          0,
          false,
          prefsRes.preferences,
          ALL_NEWS_CATEGORY_ID,
        );
        setSelectedCategoryId(ALL_NEWS_CATEGORY_ID);
      } catch {
        // Fallback keeps screen safe if session expired mid-hydration
      }
    },
    [clearVolatileWorkspaceViewState, loadFeedPage],
  );

  useEffect(() => {
    void hydrateWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId, hydrateWorkspace]);

  // Handle server-enforced session expiration or dashboard expiration cleanly
  useEffect(() => {
    setUnauthorizedWorkspaceHandler((failedWorkspaceId) => {
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === failedWorkspaceId ? { ...w, isLocked: true } : w,
        ),
      );
      if (failedWorkspaceId === activeWorkspaceId) {
        clearVolatileWorkspaceViewState();
        const found = workspaces.find((w) => w.id === failedWorkspaceId) ?? null;
        setUnlockTargetWorkspace(found);
        setWorkspaceModalMode('unlock');
      }
    });
    setUnauthorizedDashboardHandler(() => {
      setIsPrivateDashboardOpen(false);
    });
    return () => {
      setUnauthorizedWorkspaceHandler(null);
      setUnauthorizedDashboardHandler(null);
    };
  }, [activeWorkspaceId, clearVolatileWorkspaceViewState, workspaces]);

  const triggerPrivateAccess = useCallback(
    async (allowCachedDashboard: boolean = false) => {
      const status = await refreshPrivateAccessStatus();
      if (
        allowCachedDashboard &&
        hasPrivateDashboardToken() &&
        status.hasPrivateWorkspaces
      ) {
        const wsRes = await apiClient.listWorkspaces(activeWorkspaceId);
        setWorkspaces(wsRes.workspaces);
        setIsPrivateDashboardOpen(true);
        return;
      }
      setIsPrivateAuthModalOpen(true);
    },
    [activeWorkspaceId, refreshPrivateAccessStatus],
  );

  // Global keyboard shortcut: Alt + Shift + P opens Private Access Verification
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        void triggerPrivateAccess();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [triggerPrivateAccess]);

  // Lock private sessions cleanly when tab/browser closes
  useEffect(() => {
    const onPageHide = () => {
      apiClient.lockAllKeepalive();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  const handleLockWorkspace = useCallback(
    async (workspaceId: string) => {
      try {
        const res = await apiClient.lockWorkspace(workspaceId);
        setWorkspaces(res.workspaces);
      } finally {
        if (workspaceId === activeWorkspaceId) {
          clearVolatileWorkspaceViewState();
          setActiveWorkspaceId('default');
          setActiveTab('home');
        }
      }
    },
    [activeWorkspaceId, clearVolatileWorkspaceViewState],
  );

  const handleLockAllAndExit = useCallback(async () => {
    apiClient.lockAllKeepalive();
    setIsPrivateDashboardOpen(false);
    setIsPrivacyBlurred(false);
    clearVolatileWorkspaceViewState();
    setWorkspaces(DEFAULT_WORKSPACES);
    setActiveWorkspaceId('default');
    setActiveTab('home');
    await hydrateWorkspace('default');
  }, [clearVolatileWorkspaceViewState, hydrateWorkspace]);

  // Client-side inactivity auto-lock for active private workspaces
  useEffect(() => {
    const touch = () => {
      lastActivityRef.current = Date.now();
    };
    window.addEventListener('pointerdown', touch, { passive: true });
    window.addEventListener('keydown', touch);

    const mins = activeWorkspace?.isPrivate ? activeWorkspace.autoLockMinutes : 0;
    if (!activeWorkspace?.isPrivate || activeWorkspace.isLocked || mins <= 0) {
      return () => {
        window.removeEventListener('pointerdown', touch);
        window.removeEventListener('keydown', touch);
      };
    }

    const interval = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= mins * 60 * 1000) {
        void handleLockWorkspace(activeWorkspace.id);
      }
    }, 15_000);

    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      window.clearInterval(interval);
    };
  }, [activeWorkspace, handleLockWorkspace]);

  // Privacy blur overlay when tab hidden inside private workspace or Private Dashboard
  useEffect(() => {
    const onVisibility = () => {
      const inProtectedView =
        (activeWorkspace?.isPrivate && !activeWorkspace.isLocked) ||
        isPrivateDashboardOpen;
      if (document.hidden && inProtectedView && preferences.privacyScreenEnabled) {
        setIsPrivacyBlurred(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [activeWorkspace, isPrivateDashboardOpen, preferences.privacyScreenEnabled]);

  // Live search that NEVER transmits a matching Method A access phrase to /api/search
  useEffect(() => {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }

    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }

    const normalized = searchQuery.normalize('NFC');
    const isPhraseCandidate =
      accessStatus.hasSearchPassphrase && Array.from(normalized).length >= 8;
    const delayMs = isPhraseCandidate ? 320 : 140;

    searchTimerRef.current = window.setTimeout(async () => {
      try {
        if (isPhraseCandidate) {
          const check = await apiClient.checkSearchPassphrase(normalized);
          if (check.matched) {
            setSearchQuery('');
            setSearchResults([]);
            void triggerPrivateAccess();
            return;
          }
        }
        const res = await apiClient.searchArticles(
          activeWorkspaceId,
          trimmed,
          searchScope,
          searchSelectedSourceIds,
        );
        setSearchResults(res.items);
      } catch {
        // Non-fatal search check error
      }
    }, delayMs);

    return () => {
      if (searchTimerRef.current !== null) {
        window.clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
    };
  }, [
    accessStatus.hasSearchPassphrase,
    activeWorkspaceId,
    searchQuery,
    searchScope,
    searchSelectedSourceIds,
    triggerPrivateAccess,
  ]);

  // Method A interception BEFORE search history or /api/search on explicit submit
  const handleSubmitSearch = async (rawInput: string) => {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }

    const normalized = rawInput.normalize('NFC');
    if (
      accessStatus.hasSearchPassphrase &&
      Array.from(normalized).length >= 8
    ) {
      const check = await apiClient.checkSearchPassphrase(normalized);
      if (check.matched) {
        setSearchQuery('');
        setSearchResults([]);
        await triggerPrivateAccess();
        return;
      }
    }

    const trimmed = normalized.trim();
    if (!trimmed) return;
    if (preferences.searchHistoryEnabled) {
      const res = await apiClient.addSearchHistory(activeWorkspaceId, trimmed);
      setSearchHistory(res.history);
    }
    const res = await apiClient.searchArticles(
      activeWorkspaceId,
      trimmed,
      searchScope,
      searchSelectedSourceIds,
    );
    setSearchResults(res.items);
  };

  const handleRefresh = useCallback(async () => {
    if (!canStartRefresh(refreshLockRef.current)) return;
    if (activeWorkspace?.isPrivate && activeWorkspace.isLocked) return;

    refreshLockRef.current = true;
    setRefreshState((prev) => ({
      ...prev,
      isRefreshing: true,
      statusMessage: null,
    }));

    try {
      const report = await apiClient.syncWorkspace(activeWorkspaceId);
      const srcsRes = await apiClient.getSources(activeWorkspaceId);
      setSources(srcsRes.sources);
      await loadFeedPage(
        activeWorkspaceId,
        0,
        false,
        preferences,
        selectedCategoryId,
      );

      const now = new Date();
      const timeLabel = now.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      const summary =
        report.insertedArticles > 0
          ? `Added ${report.insertedArticles} new`
          : `Refreshed at ${timeLabel}`;
      setRefreshState({
        isRefreshing: false,
        lastRefreshedAtIso: now.toISOString(),
        lastRefreshedLabel: `Updated ${timeLabel}`,
        statusMessage: summary,
      });
    } catch {
      setRefreshState((prev) => ({
        ...prev,
        isRefreshing: false,
        statusMessage: 'Sync retry needed',
      }));
    } finally {
      refreshLockRef.current = false;
    }
  }, [
    activeWorkspace,
    activeWorkspaceId,
    loadFeedPage,
    preferences,
    selectedCategoryId,
  ]);

  useEffect(() => {
    if (preferences.refreshIntervalMinutes <= 0) return;
    const ms = preferences.refreshIntervalMinutes * 60 * 1000;
    const id = window.setInterval(() => {
      const check = shouldRunScheduledSync(
        preferences.refreshIntervalMinutes,
        preferences.wifiOnlyUpdates,
        readBrowserNetworkCondition(),
        refreshLockRef.current,
      );
      if (check.allowed) {
        void handleRefresh();
      }
    }, ms);
    return () => window.clearInterval(id);
  }, [
    preferences.refreshIntervalMinutes,
    preferences.wifiOnlyUpdates,
    handleRefresh,
  ]);

  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    await loadFeedPage(
      activeWorkspaceId,
      articles.length,
      true,
      preferences,
      selectedCategoryId,
    );
    setIsLoadingMore(false);
  };

  const handleSelectCategory = async (categoryId: string) => {
    setSelectedCategoryId(categoryId);
    await loadFeedPage(activeWorkspaceId, 0, false, preferences, categoryId);
  };

  const handleChangeSortOrder = async (sortOrder: SortOrder) => {
    const updated = { ...preferences, sortOrder };
    setPreferences(updated);
    await apiClient.updatePreferences(activeWorkspaceId, { sortOrder });
    await loadFeedPage(activeWorkspaceId, 0, false, updated, selectedCategoryId);
  };

  const handleToggleBookmark = async (articleId: string) => {
    const target =
      articles.find((a) => a.id === articleId) ??
      bookmarkedArticles.find((a) => a.id === articleId) ??
      searchResults.find((a) => a.id === articleId);
    const nextBookmarked = target ? !target.isBookmarked : true;

    setArticles((prev) => toggleArticleBookmark(prev, articleId));
    setSearchResults((prev) => toggleArticleBookmark(prev, articleId));

    try {
      await apiClient.setBookmark(activeWorkspaceId, articleId, nextBookmarked);
      const bRes = await apiClient.getBookmarks(activeWorkspaceId, 'newest');
      setBookmarkedArticles(bRes.items);
    } catch {
      // Non-fatal bookmark toggle
    }
  };

  const handleOpenArticle = async (article: Article) => {
    setSelectedArticleId(article.id);
    if (preferences.readingHistoryEnabled) {
      try {
        const res = await apiClient.recordReadingHistory(activeWorkspaceId, {
          articleId: article.id,
          publisher: article.publisher,
          title: article.title,
        });
        setReadingHistory(res.entries);
      } catch {
        // Non-blocking history logging
      }
    }
  };

  const handleToggleSource = async (sourceId: string) => {
    const src = sources.find((s) => s.id === sourceId);
    if (!src) return;
    const res = await apiClient.updateSource(activeWorkspaceId, sourceId, {
      enabled: !src.enabled,
    });
    setSources(res.sources);
    await loadFeedPage(
      activeWorkspaceId,
      0,
      false,
      preferences,
      selectedCategoryId,
    );
  };

  const handleUpdateSource = async (
    sourceId: string,
    patch: Partial<Pick<NewsSource, 'name' | 'categoryId'>>,
  ) => {
    const res = await apiClient.updateSource(activeWorkspaceId, sourceId, patch);
    setSources(res.sources);
  };

  const handleRemoveSource = async (sourceId: string) => {
    const res = await apiClient.deleteSource(activeWorkspaceId, sourceId);
    setSources(res.sources);
    await loadFeedPage(
      activeWorkspaceId,
      0,
      false,
      preferences,
      selectedCategoryId,
    );
  };

  const handleAddValidatedSource = async (payload: {
    url: string;
    name?: string;
    categoryId: string;
    format?: 'RSS' | 'Atom';
    description?: string;
    skipNetwork?: boolean;
  }) => {
    const res = await apiClient.addSource({
      workspaceId: activeWorkspaceId,
      ...payload,
    });
    setSources(res.sources);
    await loadFeedPage(
      activeWorkspaceId,
      0,
      false,
      preferences,
      selectedCategoryId,
    );
  };

  const handleImportOpml = async (opmlXml: string) => {
    const res = await apiClient.importOpml(activeWorkspaceId, opmlXml);
    setSources(res.sources);
    return res.importedCount;
  };

  const handleClearSearchHistory = async () => {
    await apiClient.clearSearchHistory(activeWorkspaceId);
    setSearchHistory([]);
  };

  const handleUpdatePreferences = async (patch: Partial<AppPreferences>) => {
    const merged = { ...preferences, ...patch };
    setPreferences(merged);
    await apiClient.updatePreferences(activeWorkspaceId, patch);
    if (patch.articlesPerPage !== undefined || patch.sortOrder !== undefined) {
      await loadFeedPage(
        activeWorkspaceId,
        0,
        false,
        merged,
        selectedCategoryId,
      );
    }
  };

  const handleCreateWorkspace = async (payload: {
    displayName: string;
    passphrase: string;
    authMethod: Exclude<WorkspaceAuthMethod, 'none'>;
    autoLockMinutes: number;
  }) => {
    const res = await apiClient.createWorkspace(payload);
    setWorkspaces(res.workspaces);
    if (!isPrivateDashboardOpen) {
      clearVolatileWorkspaceViewState();
      setActiveWorkspaceId(res.workspace.id);
      setActiveTab('home');
    }
    await refreshPrivateAccessStatus();
  };

  const handleUnlockWorkspace = async (
    workspaceId: string,
    payload: { passphrase?: string; challengeId?: string; assertion?: unknown },
  ) => {
    const res = await apiClient.unlockWorkspace(workspaceId, payload);
    clearVolatileWorkspaceViewState();
    setWorkspaces(res.workspaces);
    setIsPrivacyBlurred(false);
    setIsPrivateDashboardOpen(false);
    if (activeWorkspaceId === workspaceId) {
      await hydrateWorkspace(workspaceId);
    } else {
      setActiveWorkspaceId(workspaceId);
    }
    setActiveTab('home');
  };

  const handleOpenWorkspaceFromDashboard = (workspaceId: string) => {
    const target = workspaces.find((w) => w.id === workspaceId);
    if (!target) return;
    if (target.isPrivate && target.isLocked) {
      setUnlockTargetWorkspace(target);
      setWorkspaceModalMode('unlock');
      return;
    }
    clearVolatileWorkspaceViewState();
    setIsPrivacyBlurred(false);
    setIsPrivateDashboardOpen(false);
    setActiveWorkspaceId(workspaceId);
    setActiveTab('home');
  };

  const selectedArticle = useMemo(
    () =>
      articles.find((a) => a.id === selectedArticleId) ??
      bookmarkedArticles.find((a) => a.id === selectedArticleId) ??
      searchResults.find((a) => a.id === selectedArticleId) ??
      null,
    [articles, bookmarkedArticles, searchResults, selectedArticleId],
  );

  const isCurrentWorkspaceLocked = Boolean(
    activeWorkspace?.isPrivate && activeWorkspace.isLocked,
  );

  const handleSelectNavTab = (tab: NavTab) => {
    setIsPrivateDashboardOpen(false);
    setActiveTab(tab);
  };

  return (
    <div className="min-h-screen bg-[#FBF9F5] text-[#111C2D] dark:bg-[#0B192C] dark:text-[#F3EFE6]">
      <TopBar
        activeTab={activeTab}
        onSelectTab={handleSelectNavTab}
        onRefresh={handleRefresh}
        isRefreshing={refreshState.isRefreshing}
        activeWorkspace={activeWorkspace}
        doubleTapIntervalMs={accessStatus.doubleTapIntervalMs}
        onTriggerPrivateAccess={() => void triggerPrivateAccess(false)}
        onOpenDashboard={() => void triggerPrivateAccess(true)}
        onLockWorkspace={() => {
          if (activeWorkspace?.isPrivate) {
            void handleLockWorkspace(activeWorkspace.id);
          }
        }}
      />

      {isPrivateDashboardOpen ? (
        <main
          className={`mx-auto max-w-6xl px-4 pb-24 pt-6 transition duration-150 md:px-8 md:pb-14 md:pt-8 ${
            isPrivacyBlurred ? 'blur-md select-none pointer-events-none' : ''
          }`}
        >
          <PrivateDashboard
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            accessStatus={accessStatus}
            onRefreshDashboardData={async () => {
              const wsRes = await apiClient.listWorkspaces(activeWorkspaceId);
              setWorkspaces(wsRes.workspaces);
              const stillExists = wsRes.workspaces.some(
                (w) => w.id === activeWorkspaceId,
              );
              if (!stillExists) {
                clearVolatileWorkspaceViewState();
                setActiveWorkspaceId('default');
              }
              await refreshPrivateAccessStatus();
            }}
            onOpenCreateWorkspace={() => {
              setUnlockTargetWorkspace(null);
              setWorkspaceModalMode('create');
            }}
            onOpenWorkspace={handleOpenWorkspaceFromDashboard}
            onLockWorkspace={handleLockWorkspace}
            onLockAllAndExit={handleLockAllAndExit}
            onExitDashboard={() => {
              setIsPrivateDashboardOpen(false);
              setActiveTab('home');
            }}
            onUpdateAccessStatus={setAccessStatus}
          />
        </main>
      ) : isCurrentWorkspaceLocked && activeWorkspace ? (
        <main className="mx-auto flex max-w-lg flex-col items-center justify-center px-4 py-24 text-center">
          <div className="w-full space-y-5 rounded-2xl border border-[#E3DDD1] bg-[#FFFFFF] p-8 shadow-sm dark:border-[#1E324D] dark:bg-[#10233D]">
            <Lock
              className="mx-auto h-10 w-10 text-[#B0893E]"
              aria-hidden="true"
            />
            <div className="space-y-2">
              <h1 className="font-serif text-2xl font-semibold text-[#0B192C] dark:text-[#FBF9F5]">
                Workspace Locked
              </h1>
              <p className="text-sm text-[#5C6470] dark:text-[#9AA6B8]">
                Encrypted workspace records have been sealed with AES-256-GCM
                and cleared from active memory.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setUnlockTargetWorkspace(activeWorkspace);
                  setWorkspaceModalMode('unlock');
                }}
                className="min-h-[44px] rounded-lg bg-[#0B192C] px-5 py-2 text-xs font-semibold text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]"
              >
                Unlock Workspace
              </button>
              <button
                type="button"
                onClick={() => {
                  clearVolatileWorkspaceViewState();
                  setActiveWorkspaceId('default');
                  setActiveTab('home');
                }}
                className="min-h-[44px] rounded-lg border border-[#D8D0C0] px-4 py-2 text-xs font-semibold text-[#0B192C] dark:border-[#294366] dark:text-[#FBF9F5]"
              >
                Return to Default Workspace
              </button>
            </div>
          </div>
        </main>
      ) : (
        <main
          className={`mx-auto max-w-6xl px-4 pb-24 pt-6 transition duration-150 md:px-8 md:pb-14 md:pt-8 ${
            isPrivacyBlurred ? 'blur-md select-none pointer-events-none' : ''
          }`}
        >
          {activeTab === 'home' && (
            <HomeScreen
              articles={articles}
              totalArticles={totalArticles}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              loadError={loadError}
              categories={categories}
              selectedCategoryId={selectedCategoryId}
              onSelectCategory={handleSelectCategory}
              sortOrder={preferences.sortOrder}
              onChangeSortOrder={handleChangeSortOrder}
              savedConfigs={savedConfigs}
              onApplySavedConfig={async (cfg) => {
                const cat = cfg.categoryIds[0] ?? ALL_NEWS_CATEGORY_ID;
                const updated = { ...preferences, sortOrder: cfg.sortOrder };
                setSelectedCategoryId(cat);
                setPreferences(updated);
                await loadFeedPage(activeWorkspaceId, 0, false, updated, cat);
              }}
              onSaveCurrentConfig={async (name) => {
                const res = await apiClient.saveFeedConfig(activeWorkspaceId, {
                  name,
                  categoryIds:
                    selectedCategoryId === ALL_NEWS_CATEGORY_ID
                      ? []
                      : [selectedCategoryId],
                  sourceIds: sources.filter((s) => s.enabled).map((s) => s.id),
                  sortOrder: preferences.sortOrder,
                });
                setSavedConfigs(res.configs);
              }}
              onOpenCategoryManager={() => setIsCategoryModalOpen(true)}
              layoutDensity={preferences.layoutDensity}
              showImages={preferences.showImages}
              textSize={preferences.textSize}
              refreshState={refreshState}
              onRefresh={handleRefresh}
              onLoadMore={handleLoadMore}
              onRetryLoad={() =>
                loadFeedPage(
                  activeWorkspaceId,
                  0,
                  false,
                  preferences,
                  selectedCategoryId,
                )
              }
              onToggleBookmark={handleToggleBookmark}
              onOpenArticle={handleOpenArticle}
              onGoToSources={() => setActiveTab('sources')}
            />
          )}

          {activeTab === 'search' && (
            <SearchScreen
              query={searchQuery}
              onQueryChange={setSearchQuery}
              scope={searchScope}
              onScopeChange={setSearchScope}
              sources={sources}
              selectedSourceIds={searchSelectedSourceIds}
              onToggleSelectedSource={(id) =>
                setSearchSelectedSourceIds((prev) =>
                  prev.includes(id)
                    ? prev.filter((item) => item !== id)
                    : [...prev, id],
                )
              }
              results={searchResults}
              searchHistory={searchHistory}
              searchHistoryEnabled={preferences.searchHistoryEnabled}
              onSubmitSearch={handleSubmitSearch}
              onClearHistory={handleClearSearchHistory}
              showImages={preferences.showImages}
              textSize={preferences.textSize}
              onToggleBookmark={handleToggleBookmark}
              onOpenArticle={handleOpenArticle}
            />
          )}

          {activeTab === 'saved' && (
            <SavedScreen
              articles={bookmarkedArticles}
              readingHistory={readingHistory}
              readingHistoryEnabled={preferences.readingHistoryEnabled}
              onClearReadingHistory={async () => {
                await apiClient.clearReadingHistory(activeWorkspaceId);
                setReadingHistory([]);
              }}
              showImages={preferences.showImages}
              textSize={preferences.textSize}
              onToggleBookmark={handleToggleBookmark}
              onOpenArticle={handleOpenArticle}
              onGoToHome={() => setActiveTab('home')}
            />
          )}

          {activeTab === 'sources' && (
            <SourcesScreen
              workspaceId={activeWorkspaceId}
              sources={sources}
              directory={directory}
              categories={categories}
              onToggleSource={handleToggleSource}
              onUpdateSource={handleUpdateSource}
              onRemoveSource={handleRemoveSource}
              onAddValidatedSource={handleAddValidatedSource}
              onImportOpml={handleImportOpml}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsScreen
              preferences={preferences}
              onUpdatePreferences={handleUpdatePreferences}
              onClearSearchHistory={handleClearSearchHistory}
            />
          )}
        </main>
      )}

      {isPrivacyBlurred &&
        ((activeWorkspace?.isPrivate && !activeWorkspace.isLocked) ||
          isPrivateDashboardOpen) && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Privacy screen protection"
            className="fixed inset-0 z-40 flex items-center justify-center bg-[#0B192C]/85 p-6 backdrop-blur-xl"
          >
            <div className="max-w-sm space-y-4 rounded-2xl border border-[#243B5C] bg-[#10233D] p-7 text-center text-[#FBF9F5] shadow-2xl">
              <ShieldAlert
                className="mx-auto h-9 w-9 text-[#D4AF6A]"
                aria-hidden="true"
              />
              <h2 className="font-serif text-xl font-semibold">
                Private Session Shielded
              </h2>
              <p className="text-xs leading-relaxed text-[#B9C4D4]">
                Content was hidden when the tab moved to the background. Resume
                or lock all active sessions.
              </p>
              <div className="flex justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => void handleLockAllAndExit()}
                  className="min-h-[40px] rounded-lg border border-[#294366] px-4 text-xs font-semibold text-[#FBF9F5]"
                >
                  Lock &amp; Exit
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrivacyBlurred(false)}
                  className="min-h-[40px] rounded-lg bg-[#B0893E] px-4 text-xs font-semibold text-[#0B192C]"
                >
                  Resume
                </button>
              </div>
            </div>
          </div>
        )}

      <BottomNav
        activeTab={activeTab}
        onSelectTab={handleSelectNavTab}
        doubleTapIntervalMs={accessStatus.doubleTapIntervalMs}
        onTriggerPrivateAccess={() => void triggerPrivateAccess()}
      />

      <ArticlePreviewModal
        article={selectedArticle}
        showImages={preferences.showImages}
        onClose={() => setSelectedArticleId(null)}
        onToggleBookmark={handleToggleBookmark}
      />

      <CategoryManagerModal
        isOpen={isCategoryModalOpen}
        categories={categories}
        onClose={() => setIsCategoryModalOpen(false)}
        onCreateCategory={async (name) => {
          await apiClient.createCategory(activeWorkspaceId, name);
          const list = await apiClient.getCategories(activeWorkspaceId);
          setCategories(list.categories);
        }}
        onToggleCategory={async (id, enabled) => {
          const res = await apiClient.updateCategory(activeWorkspaceId, id, {
            enabled,
          });
          setCategories(res.categories);
          await loadFeedPage(
            activeWorkspaceId,
            0,
            false,
            preferences,
            selectedCategoryId,
          );
        }}
        onRenameCategory={async (id, name) => {
          const res = await apiClient.updateCategory(activeWorkspaceId, id, {
            name,
          });
          setCategories(res.categories);
        }}
        onDeleteCategory={async (id) => {
          const res = await apiClient.deleteCategory(activeWorkspaceId, id);
          setCategories(res.categories);
          if (selectedCategoryId === id) {
            setSelectedCategoryId(ALL_NEWS_CATEGORY_ID);
            await loadFeedPage(
              activeWorkspaceId,
              0,
              false,
              preferences,
              ALL_NEWS_CATEGORY_ID,
            );
          }
        }}
        onReorderCategories={async (orderedIds) => {
          const res = await apiClient.reorderCategories(
            activeWorkspaceId,
            orderedIds,
          );
          setCategories(res.categories);
        }}
      />

      <PrivateAuthModal
        isOpen={isPrivateAuthModalOpen}
        accessStatus={accessStatus}
        onClose={() => setIsPrivateAuthModalOpen(false)}
        onAuthenticated={async ({ workspaces: updatedList }) => {
          setIsPrivateAuthModalOpen(false);
          setWorkspaces(updatedList);
          await refreshPrivateAccessStatus();
          setIsPrivateDashboardOpen(true);
        }}
      />

      <WorkspaceModal
        mode={workspaceModalMode}
        targetWorkspace={unlockTargetWorkspace}
        onClose={() => setWorkspaceModalMode(null)}
        onCreateWorkspace={handleCreateWorkspace}
        onUnlockWorkspace={handleUnlockWorkspace}
        onSwitchToDefault={() => {
          clearVolatileWorkspaceViewState();
          setActiveWorkspaceId('default');
          setActiveTab('home');
        }}
      />
    </div>
  );
}
