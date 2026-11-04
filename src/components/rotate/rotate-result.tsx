import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatBytes, formatDuration, triggerBlobDownload } from '@/lib/utils';
import type { RotateProgress } from '@/features/pdf-rotate/types';
import { useRotateStore } from '@/store/use-rotate-store';

const STAGE_LABELS: Record<RotateProgress['stage'], string> = {
  loading: '正在读取 PDF',
  applying: '正在应用页面旋转',
  saving: '正在生成新 PDF',
  verifying: '正在校验输出',
  done: '导出完成',
};

function ProgressView({
  progress,
  onCancel,
}: {
  progress: RotateProgress;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium" aria-live="polite">
          <Loader2 className="size-4 animate-spin text-primary" />
          {STAGE_LABELS[progress.stage]}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {progress.current} / {progress.total} 页
        </span>
      </div>

      <Progress
        value={progress.current}
        total={progress.total}
        label={`已处理 ${progress.current} / ${progress.total} 页`}
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-[10.5px] leading-relaxed text-muted-foreground/80">
          进度按真实处理页数统计，不做虚假百分比
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} className="shrink-0">
          <X className="size-3.5" />
          取消
        </Button>
      </div>
    </div>
  );
}

export function RotateResult() {
  const exportStatus = useRotateStore((state) => state.exportStatus);
  const progress = useRotateStore((state) => state.progress);
  const error = useRotateStore((state) => state.error);
  const result = useRotateStore((state) => state.result);
  const startExport = useRotateStore((state) => state.startExport);
  const cancelExport = useRotateStore((state) => state.cancelExport);
  const resetTask = useRotateStore((state) => state.resetTask);

  if (exportStatus === 'idle') return null;

  if (exportStatus === 'exporting' && progress) {
    return (
      <div data-testid="rotate-progress" className="rounded-xl border border-border/80 bg-card p-4 shadow-soft">
        <ProgressView progress={progress} onCancel={cancelExport} />
      </div>
    );
  }

  if (exportStatus === 'error') {
    return (
      <div
        data-testid="rotate-error"
        className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive-soft p-3.5"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-destructive">导出失败</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-destructive/90">{error}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => void startExport()} className="shrink-0">
          重试
        </Button>
      </div>
    );
  }

  if (exportStatus === 'cancelled') {
    return (
      <div
        data-testid="rotate-cancelled"
        className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-3.5"
      >
        <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">导出已取消</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            未生成任何文件，旋转设置仍保留，可以随时重新导出。
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void startExport()} className="shrink-0">
          重新导出
        </Button>
      </div>
    );
  }

  if (!result) return null;

  const download = () => {
    const copy = result.bytes.slice();
    triggerBlobDownload(
      new Blob([copy.buffer as ArrayBuffer], { type: 'application/pdf' }),
      result.name,
    );
  };

  const angleSummary = result.rotations
    .slice(0, 12)
    .map((angle, index) => `P${index + 1} ${angle}°`)
    .join(' · ');

  return (
    <div
      id="rotate-result"
      data-testid="rotate-result"
      className="rounded-xl border border-success/25 bg-success-soft p-3.5"
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-success/12 text-success">
          <CheckCircle2 className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-success">旋转后的 PDF 已生成</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-success/85">
            <span className="truncate font-mono" title={result.name}>{result.name}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{formatBytes(result.sizeBytes)}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{result.pageCount} 页</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">耗时 {formatDuration(result.durationMs)}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5">
            {result.verified ? (
              <Badge variant="soft" className="gap-1">
                <ShieldCheck className="size-3" />
                已重新解析并逐页核对角度与尺寸
              </Badge>
            ) : (
              <Badge variant="muted">文件较大，未做二次解析校验</Badge>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={resetTask}
            data-testid="rotate-restart"
            className="gap-1.5"
          >
            <RotateCcw className="size-3.5" />
            重新开始
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={download}
            data-testid="rotate-download"
            className="gap-1.5"
          >
            <Download className="size-3.5" />
            下载 PDF
          </Button>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-success/20 bg-card/70 px-2.5 py-2">
        <p data-testid="rotate-result-angles" className="truncate font-mono text-[10.5px] text-muted-foreground" title={angleSummary}>
          {angleSummary}
          {result.rotations.length > 12 ? ` · 还有 ${result.rotations.length - 12} 页` : ''}
        </p>
      </div>
    </div>
  );
}
