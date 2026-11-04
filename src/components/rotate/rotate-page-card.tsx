import { useEffect, useRef, useState } from 'react';
import { Check, FileWarning, Loader2, MoreHorizontal, RotateCcw, RotateCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { LIMITS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { thumbnailService, type Thumbnail } from '@/features/preview/thumbnail-service';
import { useInView } from '@/hooks/use-in-view';
import { useRotateStore, type RotateDocument } from '@/store/use-rotate-store';
import type { RotationAngle } from '@/features/pdf-rotate/types';

const ICON_BUTTON =
  'grid size-7 place-items-center rounded-md border border-border/70 bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45';

const FALLBACK_RATIO = 1 / Math.SQRT2;

export interface RotatePageCardProps {
  doc: RotateDocument;
  pageIndex: number;
  /** Final absolute angle — also the angle PDF.js renders the thumbnail at. */
  finalAngle: RotationAngle;
  /** Session delta; non-zero means this page was edited. */
  delta: RotationAngle;
  selected: boolean;
  disabled: boolean;
  onPreview: () => void;
}

/**
 * One page card. The thumbnail is a **real PDF.js render at the final angle**;
 * rotating the page changes the cache key and triggers a re-render, so the
 * bitmap shown here is always the direction that will be exported.
 */
export function RotatePageCard({
  doc,
  pageIndex,
  finalAngle,
  delta,
  selected,
  disabled,
  onPreview,
}: RotatePageCardProps) {
  const rotatePage = useRotateStore((state) => state.rotatePage);
  const resetPage = useRotateStore((state) => state.resetPage);
  const selectPage = useRotateStore((state) => state.selectPage);

  const { ref, inView } = useInView<HTMLDivElement>('360px');
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const [thumb, setThumb] = useState<Thumbnail | null>(() =>
    thumbnailService.peek(doc.id, pageIndex + 1, LIMITS.rotateThumbnailWidth, finalAngle) ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!inView) return;
    const cached =
      thumbnailService.peek(doc.id, pageIndex + 1, LIMITS.rotateThumbnailWidth, finalAngle) ?? null;
    setThumb(cached);
    setFailed(false);
    if (cached) return;

    let alive = true;
    thumbnailService
      .getThumbnail(doc.id, doc.file, pageIndex + 1, LIMITS.rotateThumbnailWidth, finalAngle)
      .then((result) => {
        if (!alive) return;
        if (result) setThumb(result);
        else setFailed(true);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });

    return () => {
      alive = false;
    };
  }, [inView, doc.id, doc.file, pageIndex, finalAngle]);

  const pageNumber = pageIndex + 1;
  const aspectRatio = thumb ? thumb.width / thumb.height : FALLBACK_RATIO;
  const closeMenu = () => detailsRef.current?.removeAttribute('open');

  return (
    <div
      ref={ref}
      data-testid="rotate-page-card"
      data-page={pageNumber}
      data-angle={finalAngle}
      data-selected={selected ? 'true' : 'false'}
      className="shrink-0"
      style={{ width: LIMITS.rotateThumbnailWidth }}
    >
      <div className="relative">
        <button
          type="button"
          onClick={onPreview}
          disabled={disabled}
          data-testid={`rotate-preview-${pageNumber}`}
          aria-label={`预览第 ${pageNumber} 页`}
          title={`第 ${pageNumber} 页 · 点击放大预览`}
          className={cn(
            'group/thumb relative block w-full overflow-hidden rounded-lg border bg-white transition-all duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            selected ? 'border-primary/60 shadow-sm' : 'border-border/80',
            disabled && 'cursor-not-allowed',
          )}
          style={{ aspectRatio }}
        >
          {thumb ? (
            <img
              src={thumb.url}
              alt={`第 ${pageNumber} 页，最终方向 ${finalAngle}°`}
              className="block h-full w-full object-contain"
              draggable={false}
            />
          ) : failed ? (
            <span className="grid h-full w-full place-items-center bg-muted/40 text-muted-foreground/60">
              <FileWarning className="size-5" />
            </span>
          ) : (
            <span className="grid h-full w-full place-items-center bg-muted/40">
              {inView ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground/60" />
              ) : (
                <span className="text-[10px] text-muted-foreground/50">{pageNumber}</span>
              )}
            </span>
          )}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/60 to-transparent px-1.5 pb-1 pt-4 text-[10px] font-medium text-white opacity-0 transition-opacity duration-200 group-hover/thumb:opacity-100">
            预览 · {finalAngle}°
          </span>
        </button>

        <button
          type="button"
          onClick={() => selectPage(pageIndex)}
          disabled={disabled}
          aria-pressed={selected}
          data-testid={`rotate-select-${pageNumber}`}
          aria-label={selected ? `取消选择第 ${pageNumber} 页` : `选择第 ${pageNumber} 页`}
          title={selected ? '取消选择' : '选择这一页'}
          className={cn(
            'absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border-2 border-card shadow-sm transition-all duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selected
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-transparent ring-1 ring-border hover:text-muted-foreground',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <Check className="size-2.5" />
        </button>

        <span className="absolute left-1 top-1 rounded bg-slate-900/65 px-1.5 py-px text-[10px] font-semibold tabular-nums text-white">
          {pageNumber}
        </span>
        {delta !== 0 && (
          <span className="absolute right-1 top-1 rounded bg-primary px-1.5 py-px text-[10px] font-semibold tabular-nums text-primary-foreground">
            {finalAngle}°
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-center gap-1 text-[10.5px] tabular-nums text-muted-foreground">
        <span>第 {pageNumber} 页</span>
        <Badge
          variant={delta !== 0 ? 'soft' : 'muted'}
          data-testid={`rotate-angle-${pageNumber}`}
          className="px-1 py-0 text-[9.5px]"
        >
          {finalAngle}°
        </Badge>
      </div>

      <div className="mt-1.5 flex items-center justify-center gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => rotatePage(pageIndex, -90)}
          data-testid={`rotate-left-${pageNumber}`}
          aria-label={`第 ${pageNumber} 页向左旋转 90°`}
          title="向左旋转 90°（逆时针）"
          className={cn(ICON_BUTTON, 'hover:text-primary')}
        >
          <RotateCcw className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => rotatePage(pageIndex, 90)}
          data-testid={`rotate-right-${pageNumber}`}
          aria-label={`第 ${pageNumber} 页向右旋转 90°`}
          title="向右旋转 90°（顺时针）"
          className={cn(ICON_BUTTON, 'hover:text-primary')}
        >
          <RotateCw className="size-3.5" />
        </button>

        <details ref={detailsRef} className="relative">
          <summary
            data-testid={`rotate-more-${pageNumber}`}
            title="更多操作"
            aria-label={`第 ${pageNumber} 页更多操作`}
            className={cn(
              ICON_BUTTON,
              'cursor-pointer list-none [&::-webkit-details-marker]:hidden',
              disabled && 'pointer-events-none opacity-45',
            )}
          >
            <MoreHorizontal className="size-3.5" />
          </summary>
          <div className="absolute bottom-full right-0 z-20 mb-1 w-36 rounded-lg border border-border bg-card p-1 shadow-raised">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                rotatePage(pageIndex, 180);
                closeMenu();
              }}
              data-testid={`rotate-180-${pageNumber}`}
              className="w-full rounded-md px-2 py-1.5 text-left text-[11.5px] hover:bg-muted"
            >
              旋转 180°
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                resetPage(pageIndex);
                closeMenu();
              }}
              data-testid={`rotate-reset-${pageNumber}`}
              className="w-full rounded-md px-2 py-1.5 text-left text-[11.5px] hover:bg-muted"
            >
              恢复原始方向
            </button>
            <button
              type="button"
              onClick={() => {
                onPreview();
                closeMenu();
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-[11.5px] hover:bg-muted"
            >
              放大预览
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}
