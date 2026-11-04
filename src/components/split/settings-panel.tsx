import { useMemo } from 'react';
import { AlertCircle, Info, Loader2, RotateCcw, Scissors, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn, formatPages } from '@/lib/utils';
import { ModeTabs } from '@/components/split/mode-tabs';
import { RangeList } from '@/components/split/range-list';
import { autoPrefix, planSummary, resolvePrefix } from '@/features/pdf-split/plan';
import type { SplitPlan } from '@/features/pdf-split/types';
import { useSplitStore, type SplitDocument } from '@/store/use-split-store';

function ExtractEditor({ doc, disabled }: { doc: SplitDocument; disabled: boolean }) {
  const setExtractDraft = useSplitStore((state) => state.setExtractDraft);
  const selectAllPages = useSplitStore((state) => state.selectAllPages);
  const invertSelection = useSplitStore((state) => state.invertSelection);
  const clearSelection = useSplitStore((state) => state.clearSelection);

  const value = doc.extractDraft ?? doc.extractPages.map((page) => page + 1).join(',');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          提取页码
        </span>
        <span className="text-[10.5px] tabular-nums text-muted-foreground/80">
          已选 {doc.extractPages.length} 页
        </span>
      </div>

      <Input
        value={value}
        disabled={disabled}
        inputMode="numeric"
        placeholder="例如 1,3,5,8-12"
        aria-label="要提取的页码"
        aria-invalid={doc.extractError ? true : undefined}
        data-testid="split-extract-input"
        onChange={(event) => setExtractDraft(event.target.value)}
        className={cn(
          'h-8 text-[12.5px] tabular-nums',
          doc.extractError && 'border-destructive/60 focus-visible:ring-destructive/30',
        )}
      />

      {doc.extractError && (
        <p className="text-[10.5px] leading-relaxed text-destructive">
          {doc.extractError} 当前仍按上一次有效的选择计算。
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={selectAllPages}
          className="h-6 px-1.5 text-[11.5px]"
        >
          全选
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={invertSelection}
          className="h-6 px-1.5 text-[11.5px]"
        >
          反选
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={clearSelection}
          className="h-6 px-1.5 text-[11.5px] text-muted-foreground hover:text-destructive"
        >
          清空
        </Button>
      </div>

      <p className="text-[10.5px] leading-relaxed text-muted-foreground/80">
        也可以在下方页面网格里点选；点选的先后顺序就是输出顺序。
      </p>
    </div>
  );
}

function ChunkEditor({ pageCount, disabled }: { pageCount: number; disabled: boolean }) {
  const chunkSize = useSplitStore((state) => state.settings.chunkSize);
  const setChunkSize = useSplitStore((state) => state.setChunkSize);
  const count = Math.max(1, Math.ceil(pageCount / Math.max(1, chunkSize)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          每份页数
        </span>
        <span className="text-[10.5px] text-muted-foreground/80">将生成 {count} 个文件</span>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={200}
          value={chunkSize}
          disabled={disabled}
          aria-label="每份包含的页数"
          data-testid="split-chunk-size"
          onChange={(event) => setChunkSize(Number(event.target.value))}
          className="h-8 w-20 text-[12.5px] tabular-nums"
        />
        <span className="text-[11.5px] text-muted-foreground">页 / 份</span>
      </div>
      <p className="text-[10.5px] leading-relaxed text-muted-foreground/80">
        最后一份不足 {chunkSize} 页也照常生成，不会被丢弃。
      </p>
    </div>
  );
}

export interface SplitSettingsPanelProps {
  doc: SplitDocument | null;
  plan: SplitPlan;
}

export function SplitSettingsPanel({ doc, plan }: SplitSettingsPanelProps) {
  const settings = useSplitStore((state) => state.settings);
  const build = useSplitStore((state) => state.build);
  const setMode = useSplitStore((state) => state.setMode);
  const setNaming = useSplitStore((state) => state.setNaming);
  const setPrefix = useSplitStore((state) => state.setPrefix);
  const resetPrefix = useSplitStore((state) => state.resetPrefix);
  const startSplit = useSplitStore((state) => state.startSplit);
  const cancelSplit = useSplitStore((state) => state.cancelSplit);

  const busy = build.status === 'splitting';
  const ready = doc?.status === 'ready';
  const prefix = settings.prefixTouched
    ? settings.prefix
    : autoPrefix(settings.mode, doc?.name ?? 'document');
  const canBuild = !!ready && plan.errors.length === 0 && plan.outputs.length > 0 && !busy;

  const shownOutputs = useMemo(() => plan.outputs.slice(0, 12), [plan.outputs]);
  const hiddenCount = plan.outputs.length - shownOutputs.length;

  return (
    <div className="space-y-3.5">
      <Card className="border-border/80">
        <CardHeader className="pb-2.5">
          <div className="flex items-center justify-between gap-2">
            <CardTitle>拆分方式</CardTitle>
            {busy && (
              <Badge variant="soft" className="gap-1">
                <Loader2 className="size-3 animate-spin" />
                处理中
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3.5">
          <ModeTabs mode={settings.mode} onChange={setMode} disabled={busy} />

          <div className="border-t border-border/60 pt-3">
            {settings.mode === 'ranges' && doc && (
              <RangeList
                rows={doc.rows}
                rowErrors={plan.rowErrors}
                disabled={busy}
                pageCount={doc.pageCount}
              />
            )}

            {settings.mode === 'extract' && doc && <ExtractEditor doc={doc} disabled={busy} />}

            {settings.mode === 'chunks' && doc && (
              <ChunkEditor pageCount={doc.pageCount} disabled={busy} />
            )}

            {settings.mode === 'each' && doc && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  逐页拆分
                </p>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  {formatPages(doc.pageCount)}各自存成一个 PDF，编号从 1 连续排到{' '}
                  <span className="tabular-nums text-foreground">{doc.pageCount}</span>。
                </p>
              </div>
            )}

            {!doc && (
              <p className="text-[11.5px] text-muted-foreground">先载入一份 PDF 再设置。</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80">
        <CardHeader className="pb-2.5">
          <CardTitle>输出</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="split-prefix"
                className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                文件名前缀
              </label>
              {settings.prefixTouched && (
                <button
                  type="button"
                  onClick={resetPrefix}
                  className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground transition hover:text-foreground"
                >
                  <RotateCcw className="size-3" />
                  恢复默认
                </button>
              )}
            </div>
            <Input
              id="split-prefix"
              value={prefix}
              disabled={busy}
              maxLength={80}
              data-testid="split-prefix"
              onChange={(event) => setPrefix(event.target.value)}
              className="h-8 text-[12.5px]"
            />
            <p className="truncate text-[10.5px] text-muted-foreground/80">
              示例：<span className="font-mono">{plan.outputs[0]?.name ?? `${resolvePrefix(prefix)}.pdf`}</span>
            </p>
          </div>

          {settings.mode !== 'extract' && settings.mode !== 'each' && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                命名规则
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { value: 'index', title: '序号', hint: `${resolvePrefix(prefix)}_001.pdf` },
                    { value: 'pages', title: '页码', hint: `${resolvePrefix(prefix)}_p1-5.pdf` },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={settings.naming === option.value}
                    disabled={busy}
                    data-testid={`split-naming-${option.value}`}
                    onClick={() => setNaming(option.value)}
                    className={cn(
                      'rounded-lg border px-2 py-1.5 text-left transition-all duration-200',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      settings.naming === option.value
                        ? 'border-primary/40 bg-primary-soft shadow-sm'
                        : 'border-border/70 bg-card hover:border-primary/25',
                      busy && 'pointer-events-none opacity-60',
                    )}
                  >
                    <span className="block text-[12px] font-medium">{option.title}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                      {option.hint}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border/70 bg-muted/25 p-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] text-muted-foreground">预计输出</span>
              <span
                className="text-[12.5px] font-semibold tabular-nums"
                data-testid="split-plan-summary"
              >
                {planSummary(plan)}
              </span>
            </div>

            {plan.outputs.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
                {shownOutputs.map((output) => (
                  <li
                    key={output.id}
                    className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono" title={output.name}>
                      {output.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground/80">
                      {output.label}
                    </span>
                  </li>
                ))}
                {hiddenCount > 0 && (
                  <li className="text-[10.5px] text-muted-foreground/70">
                    还有 {hiddenCount} 个文件…
                  </li>
                )}
              </ul>
            )}
          </div>

          {plan.errors.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-destructive/20 bg-destructive-soft px-2.5 py-2">
              {plan.errors.map((error) => (
                <li
                  key={error}
                  data-testid="split-plan-error"
                  className="flex items-start gap-1.5 text-[11px] leading-relaxed text-destructive"
                >
                  <AlertCircle className="mt-px size-3 shrink-0" />
                  {error}
                </li>
              ))}
            </ul>
          )}

          {plan.notes.length > 0 && plan.errors.length === 0 && (
            <ul className="space-y-1 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-2">
              {plan.notes.map((note) => (
                <li
                  key={note}
                  className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground"
                >
                  <Info className="mt-px size-3 shrink-0" />
                  {note}
                </li>
              ))}
            </ul>
          )}

          {busy ? (
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={cancelSplit}
              data-testid="split-cancel"
            >
              <X className="size-4" />
              取消拆分
            </Button>
          ) : (
            <Button
              type="button"
              className="w-full gap-2"
              disabled={!canBuild}
              data-testid="split-button"
              onClick={() => void startSplit()}
            >
              <Scissors className="size-4" />
              {plan.outputs.length > 1
                ? `拆分为 ${plan.outputs.length} 个文件`
                : '开始拆分'}
            </Button>
          )}

          {!canBuild && !busy && plan.errors.length === 0 && (
            <p className="text-center text-[10.5px] text-muted-foreground/80">
              {ready ? '先设置可输出的页面' : '载入 PDF 后即可拆分'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
