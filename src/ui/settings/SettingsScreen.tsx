import {
  AppPreferences,
  AppTheme,
  ArticleLayoutDensity,
  SortOrder,
  TextSizeOption,
} from '../../core/common/types';

interface SettingsScreenProps {
  preferences: AppPreferences;
  onUpdatePreferences: (patch: Partial<AppPreferences>) => void;
  onClearSearchHistory: () => void;
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div>
        <label
          htmlFor={id}
          className="text-sm font-medium text-[#0B192C] dark:text-[#FBF9F5]"
        >
          {label}
        </label>
        <p className="text-xs text-[#5C6470] dark:text-[#9AA6B8]">
          {description}
        </p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`min-h-[44px] min-w-[74px] shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
          checked
            ? 'border-[#0B192C] bg-[#0B192C] text-[#FBF9F5] dark:border-[#B0893E] dark:bg-[#B0893E] dark:text-[#0B192C]'
            : 'border-[#D8D0C0] bg-transparent text-[#5C6470] dark:border-[#294366] dark:text-[#9AA6B8]'
        }`}
      >
        {checked ? 'On' : 'Off'}
      </button>
    </div>
  );
}

export function SettingsScreen({
  preferences,
  onUpdatePreferences,
  onClearSearchHistory,
}: SettingsScreenProps) {
  return (
    <section aria-label="Settings" className="space-y-8">
      <div className="space-y-1 border-b border-[#E3DDD1] pb-5 dark:border-[#1E324D]">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8E6A28] dark:text-[#D4AF6A]">
          Configuration
        </p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-[#0B192C] dark:text-[#FBF9F5]">
          Settings
        </h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-6 dark:border-[#1E324D] dark:bg-[#10233D]">
          <h2 className="border-b border-[#ECE7DC] pb-3 font-serif text-xl font-semibold text-[#0B192C] dark:border-[#1E324D] dark:text-[#FBF9F5]">
            Appearance
          </h2>
          <div className="divide-y divide-[#F0ECE2] dark:divide-[#1B2E47]">
            <div className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="text-sm font-medium text-[#0B192C] dark:text-[#FBF9F5]">
                  Theme
                </p>
                <p className="text-xs text-[#5C6470] dark:text-[#9AA6B8]">
                  Warm paper light mode or deep navy dark mode
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-[#F3EFE6] p-1 dark:bg-[#0B192C]">
                {(['light', 'dark', 'system'] as AppTheme[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={preferences.theme === mode}
                    onClick={() => onUpdatePreferences({ theme: mode })}
                    className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                      preferences.theme === mode
                        ? 'bg-[#0B192C] text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]'
                        : 'text-[#5C6470] hover:text-[#0B192C] dark:text-[#9AA6B8] dark:hover:text-[#FBF9F5]'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="text-sm font-medium text-[#0B192C] dark:text-[#FBF9F5]">
                  Article Layout
                </p>
                <p className="text-xs text-[#5C6470] dark:text-[#9AA6B8]">
                  Editorial salience hierarchy or compact headline list
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-[#F3EFE6] p-1 dark:bg-[#0B192C]">
                {(['editorial', 'compact'] as ArticleLayoutDensity[]).map(
                  (density) => (
                    <button
                      key={density}
                      type="button"
                      aria-pressed={preferences.layoutDensity === density}
                      onClick={() =>
                        onUpdatePreferences({ layoutDensity: density })
                      }
                      className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                        preferences.layoutDensity === density
                          ? 'bg-[#0B192C] text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]'
                          : 'text-[#5C6470] hover:text-[#0B192C] dark:text-[#9AA6B8] dark:hover:text-[#FBF9F5]'
                      }`}
                    >
                      {density}
                    </button>
                  ),
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <p className="text-sm font-medium text-[#0B192C] dark:text-[#FBF9F5]">
                  Text Size
                </p>
                <p className="text-xs text-[#5C6470] dark:text-[#9AA6B8]">
                  Adjust headline and excerpt typography scale
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-[#F3EFE6] p-1 dark:bg-[#0B192C]">
                {(['small', 'medium', 'large'] as TextSizeOption[]).map(
                  (size) => (
                    <button
                      key={size}
                      type="button"
                      aria-pressed={preferences.textSize === size}
                      onClick={() => onUpdatePreferences({ textSize: size })}
                      className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                        preferences.textSize === size
                          ? 'bg-[#0B192C] text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]'
                          : 'text-[#5C6470] hover:text-[#0B192C] dark:text-[#9AA6B8] dark:hover:text-[#FBF9F5]'
                      }`}
                    >
                      {size}
                    </button>
                  ),
                )}
              </div>
            </div>

            <ToggleRow
              id="toggle-show-images"
              label="Display Article Images"
              description="Show editorial photography on feed cards and previews"
              checked={preferences.showImages}
              onChange={(showImages) => onUpdatePreferences({ showImages })}
            />
          </div>
        </div>

        <div className="rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-6 dark:border-[#1E324D] dark:bg-[#10233D]">
          <h2 className="border-b border-[#ECE7DC] pb-3 font-serif text-xl font-semibold text-[#0B192C] dark:border-[#1E324D] dark:text-[#FBF9F5]">
            News Preferences
          </h2>
          <div className="divide-y divide-[#F0ECE2] dark:divide-[#1B2E47]">
            <div className="flex items-center justify-between gap-4 py-4">
              <label
                htmlFor="pref-articles-per-page"
                className="text-sm font-medium text-[#0B192C] dark:text-[#FBF9F5]"
              >
                Articles Per Page
              </label>
              <select
                id="pref-articles-per-page"
                value={preferences.articlesPerPage}
                onChange={(e) =>
                  onUpdatePreferences({
                    articlesPerPage: Number(
                      e.target.value,
                    ) as AppPreferences['articlesPerPage'],
                  })
                }
                className="min-h-[40px] rounded-lg border border-[#D8D0C0] bg-[#FBF9F5] px-3 text-xs font-semibold text-[#0B192C] dark:border-[#243B5C] dark:bg-[#0B192C] dark:text-[#FBF9F5]"
              >
                {[10, 20, 30, 50, 100].map((count) => (
                  <option key={count} value={count}>
                    {count} articles
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-4 py-4">
              <label
                htmlFor="pref-sort-order"
                className="text-sm font-medium text-[#0B192C] dark:text-[#FBF9F5]"
              >
                Default Article Sorting
              </label>
              <select
                id="pref-sort-order"
                value={preferences.sortOrder}
                onChange={(e) =>
                  onUpdatePreferences({
                    sortOrder: e.target.value as SortOrder,
                  })
                }
                className="min-h-[40px] rounded-lg border border-[#D8D0C0] bg-[#FBF9F5] px-3 text-xs font-semibold text-[#0B192C] dark:border-[#243B5C] dark:bg-[#0B192C] dark:text-[#FBF9F5]"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="publisher">Publisher</option>
                <option value="category">Category</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-4 py-4">
              <label
                htmlFor="pref-refresh-interval"
                className="text-sm font-medium text-[#0B192C] dark:text-[#FBF9F5]"
              >
                Background Refresh Interval
              </label>
              <select
                id="pref-refresh-interval"
                value={preferences.refreshIntervalMinutes}
                onChange={(e) =>
                  onUpdatePreferences({
                    refreshIntervalMinutes: Number(
                      e.target.value,
                    ) as AppPreferences['refreshIntervalMinutes'],
                  })
                }
                className="min-h-[40px] rounded-lg border border-[#D8D0C0] bg-[#FBF9F5] px-3 text-xs font-semibold text-[#0B192C] dark:border-[#243B5C] dark:bg-[#0B192C] dark:text-[#FBF9F5]"
              >
                <option value={15}>Every 15 minutes</option>
                <option value={30}>Every 30 minutes</option>
                <option value={60}>Every 1 hour</option>
                <option value={180}>Every 3 hours</option>
                <option value={360}>Every 6 hours</option>
                <option value={720}>Every 12 hours</option>
                <option value={0}>Manual only</option>
              </select>
            </div>

            <ToggleRow
              id="toggle-wifi-only"
              label="Wi-Fi Only Updates"
              description="Defer scheduled feed synchronization on metered networks"
              checked={preferences.wifiOnlyUpdates}
              onChange={(wifiOnlyUpdates) =>
                onUpdatePreferences({ wifiOnlyUpdates })
              }
            />
          </div>
        </div>

        <div className="rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-6 dark:border-[#1E324D] dark:bg-[#10233D]">
          <h2 className="border-b border-[#ECE7DC] pb-3 font-serif text-xl font-semibold text-[#0B192C] dark:border-[#1E324D] dark:text-[#FBF9F5]">
            Notifications &amp; Privacy
          </h2>
          <div className="divide-y divide-[#F0ECE2] dark:divide-[#1B2E47]">
            <ToggleRow
              id="toggle-breaking-notif"
              label="Breaking News Alerts"
              description="Notify when major dispatch updates arrive"
              checked={preferences.breakingNotifications}
              onChange={(breakingNotifications) =>
                onUpdatePreferences({ breakingNotifications })
              }
            />
            <ToggleRow
              id="toggle-category-notif"
              label="Selected Category Alerts"
              description="Send summaries for your active subscribed categories"
              checked={preferences.categoryNotifications}
              onChange={(categoryNotifications) =>
                onUpdatePreferences({ categoryNotifications })
              }
            />
            <div className="flex items-center justify-between gap-4 py-4">
              <label
                htmlFor="pref-notif-frequency"
                className="text-sm font-medium text-[#0B192C] dark:text-[#FBF9F5]"
              >
                Notification Frequency
              </label>
              <select
                id="pref-notif-frequency"
                value={preferences.notificationFrequency}
                onChange={(e) =>
                  onUpdatePreferences({
                    notificationFrequency: e.target
                      .value as AppPreferences['notificationFrequency'],
                  })
                }
                className="min-h-[40px] rounded-lg border border-[#D8D0C0] bg-[#FBF9F5] px-3 text-xs font-semibold text-[#0B192C] dark:border-[#243B5C] dark:bg-[#0B192C] dark:text-[#FBF9F5]"
              >
                <option value="immediate">Immediate</option>
                <option value="hourly">Hourly digest</option>
                <option value="daily">Daily briefing</option>
              </select>
            </div>
            <ToggleRow
              id="toggle-reading-history"
              label="Reading History"
              description="Record opened articles locally for quick reference"
              checked={preferences.readingHistoryEnabled}
              onChange={(readingHistoryEnabled) =>
                onUpdatePreferences({ readingHistoryEnabled })
              }
            />
            <ToggleRow
              id="toggle-search-history"
              label="Search History"
              description="Remember recent local searches on the Search tab"
              checked={preferences.searchHistoryEnabled}
              onChange={(searchHistoryEnabled) =>
                onUpdatePreferences({ searchHistoryEnabled })
              }
            />
            <ToggleRow
              id="toggle-privacy-screen"
              label="Privacy Screen Blur"
              description="Shield displayed reading views when switching tabs or backgrounding"
              checked={preferences.privacyScreenEnabled}
              onChange={(privacyScreenEnabled) =>
                onUpdatePreferences({ privacyScreenEnabled })
              }
            />
            <div className="flex items-center justify-between py-4">
              <span className="text-xs text-[#5C6470] dark:text-[#9AA6B8]">
                Clear stored recent search terms
              </span>
              <button
                type="button"
                onClick={onClearSearchHistory}
                className="min-h-[40px] rounded-lg border border-[#D8D0C0] px-3.5 py-1.5 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
              >
                Clear Search History
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] p-6 dark:border-[#1E324D] dark:bg-[#10233D]">
          <h2 className="border-b border-[#ECE7DC] pb-3 font-serif text-xl font-semibold text-[#0B192C] dark:border-[#1E324D] dark:text-[#FBF9F5]">
            About Newsie
          </h2>
          <dl className="mt-3 divide-y divide-[#F0ECE2] text-sm dark:divide-[#1B2E47]">
            <div className="flex justify-between py-2.5">
              <dt className="text-[#5C6470] dark:text-[#9AA6B8]">Release</dt>
              <dd className="font-mono text-xs font-medium text-[#0B192C] dark:text-[#FBF9F5]">
                1.0
              </dd>
            </div>
            <div className="flex justify-between py-2.5">
              <dt className="text-[#5C6470] dark:text-[#9AA6B8]">
                Local Storage
              </dt>
              <dd className="text-xs font-medium text-[#0B192C] dark:text-[#FBF9F5]">
                SQLite · RSS/Atom · OPML
              </dd>
            </div>
            <div className="flex justify-between py-2.5">
              <dt className="text-[#5C6470] dark:text-[#9AA6B8]">Privacy</dt>
              <dd className="text-xs font-medium text-[#0B192C] dark:text-[#FBF9F5]">
                Local-first · Zero Telemetry
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
