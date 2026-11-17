import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_ARTICLES } from '../articles/sampleArticles';
import { SAMPLE_SOURCES } from '../../sources/manager/sampleSources';
import { ALL_NEWS_CATEGORY_ID } from '../categories/defaultCategories';
import {
  canStartRefresh,
  getVisibleArticles,
  searchArticles,
  sortArticles,
  toggleArticleBookmark,
  validateSourceUrlInput,
} from './feedEngine';

test('getVisibleArticles returns newest first for All News when all sources enabled', () => {
  const results = getVisibleArticles(SAMPLE_ARTICLES, {
    categoryId: ALL_NEWS_CATEGORY_ID,
    sources: SAMPLE_SOURCES,
    sortOrder: 'newest',
  });
  assert.equal(results.length, SAMPLE_ARTICLES.length);
  assert.equal(results[0].id, 'art-001');
});

test('getVisibleArticles filters by selected category and disabled sources', () => {
  const onlySpace = getVisibleArticles(SAMPLE_ARTICLES, {
    categoryId: 'space',
    sources: SAMPLE_SOURCES,
    sortOrder: 'newest',
  });
  assert.equal(onlySpace.length, 1);
  assert.equal(onlySpace[0].categoryId, 'space');

  const disabledSources = SAMPLE_SOURCES.map((s) =>
    s.id === 'src-meridian-dispatch' ? { ...s, enabled: false } : s,
  );
  const filteredOut = getVisibleArticles(SAMPLE_ARTICLES, {
    categoryId: 'space',
    sources: disabledSources,
    sortOrder: 'newest',
  });
  assert.equal(filteredOut.length, 0);
});

test('sortArticles orders oldest, publisher, and category deterministically', () => {
  const oldest = sortArticles(SAMPLE_ARTICLES, 'oldest');
  assert.equal(oldest[0].id, 'art-012');

  const byPublisher = sortArticles(SAMPLE_ARTICLES, 'publisher');
  assert.ok(byPublisher[0].publisher <= byPublisher[1].publisher);

  const byCategory = sortArticles(SAMPLE_ARTICLES, 'category');
  assert.ok(byCategory[0].categoryName <= byCategory[1].categoryName);
});

test('searchArticles matches across title, publisher, description, and keywords', () => {
  const matches = searchArticles(SAMPLE_ARTICLES, 'interferometer');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'art-001');

  const multiTerm = searchArticles(SAMPLE_ARTICLES, 'arctic sea');
  assert.equal(multiTerm.length, 1);
  assert.equal(multiTerm[0].id, 'art-002');

  assert.equal(searchArticles(SAMPLE_ARTICLES, '   ').length, 0);
});

test('toggleArticleBookmark flips bookmark state without mutating unrelated records', () => {
  const updated = toggleArticleBookmark(SAMPLE_ARTICLES, 'art-001');
  assert.equal(updated.find((a) => a.id === 'art-001')?.isBookmarked, true);
  assert.equal(updated.find((a) => a.id === 'art-002')?.isBookmarked, true);
});

test('validateSourceUrlInput blocks empty, non-http, and private/localhost URLs', () => {
  assert.equal(validateSourceUrlInput('').valid, false);
  assert.equal(validateSourceUrlInput('ftp://example.com/feed.xml').valid, false);
  assert.equal(validateSourceUrlInput('http://localhost:8080/rss').valid, false);
  assert.equal(validateSourceUrlInput('https://192.168.1.10/feed').valid, false);
  assert.equal(validateSourceUrlInput('https://example.org/rss.xml').valid, true);
});

test('canStartRefresh prevents overlapping refresh runs', () => {
  assert.equal(canStartRefresh(false), true);
  assert.equal(canStartRefresh(true), false);
});
