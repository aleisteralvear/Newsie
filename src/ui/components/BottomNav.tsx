import { useRef } from 'react';
import { Bookmark, Compass, Home, Search, Settings } from 'lucide-react';
import { NavTab } from '../../core/common/types';

interface BottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  doubleTapIntervalMs?: number;
  onTriggerPrivateAccess?: () => void;
}

const MOBILE_TABS: {
  id: NavTab;
  label: string;
  icon: typeof Home;
}[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'sources', label: 'Sources', icon: Compass },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function BottomNav({
  activeTab,
  onSelectTab,
  doubleTapIntervalMs = 350,
  onTriggerPrivateAccess,
}: BottomNavProps) {
  const lastSearchTapRef = useRef<number>(0);

  const handleClick = (tabId: NavTab) => {
    onSelectTab(tabId);
    if (tabId !== 'search' || !onTriggerPrivateAccess) return;

    const now = Date.now();
    if (
      lastSearchTapRef.current > 0 &&
      now - lastSearchTapRef.current <= doubleTapIntervalMs
    ) {
      lastSearchTapRef.current = 0;
      onTriggerPrivateAccess();
      return;
    }
    lastSearchTapRef.current = now;
  };

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed bottom-0 left-0 right-0 z-40 h-14 border-t border-[#E3DDD1] bg-[#FBF9F5]/95 backdrop-blur-md dark:border-[#1E324D] dark:bg-[#0B192C]/95 md:hidden"
    >
      <div className="grid h-full grid-cols-5 items-center">
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleClick(tab.id)}
              onKeyDown={(e) => {
                if (
                  tab.id === 'search' &&
                  e.shiftKey &&
                  e.key === 'Enter' &&
                  onTriggerPrivateAccess
                ) {
                  e.preventDefault();
                  lastSearchTapRef.current = 0;
                  onTriggerPrivateAccess();
                }
              }}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#B0893E] ${
                active
                  ? 'text-[#0B192C] dark:text-[#D4AF6A]'
                  : 'text-[#5C6470] dark:text-[#98A4B5]'
              }`}
            >
              <Icon
                className={`h-5 w-5 ${
                  active ? 'text-[#B0893E] dark:text-[#D4AF6A]' : ''
                }`}
                strokeWidth={active ? 2.25 : 1.75}
                aria-hidden="true"
              />
              <span className="whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
