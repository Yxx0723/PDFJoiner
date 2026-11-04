import { ImagePlus, ShieldCheck, Plus, UploadCloud } from 'lucide-react';
import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import { LIMITS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useFileDrop } from '@/hooks/use-file-drop';

/** Compact "add files" button for the workspace toolbar. */
export function FilePickerButton({
  onFiles,
  className,
  label = '添加文件',
  accept = 'application/pdf,.pdf',
}: {
  onFiles: (files: File[]) => void;
  className?: string;
  label?: string;
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn('gap-1.5', className)}
        onClick={() => inputRef.current?.click()}
      >
        <Plus className="size-3.5" />
        {label}
      </Button>
    </>
  );
}

export interface DropZoneProps {
  onFiles: (files: File[]) => void;
  className?: string;
  /** `accept` for the hidden file input. */
  accept?: string;
  title?: string;
  draggingTitle?: string;
  subtitle?: string;
  cta?: string;
  /** Swaps the upload glyph and the default copy between the two tools. */
  kind?: 'pdf' | 'image';
}

const DROP_COPY = {
  pdf: {
    accept: 'application/pdf,.pdf',
    title: '拖入 PDF，或点击选择文件',
    draggingTitle: '松开即可添加 PDF',
    subtitle: (limit: number) => `可一次选择多个文件 · 单个文件最大 ${limit} MB`,
    cta: '选择 PDF 文件',
  },
  image: {
    accept: 'image/*,.jpg,.jpeg,.png,.webp,.bmp,.gif,.heic,.heif',
    title: '拖入图片，或点击选择文件',
    draggingTitle: '松开即可添加图片',
    subtitle: (limit: number) => `JPG / PNG / WebP / BMP / GIF · 单张最大 ${limit} MB`,
    cta: '选择图片',
  },
} as const;

export function DropZone({
  onFiles,
  className,
  accept,
  title,
  draggingTitle,
  subtitle,
  cta,
  kind = 'pdf',
}: DropZoneProps) {
  const copy = DROP_COPY[kind];
  const resolvedAccept = accept ?? copy.accept;
  const limitMb = Math.round(
    (kind === 'image' ? LIMITS.maxImageFileSizeBytes : LIMITS.maxFileSizeBytes) / 1024 / 1024,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { isDragging, handlers } = useFileDrop(onFiles);

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept={resolvedAccept}
      multiple
      className="sr-only"
      tabIndex={-1}
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        // Reset so picking the same file twice still fires a change event.
        event.target.value = '';
        if (files.length > 0) onFiles(files);
      }}
    />
  );

  return (
    <>
      {picker}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        {...handlers}
        className={cn(
          'group relative flex w-full flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed px-6 py-11 text-center transition-all duration-300 sm:py-14',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border bg-card/70 hover:border-primary/45 hover:bg-card',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500',
            isDragging && 'opacity-100',
          )}
          style={{
            background:
              'radial-gradient(60% 60% at 50% 35%, hsl(var(--primary)/0.12), transparent 72%)',
          }}
        />

        <span
          className={cn(
            'relative grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-raised transition-transform duration-300',
            isDragging ? 'scale-110' : 'group-hover:-translate-y-0.5',
          )}
        >
          {kind === 'image' ? <ImagePlus className="size-6" /> : <UploadCloud className="size-6" />}
        </span>

        <span className="relative mt-4 text-[15px] font-medium tracking-tight">
          {isDragging ? (draggingTitle ?? copy.draggingTitle) : (title ?? copy.title)}
        </span>
        <span className="relative mt-1.5 text-[12.5px] text-muted-foreground">
          {subtitle ?? copy.subtitle(limitMb)}
        </span>

        <span className="relative mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors group-hover:bg-primary/92">
          <Plus className="size-4" />
          {cta ?? copy.cta}
        </span>

        <span className="relative mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3.5 text-success" />
          文件不会离开这台设备
        </span>
      </button>
    </>
  );
}
