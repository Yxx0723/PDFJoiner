import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileArchive,
  Files,
  Loader2,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatBytes, formatDuration, triggerBlobDownload } from '@/lib/utils';
import { describePages } from '@/features/pdf-split/plan';
import { buildZip } from '@/features/pdf-split/zip';
import type { SplitProgress } from '@/features/pdf-split/engine';
import { useSplitStore } from '@/store/use-split-store';

const STAGE_LABELS: Record<SplitProgress['stage'], string> = {
  loading: '正在读取 PDF',
  copying: '正在复制页面',
  saving: '正在生成文件',
  verifying: '正在校验输出',
  done: '拆分完成',
};

function ProgressView({
  progress,
  onCancel,
}: {
  progress: SplitProgress;
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
          文件 {progress.outputIndex + 1} / {progress.outputCount}
        </span>
      </div>

      <Progress
        value={progress.pagesDone}
        total={progress.pagesTotal}
        label={`已处理 ${progress.pagesDone} / ${progress.pagesTotal} 页`}
      />

      <div className="flex items-start justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate font-mono" title={progress.outputName}>
          {progress.outputName}
        </span>
        <span className="shrink-0 tabular-nums">
          {progress.pagesDone} / {progress.pagesTotal} 页
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[10.5px] leading-relaxed text-muted-foreground/80">
          进度按已复制页数统计，不做虚假百分比
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} className="shrink-0">
          <X className="size-3.5" />
          取消
        </Button>
      </div>
    </div>
  );
}

export function SplitResultPanel() {
  const build = useSplitStore((state) => state.build);
  const resetTask = useSplitStore((state) => state.resetTask);
  const cancelSplit = useSplitStore((state) => state.cancelSplit);

  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  if (build.status === 'idle') return null;

  if (build.status === 'splitting' && build.progress) {
    return (
      <div
        data-testid="split-progress"
        className="rounded-xl border border-border/80 bg-card p-4 shadow-soft"
      >
        <ProgressView progress={build.progress} onCancel={cancelSplit} />
      </div>
    );
  }

  if (build.status === 'error') {
    return (
      <div
        data-testid="split-error"
        className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive-soft p-3.5"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-destructive">拆分失败</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-destructive/90">
            {build.error}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={resetTask} className="shrink-0">
          重试
        </Button>
      </div>
    );
  }

  const files = build.files;
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const stem =
    files[0]?.name.replace(/\.pdf$/i, '').replace(/[_-]?\d+$/, '') || 'split';

  const downloadOne = (index: number) => {
    const file = files[index];
    if (!file) return;
    triggerBlobDownload(new Blob([file.bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }), file.name);
  };

  const downloadZip = async () => {
    if (files.length === 0 || zipping) return;
    setZipping(true);
    setZipError(null);
    try {
      const blob = await buildZip(files.map((file) => ({ name: file.name, bytes: file.bytes })));
      triggerBlobDownload(blob, `${stem}_split.zip`);
    } catch (error) {
      setZipError(error instanceof Error ? error.message : '打包失败，请改用单个下载。');
    } finally {
      setZipping(false);
    }
  };

  return (
    <div
      id="split-result"
      data-testid="split-result"
      className="rounded-xl border border-success/25 bg-success-soft p-3.5"
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-success/12 text-success">
          <CheckCircle2 className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-success">
            已拆分为 {files.length} 个文件
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-success/85">
            <span className="tabular-nums">共 {totalBytes ? formatBytes(totalBytes) : '—'}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">耗时 {formatDuration(build.durationMs)}</span>
            {build.verified ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="size-3" />
                  每个文件都已重新解析校验
                </span>
              </>
            ) : (
              <>
                <span aria-hidden="true">·</span>
                <span>部分文件体积较大，未做二次解析校验</span>
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={resetTask}
            data-testid="split-restart"
            className="gap-1.5"
          >
            <RotateCcw className="size-3.5" />
            重新开始
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void downloadZip()}
            disabled={zipping}
            data-testid="split-zip"
            className="gap-1.5"
          >
            {zipping ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileArchive className="size-3.5" />
            )}
            打包下载 ZIP
          </Button>
        </div>
      </div>

      {zipError && (
        <p className="mt-2 rounded-lg bg-destructive-soft px-2.5 py-1.5 text-[11px] text-destructive">
          {zipError}
        </p>
      )}

      <div className="mt-3 rounded-lg border border-success/20 bg-card/70">
        <div className="flex items-center justify-between border-b border-success/15 px-2.5 py-1.5">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Files className="size-3.5" />
            输出文件
          </span>
          <Badge variant="muted" className="tabular-nums">
            {files.length} 个
          </Badge>
        </div>

        <ul className="max-h-64 divide-y divide-border/50 overflow-y-auto">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              data-testid="split-result-file"
              data-file-name={file.name}
              className="flex items-center gap-2 px-2.5 py-1.5"
            >
              <span className="grid size-5 shrink-0 place-items-center rounded bg-muted text-[9.5px] font-semibold tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={file.name}>
                {file.name}
              </span>
              {/* Which pages ended up in this file — required information, not decoration. */}
              <span
                data-testid="split-result-pages"
                className="hidden shrink-0 text-[10.5px] text-muted-foreground md:inline"
              >
                {describePages(file.pages.map((page) => page + 1))}
              </span>
              <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/80">
                {file.pageCount} 页
              </span>
              <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                {formatBytes(file.sizeBytes)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`下载 ${file.name}`}
                title={`下载 ${file.name}`}
                data-testid="split-download"
                onClick={() => downloadOne(index)}
                className="shrink-0 text-muted-foreground hover:text-primary"
              >
                <Download className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
