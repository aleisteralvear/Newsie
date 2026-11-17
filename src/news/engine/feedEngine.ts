import { Article, NewsSource, SortOrder } from '../../core/common/types';
import { ALL_NEWS_CATEGORY_ID } from '../categories/defaultCategories';

export interface FeedQueryOptions {
  categoryId: string;
  sources: NewsSource[];
  sortOrder: SortOrder;
  limit?: number;
}

export function getVisibleArticles(
  articles: Article[],
  options: FeedQueryOptions,
): Article[] {
  const enabledSourceIds = new Set(
    options.sources.filter((s) => s.enabled).map((s) => s.id),
  );

  const filtered = articles.filter((article) => {
    if (!enabledSourceIds.has(article.sourceId)) {
      return false;
    }
    if (
      options.categoryId !== ALL_NEWS_CATEGORY_ID &&
      article.categoryId !== options.categoryId
    ) {
      return false;
    }
    return true;
  });

  const sorted = sortArticles(filtered, options.sortOrder);
  if (typeof options.limit === 'number' && options.limit > 0) {
    return sorted.slice(0, options.limit);
  }
  return sorted;
}

export function sortArticles(articles: Article[], sortOrder: SortOrder): Article[] {
  const copy = [...articles];
  switch (sortOrder) {
    case 'oldest':
      return copy.sort(
        (a, b) =>
          Date.parse(a.publishedAtIso) - Date.parse(b.publishedAtIso),
      );
    case 'publisher':
      return copy.sort((a, b) => a.publisher.localeCompare(b.publisher));
    case 'category':
      return copy.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
    case 'newest':
    default:
      return copy.sort(
        (a, b) =>
          Date.parse(b.publishedAtIso) - Date.parse(a.publishedAtIso),
      );
  }
}

export function searchArticles(articles: Article[], rawQuery: string): Article[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  return sortArticles(
    articles.filter((article) => {
      const haystack = [
        article.title,
        article.description,
        article.publisher,
        article.categoryName,
        ...article.keywords,
      ]
        .join(' ')
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    }),
    'newest',
  );
}

export function toggleArticleBookmark(
  articles: Article[],
  articleId: string,
): Article[] {
  return articles.map((article) =>
    article.id === articleId
      ? { ...article, isBookmarked: !article.isBookmarked }
      : article,
  );
}

export function validateSourceUrlInput(rawUrl: string): {
  valid: boolean;
  reason?: string;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, reason: 'Please enter a feed URL.' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        valid: false,
        reason: 'Feed URLs must use HTTPS or HTTP.',
      };
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.endsWith('.local')
    ) {
      return {
        valid: false,
        reason: 'Localhost and private network addresses are blocked.',
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Enter a valid RSS or Atom feed URL.' };
  }
}

export function canStartRefresh(isCurrentlyRefreshing: boolean): boolean {
  return !isCurrentlyRefreshing;
}
