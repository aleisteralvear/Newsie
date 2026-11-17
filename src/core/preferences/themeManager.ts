import { AppPreferences, AppTheme } from '../common/types';

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: 'light',
  layoutDensity: 'editorial',
  showImages: true,
  textSize: 'medium',
  articlesPerPage: 20,
  sortOrder: 'newest',
  refreshIntervalMinutes: 60,
  wifiOnlyUpdates: true,
  breakingNotifications: true,
  categoryNotifications: false,
  notificationFrequency: 'hourly',
  readingHistoryEnabled: true,
  searchHistoryEnabled: true,
  privacyScreenEnabled: true,
};

export function resolveEffectiveDark(theme: AppTheme, prefersDark: boolean): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return prefersDark;
}

export function applyThemeToDocument(theme: AppTheme): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const shouldBeDark = resolveEffectiveDark(theme, Boolean(media?.matches));
  document.documentElement.classList.toggle('dark', shouldBeDark);
}
