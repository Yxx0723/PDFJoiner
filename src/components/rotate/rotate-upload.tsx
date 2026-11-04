import { AlertTriangle, FileText, Loader2, RefreshCw, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FilePickerButton } from '@/components/upload/drop-zone';
import { formatBytes } from '@/lib/utils';
import { useRotateStore, type RotateDocument } from '@/store/use-rotate-store';

/** Honest, measured caveats — see README for what was actually tested. */
function caveatsOf(doc: RotateDocument): string[] {
  const inspection = doc.inspection;
  if (!inspection) return [];
  const notes: string[] = [];
  if (inspection.hasSignatures) notes.push('含数字签名：重新保存后原签名不再有效');
  if (inspection.hasForms) notes.push('含交互表单：请先确认字段在目标阅读器中仍可用');
  if (inspection.hasOutlines) notes.push('含书签：导出后建议检查书签指向');
  return notes;
}

export interface RotateUploadProps {
  doc: RotateDocument;
  onReplace: (files: File[]) => void;
}

export function RotateUpload({ doc, onReplace }: RotateUploadProps) {
  const removeDocument = useRotateStore((state) => state.removeDocument);
  const busy = useRotateStore((state) => state.exportStatus === 'exporting');

  const caveats = caveatsOf(doc);
  const reading = doc.status === 'reading';
  const failed = doc.status === 'error';
  const preRotated = doc.originalRotations.filter((angle) => angle !== 0).length;

  return (
    <div
      data-testid="rotate-document"
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
            {reading && <span>正在读取每页方向…</span>}
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
            data-testid="rotate-remove"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {doc.status === 'ready' && preRotated > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Badge variant="muted" className="tabular-nums">
            {preRotated} 页原本就带 /Rotate
          </Badge>
          <Badge variant="muted">新角度 = 原始角度 + 本次旋转</Badge>
        </div>
      )}

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

      {doc.status === 'ready' && (
        <p className="mt-2.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground/80">
          <RefreshCw className="size-3" />
          原始文件保持只读，导出为 <span className="font-mono">{doc.name.replace(/\.pdf$/i, '')}_rotated.pdf</span>
        </p>
      )}
    </div>
  );
}
