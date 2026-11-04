import { Redo2, Undo2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRotateStore, type RotateDocument } from '@/store/use-rotate-store';

export interface RotateToolbarProps {
  doc: RotateDocument;
  rotatedCount: number;
}

/** Selection + history controls above the thumbnail grid. */
export function RotateToolbar({ doc, rotatedCount }: RotateToolbarProps) {
  const selectAllPages = useRotateStore((state) => state.selectAllPages);
  const invertSelection = useRotateStore((state) => state.invertSelection);
  const clearSelection = useRotateStore((state) => state.clearSelection);
  const undo = useRotateStore((state) => state.undo);
  const redo = useRotateStore((state) => state.redo);
  const history = useRotateStore((state) => state.history);
  const busy = useRotateStore((state) => state.exportStatus === 'exporting');

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/80 bg-card px-3 py-2.5 shadow-soft">
      <div className="flex items-center gap-1.5 text-[12.5px]">
        <span className="font-medium">页面</span>
        <Badge variant="secondary" data-testid="rotate-summary" className="tabular-nums">
          {doc.pageCount} 页 · 已旋转 {rotatedCount} 页 · 已选 {doc.selectedPages.length} 页
        </Badge>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={selectAllPages}
          data-testid="rotate-select-all"
          className="h-7 px-2 text-[11.5px]"
        >
          全选
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={invertSelection}
          data-testid="rotate-invert-selection"
          className="h-7 px-2 text-[11.5px]"
        >
          反选
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={clearSelection}
          data-testid="rotate-clear-selection"
          className="h-7 px-2 text-[11.5px]"
        >
          清空
        </Button>
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || history.index === 0}
          onClick={undo}
          data-testid="rotate-undo"
          aria-label="撤销上一次旋转"
          title="撤销（Ctrl/⌘ + Z）"
          className="h-7 gap-1 px-2 text-[11.5px]"
        >
          <Undo2 className="size-3.5" />
          撤销
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || history.index >= history.entries.length - 1}
          onClick={redo}
          data-testid="rotate-redo"
          aria-label="重做上一次撤销"
          title="重做"
          className="h-7 gap-1 px-2 text-[11.5px]"
        >
          <Redo2 className="size-3.5" />
          重做
        </Button>
      </div>
    </div>
  );
}
