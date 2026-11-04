import { AlertTriangle, FileText, Loader2, RefreshCw, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FilePickerButton } from '@/components/upload/drop-zone';
import { formatBytes } from '@/lib/utils';
import { useSplitStore, type SplitDocument } from '@/store/use-split-store';

/** True only when the sampled page boxes actually differ. */
function hasMixedSizes(doc: SplitDocument): boolean {
  const sizes = doc.inspection?.pageSizes;
  if (!sizes || sizes.length < 2) return false;
  const [first] = sizes;
  return sizes.some(
    (size) =>
      Math.abs(size.width - first.width) > 1 ||
      Math.abs(size.height - first.height) > 1 ||
      size.rotation !== first.rotation,
  );
}

function caveatsOf(doc: SplitDocument): string[] {
  const inspection = doc.inspection;
  if (!inspection) return [];
  const notes: string[] = [];
  if (inspection.hasSignatures) notes.push('含数字签名：拆分后原签名不再有效');
  if (inspection.hasForms) notes.push('含交互表单：拆分后字段不保留');
  if (inspection.hasOutlines) notes.push('含书签：拆分后文档书签不保留');
  return notes;
}

export interface DocumentCardProps {
  doc: SplitDocument;
  /** Replacement goes through the workspace so rejections surface as toasts. */
  onReplace: (files: File[]) => void;
}

export function DocumentCard({ doc, onReplace }: DocumentCardProps) {
  const removeDocument = useSplitStore((state) => state.removeDocument);
  const busy = useSplitStore((state) => state.build.status === 'splitting');

  const caveats = caveatsOf(doc);
  const reading = doc.status === 'reading';
  const failed = doc.status === 'error';

  return (
    <div
      data-testid="split-document"
      data-file-name={doc.name}
      className="rounded-xl border border-border/80 bg-card p-3.5 shadow-soft"
    >
      <div className="flex items-start gap-3">
        <span
          className={
            failed
              ? 'grid size-10 shrink-0 place-items-center rounded-lg bg-destructive-soft text-destructive'
              : 'grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary'
          }
        >
          {reading ? (
            <Loader2 className="size-5 animate-spin" />
          ) : failed ? (
            <AlertTriangle className="size-5" />
          ) : (
            <FileText className="size-5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium leading-5" title={doc.name}>
            {doc.name}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
            <span className="tabular-nums">{formatBytes(doc.size)}</span>
            {reading && <span>正在读取页数…</span>}
            {doc.status === 'ready' && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums font-medium text-foreground">{doc.pageCount} 页</span>
              </>
            )}
            {failed && <span className="text-destructive">{doc.error?.message}</span>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <FilePickerButton onFiles={onReplace} label="替换" className="gap-1" />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="移除这份 PDF"
            title="移除这份 PDF"
            disabled={busy}
            onClick={removeDocument}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {caveats.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-warning/25 bg-warning-soft px-2.5 py-2">
          {caveats.map((note) => (
            <li key={note} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warning">
              <AlertTriangle className="mt-px size-3 shrink-0" />
              {note}
            </li>
          ))}
        </ul>
      )}

      {doc.status === 'ready' && doc.pageCount > 0 && (
        <p className="mt-2.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground/80">
          <RefreshCw className="size-3" />
          点「替换」可以换一份 PDF，当前设置会重新计算
        </p>
      )}

      {doc.status === 'ready' && hasMixedSizes(doc) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="muted">混合纸张尺寸或方向</Badge>
          <Badge variant="muted">拆分后按原始尺寸保留</Badge>
        </div>
      )}
    </div>
  );
}
