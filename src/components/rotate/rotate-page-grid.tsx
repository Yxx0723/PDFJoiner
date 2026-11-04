import { useMemo, useState } from 'react';
import { ChevronDown, LayoutGrid } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { RotatePageCard } from '@/components/rotate/rotate-page-card';
import type { RotationAngle } from '@/features/pdf-rotate/types';
import type { RotateDocument } from '@/store/use-rotate-store';

/** Mounting 300 cards is cheap; rendering 300 canvases is not. */
const PAGE_BATCH = 60;

export interface RotatePageGridProps {
  doc: RotateDocument;
  finalAngles: RotationAngle[];
  deltas: RotationAngle[];
  busy: boolean;
  onPreview: (page: number) => void;
}

export function RotatePageGrid({
  doc,
  finalAngles,
  deltas,
  busy,
  onPreview,
}: RotatePageGridProps) {
  const [limit, setLimit] = useState(PAGE_BATCH);
  const selected = useMemo(() => new Set(doc.selectedPages), [doc.selectedPages]);

  const visible = Math.min(limit, doc.pageCount);
  const remaining = doc.pageCount - visible;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px]">
          <LayoutGrid className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">页面缩略图</span>
        </div>
        <span className="text-[10.5px] text-muted-foreground/80">
          缩略图按最终方向实时渲染 · 点击可放大
        </span>
      </div>

      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-2 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(148px,1fr))]"
        role="group"
        aria-label={`${doc.name} 的页面`}
        data-testid="rotate-page-grid"
      >
        {Array.from({ length: visible }, (_, index) => (
          <div key={index} className="justify-self-center">
            <RotatePageCard
              doc={doc}
              pageIndex={index}
              finalAngle={finalAngles[index] ?? 0}
              delta={deltas[index] ?? 0}
              selected={selected.has(index)}
              disabled={busy}
              onPreview={() => onPreview(index + 1)}
            />
          </div>
        ))}
      </div>

      {remaining > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          data-testid="rotate-show-more"
          onClick={() => setLimit((current) => Math.min(current + PAGE_BATCH, doc.pageCount))}
        >
          <ChevronDown className="size-3.5" />
          继续显示剩余 {remaining} 页（缩略图按需渲染）
        </Button>
      )}
    </div>
  );
}
