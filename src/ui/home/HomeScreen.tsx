import { useRef, useState } from 'react';
import { ArrowDown, BookmarkPlus, RefreshCw, SlidersHorizontal } from 'lucide-react';
import {
  Article,
  ArticleLayoutDensity,
  Category,
  RefreshState,
  SortOrder,
  TextSizeOption,
} from '../../core/common/types';
import { ALL_NEWS_CATEGORY_ID } from '../../news/categories/defaultCategories';
import { ArticleCard } from '../components/ArticleCard';
import { CategorySelector } from '../components/CategorySelector';

export interface SavedFeedConfigItem {
  id: string;
  name: string;
  categoryIds: string[];
  sourceIds: string[];
  sortOrder: SortOrder;
}

interface HomeScreenProps {
  articles: Article[];
  totalArticles: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadError: string | null;
  categories: Category[];
  selectedCategoryId: string;
  onSelectCategory: (categoryId: string) => void;
  sortOrder: SortOrder;
  onChangeSortOrder: (sortOrder: SortOrder) => void;
  savedConfigs: SavedFeedConfigItem[];
  onApplySavedConfig: (config: SavedFeedConfigItem) => void;
  onSaveCurrentConfig: (name: string) => Promise<void>;
  onOpenCategoryManager: () => void;
  layoutDensity: ArticleLayoutDensity;
  showImages: boolean;
  textSize: TextSizeOption;
  refreshState: RefreshState;
  onRefresh: () => void;
  onLoadMore: () => void;
  onRetryLoad: () => void;
  onToggleBookmark: (articleId: string) => void;
  onOpenArticle: (article: Article) => void;
  onGoToSources: () => void;
}

