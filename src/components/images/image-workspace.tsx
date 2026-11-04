import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ImageGrid } from '@/components/images/image-grid';
import { ImageHero } from '@/components/images/image-hero';
import { ImageResultCard } from '@/components/images/image-result-card';
import { PageLayoutPreview } from '@/components/images/page-layout-preview';
import { ImageSettingsPanel } from '@/components/images/settings-panel';
import { useFileDrop } from '@/hooks/use-file-drop';
import { readyImages, useImageStore } from '@/store/use-image-store';

export function ImageWorkspace() {
  const images = useImageStore((state) => state.images);
  const settings = useImageStore((state) => state.settings);
  const build = useImageStore((state) => state.build);
  const addImages = useImageStore((state) => state.addImages);
  const startBuild = useImageStore((state) => state.startBuild);

  const [previewIndex, setPreviewIndex] = useState(0);

  const ready = readyImages(images);
  const busy = build.status === 'building';
  const previewEntry = images[Math.min(previewIndex, images.length - 1)] ?? null;

  const handleFiles = async (incoming: File[]) => {
    const summary = await addImages(incoming);

    if (summary.added > 0) {
      toast.success(`已添加 ${summary.added} 张图片`);
    }
    if (summary.duplicates.length > 0) {
      toast.warning(
        `${summary.duplicates.length} 张重复图片已跳过：${summary.duplicates
          .slice(0, 2)
          .join('、')}${summary.duplicates.length > 2 ? ' 等' : ''}`,
      );
    }
    for (const item of summary.rejected.slice(0, 3)) {
      toast.error(`${item.name}：${item.reason}`);
    }
  };

  const { isDragging, handlers } = useFileDrop(handleFiles);

  // Keep the preview pointing at a real card after deletions.
  useEffect(() => {
    if (previewIndex > images.length - 1) setPreviewIndex(Math.max(0, images.length - 1));
  }, [images.length, previewIndex]);

  useEffect(() => {
    if (build.status !== 'success') return;
    if (window.matchMedia('(min-width: 1024px)').matches) return;
    document.getElementById('image-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [build.status]);

  if (images.length === 0) {
    return <ImageHero onFiles={handleFiles} />;
  }

  const step = (delta: number) => {
    if (images.length === 0) return;
    const next = (previewIndex + delta + images.length) % images.length;
    setPreviewIndex(next);
  };

  return (
    <>
      <div className="grid gap-4 pb-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        {isDragging && (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-30 border-4 border-primary/25 bg-primary/[0.04]"
          />
        )}

        <div className="order-1 min-w-0 space-y-3.5" {...handlers}>
          <ImageResultCard />

          <PageLayoutPreview
            entry={previewEntry}
            settings={settings}
            index={Math.min(previewIndex, images.length - 1)}
            total={images.length}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
          />

          <ImageGrid onAddFiles={handleFiles} />
        </div>

        <div className="order-2 min-w-0">
          <ImageSettingsPanel />
        </div>
      </div>

      {build.status !== 'success' && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 pt-2.5 backdrop-blur-xl lg:hidden"
          style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 text-[11.5px] text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">{ready.length}</span> 页 ·{' '}
              {images.length} 张图片
            </div>
            <button
              type="button"
              onClick={() => void startBuild()}
              disabled={busy || ready.length === 0}
              className="ml-auto inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground shadow-sm transition hover:bg-primary/92 disabled:pointer-events-none disabled:opacity-45"
            >
              生成 PDF
            </button>
          </div>
        </div>
      )}
    </>
  );
}
