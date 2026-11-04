import { Layers2, Moon, ShieldCheck, Sun } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { ToolNav } from '@/components/layout/tool-nav';
import type { Theme } from '@/hooks/use-theme';
import type { ToolRoute } from '@/lib/use-route';

export interface AppHeaderProps {
  theme: Theme;
  onToggleTheme: () => void;
  route: ToolRoute;
}

export function AppHeader({ theme, onToggleTheme, route }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="container flex h-14 items-center gap-2 sm:h-16 sm:gap-3">
        <div className="flex select-none items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm">
            <Layers2 className="size-[18px]" />
          </span>
          <div className="leading-tight">
            <div className="flex items-center gap-1.5">
              <span className="text-[15px] font-semibold tracking-tight">PDFJoiner</span>
              <Badge variant="outline" className="hidden h-[18px] px-1.5 text-[10px] sm:inline-flex">
                Web
              </Badge>
            </div>
            <p className="hidden text-[10.5px] text-muted-foreground sm:block">
              浏览器内 PDF 工具
            </p>
          </div>
        </div>

        <div className="ml-0.5 shrink-0 sm:ml-2">
          <ToolNav route={route} />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="hidden items-center gap-1.5 rounded-full border border-border/70 bg-card/60 px-2.5 py-1 text-[11px] text-muted-foreground sm:flex">
            <ShieldCheck className="size-3.5 text-success" />
            不上传服务器
          </span>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
