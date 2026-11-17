import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { Category } from '../../core/common/types';

interface CategoryManagerModalProps {
  isOpen: boolean;
  categories: Category[];
  onClose: () => void;
  onCreateCategory: (name: string) => Promise<void>;
  onToggleCategory: (id: string, enabled: boolean) => Promise<void>;
  onRenameCategory: (id: string, name: string) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onReorderCategories: (orderedIds: string[]) => Promise<void>;
}

export function CategoryManagerModal({
  isOpen,
  categories,
  onClose,
  onCreateCategory,
  onToggleCategory,
  onRenameCategory,
  onDeleteCategory,
  onReorderCategories,
}: CategoryManagerModalProps) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const sorted = [...categories].sort((a, b) => a.order - b.order);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setError('Enter a category name.');
      return;
    }
    try {
      setError(null);
      await onCreateCategory(newName.trim());
      setNewName('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const ids = sorted.map((c) => c.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved);
    await onReorderCategories(ids);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-manager-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B192C]/65 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[#E3DDD1] bg-[#FBF9F5] p-6 shadow-2xl dark:border-[#1E324D] dark:bg-[#0B192C]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between border-b border-[#E3DDD1] pb-4 dark:border-[#1E324D]">
          <h2
            id="category-manager-title"
            className="font-serif text-xl font-semibold text-[#0B192C] dark:text-[#FBF9F5]"
          >
            Manage Categories
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close category manager"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[#5C6470] hover:bg-[#EFEAE0] dark:text-[#9AA6B8] dark:hover:bg-[#132844]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="mb-5 flex gap-2">
          <label htmlFor="new-category-input" className="sr-only">
            New custom category name
          </label>
          <input
            id="new-category-input"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Create custom category..."
            className="min-h-[44px] flex-1 rounded-lg border border-[#D8D0C0] bg-[#FFFFFF] px-3 text-sm text-[#0B192C] focus:border-[#B0893E] focus:outline-none dark:border-[#243B5C] dark:bg-[#10233D] dark:text-[#FBF9F5]"
          />
          <button
            type="submit"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#0B192C] px-4 text-xs font-semibold text-[#FBF9F5] hover:bg-[#162B47] dark:bg-[#B0893E] dark:text-[#0B192C]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Add</span>
          </button>
        </form>

        {error && (
          <p className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200">
            {error}
          </p>
        )}

        <div className="divide-y divide-[#E3DDD1] rounded-xl border border-[#E3DDD1] bg-[#FFFFFF] dark:divide-[#1E324D] dark:border-[#1E324D] dark:bg-[#10233D]">
          {sorted.map((cat, index) => (
            <div
              key={cat.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                {editingId === cat.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="min-h-[36px] rounded border border-[#B0893E] bg-[#FBF9F5] px-2 text-xs text-[#0B192C] dark:bg-[#0B192C] dark:text-[#FBF9F5]"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (editingName.trim()) {
                          await onRenameCategory(cat.id, editingName.trim());
                        }
                        setEditingId(null);
                      }}
                      className="min-h-[36px] rounded bg-[#0B192C] px-2.5 text-xs font-semibold text-[#FBF9F5] dark:bg-[#B0893E] dark:text-[#0B192C]"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#0B192C] dark:text-[#FBF9F5]">
                      {cat.name}
                    </span>
                    {cat.isCustom && (
                      <span className="text-[11px] font-medium text-[#8E6A28] dark:text-[#D4AF6A]">
                        Custom
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => handleMove(index, -1)}
                  aria-label={`Move ${cat.name} up`}
                  className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded text-[#5C6470] hover:bg-[#EFEAE0] disabled:opacity-30 dark:text-[#9AA6B8] dark:hover:bg-[#172E4D]"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={index === sorted.length - 1}
                  onClick={() => handleMove(index, 1)}
                  aria-label={`Move ${cat.name} down`}
                  className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded text-[#5C6470] hover:bg-[#EFEAE0] disabled:opacity-30 dark:text-[#9AA6B8] dark:hover:bg-[#172E4D]"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>

                {cat.isCustom && editingId !== cat.id && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(cat.id);
                        setEditingName(cat.name);
                      }}
                      className="min-h-[36px] rounded px-2 text-xs font-medium text-[#5C6470] hover:bg-[#EFEAE0] dark:text-[#9AA6B8] dark:hover:bg-[#172E4D]"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteCategory(cat.id)}
                      aria-label={`Delete ${cat.name}`}
                      className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}

                <button
                  type="button"
                  role="switch"
                  aria-checked={cat.enabled}
                  aria-label={`Toggle ${cat.name}`}
                  onClick={() => onToggleCategory(cat.id, !cat.enabled)}
                  className={`ml-1 min-h-[36px] min-w-[68px] rounded-md border px-2.5 text-xs font-semibold ${
                    cat.enabled
                      ? 'border-[#0B192C] bg-[#0B192C] text-[#FBF9F5] dark:border-[#B0893E] dark:bg-[#B0893E] dark:text-[#0B192C]'
                      : 'border-[#D8D0C0] text-[#5C6470] dark:border-[#294366] dark:text-[#9AA6B8]'
                  }`}
                >
                  {cat.enabled ? 'Active' : 'Hidden'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