export function HomeScreen({
  articles,
  totalArticles,
  hasMore,
  isLoadingMore,
  loadError,
  categories,
  selectedCategoryId,
  onSelectCategory,
  sortOrder,
  onChangeSortOrder,
  savedConfigs,
  onApplySavedConfig,
  onSaveCurrentConfig,
  onOpenCategoryManager,
  layoutDensity,
  showImages,
  textSize,
  refreshState,
  onRefresh,
  onLoadMore,
  onRetryLoad,
  onToggleBookmark,
  onOpenArticle,
  onGoToSources,
}: HomeScreenProps) {
  const touchStartY = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [showSaveConfig, setShowSaveConfig] = useState(false);
  const [configName, setConfigName] = useState('');

  const selectedCategoryName =
    selectedCategoryId === ALL_NEWS_CATEGORY_ID
      ? 'All News'
      : categories.find((c) => c.id === selectedCategoryId)?.name ?? 'News';

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (window.scrollY <= 4 && !refreshState.isRefreshing) {
      touchStartY.current = e.touches[0]?.clientY ?? null;
    } else {
      touchStartY.current = null;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartY.current === null) return;
    const currentY = e.touches[0]?.clientY ?? touchStartY.current;
    const delta = currentY - touchStartY.current;
    if (delta > 0) {
      setPullDistance(Math.min(delta * 0.45, 72));
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance >= 52 && !refreshState.isRefreshing) {
      onRefresh();
    }
    touchStartY.current = null;
    setPullDistance(0);
  };

  const leadArticle = layoutDensity === 'editorial' ? articles[0] : undefined;
  const featureArticles =
    layoutDensity === 'editorial' ? articles.slice(1, 3) : [];
  const listArticles =
    layoutDensity === 'editorial' ? articles.slice(3) : articles;

  return (
    <section
      aria-label="News feed"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="space-y-6"
    >
      {pullDistance > 12 && (
        <div
          style={{ height: `${Math.round(pullDistance)}px` }}
          className="flex items-center justify-center gap-2 overflow-hidden text-xs font-medium text-[#5C6470] dark:text-[#A4B0C0] transition-[height] duration-150"
        >
          <ArrowDown className="h-3.5 w-3.5 text-[#B0893E]" aria-hidden="true" />
          <span>
            {pullDistance >= 52 ? 'Release to refresh' : 'Pull to refresh'}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-4 border-b border-[#E3DDD1] pb-5 dark:border-[#1E324D] lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8E6A28] dark:text-[#D4AF6A]">
            {selectedCategoryName}
          </p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-[#0B192C] dark:text-[#FBF9F5] md:text-4xl">
            Today&apos;s Dispatch
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs text-[#5C6470] dark:text-[#9AA6B8]">
          {refreshState.isRefreshing ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-[#0B192C] dark:text-[#D4AF6A]">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>Updating dispatch...</span>
            </span>
          ) : (
            <span className="tabular-nums">
              {refreshState.statusMessage ?? refreshState.lastRefreshedLabel}
            </span>
          )}
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            {articles.length} of {totalArticles}{' '}
            {totalArticles === 1 ? 'story' : 'stories'}
          </span>

          <label htmlFor="home-sort-order" className="sr-only">
            Sort feed articles
          </label>
          <select
            id="home-sort-order"
            value={sortOrder}
            onChange={(e) => onChangeSortOrder(e.target.value as SortOrder)}
            className="min-h-[38px] rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-2.5 text-xs font-semibold text-[#0B192C] dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="publisher">Publisher</option>
            <option value="category">Category</option>
          </select>

          {savedConfigs.length > 0 && (
            <select
              aria-label="Saved feed views"
              defaultValue=""
              onChange={(e) => {
                const cfg = savedConfigs.find((c) => c.id === e.target.value);
                if (cfg) onApplySavedConfig(cfg);
              }}
              className="min-h-[38px] rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-2.5 text-xs font-semibold text-[#0B192C] dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
            >
              <option value="" disabled>
                Saved views...
              </option>
              {savedConfigs.map((cfg) => (
                <option key={cfg.id} value={cfg.id}>
                  {cfg.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => setShowSaveConfig((v) => !v)}
            aria-label="Save current feed view"
            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[#D8D0C0] px-2.5 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#243B5C] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
          >
            <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Save View</span>
          </button>

          <button
            type="button"
            onClick={onOpenCategoryManager}
            aria-label="Manage categories"
            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[#D8D0C0] px-2.5 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#243B5C] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Categories</span>
          </button>
        </div>
      </div>

      {showSaveConfig && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!configName.trim()) return;
            await onSaveCurrentConfig(configName.trim());
            setConfigName('');
            setShowSaveConfig(false);
          }}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-3.5 dark:border-[#1E324D] dark:bg-[#10233D]"
        >
          <input
            type="text"
            value={configName}
            onChange={(e) => setConfigName(e.target.value)}
            placeholder="Name this feed preset (e.g. Morning Space Briefing)..."
            className="min-h-[40px] flex-1 rounded-lg border border-[#D8D0C0] bg-[#FBF9F5] px-3 text-xs text-[#0B192C] dark:border-[#243B5C] dark:bg-[#0B192C] dark:text-[#FBF9F5]"
          />
          <button
            type="submit"
            className="min-h-[40px] rounded-lg bg-[#0B192C] px-4 text-xs font-semibold text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]"
          >
            Save Preset
          </button>
        </form>
      )}

      <CategorySelector
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        onSelectCategory={onSelectCategory}
      />

      {loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-xs font-medium text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200"
        >
          <span>{loadError}</span>
          <button
            type="button"
            onClick={onRetryLoad}
            className="min-h-[36px] rounded-lg bg-red-900 px-3 text-xs font-semibold text-white"
          >
            Retry
          </button>
        </div>
      )}

      {articles.length === 0 ? (
        <div className="rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-8 text-center dark:border-[#1E324D] dark:bg-[#10233D]">
          <h2 className="font-serif text-xl font-semibold text-[#0B192C] dark:text-[#FBF9F5]">
            No stories in {selectedCategoryName}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[#5C6470] dark:text-[#A4B0C0]">
            Either no indexed articles match this category yet, or its
            subscribed publisher is paused in Sources.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {selectedCategoryId !== ALL_NEWS_CATEGORY_ID && (
              <button
                type="button"
                onClick={() => onSelectCategory(ALL_NEWS_CATEGORY_ID)}
                className="min-h-[44px] rounded-lg bg-[#0B192C] px-4 py-2 text-xs font-semibold text-[#FBF9F5] hover:bg-[#162B47] dark:bg-[#B0893E] dark:text-[#0B192C]"
              >
                View All News
              </button>
            )}
            <button
              type="button"
              onClick={onGoToSources}
              className="min-h-[44px] rounded-lg border border-[#D4CCB8] px-4 py-2 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
            >
              Manage Sources
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {leadArticle && (
            <ArticleCard
              article={leadArticle}
              variant="lead"
              showImages={showImages}
              textSize={textSize}
              onToggleBookmark={onToggleBookmark}
              onOpenArticle={onOpenArticle}
            />
          )}

          {featureArticles.length > 0 && (
            <div className="grid gap-6 md:grid-cols-2">
              {featureArticles.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  variant="feature"
                  showImages={showImages}
                  textSize={textSize}
                  onToggleBookmark={onToggleBookmark}
                  onOpenArticle={onOpenArticle}
                />
              ))}
            </div>
          )}

          {listArticles.length > 0 && (
            <div>
              {layoutDensity === 'editorial' && (
                <h2 className="border-b border-[#0B192C]/15 pb-2 font-serif text-lg font-semibold text-[#0B192C] dark:border-[#FBF9F5]/15 dark:text-[#FBF9F5]">
                  Latest Reporting
                </h2>
              )}
              <div>
                {listArticles.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    variant="compact"
                    showImages={showImages}
                    textSize={textSize}
                    onToggleBookmark={onToggleBookmark}
                    onOpenArticle={onOpenArticle}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col items-center gap-3 pt-2">
            {hasMore ? (
              <button
                type="button"
                disabled={isLoadingMore}
                onClick={onLoadMore}
                className="min-h-[44px] rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-6 py-2 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] disabled:opacity-50 dark:border-[#294366] dark:bg-[#10233D] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
              >
                {isLoadingMore ? 'Loading more...' : 'Load more stories'}
              </button>
            ) : (
              <p className="text-xs font-medium text-[#5C6470] dark:text-[#9AA6B8]">
                End of dispatch · {totalArticles} stories shown
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
