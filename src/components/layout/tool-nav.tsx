import { Images, Layers2, RotateCw, Scissors } from 'lucide-react';

import { cn } from '@/lib/utils';
import { routeHref, type ToolRoute } from '@/lib/use-route';

const TOOLS: Array<{ route: ToolRoute; label: string; short: string; icon: typeof Layers2 }> = [
  { route: 'merge', label: 'PDF 合并', short: '合并', icon: Layers2 },
  { route: 'images', label: '图片转 PDF', short: '图片', icon: Images },
  { route: 'split', label: 'PDF 拆分', short: '拆分', icon: Scissors },
  { route: 'rotate', label: 'PDF 旋转', short: '旋转', icon: RotateCw },
];

/**
 * Tool switch. Uses real anchors so the browser's back/forward buttons and
 * middle-click behave normally; the route is derived from `location.hash`.
 */
export function ToolNav({ route }: { route: ToolRoute }) {
  return (
    <nav
      aria-label="工具"
      className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-muted/50 p-0.5"
    >
      {TOOLS.map((tool) => {
        const active = tool.route === route;
        return (
          <a
            key={tool.route}
            href={routeHref(tool.route)}
            aria-current={active ? 'page' : undefined}
            data-testid={`tool-nav-${tool.route}`}
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-[7px] px-1.5 text-[12px] font-medium transition-all duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'sm:gap-1.5 sm:px-2.5 sm:text-[12.5px]',
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <tool.icon className="size-3.5" />
            <span className="hidden sm:inline">{tool.label}</span>
            <span className="sm:hidden">{tool.short}</span>
          </a>
        );
      })}
    </nav>
  );
}
