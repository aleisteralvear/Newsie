import { Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import { NavTab, WorkspaceSummary } from '../../core/common/types';

interface TopBarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  activeWorkspace: WorkspaceSummary | null;
  onLockWorkspace?: () => void;
}

const NAV_ITEMS: { id: NavTab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'search', label: 'Search' },
  { id: 'saved', label: 'Saved' },
  { id: 'sources', label: 'Sources' },
  { id: 'settings', label: 'Settings' },
];

export function TopBar({
  activeTab,
  onSelectTab,
  onRefresh,
  isRefreshing,
  activeWorkspace,
  onLockWorkspace,
}: TopBarProps) {
  const isPrivateActive = Boolean(activeWorkspace?.isPrivate);

  return (
    <header className="sticky top-0 z-30 h-13 md:h-16 border-b border-[#E3DDD1] dark:border-[#1E324D] bg-[#FBF9F5]/95 dark:bg-[#0B192C]/95 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-4 px-4 md:gap-6 md:px-8">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onSelectTab('home')}
            className="font-serif text-2xl font-semibold tracking-tight text-[#0B192C] dark:text-[#FBF9F5] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B0893E]"
          >
            Newsie
          </button>

          {isPrivateActive && activeWorkspace && (
            <button
              type="button"
              onClick={() => onSelectTab('settings')}
              title="Active private workspace — manage in Settings"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-[#B0893E]/50 bg-[#EFEAE0]/70 px-2.5 py-1 text-[11px] font-semibold text-[#0B192C] hover:border-[#B0893E] dark:border-[#B0893E]/40 dark:bg-[#10233D] dark:text-[#D4AF6A]"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-[#B0893E]" aria-hidden="true" />
              <span className="max-w-[120px] truncate">{activeWorkspace.displayName}</span>
            </button>
          )}
        </div>

        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-7"
        >
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`py-1.5 text-sm font-medium transition-colors duration-150 whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B0893E] ${
                  active
                    ? 'border-[#B0893E] text-[#0B192C] dark:text-[#FBF9F5]'
                    : 'border-transparent text-[#5C6470] hover:text-[#0B192C] dark:text-[#A4B0C0] dark:hover:text-[#FBF9F5]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          {isPrivateActive && onLockWorkspace && (
            <button
              type="button"
              onClick={onLockWorkspace}
              aria-label="Lock private workspace"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#D8D0C0] px-3 py-2 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
            >
              <Lock className="h-3.5 w-3.5 text-[#B0893E]" aria-hidden="true" />
              <span className="hidden sm:inline">Lock</span>
            </button>
          )}

          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label={isRefreshing ? 'Refreshing feed' : 'Refresh feed'}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[#0B192C] px-4 py-2 text-xs font-semibold tracking-wide text-[#FBF9F5] transition-colors duration-150 hover:bg-[#162B47] disabled:opacity-65 dark:bg-[#B0893E] dark:text-[#0B192C] dark:hover:bg-[#C7A154] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B0893E]"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{isRefreshing ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
