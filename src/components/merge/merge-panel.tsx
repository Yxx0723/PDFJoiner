import { useState } from 'react';
import { Check, CheckCircle2, Download, FileCheck2, Loader2, RotateCcw, ShieldCheck, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn, formatBytes, formatDuration, sanitizeFileName, triggerDownload } from '@/lib/utils';
import { useAppStore, selectedPageCount, type PdfFileEntry } from '@/store/use-app-store';
import { getMergeBlockers, summarize } from '@/store/selectors';
import type { MergeProgress } from '@/features/pdf/engine';

const STAGE_LABELS: Record<MergeProgress['stage'], string> = {
  loading: '正在读取文件',
  copying: '正在复制页面',
  saving: '正在生成 PDF',
  verifying: '正在校验输出',
  done: '合并完成',
};

function SummaryGrid({ files }: { files: PdfFileEntry[] }) {
  const summary = summarize(files);
  return (
    <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border/70 bg-muted/25">
      {[
        { label: '文件', value: summary.fileCount.toString(), suffix: '个' },
        { label: '合并页数', value: summary.outputPages.toString(), suffix: '页' },
        { label: '总大小', value: formatBytes(summary.inputBytes), suffix: '' },
      ].map((item) => (
        <div key={item.label} className="px-2.5 py-2.5 text-center">
          <div className="text-[15px] font-semibold tabular-nums leading-6">
            {item.value}
            {item.suffix && (
              <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">
                {item.suffix}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function OrderList({ files }: { files: PdfFileEntry[] }) {
  if (files.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          输出顺序
        </span>
        <span className="text-[10.5px] text-muted-foreground/80">自上而下</span>
      </div>
      <ol className="max-h-36 space-y-1 overflow-y-auto pr-1">
        {files.map((entry, index) => (
          <li key={entry.id} className="flex items-center gap-2 text-[11.5px]">
            <span className="grid size-4 shrink-0 place-items-center rounded bg-muted text-[9.5px] font-semibold tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={entry.name}>
              {entry.name}
            </span>
            <span
              className={cn(
                'shrink-0 tabular-nums',
                entry.status === 'error' ? 'text-destructive' : 'text-muted-foreground/80',
              )}
            >
              {entry.status === 'error' ? '异常' : `${selectedPageCount(entry)} 页`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProgressView({
  progress,
  onCancel,
}: {
  progress: MergeProgress;
  onCancel: () => void;
}) {
  const percentOfPages = progress.pagesTotal
    ? Math.round((progress.pagesDone / progress.pagesTotal) * 100)
    : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium" aria-live="polite">
          <Loader2 className="size-4 animate-spin text-primary" />
          {STAGE_LABELS[progress.stage]}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {progress.pagesDone} / {progress.pagesTotal} 页
        </span>
      </div>

      <Progress
        value={progress.pagesDone}
        total={progress.pagesTotal}
        label={`已完成 ${progress.pagesDone} / ${progress.pagesTotal} 页`}
      />

      <div className="flex items-start justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate" title={progress.fileName}>
          {progress.fileName}
        </span>
        <span className="shrink-0 tabular-nums">
          文件 {progress.fileIndex + 1} / {progress.fileCount}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[10.5px] leading-relaxed text-muted-foreground/80">
          进度按已处理页数统计 · 已完成 {percentOfPages}%
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} className="shrink-0">
          <X className="size-3.5" />
          取消
        </Button>
      </div>
    </div>
  );
}

export function MergePanel() {
  const files = useAppStore((state) => state.files);
  const merge = useAppStore((state) => state.merge);
  const outputName = useAppStore((state) => state.outputName);
  const setOutputName = useAppStore((state) => state.setOutputName);
  const startMerge = useAppStore((state) => state.startMerge);
  const cancelMerge = useAppStore((state) => state.cancelMerge);

  const summary = summarize(files);
  const busy = merge.status === 'merging';
  const blockers = getMergeBlockers(files, busy);
  const canMerge = blockers.length === 0;

  return (
    <Card className="border-border/80">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>合并设置</CardTitle>
          <Badge variant="success" className="gap-1">
            <ShieldCheck className="size-3" />
            本地处理
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {busy && merge.progress ? (
          <ProgressView progress={merge.progress} onCancel={cancelMerge} />
        ) : (
          <>
            {merge.status === 'success' && merge.result && (
              <div className="flex items-center gap-2 rounded-lg border border-success/25 bg-success-soft px-2.5 py-2 text-[11.5px] text-success">
                <CheckCircle2 className="size-4 shrink-0" />
                已生成 {merge.result.pageCount} 页 PDF，可在上方下载
              </div>
            )}

            {merge.status === 'error' && merge.error && (
              <div className="rounded-lg border border-destructive/25 bg-destructive-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-destructive">
                {merge.error}
              </div>
            )}

            <SummaryGrid files={files} />
            <OrderList files={files} />

            <div className="space-y-1.5">
              <label
                htmlFor="output-name"
                className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                输出文件名
              </label>
              <div className="relative">
                <Input
                  id="output-name"
                  value={outputName}
                  disabled={busy}
                  placeholder="合并结果"
                  className="pr-12"
                  maxLength={120}
                  onChange={(event) => setOutputName(event.target.value)}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11.5px] text-muted-foreground">
                  .pdf
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={!canMerge}
                data-testid="merge-button"
                onClick={() => void startMerge()}
              >
                <FileCheck2 className="size-4" />
                {merge.status === 'success'
                  ? `重新合并 ${summary.outputPages} 页`
                  : `合并 ${summary.outputPages} 页 PDF`}
              </Button>
              {!canMerge && blockers[0] && (
                <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                  {blockers[0]}
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
              <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" />
                文件只在当前浏览器内存中解析与合并，不会上传服务器，也没有任何第三方请求。刷新或关闭页面后数据立即消失。
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ResultCard() {
  const merge = useAppStore((state) => state.merge);
  const outputName = useAppStore((state) => state.outputName);
  const setOutputName = useAppStore((state) => state.setOutputName);
  const resetResult = useAppStore((state) => state.resetResult);
  const clearAll = useAppStore((state) => state.clearAll);

  const [downloaded, setDownloaded] = useState(false);

  if (merge.status !== 'success' || !merge.result) return null;
  const result = merge.result;
  const fileName = sanitizeFileName(outputName || result.fileName);

  return (
    <div
      id="merge-result"
      className="animate-fade-up relative overflow-hidden rounded-xl border border-success/30 bg-success-soft p-4 shadow-soft sm:p-5"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 size-48 rounded-full opacity-40 blur-2xl"
        style={{ background: 'radial-gradient(circle, hsl(var(--success)/0.35), transparent 70%)' }}
      />
      <div className="relative flex items-start gap-3.5">
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-success text-success-foreground shadow-sm">
          <CheckCircle2 className="size-5" />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground">合并完成</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
            <span className="tabular-nums">{result.pageCount} 页</span>
            <span className="text-border">·</span>
            <span className="tabular-nums">{formatBytes(result.sizeBytes)}</span>
            <span className="text-border">·</span>
            <span className="tabular-nums">耗时 {formatDuration(result.durationMs)}</span>
            <span className="text-border">·</span>
            <span>{result.verified ? '输出已二次校验' : '输出较大，未做二次校验'}</span>
          </p>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Input
                value={outputName}
                onChange={(event) => setOutputName(event.target.value)}
                placeholder={result.fileName}
                aria-label="下载文件名"
                maxLength={120}
                className="h-10 bg-card pr-12"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11.5px] text-muted-foreground">
                .pdf
              </span>
            </div>
            <Button
              type="button"
              size="lg"
              className="shrink-0"
              data-testid="download-button"
              onClick={() => {
                triggerDownload(result.url, fileName);
                setDownloaded(true);
              }}
            >
              {downloaded ? <Check className="size-4" /> : <Download className="size-4" />}
              {downloaded ? '再次下载' : '下载 PDF'}
            </Button>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11.5px] text-muted-foreground hover:text-foreground"
              onClick={resetResult}
            >
              <RotateCcw className="size-3.5" />
              继续调整文件
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11.5px] text-muted-foreground hover:text-destructive"
              onClick={clearAll}
            >
              清空并开始新任务
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
