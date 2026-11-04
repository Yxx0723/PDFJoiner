import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Loader2, Maximize2, Minus, Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { LIMITS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { thumbnailService, type Thumbnail } from '@/features/preview/thumbnail-service';
import { useAppStore, type PdfFileEntry } from '@/store/use-app-store';
import { effectivePages } from '@/store/selectors';

export interface PagePreviewDialogProps {
  entry: PdfFileEntry;
  /** 1-based page number, or `null` when closed. */
  page: number | null;
  onPageChange: (page: number) => void;
  onClose: () => void;
}

/** CSS pixels per PDF point at 100% (96 dpi, the usual on-screen convention). */
const PT_TO_PX = 96 / 72;

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3] as const;
const MIN_SCALE = 0.25;
const MAX_SCALE = 3;

/** Sharper bitmaps are requested in 200 px buckets so the LRU stays small. */
const RENDER_BUCKET = 200;
const MIN_RENDER_WIDTH = Math.round(LIMITS.previewWidth * 0.66);
const MAX_RENDER_WIDTH = 1100;

const A4 = { width: 595.28, height: 841.89 };

function toMillimetres(points: number): number {
  return Math.round((points * 25.4) / 72);
}

/**
 * Loads the bitmap for the requested width while keeping the previous frame on
 * screen, so raising the zoom does not flash a blank canvas.
 */
