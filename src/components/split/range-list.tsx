import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useSplitStore } from '@/store/use-split-store';
import type { RangeRow } from '@/features/pdf-split/types';

export interface RangeListProps {
  rows: RangeRow[];
  /** Message per row id, produced by the planner — never re-derived here. */
  rowErrors: Record<string, string>;
  disabled?: boolean;
  pageCount: number;
}

export function RangeList({ rows, rowErrors, disabled, pageCount }: RangeListProps) {
  const setRangeText = useSplitStore((state) => state.setRangeText);
  const addRange = useSplitStore((state) => state.addRange);
  const removeRange = useSplitStore((state) => state.removeRange);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          页码范围
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || rows.length >= 100}
          onClick={addRange}
          data-testid="split-add-range"
          className="h-6 gap-1 px-1.5 text-[11.5px]"
        >
          <Plus className="size-3" />
          添加范围
        </Button>
      </div>

      <ul className="space-y-1.5">
        {rows.map((row, index) => {
          const error = rowErrors[row.id];
          return (
            <li key={row.id}>
              <div className="flex items-center gap-1.5">
                <span className="grid size-5 shrink-0 place-items-center rounded bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <Input
                  value={row.text}
                  disabled={disabled}
                  inputMode="numeric"
                  placeholder={index === 0 ? `例如 1-${Math.min(5, pageCount)}` : '例如 6-10'}
                  aria-label={`第 ${index + 1} 个页码范围`}
                  aria-invalid={error ? true : undefined}
                  data-testid={`split-range-${index}`}
                  onChange={(event) => setRangeText(row.id, event.target.value)}
                  className={cn(
                    'h-8 text-[12.5px] tabular-nums',
                    error && 'border-destructive/60 focus-visible:ring-destructive/30',
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled || rows.length <= 1}
                  aria-label={`删除第 ${index + 1} 个范围`}
                  onClick={() => removeRange(row.id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
              {error && (
                <p className="mt-1 pl-6 text-[10.5px] leading-relaxed text-destructive">{error}</p>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-[10.5px] leading-relaxed text-muted-foreground/80">
        支持 <code className="font-mono">1-5</code>、<code className="font-mono">7</code>、
        <code className="font-mono">9-12</code>，任一段可用逗号连写。页码从 1 开始，不能重叠。
      </p>
    </div>
  );
}
