import { Search, Trash2, X } from 'lucide-react';
import { Article, NewsSource, TextSizeOption } from '../../core/common/types';
import { ArticleCard } from '../components/ArticleCard';

export type SearchScope = 'cached' | 'selected_sources' | 'all_enabled';

interface SearchScreenProps {
  query: string;
  onQueryChange: (value: string) => void;
  scope: SearchScope;
  onScopeChange: (scope: SearchScope) => void;
  sources: NewsSource[];
  selectedSourceIds: string[];
  onToggleSelectedSource: (sourceId: string) => void;
  results: Article[];
  searchHistory: string[];
  searchHistoryEnabled: boolean;
  onCommitSearch: (term: string) => void;
  onClearHistory: () => void;
  showImages: boolean;
  textSize: TextSizeOption;
  onToggleBookmark: (articleId: string) => void;
  onOpenArticle: (article: Article) => void;
}

export function SearchScreen({
  query,
  onQueryChange,
  scope,
  onScopeChange,
  sources,
  selectedSourceIds,
  onToggleSelectedSource,
  results,
  searchHistory,
  searchHistoryEnabled,
  onCommitSearch,
  onClearHistory,
  showImages,
  textSize,
  onToggleBookmark,
  onOpenArticle,
}: SearchScreenProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onCommitSearch(query.trim());
    }
  };

  const trimmed = query.trim();

  return (
    <section aria-label="Search articles" className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-[#E3DDD1] pb-5 dark:border-[#1E324D] sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8E6A28] dark:text-[#D4AF6A]">
            Local Index
          </p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-[#0B192C] dark:text-[#FBF9F5]">
            Search Stories
          </h1>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-[#EFEAE0] p-1 dark:bg-[#10233D]">
          {(
            [
              { id: 'cached', label: 'Cached' },
              { id: 'selected_sources', label: 'Selected Sources' },
              { id: 'all_enabled', label: 'All Enabled' },
            ] as { id: SearchScope; label: string }[]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={scope === item.id}
              onClick={() => onScopeChange(item.id)}
              className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                scope === item.id
                  ? 'bg-[#0B192C] text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]'
                  : 'text-[#5C6470] hover:text-[#0B192C] dark:text-[#9AA6B8] dark:hover:text-[#FBF9F5]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {scope === 'selected_sources' && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-3.5 dark:border-[#1E324D] dark:bg-[#10233D]">
          <span className="text-xs font-semibold text-[#5C6470] dark:text-[#9AA6B8]">
            Filter sources:
          </span>
          {sources.map((src) => {
            const active = selectedSourceIds.includes(src.id);
            return (
              <button
                key={src.id}
                type="button"
                aria-pressed={active}
                onClick={() => onToggleSelectedSource(src.id)}
                className={`min-h-[34px] rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-[#0B192C] bg-[#0B192C] text-[#FBF9F5] dark:border-[#B0893E] dark:bg-[#B0893E] dark:text-[#0B192C]'
                    : 'border-[#D8D0C0] text-[#4A5565] dark:border-[#243B5C] dark:text-[#B9C4D4]'
                }`}
              >
                {src.name}
              </button>
            );
          })}
        </div>
      )}

      <form onSubmit={handleSubmit} className="relative">
        <label htmlFor="newsie-search-input" className="sr-only">
          Search headlines, publishers, and categories
        </label>
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5C6470] dark:text-[#9AA6B8]"
          aria-hidden="true"
        />
        <input
          id="newsie-search-input"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search headlines, publishers, categories, or keywords..."
          className="min-h-[48px] w-full rounded-xl border border-[#D8D0C0] bg-[#FFFFFF] pl-10 pr-11 text-sm text-[#0B192C] placeholder:text-[#737C8A] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5] dark:placeholder:text-[#8492A6]"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="Clear search query"
            className="absolute right-1.5 top-1/2 inline-flex min-h-[40px] min-w-[40px] -translate-y-1/2 items-center justify-center rounded-lg text-[#5C6470] hover:text-[#0B192C] dark:text-[#9AA6B8] dark:hover:text-[#FBF9F5]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>

      {!trimmed && searchHistoryEnabled && searchHistory.length > 0 && (
        <div className="space-y-3 rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-4 dark:border-[#1E324D] dark:bg-[#10233D]">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#5C6470] dark:text-[#9AA6B8]">
              Recent Searches
            </h2>
            <button
              type="button"
              onClick={onClearHistory}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[#5C6470] hover:text-[#0B192C] dark:text-[#9AA6B8] dark:hover:text-[#FBF9F5]"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Clear history</span>
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {searchHistory.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => onQueryChange(term)}
                className="min-h-[40px] rounded-lg border border-[#E3DDD1] px-3 py-1.5 text-xs font-medium text-[#0B192C] hover:bg-[#F3EFE6] dark:border-[#243B5C] dark:text-[#E5E9F0] dark:hover:bg-[#172E4D]"
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      )}

      {!trimmed ? (
        <div className="rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-8 text-center dark:border-[#1E324D] dark:bg-[#10233D]">
          <p className="font-serif text-lg font-medium text-[#0B192C] dark:text-[#FBF9F5]">
            Search across indexed reporting
          </p>
          <p className="mt-1.5 text-sm text-[#5C6470] dark:text-[#9AA6B8]">
            Try terms like <span className="font-medium">orbital</span>,{' '}
            <span className="font-medium">arctic</span>, or{' '}
            <span className="font-medium">rail</span>.
          </p>
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-8 text-center dark:border-[#1E324D] dark:bg-[#10233D]">
          <p className="font-serif text-lg font-medium text-[#0B192C] dark:text-[#FBF9F5]">
            No matches for &ldquo;{trimmed}&rdquo;
          </p>
          <p className="mt-1.5 text-sm text-[#5C6470] dark:text-[#9AA6B8]">
            Check spelling, adjust your source scope, or try a broader keyword.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[#5C6470] dark:text-[#9AA6B8] tabular-nums">
            {results.length} {results.length === 1 ? 'result' : 'results'} (
            {scope === 'cached'
              ? 'Cached articles'
              : scope === 'selected_sources'
                ? 'Selected sources'
                : 'All enabled sources'}
            )
          </p>
          <div>
            {results.map((article) => (
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
    </section>
  );
}
