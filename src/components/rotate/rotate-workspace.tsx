import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  PagePreviewDialog,
  type PreviewRotationAdapter,
  type PreviewSelectionAdapter,
} from '@/components/pages/page-preview-dialog';
import { RotateHero } from '@/components/rotate/rotate-hero';
import { RotatePageGrid } from '@/components/rotate/rotate-page-grid';
import { RotateResult } from '@/components/rotate/rotate-result';
import { RotateSettingsPanel } from '@/components/rotate/rotate-settings';
import { RotateToolbar } from '@/components/rotate/rotate-toolbar';
import { RotateUpload } from '@/components/rotate/rotate-upload';
import { useFileDrop } from '@/hooks/use-file-drop';
import {
  deltasOf,
  finalAnglesOf,
  resolveScope,
  useRotateStore,
} from '@/store/use-rotate-store';

export function RotateWorkspace() {
  const doc = useRotateStore((state) => state.document);
  const history = useRotateStore((state) => state.history);
  const scope = useRotateStore((state) => state.scope);
  const currentPage = useRotateStore((state) => state.currentPage);
  const rangeDraft = useRotateStore((state) => state.rangeDraft);
  const exportStatus = useRotateStore((state) => state.exportStatus);
  const addDocument = useRotateStore((state) => state.addDocument);
  const selectPage = useRotateStore((state) => state.selectPage);
  const setCurrentPage = useRotateStore((state) => state.setCurrentPage);
  const rotatePage = useRotateStore((state) => state.rotatePage);
  const resetPage = useRotateStore((state) => state.resetPage);
  const startExport = useRotateStore((state) => state.startExport);

  const [previewPage, setPreviewPage] = useState<number | null>(null);

  // Derived from the single source of truth; thumbnails, the dialog and the
  // export jobs all read these same arrays.
  const finalAngles = useMemo(
    () => finalAnglesOf({ document: doc, history }),
    [doc, history],
  );
  const deltas = useMemo(() => deltasOf({ history }), [history]);
  const rotatedCount = useMemo(() => deltas.filter((delta) => delta !== 0).length, [deltas]);
  const resolution = useMemo(
    () => resolveScope({ document: doc, scope, currentPage, rangeDraft }),
    [doc, scope, currentPage, rangeDraft],
  );

  const handleFiles = async (incoming: File[]) => {
    const outcome = await addDocument(incoming);
    if (outcome.message) {
      // Covers both rejection reasons and a PDF that parsed badly.
      toast.error(outcome.message);
      return;
    }
    if (outcome.accepted) toast.success('已载入 PDF');
  };

  const { isDragging, handlers } = useFileDrop(handleFiles);
  const busy = exportStatus === 'exporting';

  // Keep the preview inside the document if the file was replaced while open.
  useEffect(() => {
    if (previewPage === null || !doc) return;
    if (previewPage > doc.pageCount) setPreviewPage(null);
  }, [doc, previewPage]);

  // Ctrl/⌘ + Z / Shift + Z, matching the labels in the toolbar.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) useRotateStore.getState().redo();
      else useRotateStore.getState().undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (exportStatus !== 'success') return;
    if (window.matchMedia('(min-width: 1024px)').matches) return;
    document.getElementById('rotate-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [exportStatus]);

  if (!doc) return <RotateHero onFiles={handleFiles} />;

  const ready = doc.status === 'ready';

  const previewSelection: PreviewSelectionAdapter = {
    isIncluded: (pageIndex) => doc.selectedPages.includes(pageIndex),
    toggle: (pageIndex) => selectPage(pageIndex),
    includedLabel: '已选中',
    excludedLabel: '未选中',
    toggleAddLabel: '选中此页',
    toggleRemoveLabel: '取消选中',
    note: '预览按最终导出方向渲染 · 双击切换适应窗口 / 100% · ⌘/Ctrl + 滚轮缩放 · ← → 翻页 · [ ] 旋转',
  };

  const previewRotation: PreviewRotationAdapter = {
    getAngle: (pageIndex) => finalAngles[pageIndex] ?? 0,
    rotate: (pageIndex, delta) => rotatePage(pageIndex, delta),
    reset: (pageIndex) => resetPage(pageIndex),
  };

  const openPreview = (page: number) => {
    setPreviewPage(page);
    setCurrentPage(page);
  };

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
          <RotateResult />
          <RotateUpload doc={doc} onReplace={handleFiles} />
          {ready && <RotateToolbar doc={doc} rotatedCount={rotatedCount} />}
          {ready && (
            <RotatePageGrid
              doc={doc}
              finalAngles={finalAngles}
              deltas={deltas}
              busy={busy}
              onPreview={openPreview}
            />
          )}
        </div>

        <div className="order-2 min-w-0">
          <RotateSettingsPanel doc={doc} resolution={resolution} rotatedCount={rotatedCount} />
        </div>
      </div>

      {ready && exportStatus !== 'success' && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 pt-2.5 backdrop-blur-xl lg:hidden"
          style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 text-[11.5px] text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">{doc.pageCount}</span> 页
              <span className="mx-1">·</span>
              已旋转{' '}
              <span className="font-semibold tabular-nums text-foreground">{rotatedCount}</span> 页
            </div>
            <button
              type="button"
              onClick={() => void startExport()}
              disabled={!ready || busy}
              data-testid="rotate-button-mobile"
              className="ml-auto inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground shadow-sm transition hover:bg-primary/92 disabled:pointer-events-none disabled:opacity-45"
            >
              {busy ? '处理中…' : '导出 PDF'}
            </button>
          </div>
        </div>
      )}

      <PagePreviewDialog
        entry={doc}
        page={previewPage}
        onPageChange={openPreview}
        onClose={() => setPreviewPage(null)}
        selection={previewSelection}
        rotation={previewRotation}
      />
    </>
  );
}
