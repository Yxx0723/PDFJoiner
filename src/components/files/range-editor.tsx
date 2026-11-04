import { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStore, type PdfFileEntry } from '@/store/use-app-store';
import { selectionInputValue } from '@/store/selectors';

const COMMIT_DELAY = 320;

/**
 * Page range input. Typing is committed to the store after a short delay so
 * half-typed expressions ("1-") do not flash validation errors.
 */
export function RangeEditor({ entry }: { entry: PdfFileEntry }) {
  const setRangeDraft = useAppStore((state) => state.setRangeDraft);
  const resetSelection = useAppStore((state) => state.resetSelection);
  const busy = useAppStore((state) => state.merge.status === 'merging');

  const external = selectionInputValue(entry);
  const [text, setText] = useState(external);
  const timer = useRef<number | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(external);
  }, [external]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const schedule = (value: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setRangeDraft(entry.id, value);
    }, COMMIT_DELAY);
  };

  const flush = () => {
    if (!timer.current) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    setRangeDraft(entry.id, text);
  };

  const error = entry.selection.error;

  return (
    <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label
          htmlFor={`range-${entry.id}`}
          className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          页码范围
        </label>
        <Input
          id={`range-${entry.id}`}
          data-testid="range-input"
          value={text}
          invalid={Boolean(error)}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          placeholder="全部页面，或输入 1-3,6,9-12"
          className="h-9 flex-1 bg-card font-mono text-[13px]"
          aria-describedby={`range-hint-${entry.id}`}
          onChange={(event) => {
            setText(event.target.value);
            schedule(event.target.value);
          }}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            flush();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              flush();
              event.currentTarget.blur();
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || entry.selection.pages === null}
          onClick={() => resetSelection(entry.id)}
          className="shrink-0"
        >
          全部页面
        </Button>
      </div>

      {error ? (
        <p
          id={`range-hint-${entry.id}`}
          role="alert"
          className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-destructive"
        >
          <AlertCircle className="mt-px size-3 shrink-0" />
          {error}
        </p>
      ) : (
        <p id={`range-hint-${entry.id}`} className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          支持 <span className="font-mono">1-5</span> 连续范围、<span className="font-mono">1-3,6,9-12</span> 多段；
          <span className="font-mono">1,1,3</span> 可重复插入同一页。
        </p>
      )}
    </div>
  );
}