function usePageImage(entry: PdfFileEntry, page: number | null, width: number) {
  const [frame, setFrame] = useState<{ page: number; thumb: Thumbnail } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (page === null) return;

    const cached = thumbnailService.peek(entry.id, page, width);
    if (cached) {
      setFrame({ page, thumb: cached });
      setLoading(false);
      return;
    }

    let alive = true;
    setLoading(true);
    thumbnailService
      .getThumbnail(entry.id, entry.file, page, width)
      .then((result) => {
        if (!alive) return;
        if (result) setFrame({ page, thumb: result });
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [entry.id, entry.file, page, width]);

  const visible = frame && frame.page === page ? frame.thumb : null;
  return { thumb: visible, loading };
}

export function PagePreviewDialog({ entry, page, onPageChange, onClose }: PagePreviewDialogProps) {
  const togglePage = useAppStore((state) => state.togglePage);
  const open = page !== null;

  const [mode, setMode] = useState<'fit' | 'manual'>('fit');
  const [manualScale, setManualScale] = useState(1);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [requestWidth, setRequestWidth] = useState(720);
  const [dragging, setDragging] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    active: boolean;
    pointerId: number;
  } | null>(null);
  const anchorRef = useRef<{ rx: number; ry: number; ax: number; ay: number } | null>(null);

  /* ----------------------------- page geometry ---------------------------- */

  useEffect(() => {
    if (page === null) return;

    // Paint something sensible immediately, then refine with the real page box
    // from pdf.js (which also accounts for pages the import did not sample).
    const known = entry.inspection?.pageSizes[page - 1];
    if (known) {
      const rotated = Math.abs(known.rotation) % 180 === 90;
      setPageSize(
        rotated
          ? { width: known.height, height: known.width }
          : { width: known.width, height: known.height },
      );
    }

    let alive = true;
    void thumbnailService.getPageSize(entry.id, entry.file, page).then((size) => {
      if (alive && size) setPageSize(size);
    });

    return () => {
      alive = false;
    };
  }, [page, entry.id, entry.file, entry.inspection]);

  const pageWidthPt = pageSize?.width ?? A4.width;
  const pageHeightPt = pageSize?.height ?? A4.height;
  const actualWidth = pageWidthPt * PT_TO_PX;
  const actualHeight = pageHeightPt * PT_TO_PX;

  /* ------------------------------- container ------------------------------ */

  useEffect(() => {
    if (!open) return;
    const element = viewportRef.current;
    if (!element) return;

    const measure = () =>
      setContainer({ width: element.clientWidth, height: element.clientHeight });

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setMode('fit');
    setDragging(false);
  }, [open]);

  /* -------------------------------- zoom math ----------------------------- */

  const fitScale = useMemo(() => {
    const width = container.width - 32; // p-4 on both sides
    const height = container.height - 32;
    if (width <= 0 || height <= 0) return 0.5;
    return Math.min(Math.max(Math.min(width / actualWidth, height / actualHeight), 0.1), 1.5);
  }, [container, actualWidth, actualHeight]);

  const scale = mode === 'fit' ? fitScale : manualScale;
  const displayWidth = Math.round(actualWidth * scale);

  const renderWidth = Math.min(
    MAX_RENDER_WIDTH,
    Math.max(MIN_RENDER_WIDTH, Math.round(displayWidth / RENDER_BUCKET) * RENDER_BUCKET),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setRequestWidth(renderWidth), 180);
    return () => window.clearTimeout(timer);
  }, [renderWidth]);

  const { thumb, loading } = usePageImage(entry, page, requestWidth);

  const applyScale = useCallback(
    (next: number, anchor?: { x: number; y: number }) => {
      const element = viewportRef.current;
      if (element) {
        // Zooming out of "fit" starts at the top of the page, which is what
        // people expect from a preview; later zooms keep the current centre.
        const ax = anchor?.x ?? element.clientWidth / 2;
        const ay = anchor?.y ?? (mode === 'fit' ? 0 : element.clientHeight / 2);
        anchorRef.current = {
          rx: (element.scrollLeft + ax) / Math.max(element.scrollWidth, 1),
          ry: (element.scrollTop + ay) / Math.max(element.scrollHeight, 1),
          ax,
          ay,
        };
      }
      setManualScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
      setMode('manual');
    },
    [mode],
  );

  const resetToFit = useCallback(() => {
    anchorRef.current = null;
    setMode('fit');
  }, []);

  const zoomStep = useCallback(
    (direction: number, anchor?: { x: number; y: number }) => {
      const next =
        direction > 0
          ? ZOOM_STEPS.find((step) => step > scale + 0.001)
          : [...ZOOM_STEPS].reverse().find((step) => step < scale - 0.001);
      if (next === undefined) return;
      applyScale(next, anchor);
    },
    [scale, applyScale],
  );

  // Keep the point under the cursor (or the viewport centre) stable while scaling.
  useLayoutEffect(() => {
    const element = viewportRef.current;
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!element || !anchor) return;
    element.scrollLeft = anchor.rx * element.scrollWidth - anchor.ax;
    element.scrollTop = anchor.ry * element.scrollHeight - anchor.ay;
  }, [scale]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || page === null) return;
    element.scrollTop = 0;
    element.scrollLeft = 0;
  }, [page]);

  /* ------------------------------- gestures ------------------------------- */

  // React attaches wheel listeners passively, so preventDefault only works with
  // a native listener. Ctrl/Cmd + wheel is also what trackpad pinch sends.
  useEffect(() => {
    if (!open) return;
    const element = viewportRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomStep(event.deltaY > 0 ? -1 : 1, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [open, zoomStep]);

  // Dragging only starts once the pointer actually moves: capturing on
  // pointerdown would swallow the double-click used for fit/100% toggling.
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const element = viewportRef.current;
    if (!element) return;
    if (
      element.scrollWidth <= element.clientWidth + 1 &&
      element.scrollHeight <= element.clientHeight + 1
    ) {
      return;
    }
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
      active: false,
      pointerId: event.pointerId,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const element = viewportRef.current;
    if (!drag || !element) return;

    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return;
      drag.active = true;
      element.setPointerCapture(drag.pointerId);
      setDragging(true);
    }

    element.scrollLeft = drag.left - (event.clientX - drag.x);
    element.scrollTop = drag.top - (event.clientY - drag.y);
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.active) return;
    setDragging(false);
    viewportRef.current?.releasePointerCapture?.(drag.pointerId);
  };

  const toggleActualSize = () => {
    if (Math.abs(scale - 1) < 0.01) resetToFit();
    else applyScale(1);
  };

  /* --------------------------------- render -------------------------------- */

  const size = page ? entry.inspection?.pageSizes[page - 1] : undefined;
  const selectedPages = new Set(effectivePages(entry));
  const included = page !== null && selectedPages.has(page - 1);
  const canPan = displayWidth > container.width;

  const go = (delta: number) => {
    if (page === null) return;
    const next = page + delta;
    if (next < 1 || next > entry.pageCount) return;
    onPageChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        className="max-w-4xl p-0"
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            go(-1);
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            go(1);
          } else if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoomStep(1);
          } else if (event.key === '-' || event.key === '_') {
            event.preventDefault();
            zoomStep(-1);
          } else if (event.key === '0') {
            event.preventDefault();
            resetToFit();
          }
        }}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-4 pr-14">
          <DialogTitle className="min-w-0 truncate text-sm">{entry.name}</DialogTitle>
          <DialogDescription className="sr-only">页面预览</DialogDescription>
          <Badge variant="secondary" className="tabular-nums">
            第 {page ?? 1} / {entry.pageCount} 页
          </Badge>
          {size && (
            <Badge variant="muted" className="tabular-nums">
              {toMillimetres(size.width)} × {toMillimetres(size.height)} mm
              {size.rotation ? ` · 旋转 ${size.rotation}°` : ''}
            </Badge>
          )}
          {included ? (
            <Badge variant="soft" className="ml-auto gap-1">
              <Check className="size-3" /> 参与合并
            </Badge>
          ) : (
            <Badge variant="muted" className="ml-auto gap-1">
              <Minus className="size-3" /> 已排除
            </Badge>
          )}
        </div>

        <div className="relative">
          <div
            ref={viewportRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={cn(
              'h-[56vh] overflow-auto bg-muted/40 p-4 sm:h-[62vh]',
              canPan && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
            )}
          >
            {thumb ? (
              <img
                src={thumb.url}
                alt={`第 ${page ?? 1} 页`}
                draggable={false}
                onDoubleClick={toggleActualSize}
                style={{ width: `${displayWidth}px` }}
                className="mx-auto block max-w-none select-none rounded-md bg-white shadow-raised"
              />
            ) : (
              <div className="grid h-full place-items-center text-muted-foreground">
                {loading ? (
                  <span className="flex items-center gap-2 text-sm">
                    <Loader2 className="size-4 animate-spin" /> 正在渲染页面…
                  </span>
                ) : (
                  <span className="text-sm">该页面无法渲染（可能已损坏）</span>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => go(-1)}
            disabled={(page ?? 1) <= 1}
            aria-label="上一页"
            className={cn(
              'absolute left-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full border border-border bg-card/95 text-foreground shadow-raised transition',
              'hover:bg-accent disabled:pointer-events-none disabled:opacity-40',
            )}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={(page ?? 1) >= entry.pageCount}
            aria-label="下一页"
            className={cn(
              'absolute right-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full border border-border bg-card/95 text-foreground shadow-raised transition',
              'hover:bg-accent disabled:pointer-events-none disabled:opacity-40',
            )}
          >
            <ChevronRight className="size-4" />
          </button>

          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
            <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-card/95 p-1 shadow-raised backdrop-blur">
              <button
                type="button"
                onClick={() => zoomStep(-1)}
                disabled={scale <= MIN_SCALE + 0.001}
                aria-label="缩小"
                title="缩小（-）"
                className="grid size-7 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <Minus className="size-3.5" />
              </button>
              <output
                aria-live="polite"
                data-testid="zoom-level"
                className="min-w-[46px] text-center text-[11.5px] tabular-nums text-muted-foreground"
              >
                {Math.round(scale * 100)}%
              </output>
              <button
                type="button"
                onClick={() => zoomStep(1)}
                disabled={scale >= MAX_SCALE - 0.001}
                aria-label="放大"
                title="放大（+）"
                className="grid size-7 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <Plus className="size-3.5" />
              </button>
              <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
              <button
                type="button"
                onClick={resetToFit}
                aria-label="适应窗口"
                title="适应窗口（0）"
                aria-pressed={mode === 'fit'}
                className={cn(
                  'grid size-7 place-items-center rounded-full transition hover:bg-muted',
                  mode === 'fit' ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Maximize2 className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => applyScale(1)}
                aria-label="实际大小"
                title="实际大小（100%）"
                className="grid h-7 place-items-center rounded-full px-1.5 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                1:1
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
          <p className="text-xs text-muted-foreground">
            双击切换适应窗口 / 100% · ⌘/Ctrl + 滚轮缩放 · ← → 翻页 · 合并时使用原始矢量页面
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => go(-1)} disabled={(page ?? 1) <= 1}>
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => go(1)}
              disabled={(page ?? 1) >= entry.pageCount}
            >
              下一页
            </Button>
            <Button
              variant={included ? 'secondary' : 'default'}
              size="sm"
              onClick={() => page !== null && togglePage(entry.id, page - 1)}
            >
              {included ? '从合并中排除' : '加入合并'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
