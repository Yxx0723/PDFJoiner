import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileCard } from '@/components/files/file-card';
import { FilePickerButton } from '@/components/upload/drop-zone';
import { useAppStore, type PdfFileEntry } from '@/store/use-app-store';

export interface FileListProps {
  files: PdfFileEntry[];
  onAddFiles: (files: File[]) => void;
}

export function FileList({ files, onAddFiles }: FileListProps) {
  const reorderFiles = useAppStore((state) => state.reorderFiles);
  const expandAll = useAppStore((state) => state.expandAll);
  const clearAll = useAppStore((state) => state.clearAll);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const allExpanded = files.every((entry) => entry.expanded);
  const ids = files.map((entry) => entry.id);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorderFiles(String(active.id), String(over.id));
  };

  return (
    <section aria-label="PDF 文件列表" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="text-[15px] font-semibold tracking-tight">文件与顺序</h2>
          <Badge variant="secondary" className="tabular-nums">
            {files.length} 个文件
          </Badge>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            拖拽调整 · 从上到下即输出顺序
          </span>
        </div>
        <div className="flex items-center gap-1">
          <FilePickerButton onFiles={onAddFiles} />
          <Button variant="ghost" size="sm" onClick={() => expandAll(!allExpanded)}>
            {allExpanded ? '收起预览' : '展开预览'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="text-muted-foreground hover:text-destructive"
          >
            清空
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="space-y-2.5">
            {files.map((entry, index) => (
              <FileCard key={entry.id} entry={entry} index={index} total={files.length} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
