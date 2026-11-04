import { cn } from '@/lib/utils';

export interface Option<T extends string> {
  value: T;
  label: string;
  /** Shown as a native tooltip; keeps the chip itself compact. */
  hint?: string;
}

export interface OptionGroupProps<T extends string> {
  label: string;
  /** Small right-aligned note next to the label, e.g. the current value. */
  note?: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  columns?: number;
  disabled?: boolean;
  testId?: string;
}

/**
 * Segmented chip group used by every setting.
 *
 * `aria-pressed` (not a radio group) is deliberate: these are independent toggle
 * buttons, and screen readers announce the pressed state without implying a
 * form submission.
 */
export function OptionGroup<T extends string>({
  label,
  note,
  value,
  options,
  onChange,
  columns = 3,
  disabled = false,
  testId,
}: OptionGroupProps<T>) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {note && <span className="truncate text-[10.5px] text-muted-foreground/80">{note}</span>}
      </div>

      <div
        role="group"
        aria-label={label}
        data-testid={testId}
        className="grid gap-1 rounded-lg bg-muted/60 p-1"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              title={option.hint}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                'h-8 truncate rounded-[7px] px-1 text-[12px] font-medium transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:pointer-events-none disabled:opacity-45',
                active
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
