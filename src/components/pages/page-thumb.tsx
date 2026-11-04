import { useEffect, useState } from 'react';
import { FileWarning, Loader2 } from 'lucide-react';

import { LIMITS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { thumbnailService, type Thumbnail } from '@/features/preview/thumbnail-service';
import { useInView } from '@/hooks/use-in-view';

export interface PageThumbProps {
  fileId: string;
  file: File;
  pageIndex: number;
  selected: boolean;
  /** 1-based position in the final output, shown only when order is custom. */
  order?: number;
  disabled?: boolean;
  onToggle: () => void;
  onPreview: () => void;
}

const FALLBACK_RATIO = 1 / Math.SQRT2;

export function PageThumb({
  fileId,
  file,
  pageIndex,
  selected,
  order,
  disabled,
  onToggle,
  onPreview,
}: PageThumbProps) {
  const { ref, inView } = useInView<HTMLDivElement>('360px');
  const [thumb, setThumb] = useState<Thumbnail | null>(
    () => thumbnailService.peek(fileId, pageIndex + 1, LIMITS.thumbnailWidth) ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!inView || thumb || failed) return;
    let alive = true;

    thumbnailService
      .getThumbnail(fileId, file, pageIndex + 1, LIMITS.thumbnailWidth)
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
  }, [inView, thumb, failed, fileId, file, pageIndex]);

  const aspectRatio = thumb ? thumb.width / thumb.height : FALLBACK_RATIO;

  return (
    <div ref={ref} className="w-[104px] shrink-0 snap-start">
      <div className="relative">
        <button
          type="button"
          onClick={onPreview}
          disabled={disabled}
          title={`第 ${pageIndex + 1} 页 · 点击预览`}
          aria-label={`预览第 ${pageIndex + 1} 页`}
          className={cn(
            'group/thumb relative block w-full overflow-hidden rounded-lg border bg-white transition-all duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            selected
              ? 'border-primary/50 shadow-sm'
              : 'border-border/80 opacity-60 saturate-[0.15] hover:opacity-95 hover:saturate-100',
            disabled && 'cursor-not-allowed',
          )}
          style={{ aspectRatio }}
        >
          {thumb ? (
            <img
              src={thumb.url}
              alt={`第 ${pageIndex + 1} 页缩略图`}
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
                <span className="text-[10px] text-muted-foreground/50">{pageIndex + 1}</span>
              )}
            </span>
          )}

          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/60 to-transparent px-1.5 pb-1 pt-4 text-[10px] font-medium text-white opacity-0 transition-opacity duration-200 group-hover/thumb:opacity-100">
            预览
          </span>
        </button>

        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-pressed={selected}
          aria-label={selected ? `取消选择第 ${pageIndex + 1} 页` : `选择第 ${pageIndex + 1} 页`}
          className={cn(
            'absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border-2 border-card transition-all duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            selected
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-card text-transparent shadow-sm ring-1 ring-border hover:text-muted-foreground',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden="true">
            <path
              d="M2.5 6.2 5 8.6l4.6-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {order !== undefined && (
          <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-px text-[10px] font-semibold tabular-nums text-primary-foreground shadow-sm">
            {order}
          </span>
        )}
      </div>

      <div
        className={cn(
          'mt-1.5 text-center text-[11px] tabular-nums transition-colors',
          selected ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        {pageIndex + 1}
      </div>
    </div>
  );
}
