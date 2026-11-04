import { useMemo, useState } from 'react';
import { ChevronDown, LayoutGrid } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageThumb } from '@/components/pages/page-thumb';
import { LIMITS } from '@/lib/constants';
import { useSplitStore, type SplitDocument } from '@/store/use-split-store';
import type { SplitPlan } from '@/features/pdf-split/types';

const PAGE_BATCH = 120;

const HINTS: Record<string, string> = {
  ranges: '编号标出这一页会进入第几个输出文件；灰显的页面没有被任何范围覆盖',
  chunks: '编号标出这一页会进入第几个输出文件',
  extract: '点缩略图勾选页；勾选顺序就是输出顺序',
  each: '每页各成一个文件，无需选择',
};

export interface PageGridProps {
  doc: SplitDocument;
  plan: SplitPlan;
  onPreview: (page: number) => void;
}

/**
 * Page grid for the split tool.
 *
 * Thumbnails render lazily (each `PageThumb` waits until it is near the
 * viewport) and the grid mounts at most `PAGE_BATCH` at a time, so a 300-page
 * document costs a few dozen canvas renders rather than 300.
 */
export function PageGrid({ doc, plan, onPreview }: PageGridProps) {
  const mode = useSplitStore((state) => state.settings.mode);
  const toggleExtractPage = useSplitStore((state) => state.toggleExtractPage);
  const busy = useSplitStore((state) => state.build.status === 'splitting');

  const [limit, setLimit] = useState(PAGE_BATCH);

  const extractOrder = useMemo(() => {
    const map = new Map<number, number>();
    doc.extractPages.forEach((page, index) => map.set(page, index + 1));
    return map;
  }, [doc.extractPages]);

  /** Which output file each page lands in (1-based), first match wins. */
  const groupOrder = useMemo(() => {
    const map = new Map<number, number>();
    plan.outputs.forEach((output, index) => {
      for (const page of output.pages) {
        if (!map.has(page)) map.set(page, index + 1);
      }
    });
    return map;
  }, [plan.outputs]);

  const interactive = mode === 'extract';
  const visible = Math.min(limit, doc.pageCount);
  const remaining = doc.pageCount - visible;
  const selectedCount = interactive ? extractOrder.size : groupOrder.size;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px]">
          <LayoutGrid className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">页面</span>
          <Badge variant="secondary" className="tabular-nums">
            {selectedCount} / {doc.pageCount}
          </Badge>
        </div>
        <span className="text-[10.5px] text-muted-foreground/80">点缩略图可放大预览</span>
      </div>

      <p className="text-[10.5px] leading-relaxed text-muted-foreground/80">{HINTS[mode]}</p>

      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-2 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(148px,1fr))]"
        role="group"
        aria-label={`${doc.name} 的页面缩略图`}
        data-testid="split-page-grid"
      >
        {Array.from({ length: visible }, (_, index) => {
          const selected = interactive ? extractOrder.has(index) : groupOrder.has(index);
          const order =
            mode === 'each'
              ? undefined
              : interactive
                ? extractOrder.get(index)
                : groupOrder.get(index);

          return (
            <div key={index} className="justify-self-center">
              <PageThumb
                fileId={doc.id}
                file={doc.file}
                pageIndex={index}
                selected={selected}
                order={order}
                disabled={busy}
                size={LIMITS.splitThumbnailWidth}
                showToggle={interactive}
                onToggle={() => toggleExtractPage(index)}
                onPreview={() => onPreview(index + 1)}
              />
            </div>
          );
        })}
      </div>

      {remaining > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={() => setLimit((current) => Math.min(current + PAGE_BATCH, doc.pageCount))}
        >
          <ChevronDown className="size-3.5" />
          继续显示剩余 {remaining} 页（缩略图按需渲染）
        </Button>
      )}
    </div>
  );
}
