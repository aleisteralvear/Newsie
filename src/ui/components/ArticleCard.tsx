import { useState } from 'react';
import { Bookmark, Newspaper } from 'lucide-react';
import { Article, TextSizeOption } from '../../core/common/types';

interface ArticleCardProps {
  article: Article;
  variant: 'lead' | 'feature' | 'compact';
  showImages: boolean;
  textSize: TextSizeOption;
  onToggleBookmark: (articleId: string) => void;
  onOpenArticle: (article: Article) => void;
}

function getHeadlineSizeClass(
  variant: ArticleCardProps['variant'],
  textSize: TextSizeOption,
): string {
  if (variant === 'lead') {
    if (textSize === 'small') return 'text-2xl md:text-3xl leading-tight';
    if (textSize === 'large') return 'text-3xl md:text-4xl leading-[1.12]';
    return 'text-2xl md:text-[2rem] leading-[1.15]';
  }
  if (variant === 'feature') {
    if (textSize === 'small') return 'text-lg leading-snug';
    if (textSize === 'large') return 'text-2xl leading-snug';
    return 'text-xl leading-snug';
  }
  if (textSize === 'small') return 'text-base leading-snug';
  if (textSize === 'large') return 'text-xl leading-snug';
  return 'text-lg leading-snug';
}

function getBodySizeClass(textSize: TextSizeOption): string {
  if (textSize === 'small') return 'text-xs leading-relaxed';
  if (textSize === 'large') return 'text-base leading-relaxed';
  return 'text-sm leading-relaxed';
}

