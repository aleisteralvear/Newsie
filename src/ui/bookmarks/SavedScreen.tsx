import { useState } from 'react';
import { Bookmark, Clock, Search, Trash2 } from 'lucide-react';
import { Article, SortOrder, TextSizeOption } from '../../core/common/types';
import { searchArticles, sortArticles } from '../../news/engine/feedEngine';
import { ArticleCard } from '../components/ArticleCard';

export interface ReadingHistoryItem {
  id: number;
  articleId: string;
  publisher: string;
  title: string;
  openedAtIso: string;
  status: string;
}

interface SavedScreenProps {
  articles: Article[];
  readingHistory: ReadingHistoryItem[];
  readingHistoryEnabled: boolean;
  onClearReadingHistory: () => void;
  showImages: boolean;
  textSize: TextSizeOption;
  onToggleBookmark: (articleId: string) => void;
  onOpenArticle: (article: Article) => void;
  onGoToHome: () => void;
}

export function SavedScreen({
  articles,
  readingHistory,
  readingHistoryEnabled,
  onClearReadingHistory,
  showImages,
  textSize,
  onToggleBookmark,
  onOpenArticle,
  onGoToHome,
}: SavedScreenProps) {
  const [subTab, setSubTab] = useState<'bookmarks' | 'history'>('bookmarks');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [filterQuery, setFilterQuery] = useState('');

  const bookmarkedAll = articles.filter((a) => a.isBookmarked);
  const filteredSaved = filterQuery.trim()
    ? searchArticles(bookmarkedAll, filterQuery)
    : bookmarkedAll;
  const saved = sortArticles(filteredSaved, sortOrder);

  return (
    <section aria-label="Saved articles and reading history" className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-[#E3DDD1] pb-5 dark:border-[#1E324D] sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8E6A28] dark:text-[#D4AF6A]">
            Personal Archive
          </p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-[#0B192C] dark:text-[#FBF9F5]">
            Saved &amp; History
          </h1>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-[#EFEAE0] p-1 dark:bg-[#10233D]">
          <button
            type="button"
            aria-pressed={subTab === 'bookmarks'}
            onClick={() => setSubTab('bookmarks')}
            className={`min-h-[38px] rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              subTab === 'bookmarks'
                ? 'bg-[#0B192C] text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]'
                : 'text-[#5C6470] hover:text-[#0B192C] dark:text-[#9AA6B8] dark:hover:text-[#FBF9F5]'
            }`}
          >
            Bookmarks ({bookmarkedAll.length})
          </button>
          <button
            type="button"
            aria-pressed={subTab === 'history'}
            onClick={() => setSubTab('history')}
            className={`min-h-[38px] rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              subTab === 'history'
                ? 'bg-[#0B192C] text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]'
                : 'text-[#5C6470] hover:text-[#0B192C] dark:text-[#9AA6B8] dark:hover:text-[#FBF9F5]'
            }`}
          >
            History ({readingHistory.length})
          </button>
        </div>
      </div>

      {subTab === 'bookmarks' ? (
        bookmarkedAll.length === 0 ? (
          <div className="rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-10 text-center dark:border-[#1E324D] dark:bg-[#10233D]">
            <Bookmark
              className="mx-auto h-7 w-7 text-[#B0893E]"
              aria-hidden="true"
            />
            <h2 className="mt-3 font-serif text-xl font-semibold text-[#0B192C] dark:text-[#FBF9F5]">
              No saved stories yet
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-[#5C6470] dark:text-[#9AA6B8]">
              Bookmark dispatches from your feed to keep them ready for offline
              reference.
            </p>
            <button
              type="button"
              onClick={onGoToHome}
              className="mt-5 min-h-[44px] rounded-lg bg-[#0B192C] px-5 py-2 text-xs font-semibold text-[#FBF9F5] hover:bg-[#162B47] dark:bg-[#B0893E] dark:text-[#0B192C]"
            >
              Browse Dispatch
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 max-w-md">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5C6470]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Search saved articles..."
                  aria-label="Search saved articles"
                  className="min-h-[40px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] pl-9 pr-3 text-xs text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                />
              </div>

              <div className="flex items-center gap-3">
                <label
                  htmlFor="saved-sort-select"
                  className="text-xs font-medium text-[#5C6470] dark:text-[#9AA6B8]"
                >
                  Sort by
                </label>
                <select
                  id="saved-sort-select"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                  className="min-h-[40px] rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 py-1.5 text-xs font-medium text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="publisher">Publisher</option>
                  <option value="category">Category</option>
                </select>
              </div>
            </div>

            {saved.length === 0 ? (
              <p className="py-8 text-center text-sm text-[#5C6470] dark:text-[#9AA6B8]">
                No saved articles match &ldquo;{filterQuery}&rdquo;.
              </p>
            ) : (
              <div>
                {saved.map((article) => (
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
            )}
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#5C6470] dark:text-[#9AA6B8]">
              {readingHistoryEnabled
                ? 'Articles opened in this workspace are recorded locally.'
                : 'Reading history recording is currently paused in Settings.'}
            </p>
            {readingHistory.length > 0 && (
              <button
                type="button"
                onClick={onClearReadingHistory}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#D8D0C0] px-3 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Clear history</span>
              </button>
            )}
          </div>

          {readingHistory.length === 0 ? (
            <div className="rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-10 text-center dark:border-[#1E324D] dark:bg-[#10233D]">
              <Clock className="mx-auto h-7 w-7 text-[#B0893E]" aria-hidden="true" />
              <h2 className="mt-3 font-serif text-xl font-semibold text-[#0B192C] dark:text-[#FBF9F5]">
                No reading history recorded
              </h2>
              <p className="mt-1.5 text-sm text-[#5C6470] dark:text-[#9AA6B8]">
                Opened stories will appear here when reading history is enabled.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E3DDD1] rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] dark:divide-[#1E324D] dark:border-[#1E324D] dark:bg-[#10233D]">
              {readingHistory.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#8E6A28] dark:text-[#D4AF6A]">
                      {entry.publisher}
                    </p>
                    <p className="truncate font-serif text-base font-medium text-[#0B192C] dark:text-[#FBF9F5]">
                      {entry.title}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-[#5C6470] dark:text-[#9AA6B8] tabular-nums">
                    {new Date(entry.openedAtIso).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
