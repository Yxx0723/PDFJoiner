import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileText,
  GripVertical,
  Info,
  LayoutGrid,
  Trash2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RangeEditor } from '@/components/files/range-editor';
import { PageStrip } from '@/components/pages/page-strip';
import { PagePreviewDialog } from '@/components/pages/page-preview-dialog';
import { formatBytes, cn } from '@/lib/utils';
import { useAppStore, selectedPageCount, type PdfFileEntry } from '@/store/use-app-store';
import { describeCaveats } from '@/store/selectors';

export interface FileCardProps {
  entry: PdfFileEntry;
  index: number;
  total: number;
}

export function FileCard({ entry, index, total }: FileCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
  });
  const moveFile = useAppStore((state) => state.moveFile);
  const removeFile = useAppStore((state) => state.removeFile);
  const toggleExpanded = useAppStore((state) => state.toggleExpanded);
  const busy = useAppStore((state) => state.merge.status === 'merging');

  const [previewPage, setPreviewPage] = useState<number | null>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (entry.status === 'reading') {
    return (
      <div ref={setNodeRef} style={style} className="rounded-xl border border-border bg-card p-3.5 shadow-soft">
        <div className="flex items-center gap-3">
          <div className="skeleton size-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-1/3" />
            <div className="skeleton h-3 w-1/2" />
          </div>
          <span className="text-[11px] text-muted-foreground">读取中…</span>
        </div>
      </div>
    );
  }

  if (entry.status === 'error') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        data-testid="file-card-error"
        data-file-name={entry.name}
        className="rounded-xl border border-destructive/25 bg-destructive-soft/70 p-3.5"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium" title={entry.name}>
                {entry.name}
              </p>
              <Badge variant="destructive">
                {entry.error?.code === 'encrypted' ? '已加密' : '无法处理'}
              </Badge>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-destructive">
              {entry.error?.message ?? '该文件无法被读取。'}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {entry.error?.code === 'encrypted'
                ? '第一版不支持加密 PDF：pdf-lib 无法在浏览器内解密。请先用其它工具解除密码保护后重新导入。'
                : '请确认文件完整、未损坏，并确实为 PDF 格式。'}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => removeFile(entry.id)}
            aria-label={`移除 ${entry.name}`}
            title="移除"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  const caveats = describeCaveats(entry);
  const selected = selectedPageCount(entry);

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        data-testid="file-card"
        data-file-name={entry.name}
        className={cn(
          'relative rounded-xl border bg-card transition-[box-shadow,border-color,transform] duration-200',
          isDragging
            ? 'z-20 border-primary/40 shadow-float'
            : 'border-border shadow-soft hover:border-border/60 hover:shadow-raised',
        )}
      >
        <div className="flex items-start gap-2.5 p-3 sm:gap-3 sm:p-3.5">
          <button
            type="button"
            className={cn(
              'mt-2.5 shrink-0 rounded p-0.5 text-muted-foreground/35 transition-colors',
              'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'cursor-grab touch-none active:cursor-grabbing',
            )}
            aria-label={`拖拽调整 ${entry.name} 的顺序`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>

          <div className="relative shrink-0">
            <div className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary">
              <FileText className="size-5" />
            </div>
            <span className="absolute -left-1.5 -top-1.5 grid size-[18px] place-items-center rounded-full bg-foreground text-[10px] font-semibold tabular-nums text-background shadow-sm">
              {index + 1}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
              <div className="min-w-0 flex-1">
                <p
                  className="line-clamp-2 break-all text-sm font-medium leading-5 sm:line-clamp-1 sm:truncate"
                  title={entry.name}
                >
                  {entry.name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
                  <span className="tabular-nums">{formatBytes(entry.size)}</span>
                  <span className="text-border">·</span>
                  <span className="tabular-nums">{entry.pageCount} 页</span>
                  <span className="text-border">·</span>
                  <span
                    className={cn(
                      'tabular-nums',
                      selected === 0 ? 'font-medium text-destructive' : 'text-accent-foreground',
                    )}
                  >
                    合并 {selected} 页
                  </span>
                </div>
              </div>

              <div className="-mr-1 flex shrink-0 items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy || index === 0}
                  data-testid="move-up"
                  onClick={() => moveFile(entry.id, -1)}
                  aria-label="上移"
                  title="上移"
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy || index === total - 1}
                  data-testid="move-down"
                  onClick={() => moveFile(entry.id, 1)}
                  aria-label="下移"
                  title="下移"
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant={entry.expanded ? 'soft' : 'ghost'}
                  size="sm"
                  className="gap-1.5 px-2"
                  disabled={busy}
                  onClick={() => toggleExpanded(entry.id)}
                  data-testid="toggle-pages"
                  aria-expanded={entry.expanded}
                  title="页面预览与逐页选择"
                >
                  <LayoutGrid className="size-3.5" />
                  <span className="hidden sm:inline">页面</span>
                  <ChevronDown
                    className={cn(
                      'size-3.5 transition-transform duration-200',
                      entry.expanded && 'rotate-180',
                    )}
                  />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  onClick={() => removeFile(entry.id)}
                  aria-label={`移除 ${entry.name}`}
                  title="移除"
                  className="hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>

            {caveats.length > 0 && (
              <ul className="mt-2 space-y-1">
                {caveats.slice(0, 3).map((note) => (
                  <li key={note} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warning">
                    <Info className="mt-px size-3 shrink-0" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            )}

            {entry.expanded && (
              <div className="mt-3 space-y-3 border-t border-border/70 pt-3">
                <RangeEditor entry={entry} />
                <PageStrip entry={entry} onPreview={setPreviewPage} />
              </div>
            )}
          </div>
        </div>
      </div>

      <PagePreviewDialog
        entry={entry}
        page={previewPage}
        onPageChange={setPreviewPage}
        onClose={() => setPreviewPage(null)}
      />
    </>
  );
}
