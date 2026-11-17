import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  Edit3,
  Plus,
  Rss,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Category, NewsSource } from '../../core/common/types';
import { apiClient } from '../../core/network/apiClient';

export interface DirectoryEntry {
  id: string;
  name: string;
  url: string;
  format: 'RSS' | 'Atom';
  categoryId: string;
  description: string;
}

interface SourcesScreenProps {
  workspaceId: string;
  sources: NewsSource[];
  directory: DirectoryEntry[];
  categories: Category[];
  onToggleSource: (sourceId: string) => void;
  onUpdateSource: (
    sourceId: string,
    patch: Partial<Pick<NewsSource, 'name' | 'categoryId'>>,
  ) => Promise<void>;
  onRemoveSource: (sourceId: string) => Promise<void>;
  onAddValidatedSource: (payload: {
    url: string;
    name?: string;
    categoryId: string;
    format?: 'RSS' | 'Atom';
    description?: string;
    skipNetwork?: boolean;
  }) => Promise<void>;
  onImportOpml: (opmlXml: string) => Promise<number>;
}

export function SourcesScreen({
  workspaceId,
  sources,
  directory,
  categories,
  onToggleSource,
  onUpdateSource,
  onRemoveSource,
  onAddValidatedSource,
  onImportOpml,
}: SourcesScreenProps) {
  const [subTab, setSubTab] = useState<'active' | 'directory'>('active');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isOpmlOpen, setIsOpmlOpen] = useState(false);

  const [urlInput, setUrlInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [categoryIdInput, setCategoryIdInput] = useState('world');
  const [formatInput, setFormatInput] = useState<'RSS' | 'Atom'>('RSS');
  const [descInput, setDescInput] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    title?: string;
    format?: 'RSS' | 'Atom';
    articleCount?: number;
    sampleHeadlines?: string[];
    httpsRecommendedWarning?: string;
    errorMessage?: string;
  } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('world');
  const [testingStatus, setTestingStatus] = useState<Record<string, string>>({});

  const [opmlText, setOpmlText] = useState('');
  const [opmlFeedback, setOpmlFeedback] = useState<string | null>(null);

  const enabledCount = sources.filter((s) => s.enabled).length;
  const subscribedUrls = new Set(sources.map((s) => s.url.toLowerCase()));

  const getCategoryName = (categoryId: string) =>
    categories.find((c) => c.id === categoryId)?.name ?? 'General';

  const handleValidate = async () => {
    setIsValidating(true);
    setValidationResult(null);
    try {
      const res = await apiClient.validateFeedUrl(urlInput);
      setValidationResult(res);
      if (res.title && !nameInput.trim()) setNameInput(res.title);
      if (res.format) setFormatInput(res.format);
      if (res.description && !descInput.trim()) setDescInput(res.description);
    } catch (err) {
      setValidationResult({
        valid: false,
        errorMessage: (err as Error).message,
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleSubmitNewSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setIsSaving(true);
    try {
      await onAddValidatedSource({
        url: urlInput.trim(),
        name: nameInput.trim() || undefined,
        categoryId: categoryIdInput,
        format: formatInput,
        description: descInput.trim() || undefined,
      });
      setUrlInput('');
      setNameInput('');
      setDescInput('');
      setValidationResult(null);
      setIsAddOpen(false);
    } catch (err) {
      setValidationResult({
        valid: false,
        errorMessage: (err as Error).message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestSource = async (sourceId: string) => {
    setTestingStatus((prev) => ({ ...prev, [sourceId]: 'Testing...' }));
    try {
      const res = await apiClient.testSource(workspaceId, sourceId);
      setTestingStatus((prev) => ({
        ...prev,
        [sourceId]: res.valid
          ? `Healthy (${res.articleCount ?? 0} items)`
          : res.errorMessage ?? 'Check failed',
      }));
    } catch (err) {
      setTestingStatus((prev) => ({
        ...prev,
        [sourceId]: (err as Error).message,
      }));
    }
  };

  const handleOpmlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const count = await onImportOpml(opmlText);
      setOpmlFeedback(`Imported ${count} new subscription${count === 1 ? '' : 's'}.`);
      setOpmlText('');
    } catch (err) {
      setOpmlFeedback((err as Error).message);
    }
  };

  return (
    <section aria-label="News sources" className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-[#E3DDD1] pb-5 dark:border-[#1E324D] lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8E6A28] dark:text-[#D4AF6A]">
            Subscriptions &amp; Discovery
          </p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-[#0B192C] dark:text-[#FBF9F5]">
            News Sources
          </h1>
          <p className="text-sm text-[#5C6470] dark:text-[#9AA6B8] tabular-nums">
            {enabledCount} of {sources.length} publishers active
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              try {
                const xml = await apiClient.exportOpml(workspaceId);
                const blob = new Blob([xml], {
                  type: 'application/xml;charset=utf-8',
                });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'newsie-subscriptions.opml';
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
              } catch (err) {
                setOpmlFeedback((err as Error).message);
                setIsOpmlOpen(true);
              }
            }}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-[#D8D0C0] px-3.5 py-2 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Export OPML</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setOpmlFeedback(null);
              setIsOpmlOpen(true);
            }}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-[#D8D0C0] px-3.5 py-2 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Import OPML</span>
          </button>

          <button
            type="button"
            onClick={() => setIsAddOpen(true)}
            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-[#0B192C] px-4 py-2 text-xs font-semibold text-[#FBF9F5] hover:bg-[#162B47] dark:bg-[#B0893E] dark:text-[#0B192C] dark:hover:bg-[#C7A154]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Add Source</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 self-start rounded-lg bg-[#EFEAE0] p-1 w-fit dark:bg-[#10233D]">
        <button
          type="button"
          aria-pressed={subTab === 'active'}
          onClick={() => setSubTab('active')}
          className={`min-h-[38px] rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
            subTab === 'active'
              ? 'bg-[#0B192C] text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]'
              : 'text-[#5C6470] hover:text-[#0B192C] dark:text-[#9AA6B8] dark:hover:text-[#FBF9F5]'
          }`}
        >
          Subscriptions ({sources.length})
        </button>
        <button
          type="button"
          aria-pressed={subTab === 'directory'}
          onClick={() => setSubTab('directory')}
          className={`min-h-[38px] rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
            subTab === 'directory'
              ? 'bg-[#0B192C] text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]'
              : 'text-[#5C6470] hover:text-[#0B192C] dark:text-[#9AA6B8] dark:hover:text-[#FBF9F5]'
          }`}
        >
          Source Directory ({directory.length})
        </button>
      </div>

      {subTab === 'active' ? (
        <div className="divide-y divide-[#E3DDD1] rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] dark:divide-[#1E324D] dark:border-[#1E324D] dark:bg-[#10233D]">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#5C6470] dark:text-[#9AA6B8]">
                  <span className="font-semibold text-[#8E6A28] dark:text-[#D4AF6A]">
                    {getCategoryName(source.categoryId)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{source.format}</span>
                  <span aria-hidden="true">·</span>
                  <span>{testingStatus[source.id] ?? source.lastUpdatedLabel}</span>
                </div>

                {editingId === source.id ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="min-h-[38px] rounded-lg border border-[#B0893E] bg-[#FBF9F5] px-3 text-sm text-[#0B192C] dark:bg-[#0B192C] dark:text-[#FBF9F5]"
                    />
                    <select
                      value={editCategoryId}
                      onChange={(e) => setEditCategoryId(e.target.value)}
                      className="min-h-[38px] rounded-lg border border-[#D8D0C0] bg-[#FBF9F5] px-3 text-xs text-[#0B192C] dark:border-[#243B5C] dark:bg-[#0B192C] dark:text-[#FBF9F5]"
                    >
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        await onUpdateSource(source.id, {
                          name: editName.trim() || source.name,
                          categoryId: editCategoryId,
                        });
                        setEditingId(null);
                      }}
                      className="min-h-[38px] rounded-lg bg-[#0B192C] px-3 text-xs font-semibold text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="min-h-[38px] px-2 text-xs text-[#5C6470]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <h2 className="font-serif text-lg font-semibold text-[#0B192C] dark:text-[#FBF9F5]">
                    {source.name}
                  </h2>
                )}

                {source.description && (
                  <p className="text-sm text-[#4A5565] dark:text-[#B9C4D4]">
                    {source.description}
                  </p>
                )}

                <p className="truncate font-mono text-xs text-[#6B7482] dark:text-[#8492A6]">
                  {source.url}
                </p>
              </div>

              <div className="flex flex-wrap shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleTestSource(source.id)}
                  className="min-h-[40px] rounded-lg border border-[#D8D0C0] px-3 text-xs font-medium text-[#0B192C] hover:bg-[#F3EFE6] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
                >
                  Test
                </button>
                <button
                  type="button"
                  aria-label={`Edit ${source.name}`}
                  onClick={() => {
                    setEditingId(source.id);
                    setEditName(source.name);
                    setEditCategoryId(source.categoryId);
                  }}
                  className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[#D8D0C0] text-[#5C6470] hover:bg-[#F3EFE6] dark:border-[#294366] dark:text-[#9AA6B8] dark:hover:bg-[#172E4D]"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${source.name}`}
                  onClick={() => onRemoveSource(source.id)}
                  className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-[#D8D0C0] text-red-700 hover:bg-red-50 dark:border-[#294366] dark:text-red-300 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={source.enabled}
                  aria-label={`Toggle ${source.name}`}
                  onClick={() => onToggleSource(source.id)}
                  className={`min-h-[40px] min-w-[84px] rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors ${
                    source.enabled
                      ? 'border-[#0B192C] bg-[#0B192C] text-[#FBF9F5] dark:border-[#B0893E] dark:bg-[#B0893E] dark:text-[#0B192C]'
                      : 'border-[#D8D0C0] bg-transparent text-[#5C6470] hover:bg-[#F3EFE6] dark:border-[#294366] dark:text-[#9AA6B8] dark:hover:bg-[#172E4D]'
                  }`}
                >
                  {source.enabled ? 'Enabled' : 'Paused'}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-[#E3DDD1] rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] dark:divide-[#1E324D] dark:border-[#1E324D] dark:bg-[#10233D]">
          {directory.map((entry) => {
            const isSubscribed = subscribedUrls.has(entry.url.toLowerCase());
            return (
              <div
                key={entry.id}
                className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 text-xs text-[#5C6470] dark:text-[#9AA6B8]">
                    <span className="font-semibold text-[#8E6A28] dark:text-[#D4AF6A]">
                      {getCategoryName(entry.categoryId)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{entry.format}</span>
                  </div>
                  <h2 className="font-serif text-lg font-semibold text-[#0B192C] dark:text-[#FBF9F5]">
                    {entry.name}
                  </h2>
                  <p className="text-sm text-[#4A5565] dark:text-[#B9C4D4]">
                    {entry.description}
                  </p>
                  <p className="truncate font-mono text-xs text-[#6B7482] dark:text-[#8492A6]">
                    {entry.url}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isSubscribed}
                  onClick={() =>
                    onAddValidatedSource({
                      url: entry.url,
                      name: entry.name,
                      categoryId: entry.categoryId,
                      format: entry.format,
                      description: entry.description,
                      skipNetwork: true,
                    })
                  }
                  className={`min-h-[42px] shrink-0 rounded-lg px-4 text-xs font-semibold ${
                    isSubscribed
                      ? 'border border-[#D8D0C0] text-[#5C6470] dark:border-[#294366] dark:text-[#9AA6B8]'
                      : 'bg-[#0B192C] text-[#FBF9F5] hover:bg-[#162B47] dark:bg-[#B0893E] dark:text-[#0B192C]'
                  }`}
                >
                  {isSubscribed ? 'Subscribed' : 'Subscribe'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {isAddOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-source-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/65 p-4 backdrop-blur-sm"
          onClick={() => setIsAddOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#E3DDD1] bg-[#FBF9F5] p-6 shadow-2xl dark:border-[#1E324D] dark:bg-[#0B192C]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between border-b border-[#E3DDD1] pb-4 dark:border-[#1E324D]">
              <div className="flex items-center gap-2">
                <Rss className="h-4 w-4 text-[#B0893E]" aria-hidden="true" />
                <h2
                  id="add-source-title"
                  className="font-serif text-xl font-semibold text-[#0B192C] dark:text-[#FBF9F5]"
                >
                  Add News Source
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                aria-label="Close add source dialog"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[#5C6470] hover:bg-[#EFEAE0] dark:text-[#9AA6B8] dark:hover:bg-[#132844]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitNewSource} className="space-y-4">
              <div>
                <label
                  htmlFor="source-url-input"
                  className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
                >
                  Feed URL (RSS or Atom)
                </label>
                <div className="flex gap-2">
                  <input
                    id="source-url-input"
                    type="url"
                    required
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      setValidationResult(null);
                    }}
                    placeholder="https://feeds.bbci.co.uk/news/world/rss.xml"
                    className="min-h-[44px] flex-1 rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-sm text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                  />
                  <button
                    type="button"
                    disabled={isValidating || !urlInput.trim()}
                    onClick={handleValidate}
                    className="min-h-[44px] shrink-0 rounded-lg border border-[#D8D0C0] px-3.5 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] disabled:opacity-50 dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
                  >
                    {isValidating ? 'Checking...' : 'Validate'}
                  </button>
                </div>
              </div>

              {validationResult && (
                <div
                  role="status"
                  className={`rounded-xl border p-3.5 text-xs ${
                    validationResult.valid
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200'
                  }`}
                >
                  {validationResult.valid ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        <span>
                          Valid {validationResult.format} feed ·{' '}
                          {validationResult.articleCount} articles detected
                        </span>
                      </div>
                      {validationResult.httpsRecommendedWarning && (
                        <p className="text-[11px] opacity-90">
                          {validationResult.httpsRecommendedWarning}
                        </p>
                      )}
                      {validationResult.sampleHeadlines &&
                        validationResult.sampleHeadlines.length > 0 && (
                          <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                            {validationResult.sampleHeadlines.map((h, i) => (
                              <li key={i} className="truncate">
                                {h}
                              </li>
                            ))}
                          </ul>
                        )}
                    </div>
                  ) : (
                    <p className="font-medium">
                      {validationResult.errorMessage ?? 'Feed validation failed.'}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label
                  htmlFor="source-name-input"
                  className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
                >
                  Publisher Name
                </label>
                <input
                  id="source-name-input"
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Auto-detected from feed or enter custom name"
                  className="min-h-[44px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-sm text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="source-category-select"
                    className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
                  >
                    Category
                  </label>
                  <select
                    id="source-category-select"
                    value={categoryIdInput}
                    onChange={(e) => setCategoryIdInput(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-sm text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                  >
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="source-format-select"
                    className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
                  >
                    Format
                  </label>
                  <select
                    id="source-format-select"
                    value={formatInput}
                    onChange={(e) =>
                      setFormatInput(e.target.value as 'RSS' | 'Atom')
                    }
                    className="min-h-[44px] w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-sm text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                  >
                    <option value="RSS">RSS</option>
                    <option value="Atom">Atom</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="min-h-[44px] rounded-lg border border-[#D8D0C0] px-4 py-2 text-xs font-semibold text-[#0B192C] hover:bg-[#EFEAE0] dark:border-[#294366] dark:text-[#FBF9F5] dark:hover:bg-[#172E4D]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="min-h-[44px] rounded-lg bg-[#0B192C] px-5 py-2 text-xs font-semibold text-[#FBF9F5] hover:bg-[#162B47] disabled:opacity-60 dark:bg-[#B0893E] dark:text-[#0B192C]"
                >
                  {isSaving ? 'Saving...' : 'Save Source'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isOpmlOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="opml-import-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/65 p-4 backdrop-blur-sm"
          onClick={() => setIsOpmlOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-[#E3DDD1] bg-[#FBF9F5] p-6 shadow-2xl dark:border-[#1E324D] dark:bg-[#0B192C]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-[#E3DDD1] pb-3 dark:border-[#1E324D]">
              <h2
                id="opml-import-title"
                className="font-serif text-xl font-semibold text-[#0B192C] dark:text-[#FBF9F5]"
              >
                Import OPML Subscriptions
              </h2>
              <button
                type="button"
                onClick={() => setIsOpmlOpen(false)}
                aria-label="Close OPML dialog"
                className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-[#5C6470]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleOpmlSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="opml-file-input"
                  className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
                >
                  Upload .opml or .xml file
                </label>
                <input
                  id="opml-file-input"
                  type="file"
                  accept=".opml,.xml,text/xml,application/xml"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setOpmlText(await file.text());
                    }
                  }}
                  className="block w-full text-xs text-[#5C6470] dark:text-[#9AA6B8]"
                />
              </div>

              <div>
                <label
                  htmlFor="opml-xml-textarea"
                  className="mb-1.5 block text-xs font-semibold text-[#0B192C] dark:text-[#E5E9F0]"
                >
                  Or paste OPML XML
                </label>
                <textarea
                  id="opml-xml-textarea"
                  rows={6}
                  value={opmlText}
                  onChange={(e) => setOpmlText(e.target.value)}
                  placeholder='<opml version="2.0"><body><outline text="World"><outline text="BBC" xmlUrl="https://feeds.bbci.co.uk/news/world/rss.xml" /></outline></body></opml>'
                  className="w-full rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] p-3 font-mono text-xs text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
                />
              </div>

              {opmlFeedback && (
                <p className="rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 py-2 text-xs font-medium text-[#0B192C] dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]">
                  {opmlFeedback}
                </p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsOpmlOpen(false)}
                  className="min-h-[42px] rounded-lg border border-[#D8D0C0] px-4 text-xs font-semibold text-[#0B192C] dark:border-[#294366] dark:text-[#FBF9F5]"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={!opmlText.trim()}
                  className="min-h-[42px] rounded-lg bg-[#0B192C] px-4 text-xs font-semibold text-[#FBF9F5] disabled:opacity-50 dark:bg-[#B0893E] dark:text-[#0B192C]"
                >
                  Import Subscriptions
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
