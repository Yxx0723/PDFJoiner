import { useEffect } from 'react';
import { Toaster } from 'sonner';

import { AppFooter } from '@/components/layout/app-footer';
import { AppHeader } from '@/components/layout/app-header';
import { ImageWorkspace } from '@/components/images/image-workspace';
import { RotateWorkspace } from '@/components/rotate/rotate-workspace';
import { SplitWorkspace } from '@/components/split/split-workspace';
import { Workspace } from '@/components/workspace';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useTheme } from '@/hooks/use-theme';
import { useToolRoute } from '@/lib/use-route';
import { useAppStore } from '@/store/use-app-store';
import { useImageStore } from '@/store/use-image-store';
import { useRotateStore } from '@/store/use-rotate-store';
import { useSplitStore } from '@/store/use-split-store';

export default function App() {
  const { theme, toggle } = useTheme();
  const route = useToolRoute();

  const files = useAppStore((state) => state.files);
  const disposeMerge = useAppStore((state) => state.disposeAll);
  const merging = useAppStore((state) => state.merge.status === 'merging');

  const images = useImageStore((state) => state.images);
  const disposeImages = useImageStore((state) => state.disposeAll);
  const building = useImageStore((state) => state.build.status === 'building');

  const splitDoc = useSplitStore((state) => state.doc);
  const disposeSplit = useSplitStore((state) => state.disposeAll);
  const splitting = useSplitStore((state) => state.build.status === 'splitting');

  const rotateDoc = useRotateStore((state) => state.document);
  const disposeRotate = useRotateStore((state) => state.disposeAll);
  const rotating = useRotateStore((state) => state.exportStatus === 'exporting');

  const hasWork =
    route === 'images'
      ? images.length > 0
      : route === 'split'
        ? splitDoc !== null
        : route === 'rotate'
          ? rotateDoc !== null
          : files.length > 0;
  const busy =
    route === 'images'
      ? building
      : route === 'split'
        ? splitting
        : route === 'rotate'
          ? rotating
          : merging;

  // Losing an unsaved task by an accidental reload is the most painful failure
  // mode of a purely in-memory tool, so ask before leaving.
  useEffect(() => {
    if (files.length === 0 && images.length === 0 && !splitDoc && !rotateDoc) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [files.length, images.length, splitDoc, rotateDoc]);

  // Revoke blob URLs and close pdf.js documents when the app unmounts.
  useEffect(
    () => () => {
      disposeMerge();
      disposeImages();
      disposeSplit();
      disposeRotate();
    },
    [disposeMerge, disposeImages, disposeSplit, disposeRotate],
  );

  return (
    <TooltipProvider delayDuration={250}>
      <div className="app-canvas flex min-h-dvh flex-col">
        <AppHeader theme={theme} onToggleTheme={toggle} route={route} />

        <main
          className={`container flex-1 pt-3 sm:pt-4 ${
            hasWork && !busy ? 'pb-20 lg:pb-10' : 'pb-10'
          }`}
        >
          {route === 'images' ? (
            <ImageWorkspace />
          ) : route === 'split' ? (
            <SplitWorkspace />
          ) : route === 'rotate' ? (
            <RotateWorkspace />
          ) : (
            <Workspace />
          )}
        </main>

        <AppFooter />

        <Toaster
          theme={theme}
          position="top-center"
          closeButton
          richColors
          duration={3200}
          toastOptions={{
            className: 'text-[13px]',
          }}
        />
      </div>
    </TooltipProvider>
  );
}
