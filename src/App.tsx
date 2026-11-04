import { useEffect } from 'react';
import { Toaster } from 'sonner';

import { AppFooter } from '@/components/layout/app-footer';
import { AppHeader } from '@/components/layout/app-header';
import { ImageWorkspace } from '@/components/images/image-workspace';
import { Workspace } from '@/components/workspace';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useTheme } from '@/hooks/use-theme';
import { useToolRoute } from '@/lib/use-route';
import { useAppStore } from '@/store/use-app-store';
import { useImageStore } from '@/store/use-image-store';

export default function App() {
  const { theme, toggle } = useTheme();
  const route = useToolRoute();

  const files = useAppStore((state) => state.files);
  const disposeMerge = useAppStore((state) => state.disposeAll);
  const merging = useAppStore((state) => state.merge.status === 'merging');

  const images = useImageStore((state) => state.images);
  const disposeImages = useImageStore((state) => state.disposeAll);
  const building = useImageStore((state) => state.build.status === 'building');

  const isImages = route === 'images';
  const hasWork = isImages ? images.length > 0 : files.length > 0;
  const busy = isImages ? building : merging;

  // Losing an unsaved task by an accidental reload is the most painful failure
  // mode of a purely in-memory tool, so ask before leaving.
  useEffect(() => {
    if (files.length === 0 && images.length === 0) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [files.length, images.length]);

  // Revoke blob URLs and close pdf.js documents when the app unmounts.
  useEffect(
    () => () => {
      disposeMerge();
      disposeImages();
    },
    [disposeMerge, disposeImages],
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
          {isImages ? <ImageWorkspace /> : <Workspace />}
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
