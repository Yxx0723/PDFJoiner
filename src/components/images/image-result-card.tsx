import { useState } from 'react';
import { Check, CheckCircle2, Download, Eye, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GeneratedPdfDialog } from '@/components/images/generated-pdf-dialog';
import { formatBytes, formatDuration, sanitizeFileName, triggerDownload } from '@/lib/utils';
import { useImageStore } from '@/store/use-image-store';

export function ImageResultCard() {
  const build = useImageStore((state) => state.build);
  const settings = useImageStore((state) => state.settings);
  const setSettings = useImageStore((state) => state.setSettings);
  const resetResult = useImageStore((state) => state.resetResult);
  const clearAll = useImageStore((state) => state.clearAll);

  const [downloaded, setDownloaded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  if (build.status !== 'success' || !build.result) return null;
  const result = build.result;
  const fileName = sanitizeFileName(settings.outputName || result.fileName);

  return (
    <>
      <div
        id="image-result"
        data-testid="image-result"
        className="animate-fade-up relative overflow-hidden rounded-xl border border-success/30 bg-success-soft p-4 shadow-soft sm:p-5"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 size-48 rounded-full opacity-40 blur-2xl"
          style={{
            background: 'radial-gradient(circle, hsl(var(--success)/0.35), transparent 70%)',
          }}
        />

        <div className="relative flex items-start gap-3.5">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-success text-success-foreground shadow-sm">
            <CheckCircle2 className="size-5" />
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold tracking-tight text-foreground">PDF 已生成</h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
              <span className="tabular-nums">{result.pageCount} 页</span>
              <span className="text-border">·</span>
              <span className="tabular-nums">{formatBytes(result.sizeBytes)}</span>
              <span className="text-border">·</span>
              <span className="tabular-nums">耗时 {formatDuration(result.durationMs)}</span>
              <span className="text-border">·</span>
              <span>{result.verified ? '输出已二次校验' : '未做二次校验'}</span>
            </p>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Input
                  value={settings.outputName}
                  onChange={(event) => setSettings({ outputName: event.target.value })}
                  placeholder={result.fileName}
                  aria-label="下载文件名"
                  maxLength={120}
                  className="h-10 bg-card pr-12"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11.5px] text-muted-foreground">
                  .pdf
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="bg-card"
                  data-testid="preview-result"
                  onClick={() => setPreviewOpen(true)}
                >
                  <Eye className="size-4" />
                  预览
                </Button>
                <Button
                  type="button"
                  size="lg"
                  data-testid="image-download-button"
                  onClick={() => {
                    triggerDownload(result.url, fileName);
                    setDownloaded(true);
                  }}
                >
                  {downloaded ? <Check className="size-4" /> : <Download className="size-4" />}
                  {downloaded ? '再次下载' : '下载 PDF'}
                </Button>
              </div>
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
                继续调整设置
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

      <GeneratedPdfDialog
        result={result}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
}
