import { useEffect, useState } from 'react';
import { Bookmark, Check, ExternalLink, Share2, X } from 'lucide-react';
import { Article } from '../../core/common/types';

interface ArticlePreviewModalProps {
  article: Article | null;
  showImages: boolean;
  onClose: () => void;
  onToggleBookmark: (articleId: string) => void;
}

export function ArticlePreviewModal({
  article,
  showImages,
  onClose,
  onToggleBookmark,
}: ArticlePreviewModalProps) {
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    setShareCopied(false);
    if (!article) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [article, onClose]);

  if (!article) return null;

  const paragraphs = article.excerpt.split('\n\n').filter(Boolean);

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: article.title,
          text: `${article.publisher} — ${article.title}`,
          url: article.url,
        });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(article.url);
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 2000);
      }
    } catch {
      // Ignore cancelled native share sheets
    }
  };

  let safeHostname = 'publisher';
  try {
    safeHostname = new URL(article.url).hostname;
  } catch {
    safeHostname = article.publisher;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="article-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/65 p-3 backdrop-blur-sm md:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#E3DDD1] bg-[#FBF9F5] p-6 shadow-2xl dark:border-[#1E324D] dark:bg-[#0B192C] md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between gap-4 border-b border-[#E3DDD1] pb-4 dark:border-[#1E324D]">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#5C6470] dark:text-[#9AA6B8]">
            <span className="font-semibold text-[#8E6A28] dark:text-[#D4AF6A]">
              {article.categoryName}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-[#0B192C] dark:text-[#FBF9F5]">
              {article.publisher}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {article.publishedLabel}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleShare}
              aria-label={`Share ${article.title}`}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-[#0B192C] hover:bg-[#EFEAE0] dark:text-[#D4AF6A] dark:hover:bg-[#132844]"
            >
              {shareCopied ? (
                <>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <Share2 className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={() => onToggleBookmark(article.id)}
              aria-pressed={article.isBookmarked}
              aria-label={
                article.isBookmarked
                  ? `Remove bookmark for ${article.title}`
                  : `Bookmark ${article.title}`
              }
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[#0B192C] hover:bg-[#EFEAE0] dark:text-[#D4AF6A] dark:hover:bg-[#132844]"
            >
              <Bookmark
                className="h-5 w-5"
                fill={article.isBookmarked ? 'currentColor' : 'none'}
              />
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close article preview"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[#5C6470] hover:bg-[#EFEAE0] hover:text-[#0B192C] dark:text-[#A4B0C0] dark:hover:bg-[#132844] dark:hover:text-[#FBF9F5]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mx-auto max-w-prose space-y-6">
          <header className="space-y-3">
            <h2
              id="article-modal-title"
              className="font-serif text-2xl font-semibold leading-tight text-[#0B192C] dark:text-[#FBF9F5] md:text-4xl"
            >
              {article.title}
            </h2>
            <p className="text-xs font-medium uppercase tracking-widest text-[#5C6470] dark:text-[#9AA6B8]">
              {article.author ? `By ${article.author} · ` : ''}
              {article.readTimeMinutes} min read
            </p>
          </header>

          {showImages && article.imageUrl && (
            <figure className="space-y-2">
              <img
                src={article.imageUrl}
                alt={article.imageAlt}
                referrerPolicy="no-referrer"
                className="aspect-[16/9] w-full rounded-xl border border-[#E3DDD1] object-cover dark:border-[#1E324D]"
              />
              <figcaption className="font-serif text-xs italic text-[#5C6470] dark:text-[#9AA6B8]">
                {article.imageAlt}
              </figcaption>
            </figure>
          )}

          <div className="space-y-4 text-base leading-[1.78] text-[#1E2A3A] dark:text-[#DCE3ED]">
            {paragraphs.map((paragraph, index) => (
              <p
                key={index}
                className={
                  index === 0
                    ? 'first-letter:float-left first-letter:mr-3 first-letter:mt-1 first-letter:font-serif first-letter:text-5xl first-letter:font-bold first-letter:leading-none first-letter:text-[#0B192C] dark:first-letter:text-[#D4AF6A]'
                    : ''
                }
              >
                {paragraph}
              </p>
            ))}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-[#E3DDD1] pt-5 dark:border-[#1E324D]">
            <p className="max-w-md text-xs text-[#5C6470] dark:text-[#9AA6B8]">
              Showing syndicated feed excerpt in accordance with publisher feed
              terms. Read the full report on the publisher&apos;s site.
            </p>
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[#D4CCB8] px-3.5 py-2 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#D4AF6A] dark:hover:bg-[#172E4D]"
            >
              <span>Open at {safeHostname}</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </footer>
        </div>
      </div>
    </div>
  );
}
