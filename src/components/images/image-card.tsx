import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, GripVertical, Maximize2, RotateCcw, RotateCw, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ImagePreviewDialog } from '@/components/images/image-preview-dialog';
import { RotatedImage } from '@/components/images/rotated-image';
import { FORMAT_LABELS } from '@/features/image-pdf/format';
import { cn, formatBytes } from '@/lib/utils';
import { useImageStore, type ImageEntry } from '@/store/use-image-store';

export interface ImageCardProps {
  entry: ImageEntry;
  index: number;
}

export function ImageCard({ entry, index }: ImageCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
  });
  const rotateImage = useImageStore((state) => state.rotateImage);
  const removeImage = useImageStore((state) => state.removeImage);
  const busy = useImageStore((state) => state.build.status === 'building');

  const [previewOpen, setPreviewOpen] = useState(false);

  const style = { transform: CSS.Transform.toString(transform), transition };

  if (entry.status === 'error') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        data-testid="image-card-error"
        data-image-name={entry.name}
        className="flex flex-col rounded-xl border border-destructive/25 bg-destructive-soft/70 p-3"
      >
        <div className="flex items-start gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
            <AlertTriangle className="size-4" />
          </span>
          <p className="min-w-0 flex-1 break-all text-[12px] font-medium leading-5" title={entry.name}>
            {entry.name}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-mr-1 shrink-0"
            aria-label={`移除 ${entry.name}`}
            onClick={() => removeImage(entry.id)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-destructive">{entry.error?.message}</p>
      </div>
    );
  }

  const loading = entry.status === 'reading';

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        data-testid="image-card"
        data-image-name={entry.name}
        data-rotation={entry.rotation}
        data-page-index={index + 1}
        className={cn(
          'group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-[box-shadow,border-color,transform] duration-200',
          isDragging
            ? 'z-20 border-primary/40 shadow-float'
            : 'border-border shadow-soft hover:border-border/60 hover:shadow-raised',
        )}
      >
        <div
          className={cn(
            'relative aspect-[4/3] overflow-hidden bg-muted/40 [container-type:size]',
            (entry.hasAlpha || loading) && 'checker',
          )}
        >
          {loading ? (
            <div className="skeleton absolute inset-0" />
          ) : (
            <div className="grid size-full place-items-center p-1.5">
              <RotatedImage
                src={entry.previewUrl}
                alt={`${entry.name} 缩略图`}
                rotation={entry.rotation}
                naturalWidth={entry.width}
                naturalHeight={entry.height}
                mode="contain"
              />
            </div>
          )}

          <span className="absolute left-1.5 top-1.5 z-10 grid size-[20px] place-items-center rounded-full bg-foreground/85 text-[10px] font-semibold tabular-nums text-background shadow-sm backdrop-blur">
            {index + 1}
          </span>

          <button
            type="button"
            aria-label={`拖拽调整 ${entry.name} 的顺序`}
            className={cn(
              'absolute right-1.5 top-1.5 z-10 grid size-6 place-items-center rounded-md bg-card/85 text-muted-foreground shadow-sm backdrop-blur transition-colors',
              'hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'cursor-grab touch-none active:cursor-grabbing',
            )}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
          </button>

          {entry.rotation !== 0 && (
            <Badge
              variant="secondary"
              className="absolute bottom-1.5 left-1.5 z-10 h-[18px] gap-0.5 px-1.5 text-[10px]"
            >
              {entry.rotation}°
            </Badge>
          )}

          {!loading && (
            <button
              type="button"
              aria-label={`预览 ${entry.name}`}
              onClick={() => setPreviewOpen(true)}
              className="absolute inset-0 grid place-items-center bg-slate-950/0 text-transparent transition-colors duration-200 hover:bg-slate-950/25 hover:text-white focus-visible:bg-slate-950/25 focus-visible:text-white focus-visible:outline-none [&_svg]:size-5"
            >
              <Maximize2 />
            </button>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col px-2 pb-1.5 pt-2">
          <p className="truncate text-[12px] font-medium leading-5" title={entry.name}>
            {entry.name}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[10.5px] text-muted-foreground">
            {loading ? (
              <span>读取中…</span>
            ) : (
              <>
                <span className="tabular-nums">
                  {entry.width} × {entry.height}
                </span>
                <span className="text-border">·</span>
                <span className="tabular-nums">{formatBytes(entry.size)}</span>
                <span className="text-border">·</span>
                <span>{FORMAT_LABELS[entry.format]}</span>
              </>
            )}
          </p>

          <div className="mt-auto flex items-center gap-0.5 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`向左旋转 ${entry.name}`}
              title="向左旋转 90°"
              disabled={busy || loading}
              data-testid="rotate-left"
              onClick={() => rotateImage(entry.id, -1)}
            >
              <RotateCcw className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`向右旋转 ${entry.name}`}
              title="向右旋转 90°"
              disabled={busy || loading}
              data-testid="rotate-right"
              onClick={() => rotateImage(entry.id, 1)}
            >
              <RotateCw className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ml-auto hover:text-destructive"
              aria-label={`删除 ${entry.name}`}
              title="删除"
              disabled={busy}
              data-testid="delete-image"
              onClick={() => removeImage(entry.id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <ImagePreviewDialog
        entry={entry}
        index={index}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
}
