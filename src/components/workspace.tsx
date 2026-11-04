import { useEffect } from 'react';
import { toast } from 'sonner';

import { Hero } from '@/components/layout/hero';
import { FileList } from '@/components/files/file-list';
import { MergePanel, ResultCard } from '@/components/merge/merge-panel';
import { useFileDrop } from '@/hooks/use-file-drop';
import { useAppStore } from '@/store/use-app-store';

export function Workspace() {
  const files = useAppStore((state) => state.files);
  const addFiles = useAppStore((state) => state.addFiles);
  const mergeStatus = useAppStore((state) => state.merge.status);
  const outputPages = useAppStore((state) =>
    state.files.reduce((sum, entry) => {
      if (entry.status !== 'ready') return sum;
      return sum + (entry.selection.pages?.length ?? entry.pageCount);
    }, 0),
  );
  const startMerge = useAppStore((state) => state.startMerge);

  const handleFiles = async (incoming: File[]) => {
    const summary = await addFiles(incoming);

    if (summary.added > 0) {
      toast.success(`已添加 ${summary.added} 个文件`);
    }
    if (summary.duplicates.length > 0) {
      toast.warning(
        `${summary.duplicates.length} 个重复文件已跳过：${summary.duplicates.slice(0, 2).join('、')}${
          summary.duplicates.length > 2 ? ' 等' : ''
        }`,
      );
    }
    for (const item of summary.rejected.slice(0, 3)) {
      toast.error(`${item.name}：${item.reason}`);
    }
  };

  const { isDragging, handlers } = useFileDrop(handleFiles);

  // On small screens the result appears above the list, out of view after
  // tapping the bottom action bar. Bring it into view once.
  useEffect(() => {
    if (mergeStatus !== 'success') return;
    if (window.matchMedia('(min-width: 1024px)').matches) return;
    document.getElementById('merge-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [mergeStatus]);

  if (files.length === 0) {
    return <Hero onFiles={handleFiles} />;
  }

  const busy = mergeStatus === 'merging';

  return (
    <>
      <div className="grid gap-4 pb-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        {isDragging && (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-30 border-4 border-primary/25 bg-primary/[0.04]"
          />
        )}

        <div className="order-1 min-w-0 space-y-3.5" {...handlers}>
          <ResultCard />
          <FileList files={files} onAddFiles={handleFiles} />
        </div>

        {/* A single panel instance: sidebar on desktop, inline below the list
            on mobile. Keeping one instance avoids duplicated form ids. */}
        <div className="order-2 lg:sticky lg:top-[84px] lg:col-start-2 lg:row-start-1">
          <MergePanel />
        </div>
      </div>

      {mergeStatus !== 'success' && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 pt-2.5 backdrop-blur-xl lg:hidden"
          style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 text-[11.5px] text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">{outputPages}</span> 页 ·{' '}
              {files.length} 个文件
            </div>
            <button
              type="button"
              onClick={() => void startMerge()}
              disabled={busy || outputPages === 0}
              className="ml-auto inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground shadow-sm transition hover:bg-primary/92 disabled:pointer-events-none disabled:opacity-45"
            >
              合并并下载
            </button>
          </div>
        </div>
      )}
    </>
  );
}
