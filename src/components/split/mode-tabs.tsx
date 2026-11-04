import { cn } from '@/lib/utils';
import { SPLIT_MODE_META, type SplitMode } from '@/features/pdf-split/types';

const MODES: SplitMode[] = ['ranges', 'extract', 'each', 'chunks'];

export function ModeTabs({
  mode,
  onChange,
  disabled,
}: {
  mode: SplitMode;
  onChange: (mode: SplitMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div role="group" aria-label="拆分模式" className="grid grid-cols-2 gap-1.5">
        {MODES.map((item) => {
          const active = item === mode;
          return (
            <button
              key={item}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              data-testid={`split-mode-${item}`}
              onClick={() => onChange(item)}
              className={cn(
                'rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-primary/40 bg-primary-soft text-accent-foreground shadow-sm'
                  : 'border-border/70 bg-card text-muted-foreground hover:border-primary/25 hover:text-foreground',
                disabled && 'pointer-events-none opacity-60',
              )}
            >
              {SPLIT_MODE_META[item].title}
            </button>
          );
        })}
      </div>
      <p className="min-h-[30px] text-[10.5px] leading-relaxed text-muted-foreground">
        {SPLIT_MODE_META[mode].description}
      </p>
    </div>
  );
}
