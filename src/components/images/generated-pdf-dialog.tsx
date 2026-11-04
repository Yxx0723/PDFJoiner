import { useEffect, useMemo, useState } from 'react';
import { FileWarning, Loader2 } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { LIMITS } from '@/lib/constants';
import { thumbnailService, type Thumbnail } from '@/features/preview/thumbnail-service';
import { useInView } from '@/hooks/use-in-view';
import type { ImageResult } from '@/store/use-image-store';

function GeneratedPage({
  fileId,
  file,
  pageNumber,
}: {
  fileId: string;
  file: File;
  pageNumber: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>('320px');
  const [thumb, setThumb] = useState<Thumbnail | null>(() =>
    thumbnailService.peek(fileId, pageNumber, LIMITS.generatedPreviewWidth) ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!inView || thumb || failed) return;
    let alive = true;
    thumbnailService
      .getThumbnail(fileId, file, pageNumber, LIMITS.generatedPreviewWidth)
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
  }, [inView, thumb, failed, fileId, file, pageNumber]);

  return (
    <div ref={ref} className="space-y-1">
      <div className="relative h-[220px] overflow-hidden rounded-md border border-border/70 bg-white shadow-soft">
        {thumb ? (
          <img
            src={thumb.url}
            alt={`生成结果第 ${pageNumber} 页`}
            className="absolute inset-0 m-auto max-h-full max-w-full object-contain p-1.5"
            draggable={false}
          />
        ) : failed ? (
          <span className="grid size-full place-items-center bg-muted/40 text-muted-foreground/60">
            <FileWarning className="size-5" />
          </span>
        ) : (
          <span className="grid size-full place-items-center bg-muted/40">
            <Loader2 className="size-4 animate-spin text-muted-foreground/60" />
          </span>
        )}
      </div>
      <p className="text-center text-[10.5px] tabular-nums text-muted-foreground">{pageNumber}</p>
    </div>
  );
}

export interface GeneratedPdfDialogProps {
  result: ImageResult | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Renders the produced PDF with PDF.js.
 *
 * This is the end-to-end proof that the file is a real, readable PDF: the same
 * renderer that powers the source previews consumes the output bytes.
 */
export function GeneratedPdfDialog({ result, open, onClose }: GeneratedPdfDialogProps) {
  const fileId = useMemo(() => `generated-${result?.url ?? 'none'}`, [result?.url]);
  const file = useMemo(
    () => (result ? new File([result.blob], 'generated.pdf', { type: 'application/pdf' }) : null),
    [result],
  );

  // Free the pdf.js document (and its page operators) as soon as the dialog is
  // gone; the blob itself stays alive for downloading.
  useEffect(() => {
    if (open) return;
    thumbnailService.release(fileId);
  }, [open, fileId]);

  useEffect(() => () => thumbnailService.release(fileId), [fileId]);

  const pageNumbers = result ? Array.from({ length: result.pageCount }, (_, i) => i + 1) : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-4xl" data-testid="generated-pdf-dialog">
        <DialogTitle>生成结果预览</DialogTitle>
        <DialogDescription>
          共 {result?.pageCount ?? 0} 页 · 由 PDF.js 从生成的文件中实时渲染
          {result?.verified ? ' · 输出已二次校验' : ''}
        </DialogDescription>

        <div
          className="mt-3 max-h-[64vh] overflow-y-auto rounded-xl bg-muted/35 p-3"
          data-testid="generated-pdf-pages"
        >
          {file ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {pageNumbers.map((pageNumber) => (
                <GeneratedPage
                  key={pageNumber}
                  fileId={fileId}
                  file={file}
                  pageNumber={pageNumber}
                />
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-[12px] text-muted-foreground">没有可预览的结果</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
