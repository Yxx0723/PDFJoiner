import { cn } from '@/lib/utils';
import { ratio } from '@/lib/utils';

export interface ProgressProps {
  /** Completed units, e.g. pages already written into the output. */
  value: number;
  total: number;
  className?: string;
  /** Adds a moving stripe to signal work in progress. */
  animated?: boolean;
  label?: string;
}

/**
 * Determinate progress for work we can actually count (pages, files).
 * The UI never shows a fabricated byte percentage.
 */
export function Progress({ value, total, className, animated = true, label }: ProgressProps) {
  const percent = Math.round(ratio(value, total) * 100);
  return (
    <div
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
      aria-label={label}
    >
      <div
        className={cn(
          'h-full rounded-full bg-primary transition-[width] duration-300 ease-out',
          animated && percent < 100 && 'animate-pulse-soft',
        )}
        style={{ width: `${Math.max(percent, 2)}%` }}
      />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}
