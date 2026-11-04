import { useEffect, useState } from 'react';
import { FilePlus2, Loader2, ShieldCheck, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { OptionGroup } from '@/components/images/option-group';
import { canEncodeOffscreen } from '@/features/image-pdf/encode';
import {
  BACKGROUND_SWATCHES,
  QUALITY_PRESETS,
  type ImagePdfProgress,
  type MarginMode,
  type OrientationMode,
  type PageSizeMode,
  type QualityMode,
  type FitMode,
} from '@/features/image-pdf/types';
import { cn } from '@/lib/utils';
import { readyImages, useImageStore } from '@/store/use-image-store';

const PHASE_LABELS: Record<ImagePdfProgress['phase'], string> = {
  encoding: '正在处理图片',
  saving: '正在写入 PDF',
  verifying: '正在校验输出',
};

interface NumberFieldProps {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min: number;
  max: number;
  suffix: string;
  disabled?: boolean;
  testId?: string;
}

/**
 * Number input that only pushes valid values into the store: typing `1` on the
 * way to `150` must not clamp the page to 20 mm. Out-of-range input is clamped
 * on blur instead.
 */
function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  suffix,
  disabled,
  testId,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const parsed = Number(raw);
    const clamped = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <label className="block">
      <span className="text-[10.5px] text-muted-foreground">{label}</span>
      <div className="relative mt-1">
        <Input
          type="number"
          inputMode="decimal"
          value={draft}
          min={min}
          max={max}
          disabled={disabled}
          data-testid={testId}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            const parsed = Number(raw);
            if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onCommit(parsed);
          }}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          className="h-9 pr-9 text-[12px] tabular-nums"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10.5px] text-muted-foreground">
          {suffix}
        </span>
      </div>
    </label>
  );
}

