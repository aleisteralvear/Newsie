import { Category } from '../../core/common/types';

export const ALL_NEWS_CATEGORY_ID = 'all';

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'world', name: 'World', enabled: true, isCustom: false, order: 1 },
  { id: 'national', name: 'National', enabled: true, isCustom: false, order: 2 },
  { id: 'local', name: 'Local', enabled: true, isCustom: false, order: 3 },
  { id: 'politics', name: 'Politics', enabled: true, isCustom: false, order: 4 },
  { id: 'science', name: 'Science', enabled: true, isCustom: false, order: 5 },
  { id: 'technology', name: 'Technology', enabled: true, isCustom: false, order: 6 },
  { id: 'business', name: 'Business', enabled: true, isCustom: false, order: 7 },
  { id: 'health', name: 'Health', enabled: true, isCustom: false, order: 8 },
  { id: 'environment', name: 'Environment', enabled: true, isCustom: false, order: 9 },
  { id: 'space', name: 'Space', enabled: true, isCustom: false, order: 10 },
  { id: 'paranormal', name: 'Paranormal', enabled: true, isCustom: false, order: 11 },
  { id: 'culture', name: 'Culture', enabled: true, isCustom: false, order: 12 },
  { id: 'entertainment', name: 'Entertainment', enabled: true, isCustom: false, order: 13 },
  { id: 'education', name: 'Education', enabled: true, isCustom: false, order: 14 },
  { id: 'sports', name: 'Sports', enabled: true, isCustom: false, order: 15 },
];
