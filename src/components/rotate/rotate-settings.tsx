import { AlertCircle, Download, Info, RotateCcw, RotateCw, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn, formatPages } from '@/lib/utils';
import type { RotateScope } from '@/features/pdf-rotate/types';
import {
  outputNameOf,
  useRotateStore,
  type RotateDocument,
  type ScopeResolution,
} from '@/store/use-rotate-store';

const SCOPES: Array<{ value: RotateScope; label: string; hint: string }> = [
  { value: 'page', label: '当前页', hint: '大图预览正在看的那一页' },
  { value: 'selected', label: '已选页面', hint: '在缩略图上勾选的页面' },
  { value: 'all', label: '全部页面', hint: '整份 PDF' },
  { value: 'range', label: '页码范围', hint: '例如 1-3,6,9-12' },
];

export interface RotateSettingsPanelProps {
  doc: RotateDocument;
  resolution: ScopeResolution;
  rotatedCount: number;
}

export function RotateSettingsPanel({
  doc,
  resolution,
  rotatedCount,
}: RotateSettingsPanelProps) {
  const scope = useRotateStore((state) => state.scope);
  const setScope = useRotateStore((state) => state.setScope);
  const rangeDraft = useRotateStore((state) => state.rangeDraft);
  const rangeError = useRotateStore((state) => state.rangeError);
  const setRangeDraft = useRotateStore((state) => state.setRangeDraft);
  const rotateBy = useRotateStore((state) => state.rotateBy);
  const resetAll = useRotateStore((state) => state.resetAll);
  const startExport = useRotateStore((state) => state.startExport);
  const cancelExport = useRotateStore((state) => state.cancelExport);
  const exportStatus = useRotateStore((state) => state.exportStatus);
  const history = useRotateStore((state) => state.history);

  const busy = exportStatus === 'exporting';
  const ready = doc.status === 'ready';
  const canRotate = ready && !busy && !resolution.error && resolution.indices.length > 0;

  return (
    <div className="space-y-3.5">
      <Card className="border-border/80">
        <CardHeader className="pb-2.5">
          <div className="flex items-center justify-between gap-2">
            <CardTitle>旋转范围</CardTitle>
            <Badge variant="muted" className="tabular-nums">
              第 {history.index + 1} / {history.entries.length} 步
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-1.5">
            {SCOPES.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={busy}
                aria-pressed={scope === option.value}
                data-testid={`rotate-scope-${option.value}`}
                onClick={() => setScope(option.value)}
                title={option.hint}
                className={cn(
                  'rounded-lg border px-2 py-1.5 text-left transition-all duration-200',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  scope === option.value
                    ? 'border-primary/40 bg-primary-soft shadow-sm'
                    : 'border-border/70 bg-card hover:border-primary/25',
                  busy && 'pointer-events-none opacity-60',
                )}
              >
                <span className="block text-[12px] font-medium">{option.label}</span>
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                  {option.hint}
                </span>
              </button>
            ))}
          </div>

          {scope === 'range' && (
            <div className="space-y-1.5">
              <Input
                value={rangeDraft}
                disabled={busy}
                inputMode="text"
                placeholder="1-3,6,9-12（留空表示全部）"
                aria-label="要旋转的页码范围"
                aria-invalid={rangeError ? true : undefined}
                data-testid="rotate-range-input"
                onChange={(event) => setRangeDraft(event.target.value)}
                className={cn(
                  'h-8 text-[12.5px] tabular-nums',
                  rangeError && 'border-destructive/60 focus-visible:ring-destructive/30',
                )}
              />
              {rangeError && (
                <p data-testid="rotate-range-error" className="text-[10.5px] leading-relaxed text-destructive">
                  {rangeError}
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/25 px-2.5 py-2">
            <span className="text-[11px] text-muted-foreground">{resolution.label}</span>
            <span
              data-testid="rotate-affected-count"
              className={cn(
                'text-[12px] font-semibold tabular-nums',
                resolution.error ? 'text-destructive' : 'text-foreground',
              )}
            >
              {resolution.error ? '范围无效' : `将影响 ${resolution.indices.length} 页`}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80">
        <CardHeader className="pb-2.5">
          <CardTitle>旋转操作</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-1.5">
            <Button
              type="button"
              variant="outline"
              disabled={!canRotate}
              onClick={() => rotateBy(-90)}
              data-testid="rotate-batch-left"
              className="h-9 flex-col gap-0.5 px-1 text-[11.5px]"
            >
              <RotateCcw className="size-3.5" />
              左转 90°
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canRotate}
              onClick={() => rotateBy(90)}
              data-testid="rotate-batch-right"
              className="h-9 flex-col gap-0.5 px-1 text-[11.5px]"
            >
              <RotateCw className="size-3.5" />
              右转 90°
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canRotate}
              onClick={() => rotateBy(180)}
              data-testid="rotate-batch-180"
              className="h-9 flex-col gap-0.5 px-1 text-[11.5px]"
            >
              <RotateCw className="size-3.5" />
              180°
            </Button>
          </div>

          <Button
            type="button"
            variant="ghost"
            disabled={busy || rotatedCount === 0}
            onClick={resetAll}
            data-testid="rotate-reset-all"
            className="h-7 w-full text-[11.5px]"
          >
            恢复全部页面到导入时的方向
          </Button>

          {resolution.error && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-destructive">
              <AlertCircle className="mt-px size-3 shrink-0" />
              {resolution.error}
            </p>
          )}

          <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground/85">
            <Info className="mt-px size-3 shrink-0" />
            角度在原始 /Rotate 上累加，原始页面自带的旋转不会被覆盖；所有状态都归一化为 0°/90°/180°/270°。
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/80">
        <CardHeader className="pb-2.5">
          <CardTitle>导出</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border/70 bg-muted/25 p-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">输出文件</span>
              <span
                data-testid="rotate-output-name"
                className="min-w-0 truncate font-mono text-[11px] text-foreground"
                title={outputNameOf(doc.name)}
              >
                {outputNameOf(doc.name)}
              </span>
            </div>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground/80">
              共 {formatPages(doc.pageCount)}，其中 {rotatedCount} 页调整过方向；原始文件不会被修改。
            </p>
          </div>

          {busy ? (
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={cancelExport}
              data-testid="rotate-cancel"
            >
              <X className="size-4" />
              取消导出
            </Button>
          ) : (
            <Button
              type="button"
              className="w-full gap-2"
              disabled={!ready}
              onClick={() => void startExport()}
              data-testid="rotate-button"
            >
              <Download className="size-4" />
              导出旋转后的 PDF
            </Button>
          )}

          <p className="text-center text-[10.5px] leading-relaxed text-muted-foreground/80">
            使用页面 /Rotate 属性，不栅格化、不重新编码页面内容；
            <span className="text-warning">含数字签名的 PDF 重新保存后签名会失效</span>。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