function Segmented({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {hint && <span className="text-[10.5px] text-muted-foreground/80">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function BackgroundPicker() {
  const settings = useImageStore((state) => state.settings);
  const setSettings = useImageStore((state) => state.setSettings);

  return (
    <Segmented label="页面背景" hint={settings.background.toUpperCase()}>
      <div className="flex items-center gap-1.5">
        {BACKGROUND_SWATCHES.map((swatch) => {
          const active = settings.background.toLowerCase() === swatch.value;
          return (
            <button
              key={swatch.value}
              type="button"
              aria-label={`背景 ${swatch.label}`}
              aria-pressed={active}
              title={swatch.label}
              onClick={() => setSettings({ background: swatch.value })}
              className={cn(
                'size-7 rounded-md border border-black/10 shadow-sm transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active && 'ring-2 ring-primary ring-offset-2 ring-offset-card',
              )}
              style={{ background: swatch.value }}
            />
          );
        })}

        <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          自定义
          <input
            type="color"
            value={settings.background}
            aria-label="自定义背景颜色"
            onChange={(event) => setSettings({ background: event.target.value })}
            className="size-7 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
          />
        </label>
      </div>
    </Segmented>
  );
}

function BuildProgress({
  progress,
  onCancel,
}: {
  progress: ImagePdfProgress;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2.5" data-testid="build-progress">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium" aria-live="polite">
          <Loader2 className="size-4 animate-spin text-primary" />
          {PHASE_LABELS[progress.phase]}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {progress.done} / {progress.total} 张
        </span>
      </div>

      <Progress
        value={progress.done}
        total={progress.total}
        label={`已处理 ${progress.done} / ${progress.total} 张图片`}
      />

      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] text-muted-foreground" title={progress.fileName}>
          {progress.fileName || '整理页面…'}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} className="shrink-0">
          <X className="size-3.5" />
          取消
        </Button>
      </div>
    </div>
  );
}

export function ImageSettingsPanel() {
  const settings = useImageStore((state) => state.settings);
  const setSettings = useImageStore((state) => state.setSettings);
  const images = useImageStore((state) => state.images);
  const build = useImageStore((state) => state.build);
  const startBuild = useImageStore((state) => state.startBuild);
  const cancelBuild = useImageStore((state) => state.cancelBuild);

  const ready = readyImages(images);
  const busy = build.status === 'building';
  const quality = QUALITY_PRESETS[settings.quality];

  return (
    <Card className="border-border/80">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>页面设置</CardTitle>
          <Badge variant="success" className="gap-1">
            <ShieldCheck className="size-3" />
            本地处理
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3.5">
        <OptionGroup<PageSizeMode>
          label="页面尺寸"
          testId="settings-page-size"
          value={settings.pageSize}
          disabled={busy}
          columns={3}
          options={[
            { value: 'a4', label: 'A4', hint: '210 × 297 mm' },
            { value: 'a5', label: 'A5', hint: '148 × 210 mm' },
            { value: 'letter', label: 'Letter', hint: '215.9 × 279.4 mm' },
            { value: 'legal', label: 'Legal', hint: '215.9 × 355.6 mm' },
            { value: 'image', label: '原图尺寸', hint: '按 DPI 把图片像素换算成页面尺寸' },
            { value: 'custom', label: '自定义', hint: '手动输入毫米尺寸' },
          ]}
          onChange={(pageSize) => setSettings({ pageSize })}
        />

        {settings.pageSize === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="宽度"
              value={settings.customWidthMm}
              min={20}
              max={2000}
              suffix="mm"
              disabled={busy}
              testId="custom-width"
              onCommit={(customWidthMm) => setSettings({ customWidthMm })}
            />
            <NumberField
              label="高度"
              value={settings.customHeightMm}
              min={20}
              max={2000}
              suffix="mm"
              disabled={busy}
              testId="custom-height"
              onCommit={(customHeightMm) => setSettings({ customHeightMm })}
            />
          </div>
        )}

        {settings.pageSize === 'image' && (
          <div className="space-y-1">
            <NumberField
              label="分辨率（图片像素 → 页面毫米的换算依据）"
              value={settings.imageDpi}
              min={36}
              max={1200}
              suffix="DPI"
              disabled={busy}
              testId="image-dpi"
              onCommit={(imageDpi) => setSettings({ imageDpi })}
            />
            <p className="text-[10.5px] leading-relaxed text-muted-foreground">
              例如 3000 × 2000 px 的图片，按 300 DPI 输出为 254 × 169 mm。
            </p>
          </div>
        )}

        <OptionGroup<OrientationMode>
          label="页面方向"
          testId="settings-orientation"
          value={settings.orientation}
          disabled={busy}
          columns={3}
          options={[
            { value: 'auto', label: '自动', hint: '按每张图片的宽高比决定' },
            { value: 'portrait', label: '纵向', hint: '页面始终高大于宽' },
            { value: 'landscape', label: '横向', hint: '页面始终宽大于高' },
          ]}
          onChange={(orientation) => setSettings({ orientation })}
        />

        <OptionGroup<FitMode>
          label="图片适配"
          testId="settings-fit"
          value={settings.fit}
          disabled={busy}
          columns={3}
          options={[
            { value: 'contain', label: '完整显示', hint: '保持比例，整张图片可见，不裁剪' },
            { value: 'cover', label: '填满页面', hint: '保持比例，超出页面的部分被裁剪' },
            { value: 'stretch', label: '拉伸铺满', hint: '铺满内容区，可能改变比例' },
          ]}
          onChange={(fit) => setSettings({ fit })}
        />

        <OptionGroup<MarginMode>
          label="页边距"
          testId="settings-margin"
          value={settings.margin}
          disabled={busy}
          columns={4}
          options={[
            { value: 'none', label: '无边距', hint: '0 mm' },
            { value: 'normal', label: '普通', hint: '8 mm' },
            { value: 'wide', label: '宽', hint: '18 mm' },
            { value: 'custom', label: '自定义边距', hint: '手动输入毫米' },
          ]}
          onChange={(margin) => setSettings({ margin })}
        />

        {settings.margin === 'custom' && (
          <NumberField
            label="边距"
            value={settings.customMarginMm}
            min={0}
            max={100}
            suffix="mm"
            disabled={busy}
            testId="custom-margin"
            onCommit={(customMarginMm) => setSettings({ customMarginMm })}
          />
        )}

        <BackgroundPicker />

        <OptionGroup<QualityMode>
          label="输出质量"
          testId="settings-quality"
          value={settings.quality}
          disabled={busy}
          columns={3}
          note={`${quality.dpi} DPI`}
          options={[
            { value: 'high', label: '高质量', hint: QUALITY_PRESETS.high.hint },
            { value: 'standard', label: '标准', hint: QUALITY_PRESETS.standard.hint },
            { value: 'compressed', label: '压缩', hint: QUALITY_PRESETS.compressed.hint },
          ]}
          onChange={(next) => setSettings({ quality: next })}
        />
        <p className="-mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
          {quality.hint}
        </p>

        <div className="h-px bg-border" />

        {busy && build.progress ? (
          <BuildProgress progress={build.progress} onCancel={cancelBuild} />
        ) : (
          <>
            {build.status === 'error' && build.error && (
              <div className="rounded-lg border border-destructive/25 bg-destructive-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-destructive">
                {build.error}
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="image-output-name"
                className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                输出文件名
              </label>
              <div className="relative">
                <Input
                  id="image-output-name"
                  value={settings.outputName}
                  disabled={busy}
                  placeholder="图片合集"
                  maxLength={120}
                  data-testid="image-output-name"
                  className="pr-12"
                  onChange={(event) => setSettings({ outputName: event.target.value })}
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
                disabled={ready.length === 0}
                data-testid="generate-button"
                onClick={() => void startBuild()}
              >
                <FilePlus2 className="size-4" />
                生成 {ready.length} 页 PDF
              </Button>
              {ready.length === 0 && (
                <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                  先导入至少一张可解码的图片。
                </p>
              )}
            </div>

            {!canEncodeOffscreen() && (
              <p
                data-testid="fallback-hint"
                className="rounded-lg border border-warning/25 bg-warning-soft px-2.5 py-2 text-[10.5px] leading-relaxed text-warning"
              >
                当前浏览器缺少 OffscreenCanvas，图片会在主线程处理（处理期间页面可能短暂变慢，文件仍不会离开本机）。
              </p>
            )}

            <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
              <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-px size-3.5 shrink-0 text-success" />
                图片只在当前浏览器内存中解码与排版，不会上传服务器，也没有任何第三方请求。生成的 PDF
                在关闭页面后会一并消失。
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
