import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { DocumentCard } from '@/components/split/document-card';
import { PageGrid } from '@/components/split/page-grid';
import { SplitHero } from '@/components/split/split-hero';
import { SplitResultPanel } from '@/components/split/result-panel';
import { SplitSettingsPanel } from '@/components/split/settings-panel';
import {
  PagePreviewDialog,
  type PreviewSelectionAdapter,
} from '@/components/pages/page-preview-dialog';
import { useFileDrop } from '@/hooks/use-file-drop';
import { planOf, useSplitStore } from '@/store/use-split-store';

export function SplitWorkspace() {
  const doc = useSplitStore((state) => state.doc);
  const settings = useSplitStore((state) => state.settings);
  const build = useSplitStore((state) => state.build);
  const addDocument = useSplitStore((state) => state.addDocument);
  const toggleExtractPage = useSplitStore((state) => state.toggleExtractPage);
  const startSplit = useSplitStore((state) => state.startSplit);

  const [previewPage, setPreviewPage] = useState<number | null>(null);

  const plan = useMemo(() => planOf({ doc, settings }), [doc, settings]);
  const busy = build.status === 'splitting';

  const handleFiles = async (incoming: File[]) => {
    const outcome = await addDocument(incoming);
    if (outcome.message) {
      // Covers both "not a PDF" rejections and files that parsed badly.
      toast.error(outcome.message);
      return;
    }
    if (outcome.accepted) toast.success('已载入 PDF');
  };

  const { isDragging, handlers } = useFileDrop(handleFiles);

  // Keep the preview inside the document if the file was replaced while open.
  useEffect(() => {
    if (previewPage === null || !doc) return;
    if (previewPage > doc.pageCount) setPreviewPage(null);
  }, [doc, previewPage]);

  useEffect(() => {
    if (build.status !== 'success') return;
    if (window.matchMedia('(min-width: 1024px)').matches) return;
    document.getElementById('split-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [build.status]);

  if (!doc) return <SplitHero onFiles={handleFiles} />;

  // In extract mode the dialog edits the selection; in the other modes it only
  // reports whether the page is part of the output, so the toggle is hidden.
  const previewSelection: PreviewSelectionAdapter = {
    isIncluded: (pageIndex) =>
      settings.mode === 'extract'
        ? doc.extractPages.includes(pageIndex)
        : plan.outputs.some((output) => output.pages.includes(pageIndex)),
    toggle: (pageIndex) => toggleExtractPage(pageIndex),
    includedLabel: settings.mode === 'extract' ? '参与提取' : '会输出',
    excludedLabel: settings.mode === 'extract' ? '未选' : '不输出',
    toggleAddLabel: '加入提取',
    toggleRemoveLabel: '移出提取',
    hideToggle: settings.mode !== 'extract',
    note: '双击切换适应窗口 / 100% · ⌘/Ctrl + 滚轮缩放 · ← → 翻页 · 拆分使用原始矢量页面',
  };

  const ready = doc.status === 'ready';
  const canSplit = ready && plan.errors.length === 0 && plan.outputs.length > 0 && !busy;

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
          <SplitResultPanel />
          <DocumentCard doc={doc} onReplace={handleFiles} />
          {ready && <PageGrid doc={doc} plan={plan} onPreview={setPreviewPage} />}
        </div>

        <div className="order-2 min-w-0">
          <SplitSettingsPanel doc={doc} plan={plan} />
        </div>
      </div>

      {doc.status === 'ready' && build.status !== 'success' && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 pt-2.5 backdrop-blur-xl lg:hidden"
          style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 text-[11.5px] text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {plan.outputs.length}
              </span>{' '}
              个文件 · {doc.pageCount} 页
            </div>
            <button
              type="button"
              onClick={() => void startSplit()}
              disabled={!canSplit}
              data-testid="split-button-mobile"
              className="ml-auto inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground shadow-sm transition hover:bg-primary/92 disabled:pointer-events-none disabled:opacity-45"
            >
              拆分 PDF
            </button>
          </div>
        </div>
      )}

      <PagePreviewDialog
        entry={doc}
        page={previewPage}
        onPageChange={setPreviewPage}
        onClose={() => setPreviewPage(null)}
        selection={previewSelection}
      />
    </>
  );
}
