import { ChevronLeft, ChevronRight, Frame } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RotatedImage } from '@/components/images/rotated-image';
import { computePageLayout, describePage } from '@/features/image-pdf/page-layout';
import {
  MARGIN_PRESETS_MM,
  type FitMode,
  type ImagePdfSettings,
  type MarginMode,
  type OrientationMode,
} from '@/features/image-pdf/types';
import { cn } from '@/lib/utils';
import type { ImageEntry } from '@/store/use-image-store';

const FIT_LABELS: Record<FitMode, string> = {
  contain: '完整显示',
  cover: '填满页面',
  stretch: '拉伸铺满',
};

const MARGIN_LABELS: Record<MarginMode, string> = {
  none: '无边距',
  normal: '普通',
  wide: '宽',
  custom: '自定义',
};

const ORIENTATION_LABELS: Record<OrientationMode, string> = {
  auto: '自动',
  portrait: '纵向',
  landscape: '横向',
};

function percent(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground/75">{label}</dt>
      <dd className="mt-0.5 truncate text-[11.5px] font-medium tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  );
}

export interface PageLayoutPreviewProps {
  entry: ImageEntry | null;
  settings: ImagePdfSettings;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * What the page will look like — computed with the same `computePageLayout` the
 * PDF engine calls, so margins, fitting and clipping cannot drift from the
 * output. Every number here is a percentage of the real page box.
 */
export function PageLayoutPreview({
  entry,
  settings,
  index,
  total,
  onPrev,
  onNext,
}: PageLayoutPreviewProps) {
  if (!entry) {
    return (
      <div className="grid h-[212px] place-items-center rounded-xl border border-border/70 bg-card/60 text-[12px] text-muted-foreground">
        还没有可预览的图片
      </div>
    );
  }

  const layout = computePageLayout({
    settings,
    imageWidth: entry.width,
    imageHeight: entry.height,
    rotation: entry.rotation,
  });

  const marginMm =
    settings.margin === 'custom' ? settings.customMarginMm : MARGIN_PRESETS_MM[settings.margin];

  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Frame className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12px] font-medium">版面预览</span>
          <Badge variant="muted" className="h-[18px] px-1.5 text-[10px]">
            {layout.orientation === 'landscape' ? '横向' : '纵向'}
          </Badge>
          <span className="hidden text-[10.5px] text-muted-foreground sm:inline">
            与输出使用同一套几何计算
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="上一张"
            disabled={total <= 1}
            onClick={onPrev}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-10 text-center text-[11px] tabular-nums text-muted-foreground">
            {index + 1}/{total}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="下一张"
            disabled={total <= 1}
            onClick={onNext}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="mt-2.5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex shrink-0 justify-center rounded-lg bg-muted/30 p-3 sm:justify-start">
          <div
            data-testid="page-preview"
            data-page-width={layout.pageWidthMm.toFixed(1)}
            data-page-height={layout.pageHeightMm.toFixed(1)}
            className="relative overflow-hidden rounded-[2px] shadow-raised ring-1 ring-black/10"
            style={{
              height: 172,
              aspectRatio: `${layout.pageWidth} / ${layout.pageHeight}`,
              background: settings.background,
            }}
          >
            <div
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute border border-dashed border-primary/35',
                marginMm === 0 && 'opacity-0',
              )}
              style={{
                left: percent(layout.contentBox.x, layout.pageWidth),
                top: percent(
                  layout.pageHeight - layout.contentBox.y - layout.contentBox.height,
                  layout.pageHeight,
                ),
                width: percent(layout.contentBox.width, layout.pageWidth),
                height: percent(layout.contentBox.height, layout.pageHeight),
              }}
            />

            {/* The engine clips "cover" overflow to the *content box*, not to the
                page edge, so the preview nests the image inside a clipping box
                of exactly that size. Anything else would show a different crop
                than the exported PDF. */}
            <div
              className="absolute overflow-hidden"
              style={{
                left: percent(layout.contentBox.x, layout.pageWidth),
                top: percent(
                  layout.pageHeight - layout.contentBox.y - layout.contentBox.height,
                  layout.pageHeight,
                ),
                width: percent(layout.contentBox.width, layout.pageWidth),
                height: percent(layout.contentBox.height, layout.pageHeight),
              }}
            >
              <div
                className="absolute"
                style={{
                  left: percent(
                    layout.imageBox.x - layout.contentBox.x,
                    layout.contentBox.width,
                  ),
                  top: percent(
                    layout.contentBox.y +
                      layout.contentBox.height -
                      layout.imageBox.y -
                      layout.imageBox.height,
                    layout.contentBox.height,
                  ),
                  width: percent(layout.imageBox.width, layout.contentBox.width),
                  height: percent(layout.imageBox.height, layout.contentBox.height),
                }}
              >
                <RotatedImage
                  src={entry.previewUrl}
                  alt={`${entry.name} 的版面预览`}
                  rotation={entry.rotation}
                  naturalWidth={entry.width}
                  naturalHeight={entry.height}
                  mode="fill"
                />
              </div>
            </div>
          </div>
        </div>

        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
          <Detail label="页面" value={describePage(settings, layout)} />
          <Detail
            label="方向"
            value={`${ORIENTATION_LABELS[settings.orientation]} · ${
              layout.orientation === 'landscape' ? '横向' : '纵向'
            }`}
          />
          <Detail label="适配" value={FIT_LABELS[settings.fit]} />
          <Detail
            label="页边距"
            value={`${MARGIN_LABELS[settings.margin]} · ${marginMm} mm`}
          />
          <Detail label="当前图片" value={`${entry.width} × ${entry.height} px`} />
          <Detail
            label="输出"
            value={`${total} 页${entry.rotation !== 0 ? ` · 已旋转 ${entry.rotation}°` : ''}`}
          />
        </dl>
      </div>

      {layout.clipped && (
        <p className="mt-2 text-[10.5px] text-warning">
          按「填满页面」适配，图片超出内容区的部分会在输出中被裁掉（预览中已按同样方式裁剪）。
        </p>
      )}
    </div>
  );
}
