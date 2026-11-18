export type NavTab = 'home' | 'search' | 'saved' | 'sources' | 'settings';

export type AppTheme = 'light' | 'dark' | 'system';

export type ArticleLayoutDensity = 'editorial' | 'compact';

export type TextSizeOption = 'small' | 'medium' | 'large';

export type SortOrder = 'newest' | 'oldest' | 'publisher' | 'category';

export interface Category {
  id: string;
  name: string;
  enabled: boolean;
  isCustom: boolean;
  order: number;
}

export interface NewsSource {
  id: string;
  name: string;
  url: string;
  format: 'RSS' | 'Atom';
  categoryId: string;
  enabled: boolean;
  description: string;
  lastUpdatedLabel: string;
}

export interface Article {
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
  imageUrl?: string;
  imageAlt: string;
  publishedAtIso: string;
  publishedLabel: string;
  readTimeMinutes: number;
  keywords: string[];
  isBookmarked: boolean;
}

export interface RefreshState {
  isRefreshing: boolean;
  lastRefreshedAtIso: string;
  lastRefreshedLabel: string;
  statusMessage: string | null;
}

export interface AppPreferences {
  theme: AppTheme;
  layoutDensity: ArticleLayoutDensity;
  showImages: boolean;
  textSize: TextSizeOption;
  articlesPerPage: 10 | 20 | 30 | 50 | 100;
  sortOrder: SortOrder;
  refreshIntervalMinutes: 15 | 30 | 60 | 180 | 360 | 720 | 0;
  wifiOnlyUpdates: boolean;
  breakingNotifications: boolean;
  categoryNotifications: boolean;
  notificationFrequency: 'immediate' | 'hourly' | 'daily';
  readingHistoryEnabled: boolean;
  searchHistoryEnabled: boolean;
  privacyScreenEnabled: boolean;
}

export type WorkspaceAuthMethod = 'passphrase' | 'biometric' | 'both' | 'none';

export interface WorkspaceSummary {
  id: string;
  displayName: string;
  isPrivate: boolean;
  isLocked: boolean;
  authMethod: WorkspaceAuthMethod;
  autoLockMinutes: number;
  createdAt: string;
  lastActivityAt: string | null;
  hasBiometricCredential: boolean;
}

export interface PrivateAccessStatus {
  hasSearchPassphrase: boolean;
  doubleTapIntervalMs: number;
  hasPrivateWorkspaces: boolean;
  hasAnyBiometricCredentials: boolean;
}