function EditorialImage({
  imageUrl,
  imageAlt,
  publisher,
  aspectClass,
}: {
  imageUrl?: string;
  imageAlt: string;
  publisher: string;
  aspectClass: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (!imageUrl || hasError) {
    return (
      <div
        className={`flex w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#10233D] to-[#1D3658] px-6 text-center text-[#FBF9F5]/80 ${aspectClass}`}
      >
        <Newspaper className="h-7 w-7 text-[#D4AF6A]" aria-hidden="true" />
        <span className="font-serif text-sm tracking-wide">{publisher}</span>
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={imageAlt}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={`w-full object-cover ${aspectClass}`}
    />
  );
}

export function ArticleCard({
  article,
  variant,
  showImages,
  textSize,
  onToggleBookmark,
  onOpenArticle,
}: ArticleCardProps) {
  const headlineClass = getHeadlineSizeClass(variant, textSize);
  const bodyClass = getBodySizeClass(textSize);

  const bookmarkButton = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggleBookmark(article.id);
      }}
      aria-pressed={article.isBookmarked}
      aria-label={
        article.isBookmarked
          ? `Remove bookmark for ${article.title}`
          : `Bookmark ${article.title}`
      }
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B0893E] ${
        article.isBookmarked
          ? 'text-[#B0893E] hover:bg-[#B0893E]/10 dark:text-[#D4AF6A]'
          : 'text-[#5C6470] hover:bg-[#EFEAE0] hover:text-[#0B192C] dark:text-[#98A4B5] dark:hover:bg-[#172E4D] dark:hover:text-[#FBF9F5]'
      }`}
    >
      <Bookmark
        className="h-4 w-4"
        fill={article.isBookmarked ? 'currentColor' : 'none'}
        aria-hidden="true"
      />
    </button>
  );

  const metaLine = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#5C6470] dark:text-[#9AA6B8]">
      <span className="font-semibold text-[#8E6A28] dark:text-[#D4AF6A]">
        {article.categoryName}
      </span>
      <span aria-hidden="true">·</span>
      <span className="font-medium text-[#2A374A] dark:text-[#D9E0EA]">
        {article.publisher}
      </span>
      <span aria-hidden="true">·</span>
      <span className="font-mono tabular-nums">{article.publishedLabel}</span>
      <span aria-hidden="true">·</span>
      <span className="tabular-nums">{article.readTimeMinutes} min read</span>
    </div>
  );

  if (variant === 'lead') {
    return (
      <article className="border-b border-[#E3DDD1] pb-8 dark:border-[#1E324D]">
        <div
          className={`grid gap-6 ${
            showImages ? 'lg:grid-cols-12 lg:items-stretch' : ''
          }`}
        >
          {showImages && (
            <div className="overflow-hidden rounded-xl border border-[#E3DDD1] dark:border-[#1E324D] lg:col-span-7">
              <button
                type="button"
                aria-label={`Open article: ${article.title}`}
                onClick={() => onOpenArticle(article)}
                className="block h-full w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B0893E]"
              >
                <EditorialImage
                  imageUrl={article.imageUrl}
                  imageAlt={article.imageAlt}
                  publisher={article.publisher}
                  aspectClass="aspect-[16/9] lg:h-full lg:aspect-auto min-h-[240px]"
                />
              </button>
            </div>
          )}

          <div
            className={`flex flex-col justify-between gap-5 ${
              showImages ? 'lg:col-span-5' : ''
            }`}
          >
            <div className="space-y-3">
              {metaLine}
              <h2
                className={`font-serif font-semibold tracking-tight text-[#0B192C] dark:text-[#FBF9F5] ${headlineClass}`}
              >
                <button
                  type="button"
                  onClick={() => onOpenArticle(article)}
                  className="text-left hover:text-[#8E6A28] dark:hover:text-[#D4AF6A] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B0893E]"
                >
                  {article.title}
                </button>
              </h2>
              <p
                className={`text-[#3C4655] dark:text-[#C5CEDB] ${bodyClass}`}
              >
                {article.description}
              </p>
            </div>

            <div className="flex items-center justify-between border-t border-[#ECE7DC] pt-3 dark:border-[#1B2E47]">
              <button
                type="button"
                onClick={() => onOpenArticle(article)}
                className="min-h-[44px] py-2 text-xs font-semibold uppercase tracking-wider text-[#0B192C] hover:text-[#B0893E] dark:text-[#D4AF6A] dark:hover:text-[#FBF9F5] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B0893E]"
              >
                Read Briefing
              </button>
              {bookmarkButton}
            </div>
          </div>
        </div>
      </article>
    );
  }

  if (variant === 'feature') {
    return (
      <article className="flex flex-col justify-between rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-4 dark:border-[#1E324D] dark:bg-[#10233D]">
        <div className="space-y-3.5">
          {showImages && (
            <button
              type="button"
              aria-label={`Open article: ${article.title}`}
              onClick={() => onOpenArticle(article)}
              className="block w-full overflow-hidden rounded-lg border border-[#ECE7DC] dark:border-[#1E324D] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B0893E]"
            >
              <EditorialImage
                imageUrl={article.imageUrl}
                imageAlt={article.imageAlt}
                publisher={article.publisher}
                aspectClass="aspect-[4/3]"
              />
            </button>
          )}
          {metaLine}
          <h3
            className={`font-serif font-semibold tracking-tight text-[#0B192C] dark:text-[#FBF9F5] ${headlineClass}`}
          >
            <button
              type="button"
              onClick={() => onOpenArticle(article)}
              className="text-left hover:text-[#8E6A28] dark:hover:text-[#D4AF6A] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B0893E]"
            >
              {article.title}
            </button>
          </h3>
          <p className={`text-[#4A5565] dark:text-[#B9C4D4] ${bodyClass}`}>
            {article.description}
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-[#F0ECE2] pt-2 dark:border-[#1B2E47]">
          <button
            type="button"
            onClick={() => onOpenArticle(article)}
            className="min-h-[44px] py-2 text-xs font-semibold uppercase tracking-wider text-[#0B192C] hover:text-[#B0893E] dark:text-[#D4AF6A] dark:hover:text-[#FBF9F5] transition-colors"
          >
            Read Story
          </button>
          {bookmarkButton}
        </div>
      </article>
    );
  }

  return (
    <article className="flex items-start justify-between gap-4 border-b border-[#E3DDD1] py-5 dark:border-[#1E324D]">
      <div className="min-w-0 flex-1 space-y-1.5">
        {metaLine}
        <h3
          className={`font-serif font-semibold tracking-tight text-[#0B192C] dark:text-[#FBF9F5] ${headlineClass}`}
        >
          <button
            type="button"
            onClick={() => onOpenArticle(article)}
            className="text-left hover:text-[#8E6A28] dark:hover:text-[#D4AF6A] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B0893E]"
          >
            {article.title}
          </button>
        </h3>
        <p
          className={`line-clamp-2 text-[#4A5565] dark:text-[#B9C4D4] ${bodyClass}`}
        >
          {article.description}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {showImages && article.imageUrl && (
          <button
            type="button"
            onClick={() => onOpenArticle(article)}
            aria-label={`Open ${article.title}`}
            className="hidden sm:block h-20 w-28 overflow-hidden rounded-lg border border-[#E3DDD1] dark:border-[#1E324D]"
          >
            <EditorialImage
              imageUrl={article.imageUrl}
              imageAlt={article.imageAlt}
              publisher={article.publisher}
              aspectClass="h-full w-full"
            />
          </button>
        )}
        {bookmarkButton}
      </div>
    </article>
  );
}
