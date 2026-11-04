import { RotateCcw, RotateCw, Undo2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { RotatedImage } from '@/components/images/rotated-image';
import { FORMAT_LABELS } from '@/features/image-pdf/format';
import { rotateSize } from '@/features/image-pdf/page-layout';
import { formatBytes } from '@/lib/utils';
import { useImageStore, type ImageEntry } from '@/store/use-image-store';

export interface ImagePreviewDialogProps {
  entry: ImageEntry;
  index: number;
  open: boolean;
  onClose: () => void;
}

/** Full-size look at one image, including what the rotation does to it. */
export function ImagePreviewDialog({ entry, index, open, onClose }: ImagePreviewDialogProps) {
  const rotateImage = useImageStore((state) => state.rotateImage);
  const resetRotation = useImageStore((state) => state.resetRotation);
  const total = useImageStore((state) => state.images.length);

  const visible = rotateSize(entry.width, entry.height, entry.rotation);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-4xl">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1 pr-10">
          <DialogTitle className="min-w-0 break-all text-[15px]">{entry.name}</DialogTitle>
          <Badge variant="outline" className="mt-0.5 shrink-0">
            {FORMAT_LABELS[entry.format]}
          </Badge>
        </div>
        <DialogDescription>
          {visible.width} × {visible.height} px · {formatBytes(entry.size)} · 第 {index + 1} / {total} 张
          {entry.rotation !== 0 && ` · 已旋转 ${entry.rotation}°`}
          {entry.hasAlpha && ' · 含透明通道'}
        </DialogDescription>

        <div className="mt-3 grid h-[54vh] place-items-center overflow-hidden rounded-xl bg-muted/45 [container-type:size]">
          <RotatedImage
            src={entry.previewUrl}
            alt={entry.name}
            rotation={entry.rotation}
            naturalWidth={entry.width}
            naturalHeight={entry.height}
            mode="contain"
            className="p-2"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            旋转会真实改变输出 PDF 中的图片方向，而不是只改预览。
          </p>
          <div className="flex items-center gap-1.5">
            {entry.rotation !== 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => resetRotation(entry.id)}
              >
                <Undo2 className="size-3.5" />
                重置
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => rotateImage(entry.id, -1)}
            >
              <RotateCcw className="size-3.5" />
              左转 90°
            </Button>
            <Button type="button" size="sm" onClick={() => rotateImage(entry.id, 1)}>
              <RotateCw className="size-3.5" />
              右转 90°
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
