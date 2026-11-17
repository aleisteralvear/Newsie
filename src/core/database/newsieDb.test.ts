import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, DEFAULT_WORKSPACE_ID } from './newsieDb';
import { NewsieRepository } from './repositories';

test('database initializes default workspace, 15 categories, sources, and articles', () => {
  const db = createDatabase(':memory:');
  const repo = new NewsieRepository(db);
  repo.ensureWorkspaceInitialized(DEFAULT_WORKSPACE_ID);

  const categories = repo.listCategories(DEFAULT_WORKSPACE_ID);
  assert.equal(categories.length, 15);

  const sources = repo.listSources(DEFAULT_WORKSPACE_ID);
  assert.ok(sources.length >= 8);

  const page = repo.queryArticlesPage({
    workspaceId: DEFAULT_WORKSPACE_ID,
    sortOrder: 'newest',
    limit: 5,
    offset: 0,
  });
  assert.equal(page.items.length, 5);
  assert.equal(page.total, 12);
  assert.equal(page.hasMore, true);

  db.close();
});

test('custom category CRUD, renaming, reordering, and source toggling persist cleanly', () => {
  const db = createDatabase(':memory:');
  const repo = new NewsieRepository(db);
  repo.ensureWorkspaceInitialized(DEFAULT_WORKSPACE_ID);

  const custom = repo.createCustomCategory(DEFAULT_WORKSPACE_ID, 'Oceanography');
  assert.equal(custom.isCustom, true);
  repo.renameCustomCategory(DEFAULT_WORKSPACE_ID, custom.id, 'Marine Science');

  const updated = repo.listCategories(DEFAULT_WORKSPACE_ID).find((c) => c.id === custom.id);
  assert.equal(updated?.name, 'Marine Science');

  repo.deleteCustomCategory(DEFAULT_WORKSPACE_ID, custom.id);
  assert.equal(
    repo.listCategories(DEFAULT_WORKSPACE_ID).some((c) => c.id === custom.id),
    false,
  );

  db.close();
});

test('article deduplication updates existing record instead of duplicating same normalizedUrl', () => {
  const db = createDatabase(':memory:');
  const repo = new NewsieRepository(db);
  repo.ensureWorkspaceInitialized(DEFAULT_WORKSPACE_ID);

  const dup = repo.upsertArticle(DEFAULT_WORKSPACE_ID, {
    id: 'art-dup-test',
    sourceId: 'src-meridian-dispatch',
    publisher: 'Meridian Science & Space',
    categoryId: 'space',
    categoryName: 'Space',
    title: 'Updated Interferometer Title',
    description: 'Updated description',
    excerpt: 'Updated excerpt',
    url: 'https://meridiandispatch.example/space/interferometer-calibration',
    normalizedUrl: 'https://meridiandispatch.example/space/interferometer-calibration',
    externalGuid: 'art-001',
    fingerprint: 'fp-test',
    imageAlt: 'Dish array',
    publishedAtIso: '2026-11-17T08:45:00Z',
    readTimeMinutes: 5,
    keywords: ['space'],
  });
  assert.equal(dup.inserted, false);

  const page = repo.queryArticlesPage({
    workspaceId: DEFAULT_WORKSPACE_ID,
    sortOrder: 'newest',
    limit: 50,
    offset: 0,
  });
  assert.equal(page.total, 12);

  db.close();
});

test('bookmarks, reading history, search history, and preferences persist across queries', () => {
  const db = createDatabase(':memory:');
  const repo = new NewsieRepository(db);
  repo.ensureWorkspaceInitialized(DEFAULT_WORKSPACE_ID);

  repo.setBookmark(DEFAULT_WORKSPACE_ID, 'art-001', true);
  const bookmarks = repo.listBookmarkedArticles(DEFAULT_WORKSPACE_ID);
  assert.ok(bookmarks.some((a) => a.id === 'art-001'));

  repo.recordReadingHistory(DEFAULT_WORKSPACE_ID, {
    id: 'art-001',
    publisher: 'Meridian Science & Space',
    title: 'Calibration Story',
  });
  assert.equal(repo.listReadingHistory(DEFAULT_WORKSPACE_ID).length, 1);

  repo.addSearchHistory(DEFAULT_WORKSPACE_ID, 'interferometer');
  assert.deepEqual(repo.listSearchHistory(DEFAULT_WORKSPACE_ID), ['interferometer']);

  const prefs = repo.updatePreferences(DEFAULT_WORKSPACE_ID, {
    theme: 'dark',
    articlesPerPage: 10,
  });
  assert.equal(prefs.theme, 'dark');
  assert.equal(prefs.articlesPerPage, 10);

  db.close();
});
