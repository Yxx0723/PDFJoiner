import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ImageCard } from '@/components/images/image-card';
import { FilePickerButton } from '@/components/upload/drop-zone';
import { useImageStore } from '@/store/use-image-store';

/**
 * Drop under the pointer rather than "closest centre".
 *
 * In a grid the dragged card's own rect follows the cursor, so `closestCenter`
 * often resolves to the card being dragged and the drop becomes a no-op. Using
 * the pointer makes the target the card the user is actually hovering.
 */
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
};

export function ImageGrid({ onAddFiles }: { onAddFiles: (files: File[]) => void }) {
  const images = useImageStore((state) => state.images);
  const reorderImages = useImageStore((state) => state.reorderImages);
  const clearAll = useImageStore((state) => state.clearAll);
  const busy = useImageStore((state) => state.build.status === 'building');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorderImages(String(active.id), String(over.id));
  };

  const ids = images.map((entry) => entry.id);

  return (
    <section aria-label="图片列表" className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="text-[15px] font-semibold tracking-tight">图片与顺序</h2>
          <Badge variant="secondary" className="tabular-nums">
            {images.length} 张
          </Badge>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            拖拽调整 · 每张图片一页，顺序即输出顺序
          </span>
        </div>
        <div className="flex items-center gap-1">
          <FilePickerButton
            onFiles={onAddFiles}
            label="添加图片"
            accept="image/*,.jpg,.jpeg,.png,.webp,.bmp,.gif,.heic,.heif"
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={clearAll}
            className="text-muted-foreground hover:text-destructive"
          >
            清空
          </Button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-4">
            {images.map((entry, index) => (
              <ImageCard key={entry.id} entry={entry} index={index} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
