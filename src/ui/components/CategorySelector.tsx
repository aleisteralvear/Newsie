import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Category } from '../../core/common/types';
import { ALL_NEWS_CATEGORY_ID } from '../../news/categories/defaultCategories';

interface CategorySelectorProps {
  categories: Category[];
  selectedCategoryId: string;
  onSelectCategory: (categoryId: string) => void;
}

export function CategorySelector({
  categories,
  selectedCategoryId,
  onSelectCategory,
}: CategorySelectorProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const enabledCategories = categories
    .filter((c) => c.enabled)
    .sort((a, b) => a.order - b.order);

  const items = [
    { id: ALL_NEWS_CATEGORY_ID, name: 'All News' },
    ...enabledCategories.map((c) => ({ id: c.id, name: c.name })),
  ];

  const scrollByAmount = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
    <div className="relative flex items-center gap-1 border-b border-[#E3DDD1] py-2.5 dark:border-[#1E324D]">
      <button
        type="button"
        onClick={() => scrollByAmount(-240)}
        aria-label="Scroll categories left"
        className="hidden sm:inline-flex min-h-[40px] min-w-[36px] shrink-0 items-center justify-center rounded-md text-[#5C6470] hover:bg-[#EFEAE0] hover:text-[#0B192C] dark:text-[#9AA6B8] dark:hover:bg-[#132844] dark:hover:text-[#FBF9F5]"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>

      <div className="relative min-w-0 flex-1">
        <div
          ref={scrollRef}
          role="tablist"
          aria-label="News categories"
          className="no-scrollbar flex items-center gap-2 overflow-x-auto pr-8"
        >
          {items.map((item) => {
            const active = selectedCategoryId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectCategory(item.id)}
                className={`min-h-[40px] rounded-md px-3.5 py-2 text-xs font-semibold tracking-wide transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B0893E] ${
                  active
                    ? 'bg-[#0B192C] text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]'
                    : 'text-[#4D5663] hover:bg-[#EFEAE0] hover:text-[#0B192C] dark:text-[#A4B0C0] dark:hover:bg-[#132844] dark:hover:text-[#FBF9F5]'
                }`}
              >
                {item.name}
              </button>
            );
          })}
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#FBF9F5] to-transparent dark:from-[#0B192C]"
        />
      </div>

      <button
        type="button"
        onClick={() => scrollByAmount(240)}
        aria-label="Scroll categories right"
        className="hidden sm:inline-flex min-h-[40px] min-w-[36px] shrink-0 items-center justify-center rounded-md text-[#5C6470] hover:bg-[#EFEAE0] hover:text-[#0B192C] dark:text-[#9AA6B8] dark:hover:bg-[#132844] dark:hover:text-[#FBF9F5]"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
