import { useMemo, useRef, useState } from 'react';
import { LayoutGrid } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageThumb } from '@/components/pages/page-thumb';
import { formatPages } from '@/lib/utils';
import { useAppStore, type PdfFileEntry } from '@/store/use-app-store';
import { effectivePages } from '@/store/selectors';

const PAGE_BATCH = 60;

export interface PageStripProps {
  entry: PdfFileEntry;
  onPreview: (pageNumber: number) => void;
}

/**
 * Horizontally scrolling page strip.
 *
 * Only the first batch of thumbnails is mounted; more are appended as the user
 * scrolls, and each thumbnail defers its own canvas render until it is close to
 * the viewport. A 800-page PDF therefore costs a few dozen renders, not 800.
 */
export function PageStrip({ entry, onPreview }: PageStripProps) {
  const togglePage = useAppStore((state) => state.togglePage);
  const resetSelection = useAppStore((state) => state.resetSelection);
  const busy = useAppStore((state) => state.merge.status === 'merging');

  const [mounted, setMounted] = useState(PAGE_BATCH);
  const scroller = useRef<HTMLDivElement | null>(null);

  const pages = useMemo(() => effectivePages(entry), [entry]);
  const selected = useMemo(() => new Set(pages), [pages]);
  const orderIndex = useMemo(() => {
    const map = new Map<number, number>();
    pages.forEach((page, index) => map.set(page, index + 1));
    return map;
  }, [pages]);

  const isReordered = useMemo(() => pages.some((page, index) => page !== index), [pages]);
  const visibleCount = Math.min(mounted, entry.pageCount);
  const remaining = entry.pageCount - visibleCount;

  const handleScroll = () => {
    const node = scroller.current;
    if (!node) return;
    const nearEnd = node.scrollLeft + node.clientWidth > node.scrollWidth - 240;
    if (nearEnd && mounted < entry.pageCount) {
      setMounted((current) => Math.min(current + PAGE_BATCH, entry.pageCount));
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <LayoutGrid className="size-3.5" aria-hidden="true" />
          <span>页面选择</span>
          <Badge variant={pages.length === 0 ? 'destructive' : 'secondary'} className="tabular-nums">
            {pages.length} / {entry.pageCount}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => resetSelection(entry.id)}
            disabled={busy}
          >
            全选 {formatPages(entry.pageCount)}
          </Button>
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={handleScroll}
        className="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto px-1 py-1"
        role="group"
        aria-label={`${entry.name} 的页面缩略图`}
      >
        {Array.from({ length: visibleCount }, (_, index) => (
          <PageThumb
            key={index}
            fileId={entry.id}
            file={entry.file}
            pageIndex={index}
            selected={selected.has(index)}
            order={isReordered ? orderIndex.get(index) : undefined}
            disabled={busy}
            onToggle={() => togglePage(entry.id, index)}
            onPreview={() => onPreview(index + 1)}
          />
        ))}
      </div>

      {remaining > 0 && (
        <p className="pl-1 text-[11px] text-muted-foreground/80">
          继续横向滚动可加载剩余 {remaining} 页缩略图（按需渲染，不会一次性加载全部页面）
        </p>
      )}
    </div>
  );
}
